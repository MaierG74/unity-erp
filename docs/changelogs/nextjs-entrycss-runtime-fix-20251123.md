# Next.js entryCSSFiles runtime fix (2025-11-23)

## Summary
- Fixed the `TypeError: Cannot read properties of undefined (reading 'entryCSSFiles')` runtime failure that appeared on `/` after restarting `next dev`.
- Replaced the `@fontsource/inter` CSS import with the built-in `next/font/google` Inter loader so Next.js 15.1.3 can rebuild the CSS entry manifest correctly.

## Root cause
- Next.js 15.1.3 has a regression (tracked in vercel/next.js#76610) where importing package-level CSS inside `app/layout.tsx` can produce an undefined `entryCSSFiles` object when the dev server starts fresh.
- Our layout imported `"@fontsource/inter"`, which triggered the regression after reboot, causing SSR to crash before rendering.

## Changes
- Updated `app/layout.tsx` to:
  - Remove the `@fontsource/inter` import.
  - Initialize the Inter font via `next/font/google` with weights 400-700 and apply its `variable` and `className` to `<html>` and `<body>`.
- No other modules or stylesheets were touched.

## Verification
- `npm run dev` now loads `/` without throwing the `entryCSSFiles` error.
- Landing page renders the Inter font via the automatic self-hosted pipeline, so there is no UX regression.

## Follow-ups
- None required unless we see future regressions; if the upstream bug gets patched we can reconsider `@fontsource`, but the current setup is stable and preferred.
