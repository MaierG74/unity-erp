---
name: polygon-pitch-pamphlet
description: Use when building a Polygon sales document — pitch advert, capability pamphlet, product brochure, or any image-and-quote-led PDF in the spine+nervous-system visual brand. Triggers include "build a pitch pamphlet for [prospect]", "make an advert for [agent name]", revising/extending the existing Tight Factories advert or Purchasing Agent pamphlet, or porting the same pattern to a new agent (Inter-Site Transfer Agent, Daily Brief Agent, etc.).
---

# Polygon Pitch Pamphlet

> **Status:** v1, captures the production pattern shipped on 2026-05-07 (Agent Overview + Purchasing Agent PDFs). Refine on next real use.

## Overview

Polygon's pitch documents are **image-and-quote-led PDFs in a tight visual language** — spine+nervous-system metaphor, charcoal/amber/cyan palette, calm declarative voice, ≤30-word captions. Two existing exemplars are the canonical reference; this skill captures the pattern so the next pamphlet starts at "swap content" not "design from scratch."

**Reference exemplars (read these before authoring anything new):**
- `docs/pitch/output/Agent Overview.pdf` — emotional pitch, 10 spreads, dusk-cinematic imagery, no pricing
- `docs/pitch/output/Purchasing Agent.pdf` — capability deep-dive, 11 spreads, daylight-modern imagery, includes pricing
- `docs/pitch/nervous-system-positioning.md` — internal strategy doc; never share with clients but use as voice anchor
- `docs/pitch/nervous-system-advert.marp.md` and `nervous-system-pamphlet.marp.md` — the rendering sources

## When to use

- **Build a new pamphlet** for a different prospect (same brand, swap specifics)
- **Add a new agent** to the catalogue (Inter-Site Transfer, Daily Brief, etc.) — extend the killer-app spread pattern
- **Revise an existing deck** — page-by-page edits to the marp files
- **Port to a new industry** — keep the pattern, regenerate images with industry-appropriate prompts

**Do NOT use for:** completely different brand identities, non-Polygon sales material, anything requiring print-shop-grade design (use Figma/Pages with a designer for that).

## Document types

| Type | Use when | Length | Pricing? | Image register |
|---|---|---|---|---|
| **Advert (overview)** | Emotional pitch, broad qualification | 8–10 spreads | No (overview only) | Dusk-cinematic |
| **Pamphlet (capability)** | Deep-dive on a specific agent / nerve | 9–12 spreads | Yes (closes the offer) | Daylight-modern |

Send both together — advert as the opener, pamphlet as the detail. Different visual registers (dusk vs. daylight) make them feel like a deliberate pair.

## Visual language

| | Hex | Use |
|---|---|---|
| Charcoal background | `#0E141C` | Default slide bg |
| Cream body text | `#F5F0E6` | Body, h2 in quote blockquotes |
| Amber accent | `#E8A249` | Headings, agent action lines, **bold** highlights |
| Cyan signal | `#7FE4F5` (advert) / `#00C8FF` (pamphlet) | Pull-quote rule, source attribution, in-image signal trails |
| Subdued cream | `#BFB8AA` | Captions on quote-only spreads |

Typography: **Helvetica Neue / Inter / system-ui**. H1 60px (or 96–120px on cover/back-cover). H2 44px (typically inside a blockquote for the pull-quote treatment). Body 22–24px. Caption 18–20px. Letter-spacing slightly tight on headings.

## Image-prompt style blocks (paste verbatim into Codex/etc.)

**Two registers.** Use the dusk-cinematic register for the *advert* (emotional pitch). Use the daylight-modern register for the *pamphlet* (capability detail). They're deliberately different so the two PDFs feel like a matched pair.

### Dusk-cinematic (for the advert)

```
Style: cinematic dusk photography of a working furniture factory floor —
warm-lit, slightly analog and nostalgic. Palette: deep charcoal-blue
ambient (#0E141C), warm amber from sodium and incandescent work-lights
(#E8A249), pale cyan signal trails (#7FE4F5) that read like long-exposure
light traces — soft, glowing, never laser-sharp. Generous negative space.
No on-screen text, no UI graphics, no logos, no brand names. People
appear quiet, focused, mid-task — never posed or staged. Real wood, real
steel, real fabric. Subtle film grain. Mood: calm, late-shift, confident,
the room is paying attention.
```

### Daylight-modern (for the pamphlet)

```
Style: clean modern industrial product photography. Bright overcast
daylight, soft diffuse shadows — no dusk, no warm-amber atmosphere.
Palette: warm off-white concrete (#E8E1D5), light natural wood
(#C9B79A), brushed steel and aluminium (#9DA5AB), crisp digital cyan
(#00C8FF) for signal trails — sharper and more confident than the
dusk-cinematic version. A single warm amber accent (#E8A249) only as
a controlled highlight, not ambient. Minimal grain, modern editorial
photography quality. No on-screen text, no UI graphics, no logos, no
readable signage. People appear focused, mid-task, in clean modern
workwear (denim apron, neutral t-shirt) — never posed. Real materials:
oak, steel, melamine, fabric. Composition: clean lines, generous
negative space, slightly elevated camera angle. Mood: bright, capable,
calm — a workshop where things are running well.
```

