import { NextRequest, NextResponse } from 'next/server';

import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { supabaseAdmin } from '@/lib/supabase-admin';

function extractStoragePathFromPublicUrl(url: string): { bucket: string; path: string } | null {
  try {
    const marker = '/object/public/';
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    const after = url.substring(idx + marker.length);
    const [bucket, ...rest] = after.split('/');
    return { bucket, path: rest.join('/') };
  } catch {
    return null;
  }
}

function parseOrderId(orderId: string): number | null {
  const parsed = Number.parseInt(orderId, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
}

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

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ orderId: string }> }
) {
  const auth = await requireOrdersAccess(request);
  if ('error' in auth) return auth.error;

  const { orderId: orderIdParam } = await context.params;
  const orderId = parseOrderId(orderIdParam);
  if (!orderId) {
    return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { customer_id, order_number, delivery_date } = body;

    console.log(`[PATCH /orders/${orderId}] Updating order with:`, { customer_id, order_number, delivery_date });

    // Build the update object with only provided fields
    const updateData: Record<string, unknown> = {};
    if (customer_id !== undefined) updateData.customer_id = customer_id;
    if (order_number !== undefined) updateData.order_number = order_number;
    if (delivery_date !== undefined) updateData.delivery_date = delivery_date;

    // Validate that at least one field is being updated
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    // Verify the order exists
    const { data: orderExists, error: checkErr } = await supabaseAdmin
      .from('orders')
      .select('order_id')
      .eq('order_id', orderId)
      .eq('org_id', auth.orgId)
      .maybeSingle();

    if (checkErr) {
      console.error(`[PATCH /orders/${orderId}] Order not found`, checkErr);
      return NextResponse.json({ error: 'Failed to validate order' }, { status: 500 });
    }

    if (!orderExists) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // If customer_id is being updated, verify the customer exists
    if (customer_id !== undefined) {
      const { data: customerExists, error: customerErr } = await supabaseAdmin
        .from('customers')
        .select('id')
        .eq('id', customer_id)
        .eq('org_id', auth.orgId)
        .maybeSingle();

      if (customerErr) {
        console.error(`[PATCH /orders/${orderId}] Customer not found`, customerErr);
        return NextResponse.json({ error: 'Failed to validate customer' }, { status: 500 });
      }

      if (!customerExists) {
        return NextResponse.json({ error: 'Customer not found' }, { status: 400 });
      }
    }

    // Update the order
    const { data: updatedOrder, error: updateErr } = await supabaseAdmin
      .from('orders')
      .update(updateData)
      .eq('order_id', orderId)
      .eq('org_id', auth.orgId)
      .select()
      .maybeSingle();

    if (updateErr) {
      console.error(`[PATCH /orders/${orderId}] Failed to update order`, updateErr);
      return NextResponse.json({ error: `Failed to update order: ${updateErr.message}` }, { status: 500 });
    }

    if (!updatedOrder) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    console.log(`[PATCH /orders/${orderId}] Successfully updated order`);
    return NextResponse.json({ success: true, order: updatedOrder });
  } catch (e: unknown) {
    console.error('[PATCH /orders] unexpected error', e);
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Unexpected error: ${message}` }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ orderId: string }> }
) {
  const auth = await requireOrdersAccess(request);
  if ('error' in auth) return auth.error;

  const { orderId: orderIdParam } = await context.params;
  const orderId = parseOrderId(orderIdParam);
  if (!orderId) {
    return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });
  }

  try {
    console.log(`[DELETE /orders/${orderId}] Starting deletion process`);

    // First, verify the order exists
    const { data: orderExists, error: checkErr } = await supabaseAdmin
      .from('orders')
      .select('order_id, order_number')
      .eq('order_id', orderId)
      .eq('org_id', auth.orgId)
      .maybeSingle();

    if (checkErr) {
      console.error(`[DELETE /orders/${orderId}] Order not found`, checkErr);
      return NextResponse.json({ error: 'Failed to validate order' }, { status: 500 });
    }

    if (!orderExists) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    console.log(`[DELETE /orders/${orderId}] Order found: ${orderExists.order_number || orderId}`);

    // Fetch attachments to remove from storage
    const { data: attachments, error: attErr } = await supabaseAdmin
      .from('order_attachments')
      .select('file_url')
      .eq('order_id', orderId);
    if (attErr) {
      console.warn('[DELETE /orders] failed to list attachments', attErr);
    }

    // Attempt to remove storage objects derived from public URLs
    if (attachments && attachments.length > 0) {
      console.log(`[DELETE /orders/${orderId}] Removing ${attachments.length} attachment(s) from storage`);
      for (const att of attachments) {
        const info = att?.file_url ? extractStoragePathFromPublicUrl(att.file_url) : null;
        if (info && info.bucket && info.path) {
          try {
            await supabaseAdmin.storage.from(info.bucket).remove([info.path]);
          } catch (e) {
            console.warn('[DELETE /orders] storage remove failed for', info.path, e);
          }
        }
      }
    }

    // Delete attachment rows
    const { error: attDelErr } = await supabaseAdmin.from('order_attachments').delete().eq('order_id', orderId);
    if (attDelErr) {
      console.warn('[DELETE /orders] failed to delete attachment rows', attDelErr);
    }

    // Delete supplier junction links
    const { error: junctionErr } = await supabaseAdmin
      .from('supplier_order_customer_orders')
      .delete()
      .eq('order_id', orderId);
    if (junctionErr) {
      console.warn('[DELETE /orders] failed to delete supplier junction links', junctionErr);
    }

    // Delete order details
    const { error: detailsErr } = await supabaseAdmin
      .from('order_details')
      .delete()
      .eq('order_id', orderId)
      .eq('org_id', auth.orgId);
    if (detailsErr) {
      console.error('[DELETE /orders] failed to delete order details', detailsErr);
      return NextResponse.json({ error: `Failed to delete order details: ${detailsErr.message}` }, { status: 500 });
    }

    // Delete inventory transactions referencing this order
    const { error: invTxErr } = await supabaseAdmin
      .from('inventory_transactions')
      .delete()
      .eq('order_id', orderId)
      .eq('org_id', auth.orgId);
    if (invTxErr) {
      console.warn('[DELETE /orders] failed to delete inventory transactions', invTxErr);
      // Don't fail the deletion if inventory transactions can't be deleted
      // They might be referenced elsewhere or the constraint might allow null
    }

    // Finally, delete the order header
    const { error: delErr } = await supabaseAdmin
      .from('orders')
      .delete()
      .eq('order_id', orderId)
      .eq('org_id', auth.orgId);
    if (delErr) {
      console.error('[DELETE /orders] failed to delete order', delErr);
      return NextResponse.json({ error: `Failed to delete order: ${delErr.message}` }, { status: 500 });
    }

    console.log(`[DELETE /orders/${orderId}] Successfully deleted order`);
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    console.error('[DELETE /orders] unexpected error', e);
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Unexpected error: ${message}` }, { status: 500 });
  }
}
