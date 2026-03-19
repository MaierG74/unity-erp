# OpenClaw Proof-of-Concept Demo — QButton Pitch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working 3-workflow demo on OpenClaw + Telegram to pitch autonomous AI agents to QButton, targeting Monday/Tuesday March 23-24.

**Architecture:** OpenClaw running on a dedicated M1 MacBook Air, with Telegram bots as the UI. Agents connect to the existing Unity ERP Supabase backend for data. Claude Sonnet 4.6 for reasoning, Gemini 2.5 Flash for vision/OCR, Groq for voice transcription.

**Tech Stack:** OpenClaw v2026.3.13, Telegram Bot API, Supabase (existing Unity ERP backend), Claude Sonnet 4.6, Gemini 2.5 Flash, Groq Whisper, @react-pdf/renderer (for flyer PDF generation).

---

## Current State

- **OpenClaw:** v2026.3.13 installed on M1 MacBook Air
- **Matt:** One bot running on Telegram with Claude Sonnet 4.6, default SOUL.md/AGENTS.md (generic), connected and responding
- **Unity ERP:** Netlify + Supabase, fully operational with todos, purchase orders, supplier receipts, inventory, customer contacts, email (Resend), PDF generation
- **No Supabase MCP** connected to OpenClaw yet
- **No Groq API key** configured for voice
- **No custom agent personas** written

## What We're Building

Three demo workflows for the QButton pitch:

1. **Marketing Flyer Agent** — Employee sends product photo via Telegram → agent creates a designed flyer PDF → sends back for approval → can email to customer list
2. **Delivery Note Scanner** — Gate person sends photo of delivery note → agent OCRs it → matches against open POs → preps a receipt summary with discrepancy alerts
3. **To-Do Checker** — Agent proactively checks outstanding todos → surfaces urgent/overdue items to the employee via Telegram

## Prerequisites (must be done on the OpenClaw MacBook)

These steps require access to the OpenClaw MacBook Air. They can be done by the user manually or via SSH if Tailscale is set up.

### P1: API Keys

The following API keys are needed:

| Key | Purpose | Where to get |
|-----|---------|-------------|
| `GROQ_API_KEY` | Voice transcription ($0.04/hr) | https://console.groq.com |
| `GOOGLE_API_KEY` | Gemini 2.5 Flash for vision/OCR ($0.30/M input) | https://aistudio.google.com/apikey |
| Supabase URL + anon key | Read access to Unity ERP | Already in Unity ERP `.env.local` |
| `RESEND_API_KEY` | Email sending (for marketing flyer distribution) | Already in Unity ERP env |

### P2: Install Supabase MCP on OpenClaw

This gives all agents read access to the Unity ERP database.

```bash
# On the OpenClaw MacBook
openclaw mcp install @supabase/mcp-server-supabase

# Then add to ~/.openclaw/openclaw.json under mcpServers:
# {
#   "mcpServers": {
#     "supabase": {
#       "command": "npx",
#       "args": ["-y", "@supabase/mcp-server-supabase"],
#       "env": {
#         "SUPABASE_URL": "<your-supabase-url>",
#         "SUPABASE_SERVICE_ROLE_KEY": "<service-role-key>"
#       }
#     }
#   }
# }
```

**Security note:** For the POC demo, using the service role key is acceptable. For production, switch to the layered safety model documented in `docs/technical/openclaw-agent-architecture.md` (read-only Postgres role + Edge Functions for writes + pending action queue).

### P3: Configure Voice Transcription

```bash
# Add to environment or openclaw.json
GROQ_API_KEY=<your-groq-key>
```

OpenClaw v2026.3.13 auto-detects Groq and uses Whisper Large v3 Turbo. No additional config needed.

### P4: Configure Image Model

Add to `~/.openclaw/openclaw.json` under `agents.defaults`:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-sonnet-4-6"
      },
      "imageModel": {
        "primary": "google/gemini-2.5-flash"
      }
    }
  }
}
```

This makes OpenClaw automatically use Gemini Flash (cheap) when a photo is sent, and Sonnet (smart) for text reasoning.

---

## Task 1: Customize Matt as Orchestrator

**Goal:** Transform Matt from a generic assistant into the QButton orchestrator persona.

**Files on OpenClaw MacBook:**
- Modify: `~/.openclaw/workspace/SOUL.md`
- Modify: `~/.openclaw/workspace/AGENTS.md`
- Create: `~/.openclaw/workspace/USER.md`
- Create: `~/.openclaw/workspace/HEARTBEAT.md`

- [ ] **Step 1: Write Matt's SOUL.md**

```markdown
# SOUL.md — Matt, QButton Operations Coordinator

