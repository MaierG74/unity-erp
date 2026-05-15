import { useCallback, useState } from 'react';

export interface PlacementValues {
  label: string;
  layerId: string;
  length: number;
  depth: number;
  height: number;
}

export type PlacementState =
  | { mode: 'idle' }
  | { mode: 'picking'; values: PlacementValues }
  | { mode: 'placing'; values: PlacementValues; cursor: { x: number; y: number } | null };

export interface UseBlockPlacement {
  placement: PlacementState;
  startPicking: (defaults: PlacementValues) => void;
  setValues: (partial: Partial<PlacementValues>) => void;
  startPlacing: () => void;
  setCursor: (p: { x: number; y: number } | null) => void;
  cancel: () => void;
}

export function useBlockPlacement(): UseBlockPlacement {
  const [placement, setPlacement] = useState<PlacementState>({ mode: 'idle' });

  const startPicking = useCallback((defaults: PlacementValues) => {
    setPlacement({ mode: 'picking', values: defaults });
  }, []);

  const setValues = useCallback((partial: Partial<PlacementValues>) => {
    setPlacement((prev) => (prev.mode === 'picking' ? { ...prev, values: { ...prev.values, ...partial } } : prev));
  }, []);

  const startPlacing = useCallback(() => {
    setPlacement((prev) => (prev.mode === 'picking' ? { mode: 'placing', values: prev.values, cursor: null } : prev));
  }, []);

  const setCursor = useCallback((p: { x: number; y: number } | null) => {
    setPlacement((prev) => (prev.mode === 'placing' ? { ...prev, cursor: p } : prev));
  }, []);

  const cancel = useCallback(() => {
    setPlacement({ mode: 'idle' });
  }, []);

  return { placement, startPicking, setValues, startPlacing, setCursor, cancel };
}
