import { NextRequest, NextResponse } from 'next/server';

import { parsePositiveInt, requireProductsAccess } from '@/lib/api/products-access';
import { supabaseAdmin } from '@/lib/supabase-admin';

async function resolveCategoryRateId(jobId: number, today: string): Promise<number | null> {
  const { data: job, error: jobError } = await supabaseAdmin
    .from('jobs')
    .select('category_id')
    .eq('job_id', jobId)
    .maybeSingle();

  if (jobError) throw jobError;
  if (!job?.category_id) return null;

  const { data, error } = await supabaseAdmin
    .from('job_category_rates')
    .select('rate_id')
    .eq('category_id', job.category_id)
    .lte('effective_date', today)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .order('effective_date', { ascending: false })
    .limit(1);

  if (error) throw error;
  return data && data.length > 0 ? Number(data[0].rate_id) : null;
}

type RouteParams = {
  productId?: string;
};

type DuplicatePayload = {
  internal_code?: string;
  name?: string;
  copy_categories?: boolean;
  copy_bom?: boolean;
  copy_bol?: boolean;
  copy_overhead?: boolean;
};

function normalizeFlag(value: unknown, defaultValue = true): boolean {
  return typeof value === 'boolean' ? value : defaultValue;
}

async function cleanupDuplicatedProduct(productId: number) {
  await Promise.allSettled([
    supabaseAdmin.from('product_overhead_costs').delete().eq('product_id', productId),
    supabaseAdmin.from('billoflabour').delete().eq('product_id', productId),
    supabaseAdmin.from('billofmaterials').delete().eq('product_id', productId),
    supabaseAdmin.from('product_category_assignments').delete().eq('product_id', productId),
    supabaseAdmin.from('products').delete().eq('product_id', productId),
  ]);
}

