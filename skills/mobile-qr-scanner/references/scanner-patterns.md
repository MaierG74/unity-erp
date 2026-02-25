# QR Scanner Patterns Reference

Canonical implementation: `app/scan/jc/[id]/page.tsx`

## Table of Contents
1. [Three-Tier QR Decoding](#three-tier-qr-decoding)
2. [Live Camera — Two-Effect Architecture](#live-camera--two-effect-architecture)
3. [File Input Fallback](#file-input-fallback)
4. [Scanner Overlay UI](#scanner-overlay-ui)
5. [Auth Gating](#auth-gating)
6. [URL Parsing & Navigation](#url-parsing--navigation)
7. [Resource Cleanup](#resource-cleanup)
8. [Viewport & Safe Areas](#viewport--safe-areas)
9. [Browser Compatibility Matrix](#browser-compatibility-matrix)

---

## Three-Tier QR Decoding

Detection priority:

### Tier 1: Native BarcodeDetector (fastest, hardware-accelerated)
```typescript
if ('BarcodeDetector' in window) {
  const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
  const barcodes = await detector.detect(videoOrBitmap);
  if (barcodes.length > 0) handleResult(barcodes[0].rawValue);
}
```
Available: Chrome 83+, Safari 17.2+, Samsung Internet.

### Tier 2: jsQR via canvas (JS fallback)
```typescript
// Lazy-load only when needed
const jsQR = (await import('jsqr')).default;

const canvas = document.createElement('canvas');
canvas.width = source.videoWidth || source.width;
canvas.height = source.videoHeight || source.height;
const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
ctx.drawImage(source, 0, 0);
const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
const result = (jsQR as any)(imageData.data, canvas.width, canvas.height);
if (result?.data) handleResult(result.data);
```
`willReadFrequently: true` is a performance hint — tell the browser we'll call `getImageData` often.

### Tier 3: File input capture (HTTP / permission-denied fallback)
When `getUserMedia` fails entirely (plain HTTP, camera denied), fall back to native file input that opens the phone's camera app. See [File Input Fallback](#file-input-fallback).

---

## Live Camera — Two-Effect Architecture

**Critical pattern**: Split camera setup into two effects to avoid a race condition where `videoRef` is null because the `<video>` element hasn't mounted yet after a state change.

### Effect 1: Acquire camera stream
```typescript
const [useLiveCamera, setUseLiveCamera] = useState<boolean | null>(null);
// null = waiting, true = live camera, false = fallback

useEffect(() => {
  let cancelled = false;

  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then((stream) => {
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      setUseLiveCamera(true); // triggers re-render, <video> now mounts
    })
    .catch(() => {
      if (!cancelled) setUseLiveCamera(false);
    });

  return () => {
    cancelled = true;
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
  };
}, []);
```

### Effect 2: Connect stream to video element (runs after re-render)
```typescript
useEffect(() => {
  if (!useLiveCamera || !streamRef.current) return;
  let cancelled = false;
  let animFrame: number;

  // Lazy-load jsQR module (only if BarcodeDetector unavailable)
  let jsQRModule: any;
  const getJsQR = async () => {
    if (!jsQRModule) jsQRModule = (await import('jsqr')).default;
    return jsQRModule;
  };

  const canvas = document.createElement('canvas');

  const connectVideo = async () => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = streamRef.current;
    await video.play();
    scanLoop();
  };

  const scanLoop = () => {
    if (cancelled || !videoRef.current) return;
    const video = videoRef.current;
    if (video.readyState < video.HAVE_ENOUGH_DATA) {
      animFrame = requestAnimationFrame(scanLoop);
      return;
    }

    if ('BarcodeDetector' in window) {
      const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
      detector.detect(video).then((barcodes: any[]) => {
        if (cancelled) return;
        if (barcodes.length > 0) { handleResult(barcodes[0].rawValue); return; }
        animFrame = requestAnimationFrame(scanLoop);
      }).catch(() => { if (!cancelled) animFrame = requestAnimationFrame(scanLoop); });
    } else {
      // jsQR fallback via canvas
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      getJsQR().then((jsQR: any) => {
        if (cancelled) return;
        const result = jsQR(imageData.data, canvas.width, canvas.height);
        if (result?.data) { handleResult(result.data); return; }
        animFrame = requestAnimationFrame(scanLoop);
      }).catch(() => { if (!cancelled) animFrame = requestAnimationFrame(scanLoop); });
    }
  };

  connectVideo();

  return () => { cancelled = true; cancelAnimationFrame(animFrame); };
}, [useLiveCamera]);
```

**Why two effects?** A single effect that calls `setUseLiveCamera(true)` and then immediately accesses `videoRef.current` will find it null — React hasn't re-rendered yet to mount the `<video>` element. The second effect runs after the re-render.

---

## File Input Fallback

For HTTP or when camera permission is denied. Uses `<input type="file" capture="environment">` which opens the native camera app — no `getUserMedia` needed.

```tsx
<input
  ref={fileInputRef}
  type="file"
  accept="image/*"
  capture="environment"
  onChange={handleFileCapture}
  className="hidden"
/>
<button onClick={() => fileInputRef.current?.click()}>Open Camera</button>
```

Handler decodes QR from the captured photo:
```typescript
const handleFileCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const bitmap = await createImageBitmap(file);

  if ('BarcodeDetector' in window) {
    const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
    const barcodes = await detector.detect(bitmap);
    if (barcodes.length > 0) { handleResult(barcodes[0].rawValue); return; }
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const jsQR = (await import('jsqr')).default;
    const result = (jsQR as any)(imageData.data, canvas.width, canvas.height);
    if (result?.data) { handleResult(result.data); return; }
  }

  setScanError('No QR code found in photo.');
  if (fileInputRef.current) fileInputRef.current.value = ''; // allow re-select
};
```

---

## Scanner Overlay UI

Full-screen overlay with viewfinder box:

```tsx
// Live camera view
<div className="fixed inset-0 z-50 flex flex-col bg-black">
  <div className="flex items-center justify-between px-4 py-3">
    <h2 className="text-lg font-bold text-white">Scan Title</h2>
    <button onClick={onClose}><X className="h-6 w-6 text-white" /></button>
  </div>
  <div className="relative flex flex-1 items-center justify-center">
    <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="h-56 w-56 rounded-2xl border-2 border-white/60" />
    </div>
  </div>
  <div className="px-6 pb-8 pt-4 text-center text-sm text-white/60">
    Point camera at a QR code
  </div>
</div>
```

Three render states based on `useLiveCamera`:
- `null` — loading spinner ("Starting camera...")
- `true` — live camera + viewfinder
- `false` — file input fallback with "Open Camera" button

Video element must have `playsInline` and `muted` for iOS autoplay.

---

## Auth Gating

Pattern for scan pages that need auth without redirecting to the desktop login:

```typescript
const MobileScanLogin = lazy(() =>
  import('@/components/features/scan/mobile-scan-login').then((m) => ({
    default: m.MobileScanLogin,
  })),
);

export default function ScanPage() {
  const { user, loading: authLoading } = useAuth();

  if (authLoading) return <Loader2 />;
  if (!user) return <Suspense fallback={<Loader2 />}><MobileScanLogin /></Suspense>;

  // ... authenticated content
}
```

- Route stays in `publicPatternRoutes` (no redirect to desktop login page)
- Login form is lazy-loaded to reduce bundle for already-authenticated users
- After login, `useAuth()` re-renders — no manual redirect needed

---

## URL Parsing & Navigation

Adapt the regex to match the scan page's URL pattern:

```typescript
const handleResult = (rawValue: string) => {
  // Match /scan/jc/123 or /scan/order/456 etc.
  const match = rawValue.match(/\/scan\/jc\/(\d+)/);
  if (match) {
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    window.location.href = `/scan/jc/${match[1]}`;
  } else if (rawValue.startsWith('http')) {
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    window.location.href = rawValue;
  } else {
    setScanError('Not a valid QR code. Try again.');
  }
};
```

Always stop the camera stream before navigating away.

---

## Resource Cleanup

Mobile devices are resource-constrained. Always:

1. **Stop camera tracks** when navigating or unmounting:
   ```typescript
   streamRef.current.getTracks().forEach((t) => t.stop());
   ```
2. **Cancel animation frames** in cleanup:
   ```typescript
   cancelAnimationFrame(animFrame);
   ```
3. **Use `cancelled` flag** to prevent async operations from running after unmount.

---

## Viewport & Safe Areas

In `app/layout.tsx`, export viewport config for notched devices:

```typescript
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};
```

Use `px-8` (32px) minimum horizontal padding on scan pages to avoid iPhone edge clipping.

---

## Browser Compatibility Matrix

| Feature | iOS Safari | Android Chrome | Android Firefox |
|---------|-----------|---------------|-----------------|
| `getUserMedia` | HTTPS only | HTTPS only | HTTPS only |
| `BarcodeDetector` | 17.2+ | 83+ | No |
| `jsQR` fallback | All | All | All |
| `<input capture>` | All | All | All |
| `createImageBitmap` | 15+ | 50+ | 42+ |

**HTTPS requirement**: `getUserMedia` is blocked on plain HTTP (except localhost). The file input fallback (`<input capture>`) works on HTTP because it delegates to the native camera app.
