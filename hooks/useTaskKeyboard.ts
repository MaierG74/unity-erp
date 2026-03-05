// hooks/useTaskKeyboard.ts
'use client';

import { useEffect } from 'react';

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
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      // Esc always works (closes panels/modals)
      if (e.key === 'Escape') {
        actions.onClosePanel?.();
        return;
      }

      // All other shortcuts suppressed when typing
      if (isInputFocused()) return;

      // Don't intercept if modifier keys are held (Cmd+T, Ctrl+X, etc.)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case 't':
          e.preventDefault();
          actions.onNewTask?.();
          break;
        case 'arrowup':
          e.preventDefault();
          actions.onNavigateUp?.();
          break;
        case 'arrowdown':
          e.preventDefault();
          actions.onNavigateDown?.();
          break;
        case 'enter':
          e.preventDefault();
          actions.onOpenPanel?.();
          break;
        case 'x':
          e.preventDefault();
          actions.onToggleComplete?.();
          break;
        case 'e':
          e.preventDefault();
          actions.onEditTask?.();
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [actions, enabled]);
}
