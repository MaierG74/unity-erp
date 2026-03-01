import { supabase } from '@/lib/supabase';
import {
  type Order,
  type Product,
  type OrderAttachment,
  type OrderStatus,
  type FinishedGoodReservation,
} from '@/types/orders';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Fetch a single order with all related data (status, customer, quote, line items). */
export async function fetchOrderDetails(orderId: number): Promise<Order | null> {
  try {
    // First, fetch the order with basic information
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        status:order_statuses(status_id, status_name),
        customer:customers(*),
        quote:quotes(id, quote_number)
      `)
      .eq('order_id', orderId)
      .single();

    if (error) {
      console.error('Error fetching order details:', error);
      throw new Error('Failed to fetch order details');
    }

    if (!data) return null; // include quote relationship

    // Transform quote relationship from array to object
    const quoteObj = data.quote?.[0] || null;


    // Next, fetch the order details (line items)
    const { data: orderDetails, error: detailsError } = await supabase
      .from('order_details')
      .select(`
        *,
        product:products(*)
      `)
      .eq('order_id', orderId);

    if (detailsError) {
      console.error('Error fetching order line items:', detailsError);
    }

    // Transform the data to ensure proper structure
    return {
      ...data,
      quote: quoteObj,
      // Ensure status is properly structured
      status: data.status && data.status.length > 0
        ? {
            status_id: data.status[0]?.status_id || 0,
            status_name: data.status[0]?.status_name || 'Unknown'
          }
        : { status_id: 0, status_name: 'Unknown' },
      // Ensure total_amount is a number
      total_amount: data.total_amount !== null ? Number(data.total_amount) : null,
      // Add the order details
      details: orderDetails || []
    };
  } catch (error) {
    console.error('Error in fetchOrderDetails:', error);
    return null;
  }
}

/** Fetch attachments for an order, newest first. */
export async function fetchOrderAttachments(orderId: number): Promise<OrderAttachment[]> {
  try {
    const { data, error } = await supabase
      .from('order_attachments')
      .select('*')
      .eq('order_id', orderId)
      .order('uploaded_at', { ascending: false });

    if (error) {
      console.error('Error fetching order attachments:', error);
      throw new Error('Failed to fetch order attachments');
    }

    return data || [];
  } catch (error) {
    console.error('Error in fetchOrderAttachments:', error);
    return [];
  }
}

/** Fetch finished-good reservations for an order via the API route. */
export async function fetchFinishedGoodReservations(orderId: number): Promise<FinishedGoodReservation[]> {
  const response = await fetch(`/api/orders/${orderId}/fg-reservations`, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error('Failed to load finished-good reservations');
  }

  const payload = await response.json();
  return (payload?.reservations ?? []) as FinishedGoodReservation[];
}

/** Fetch all order statuses, sorted by name. */
export async function fetchOrderStatuses() {
  try {
    const { data, error } = await supabase
      .from('order_statuses')
      .select('*')
      .order('status_name');

    if (error) {
      console.error('Error fetching order statuses:', error);
      throw new Error('Failed to fetch order statuses');
    }

    return data || [];
  } catch (error) {
    console.error('Error in fetchOrderStatuses:', error);
    return [];
  }
}

/** Fetch all products. */
export async function fetchAvailableProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*');

  if (error) {
    console.error('Error fetching products:', error);
    return [];
  }

  return data;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Reserve finished goods for an order via the API route. */
export async function reserveFinishedGoods(orderId: number): Promise<FinishedGoodReservation[]> {
  const response = await fetch(`/api/orders/${orderId}/reserve-fg`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Failed to reserve finished goods');
  }

  const payload = await response.json();
  return (payload?.reservations ?? []) as FinishedGoodReservation[];
}

/** Release finished-good reservations for an order via the API route. */
export async function releaseFinishedGoods(orderId: number): Promise<number | null> {
  const response = await fetch(`/api/orders/${orderId}/release-fg`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Failed to release finished goods');
  }

  const payload = await response.json();
  return (payload?.released ?? null) as number | null;
}

/** Consume (deduct) finished goods for an order via the API route. */
export async function consumeFinishedGoods(orderId: number): Promise<Array<{ product_id: number; consumed_quantity: number }>> {
  const response = await fetch(`/api/orders/${orderId}/consume-fg`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Failed to consume finished goods');
  }

  const payload = await response.json();
  return (payload?.consumed ?? []) as Array<{ product_id: number; consumed_quantity: number }>;
}

/** Update the status of an order. */
export async function updateOrderStatus(orderId: number, statusId: number): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('orders')
      .update({ status_id: statusId })
      .eq('order_id', orderId);

    if (error) {
      console.error('Error updating order status:', error);
      throw new Error('Failed to update order status');
    }

    return true;
  } catch (error) {
    console.error('Error in updateOrderStatus:', error);
    return false;
  }
}

/** Add products (line items) to an order and update the order total. */
export async function addProductsToOrder(orderId: number, products: { product_id: number; quantity: number; unit_price: number }[]) {
  try {
    console.log('[DEBUG] Starting to add products to order:', { orderId, products });

    if (!orderId || !products.length) {
      console.error('[ERROR] Invalid input parameters:', { orderId, productsLength: products.length });
      throw new Error('Invalid parameters for adding products');
    }

    // Prepare order details with only the exact fields in the database schema
    const orderDetails = products.map(product => ({
      order_id: orderId,
      product_id: product.product_id,
      quantity: product.quantity,
      unit_price: product.unit_price
    }));

    console.log('[DEBUG] Prepared order details:', orderDetails);

    // Use a simple single insert operation
    const { data: insertedDetails, error: insertError } = await supabase
      .from('order_details')
      .insert(orderDetails)
      .select();

    if (insertError) {
      console.error('[ERROR] Error adding products to order:', insertError);
      throw new Error(`Failed to add products to order: ${insertError.message}`);
    }

    console.log('[DEBUG] Successfully added products:', insertedDetails);

    // Calculate the total increase
    const totalIncrease = products.reduce((sum, product) =>
      sum + (product.unit_price * product.quantity), 0);

    // Update the order total
    if (totalIncrease > 0) {
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select('total_amount')
        .eq('order_id', orderId)
        .single();

      if (orderError) {
        console.error('[ERROR] Error fetching order total:', orderError);
        // Continue anyway since the products were added successfully
      } else {
        const currentTotal = orderData?.total_amount || 0;
        const newTotal = parseFloat(currentTotal.toString()) + totalIncrease;

        console.log('[DEBUG] Updating order total:', { currentTotal, totalIncrease, newTotal });

        const { error: updateError } = await supabase
          .from('orders')
          .update({ total_amount: newTotal })
          .eq('order_id', orderId);

        if (updateError) {
          console.error('[ERROR] Error updating order total:', updateError);
          // Continue anyway since the products were added successfully
        }
      }
    }

    return {
      success: true,
      insertedDetails: insertedDetails || [],
      totalIncrease
    };
  } catch (error) {
    console.error('[ERROR] Error in addProductsToOrder:', error);
    throw error;
  }
}

/** Delete an order attachment by its ID. */
export async function deleteAttachment(attachmentId: number): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('order_attachments')
      .delete()
      .eq('attachment_id', attachmentId);

    if (error) {
      console.error('Error deleting attachment:', error);
      throw new Error('Failed to delete attachment');
    }

    return true;
  } catch (error) {
    console.error('Error in deleteAttachment:', error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Debug utilities
// ---------------------------------------------------------------------------

/** DEBUG ONLY — Inspect the bill-of-materials table for a given product. */
export async function inspectBillOfMaterials(productId: number) {
  console.log(`[DEBUG] Inspecting BOM for product ${productId}`);

  try {
    // Check what tables exist in the public schema
    const { data: tables, error: tablesError } = await supabase
      .from('pg_catalog.pg_tables')
      .select('tablename')
      .eq('schemaname', 'public');

    console.log(`[DEBUG] Available tables:`, tables?.map(t => t.tablename).join(', ') || 'None found');

    if (tablesError) {
      console.error(`[ERROR] Error listing tables:`, tablesError);
    }

    // Try various possible BOM table names
    const possibleBomTables = ['billofmaterials', 'bill_of_materials', 'product_components', 'bom'];

    for (const tableName of possibleBomTables) {
      console.log(`[DEBUG] Checking if table exists: ${tableName}`);

      try {
        const { data, error } = await supabase
          .from(tableName)
          .select('count(*)')
          .limit(1);

        if (!error) {
          console.log(`[DEBUG] Table ${tableName} exists!`);

          // If table exists, check for product's BOM
          const { data: productBom, error: productBomError } = await supabase
            .from(tableName)
            .select('*')
            .eq('product_id', productId);

          if (!productBomError && productBom && productBom.length > 0) {
            console.log(`[DEBUG] Found ${productBom.length} BOM items for product ${productId} in table ${tableName}`);
            console.log(`[DEBUG] First BOM item:`, JSON.stringify(productBom[0]));
          } else {
            console.log(`[DEBUG] No BOM found for product ${productId} in table ${tableName}`);
          }
        } else {
          console.log(`[DEBUG] Table ${tableName} doesn't exist or not accessible`);
        }
      } catch (err) {
        console.error(`[ERROR] Error checking table ${tableName}:`, err);
      }
    }

    // Also try a direct query to see component relationships
    try {
      const { data: productComponents, error: pcError } = await supabase
        .rpc('get_product_components', { product_id: productId });

      if (pcError) {
        console.log(`[DEBUG] RPC get_product_components not available:`, pcError.message);
      } else {
        console.log(`[DEBUG] Product components via RPC:`, productComponents);
      }
    } catch (err) {
      console.log(`[DEBUG] RPC not available:`, err);
    }

    return {
      tables,
      message: 'Check console logs for full inspection results'
    };
  } catch (error) {
    console.error(`[ERROR] Error in inspectBillOfMaterials:`, error);
    return null;
  }
}
