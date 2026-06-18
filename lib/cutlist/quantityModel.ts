import type { CutlistPart, PartSpec } from '@/lib/cutlist/types';

export type SameBoardQuantityModel = 'pieces-v0' | 'finished-v1';

type QuantityModelConfig =
  | {
      same_board_quantity_model?: unknown;
      sameBoardQuantityModel?: unknown;
    }
  | null
  | undefined;

type QuantityPart = Pick<PartSpec, 'qty' | 'lamination_config' | 'lamination_group'> & {
  lamination_type?: string | null;
};
type FinishedQuantityPart =
  | Pick<CutlistPart, 'quantity' | 'lamination_type' | 'lamination_group'>
  | { quantity: number; lamination_type?: string | null; lamination_group?: string | null };

export function sameBoardQuantityModel(config: QuantityModelConfig): SameBoardQuantityModel {
  const value = config?.sameBoardQuantityModel ?? config?.same_board_quantity_model;
  return value === 'finished-v1' ? 'finished-v1' : 'pieces-v0';
}

export function isFinishedQtyModel(config: QuantityModelConfig): boolean {
  return sameBoardQuantityModel(config) === 'finished-v1';
}

function nonNegativeWhole(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}

function primaryLayerCount(part: Pick<PartSpec, 'lamination_config'>): number {
  const layers = part.lamination_config?.layers;
  if (!Array.isArray(layers) || layers.length === 0) return 1;
  const primaryLayers = layers.filter((layer) => layer.isPrimary).length;
  return Math.max(1, primaryLayers || layers.length);
}

/**
 * Converts a row quantity into physical primary-board cut pieces.
 *
 * `lamination_group` means the layers are already represented by distinct
 * rows, so same-board auto-expansion is intentionally disabled for grouped
 * rows to avoid multiplying explicit layers a second time.
 */
export function cutPieceCountFromQuantity(
  part: QuantityPart,
  options: { finishedModel: boolean },
): number {
  const qty = nonNegativeWhole(part.qty);

  switch (part.lamination_type ?? 'none') {
    case 'same-board':
      return options.finishedModel && !part.lamination_group ? qty * 2 : qty;
    case 'custom':
      return qty * primaryLayerCount(part);
    case 'none':
    case 'with-backer':
    default:
      return qty;
  }
}

/**
 * Finished assemblies represented by a row for edging, costing summaries, and
 * order-side display counts.
 */
export function finishedPartCountFromQuantity(
  part: FinishedQuantityPart,
  options: { finishedModel: boolean },
): number {
  const quantity = nonNegativeWhole(part.quantity);
  if ((part.lamination_type ?? 'none') === 'same-board' && !part.lamination_group) {
    return options.finishedModel ? quantity : Math.floor(quantity / 2);
  }
  return quantity;
}
