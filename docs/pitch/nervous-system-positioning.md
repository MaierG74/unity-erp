# Unity + Matt — The Spine and the Nervous System

**Status:** Active positioning, 2026-05-07
**Author origin:** Distilled in conversation between Greg and Claude after the QButton pitch and a GPT-5.5 deep-research pass against a two-site furniture prospect.
**Companion docs:**
- [openclaw-qbutton-pitch.md](openclaw-qbutton-pitch.md) — the original QButton-specific deck
- [2026-05-07-two-site-furniture-deep-research.md](2026-05-07-two-site-furniture-deep-research.md) — the GPT-5.5 deep research that this positioning grew out of

---

## The pitch

> Your ERP is the **spine**. It holds the factory upright. But spines don't notice things. People do — and people get distracted. The phone rings. A crisis pulls them somewhere else. Balls drop. Not because anyone's bad. Because they're human.
>
> What we give you is the **nervous system**. Agents that watch every signal in the business and won't let anything go until it's closed. A delivery note that didn't get matched. A transfer that left one building and never landed in the other. A customer whose order has been "almost ready" for three days. A clock-in anomaly that would've cost wages on Friday.
>
> The agents don't forget. They don't take lunch. They don't get distracted. They notice, they push, they escalate, they close. Unity ERP plus Matt-style agents is the spine *and* the nervous system. That's what makes a factory tight.

Use this verbatim. It is the elevator pitch. It works for a one-site shop or a twenty-site group. It works for steel, wood, upholstery, plastics, food, or mixed.

---

## What we're actually selling

Two things, integrated:

1. **Unity ERP — the spine.** The system of record. Multi-tenant, manufacturing-focused, with modules for Manufacturing (BOL → Work Pool → Job Cards), Cutlist, Purchasing, Payroll & Timekeeping, Labor Planning, Furniture Configurator, in-app AI Assistant.
2. **Matt-style agents — the nervous system.** 24/7 autonomous agents that watch every signal in the spine, drive things to closure, escalate when stalled, and produce auditable action trails. Telegram-first interaction, Supabase MCP for grounded DB access, multi-model (GPT-5.5 reasoning, Gemini 3 Flash vision, Groq voice).

The story is not "we have an ERP" or "we have AI." Both of those are commodities in 2026. The story is that we have **both, integrated, with a closure engine that humans can't replicate.**

---

## Competitive positioning

| Category | What they sell | What they're missing |
|---|---|---|
| **Generic ERPs** (Epicor Kinetic, Infor CloudSuite, Odoo, MRPeasy, Katana, Fishbowl) | Spine. Sometimes a copilot bolted on. | No persistent nervous system. No closure engine. No "agent that won't let go." |
| **Generic AI copilots** (Microsoft Copilot, Salesforce Agentforce, Glean Agents) | Reactive Q&A on top of someone else's data. | They answer when asked. They don't drive things to completion. They don't own outcomes. |
| **Niche furniture tools** (imos iX, Cabinet Vision, Cyncly Design Flex) | Engineering and design depth. | Not an ERP, not an operating system, no agent fabric. |
| **Unity + Matt** | Spine + nervous system, integrated, with a closure engine. | — |

We don't out-Epicor Epicor. We don't out-design imos. We win because **only we sell both layers, integrated, with a deliberate closure mechanic.**

---

## The closure engine — the load-bearing product feature

Every piece of work the agents touch needs the same skeleton:

- **Owner** — a named human or named agent
- **Age** — how long it's been open
- **SLA** — how long it's allowed to be open
- **Status** — open, in progress, blocked, closed, with a coded blocker reason
- **Escalation policy** — owner first, then supervisor, then top of next morning brief, then named in the weekly digest
- **Closure note** — when it closes, the agent posts a short note explaining what changed

Without the closure engine, Matt and his successors are just chatbots that know your DB. With the closure engine, they're a nervous system. **This is what we have to build, as a product capability, not as per-agent prompt engineering.** Every existing and future agent gets more valuable the moment this exists.

Initial implementation lives alongside the existing `job_work_pool_exceptions` + `job_work_pool_exception_activity` pattern — extend and generalise rather than rebuild.

---

## Considered messaging — the principle that protects the closure engine

The closure engine only works if humans **read and act on** what the agents tell them. The moment an agent becomes spammy, humans tune it out, the digest gets ignored, and the whole nervous system goes quiet. Spammy agents are worse than no agents.

So every Matt-style agent honours these rules. They are not implementation details; they are product DNA.

