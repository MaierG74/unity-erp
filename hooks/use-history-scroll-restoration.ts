'use client';

import { useEffect, useMemo, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

const HISTORY_STATE_KEY = '__unityScrollRestoration';
const MAX_RESTORE_ATTEMPTS = 10;

type HistoryScrollState = {
  pageKey: string;
  scrollY: number;
};

function readHistoryScrollState(): HistoryScrollState | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const historyState = window.history.state as Record<string, unknown> | null;
  const savedState = historyState?.[HISTORY_STATE_KEY];

  if (!savedState || typeof savedState !== 'object') {
    return null;
  }

  const { pageKey, scrollY } = savedState as Record<string, unknown>;

  if (typeof pageKey !== 'string' || typeof scrollY !== 'number' || !Number.isFinite(scrollY)) {
    return null;
  }

  return { pageKey, scrollY };
}

export function useHistoryScrollRestoration({ ready = true }: { ready?: boolean } = {}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams?.toString() || '';
  const restoredPageKeyRef = useRef<string | null>(null);

  const pageKey = useMemo(() => {
    if (!pathname) {
      return searchParamsString ? `?${searchParamsString}` : '/';
    }

    return searchParamsString ? `${pathname}?${searchParamsString}` : pathname;
  }, [pathname, searchParamsString]);

  useEffect(() => {
    restoredPageKeyRef.current = null;
  }, [pageKey]);

  useEffect(() => {
    if (!ready || typeof window === 'undefined') {
      return;
    }

    const saveCurrentScrollPosition = () => {
      const nextHistoryState = {
        ...(window.history.state ?? {}),
        [HISTORY_STATE_KEY]: {
          pageKey,
          scrollY: window.scrollY,
        },
      };

      window.history.replaceState(nextHistoryState, '', window.location.href);
    };

    let animationFrameId: number | null = null;

    const scheduleSave = () => {
      if (restoredPageKeyRef.current !== pageKey || animationFrameId !== null) {
        return;
      }

      animationFrameId = window.requestAnimationFrame(() => {
        saveCurrentScrollPosition();
        animationFrameId = null;
      });
    };

    const saveOnPageHide = () => {
      if (restoredPageKeyRef.current !== pageKey) {
        return;
      }

      saveCurrentScrollPosition();
    };

    window.addEventListener('scroll', scheduleSave, { passive: true });
    window.addEventListener('pagehide', saveOnPageHide);

    return () => {
      window.removeEventListener('scroll', scheduleSave);
      window.removeEventListener('pagehide', saveOnPageHide);
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, [pageKey, ready]);

  useEffect(() => {
    if (!ready || typeof window === 'undefined' || restoredPageKeyRef.current === pageKey) {
      return;
    }

    const saveCurrentScrollPosition = () => {
      const nextHistoryState = {
        ...(window.history.state ?? {}),
        [HISTORY_STATE_KEY]: {
          pageKey,
          scrollY: window.scrollY,
        },
      };

      window.history.replaceState(nextHistoryState, '', window.location.href);
    };

    const savedState = readHistoryScrollState();
    const shouldRestore =
      savedState?.pageKey === pageKey &&
      Number.isFinite(savedState.scrollY) &&
      savedState.scrollY > 0;

    if (!shouldRestore || !savedState) {
      restoredPageKeyRef.current = pageKey;
      saveCurrentScrollPosition();
      return;
    }

    let attempts = 0;
    let animationFrameId = 0;

    const restoreScrollPosition = () => {
      attempts += 1;

      const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const nextScrollY = Math.min(savedState.scrollY, maxScrollY);

      window.scrollTo({ top: nextScrollY, behavior: 'auto' });

      const closeEnough = Math.abs(window.scrollY - nextScrollY) < 2;
      const shouldRetry =
        attempts < MAX_RESTORE_ATTEMPTS && (maxScrollY < savedState.scrollY || !closeEnough);

      if (shouldRetry) {
        animationFrameId = window.requestAnimationFrame(restoreScrollPosition);
        return;
      }

      restoredPageKeyRef.current = pageKey;
      saveCurrentScrollPosition();
    };

    animationFrameId = window.requestAnimationFrame(restoreScrollPosition);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [pageKey, ready]);
}
