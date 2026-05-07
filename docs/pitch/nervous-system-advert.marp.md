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
  ul { font-size: 24px; line-height: 1.7; }
  /* Four-nerves grid (custom HTML layout) */
  .nerves-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 28px;
    margin-top: 24px;
  }
  .nerve {
    display: flex;
    gap: 20px;
    align-items: flex-start;
    background: rgba(255,255,255,0.03);
    border-left: 3px solid #7FE4F5;
    padding: 18px;
    border-radius: 6px;
  }
  .nerve img {
    width: 140px;
    height: 90px;
    object-fit: cover;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .nerve .text { font-size: 16px; line-height: 1.4; color: #F5F0E6; }
  .nerve .text strong { color: #E8A249; display: block; font-size: 18px; margin-bottom: 6px; }
  .nerves-grid + .footnote { font-size: 16px; color: #BFB8AA; margin-top: 24px; }
  /* Cover */
  section.cover {
    text-align: center;
    justify-content: center;
  }
  section.cover h1 {
    font-size: 120px;
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
  section.cover::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(14,20,28,0.25) 0%, rgba(14,20,28,0.75) 100%);
    z-index: -1;
  }
  /* Pure-quote typography slide (no image) */
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
  /* Diptych slide — let the image speak */
  section.diptych h2 {
    color: #F5F0E6;
    font-size: 32px;
    line-height: 1.35;
    max-width: 800px;
    text-align: center;
    margin: 0 auto;
  }
  /* Footer mark */
  footer {
    color: #4A5260;
    font-size: 14px;
  }
---

<!-- _class: cover -->

![bg](images/01-hero-factory.png)

# Tight Factories

*Unity ERP, made for manufacturers. With agents that don't drop balls.*

---

![bg right:55%](images/02-cover-chair.png)

> ## "Small business owners lose 1.5 hours every day to wasted time."
> *— Salesforce / Slack productivity survey, 2024*

In a factory, that hour and a half is delivery notes, transfer chases, supplier emails, and the same question asked three times.

---

![bg right:55%](images/04-receiving.png)

> ## "Four oak boards arrived. None of them made it onto a goods-received note."

The supplier delivered. The receiving clerk signed. The system was never told.

Until our agent told it.

---

![bg left:55%](images/03-wont-let-go.png)

> # "Your ERP is the spine.
> # We are the nervous system."

Spines hold a factory upright. Nervous systems make it pay attention.

---

![bg right:55%](images/05-transfer.png)

> ## "AI is the lean methodology for knowledge work."
> *— Satya Nadella, Microsoft, 2026*

He said it from the cloud-software side. We built it for the workshop floor.

---

# The four nerves we install first

> ## "They notice. They push. They escalate. They close."

<div class="nerves-grid">
<div class="nerve">
  <img src="images/04-receiving.png" />
  <div class="text"><strong>Receiving & Match</strong>Photographs delivery notes, flags any line that doesn't match the open PO. Won't drop a short delivery until it's reconciled.</div>
</div>
<div class="nerve">
  <img src="images/05-transfer.png" />
  <div class="text"><strong>Inter-Building Transfer</strong>Watches every component move between bays. Flags dispatched-but-never-arrived in 30 minutes.</div>
</div>
<div class="nerve">
  <img src="images/08-exception-triage.png" />
  <div class="text"><strong>Production Exception Triage</strong>Every blocker has an owner, an age, and a status. Old blockers escalate. None rot.</div>
</div>
<div class="nerve">
  <img src="images/06-daily-brief.png" />
  <div class="text"><strong>Daily Control-Tower Brief</strong>One Telegram message every morning. Late POs, stuck transfers, blocked jobs. Read in five seconds.</div>
</div>
</div>

---

<!-- _class: diptych -->

![bg](images/07-diptych.png)

## "The body is the same. The work is the same. The people are the same. What's different is whether anything is paying attention."

---

![bg right:55%](images/06-daily-brief.png)

> ## "The list always shrinks day-over-day, or someone gets called."

Late POs. Stuck transfers. Blocked jobs. Payroll anomalies. Customer orders past their internal ETA.

Five seconds to read. Five seconds to know.

---

<!-- _class: quote-only -->

# "We don't replace what you already have. We make it watch over itself."

We're not as broad as Epicor. Not as deep on furniture engineering as imos. Not a generic AI copilot you can ask anything. We do one thing: we make the factory you already have **noticeably tighter**.

---

![bg right:35%](images/02-cover-chair.png)

> ## "A thirty-minute call. A two-hour workshop. A ninety-day pilot."

- **Call** — to make sure there's a real fit.
- **Workshop** — on site, with the people who'll actually use it.
- **Pilot** — fixed price, ninety days, four agents live.

---

<!-- _class: quote-only -->

# Pricing

*To be drafted — Polygon to set figures.*

---

<!-- _class: cover -->

# Polygon

*Unity ERP. Matt-style agents.*
*Made for manufacturers who want their factory to stay tight.*

*[Contact details]*
