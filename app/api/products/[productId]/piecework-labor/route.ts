import { NextRequest, NextResponse } from 'next/server';

import { parsePositiveInt, productExistsInOrg, requireProductsAccess } from '@/lib/api/products-access';
import { computeProductPieceworkLabor } from '@/lib/piecework/productCosting';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  try {
    const { productId } = await params;
    const productIdNum = parsePositiveInt(productId);

    if (!productIdNum) {
      return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
    }

    const exists = await productExistsInOrg(productIdNum, auth.orgId);
    if (!exists) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const lines = await computeProductPieceworkLabor(String(productIdNum), auth.orgId, supabaseAdmin);
    return NextResponse.json({
      lines,
      total: lines.reduce((sum, line) => sum + line.total, 0),
    });
  } catch (error) {
    console.error('Error computing product piecework labor:', error);
    return NextResponse.json({ error: 'Failed to compute piecework labor' }, { status: 500 });
  }
}
