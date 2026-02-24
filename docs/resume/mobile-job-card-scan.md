# Mobile Job Card Scan — Resume Notes

## What We're Building

Enhancing the mobile job card scan page (`/scan/jc/[id]`) that factory managers use when scanning QR codes on printed job cards. This is the page workers/managers see on their phone.

## What's Done

### 1. Authentication Gate
- **File**: `app/scan/jc/[id]/page.tsx` — added `useAuth()` check at top of component
- **File**: `components/features/scan/mobile-scan-login.tsx` — new mobile-optimized login form (lazy-loaded)
- Route stays in `publicPatternRoutes` (no redirect to desktop login), but shows inline login form when `user` is null
- After login, job card loads in place — no redirect needed
- Session persists via Supabase's `persistSession: true` + `autoRefreshToken: true`

### 2. Mobile Padding / Safe Area
- `app/layout.tsx` — added `viewport: { viewportFit: 'cover' }` export
- Scan page padding bumped to `px-8` (32px) to prevent iPhone edge clipping

### 3. Clickable Order Link (header)
- "Order #Test1133 · Qbutton" in the header is now a tappable button
- Fetches `order_attachments` where `document_type = 'customer_order'` for that order
- 1 doc → opens PDF in new tab
- Multiple docs → shows bottom-sheet picker
- No docs → toast error
- Uses `ExternalLink` icon as visual cue

### 4. "Scan Another Job Card" Button
- Appears at the bottom of every job card view (all statuses)
- Opens fullscreen camera overlay using `BarcodeDetector` API (native Safari 16.4+ / Chrome 83+)
- Scans QR, extracts `/scan/jc/[id]` path, navigates directly
- Viewfinder box + hint text + close button
- Falls back with error message if browser doesn't support BarcodeDetector

### 5. Clickable Order in Tooltip (Labor Planning Board)
- `components/labor-planning/staff-lane-list.tsx` — "Order #..." in tooltip is now an `<a>` link
- Opens `/orders/[orderId]` in new tab
- `stopPropagation` prevents triggering the job block click

### 6. Playground
- `playground-job-card-mobile.html` — interactive HTML playground for prototyping the mobile view
- Phone-sized preview (375x812) with controls for status, theme, items, progress
- Not part of the app — just a design tool

## What Needs Testing

The user hasn't tested the latest changes yet (order link, scan another button). They were viewing the Netlify deployment instead of localhost. The local dev URL is:

```
http://192.168.68.116:3000/scan/jc/8
```

(IP may change after reboot — run `ipconfig getifaddr en0` to get fresh IP)

Make sure `npm run dev` is running first.

## Key Files Modified

| File | Changes |
|------|---------|
| `app/scan/jc/[id]/page.tsx` | Auth gate, order link, scan another, document picker, QR scanner |
| `components/features/scan/mobile-scan-login.tsx` | New file — mobile login form |
| `components/labor-planning/staff-lane-list.tsx` | Clickable order link in tooltip |
| `app/layout.tsx` | Added `viewport` export with `viewportFit: 'cover'` |
| `playground-job-card-mobile.html` | New file — design playground (not part of app) |

## Supabase Note

Refresh token lifetime is currently the default (1 week). User wanted ~3 days. Can tighten in Supabase dashboard under Auth > Settings if desired. No code change needed.

## Labor Planning Board — Other Suggested Enhancements (from MEMORY.md, not yet started)

1. "Now" time indicator — vertical line showing current time
2. Staff utilization bars — thin colored bar under each staff name
3. Keyboard date navigation — left/right arrow keys
4. Multi-day / week view — condensed 5-day view
5. Unscheduled job count badge
