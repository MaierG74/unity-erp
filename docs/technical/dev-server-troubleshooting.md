# Dev Server Troubleshooting

## Production build memory pressure / machine lockups

**Date:** 2026-03-09

**Symptom:** `npm run build` spawns a large number of `node` processes during Next.js production build/static generation, swap usage balloons, and the machine can become unresponsive.

**Root cause:** Next.js 16 / Turbopack was allowed to use near-all-core build parallelism on this machine. In this repo that produced too much concurrent page-generation work and caused severe local memory pressure.

**Fast unblock (applied):**
- Cap build worker count and static generation concurrency in `next.config.mjs`:

```js
experimental: {
  cpus: 2,
  staticGenerationMaxConcurrency: 1,
}
```

**Why this helps:**
- `experimental.cpus` reduces the number of build/export workers Next starts.
- `staticGenerationMaxConcurrency` reduces how many pages each export worker renders at once.
- The build becomes slower, but it stays stable enough to complete on a local machine without exhausting memory.

**Revert / retune (if needed):**
1. Open `next.config.mjs`.
2. Increase `experimental.cpus` gradually, for example `3` or `4`, only after confirming the machine stays stable.
3. Increase `staticGenerationMaxConcurrency` gradually, for example from `1` to `2`, if build time becomes a problem.
4. Re-run `npm run build` after each change.

## Dev server PostCSS worker explosion

**Date:** 2026-03-10

**Symptom:** Requesting `/` under `next dev` with Turbopack starts hundreds of `.next/dev/build/postcss.js` worker processes, the page never finishes compiling, and the machine can run out of memory.

**Current verified state:**
- `npm run dev` stays on the normal Turbopack path.
- A clean cold start with the current branch compiles `/` and `/login` normally.
- Re-tests with the original animated landing page and the broad explicit Tailwind `@source` paths also compile normally.
- Re-using the older `.next` cache from the earlier failing session did not reproduce the runaway behavior.

**What is actually confirmed:**
- The original worker explosion was real, but it is not currently reproducible as a deterministic app-code bug on this branch.
- The earlier landing-page-only hypothesis did not hold up after full retesting.
- The only persistent, code-level stabilization that remains necessary is the worker cap in `next.config.mjs` for production builds.

**Operational guidance:**
- Keep `npm run dev` on Turbopack.
- If the PostCSS worker swarm reappears locally, clear `.next` first and restart the dev server before changing app code.
- When retesting, verify both `/` and `/login` so you can tell whether the issue is route-specific or a general dev-server failure.

**Retest command:**
1. Run `npm run dev`
2. Open `/` and `/login`
3. If the problem reappears, stop the dev server, remove `.next`, restart, and try again
4. Confirm both routes compile with `200` responses and that `.next/dev/build/postcss.js` stays around the normal 0-1 active worker path

## Inventory page build timeout (ETIMEDOUT)

**Date:** 2026-01-15

**Symptom:** `/inventory` fails to compile with a timeout when starting the Next.js dev server.

**Root cause:** `@react-pdf/renderer` pulled into the client bundle (via `ManualStockIssueTab`) brings in `jay-peg/pdfkit` which attempts a network read during build, causing `ETIMEDOUT`.

**Fast unblock (applied):**
- Remove static imports of `@react-pdf/renderer` and `ManualIssuancePDFDocument`.
- Lazy-load both modules inside the PDF handlers so the inventory page compiles without bundling PDF code up front.

```ts
const [{ pdf }, { ManualIssuancePDFDocument }] = await Promise.all([
  import('@react-pdf/renderer'),
  import('./ManualIssuancePDF'),
]);
```

**Revert (if needed):**
1. Restore static imports at the top of `ManualStockIssueTab.tsx`.
2. Remove the lazy-import block inside the PDF handlers.
3. Restart the dev server.

**Longer-term fix:**
Move PDF generation into a server-only API route (returning a PDF blob) so `@react-pdf/renderer` never enters the browser bundle.
