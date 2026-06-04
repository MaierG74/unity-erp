import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

/**
 * Centered fixed overlay for modal dialogs. Replaces the inline overlay markup
 * that was duplicated across LayerModals, BlockProperties, and BlockActions.
 */
export function DialogOverlay({ children }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="rounded border bg-white shadow-lg">
        {children}
      </div>
    </div>
  );
}