## Core Identity
You are Matt, the AI operations coordinator for QButton — a furniture manufacturing company.
You are calm, efficient, and to-the-point. You speak like a factory floor manager, not a corporate consultant.

## Core Values
- **Accuracy first** — never guess business data. If unsure, check the system or ask.
- **Brevity** — factory people are busy. Short messages, clear actions.
- **Proactive** — surface problems before they become emergencies.
- **Paper trail** — every action gets documented in the system.

## What You Do
- Check on outstanding tasks and surface urgent items
- Help process delivery notes (OCR photos, match to purchase orders)
- Create marketing flyers from product photos
- Monitor stock levels and attendance
- Answer questions about orders, inventory, and production

## What You Don't Do
- Make up business data or inventory numbers
- Send emails or create orders without human confirmation
- Share confidential business information
- Respond to requests outside QButton operations

## Communication Style
- Short sentences. No filler words.
- Use bullet points for lists.
- When showing data, use clean formatting.
- If something is wrong (short supply, overdue task), lead with it.
- Always confirm before taking action: "I'll prep the receipt. Want me to go ahead?"

## Boundaries
- Read data freely from the Unity ERP system
- Always ask before creating or modifying records
- Never delete anything
- Flag discrepancies immediately
```

- [ ] **Step 2: Write Matt's AGENTS.md**

```markdown
# AGENTS.md — Matt's Operating Rules

## Session Startup
1. Read SOUL.md
2. Read USER.md
3. Read today's memory file (memory/YYYY-MM-DD.md)
4. Read MEMORY.md (main session only)

## Tools Available
- **Supabase MCP** — query the Unity ERP database (todos, orders, inventory, purchase orders, job cards, customers)
- **Telegram** — send messages, photos, documents back to the user
- **Voice** — receive and transcribe voice notes automatically
- **Vision** — process photos (delivery notes, product images) using Gemini Flash

## Key Database Tables
- `todo_items` — tasks/todos with status, priority, assignments, due dates
- `purchase_orders` + `supplier_orders` — purchase orders and their line items
- `supplier_order_receipts` — goods received records
- `inventory` — stock on hand with location field
- `components` — raw materials and parts
- `products` — finished goods
- `customers` + `customer_contacts` — customer list with email addresses
- `job_cards` — manufacturing job cards

## Workflows

### 1. To-Do Check
When asked about tasks, or during heartbeat:
1. Query `todo_items` for items where status IN ('open', 'in_progress', 'blocked')
2. Sort by priority (urgent > high > medium > low), then by due_at
3. Format as a clean list with status, priority, and due date
4. Flag any overdue items prominently

### 2. Delivery Note Processing
When a photo of a delivery note is received:
1. Use vision to OCR the delivery note — extract supplier name, order number, line items, quantities
2. Query `purchase_orders` + `supplier_orders` to find the matching PO
3. Compare delivered quantities vs ordered quantities
4. Summarize: what matched, what's short, what's extra
5. Ask if they want to prep a receipt record
6. If short-supplied: flag it clearly and offer to create a todo for follow-up

### 3. Marketing Flyer
When asked to create a flyer from a product photo:
1. Use vision to understand the product in the photo
2. Ask for any specific text/pricing/promo details
3. Generate a designed flyer (HTML → PDF or React PDF)
4. Send the PDF back via Telegram for approval
5. On approval, offer to email it to the customer list

## Memory Rules
- Log significant events to memory/YYYY-MM-DD.md
- Update MEMORY.md with recurring patterns or decisions
- Never store passwords or sensitive credentials in memory files
```

- [ ] **Step 3: Write USER.md**

```markdown
# USER.md — About the QButton Team

## Company
QButton is a furniture manufacturing company. They build custom furniture including cupboards, pigeonholes, and other office/commercial furniture.