export async function POST(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const params = await context.params;
  const sourceProductId = parsePositiveInt(params.productId);
  if (!sourceProductId) {
    return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as DuplicatePayload | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const internalCode = typeof body.internal_code === 'string' ? body.internal_code.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const copyCategories = normalizeFlag(body.copy_categories, true);
  const copyBom = normalizeFlag(body.copy_bom, true);
  const copyBol = normalizeFlag(body.copy_bol, true);
  const copyOverhead = normalizeFlag(body.copy_overhead, true);

  if (!internalCode) {
    return NextResponse.json({ error: 'Product code is required' }, { status: 400 });
  }

  if (!name) {
    return NextResponse.json({ error: 'Product name is required' }, { status: 400 });
  }

  let newProductId: number | null = null;

  try {
    const { data: sourceProduct, error: sourceProductError } = await supabaseAdmin
      .from('products')
      .select('product_id, internal_code, name, description')
      .eq('product_id', sourceProductId)
      .eq('org_id', auth.orgId)
      .maybeSingle();

    if (sourceProductError) {
      console.error('[product-duplicate] failed loading source product', sourceProductError);
      return NextResponse.json({ error: 'Failed to load source product' }, { status: 500 });
    }

    if (!sourceProduct) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const { data: existingProduct, error: existingProductError } = await supabaseAdmin
      .from('products')
      .select('product_id')
      .eq('internal_code', internalCode)
      .eq('org_id', auth.orgId)
      .maybeSingle();

    if (existingProductError) {
      console.error('[product-duplicate] failed validating target code', existingProductError);
      return NextResponse.json({ error: 'Failed to validate product code' }, { status: 500 });
    }

    if (existingProduct) {
      return NextResponse.json(
        { error: 'Product code already exists for this organization' },
        { status: 409 }
      );
    }

    // Pre-fetch and pre-resolve BOL rates BEFORE creating any rows, so a 400
    // on missing rates cannot leave a partially-duplicated product behind
    // (the catch-block cleanup only runs on throws, not direct returns).
    // Legacy rate_id is required by billoflabour_pay_pairing_chk for hourly rows.
    let bolResolved: Array<{ row: any; rateId: number | null }> | null = null;
    if (copyBol) {
      const { data: bolRows, error: bolRowsError } = await supabaseAdmin
        .from('billoflabour')
        .select(
          'job_id, time_required, time_unit, quantity, rate_id, hourly_rate_id, pay_type, piece_rate_id'
        )
        .eq('product_id', sourceProductId)
        .eq('org_id', auth.orgId);

      if (bolRowsError) {
        console.error('[product-duplicate] failed loading source BOL', bolRowsError);
        return NextResponse.json({ error: 'Failed to load source BOL' }, { status: 500 });
      }

      const today = new Date().toISOString().split('T')[0];
      bolResolved = [];
      for (const row of bolRows ?? []) {
        const payType = (row.pay_type ?? 'hourly') as 'hourly' | 'piece';
        // Preserve the source row's rate_id when it has one (clone semantics);
        // otherwise resolve a fresh rate from the job's category.
        let rateId: number | null = row.rate_id ?? null;
        if (payType === 'hourly' && rateId == null) {
          rateId = await resolveCategoryRateId(row.job_id, today);
          if (!rateId) {
            return NextResponse.json(
              { error: `No active hourly rate for job ${row.job_id}'s category` },
              { status: 400 },
            );
          }
        }
        bolResolved.push({ row, rateId });
      }
    }

    const { data: newProduct, error: newProductError } = await supabaseAdmin
      .from('products')
      .insert({
        internal_code: internalCode,
        name,
        description: sourceProduct.description ?? null,
        org_id: auth.orgId,
      })
      .select('product_id, internal_code, name, description')
      .single();

    if (newProductError || !newProduct) {
      console.error('[product-duplicate] failed creating duplicate product', newProductError);
      return NextResponse.json({ error: 'Failed to create duplicate product' }, { status: 500 });
    }

    newProductId = Number(newProduct.product_id);

    if (copyCategories) {
      const { data: categoryRows, error: categoryRowsError } = await supabaseAdmin
        .from('product_category_assignments')
        .select('product_cat_id')
        .eq('product_id', sourceProductId);

      if (categoryRowsError) {
        throw categoryRowsError;
      }

      if ((categoryRows ?? []).length > 0) {
        const { error: insertCategoryError } = await supabaseAdmin
          .from('product_category_assignments')
          .insert(
            (categoryRows ?? []).map((row: any) => ({
              product_id: newProductId,
              product_cat_id: row.product_cat_id,
            }))
          );

        if (insertCategoryError) {
          throw insertCategoryError;
        }
      }
    }

    if (copyBom) {
      const { data: bomRows, error: bomRowsError } = await supabaseAdmin
        .from('billofmaterials')
        .select(
          'component_id, quantity_required, supplier_component_id, is_substitutable, is_cutlist_item, cutlist_category, cutlist_dimensions'
        )
        .eq('product_id', sourceProductId);

      if (bomRowsError) {
        throw bomRowsError;
      }

      if ((bomRows ?? []).length > 0) {
        const { error: insertBomError } = await supabaseAdmin.from('billofmaterials').insert(
          (bomRows ?? []).map((row: any) => ({
            product_id: newProductId,
            component_id: row.component_id ?? null,
            quantity_required: row.quantity_required,
            supplier_component_id: row.supplier_component_id ?? null,
            is_substitutable: row.is_substitutable ?? false,
            is_cutlist_item: row.is_cutlist_item ?? false,
            cutlist_category: row.cutlist_category ?? null,
            cutlist_dimensions: row.cutlist_dimensions ?? null,
          }))
        );

        if (insertBomError) {
          throw insertBomError;
        }
      }
    }

    if (copyBol && bolResolved && bolResolved.length > 0) {
      const insertRows = bolResolved.map(({ row, rateId }) => {
        const payType = (row.pay_type ?? 'hourly') as 'hourly' | 'piece';
        return {
          product_id: newProductId,
          job_id: row.job_id,
          time_required: row.time_required,
          time_unit: row.time_unit ?? 'hours',
          quantity: row.quantity,
          rate_id: payType === 'hourly' ? rateId : null,
          hourly_rate_id: row.hourly_rate_id ?? null,
          pay_type: payType,
          piece_rate_id: row.piece_rate_id ?? null,
          org_id: auth.orgId,
        };
      });

      const { error: insertBolError } = await supabaseAdmin.from('billoflabour').insert(insertRows);

      if (insertBolError) {
        throw insertBolError;
      }
    }

    if (copyOverhead) {
      const { data: overheadRows, error: overheadRowsError } = await supabaseAdmin
        .from('product_overhead_costs')
        .select('element_id, quantity, override_value')
        .eq('product_id', sourceProductId);

      if (overheadRowsError) {
        throw overheadRowsError;
      }

      if ((overheadRows ?? []).length > 0) {
        const { error: insertOverheadError } = await supabaseAdmin
          .from('product_overhead_costs')
          .insert(
            (overheadRows ?? []).map((row: any) => ({
              product_id: newProductId,
              element_id: row.element_id,
              quantity: row.quantity,
              override_value: row.override_value ?? null,
            }))
          );

        if (insertOverheadError) {
          throw insertOverheadError;
        }
      }
    }

    return NextResponse.json(
      {
        success: true,
        product: {
          product_id: Number(newProduct.product_id),
          internal_code: newProduct.internal_code,
          name: newProduct.name,
          description: newProduct.description ?? null,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[product-duplicate] unexpected duplicate error', error);

    if (newProductId) {
      await cleanupDuplicatedProduct(newProductId);
    }

    return NextResponse.json({ error: 'Failed to duplicate product' }, { status: 500 });
  }
}
