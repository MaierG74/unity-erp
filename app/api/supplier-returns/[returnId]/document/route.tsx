import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { renderToStream } from '@react-pdf/renderer';
import ReturnGoodsPDFDocument from '@/components/features/purchasing/ReturnGoodsPDFDocument';
import * as React from 'react';

interface SupplierOrderReturn {
  return_id: number;
  goods_return_number: string | null;
  quantity_returned: number;
  reason: string;
  return_type: 'rejection' | 'later_return';
  return_date: string;
  notes: string | null;
  batch_id: number | null;
  supplier_order_id: number;
  supplier_orders: {
    order_id: number;
    purchase_order_id: number;
    supplier_component_id: number;
    suppliercomponents: {
      supplier_code: string;
      component: {
        internal_code: string;
        description: string | null;
      };
      supplier: {
        supplier_id: number;
        name: string;
        contact_info: string | null;
        supplier_emails: Array<{
          email: string;
          is_primary: boolean;
        }>;
      };
    };
    purchase_orders: {
      q_number: string;
    };
  };
}

/**
 * GET /api/supplier-returns/[returnId]/document
 *
 * Generates a PDF document for a supplier return and uploads to Supabase Storage.
 * Returns the document URL.
 *
 * If batch_id is present, generates a single PDF for all returns in that batch.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ returnId: string }> | { returnId: string } }
) {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Handle params as either a Promise (Next.js 15+) or direct object
  const resolvedParams = params instanceof Promise ? await params : params;
  const returnId = parseInt(resolvedParams.returnId, 10);

  if (!returnId || Number.isNaN(returnId)) {
    return NextResponse.json({ error: 'Invalid return ID' }, { status: 400 });
  }

  try {
    console.log(`[GET /api/supplier-returns/${returnId}/document] Starting PDF generation`);

    // Fetch the return with all related data
    const { data: returnRecord, error: returnError } = await supabaseAdmin
      .from('supplier_order_returns')
      .select(`
        return_id,
        goods_return_number,
        quantity_returned,
        reason,
        return_type,
        return_date,
        notes,
        batch_id,
        supplier_order_id,
        supplier_orders(
          order_id,
          purchase_order_id,
          supplier_component_id,
          suppliercomponents(
            supplier_code,
            component:components(
              internal_code,
              description
            ),
            supplier:suppliers(
              supplier_id,
              name,
              contact_info,
              supplier_emails(
                email,
                is_primary
              )
            )
          ),
          purchase_orders(
            q_number
          )
        )
      `)
      .eq('return_id', returnId)
      .single();

    if (returnError || !returnRecord) {
      console.error(`[GET /api/supplier-returns/${returnId}/document] Return not found:`, returnError);
      console.error(`[GET /api/supplier-returns/${returnId}/document] Return data:`, returnRecord);
      return NextResponse.json({
        error: 'Return not found',
        details: returnError?.message,
        code: returnError?.code
      }, { status: 404 });
    }

    const typedReturn = returnRecord as unknown as SupplierOrderReturn;

    // Check if this is part of a batch - if so, fetch all returns in the batch
    let allReturns: SupplierOrderReturn[];
    let batchId: number | null = null;

    if (typedReturn.batch_id) {
      batchId = typedReturn.batch_id;
      console.log(`[GET /api/supplier-returns/${returnId}/document] Batch return detected: ${batchId}`);

      const { data: batchReturns, error: batchError } = await supabaseAdmin
        .from('supplier_order_returns')
        .select(`
          return_id,
          goods_return_number,
          quantity_returned,
          reason,
          return_type,
          return_date,
          notes,
          batch_id,
          supplier_order_id,
          supplier_orders(
            order_id,
            purchase_order_id,
            supplier_component_id,
            suppliercomponents(
              supplier_code,
              component:components(
                internal_code,
                description
              ),
              supplier:suppliers(
                supplier_id,
                name,
                contact_info,
                supplier_emails(
                  email,
                  is_primary
                )
              )
            ),
            purchase_orders(
              q_number
            )
          )
        `)
        .eq('batch_id', batchId);

      if (batchError) {
        console.error(`[GET /api/supplier-returns/${returnId}/document] Failed to fetch batch returns:`, batchError);
        return NextResponse.json({ error: 'Failed to fetch batch returns' }, { status: 500 });
      }

      allReturns = batchReturns as unknown as SupplierOrderReturn[];
    } else {
      allReturns = [typedReturn];
    }

    // Extract supplier info from first return (all returns in batch should have same supplier)
    const firstReturn = allReturns[0];
    const supplierComponent = Array.isArray(firstReturn.supplier_orders.suppliercomponents)
      ? firstReturn.supplier_orders.suppliercomponents[0]
      : firstReturn.supplier_orders.suppliercomponents;

    const supplier = Array.isArray(supplierComponent.supplier)
      ? supplierComponent.supplier[0]
      : supplierComponent.supplier;

    const purchaseOrder = Array.isArray(firstReturn.supplier_orders.purchase_orders)
      ? firstReturn.supplier_orders.purchase_orders[0]
      : firstReturn.supplier_orders.purchase_orders;

    // Get primary email for supplier (now nested under supplier)
    const emailRecords = Array.isArray(supplier.supplier_emails)
      ? supplier.supplier_emails
      : [];
    const primaryEmail = emailRecords.find(e => e.is_primary)?.email || emailRecords[0]?.email;

    // Fetch company info for PDF header
    const { data: settings } = await supabaseAdmin
      .from('quote_company_settings')
      .select('*')
      .eq('setting_id', 1)
      .single();

    const companyAddressParts = [
      settings?.address_line1,
      settings?.address_line2,
      [settings?.city, settings?.postal_code].filter(Boolean).join(' ').trim(),
      settings?.country,
    ].filter((part) => part && part.length > 0);

    const companyInfo = {
      name: settings?.company_name || 'Your Company Name',
      address: companyAddressParts.join('\n') || 'Your Address',
      phone: settings?.phone || '+27 XX XXX XXXX',
      email: settings?.email || 'info@yourcompany.com',
    };

    // Determine overall return type for the document
    const returnTypes = new Set(allReturns.map(r => r.return_type));
    const overallReturnType: 'rejection' | 'later_return' | 'mixed' =
      returnTypes.size > 1 ? 'mixed' : (returnTypes.values().next().value as 'rejection' | 'later_return');

    // Transform returns into items for PDF
    const items = allReturns.map(ret => {
      const sc = Array.isArray(ret.supplier_orders.suppliercomponents)
        ? ret.supplier_orders.suppliercomponents[0]
        : ret.supplier_orders.suppliercomponents;

      const comp = Array.isArray(sc.component) ? sc.component[0] : sc.component;

      return {
        component_code: comp.internal_code,
        component_name: comp.description || '',
        quantity_returned: ret.quantity_returned,
        reason: ret.reason,
        return_type: ret.return_type,
      };
    });

    // Combine notes from all returns (if batch)
    const allNotes = allReturns
      .map(r => r.notes)
      .filter(Boolean)
      .join('\n\n');

    const supplierInfo = {
      supplier_name: supplier.name,
      contact_person: supplier.contact_info || undefined,
      phone: undefined, // Phone not available in suppliers table
      email: primaryEmail,
    };

    // Generate GRN (should be same for all returns in batch)
    const goodsReturnNumber = firstReturn.goods_return_number || 'PENDING';

    console.log(`[GET /api/supplier-returns/${returnId}/document] Rendering PDF for GRN: ${goodsReturnNumber}`);

    // Render PDF using renderToStream (server-side compatible)
    const pdfStream = await renderToStream(
      <ReturnGoodsPDFDocument
        goodsReturnNumber={goodsReturnNumber}
        purchaseOrderNumber={purchaseOrder.q_number}
        purchaseOrderId={firstReturn.supplier_orders.purchase_order_id}
        returnDate={firstReturn.return_date}
        items={items}
        supplierInfo={supplierInfo}
        companyInfo={companyInfo}
        notes={allNotes || undefined}
        returnType={overallReturnType}
      />
    );

    // Convert stream to buffer
    const chunks: Buffer[] = [];
    for await (const chunk of pdfStream) {
      chunks.push(Buffer.from(chunk));
    }
    const pdfBuffer = Buffer.concat(chunks);

    // Upload to Supabase Storage
    const bucket = 'supplier-returns';
    const purchaseOrderId = firstReturn.supplier_orders.purchase_order_id;
    const filename = batchId
      ? `${purchaseOrderId}/batch_${batchId}_${goodsReturnNumber}_auto.pdf`
      : `${purchaseOrderId}/return_${returnId}_${goodsReturnNumber}_auto.pdf`;

    console.log(`[GET /api/supplier-returns/${returnId}/document] Uploading to storage: ${bucket}/${filename}`);

    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from(bucket)
      .upload(filename, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true, // Overwrite if exists
      });

    if (uploadError) {
      console.error(`[GET /api/supplier-returns/${returnId}/document] Storage upload failed:`, uploadError);
      return NextResponse.json({ error: `Failed to upload PDF: ${uploadError.message}` }, { status: 500 });
    }

    console.log(`[GET /api/supplier-returns/${returnId}/document] Upload successful:`, uploadData);

    // Get public URL (even though bucket is private, we store the path)
    const { data: urlData } = supabaseAdmin.storage
      .from(bucket)
      .getPublicUrl(filename);

    const documentUrl = urlData.publicUrl;

    // Update all returns in the batch with the document_url
    const returnIdsToUpdate = allReturns.map(r => r.return_id);

    const { error: updateError } = await supabaseAdmin
      .from('supplier_order_returns')
      .update({
        document_url: documentUrl,
        document_version: 1,
      })
      .in('return_id', returnIdsToUpdate);

    if (updateError) {
      console.warn(`[GET /api/supplier-returns/${returnId}/document] Failed to update document_url:`, updateError);
      // Don't fail the request - PDF was generated successfully
    }

    console.log(`[GET /api/supplier-returns/${returnId}/document] PDF generation complete`);

    return NextResponse.json({
      success: true,
      documentUrl,
      goodsReturnNumber,
      itemCount: items.length,
      batchId,
    });
  } catch (error: any) {
    console.error(`[GET /api/supplier-returns/${returnId}/document] Unexpected error:`, error);
    return NextResponse.json(
      { error: `Failed to generate document: ${error.message}` },
      { status: 500 }
    );
  }
}
