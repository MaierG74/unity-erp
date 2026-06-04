import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ToastContext } from './toastHooks';

interface Toast {
  id: string;
  message: string;
}

const TOAST_DURATION_MS = 3000;
const MAX_TOASTS = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Map from toast id to its dismiss timer handle, so we can clear it on refresh/dismiss.
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Mirror of `toasts` so `show` can read current state synchronously without going
  // through a setState updater (whose body must be pure — StrictMode double-invokes it).
  const toastsRef = useRef<Toast[]>(toasts);
  useEffect(() => {
    toastsRef.current = toasts;
  });

  const dismiss = useCallback((id: string) => {
    const handle = timers.current.get(id);
    if (handle) {
      clearTimeout(handle);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const armDismissTimer = useCallback((id: string) => {
    const handle = setTimeout(() => dismiss(id), TOAST_DURATION_MS);
    timers.current.set(id, handle);
  }, [dismiss]);

  const show = useCallback((message: string) => {
    const existing = toastsRef.current.find((t) => t.message === message);
    if (existing) {
      // Refresh the timer for the existing toast.
      const handle = timers.current.get(existing.id);
      if (handle) clearTimeout(handle);
      armDismissTimer(existing.id);
      return; // No state change.
    }
    // If at capacity, clear the oldest toast's timer before pushing the new one.
    // The slice in the updater drops it from rendered state.
    if (toastsRef.current.length >= MAX_TOASTS) {
      const oldest = toastsRef.current[0];
      const handle = timers.current.get(oldest.id);
      if (handle) {
        clearTimeout(handle);
        timers.current.delete(oldest.id);
      }
    }
    const id = crypto.randomUUID();
    armDismissTimer(id);
    setToasts((prev) => {
      const next = [...prev, { id, message }];
      return next.length > MAX_TOASTS ? next.slice(1) : next;
    });
  }, [armDismissTimer]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const handle of map.values()) clearTimeout(handle);
      map.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className="cursor-pointer rounded border border-red-500 bg-white px-4 py-2 text-sm text-red-700 shadow-lg"
          onClick={() => onDismiss(t.id)}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
