// Import and re-export types from consolidated types file
export type { CutlistLineRefs, CutlistLineInput } from '@/lib/cutlist/types';

import type { CutlistLineRefs, CutlistLineInput } from '@/lib/cutlist/types';

export async function exportCutlistToQuote(params: {
  quoteItemId: string;
  existingLineRefs?: CutlistLineRefs;
  primaryLine?: CutlistLineInput | null;
  backerLine?: CutlistLineInput | null;
  band16Line?: CutlistLineInput | null;
  band32Line?: CutlistLineInput | null;
}): Promise<CutlistLineRefs> {
  const {
    quoteItemId,
    existingLineRefs = {},
    primaryLine,
    backerLine,
    band16Line,
    band32Line,
  } = params;

  const response = await fetch(`/api/quote-items/${quoteItemId}/cutlist/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      existingLineRefs,
      lines: {
        primary: primaryLine ?? null,
        backer: backerLine ?? null,
        band16: band16Line ?? null,
        band32: band32Line ?? null,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Failed to export cutlist (status ${response.status})`);
  }

  const json = await response.json();
  return (json?.lineRefs ?? {}) as CutlistLineRefs;
}


