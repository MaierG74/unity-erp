# Matt — Your AI Operations Team Member

## Pitch Document: QButton Factory Agent Demo

**Date:** March 2026
**Prepared by:** Greg Maier
**System:** OpenClaw + Unity ERP + Telegram

---

## What Is This?

Matt is an AI operations assistant that lives in Telegram. Factory staff talk to him like a colleague — via text, voice notes, or photos. He connects directly to the Unity ERP system and can look up orders, check stock, scan delivery notes, surface overdue tasks, and more.

He runs 24/7 on a dedicated machine. No app to install. No training needed. Just open Telegram and talk.

---

## Demo 1: Outstanding Task Check

**Scenario:** A manager asks Matt what needs attention today.

**What happened:**
- Manager sent: *"What tasks are outstanding?"*
- Matt queried the Unity ERP todo system in real time
- Returned a prioritized summary:
  - **Overdue:** 2 tasks (flagged prominently)
  - **No due date:** 3 test entries (correctly identified as low priority)
- Matt proactively identified the real task worth attention: *"The Ukhuni/Laser Bracket one sounds like a real job — want me to pull more details on it?"*

**Key insight:** Matt doesn't just list data — he triages. He separated overdue from no-deadline items and flagged the one that mattered.

> **Screenshot:** `screenshots/01-todo-check.png`

---

## Demo 2: Delivery Note Scanning

**Scenario:** A delivery arrives at the gate from Board King. The receiving clerk takes a photo of the delivery note and sends it to Matt.

**What happened:**

### Step 1 — OCR and Identification
- Clerk sent a photo of a handwritten, stamped delivery note (INV257498)
- Matt read the document including:
  - Supplier: Board King
  - Order reference: POQ26-388 with 388 crossed out and 395 written over it
  - Line items: 22 sheets Royal Mahogany, 4 sheets Natural Oak
  - Handwritten note: "5 RETURNED DAMAGED PLEASE REPLACE"
  - Gate security stamp, receiving signature, date

> **Screenshot:** `screenshots/02-delivery-note-photo.png`

### Step 2 — PO Matching
- Matt initially searched for the original reference and found Q26-368 (Board Mart, wrong supplier, already closed)
- When prompted that the number was corrected to 395, Matt immediately found **Q26-395 — Board King, 16 Mar 2026**
- Pulled the PO line items and formatted a comparison table

> **Screenshot:** `screenshots/03-po-matching.png`

### Step 3 — Discrepancy Detection

Matt cross-referenced the delivery note against the PO data and found:

| Component | Ordered | Received | Status | Issue |
|-----------|---------|----------|--------|-------|
| 16mm Royal Mahogany (Shale Oak) | 22 | 17 | Partial | 5 returned damaged |
| 16mm Natural Oak | 4 | 0 | Open | **Delivered but never checked in** |

**Critical finding:** Matt caught that the 4 Natural Oak boards were physically delivered (on the delivery note) but show **0 received** in the system. No receipt, no rejection — they're in limbo.

**Verification:** The 5 damaged Royal Mahogany boards were properly logged as a rejection in Unity (return_id: 56, type: "rejection", reason: "Damaged", dated 16 March 2026). But the Natural Oak boards have no record at all.

> **Screenshot:** `screenshots/04-discrepancy-table.png`

### What this means for QButton

Without Matt:
- The 4 Natural Oak boards sit in the factory with no system record
- Nobody knows they arrived until someone physically counts stock
- The supplier doesn't get chased for the missing receipt
- Cost tracking is wrong — R3,086.80 of stock is unaccounted for

With Matt:
- The gap is flagged the moment the delivery note photo is taken
- The receiving clerk is prompted to receipt the boards or flag the issue
- Nothing falls through the cracks

> **Screenshot:** `screenshots/05-unity-po-screen.png` *(Q26-395 showing 9 outstanding)*

---

## Demo 3: Voice Notes

**Scenario:** A storeroom worker is carrying boxes and can't type. They hold the voice button in Telegram and speak.

