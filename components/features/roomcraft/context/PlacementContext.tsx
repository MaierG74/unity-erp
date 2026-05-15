import { createContext, useContext, type ReactNode } from 'react';
import { useBlockPlacement, type UseBlockPlacement } from '../hooks/useBlockPlacement';

const PlacementContext = createContext<UseBlockPlacement | null>(null);

export function PlacementProvider({ children }: { children: ReactNode }) {
  const value = useBlockPlacement();
  return <PlacementContext.Provider value={value}>{children}</PlacementContext.Provider>;
}

export function usePlacement(): UseBlockPlacement {
  const ctx = useContext(PlacementContext);
  if (!ctx) throw new Error('usePlacement must be used inside <PlacementProvider>');
  return ctx;
}

