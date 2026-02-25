---
name: mobile-qr-scanner
description: Blueprint for building mobile QR code scanning pages in Unity ERP. Use when creating any new scan page (orders, delivery notes, inventory, job cards, etc.), adding QR/barcode scanning to an existing page, or debugging camera/scanner issues on mobile devices. Covers live camera capture, QR decoding with fallbacks, auth gating, and mobile UX.
---

# Mobile QR Scanner

Build mobile-optimized scan pages that let factory staff scan QR codes on printed documents (job cards, orders, delivery notes, etc.) from their phones.

Canonical implementation: `app/scan/jc/[id]/page.tsx`

## Dependencies

- `jsqr` (npm) — JS-based QR decoder fallback (~50KB, lazy-loaded)
- `lucide-react` icons: `ScanLine`, `X`, `Loader2`, `FileImage`

## Architecture

### Three-Tier QR Decoding

Always implement all three tiers for full device coverage:

1. **Native `BarcodeDetector`** — hardware-accelerated, used on Chrome 83+ and Safari 17.2+
2. **`jsQR` via canvas** — JS fallback, lazy-loaded only when BarcodeDetector unavailable. Covers older iOS Safari, Firefox
3. **File input capture** — `<input type="file" capture="environment">` opens native camera app. Used when `getUserMedia` fails (plain HTTP, camera denied)

### Two-Effect Camera Pattern

**Critical**: Split camera setup into two separate `useEffect` hooks to avoid a race condition. A single effect that sets state and immediately reads a ref will fail because the video element hasn't mounted yet.

- **Effect 1**: Call `getUserMedia`, store stream in ref, set `useLiveCamera = true`
- **Effect 2**: Depends on `useLiveCamera` — connects stream to the now-mounted `<video>` element, starts scan loop

### Three Render States

Based on `useLiveCamera` (`null | boolean`):
- `null` — loading spinner ("Starting camera...")
- `true` — live camera feed with viewfinder overlay
- `false` — file input fallback with "Open Camera" button

### Auth Gate (no redirect)

Scan routes stay in `publicPatternRoutes`. Instead of redirecting to the desktop login, render an inline mobile login form (lazy-loaded). After login, `useAuth()` re-renders — no navigation needed.

## Building a New Scan Page

1. Create route at `app/scan/<type>/[id]/page.tsx`
2. Copy the `QrScannerOverlay` component from the canonical implementation
3. Adapt `handleResult` regex to match the new URL pattern (e.g., `/scan/order/(\d+)`)
4. Add the auth gate pattern at the top of the page component
5. Add "Scan another" button that toggles `showScanner` state
6. Ensure `app/layout.tsx` has `viewportFit: 'cover'` in viewport export

## Key Rules

- Video element **must** have `playsInline` and `muted` for iOS autoplay
- Always stop camera tracks (`stream.getTracks().forEach(t => t.stop())`) before navigating or unmounting
- Use `cancelled` flag in effects to prevent async work after unmount
- Use `px-8` minimum horizontal padding to avoid iPhone edge clipping
- `getUserMedia` requires HTTPS (except localhost) — the file input fallback covers HTTP
- Reset file input value after each capture so the same file can be re-selected

## Detailed Patterns

See [references/scanner-patterns.md](references/scanner-patterns.md) for complete code examples covering:
- Three-tier decoding implementation
- Two-effect architecture with full code
- File input fallback handler
- Scanner overlay UI markup
- Auth gating pattern
- URL parsing & navigation
- Resource cleanup
- Browser compatibility matrix