**Always paste the style block FIRST**, then the scene description. Marp images live and die by consistency, and the style block is what guarantees it across multiple generations.

## Spread types (the Marp template library)

| Spread | Use for | Marp pattern |
|---|---|---|
| **Cover** | Document title + tagline | `<!-- _class: cover -->` + `![bg brightness:0.45](image.png)` (brightness filter for legibility on bright images) + `# Title` + `*subtitle*` |
| **Quote-only** | Setup spreads (e.g. "four questions"), pivots, honest positioning | `<!-- _class: quote-only -->` + `# Big quote` + body paragraph |
| **Image-right + quote-left** | Killer-app spreads (named scenarios) | `![bg right:50%](image.png)` + `> ## "Quote"` + scenario block with amber `→` action line |
| **Flow-chart** | Mid-deck mental-map spread | `<!-- _class: flow -->` + `# Heading` + `![](image.png)` + caption (CSS class controls image height — image **must** be referenced via markdown syntax, not HTML img — Marp strips inline `<img>` styles) |
| **Diptych** | "Before/after" or "with/without" full-bleed | `<!-- _class: diptych -->` + `![bg](image.png)` + `## Centred quote` |
| **Pricing** | Closes the offer (pamphlet only — not advert) | `<!-- _class: quote-only -->` + `# R[N] per week` + `**bold amber tagline**` + small terms line |
| **Back cover** | Brand close | `<!-- _class: cover -->` + `# Polygon` + `*Unity ERP is the spine. AI agents are the nervous system.*` + tagline |

The full CSS for these classes lives at the top of `nervous-system-pamphlet.marp.md` and `nervous-system-advert.marp.md` — copy the `style: |` block from there as the starting point.

## Voice guidelines

- **Captions ≤30 words.** Tight. Senior reader scans in 5 seconds.
- **Three-beat agent action lines.** "Pattern caught. Source traced. Loss stopped." Amber, prefixed with `→`. Inside a `<div class="scenario">` with `<span class="agent">`.
- **Declarative, not narrative.** "At 5:30 a.m., your agent scans..." not "What if your agent could scan..."
- **"Your agent," not "our agent" or "Matt."** Reader-ownership in the body. Matt only on internal-strategy docs.
- **"AI agents" explicitly.** Don't say just "agents" without naming the AI — the reader needs to know what they're being sold.
- **No jargon.** "AI models" not "models." "Cancel anytime" not "30 days notice." "Knowledge work" rather than "white-collar."
- **Considered messaging.** See `docs/pitch/nervous-system-positioning.md` — silent by default, no spamming, pattern echoes between spreads (e.g., the four-verb "they notice, they push, they escalate, they close" appears in three places).

## File organisation

```
docs/pitch/
├── nervous-system-positioning.md          # internal strategy, never client-facing
├── nervous-system-advert.md               # canonical script (with HTML-comment archive of cut spreads)
├── nervous-system-advert.marp.md          # rendering source for the advert
├── nervous-system-pamphlet.marp.md        # rendering source for the pamphlet
├── images/
│   ├── 01..08-*.png                       # advert images (dusk-cinematic)
│   └── 11..18-pamphlet-*.png              # pamphlet images (daylight-modern)
└── output/
    ├── Agent Overview.pdf                 # client-facing rendered advert
    └── Purchasing Agent.pdf               # client-facing rendered pamphlet
```

**Naming convention** — internal source files use long descriptive names (`nervous-system-*.marp.md`). Output PDFs use short client-facing names (`Agent Overview.pdf`, `Purchasing Agent.pdf`).

## Render workflow

```bash
# Install once (already done):
npm i -g @marp-team/marp-cli

# Re-render after edits:
cd ~/developer/unity-erp

marp docs/pitch/nervous-system-advert.marp.md \
  --pdf --allow-local-files \
  --output "docs/pitch/output/Agent Overview.pdf"

marp docs/pitch/nervous-system-pamphlet.marp.md \
  --pdf --allow-local-files \
  --output "docs/pitch/output/Purchasing Agent.pdf"
```

## Marp gotchas (these will bite if you don't know them)

