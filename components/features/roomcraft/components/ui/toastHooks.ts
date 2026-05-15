import { createContext, useContext } from 'react';
import type { Validation } from '../../utils/blockActionValidation';

interface ToastContextValue {
  show: (message: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

export function useValidateOrToast(): (result: Validation) => boolean {
  const { show } = useToast();
  return (result: Validation): boolean => {
    if (result.ok) return true;
    show(result.reason);
    return false;
  };
}