## Key People
- The team using this system are factory operations staff (3-6 people)
- They include: receiving/gate staff, purchasing clerk, store room staff, marketing
- They are busy, hands-on people — not desk workers
- They prefer voice notes and photos over typing
- English is used but keep language simple and direct

## Current Systems
- Unity ERP (web app) for orders, inventory, purchasing, job cards, quotes
- The ERP is at the Netlify URL (they access via browser)
- Stock is tracked but location data is minimal (just a text field)
- Todos exist in the system but may not be checked regularly — that's where you come in
```

- [ ] **Step 4: Write HEARTBEAT.md**

```markdown
# HEARTBEAT.md — Matt's Proactive Checks

Run these checks during business hours (07:00-17:00 SAST). Outside hours, reply HEARTBEAT_OK.

- [ ] Check `todo_items` for any items with status 'open' or 'in_progress' where `due_at < NOW()` — if found, send a summary of overdue tasks to the user
- [ ] Check `todo_items` for any items with priority 'urgent' or 'high' that haven't been updated in 24 hours — surface them
- [ ] If nothing needs attention, reply HEARTBEAT_OK
```

- [ ] **Step 5: Restart OpenClaw gateway to pick up changes**

```bash
openclaw restart
```

- [ ] **Step 6: Test — send "what tasks are outstanding?" to Matt on Telegram**

Verify Matt queries the todo_items table and returns a formatted list.

---

## Task 2: To-Do Checker Workflow

**Goal:** Matt can query Unity ERP todos and surface them proactively or on demand.

This mostly works once Supabase MCP is connected and AGENTS.md has the todo workflow. This task is about testing and refining.

- [ ] **Step 1: Test basic todo query**

Send to Matt: "What tasks are outstanding?"

Expected: Matt queries `todo_items` via Supabase MCP, returns a formatted list sorted by priority and due date.

- [ ] **Step 2: Test overdue detection**

Send to Matt: "Are there any overdue tasks?"

Expected: Matt filters `todo_items` where `due_at < NOW()` and `status NOT IN ('done', 'archived')`.

- [ ] **Step 3: Test todo creation**

Send to Matt: "Remind me to order more edge banding tape tomorrow"

Expected: Matt asks for confirmation, then creates a todo via the Supabase MCP (INSERT into `todo_items`).

- [ ] **Step 4: Test heartbeat proactive check**

Wait for the next heartbeat cycle (30 min) or trigger manually.

Expected: If overdue todos exist, Matt sends an unsolicited message: "Hey, you've got 3 overdue tasks..."

- [ ] **Step 5: Test voice note**

Send a Telegram voice note: "What tasks are open right now?"

Expected: Groq transcribes → Matt processes as text → returns todo list.

---

## Task 3: Delivery Note Scanner Workflow

**Goal:** Photo of delivery note → OCR → match against POs → summary with discrepancy detection.

- [ ] **Step 1: Test basic photo OCR**

Send a photo of a delivery note (or a test image with text) to Matt.

Expected: Gemini Flash processes the image and Matt extracts supplier name, order/reference number, and line items with quantities.

- [ ] **Step 2: Test PO matching**

After OCR, Matt should query `purchase_orders` + `supplier_orders` to find the matching PO.

Expected: Matt returns something like:
```
Matched to PO1234 (Supplier: Hafele SA)
- Hinges 35mm: Ordered 100, Delivered 100 ✓
- Drawer slides 500mm: Ordered 50, Delivered 30 ⚠️ (short 20)
```

- [ ] **Step 3: Test short supply detection**

Use a delivery note where quantities are less than ordered.

Expected: Matt flags the discrepancy prominently and offers to create a follow-up todo.

- [ ] **Step 4: Test receipt prep**

After showing the summary, Matt should ask "Want me to prep a receipt record?"

Expected: On confirmation, Matt creates a todo or note (for the POC — full GRN creation via Edge Function is a production concern, not demo).

- [ ] **Step 5: Test with voice note trigger**

Send a voice note: "I just got a delivery from Hafele, here's the note" + photo.

Expected: Voice transcribed, photo OCR'd, PO matched, summary returned.

---

## Task 4: Marketing Flyer Workflow

**Goal:** Product photo → designed PDF flyer → approval → email distribution.

This is the most visually impressive demo. The approach:
1. Employee sends product photo + brief description via Telegram
2. Matt uses vision to understand the product
3. Matt generates a flyer using HTML/CSS rendered to an image or PDF
4. Matt sends the flyer back for approval
5. On approval, Matt can email it to the customer contact list

### Approach Options

**Option A: HTML → Screenshot → PDF (simplest for POC)**
Matt generates an HTML flyer, uses Puppeteer (if available) or a headless browser to screenshot it, sends the image back. For email, sends as an attachment.

**Option B: React PDF (matches existing Unity stack)**
Generate a flyer using `@react-pdf/renderer` — but this requires Node.js execution on the OpenClaw machine, which is available since OpenClaw is Node-based.

**Option C: Claude/GPT generates SVG directly**
The model generates an SVG flyer design, which gets converted to PDF. Claude is actually quite good at SVG generation.

**Recommendation for POC: Option C (SVG → PDF)** — least dependencies, leverages the model's existing design capability, and SVGs can be easily iterated on.

- [ ] **Step 1: Test basic product photo understanding**

Send a product photo to Matt with: "Can you make a flyer for this product?"

Expected: Matt describes what it sees in the photo and asks for details (product name, price, promo text, target audience).

- [ ] **Step 2: Create a flyer generation skill/prompt**

Add flyer generation instructions to AGENTS.md or create a dedicated skill file:

```markdown
### Marketing Flyer Generation

