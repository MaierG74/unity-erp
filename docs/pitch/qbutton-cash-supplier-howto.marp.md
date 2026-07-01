---
marp: true
size: 16:9
paginate: false
theme: default
style: |
  section {
    background: #0E141C;
    color: #F5F0E6;
    font-family: 'Helvetica Neue', 'Inter', system-ui, sans-serif;
    padding: 80px 96px;
    line-height: 1.45;
  }
  h1 { color: #E8A249; font-weight: 700; font-size: 56px; line-height: 1.1; margin: 0 0 18px 0; letter-spacing: -0.02em; }
  h2 { color: #F5F0E6; font-weight: 600; font-size: 42px; line-height: 1.2; margin: 0 0 22px 0; letter-spacing: -0.01em; }
  h3 { color: #E8A249; font-weight: 600; font-size: 26px; margin: 0 0 10px 0; }
  p { font-size: 23px; }
  blockquote { border-left: 4px solid #7FE4F5; padding: 8px 0 8px 28px; margin: 0 0 26px 0; background: transparent; }
  blockquote p { margin: 0; }
  blockquote h1, blockquote h2 { color: #F5F0E6; margin: 0 0 12px 0; }
  em { color: #7FE4F5; font-style: italic; }
  strong { color: #E8A249; font-weight: 600; }
  ul { font-size: 22px; line-height: 1.7; }
  /* Cover */
  section.cover { text-align: center; justify-content: center; }
  section.cover h1 { font-size: 92px; color: #F5F0E6; margin-bottom: 16px; letter-spacing: -0.03em; }
  section.cover p { color: #E8A249; font-size: 27px; font-style: italic; font-weight: 300; }
  /* Quote-only */
  section.quote-only { text-align: center; justify-content: center; padding: 130px 120px; }
  section.quote-only h1 { color: #F5F0E6; font-size: 54px; font-weight: 600; line-height: 1.2; max-width: 1100px; margin: 0 auto 40px auto; }
  section.quote-only p { color: #BFB8AA; font-size: 22px; max-width: 880px; margin: 0 auto; }
  /* Scenario (image-right) */
  .scenario { border-left: 4px solid #7FE4F5; padding: 12px 24px; margin: 24px 0 0 0; font-size: 22px; line-height: 1.5; color: #F5F0E6; }
  .scenario .agent { color: #E8A249; font-weight: 600; display: block; margin-top: 14px; font-size: 20px; }
  /* Faults list */
  section.faults { padding: 78px 110px; justify-content: center; }
  section.faults h1 { font-size: 46px; margin-bottom: 24px; }
  section.faults ol { list-style: none; counter-reset: f; padding: 0; margin: 0; max-width: 1160px; }
  section.faults li { counter-increment: f; font-size: 27px; line-height: 1.4; margin: 15px 0; padding-left: 58px; position: relative; color: #F5F0E6; }
  section.faults li::before { content: counter(f); position: absolute; left: 0; top: -4px; color: #E8A249; font-weight: 700; font-size: 32px; }
  section.faults li strong { color: #F5F0E6; }
  section.faults .tag { color: #0E141C; background: #E8A249; font-size: 14px; font-weight: 700; padding: 3px 9px; border-radius: 6px; margin-left: 10px; vertical-align: middle; letter-spacing: .02em; }
  section.faults .ans { display: block; margin-top: 30px; font-size: 22px; color: #7FE4F5; max-width: 1100px; }
  /* Diagram */
  section.diagram { padding: 56px 80px; }
  section.diagram h1 { font-size: 46px; margin-bottom: 10px; }
  section.diagram img { max-height: 360px; width: auto; display: block; margin: 14px auto 18px auto; }
  section.diagram p { text-align: center; color: #BFB8AA; font-size: 22px; max-width: 1000px; margin: 0 auto; }
  /* Shot (real app screenshot) */
  section.shot { padding: 46px 80px; }
  section.shot h1 { font-size: 40px; margin-bottom: 8px; }
  section.shot h1 .num { color: #E8A249; }
  section.shot img { max-height: 432px; width: auto; display: block; margin: 14px auto 16px auto; border-radius: 10px; border: 1px solid #243040; box-shadow: 0 10px 30px rgba(0,0,0,.45); }
  section.shot p { text-align: center; color: #BFB8AA; font-size: 21px; max-width: 1040px; margin: 0 auto; }
  section.shot p strong { color: #E8A249; }
  /* Status spread */
  section.status { padding: 90px 110px; }
  section.status h1 { font-size: 48px; }
  section.status .cols { display: flex; gap: 48px; margin-top: 18px; }
  section.status .col { flex: 1; }
  section.status .col h3 { font-size: 24px; }
  section.status ul { font-size: 21px; line-height: 1.6; }
  section.status .live h3 { color: #5BD6A8; }
---

<!-- _class: cover -->

![bg brightness:0.5](images/cash-01-cover.png)

# Cash-Supplier Tracking

*How it works — from order placed to proof of payment.*

---

<!-- _class: quote-only -->

# It's rarely the order that fails. It's the invoice.

The order goes out fine. What stalls is the paperwork behind it — the invoice that arrives and quietly never gets processed, or never arrives at all. Nothing tells you, until the bench goes quiet.

---

<!-- _class: faults -->

# Where a cash order goes quiet.

<ol>
<li>The invoice <strong>arrives — but never gets processed</strong>. <span class="tag">most common</span></li>
<li>The invoice is <strong>never sent</strong> after the order is placed.</li>
<li>It's processed — but <strong>never paid</strong>.</li>
<li>It's paid — but the <strong>proof of payment is never sent</strong> to the supplier.</li>
</ol>

<span class="ans">Every one of these is invisible today — it depends on someone remembering. Unity now watches all four, and nudges the moment one stalls.</span>

---

![bg right:50%](images/cash-02-forgotten.png)

> ## "The invoice came in three weeks ago. It's still sitting in an inbox — unprocessed."

<div class="scenario">
The order was placed and the invoice arrived. Then it stalled — never processed, never paid. The supplier waits, the bench goes quiet, and only then does anyone notice.
<span class="agent">→ Unity makes the stall visible the day it happens.</span>
</div>

---

<!-- _class: diagram -->

# The cash-supplier loop, end to end.

![The cash-supplier loop](images/cash-diagram-loop.svg)

Five checkpoints between placing the order and closing the loop. Unity watches every one — and the moment a stage goes quiet, it nudges.

---

<!-- _class: shot -->

# <span class="num">1.</span> Set an expected date when you place the order.

![Create Purchase Order with an Expected delivery field](images/cash-shot-po-eta.png)

A new **Expected delivery** field sits beside Order Date — prefilled from the supplier's lead time, fully editable. Every order now carries a date Unity can watch.

---

<!-- _class: shot -->

# <span class="num">2.</span> Mark a cash supplier once.

![Add Supplier form with a Payment Type field](images/cash-shot-supplier.png)

On the supplier, set **Payment Type** to *Cash* or *Account*. Cash suppliers flow into the payment watch automatically; everything defaults to Account, so nothing changes until you choose.

---

![bg right:50%](images/cash-shot-finance.png)

> ## <span style="color:#E8A249">3.</span> Every pending payment, on one screen.

<div class="scenario">
The new <strong>Finance → Pending supplier payments</strong> board groups cash orders by state — <em>Awaiting invoice</em>, <em>Awaiting payment</em>, <em>Awaiting POP</em> — with the supplier, amount, and how many days it has been waiting.
<span class="agent">→ The whole queue, at a glance. Nothing hides in an inbox.</span>
</div>

---

![bg right:50%](images/cash-03-cash-purchase.png)

> ## "The invoice is in — but is it actually moving?"

<div class="scenario">
The moment a cash order is placed, Unity knows an invoice is due and starts the clock — then watches that it's received, <strong>processed</strong>, and paid. If any step stalls, it speaks up — quietly at first, then louder.
<span class="agent">→ Received. Processed. Paid. Nothing skipped.</span>
</div>

---

![bg right:50%](images/cash-06-handoff.png)

> ## "First the buyer. Then accounts. Then the daily brief."

<div class="scenario">
A stalled invoice doesn't sit in silence. It moves up — a nudge to the buyer who placed it, then to accounts, then onto the morning brief — until the loop is closed.
<span class="agent">→ They notice. They push. They escalate.</span>
</div>

---

![bg right:50%](images/cash-05-accounts-desk.png)

> ## "Pay, sign off, and drop the proof on the order — done."

<div class="scenario">
Accounts records the payment, signs it off, and attaches the proof of payment straight onto the order. The supplier is told, from inside Unity — and the loop closes.
<span class="agent">→ Owed. Paid. Signed off. Sent.</span>
</div>

---

<!-- _class: status -->

# Where we are.

<div class="cols">
<div class="col live">

### Working now
- **Cash / Account** flag on every supplier
- **Expected delivery** captured at order time, with overdue flags on the order list
- **Finance board** — every cash order grouped by payment state

</div>
<div class="col">

### Rolling out next
- Mark an invoice **received → processed → paid → signed off**, with a full audit trail
- **Drag-and-drop** proof of payment onto an order
- **Escalating reminders** — buyer → accounts → daily brief
- Send proof of payment by email from inside Unity

</div>
</div>

---

![bg right:50%](images/cash-07-resolved.png)

> ## "Everything present. The team starts on time."

<div class="scenario">
When the paperwork keeps pace with the order, the bench is never waiting on a missing box — and the cause is never a forgotten or unprocessed invoice.
<span class="agent">→ Nothing waiting. Nothing forgotten.</span>
</div>

---

<!-- _class: cover -->

# Polygon

*Unity ERP is the spine. AI agents are the nervous system.*
*Made for manufacturers who want their factory to stay tight.*
