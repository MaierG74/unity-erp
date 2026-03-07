// hooks/useTaskKeyboard.ts
'use client';

import { useEffect, useRef } from 'react';

interface TaskKeyboardActions {
  onNewTask?: () => void;           // T
  onNavigateUp?: () => void;        // ArrowUp
  onNavigateDown?: () => void;      // ArrowDown
  onOpenPanel?: () => void;         // Enter
  onClosePanel?: () => void;        // Escape
  onToggleComplete?: () => void;    // X
  onEditTask?: () => void;          // E
}

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function useTaskKeyboard(actions: TaskKeyboardActions, enabled = true) {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      const a = actionsRef.current;

      // Esc always works (closes panels/modals)
      if (e.key === 'Escape') {
        a.onClosePanel?.();
        return;
      }

      // All other shortcuts suppressed when typing
      if (isInputFocused()) return;

      // Don't intercept if modifier keys are held (Cmd+T, Ctrl+X, etc.)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case 't':
          e.preventDefault();
          a.onNewTask?.();
          break;
        case 'arrowup':
          e.preventDefault();
          a.onNavigateUp?.();
          break;
        case 'arrowdown':
          e.preventDefault();
          a.onNavigateDown?.();
          break;
        case 'enter':
          e.preventDefault();
          a.onOpenPanel?.();
          break;
        case 'x':
          e.preventDefault();
          a.onToggleComplete?.();
          break;
        case 'e':
          e.preventDefault();
          a.onEditTask?.();
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);
}
