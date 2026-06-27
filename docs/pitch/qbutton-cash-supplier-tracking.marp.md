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
  h1 {
    color: #E8A249;
    font-weight: 700;
    font-size: 60px;
    line-height: 1.1;
    margin: 0 0 20px 0;
    letter-spacing: -0.02em;
  }
  h2 {
    color: #F5F0E6;
    font-weight: 600;
    font-size: 44px;
    line-height: 1.2;
    margin: 0 0 24px 0;
    letter-spacing: -0.01em;
  }
  h3 { color: #E8A249; font-weight: 600; font-size: 28px; margin: 0 0 12px 0; }
  p { font-size: 24px; }
  blockquote {
    border-left: 4px solid #7FE4F5;
    padding: 8px 0 8px 28px;
    margin: 0 0 28px 0;
    background: transparent;
  }
  blockquote p { margin: 0; }
  blockquote h1, blockquote h2 { color: #F5F0E6; margin: 0 0 12px 0; }
  blockquote em {
    display: block; color: #7FE4F5; font-size: 20px;
    font-style: italic; margin-top: 16px; font-weight: 400;
  }
  em { color: #7FE4F5; font-style: italic; }
  strong { color: #E8A249; font-weight: 600; }
  a { color: #7FE4F5; text-decoration: none; }
  ul { font-size: 22px; line-height: 1.7; }
  /* Cover */
  section.cover { text-align: center; justify-content: center; }
  section.cover h1 {
    font-size: 96px; color: #F5F0E6; margin-bottom: 16px; letter-spacing: -0.03em;
  }
  section.cover p { color: #E8A249; font-size: 28px; font-style: italic; font-weight: 300; }
  /* Flow-chart slide */
  section.flow { padding: 60px 96px 60px 96px; }
  section.flow h1 { font-size: 52px; margin-bottom: 12px; }
  section.flow img {
    max-height: 380px; width: auto; display: block;
    margin: 16px auto 20px auto; border-radius: 8px;
  }
  section.flow p { text-align: center; color: #BFB8AA; font-size: 22px; max-width: 980px; margin: 0 auto; }
  /* Quote-only typography slide */
  section.quote-only { text-align: center; justify-content: center; padding: 140px 120px; }
  section.quote-only h1 {
    color: #F5F0E6; font-size: 56px; font-weight: 600; line-height: 1.2;
    max-width: 1100px; margin: 0 auto 48px auto;
  }
  section.quote-only p { color: #BFB8AA; font-size: 22px; max-width: 820px; margin: 0 auto; }
  /* Killer-app spread: scenario block */
  .scenario {
    border-left: 4px solid #7FE4F5; padding: 12px 24px; margin: 24px 0 0 0;
    font-size: 22px; line-height: 1.5; color: #F5F0E6;
  }
  .scenario .agent { color: #E8A249; font-weight: 600; display: block; margin-top: 14px; font-size: 20px; }
---

<!-- _class: cover -->

![bg brightness:0.5](images/cash-01-cover.png)

# Nothing slips through.

*Cash-supplier orders, tracked end to end — from order placed to proof of payment.*

---

<!-- _class: quote-only -->

# Fifty orders in the system. You only need to forget one.

A cash supplier is paid now — but the invoice still has to arrive, reach accounts, get paid, and the proof sent back. On a busy day, one of those steps quietly doesn't happen. And nothing tells you.

---

![bg right:50%](images/cash-02-forgotten.png)

> ## "Order #7 was paid for. The invoice never came. Nobody knew until the bench went quiet."

<div class="scenario">
Everything else arrived. The team was ready. One missing item — and a day lost to a paperwork gap, not a production one.
<span class="agent">→ The forgettable, made visible.</span>
</div>

---

<!-- _class: flow -->

# The cash-supplier loop, end to end.

![The cash-supplier loop](images/cash-diagram-loop.svg)

Five checkpoints between placing the order and closing the loop. Unity now watches every one — so no single busy day can drop one.

---

![bg right:50%](images/cash-04-eta-arrival.png)

> ## "Every order gets an expected date the moment it's placed."

<div class="scenario">
No more guessing when it lands. Unity sets an expected-delivery date from the supplier's lead time as you place the order — and flags the moment a delivery runs late.
<span class="agent">→ Placed. Dated. Watched.</span>
</div>

---

![bg right:50%](images/cash-03-cash-purchase.png)

> ## "Paid cash? Unity waits for the invoice — so you don't have to remember to."

<div class="scenario">
The order is marked as a cash supplier. Unity knows an invoice is due, and starts the clock the moment the order is placed. If it doesn't arrive, it speaks up — quietly at first, then louder.
<span class="agent">→ Invoice due. Clock running. Nobody forgets.</span>
</div>

---

![bg right:50%](images/cash-06-handoff.png)

> ## "First the buyer. Then accounts. Then the daily brief."

<div class="scenario">
A stalled order doesn't sit in silence. It moves up — a nudge to the buyer who placed it, then to accounts, then onto the morning brief — until the loop is closed.
<span class="agent">→ They notice. They push. They escalate.</span>
</div>

---

![bg right:50%](images/cash-05-accounts-desk.png)

> ## "Every pending payment on one screen. Drop the proof onto the order — done."

<div class="scenario">
A new accounts view shows exactly what's owed and to whom. Accounts pays, signs off, and drags the proof of payment straight onto the order. The supplier is told, automatically, from inside Unity.
<span class="agent">→ Owed. Paid. Signed off. Sent.</span>
</div>

---

![bg right:50%](images/cash-07-resolved.png)

> ## "Everything present. The team starts on time."

<div class="scenario">
When the paperwork keeps pace with the order, the bench is never waiting on a missing box — and the cause is never a forgotten invoice.
<span class="agent">→ Nothing waiting. Nothing forgotten.</span>
</div>

---

<!-- _class: quote-only -->

# We found the gap. We're closing it.

Cash-supplier tracking is rolling into Unity now: an expected date at order time, a full invoice-and-payment trail, escalating reminders, and an accounts dashboard with one-drop proof of payment. Built so a busy day can never cost you an order again.

---

<!-- _class: cover -->

# Polygon

*Unity ERP is the spine. AI agents are the nervous system.*
*Made for manufacturers who want their factory to stay tight.*
