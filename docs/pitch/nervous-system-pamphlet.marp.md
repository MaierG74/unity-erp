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
  h3 {
    color: #E8A249;
    font-weight: 600;
    font-size: 28px;
    margin: 0 0 12px 0;
  }
  p { font-size: 24px; }
  blockquote {
    border-left: 4px solid #7FE4F5;
    padding: 8px 0 8px 28px;
    margin: 0 0 28px 0;
    background: transparent;
  }
  blockquote p { margin: 0; }
  blockquote h1, blockquote h2 {
    color: #F5F0E6;
    margin: 0 0 12px 0;
  }
  blockquote em {
    display: block;
    color: #7FE4F5;
    font-size: 20px;
    font-style: italic;
    margin-top: 16px;
    font-weight: 400;
  }
  em { color: #7FE4F5; font-style: italic; }
  strong { color: #E8A249; font-weight: 600; }
  a { color: #7FE4F5; text-decoration: none; }
  ul { font-size: 22px; line-height: 1.7; }
  /* Cover */
  section.cover {
    text-align: center;
    justify-content: center;
  }
  section.cover h1 {
    font-size: 96px;
    color: #F5F0E6;
    margin-bottom: 16px;
    letter-spacing: -0.03em;
  }
  section.cover p {
    color: #E8A249;
    font-size: 28px;
    font-style: italic;
    font-weight: 300;
  }
  /* Cover image darkening is handled by the Marp directive
     `brightness:0.45` on the ![bg] image itself — the pseudo-element
     approach didn't work because Marp renders bg images in a separate
     stacking layer that CSS overlays can't reach. */
  /* Flow-chart slide layout — image height-capped, caption centred. */
  section.flow {
    padding: 60px 96px 60px 96px;
  }
  section.flow h1 {
    font-size: 52px;
    margin-bottom: 12px;
  }
  section.flow img {
    max-height: 360px;
    width: auto;
    display: block;
    margin: 18px auto 22px auto;
    border-radius: 8px;
  }
  section.flow p {
    text-align: center;
    color: #BFB8AA;
    font-size: 22px;
    max-width: 900px;
    margin: 0 auto;
  }
  /* Quote-only typography slide (no image) */
  section.quote-only {
    text-align: center;
    justify-content: center;
    padding: 140px 120px;
  }
  section.quote-only h1 {
    color: #F5F0E6;
    font-size: 56px;
    font-weight: 600;
    line-height: 1.2;
    max-width: 1100px;
    margin: 0 auto 48px auto;
  }
  section.quote-only p {
    color: #BFB8AA;
    font-size: 22px;
    max-width: 800px;
    margin: 0 auto;
  }
  /* Killer-app spread: scenario block */
  .scenario {
    border-left: 4px solid #7FE4F5;
    padding: 12px 24px;
    margin: 24px 0 0 0;
    font-size: 22px;
    line-height: 1.5;
    color: #F5F0E6;
  }
  .scenario .agent {
    color: #E8A249;
    font-weight: 600;
    display: block;
    margin-top: 14px;
    font-size: 20px;
  }
---

<!-- _class: cover -->

![bg brightness:0.45](images/11-pamphlet-hero.png)

# The Purchasing Agent

*What your AI agent actually does, hour by hour.*

---

<!-- _class: quote-only -->

# Four questions your agent watches every day.

Which customer orders won't ship — because we haven't placed the POs yet?

Which POs are running late — and what jobs do they put at risk?

Which deliveries arrived but don't match what we ordered?

Where is stock quietly disappearing?

---

<!-- _class: flow -->

# The cycle, end-to-end.

![Purchasing cycle flow](images/17-pamphlet-flow.png)

Five stages. Five points where things slip without notice. Five points your agent watches.

---

![bg right:50%](images/12-pamphlet-orders.png)

> ## "Three customer orders won't ship next week unless POs go out today."

<div class="scenario">
At 5:30 a.m., your agent scans every open customer order against the BOM, current stock, and supplier lead times.
<span class="agent">→ Three orders are short. Drafts ready. Waiting for your nod on the buyer's screen.</span>
</div>

---

![bg right:50%](images/13-pamphlet-overdue-pos.png)

> ## "PO Q26-779 was due Tuesday. Job J401 slips Friday unless it lands."

<div class="scenario">
Your agent tracks every open PO against its expected delivery and the jobs that depend on it.
<span class="agent">→ Eight days overdue. Supplier chased twice. Manufacturing impact already on tomorrow's brief.</span>
</div>

---

![bg right:50%](images/14-pamphlet-delivery-match.png)

> ## "Four oak boards arrived. None of them made it onto a goods-received note."

<div class="scenario">
A delivery note photograph arrives via Telegram. Your agent reads it, matches each line to the open PO, books receipts on clean lines, opens exceptions on the rest.
<span class="agent">→ Short deliveries. Incorrect captures. Surfaced before components disappear into WIP.</span>
</div>

---

![bg right:50%](images/15-pamphlet-inventory.png)

> ## "Twenty-four boards expected. Eighteen counted. Pattern points to over-issue on J389."

<div class="scenario">
Your agent watches stock counts photographed via Telegram, compares them to the system, and watches for drift over weeks.
<span class="agent">→ Pattern caught. Source traced. Loss stopped.</span>
</div>

---

![bg right:55%](images/16-pamphlet-phone.png)

> ## All of this happens on your phone first.

The dashboard is the recap. Telegram is the conversation.

Photos in. Voice notes in. Status updates out. Wherever your team is — store window, supplier site, shop floor — the agent meets them there.

---

![bg right:40% fit](images/18-pamphlet-evolving.png)

> ## A constantly evolving, constantly improving agent.

Your agent learns your factory. The underlying AI grows in intelligence and capability. Both compound — every week, every month, every year.

---

<!-- _class: quote-only -->

# R600 per week

**Never sleeps. Never absent. Always on. Always working for you.**

No setup fee. Month-to-month. Cancel anytime.

---

<!-- _class: cover -->

# Polygon

*Unity ERP is the spine. AI agents are the nervous system.*
*Made for manufacturers who want their factory to stay tight.*

*[Contact details]*
