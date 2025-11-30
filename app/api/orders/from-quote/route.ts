import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const quoteId: string | undefined = body?.quoteId;
  if (!quoteId) {
    return NextResponse.json({ error: 'quoteId is required' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    // Ensure statuses exist (idempotent)
    await supabase
      .from('order_statuses')
      .upsert(
        [
          { status_name: 'New' },
          { status_name: 'In Progress' },
          { status_name: 'Completed' },
          { status_name: 'Cancelled' },
        ],
        { onConflict: 'status_name' as any }
      );

    // Fetch quote basics
    const { data: quote, error: qErr } = await supabase
      .from('quotes')
      .select('id, quote_number, customer_id, grand_total')
      .eq('id', quoteId)
      .single();
    if (qErr || !quote) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
    }

    // Resolve order status id for 'New' if present
    let statusId: number | null = null;
    const { data: statusRow } = await supabase
      .from('order_statuses')
      .select('status_id')
      .eq('status_name', 'New')
      .maybeSingle();
    statusId = statusRow?.status_id ?? null;

    // Create order header using info from quote
    const payload: Record<string, any> = {
      quote_id: quote.id,
      customer_id: quote.customer_id !== null && quote.customer_id !== undefined && !Number.isNaN(Number(quote.customer_id))
        ? Number(quote.customer_id)
        : null,
      order_number: quote.quote_number ?? null,
      status_id: statusId,
      total_amount: typeof quote.grand_total === 'number' ? quote.grand_total : null,
    };

    const { data: order, error: insErr } = await supabase
      .from('orders')
      .insert([payload])
      .select('*')
      .single();
    if (insErr || !order) {
      return NextResponse.json({ error: insErr?.message ?? 'Failed to create order' }, { status: 500 });
    }

    // Copy quote items into order_details where possible
    // We map simple items to order_details with description in products table if present; otherwise insert as a product-less detail (if allowed)
    // Strategy: create placeholder products when necessary is out of scope; we only copy items that reference a valid product via quote_item_clusters lines of type 'product' (not available),
    // so we fallback to creating free-text product entries by matching products by name. If no match, we skip.
    try {
      // Fetch quote_items minimal set
      const { data: items } = await supabase
        .from('quote_items')
        .select('id, description, qty, unit_price')
        .eq('quote_id', quoteId);

      if (items && items.length > 0) {
        // Attempt to map description -> product_id
        const descriptions = Array.from(new Set(items.map((it: any) => (it?.description || '').trim()).filter(Boolean)));
        let productMap = new Map<string, number>();
        if (descriptions.length > 0) {
          const { data: products } = await supabase
            .from('products')
            .select('product_id, name');
          if (products) {
            for (const p of products) {
              if (p?.name) productMap.set(String(p.name).trim().toLowerCase(), Number(p.product_id));
            }
          }
        }

        const detailsToInsert = items
          .map((it: any) => {
            const key = String(it.description || '').trim().toLowerCase();
            const productId = key ? productMap.get(key) : undefined;
            if (!productId) return null; // skip if we cannot map
            return {
              order_id: order.order_id,
              product_id: productId,
              quantity: Number(it.qty || 1),
              unit_price: Number(it.unit_price || 0),
            };
          })
          .filter(Boolean) as any[];

        if (detailsToInsert.length > 0) {
          await supabase.from('order_details').insert(detailsToInsert);
        }
      }
    } catch (copyErr) {
      console.warn('[from-quote] copy items warning:', copyErr);
    }

    return NextResponse.json({ order }, { status: 201 });
  } catch (e: any) {
    console.error('[from-quote] error', e);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}