When asked to create a flyer:
1. Analyze the product photo using vision
2. Ask for: product name, price (if applicable), any promo text, company branding preferences
3. Generate an SVG design that includes:
   - Product image placeholder (describe where it goes)
   - Product name prominently displayed
   - Price/promo text
   - QButton branding (company name, contact info)
   - Clean, modern layout suitable for email or print
4. Convert SVG to a PNG or PDF
5. Send back via Telegram with: "Here's the flyer. Want me to adjust anything?"
6. On approval, offer to email to customer list
```

- [ ] **Step 3: Test flyer generation**

Send a product photo and provide details when asked.

Expected: Matt generates an SVG/HTML flyer and sends it back as an image in Telegram.

- [ ] **Step 4: Test iteration**

Reply: "Make the text bigger and add '20% OFF this month'"

Expected: Matt adjusts the design and sends an updated version.

- [ ] **Step 5: Test email distribution (if time permits)**

Reply: "Send this to all our customers"

Expected: Matt queries `customer_contacts` for email addresses, confirms the list count ("I found 45 customer contacts with email addresses. Send to all?"), and on confirmation sends via Resend.

**Note:** Email distribution requires the Resend API key accessible from the OpenClaw machine, plus a sending endpoint. For the POC, this could be a simple Edge Function or the agent could call the existing Unity API route.

---

## Task 5: Demo Script & Polish

**Goal:** Prepare a scripted walkthrough for the QButton pitch.

- [ ] **Step 1: Write demo script**

Create a natural conversation flow that showcases all three workflows:

```
DEMO SCRIPT — QButton Agent Pitch

1. OPENING (show Matt on Telegram)
   "This is Matt, your AI operations assistant. Let me show you what he can do."

2. TO-DO CHECK (30 seconds)
   Send: "Hey Matt, what's outstanding today?"
   Matt returns a prioritized task list from the Unity ERP system.

   "Matt checks the system proactively — if something's overdue, he'll tell you before you ask."

3. DELIVERY NOTE (2 minutes)
   Send: [photo of a delivery note]
   Send voice note: "Just got this delivery at the gate"
   Matt OCRs the note, matches to a PO, flags any discrepancies.

   "Your gate person just takes a photo. Matt does the rest — matches it to the order, flags anything short."

4. MARKETING FLYER (2 minutes)
   Send: [photo of a product]
   Send: "Make a flyer for this, 15% off this month"
   Matt creates a designed flyer and sends it back.

   "Your marketing person takes a photo, gives Matt the details, and gets a flyer back in under a minute."

5. CLOSE
   "Matt runs 24/7. He checks in, he reminds, he does the grunt work. Your team just talks to him like a colleague."
