type CompanySettingsRow = {
  company_name: string | null;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  website: string | null;
};

type SupplierEmailRow = {
  email: string | null;
};

type SupabaseLike = {
  from: (table: string) => any;
};

function fallbackCompanyInfo() {
  return {
    name: process.env.COMPANY_NAME || 'Unity',
    email: process.env.EMAIL_FROM || 'purchasing@example.com',
    phone: process.env.COMPANY_PHONE || '',
    address: process.env.COMPANY_ADDRESS || '',
    website: undefined as string | undefined,
  };
}

function toCompanyInfo(row: CompanySettingsRow | null | undefined) {
  const fallback = fallbackCompanyInfo();
  if (!row) return fallback;

  const address = [
    row.address_line1,
    row.address_line2,
    [row.city, row.postal_code].filter(Boolean).join(' ').trim(),
    row.country,
  ].filter(Boolean);

  return {
    name: row.company_name || fallback.name,
    email: row.email || fallback.email,
    phone: row.phone || fallback.phone,
    address: address.join(', ') || fallback.address,
    website: row.website || undefined,
  };
}

const COMPANY_INFO_SELECT =
  'company_name,email,phone,address_line1,address_line2,city,postal_code,country,website';

export async function getCompanyInfo(supabase: SupabaseLike, orgId: string) {
  const { data: settings, error } = await supabase
    .from('quote_company_settings')
    .select(COMPANY_INFO_SELECT)
    .eq('org_id', orgId)
    .maybeSingle();

  if (!error && settings) {
    return toCompanyInfo(settings as CompanySettingsRow);
  }

  const { data: legacySettings } = await supabase
    .from('quote_company_settings')
    .select(COMPANY_INFO_SELECT)
    .eq('setting_id', 1)
    .maybeSingle();

  return toCompanyInfo(legacySettings as CompanySettingsRow | null);
}

export async function resolvePrimarySupplierEmail(
  supabase: SupabaseLike,
  supplierId: number,
  orgId: string,
) {
  const { data: emailRows, error } = await supabase
    .from('supplier_emails')
    .select('email, is_primary')
    .eq('supplier_id', supplierId)
    .eq('org_id', orgId)
    .order('is_primary', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return ((emailRows ?? []) as SupplierEmailRow[])
    .map((row) => (typeof row.email === 'string' ? row.email.trim() : ''))
    .find(Boolean) ?? null;
}
