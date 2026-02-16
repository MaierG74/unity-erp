import { NextRequest, NextResponse } from 'next/server';

import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { supabaseAdmin } from '@/lib/supabase-admin';

type QuoteItemRow = {
  description: string | null;
  qty: number | null;
  unit_price: number | null;
};

async function requireOrdersAccess(request: NextRequest) {
  const access = await requireModuleAccess(request, MODULE_KEYS.ORDERS_FULFILLMENT, {
    forbiddenMessage: 'Orders module access is disabled for your organization',
  });

  if ('error' in access) {
    return { error: access.error };
  }

  if (!access.orgId) {
    return {
      error: NextResponse.json(
        {
          error: 'Organization context is required for orders access',
          reason: 'missing_org_context',
          module_key: access.moduleKey,
        },
        { status: 403 }
      ),
    };
  }

  return { orgId: access.orgId };
}

export async function POST(req: NextRequest) {
  const auth = await requireOrdersAccess(req);
  if ('error' in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const quoteId: string | undefined = body?.quoteId;
  if (!quoteId) {
    return NextResponse.json({ error: 'quoteId is required' }, { status: 400 });
  }

  try {
    await supabaseAdmin.from('order_statuses').upsert(
      [
        { status_name: 'New' },
        { status_name: 'In Progress' },
        { status_name: 'Completed' },
        { status_name: 'Cancelled' },
      ],
      { onConflict: 'status_name' }
    );

    const { data: quote, error: qErr } = await supabaseAdmin
      .from('quotes')
      .select('id, quote_number, customer_id, grand_total')
      .eq('id', quoteId)
      .single();
    if (qErr || !quote) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
    }

    let statusId: number | null = null;
    const { data: statusRow } = await supabaseAdmin
      .from('order_statuses')
      .select('status_id')
      .eq('status_name', 'New')
      .maybeSingle();
    statusId = statusRow?.status_id ?? null;

    let resolvedCustomerId: number | null = null;
    if (
      quote.customer_id !== null &&
      quote.customer_id !== undefined &&
      !Number.isNaN(Number(quote.customer_id))
    ) {
      const numericCustomerId = Number(quote.customer_id);
      const { data: customer, error: customerError } = await supabaseAdmin
        .from('customers')
        .select('id')
        .eq('id', numericCustomerId)
        .eq('org_id', auth.orgId)
        .maybeSingle();
      if (customerError) {
        return NextResponse.json({ error: 'Failed to validate quote customer' }, { status: 500 });
      }
      if (!customer) {
        return NextResponse.json(
          { error: 'Quote customer is not accessible in your organization context' },
          { status: 403 }
        );
      }
      resolvedCustomerId = numericCustomerId;
    }

    const payload: Record<string, unknown> = {
      quote_id: quote.id,
      customer_id: resolvedCustomerId,
      order_number: quote.quote_number ?? null,
      status_id: statusId,
      total_amount: typeof quote.grand_total === 'number' ? quote.grand_total : null,
      org_id: auth.orgId,
    };

    const { data: order, error: insErr } = await supabaseAdmin
      .from('orders')
      .insert([payload])
      .select('*')
      .single();
    if (insErr || !order) {
      return NextResponse.json({ error: insErr?.message ?? 'Failed to create order' }, { status: 500 });
    }

    try {
      const { data: items } = await supabaseAdmin
        .from('quote_items')
        .select('description, qty, unit_price')
        .eq('quote_id', quoteId);

      if (items && items.length > 0) {
        const descriptions = Array.from(
          new Set(
            (items as QuoteItemRow[])
              .map((it) => (it.description ? String(it.description) : '').trim())
              .filter(Boolean)
          )
        );
        let productMap = new Map<string, number>();
        if (descriptions.length > 0) {
          const { data: products } = await supabaseAdmin
            .from('products')
            .select('product_id, name')
            .eq('org_id', auth.orgId);
          if (products) {
            for (const p of products) {
              if (p?.name) productMap.set(String(p.name).trim().toLowerCase(), Number(p.product_id));
            }
          }
        }

        const detailsToInsert = (items as QuoteItemRow[])
          .map((it) => {
            const key = String(it.description || '').trim().toLowerCase();
            const productId = key ? productMap.get(key) : undefined;
            if (!productId) return null;
            return {
              order_id: order.order_id,
              org_id: auth.orgId,
              product_id: productId,
              quantity: Number(it.qty || 1),
              unit_price: Number(it.unit_price || 0),
            };
          })
          .filter((row): row is NonNullable<typeof row> => Boolean(row));

        if (detailsToInsert.length > 0) {
          await supabaseAdmin.from('order_details').insert(detailsToInsert);
        }
      }
    } catch (copyErr) {
      console.warn('[from-quote] copy items warning:', copyErr);
    }

    return NextResponse.json({ order }, { status: 201 });
  } catch (e: unknown) {
    console.error('[from-quote] error', e);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