| Gotcha | Symptom | Fix |
|---|---|---|
| **Marp strips inline `style=` on `<img>`** | Image renders at unintended size despite explicit `style="max-height:380px"` | Use a CSS class on a parent section (`<!-- _class: flow -->`) and target `section.flow img { max-height: 360px; ... }` in the `style: |` block. CSS classes survive; inline styles don't. |
| **`---` inside an HTML `<!--` comment block is still parsed as a slide separator** | Hidden content creates blank slides | Either remove the `---` from inside the comment, or restructure so the comment doesn't span a separator. |
| **Cover image too bright; title illegible** | Daylit/bright bg images wash out heading text | Apply Marp's image-filter directive: `![bg brightness:0.45](image.png)`. Native to Marp, no CSS needed. |
| **Portrait images on landscape slides crop or distort** | Subject of image off-frame | Use `![bg right:40% fit](image.png)` — the `fit` modifier preserves aspect and contains within the bounding box. |
| **CSS pseudo-element overlays don't reach `![bg]` images** | `section::after` darkening doesn't appear in PDF | `![bg]` images live in a separate stacking context outside the section. Use Marp's filter directives (`brightness`, `blur`, `opacity`) on the bg image directly instead. |

## Recipes

### Recipe: build a pamphlet for a new prospect

1. Copy `docs/pitch/nervous-system-pamphlet.marp.md` → new file with the prospect's slug
2. Read the prospect's notes; identify their specific pain points (e.g. inter-site transfer for two-factory client; quality reject capture for upholstery-heavy client)
3. Swap the four killer-app spreads for the agent(s) you're actually selling them. Keep the structural template; only swap the quotes, captions, and image references
4. Update pricing on page 9 if different from R600/wk
5. Render. View. Iterate page by page (the proven workflow is: render → look → tweak one thing → re-render)

### Recipe: add a new agent

When extending the catalogue with a new Matt-style agent (Inter-Site Transfer, Production Exception Triage, Daily Control-Tower Brief, etc.):

1. Add a killer-app spread following the proven pattern: `![bg right:50%]` + `> ## "Big quote — usually a concrete operational moment"` + scenario block with `→` action line
2. Voice anchor: the action line should be three crisp beats matching "Pattern caught. Source traced. Loss stopped." rhythm
3. Generate a new image using the daylight-modern style block + a scene description specific to that agent's domain
4. Update the four-questions spread on page 2 if the new agent surfaces a question the others don't
5. If selling the new agent as a separate tier (R[N]/wk), update pricing page

### Recipe: port to a new industry

The pattern is industry-agnostic; only the imagery changes:

1. Keep the structural template, voice, palette, type
2. Adjust the style blocks: swap "furniture factory" / "oak boards" / "upholstery" for the target industry's materials and settings (e.g. "metal fabrication shop, mild-steel sheet stock, welding station")
3. Regenerate all images using the adjusted prompts
4. Adjust the named scenarios in the killer-app spreads to industry-specific examples (PO Q26-779 was due Tuesday → spec-out a real example for the target industry)
5. Keep the spine+nervous-system metaphor — that's brand, not industry

## Common mistakes

- **Naming Matt in the body.** Matt is brand-internal. Body uses "your agent." Matt appears only in the back-cover brand line ("Matt-style agents") and in internal strategy docs.
- **Adding pricing to the advert.** The advert is overview-only; pricing is what closes the pamphlet. Don't conflate.
- **Hyphens in job IDs causing line breaks.** "Job J-401" wraps awkwardly across lines. Drop the hyphen → "Job J401". Keep PO numbers (Q26-779) since the year-prefix dash is a real convention.
- **Repeating the same image twice in the same deck.** Acceptable for v1 if generating new images is blocking, but flag it. Different scenarios deserve different images for full-quality output.
- **Verbose captions.** ≤30 words. If your caption is longer, you're doing too much on one spread.
- **Generic image gen without the style block.** The first prompt always pastes the style block. Skipping it produces inconsistent visual register across the deck.

## Red flags — STOP and reconsider

- "Just a quick generic pitch deck" → Use this skill or you'll dilute the brand
- "Let's add 5 more pages of detail" → Tight is the brand; if you need detail, write a separate doc
- "Let me just inline-style this image" → Marp strips inline styles. Use a CSS class.
- "We can skip the style block on this one prompt" → Cross-image consistency dies. Always paste the style block.

## Testing methodology (for future refinement)

This is v1 — captured from a single production run on 2026-05-07. Genuine TDD-for-skills testing should happen on the next real use:

1. **Baseline (RED)** — dispatch a subagent: "build a Polygon-branded pamphlet for [new prospect] with [specific brief]" with NO skill loaded. Document what they produce.
2. **With skill (GREEN)** — same prompt, this skill loaded. Compare outputs. The skill should close the gaps you observed.
3. **Refactor** — capture rationalisations and brand-drift symptoms in this skill's "common mistakes" / "red flags" sections.

Until then, treat this as a strong reference, not a bulletproof discipline skill.

## References

- Reference exemplars: `docs/pitch/output/Agent Overview.pdf`, `docs/pitch/output/Purchasing Agent.pdf`
- Source files: `docs/pitch/nervous-system-{advert,pamphlet}.marp.md`
- Strategy: `docs/pitch/nervous-system-positioning.md` (internal only)
- Linear: POL-100 (closure engine, dependency for everything pitched here), POL-101–104 (the four pilot agents)
- Memory anchor: `project_openclaw_agents.md` for the OpenClaw / Matt context the agents run on
