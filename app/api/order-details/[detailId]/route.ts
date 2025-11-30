import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ detailId: string }> }
) {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { detailId: detailIdParam } = await context.params;
  const detailId = parseInt(detailIdParam, 10);
  if (!detailId || Number.isNaN(detailId)) {
    return NextResponse.json({ error: 'Invalid order detail id' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { quantity, unit_price } = body;

    console.log(`[PATCH /order-details/${detailId}] Updating order detail with:`, { quantity, unit_price });

    // Build the update object with only provided fields
    const updateData: Record<string, any> = {};
    if (quantity !== undefined) updateData.quantity = quantity;
    if (unit_price !== undefined) updateData.unit_price = unit_price;

    // Validate that at least one field is being updated
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    // Validate numeric values
    if (quantity !== undefined && (isNaN(quantity) || quantity < 0)) {
      return NextResponse.json({ error: 'Quantity must be a non-negative number' }, { status: 400 });
    }
    if (unit_price !== undefined && (isNaN(unit_price) || unit_price < 0)) {
      return NextResponse.json({ error: 'Unit price must be a non-negative number' }, { status: 400 });
    }

    // Verify the order detail exists
    const { data: detailExists, error: checkErr } = await supabaseAdmin
      .from('order_details')
      .select('order_detail_id, order_id')
      .eq('order_detail_id', detailId)
      .single();

    if (checkErr || !detailExists) {
      console.error(`[PATCH /order-details/${detailId}] Order detail not found`, checkErr);
      return NextResponse.json({ error: 'Order detail not found' }, { status: 404 });
    }

    // Update the order detail
    const { data: updatedDetail, error: updateErr } = await supabaseAdmin
      .from('order_details')
      .update(updateData)
      .eq('order_detail_id', detailId)
      .select()
      .single();

    if (updateErr) {
      console.error(`[PATCH /order-details/${detailId}] Failed to update order detail`, updateErr);
      return NextResponse.json({ error: `Failed to update order detail: ${updateErr.message}` }, { status: 500 });
    }

    console.log(`[PATCH /order-details/${detailId}] Successfully updated order detail`);
    return NextResponse.json({ success: true, detail: updatedDetail });
  } catch (e: any) {
    console.error('[PATCH /order-details] unexpected error', e);
    return NextResponse.json({ error: `Unexpected error: ${e.message || String(e)}` }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ detailId: string }> }
) {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { detailId: detailIdParam } = await context.params;
  const detailId = parseInt(detailIdParam, 10);
  if (!detailId || Number.isNaN(detailId)) {
    return NextResponse.json({ error: 'Invalid order detail id' }, { status: 400 });
  }

  try {
    console.log(`[DELETE /order-details/${detailId}] Starting deletion process`);

    // First, verify the order detail exists
    const { data: detailExists, error: checkErr } = await supabaseAdmin
      .from('order_details')
      .select('order_detail_id, order_id, product_id')
      .eq('order_detail_id', detailId)
      .single();

    if (checkErr || !detailExists) {
      console.error(`[DELETE /order-details/${detailId}] Order detail not found`, checkErr);
      return NextResponse.json({ error: 'Order detail not found' }, { status: 404 });
    }

    console.log(`[DELETE /order-details/${detailId}] Order detail found for order ${detailExists.order_id}, product ${detailExists.product_id}`);

    // Delete the order detail
    const { error: delErr } = await supabaseAdmin
      .from('order_details')
      .delete()
      .eq('order_detail_id', detailId);

    if (delErr) {
      console.error(`[DELETE /order-details/${detailId}] Failed to delete order detail`, delErr);
      return NextResponse.json({ error: `Failed to delete order detail: ${delErr.message}` }, { status: 500 });
    }

    console.log(`[DELETE /order-details/${detailId}] Successfully deleted order detail`);
    return NextResponse.json({ success: true, order_id: detailExists.order_id });
  } catch (e: any) {
    console.error('[DELETE /order-details] unexpected error', e);
    return NextResponse.json({ error: `Unexpected error: ${e.message || String(e)}` }, { status: 500 });
  }
}
