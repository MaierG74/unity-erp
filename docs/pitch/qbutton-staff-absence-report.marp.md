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
    padding: 72px 88px;
    line-height: 1.45;
  }
  h1 { color: #E8A249; font-weight: 700; font-size: 52px; line-height: 1.1; margin: 0 0 18px 0; letter-spacing: -0.02em; }
  h2 { color: #F5F0E6; font-weight: 600; font-size: 40px; line-height: 1.2; margin: 0 0 22px 0; letter-spacing: -0.01em; }
  h3 { color: #E8A249; font-weight: 600; font-size: 26px; margin: 0 0 12px 0; }
  p  { font-size: 23px; }
  ul { font-size: 22px; line-height: 1.5; }
  li { margin-bottom: 8px; }
  em { color: #7FE4F5; font-style: italic; }
  strong { color: #E8A249; font-weight: 600; }
  code { background: #1b2733; color: #7FE4F5; padding: 1px 7px; border-radius: 5px; font-size: 0.86em; }

  /* Cover — left-weighted over the editorial illustration */
  section.cover { justify-content: center; }
  section.cover h1 { font-size: 60px; color: #F5F0E6; margin-bottom: 14px; letter-spacing: -0.03em; max-width: 46%; }
  section.cover p  { color: #E8A249; font-size: 22px; font-style: italic; font-weight: 300; max-width: 44%; }
  section.cover .tag { color: #BFB8AA; font-size: 18px; font-style: normal; letter-spacing: 1px; margin-top: 34px; max-width: 46%; }

  /* Quote-only typography slide */
  section.quote-only { text-align: center; justify-content: center; padding: 110px 120px; }
  section.quote-only h1 { color: #F5F0E6; font-size: 50px; font-weight: 600; line-height: 1.2; max-width: 1180px; margin: 0 auto 34px auto; }
  section.quote-only p  { color: #BFB8AA; font-size: 23px; max-width: 980px; margin: 0 auto 14px auto; }
  section.quote-only strong { color: #E8A249; }

  /* Diagram / full-illustration spreads */
  section.diagram { padding: 52px 70px; text-align: center; }
  section.diagram h1 { font-size: 44px; margin-bottom: 6px; }
  section.diagram img { width: 100%; max-height: 512px; height: auto; display: block; margin: 10px auto 12px auto; }
  section.diagram p { text-align: center; color: #BFB8AA; font-size: 21px; max-width: 1080px; margin: 0 auto; }

  /* Screenshot spreads */
  section.shot { padding: 40px 80px; text-align: center; }
  section.shot h1 { font-size: 40px; margin-bottom: 4px; }
  section.shot img {
    max-height: 500px; width: auto; max-width: 100%; display: block; margin: 8px auto 14px auto;
    border-radius: 10px; border: 1px solid #2a3a49; box-shadow: 0 12px 44px rgba(0,0,0,0.45);
  }
  section.shot p { text-align: center; color: #BFB8AA; font-size: 21px; max-width: 1080px; margin: 0 auto; }
  section.shot .num { color: #E8A249; font-weight: 700; }
---

<!-- _class: cover -->

![bg](images/absence/cover-open.png)

# Monthly Staff Absence Report

*Who was genuinely, unexpectedly absent — and nothing else.*

<p class="tag">PREPARED FOR QBUTTON · UNITY ERP · HOURS TRACKING</p>

---

<!-- _class: quote-only -->

# It counts the days that **actually matter** — not weekends, not public holidays, not the December shutdown.

The old report counted every calendar day with no hours as "absent," so weekends and holidays inflated the number by ~100 days a year. This report counts **working days only**.

Phase A reports **unclassified non-attendance** — it cannot yet tell approved leave from a no-show, so always reconcile before any payroll or disciplinary action.

---

<!-- _class: diagram -->

# What "working days" means

![Working days equals Monday to Friday, minus public holidays, minus company closures](images/absence/diagram-working-days.svg)

Each person gets **15 leave days a year**, taken together over the **December shutdown** — so the shutdown is excluded like a holiday, and December doesn't show everyone as "absent."

---

<!-- _class: shot -->

# <span class="num">1.</span> Open the report and set the period

![The Absence Reports tab with Report Period, Start and End dates, Staff Type and Employment-type filters](images/absence/01-run-filters.png)

Go to **Hours Tracking → Reports → Absence Reports**. Pick **Monthly** (or any range), set the **dates**, choose a **Staff Type** (Active is the default), and optionally **Employment type → Monthly** or specific staff. Then **Generate Absence Report**.

---

<!-- _class: shot -->

# <span class="num">2.</span> Read the columns

![The generated report: Working days, Present, Unclassified non-attendance, Absence rate, Public holidays and Bradford columns, with the Key above](images/absence/02-report-key-table.png)

**Working days** in the period, **Present**, **Unclassified non-attendance**, **Absence rate**, **Public holidays** excluded, and the **Bradford** pattern score. The coloured **Key** at the top explains every flag.

---

<!-- _class: diagram -->

# The Key — four things that are *not* a plain absence

![The four signals: unclassified non-attendance, timecard exception, worked a public holiday, and short time](images/absence/divider-signals.svg)

Each shows as a coloured chip when you open a row. Only **unclassified non-attendance** counts toward the absence total.

---

<!-- _class: shot -->

# <span class="num">3.</span> Open a row — the weekday chips

![An expanded staff row showing rose absence chips, a sky worked-public-holiday chip and violet short-time chips, each a weekday](images/absence/08-shorttime-chip.png)

Click the **chevron** beside a name to see exactly *which* days. Each chip is one weekday, grouped and colour-coded — so "6 absences" becomes six dates you can actually check.

---

<!-- _class: shot -->

# <span class="num">4.</span> A timecard exception? Fix it in place

![The drill-down with amber Timecard-exception chips that carry a pencil icon](images/absence/04-exception-chip.png)

An **amber** chip is an incomplete clock record (clocked in, never out) — a data issue, **not** an absence, so it's left out of the count. The pencil icon means it's clickable.

---

<!-- _class: shot -->

# <span class="num">4.</span> …the clock-edit dialog opens right there

![The Daily Hours dialog for that staff member and date, showing clock-in 07:00, no clock-out, and an Add Event button](images/absence/05-exception-dialog.png)

Clicking the chip opens the day's **clock record** — add the missing clock-out (or fix the punches), close, and the report refreshes. The exception clears once the timecard is complete.

---

<!-- _class: shot -->

# <span class="num">5.</span> Record short time

![The Short Time page: scope (whole factory or specific staff), start and end dates, a note, and the recorded entry below](images/absence/07-shorttime-recorded.png)

From the report header, open **Manage short time** (`/staff/short-time`). Choose **Whole factory** or **specific staff**, set the **dates**, add a note, and **Add Entry**. Off days in that range become **short time**, not unexplained absence; worked days still count present. *(Admin only.)*

---

<!-- _class: shot -->

# <span class="num">6.</span> Print or export

![The printable PDF: company header, period, scope, the table with coloured detail groups, and the Key](images/absence/09-pdf-output.png)

**Print / PDF** gives a clean, dated document — company, period, scope, the full table with coloured detail, and the Key — ready to file or hand over. **Export to CSV** gives the same data for a spreadsheet.

---

<!-- _class: quote-only -->

# Before you act on a number, read it correctly.

**Unclassified non-attendance** is *not* the same as an unauthorised absence — it simply means a working day with no completed timecard. Approved leave that isn't recorded yet still shows here.

Reconcile each flagged day against leave forms and short time **before** any payroll or disciplinary decision. Full leave-vs-no-show classification arrives in **Phase B**.

---

<!-- _class: cover -->

![bg](images/absence/cover-close.png)

# One number you can trust.

*Working days in, weekends and holidays out — every flag explained, every day checkable.*

<p class="tag">QBUTTON · UNITY ERP</p>