- **Silent by default.** If there is nothing actionable, send nothing. No "all clear", no "HEARTBEAT_OK", no "I checked and found nothing." Absence of a message means everything is fine.
- **One message per cycle, not per item.** Batch findings into a single digest with a stable format. A heartbeat that finds five things sends one message, not five.
- **Escalation is earned by age, not by repetition.** Don't surface the same item at the same urgency twice in a row — wait until SLA aging promotes it. Repetition without new information is noise.
- **Honour closure.** When something is closed, never resurface it. Ever. A closed item that re-appears in a digest destroys trust in the closure engine in one keystroke.
- **Distinguish action from FYI.** "You need to do something" and "you might like to know" are different messages. Format them differently. Consider sending FYI items only in batched digests, never as live pings.
- **Tight, scannable format.** A senior decision-maker should read any agent message in 5 seconds. If it takes longer, the agent is doing too much.
- **Quiet outside business hours.** No pings off-hours unless something is genuinely on fire — and "on fire" must be defined narrowly per agent, not left to the model's judgement.

These rules apply to every agent (heartbeat, receiving, transfer, exception triage, daily brief, every future one), every cron, every digest. When designing a new agent, the first question is not "what should it surface?" but **"what should it never surface, and when should it stay silent?"**

---

## The pilot agent slate

Each is a "nerve that won't let go." Each one creates an auditable ERP event and survives a buyer's risk review.

| # | Agent | What it watches | The "won't let go" mechanic |
|---|---|---|---|
| 1 | **Receiving & PO Match** | Inbound delivery notes vs. open POs | An unreceipted line item stays open and re-surfaces every shift until reconciled. The 4 missing oak boards don't quietly disappear into the WIP. |
| 2 | **Production Exception Triage** | All production blockers (shortage, awaiting transfer, quality hold, labour unavailable, supplier late, engineering clarification) | Every blocker has an owner, an age, and a status. Old blockers escalate. Resolved blockers post a closure note. Nothing rots. |
| 3 | **Inter-Site / Inter-Building Transfer** | Component movement between physical locations (steel→wood, fab→upholstery, store→shop) | Dispatched-but-not-acknowledged becomes a flag in 30 minutes, an escalation in 2 hours, a name-and-shame in the next morning brief. Even a 100m walk between buildings counts. |
| 4 | **Daily Control-Tower Brief** | All of the above, rolled up | Every morning, a Telegram message: late POs, stuck transfers, blocked jobs, payroll anomalies, customer orders past internal ETA. **The list always shrinks or someone gets called.** |

Agent #4 is the one the MD will use personally. It is the most visible proof that the nervous system is real — they wake up, read the list, see the agents have been working all night.

### Phase 2 candidates (not in pilot story)

End-of-Shift Handover, Quality Reject Capture, Payroll Anomaly, Raw-Material Reorder Advisor, Sales Quote Drafter, Customer Order Status Responder, Config-to-Production Sanity Agent. Each becomes more valuable once the closure engine exists.

### What to keep OUT of the pilot story

Marketing flyer generation, autonomous purchase approvals, payroll writebacks, customer-facing ETA promises, full configurator-to-job-card automation, broad multi-agent orchestration. Demoing them is fine. Pitching them is premature and dilutes the "tight factory" thesis.

---

## What this means for the build queue

In dependency order:

1. **Closure engine** (extend `job_work_pool_exceptions` pattern into a generalised owner/age/SLA/escalation/closure-note primitive). Without this, every other agent is weaker than it should be.
2. **Receiving & PO Match — productised.** Matt does this today. Promote it from one-off agent skill to a first-class workflow with the closure engine.
3. **Inter-site / inter-building transfer ledger.** New schema. Even single-site customers benefit (between bays, between stores and the floor, between a shop and a finishing area).
4. **Production Exception Triage Agent.** Build on the existing exception taxonomy. Add escalation + ownership.
5. **Daily Control-Tower Brief Agent.** Pure aggregation over the closure engine — once #1 exists, this is mostly templating.
6. **Mobile/tablet kiosk UX.** Telegram is great for owners and supervisors. Shop-floor users may need a tablet kiosk; pilot will tell us which.

---

## Sales-conversation reusables

Short snippets that come up repeatedly:

**On why "we have AI" doesn't differentiate:**
> Everyone has AI in 2026. What we have is AI that owns outcomes. There's a difference between an assistant that answers when asked and a nervous system that pushes things until they're done.

**On why an ERP alone isn't enough:**
> An ERP is necessary but it isn't sufficient. It records what happened. It doesn't notice what's slipping. The gap between "the data is in the system" and "the right people are doing the right thing" is where factories lose money — and that gap is exactly where the nervous system lives.

**On why Telegram:**
> Your supervisors and your owner already live in messaging. We don't ask them to learn a new app. We meet them where they already are, and we add a voice that doesn't get distracted.

**On why Matt has worked in our QButton POC:**
> Matt caught four oak boards that had been delivered but never received into stock. A human did the receiving. A human read the delivery note. The boards still got lost. Matt didn't lose them. That is the difference between a spine and a nervous system, in one example.

---

## Maintenance

This doc is the canonical positioning until something replaces it. Update it — don't fork it — when the framing evolves. Companion proposals (per-prospect deck, pilot SOW, pricing) should reference this doc rather than restate it.
