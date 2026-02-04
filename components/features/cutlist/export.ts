// Import and re-export types from consolidated types file
export type { CutlistLineRefs, CutlistLineInput } from '@/lib/cutlist/types';

import type { CutlistLineRefs, CutlistLineInput } from '@/lib/cutlist/types';

export async function exportCutlistToQuote(params: {
  quoteItemId: string;
  existingLineRefs?: CutlistLineRefs;
  mode?: 'replace' | 'append';
  primaryLine?: CutlistLineInput | null;
  backerLine?: CutlistLineInput | null;
  band16Line?: CutlistLineInput | null;
  band32Line?: CutlistLineInput | null;
  /** Dynamic edging lines keyed by slot name (e.g., 'edging_materialId') */
  edgingLines?: Record<string, CutlistLineInput>;
  /** Additional dynamic lines keyed by slot name (e.g., 'primary_materialId') */
  extraLines?: Record<string, CutlistLineInput>;
}): Promise<CutlistLineRefs> {
  const {
    quoteItemId,
    existingLineRefs = {},
    mode = 'replace',
    primaryLine,
    backerLine,
    band16Line,
    band32Line,
    edgingLines,
    extraLines,
  } = params;

  // Build lines object — include fixed slots plus dynamic edging lines
  const lines: Record<string, CutlistLineInput | null> = {
    primary: primaryLine ?? null,
    backer: backerLine ?? null,
    band16: band16Line ?? null,
    band32: band32Line ?? null,
  };

  // Add dynamic edging lines
  if (edgingLines) {
    for (const [slot, line] of Object.entries(edgingLines)) {
      lines[slot] = line;
    }
  }

  // Add any extra dynamic lines
  if (extraLines) {
    for (const [slot, line] of Object.entries(extraLines)) {
      lines[slot] = line;
    }
  }

  // Replace mode clears any previously tracked cutlist slots that are no longer present
  if (mode === 'replace') {
    for (const refKey of Object.keys(existingLineRefs)) {
      if (!(refKey in lines)) {
        lines[refKey] = null;
      }
    }
  }

  const response = await fetch(`/api/quote-items/${quoteItemId}/cutlist/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      existingLineRefs,
      lines,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Failed to export cutlist (status ${response.status})`);
  }

  const json = await response.json();
  return (json?.lineRefs ?? {}) as CutlistLineRefs;
}
