# OpenClaw Agent Architecture — Unity ERP

> Reference doc for any AI assistant working on the OpenClaw integration.
> OpenClaw launched after most model training cutoffs — read this before making assumptions.

## What is OpenClaw?

OpenClaw (https://openclaw.ai/) is an open-source Node.js orchestration layer that runs AI agents 24/7 on dedicated hardware. It wraps Claude Code (and other LLMs) with a Gateway process, messaging adapters (Telegram, Discord, Slack, etc.), persistent memory, and a tool registry.

- **Not a chat UI** — it's an autonomous agent runtime
- **Controllable remotely** via Telegram bots, Discord, WhatsApp, etc.
- **Runs on dedicated hardware** — in our case, a dedicated M1 MacBook Air
- **The Unity ERP app itself is hosted on Netlify with a Supabase backend** — OpenClaw agents interact with the same Supabase backend

## Our Setup

- **Hardware:** Dedicated M1 MacBook Air running OpenClaw (separate from dev machines)
- **App hosting:** Netlify (frontend) + Supabase (backend/database)
- **Messaging:** Telegram bots — each agent gets its own bot via BotFather
- **Models:** Claude Sonnet, GPT 5.4, configurable per agent
- **Status:** Fresh install, one bot ("Matt") running as of March 2026

## Agent Mesh Design

### Matt — The Orchestrator
- Model: Claude Sonnet
- Role: Human-facing coordinator. Managers and key staff talk to Matt directly.
- Matt routes work to specialist agents and tracks completion.
- Matt does NOT do domain work himself — he delegates.

### Specialist Agents (planned)
Each gets their own Telegram bot, paired with a specific employee or role:

- **Receiving Agent** — paired with the gate/receiving staff. Handles delivery intake, photo scanning, GRN prep.
- **Purchasing Agent** — paired with the purchasing clerk. Handles reorder alerts, supplier follow-ups, short supply escalation.
- **Marketing Agent** (future) — paired with marketing staff. Creates flyers from product photos, distributes to customer lists.
- More agents to follow as workflows are proven.

### Communication Pattern
Agents communicate **through Supabase, not directly**:
1. Agent A detects an event (e.g., short supply on a delivery)
2. Agent A writes a fact/exception record to Supabase
3. Agent B picks it up on its next heartbeat check or via webhook
4. Agent B surfaces it to its paired human

This means the business fact exists in the database regardless of agent state. If an agent crashes or restarts, nothing is lost.

## OpenClaw Workspace Files

Each agent has these files in its workspace:

| File | Purpose |
|------|---------|
| `SOUL.md` | Persona, values, communication style, boundaries |
| `AGENTS.md` | Rules for how the agent behaves |
| `TOOLS.md` | Documents which tools the agent can use |
| `IDENTITY.md` | Name, avatar, emoji |
| `USER.md` | Context about the human it works with |
| `MEMORY.md` | Persistent notes the agent writes to itself across sessions |
| `HEARTBEAT.md` | Recurring proactive check-in tasks |

## Database Access — Layered Safety Model

Agents must NEVER be given the Supabase service role key directly. Use this layered approach:

### Layer 1 — Read-Only Postgres Role
- Custom `agent_worker` Postgres role
- `GRANT SELECT` on only the tables the agent needs
- RLS enforced, scoped to `org_id`
- No DELETE, no TRUNCATE, ever

### Layer 2 — Edge Functions for Writes
- Agent calls purpose-built Supabase Edge Functions (e.g., `agent-receive-delivery`, `agent-create-purchase-order`)
- Edge Functions validate inputs, enforce business rules, use the service role internally
- The agent cannot construct arbitrary writes

### Layer 3 — Pending Action Queue (for risky writes)
For destructive or high-stakes operations, agents write proposals instead of executing:

```sql
-- pending_agent_actions table
id              uuid PRIMARY KEY
org_id          uuid NOT NULL
agent_id        text NOT NULL
action_type     text NOT NULL          -- e.g., 'cancel_order', 'adjust_price'
target_table    text
payload         jsonb NOT NULL
status          text DEFAULT 'pending' -- pending | approved | rejected | executed
created_at      timestamptz DEFAULT now()
reviewed_by     uuid
reviewed_at     timestamptz
```

- Human reviews via Telegram or the ERP dashboard
- On approval, a trigger or Edge Function executes the mutation
- Supabase Queues (`pgmq`) can power the execution pipeline

### Layer 4 — Audit Log
- Append-only `agent_audit_log` table for every agent action
- Supabase Database Webhooks for anomaly detection
- Every read and write is logged

### Action Classification

| Category | Examples | Agent behavior |
|----------|---------|----------------|
| **Always safe** | Read queries, status checks, reports | Execute immediately |
| **Ask first** | Creating GRNs, updating quantities, scheduling | Write to pending queue or require confirmation |
| **Never** | Schema changes, deleting records, modifying RLS, price changes beyond threshold | Hard blocked in Edge Function |

## Token Management

OpenClaw has built-in token management — critical for cost control:

- **Session pruning** (`cache-ttl` mode): trims old tool results from context
  - Soft-trim: keeps start/end of large results, inserts `"..."`
  - Hard-clear: replaces with `[Old tool result content cleared]`
  - Defaults: keeps last 3 assistant turns
- **Memory compaction**: triggers at ~40k tokens, distills sessions into daily summary files
- **Heartbeat**: keeps the prompt cache warm. Set to just under model's cache TTL (e.g., 55 min for 1hr TTL)
- **Default context window**: 200k tokens
- **Agent persona overhead**: ~2-5k tokens fresh, 10-20k with accumulated memory
- **Main cost risk**: large Supabase query results bloating context — keep queries focused

## Telegram Integration

### Current: DM Bots
Each agent gets its own BotFather token. Each employee DMs their specific bot. Clear ownership, simple setup.

### Future option: Supergroup with Forum Topics
One Telegram supergroup with forum mode. Each topic bound to a different agent. Good for management visibility / "mission control."

### Security
- `dmPolicy: "pairing"` by default — unknown senders must enter a pairing code
- Elevated bash toggled per-session (`/elevated on|off`)
- Auth credentials never shared across agents

## Example Workflows

### Delivery Receipt (first target)
1. Gate person sends photo of delivery note to Receiving Agent via Telegram
2. Agent uses Claude vision to OCR the delivery note — extracts order number, line items, quantities
3. Agent queries Supabase: matches against open purchase orders
4. Agent preps a GRN record (via Edge Function) with the photo attached
5. Agent messages Purchasing Agent's human: "Delivery for PO1234 arrived, needs checking into stock"
6. If short-supplied: agent writes an exception record to Supabase
7. Purchasing Agent picks up the exception on heartbeat, alerts the purchasing clerk
8. Agent checks back in 30 minutes — if not resolved, reminds again

### Storeroom Reorder
1. Storeroom person tells their bot: "We need more glue" + sends a photo
2. Agent identifies the item (vision + entity lookup against components table)
3. Agent checks current stock level and open purchase orders
4. Agent preps a purchase order (via Edge Function) for approval
5. Purchasing clerk reviews and approves

## Integration with Existing Unity Assistant

The OpenClaw agents and the in-app Unity Assistant (AssistantDock) share:
- The same Supabase backend
- The same entity lookup logic (`lib/assistant/entity-lookup.ts`)
- The same business rules

They do NOT share:
- UI — AssistantDock is in-browser, OpenClaw is via Telegram
- Model routing — AssistantDock uses `model-router.ts`, OpenClaw agents use their own model config
- Context — AssistantDock has selected-order context from the UI, OpenClaw agents maintain their own memory

Over time, the domain logic in `lib/assistant/` (inventory, manufacturing, purchasing, etc.) could be exposed as Edge Functions that both the AssistantDock and OpenClaw agents consume.

## Model Routing (Multi-Model Strategy)

Agents should use different models for different task types to control costs:

| Task Type | Recommended Model | Cost/1M Input | Why |
|-----------|------------------|---------------|-----|
| **Vision/OCR** | Gemini 2.5 Flash | $0.30 | 10x cheaper than Sonnet, good document reading |
| **Intent routing** | GPT-5.4 Nano | $0.20 | Purpose-built for classification |
| **Reasoning** | Claude Sonnet 4.6 | $3.00 | Best for matching, exception detection, complex logic |
| **Heartbeats** | GPT-5.4 Nano | $0.20 | Simple read-and-check tasks |
| **Voice transcription** | Groq Whisper v3 Turbo | $0.04/hr | Sub-200ms, handles factory noise |

Configure in `~/.openclaw/openclaw.json`:
```json
{
  "agents": {
    "defaults": {
      "model": { "primary": "anthropic/claude-sonnet-4-6" },
      "imageModel": { "primary": "google/gemini-2.5-flash" }
    }
  }
}
```

**Estimated monthly cost (3-6 agents, business hours):** $20-50/month with optimization.

## Voice Input

OpenClaw has built-in voice transcription. Workers send Telegram voice notes, OpenClaw auto-transcribes before the agent sees the message.

- **Provider:** Groq (auto-detected from `GROQ_API_KEY`)
- **Cost:** $0.04/hour (~$0.25/month for typical factory usage)
- **Latency:** Under 200ms with Groq
- **Factory noise:** Whisper handles industrial noise significantly better than phone dictation
- **Requires:** OpenClaw v2026.3.2+ (MIME normalization fix for Telegram OGG/Opus)

## ClawHub Skills (Pre-Built)

Relevant skills available from https://clawhub.ai/:

| Skill | Purpose |
|-------|---------|
| **Veryfi OCR 3.0** | Structured extraction from receipts/invoices (vendor, total, line items) |
| **stopmoclay/supabase** | Database operations, vector search, storage, SQL queries |
| **Telegram skill** | Send messages, photos, documents with formatting and inline keyboards |
| **nano-banana-pdf-skill** | Visual PDF editing via natural language |
| **context-optimizer** | Reduces context bloat automatically |
| **Agent Team Orchestration** | Handoff protocols, task lifecycles, review workflows |

**Security warning:** VirusTotal found 341 malicious skills on ClawHub in early 2026 ("ClawHavoc" campaign). Always verify skills before installing.

Install: `openclaw skill install <skill-name>`

## Common Pitfalls

| Pitfall | Mitigation |
|---------|-----------|
| **Token bloat from tool outputs** | Truncate outputs; use targeted queries not full schema dumps |
| **Agent loops** | Set max iterations, cost caps, and circuit breakers |
| **Heartbeat token waste** | Run only during business hours (`*/30 7-17 * * 1-5`) |
| **Session history snowball** | Set `maxMessages: 20`, use `cacheTTL` pruning |
| **Malicious ClawHub skills** | Only install verified skills; audit SKILL.md before installing |
| **Vision bugs** | Use cloud providers (Anthropic/OpenAI/Google) not local Ollama for vision |
| **Telegram rate limits** | Batch messages; use topic channels in supergroups |

## Related Projects

| Project | Description | Link |
|---------|-------------|------|
| **SupaClaw** | OpenClaw built entirely on Supabase primitives (auth, cron, edge functions, RLS) | https://github.com/vincenzodomina/supaclaw |
| **openclaw-multi-agent-kit** | Production-tested 10-agent team templates with Telegram supergroup | https://github.com/raulvidis/openclaw-multi-agent-kit |
| **OpenClaw Office** | Visual monitoring dashboard for multi-agent systems | https://github.com/WW-AI-Lab/openclaw-office |
| **awesome-openclaw-agents** | 162 production-ready agent persona templates | https://github.com/mergisi/awesome-openclaw-agents |

## Alternative: Claude Code Channels (Research Preview)

As of Claude Code v2.1.80+, Anthropic offers native Telegram and Discord channel support. This is a lighter-weight alternative to OpenClaw for single-agent setups.

**Setup:**
```bash
# In Claude Code:
/plugin install telegram@claude-plugins-official
/telegram:configure <bot-token>

# Restart with channel enabled:
claude --channels plugin:telegram@claude-plugins-official
```

**Advantages over OpenClaw:**
- Zero infrastructure — it IS Claude Code, with direct access to codebase, MCP servers, tools
- Simpler setup (minutes vs hours)
- Native Anthropic security model (sender allowlists, pairing)

**Limitations vs OpenClaw:**
- Single agent only (no multi-agent mesh)
- Claude models only (no multi-model routing)
- No built-in voice transcription
- No SOUL.md persona system (uses CLAUDE.md instead)
- No HEARTBEAT.md (has scheduled tasks, but less flexible)
- Research preview — may change
- Permission prompts pause session unless `--dangerously-skip-permissions`
- Requires claude.ai login (not API key auth)

**When to use which:**
- **Claude Code Channels** — quick POC, single agent, Claude-only, simple workflows
- **OpenClaw** — production multi-agent system, multi-model, voice input, 24/7 heartbeats, cost optimization

**Docs:** https://code.claude.com/docs/en/channels

## Key Links

- OpenClaw: https://openclaw.ai/
- OpenClaw docs: https://docs.openclaw.ai/
- ClawHub skills marketplace: https://clawhub.ai/
- Supabase MCP server: https://github.com/supabase-community/supabase-mcp
- Composio OpenClaw+Supabase bridge: https://composio.dev/toolkits/supabase/framework/openclaw
- Tutorial reference: https://creatoreconomy.so/p/full-tutorial-set-up-your-247-ai-employee-clawd-molt
- Token optimization guide: https://blog.laozhang.ai/en/posts/openclaw-save-money-practical-guide
- Multi-agent orchestration: https://zenvanriel.com/ai-engineer-blog/openclaw-multi-agent-orchestration-guide/
