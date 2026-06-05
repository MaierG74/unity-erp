# Quote PDF Page-Splitting — Implemented Solution

**Date:** 2026-06-04
**Component:** [`components/quotes/QuotePDF.tsx`](../../components/quotes/QuotePDF.tsx)
**Engine:** `@react-pdf/renderer@4.3.2` / `@react-pdf/layout@4.4.2` (A4)
**Branch:** `codex/local-quote-pdf-pagination`

## Problem

On image-bearing quotes (e.g. Q138 "Upholstery Gym Benches"), the generated PDF split badly:

1. **Orphaned section header** — the "Reference Images" heading printed alone at the bottom of page 1 while its image was stranded on page 2.
2. **Silent image clip** — a line item with many/large images could exceed a page and render-and-clip behind the footer (with only a console warning).
3. **Awkward prose splits** — long Terms/Notes could strand a heading or push whole blocks around.

These were treated as one problem, not patched individually: design a robust page-splitting **doctrine** that holds in every scenario.

## Doctrine

> **Emulate "keep-with-next" structurally**: group a section header with its first content unit inside a single bounded `wrap={false}` View, and let everything breakable (prose, image grids, line-item tails) flow.

Why structural and not `minPresenceAhead`/`fixed`: both were verified against the installed engine source and rejected.
- `minPresenceAhead` is inert on 4.4.2 for the trailing-header case (`@react-pdf/layout` `index.js:1324`).
- A `fixed` node is pushed to **both** the current and next page with no content-awareness (`index.js:2580-2583`) — a `fixed` table header therefore bleeds onto reference-only / prose-only continuation pages. `fixed` is reserved for the footer alone.
- An oversized `wrap={false}` block renders-and-clips behind the footer + warns; it is **not** a clean drop (`index.js:2564, 2591`). So no `wrap={false}` block may ever be taller than the printable area (~762pt).

## Per-region rules (as implemented)

| Region | Rule |
|--------|------|
| **Page** | `paddingBottom: 50` reserves space for the `fixed` footer at `bottom: 20`. Unchanged. |
| **Spacing** | No trailing `marginBottom` on flow containers; spacing comes from the *following* element's `marginTop` — **except** never put `marginTop` on a top-level `wrap={false}` atom (it inflates the measured bottom and pushes the block early). The table→totals gap is a breakable `<View style={{height:20}}/>` spacer, not `totalsSection.marginTop`. |
| **Line-items table** | Single column header on page 1. Each **priced** item: only `[image row + name/qty/price row]` is atomic (`wrap={false}`); surcharge rows and the bullet block flow as breakable siblings. The image row spans **full width** (not the narrow description column) so large images wrap 2-up instead of stacking and overflowing. Per-item image **soft cap = 6**. |
| **Heading / note items** | Only the title / first text line is atomic; images + bullets flow. Never wrap the whole item (was unbounded → clip). |
| **Reference Images** | Single container, JS row-chunked into `REF_COLS` (= 3 on A4) cells per row. Each visual **row** is atomic (`wrap={false}`) so a cell is never orphaned across a page; the section title is welded **inside the first row** so it can never print alone — this fixes the Q138 orphaned-header bug. |
| **Notes** | Container is **not** `wrap={false}` (prose flows). `renderHtmlToPdf` emits one `<Text>` per `<p>` and passes `orphans/widows` as **props** (the engine reads these from node props, not style). The "Notes:" label is welded to the first block only when that block is short (< ~280 chars), else it sits above freely-flowing prose. |
| **Terms** | Body flows. Short terms (≤ 6 lines, < 400 chars — covers the default) render as **one** uniform block (no odd inter-line gap). Long terms weld the title to the first 3 lines and flow the rest with `orphans/widows`. Split on **newline only**, never on `.`. |
| **Totals** | `wrap={false}` (atomic, ~60pt). No `marginTop` (see Spacing). Moves as a unit; never splits. |
| **Footer** | The only `fixed` node. |

## Deliberate deviations from the design spec

1. **Single table header, not a repeated per-page header.** The spec proposed JS-chunking items into fixed-size groups and re-emitting the header per chunk. Verified by rendering: fixed-count chunks don't align to page boundaries, so the black header bar appears **mid-page** between chunks (or, with `break`, wastes a page). A 40-item render confirmed that a single header with consistent (fixed-flex) column widths reads cleanly on continuation pages — the modern-SaaS norm. Repeated headers are **decision point #3** if Greg wants them, with the trade-off noted.
2. **Priced image row is full-width.** The spec's image-cap math assumed images span the full 535pt width, but in priced items they were confined to the ~255pt description column, so 6 large images stacked 1-up = ~900pt and still clipped. Making the (data-free) image row full-width yields 2-up wrapping = ~456pt, bounded.
3. **No height-gated heading keep-with-next weld (yet).** Headings are bounded (title atomic) and not stranded in the common case; the cross-item weld adds index-skip complexity and is deferred.

## Decision points (shipped at the recommended default)

1. **Lone reference image — enlarge or keep uniform 150×100?** Default **keep uniform**.
2. **Long Terms — force own page or flow?** Default **flow** (the welds already remove the awkward split).
3. **Repeat the column header on every page?** Default **no** (single header; see deviation #1).
4. **Over-cap item images — silent cap or editor warning?** Default **6-image cap** (a non-blocking editor warning is a separate, out-of-scope change).
5. **Page-2+ company header band?** Default **none**.
6. **`QuotePDFDownload` static → lazy import** of `@react-pdf/renderer` — separate ticket (changes the bundle graph; not a pagination concern).

## Cleanup

`components/quotes/QuotePDFDocument.tsx` (a dead duplicate with zero importers — the live default export lives in `QuotePDF.tsx`) was **deleted** in this change to prevent future drift.

## Verification

Rendered the `QuotePDFDocument` to PDF in Node (`renderToFile`) across 10 stress scenarios and inspected every page. No `can't wrap between pages` warning on any scenario.

| # | Scenario | Result |
|---|----------|--------|
| S1 | Tiny (2 items, default terms) | 1 page, terms as one uniform block, no phantom page |
| S2 | **Q138** (3 items + thumbnails + 1 reference image) | Reference header **welded to its image** — orphan fixed |
| S3 | 20 items | Header on page 1, clean |
| S3b | 40 items (multi-page table) | Page 2 continues table, columns aligned, no artifacts |
| S4 | 1 item, 6 large images + long bullets | **Renders fully, no clip**; images 2-up, bullets flow |
| S5 | 10 reference images | Uniform **3-up grid**, header welded, last row whole |
| S6 | 1 oversized reference image | 1 page, header + image together |
| S7 | Long Notes + long Terms | Both split cleanly; no stranded heading; no header bleed |
| S8 | heading/note/priced interleaved | Headings bounded; totals exclude non-priced; clean |
| S9 | Totals at page boundary | Totals move atomically, not split |

`npx tsc --noEmit` clean for the file; `eslint` 0 errors (5 pre-existing `jsx-a11y/alt-text` warnings on react-pdf `<Image>`, which has no `alt` concept).
