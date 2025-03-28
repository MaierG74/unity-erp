import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Create authenticated Supabase client using environment variables
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  try {
    const orderId = parseInt(params.orderId, 10);
    const body = await request.json();
    const { products } = body;

    console.log('[API] Adding products to order:', { orderId, products });

    if (!orderId || !products || !Array.isArray(products) || products.length === 0) {
      return NextResponse.json(
        { error: 'Invalid request parameters' },
        { status: 400 }
      );
    }

    // Verify order exists
    const { data: orderExists, error: orderCheckError } = await supabaseAdmin
      .from('orders')
      .select('order_id')
      .eq('order_id', orderId)
      .single();

    if (orderCheckError || !orderExists) {
      return NextResponse.json(
        { error: `Order with ID ${orderId} does not exist` },
        { status: 404 }
      );
    }

    // Insert products into order_details
    const { data: insertedDetails, error: insertError } = await supabaseAdmin
      .from('order_details')
      .insert(products)
      .select();

    if (insertError) {
      console.error('[API] Error inserting products:', insertError);
      return NextResponse.json(
        { error: 'Failed to add products to order', details: insertError },
        { status: 500 }
      );
    }

    // Calculate total increase
    const totalIncrease = products.reduce(
      (sum: number, detail: any) => sum + (detail.unit_price * detail.quantity),
      0
    );

    // Get current total
    const { data: orderData, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('total_amount')
      .eq('order_id', orderId)
      .single();

    if (orderError) {
      console.error('[API] Error fetching order total:', orderError);
      // Continue anyway since products were added
    }

    const currentTotal = orderData?.total_amount || 0;
    const newTotal = parseFloat(currentTotal) + totalIncrease;

    // Update order total
    const { data: updateData, error: updateError } = await supabaseAdmin
      .from('orders')
      .update({ total_amount: newTotal })
      .eq('order_id', orderId)
      .select();

    if (updateError) {
      console.error('[API] Error updating order total:', updateError);
      // Continue anyway since products were added
    }

    return NextResponse.json({
      success: true,
      insertedDetails: insertedDetails || [],
      totalAmount: newTotal
    });
  } catch (error) {
    console.error('[API] Unhandled error:', error);
    return NextResponse.json(
      { error: 'Server error', details: String(error) },
      { status: 500 }
    );
  }
} 