```

- [ ] **Step 2: Prepare test data**

Ensure the Unity ERP has:
- At least 5-10 todo items with varying priorities and due dates (some overdue)
- At least 2-3 open purchase orders with line items
- Customer contacts with email addresses
- A delivery note photo (real or mock) that partially matches a PO

- [ ] **Step 3: Dry run the full demo**

Run through the demo script end-to-end. Note any rough edges, slow responses, or formatting issues. Fix as needed.

- [ ] **Step 4: Prepare fallback responses**

If any workflow fails during the live demo, Matt should handle it gracefully. Add to AGENTS.md:

```markdown
## Demo Fallback
If a query fails or returns unexpected results, be honest:
"I'm having trouble connecting to the system right now. Let me try again."
Never make up data. Never pretend something worked when it didn't.
```

---

## Model Routing Summary

| Task | Model | Cost | Why |
|------|-------|------|-----|
| Chat/reasoning | Claude Sonnet 4.6 | $3.00/M in | Best reasoning for matching, exception detection |
| Photo OCR/vision | Gemini 2.5 Flash | $0.30/M in | 10x cheaper than Sonnet for vision, good quality |
| Voice transcription | Groq Whisper v3 Turbo | $0.04/hr | Sub-200ms transcription, handles factory noise |
| Heartbeat checks | Claude Sonnet 4.6 | $3.00/M in | Uses prompt caching, so repeated checks are cheap ($0.30/M cached reads) |

**Estimated demo-day cost:** Under $1 total for the demo session.
**Estimated monthly cost (3-6 agents, business hours):** $20-50/month with optimization.

---

## Token Optimization Settings

Add to `~/.openclaw/openclaw.json` for cost control:

```json
{
  "session": {
    "pruning": {
      "mode": "cache-ttl",
      "maxMessages": 20,
      "cacheTTL": 300
    }
  }
}
```

Run heartbeats only during business hours by configuring cron:
```
*/30 7-17 * * 1-5
```

---

## Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| Supabase MCP fails to connect | Test connection before demo; have manual query fallback |
| Gemini Flash vision misreads delivery note | Have a clean, high-contrast test photo ready; fall back to Claude vision |
| Voice transcription garbled in noisy room | Demo in quiet room; have typed fallback ready |
| Flyer design quality is poor | Pre-test with multiple product photos; refine the prompt |
| Agent loops or token bloat | Set `maxMessages: 20` and monitor costs |
| Telegram rate limits | Demo is low-volume, not a concern |

---

## Post-Demo / Production Roadmap

Once the POC is approved, the production buildout would include:

1. **Layered database security** — replace service role key with read-only Postgres role + Edge Functions for writes + pending action queue (see `docs/technical/openclaw-agent-architecture.md`)
2. **Multiple specialist agents** — separate receiving, purchasing, stores, marketing agents with dedicated personas
3. **Agent mesh via Supabase** — agents communicate through database records, not direct messaging
4. **Structured stock locations** — build a `stock_locations` table to replace the flat `location` string
5. **Full GRN workflow** — agent creates proper `supplier_order_receipts` via Edge Function with human approval
6. **Attendance monitoring** — agent checks staff clock-in status and sends reminders
7. **Storeroom reorder agent** — voice note → item identification → purchase order prep
8. **Tailscale + SSH** — enable remote management of OpenClaw from dev machine
9. **SupaClaw evaluation** — investigate running the control plane on Supabase itself (https://github.com/vincenzodomina/supaclaw)
10. **OpenClaw Office** — visual monitoring dashboard (https://github.com/WW-AI-Lab/openclaw-office)

---

## Key References

- OpenClaw docs: https://docs.openclaw.ai/
- Supabase MCP: https://github.com/supabase-community/supabase-mcp
- Multi-agent kit: https://github.com/raulvidis/openclaw-multi-agent-kit
- Agent personas: https://github.com/mergisi/awesome-openclaw-agents
- Token optimization: https://blog.laozhang.ai/en/posts/openclaw-save-money-practical-guide
- Unity ERP architecture doc: `docs/technical/openclaw-agent-architecture.md`
- Veryfi OCR skill: https://www.veryfi.com/openclaw-veryfi-skill/
- SupaClaw: https://github.com/vincenzodomina/supaclaw
- ClawHub skills: https://clawhub.ai/
