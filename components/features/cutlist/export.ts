export type CutlistLineRefs = {
  primary?: string | null;
  backer?: string | null;
  band16?: string | null;
  band32?: string | null;
};

export type CutlistLineInput = {
  description: string;
  qty: number;
  unit_cost?: number | null;
  component_id?: number;
};

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


