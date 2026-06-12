export type OrderBolPayType = 'hourly' | 'piece';

export type OrderBolRow = {
  product_id?: number | null;
  product_name?: string | null;
  job_id: number;
  job_name?: string | null;
  bol_id: number;
  quantity?: number | string | null;
  pay_type?: string | null;
  piece_rate?: number | null;
  piece_rate_id?: number | null;
  hourly_rate_id?: number | null;
  time_per_unit?: number | null;
};

export type OrderBolDemandItem = {
  order_detail_id: number;
  product_id: number;
  product_name?: string | null;
  job_id: number;
  job_name?: string | null;
  bol_id: number;
  quantity: number;
  pay_type: OrderBolPayType;
  piece_rate: number | null;
  piece_rate_id: number | null;
  hourly_rate_id: number | null;
  time_per_unit: number | null;
  _source: 'direct' | 'link';
  _sub_product_name?: string;
};

type ProductLink = {
  sub_product_id: number;
  sub_product_name: string;
  scale: number;
  mode: string;
};

function numeric(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function payType(value: string | null | undefined): OrderBolPayType {
  return value === 'piece' ? 'piece' : 'hourly';
}

function demandFromBol(input: {
  detail: { order_detail_id: number; quantity: number; product_id: number };
  bol: OrderBolRow;
  productId: number;
  productName?: string | null;
  scale: number;
  source: 'direct' | 'link';
  subProductName?: string;
}): OrderBolDemandItem | null {
  const bolId = numeric(input.bol.bol_id);
  const jobId = numeric(input.bol.job_id);
  if (bolId <= 0 || jobId <= 0) return null;

  return {
    order_detail_id: input.detail.order_detail_id,
    product_id: input.productId,
    product_name: input.productName ?? null,
    job_id: jobId,
    job_name: input.bol.job_name ?? null,
    bol_id: bolId,
    quantity: numeric(input.detail.quantity, 1) * numeric(input.bol.quantity, 1) * input.scale,
    pay_type: payType(input.bol.pay_type),
    piece_rate: input.bol.piece_rate ?? null,
    piece_rate_id: input.bol.piece_rate_id ?? null,
    hourly_rate_id: input.bol.hourly_rate_id ?? null,
    time_per_unit: input.bol.time_per_unit ?? null,
    _source: input.source,
    _sub_product_name: input.subProductName,
  };
}

export function expandOrderDetailBol(input: {
  detail: { order_detail_id: number; quantity: number; product_id: number };
  directBol: OrderBolRow[];
  links: ProductLink[];
  childBolBySubId: Map<number, OrderBolRow[]>;
}): OrderBolDemandItem[] {
  const items: OrderBolDemandItem[] = [];

  for (const bol of input.directBol) {
    const item = demandFromBol({
      detail: input.detail,
      bol,
      productId: input.detail.product_id,
      productName: bol.product_name ?? null,
      scale: 1,
      source: 'direct',
    });
    if (item) items.push(item);
  }

  for (const link of input.links) {
    if (link.mode !== 'phantom') continue;

    const subProductId = numeric(link.sub_product_id);
    if (subProductId <= 0) continue;

    const childBol = input.childBolBySubId.get(subProductId) ?? [];
    for (const bol of childBol) {
      const item = demandFromBol({
        detail: input.detail,
        bol,
        productId: subProductId,
        productName: link.sub_product_name,
        scale: numeric(link.scale, 1),
        source: 'link',
        subProductName: link.sub_product_name,
      });
      if (item) items.push(item);
    }
  }

  return items;
}

export function orderBolDemandKey(item: Pick<OrderBolDemandItem, 'order_detail_id' | 'bol_id'>): string {
  return `${item.order_detail_id}:${item.bol_id}`;
}

export function orderBolDemandMap(items: OrderBolDemandItem[]): Map<string, OrderBolDemandItem> {
  return new Map(items.map((item) => [orderBolDemandKey(item), item]));
}
