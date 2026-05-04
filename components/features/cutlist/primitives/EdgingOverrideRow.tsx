'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { RotateCcw } from 'lucide-react';
import type { EdgingBillingOverride } from '@/lib/cutlist/types';

interface EdgingOverrideRowProps {
  name: string;
  thickness_mm: number;
  metersActual: number;
  override: EdgingBillingOverride | undefined;
  onOverrideChange: (override: EdgingBillingOverride | undefined) => void;
}

export function EdgingOverrideRow({
  name,
  thickness_mm,
  metersActual,
  override,
  onOverrideChange,
}: EdgingOverrideRowProps) {
  const pctOverride = override?.pctOverride ?? null;
  const metersOverride = override?.metersOverride ?? null;

  // Compute padded meters
  let paddedMeters = metersActual;
  if (metersOverride !== null) {
    paddedMeters = metersOverride;
  } else if (pctOverride !== null) {
    paddedMeters = metersActual * (1 + pctOverride / 100);
  }

  const hasOverride = pctOverride !== null || metersOverride !== null;

  return (
    <div className="grid w-fit max-w-full grid-cols-[minmax(260px,360px)_70px_auto_auto_70px_auto] items-center gap-3 text-xs">
      <span className="text-muted-foreground min-w-0 whitespace-normal leading-snug" title={name}>
        {name} ({thickness_mm}mm)
      </span>
      <span className="w-[60px] text-right tabular-nums">{metersActual.toFixed(2)}m</span>
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground">+</span>
        <Input
          type="number"
          className="h-7 w-[60px] text-xs tabular-nums"
          placeholder="—"
          value={metersOverride !== null ? '' : (pctOverride ?? '')}
          disabled={metersOverride !== null}
          onChange={(e) => {
            const val = e.target.value === '' ? null : Math.max(0, Number(e.target.value));
            onOverrideChange(val !== null ? { pctOverride: val, metersOverride: null } : undefined);
          }}
        />
        <span className="text-muted-foreground">%</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground">or</span>
        <Input
          type="number"
          className="h-7 w-[70px] text-xs tabular-nums"
          placeholder="—"
          value={metersOverride ?? ''}
          onChange={(e) => {
            const val = e.target.value === '' ? null : Math.max(0, Number(e.target.value));
            onOverrideChange(val !== null ? { pctOverride: null, metersOverride: val } : undefined);
          }}
        />
        <span className="text-muted-foreground">m</span>
      </div>
      <span className="w-[60px] text-right tabular-nums font-medium">
        {paddedMeters.toFixed(2)}m
      </span>
      {hasOverride && (
        <Button
          variant="link"
          size="sm"
          className="h-auto px-1 text-xs text-primary"
          onClick={() => onOverrideChange(undefined)}
        >
          <RotateCcw className="h-3 w-3 mr-0.5" />
          Reset
        </Button>
      )}
    </div>
  );
}
