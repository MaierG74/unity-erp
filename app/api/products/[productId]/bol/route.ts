import { NextRequest, NextResponse } from 'next/server';

import { parsePositiveInt, productExistsInOrg, requireProductsAccess } from '@/lib/api/products-access';
import { supabaseAdmin } from '@/lib/supabase-admin';

type RouteParams = {
  productId?: string;
};

type BolPayload = {
  job_id?: number;
  pay_type?: 'hourly' | 'piece';
  time_required?: number | null;
  time_unit?: 'hours' | 'minutes' | 'seconds';
  quantity?: number;
};

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

export async function POST(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const params = await context.params;
  const productId = parsePositiveInt(params.productId);
  if (!productId) {
    return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
  }

  const payload = (await request.json().catch(() => null)) as BolPayload | null;
  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const jobId = parsePositiveInt(payload.job_id);
  const quantity = Number(payload.quantity ?? 0);
  const payType = payload.pay_type ?? 'hourly';
  if (payType !== 'hourly' && payType !== 'piece') {
    return NextResponse.json({ error: 'pay_type must be "hourly" or "piece"' }, { status: 400 });
  }
  if (!jobId) {
    return NextResponse.json({ error: 'job_id is required' }, { status: 400 });
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json({ error: 'quantity must be greater than 0' }, { status: 400 });
  }

  try {
    const productExists = await productExistsInOrg(productId, auth.orgId);
    if (!productExists) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const today = new Date().toISOString().split('T')[0];
    const insertData: Record<string, unknown> = {
      product_id: productId,
      job_id: jobId,
      quantity,
      org_id: auth.orgId,
    };

    if (payType === 'piece') {
      insertData.pay_type = 'piece';
      insertData.time_required = null;
      insertData.time_unit = 'hours';
      insertData.rate_id = null;
      insertData.piece_rate_id = await resolvePieceRateId(jobId, productId, today);
    } else {
      const timeRequired = Number(payload.time_required ?? 0);
      if (!Number.isFinite(timeRequired) || timeRequired <= 0) {
        return NextResponse.json({ error: 'time_required must be greater than 0 for hourly jobs' }, { status: 400 });
      }
      const validTimeUnits = ['minutes', 'hours', 'seconds'];
      const timeUnit = payload.time_unit ?? 'minutes';
      if (!validTimeUnits.includes(timeUnit)) {
        return NextResponse.json({ error: `time_unit must be one of: ${validTimeUnits.join(', ')}` }, { status: 400 });
      }
      const categoryRateId = await resolveCategoryRateId(jobId, today);
      if (!categoryRateId) {
        return NextResponse.json(
          { error: "No active hourly rate for this job's category" },
          { status: 400 },
        );
      }
      insertData.pay_type = 'hourly';
      insertData.time_required = timeRequired;
      insertData.time_unit = timeUnit;
      insertData.hourly_rate_id = await resolveHourlyRateId(jobId, today);
      insertData.rate_id = categoryRateId;
      insertData.piece_rate_id = null;
    }

    const { data, error } = await supabaseAdmin
      .from('billoflabour')
      .insert(insertData)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[product-bol] failed inserting BOL row', error);
      return NextResponse.json({ error: 'Failed to save BOL row' }, { status: 500 });
    }

    return NextResponse.json({ item: data });
  } catch (error) {
    console.error('[product-bol] unexpected insert error', error);
    return NextResponse.json({ error: 'Unexpected error while saving BOL row' }, { status: 500 });
  }
}
