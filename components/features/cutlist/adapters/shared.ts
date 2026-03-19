'use client';

import { useCallback, useRef } from 'react';

export function useDebouncedAsyncCallback<Args extends unknown[]>(
  callback: (...args: Args) => Promise<void>,
  defaultDelayMs: number
) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debounced = useCallback((...args: [...Args, number?]) => {
    const maybeDelay = args[args.length - 1];
    const delayMs = typeof maybeDelay === 'number' ? maybeDelay : defaultDelayMs;
    const callbackArgs =
      typeof maybeDelay === 'number' ? (args.slice(0, -1) as Args) : (args as unknown as Args);

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      void callback(...callbackArgs).catch(() => {
        // Callers decide whether manual saves should surface errors.
      });
    }, delayMs);
  }, [callback, defaultDelayMs]);

  const cancelPending = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  return {
    debounced,
    cancelPending,
  };
}
