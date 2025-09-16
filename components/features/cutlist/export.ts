import type { LayoutResult } from './packing';
import { createQuoteClusterLine, fetchQuoteItemClusters, createQuoteItemCluster } from '@/lib/db/quotes';

export async function exportCutlistToQuote(params: {
  quoteItemId: string;
  result: LayoutResult;
  sheetDescription?: string; // e.g., MELAMINE SHEET 2750×1830
  edgeBandingDescription?: string; // e.g., EDGE BANDING (m)
  pricePerSheet?: number | null;
  pricePerMeterBanding?: number | null;
  fractionalSheetQty?: number; // override default integer sheet count
  extraManualLines?: Array<{ description: string; qty: number; unit_cost?: number | null; component_id?: number }>; // optional component-backed lines
  addDefaultSheetLine?: boolean; // default true
  addDefaultBandingLine?: boolean; // default true
}) {
  const { quoteItemId, result, sheetDescription = 'MELAMINE SHEET', edgeBandingDescription = 'EDGE BANDING (m)', pricePerSheet = null, pricePerMeterBanding = null, fractionalSheetQty, extraManualLines, addDefaultSheetLine = true, addDefaultBandingLine = true } = params;

  // Ensure a cluster exists for this item
  let clusters = await fetchQuoteItemClusters(quoteItemId);
  let targetCluster = clusters[0];
  if (!targetCluster) {
    targetCluster = await createQuoteItemCluster({ quote_item_id: quoteItemId, name: 'Costing Cluster', position: 0 });
  }

  const sheetCount = fractionalSheetQty != null ? fractionalSheetQty : result.sheets.length;
  const bandingMeters = (result.stats.edgebanding_length_mm || 0) / 1000;

  if (addDefaultSheetLine && sheetCount > 0) {
    await createQuoteClusterLine({
      cluster_id: targetCluster.id,
      line_type: 'manual',
      description: `${sheetDescription}`,
      qty: Number(sheetCount.toFixed(3)),
      unit_cost: pricePerSheet,
      include_in_markup: true,
      sort_order: 0,
    });
  }

  if (addDefaultBandingLine && bandingMeters > 0.0001) {
    await createQuoteClusterLine({
      cluster_id: targetCluster.id,
      line_type: 'manual',
      description: `${edgeBandingDescription}`,
      qty: Number(bandingMeters.toFixed(2)),
      unit_cost: pricePerMeterBanding,
      include_in_markup: true,
      sort_order: 0,
    });
  }

  for (const line of extraManualLines || []) {
    if (!line || !(line.qty > 0)) continue;
    await createQuoteClusterLine({
      cluster_id: targetCluster.id,
      line_type: line.component_id ? 'component' : 'manual',
      description: line.description,
      qty: Number(line.qty.toFixed(3)),
      unit_cost: line.unit_cost ?? null,
      include_in_markup: true,
      component_id: line.component_id,
      sort_order: 0,
    } as any);
  }
}


