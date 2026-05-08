import { NextRequest, NextResponse } from 'next/server';

import { parsePositiveInt, productExistsInOrg, requireProductsAccess } from '@/lib/api/products-access';
import { supabaseAdmin } from '@/lib/supabase-admin';

type RouteParams = {
  productId?: string;
  bolId?: string;
};

type BolUpdatePayload = {
  job_id?: number;
  pay_type?: 'hourly' | 'piece';
  time_required?: number | null;
  time_unit?: 'hours' | 'minutes' | 'seconds';
  quantity?: number;
  drawing_url?: string | null;
  use_product_drawing?: boolean;
};

async function bolBelongsToProduct(productId: number, bolId: number, orgId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('billoflabour')
    .select('bol_id')
    .eq('bol_id', bolId)
    .eq('product_id', productId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Boolean(data);
}

async function resolveHourlyRateId(jobId: number, today: string): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from('job_hourly_rates')
    .select('rate_id')
    .eq('job_id', jobId)
    .lte('effective_date', today)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .order('effective_date', { ascending: false })
    .limit(1);

  if (error) throw error;
  return data && data.length > 0 ? Number(data[0].rate_id) : null;
}

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

async function resolvePieceRateId(jobId: number, productId: number, today: string): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from('piece_work_rates')
    .select('rate_id, product_id')
    .eq('job_id', jobId)
    .lte('effective_date', today)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .order('effective_date', { ascending: false });

  if (error) throw error;

  const chosen =
    (data || []).find((row: any) => row.product_id === productId) ||
    (data || []).find((row: any) => row.product_id == null) ||
    null;

  return chosen ? Number((chosen as any).rate_id) : null;
}

export async function PATCH(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const params = await context.params;
  const productId = parsePositiveInt(params.productId);
  const bolId = parsePositiveInt(params.bolId);
  if (!productId || !bolId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  const payload = (await request.json().catch(() => null)) as BolUpdatePayload | null;
  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const productExists = await productExistsInOrg(productId, auth.orgId);
    if (!productExists) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const belongs = await bolBelongsToProduct(productId, bolId, auth.orgId);
    if (!belongs) {
      return NextResponse.json({ error: 'BOL row not found for product' }, { status: 404 });
    }

    const today = new Date().toISOString().split('T')[0];
    const updateData: Record<string, unknown> = {};
    const jobId = 'job_id' in payload ? parsePositiveInt(payload.job_id) : null;
    const payType = payload.pay_type;
    if (payType !== undefined && payType !== 'hourly' && payType !== 'piece') {
      return NextResponse.json({ error: 'pay_type must be "hourly" or "piece"' }, { status: 400 });
    }

    if (jobId) {
      updateData.job_id = jobId;
    }

    if ('quantity' in payload) {
      const quantity = Number(payload.quantity ?? 0);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return NextResponse.json({ error: 'quantity must be greater than 0' }, { status: 400 });
      }
      updateData.quantity = quantity;
    }

    if ('drawing_url' in payload) {
      updateData.drawing_url = payload.drawing_url ?? null;
    }
    if ('use_product_drawing' in payload) {
      updateData.use_product_drawing = Boolean(payload.use_product_drawing);
    }
    if (updateData.drawing_url && updateData.use_product_drawing) {
      return NextResponse.json({ error: 'Choose either a custom drawing or product drawing' }, { status: 400 });
    }

    if (payType === undefined) {
      // pay_type not being changed — only update other fields
    } else if (payType === 'piece') {

      const chosenJobId = jobId || Number((await supabaseAdmin.from('billoflabour').select('job_id').eq('bol_id', bolId).single()).data?.job_id);
      updateData.pay_type = 'piece';
      updateData.time_required = null;
      updateData.time_unit = 'hours';
      updateData.rate_id = null;
      updateData.piece_rate_id = await resolvePieceRateId(chosenJobId, productId, today);
    } else {
      const chosenJobId = jobId || Number((await supabaseAdmin.from('billoflabour').select('job_id').eq('bol_id', bolId).single()).data?.job_id);
      const timeRequired = Number(payload.time_required ?? 0);
      if (!Number.isFinite(timeRequired) || timeRequired <= 0) {
        return NextResponse.json({ error: 'time_required must be greater than 0 for hourly jobs' }, { status: 400 });
      }
      const validTimeUnits = ['minutes', 'hours', 'seconds'];
      const timeUnit = payload.time_unit ?? 'minutes';
      if (!validTimeUnits.includes(timeUnit)) {
        return NextResponse.json({ error: `time_unit must be one of: ${validTimeUnits.join(', ')}` }, { status: 400 });
      }
      const categoryRateId = await resolveCategoryRateId(chosenJobId, today);
      if (!categoryRateId) {
        return NextResponse.json(
          { error: "No active hourly rate for this job's category" },
          { status: 400 },
        );
      }
      updateData.pay_type = 'hourly';
      updateData.time_required = timeRequired;
      updateData.time_unit = timeUnit;
      updateData.hourly_rate_id = await resolveHourlyRateId(chosenJobId, today);
      updateData.rate_id = categoryRateId;
      updateData.piece_rate_id = null;
    }

    const { data, error } = await supabaseAdmin
      .from('billoflabour')
      .update(updateData)
      .eq('bol_id', bolId)
      .eq('product_id', productId)
      .eq('org_id', auth.orgId)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[product-bol] failed updating BOL row', error);
      return NextResponse.json({ error: 'Failed to update BOL row' }, { status: 500 });
    }

    return NextResponse.json({ item: data });
  } catch (error) {
    console.error('[product-bol] unexpected patch error', error);
    return NextResponse.json({ error: 'Unexpected error while updating BOL row' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const params = await context.params;
  const productId = parsePositiveInt(params.productId);
  const bolId = parsePositiveInt(params.bolId);
  if (!productId || !bolId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  try {
    const productExists = await productExistsInOrg(productId, auth.orgId);
    if (!productExists) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const belongs = await bolBelongsToProduct(productId, bolId, auth.orgId);
    if (!belongs) {
      return NextResponse.json({ error: 'BOL row not found for product' }, { status: 404 });
    }

    const { error } = await supabaseAdmin
      .from('billoflabour')
      .delete()
      .eq('bol_id', bolId)
      .eq('product_id', productId)
      .eq('org_id', auth.orgId);

    if (error) {
      console.error('[product-bol] failed deleting BOL row', error);
      return NextResponse.json({ error: 'Failed to delete BOL row' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[product-bol] unexpected delete error', error);
    return NextResponse.json({ error: 'Unexpected error while deleting BOL row' }, { status: 500 });
  }
}
