# Mobile Job Card Scan — Resume Notes

## What We Built

Mobile-optimized job card scan page (`/scan/jc/[id]`) that factory managers use when scanning QR codes on printed job cards from their phones.

## Features (all complete)

### 1. Authentication Gate
- Inline mobile login form (lazy-loaded) — no redirect to desktop login
- Route stays in `publicPatternRoutes`; `useAuth()` re-renders after login
- Session persists via Supabase `persistSession` + `autoRefreshToken`

### 2. Mobile Padding / Safe Area
- `app/layout.tsx` — `viewportFit: 'cover'` viewport export
- Scan page uses `px-8` (32px) to avoid iPhone edge clipping

### 3. Clickable Order Link (header)
- Tappable order number fetches `order_attachments` where `document_type = 'customer_order'`
- 1 doc → opens PDF in new tab; multiple → bottom-sheet picker; none → toast error

### 4. "Scan Another Job Card" Button
- Three-tier QR decoding: native `BarcodeDetector` → `jsQR` fallback → file input capture
- Two-effect camera architecture to avoid race condition (stream acquired in effect 1, connected to `<video>` in effect 2)
- Live camera with viewfinder on HTTPS; file input fallback on HTTP
- `BarcodeDetector` reused (not recreated per frame); auto-falls back to jsQR after ~60 consecutive failures
- Tested on iOS Safari (Netlify HTTPS) — camera opens instantly

### 5. Atomic Job Completion (RPC)
- `complete_job_card` PL/pgSQL function wraps all updates in a single transaction
- `SECURITY INVOKER` with org membership check via parent order's `org_id`
- Handles job cards without a linked order (LEFT JOIN, conditional org check)
- `EXECUTE` revoked from `anon`/`public`, granted only to `authenticated`

### 6. Clickable Order in Tooltip (Labor Planning Board)
- `staff-lane-list.tsx` — order number in tooltip is an `<a>` link to `/orders/[orderId]`

### 7. Playground
- `playground-job-card-mobile.html` — design tool, not part of the app

## Key Files

| File | Changes |
|------|---------|
| `app/scan/jc/[id]/page.tsx` | Auth gate, order link, QR scanner, document picker, RPC completion |
| `components/features/scan/mobile-scan-login.tsx` | Mobile login form |
| `components/labor-planning/staff-lane-list.tsx` | Clickable order link in tooltip |
| `app/layout.tsx` | Viewport export with `viewportFit: 'cover'` |
| `supabase/migrations/20260224154904_complete_job_card_rpc.sql` | Original RPC (superseded) |
| `supabase/migrations/20260224200123_complete_job_card_rpc_secure.sql` | Secure RPC with org check |

## Remaining Small Items
- Test the **order link tap** on phone (scanner tested, order link not yet)
- Supabase auth token lifetime — optionally tighten to ~3 days in dashboard (no code change)

## Labor Planning Board — Outstanding Enhancement
- #5: Unscheduled job count badge — currently only in zoom controls bar. Could be made more prominent on week strip or as floating badge.