**What happened:**
- Worker sent a voice note instead of typing
- Matt received the transcription instantly (powered by Groq Whisper, sub-200ms)
- Responded as if it were a typed message — no difference in quality

**Key insight:** Factory workers have dirty hands, wear gloves, are carrying things. Voice is the natural interface. Matt handles it natively.

> **Screenshot:** `screenshots/06-voice-note.png`

---

## Demo 4: Marketing Flyer

**Scenario:** Marketing wants to promote a product. They take a photo and ask Matt to create a flyer.

**What happened:**
- Employee sent a product photo via Telegram
- Matt analyzed the image and asked for details (product name, pricing, promo text)
- Generated a designed flyer and sent it back in Telegram
- Employee requested changes — Matt iterated on the design
- On approval, Matt can send the flyer to a specific customer via email

> **Screenshot:** `screenshots/07-flyer-creation.png`

---

## How It Works (Technical Overview)

```
[Factory Staff]
     |
     | Telegram (text / voice / photo)
     |
  [Matt - OpenClaw Agent]
     |
     | Reads from Unity ERP database (read-only)
     | Uses AI vision for document scanning
     | Uses AI voice transcription
     |
  [Unity ERP - Supabase]
     |
     | Orders, Inventory, Purchasing,
     | Job Cards, Todos, Customers
```

- **Runs on:** Dedicated MacBook Air (always on)
- **Chat interface:** Telegram (works on any phone, no app install needed)
- **Database:** Read-only access to Unity ERP (cannot modify or damage data)
- **Voice:** Groq Whisper — handles factory noise, sub-200ms transcription
- **Vision:** Gemini Flash — reads delivery notes, invoices, product photos
- **Reasoning:** Claude Sonnet — matches orders, detects discrepancies, drafts responses
- **Cost:** Estimated $20-50/month for 3-6 agents running business hours

---

## What Matt Can Do Today

| Capability | Status | Notes |
|-----------|--------|-------|
| Answer questions about orders, stock, production | Working | Ad-hoc SQL queries against Unity ERP |
| Surface overdue and urgent tasks | Working | Proactive heartbeat checks |
| Scan delivery notes and match to POs | Working | OCR + database cross-reference |
| Detect short supply and receipt gaps | Working | Caught unrecepted Natural Oak boards |
| Receive voice notes | Configured | Groq Whisper transcription |
| Create marketing flyers | Planned | Photo → designed PDF → email |
| Track stock locations | Planned | "Put this in cage one" |
| Prompt reorders from storeroom | Planned | Voice note → purchase order prep |
| Monitor staff attendance | Planned | Proactive clock-in checks |

---

## What's Next

### Phase 1 — Specialist Agents (weeks)
- **Receiving Agent** — dedicated to gate staff, processes every delivery
- **Purchasing Agent** — monitors short supply, chases suppliers, preps reorders
- **Stores Agent** — tracks stock locations, monitors reorder levels

### Phase 2 — Agent Mesh (months)
- Agents communicate through the database, not direct messaging
- Receiving Agent detects short supply → writes exception record → Purchasing Agent picks it up → alerts the clerk
- Human approves actions via Telegram — agent executes

### Phase 3 — Full Factory Coverage
- Attendance monitoring with proactive check-ins
- Marketing flyer generation and distribution
- Job card status updates from the floor
- End-of-day production summaries

---

## The Bottom Line

Matt isn't replacing anyone. He's the extra team member who:
- Never forgets to check the delivery against the PO
- Catches the 4 boards that nobody receipted
- Reminds you about the overdue task before it becomes a crisis
- Does the grunt work so your team can focus on building furniture

**Cost:** Less than R1,000/month.
**Setup:** One Telegram bot. One always-on machine. Connected to your existing ERP.
**Risk:** Zero. Read-only database access. Cannot modify or damage any data.

---

*Document version: March 2026 — Pre-demo draft*
*Save screenshots to `docs/pitch/screenshots/` to complete this document*
