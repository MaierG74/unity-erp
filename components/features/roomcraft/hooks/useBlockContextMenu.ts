import { useState, useCallback, useEffect } from 'react';
import type { RefObject } from 'react';
import { canvasToRoom } from '../utils/scale';
import { hitTestBlocks } from '../utils/blockHitTest';
import type { FloorPlan } from '../types/floorPlan';

interface ViewState {
  scale: number;
  offset: { x: number; y: number };
}

interface MenuState {
  open: boolean;
  x: number;
  y: number;
  blockId: string | null;
}

interface Params {
  containerRef: RefObject<HTMLElement | null>;
  floorPlan: FloorPlan | null;
  viewState: ViewState;
}

interface Result {
  menuState: MenuState;
  openMenu: (x: number, y: number, blockId: string) => void;
  closeMenu: () => void;
}

const CLOSED: MenuState = { open: false, x: 0, y: 0, blockId: null };

export function useBlockContextMenu({ containerRef, floorPlan, viewState }: Params): Result {
  const [menuState, setMenuState] = useState<MenuState>(CLOSED);

  const openMenu = useCallback((x: number, y: number, blockId: string) => {
    setMenuState({ open: true, x, y, blockId });
  }, []);

  const closeMenu = useCallback(() => {
    setMenuState(CLOSED);
  }, []);

  // Effect A: contextmenu listener on the container. Always attached while the
  // container exists. Deps include floorPlan and viewState because they are read
  // inside the handler (no ref needed — re-attaching on change is acceptable for
  // a low-frequency right-click event).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();

      if (!floorPlan) {
        setMenuState(CLOSED);
        return;
      }

      const rect = container.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const pt = canvasToRoom(cx, cy, viewState.scale, viewState.offset);

      const hits = hitTestBlocks(pt.x, pt.y, floorPlan);
      if (hits.length === 0) {
        // Right-click on empty space — suppress OS menu but close any open menu.
        setMenuState(CLOSED);
        return;
      }

      // Use client coords (viewport-relative) so BlockContextMenu can use position: fixed.
      setMenuState({ open: true, x: e.clientX, y: e.clientY, blockId: hits[0].id });
    };

    container.addEventListener('contextmenu', handleContextMenu);
    return () => {
      container.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [containerRef, floorPlan, viewState]);

  // Effect B: document-level mousedown + keydown listeners. Only attached while
  // menu is open to avoid leaking global handlers during normal canvas operation.
  useEffect(() => {
    if (!menuState.open) return;

    const handleMouseDown = (e: MouseEvent) => {
      // Close unless the click target is inside a [role="menu"] element.
      const target = e.target as Element | null;
      if (target?.closest('[role="menu"]')) return;
      setMenuState(CLOSED);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuState(CLOSED);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuState.open]);

  return { menuState, openMenu, closeMenu };
}
