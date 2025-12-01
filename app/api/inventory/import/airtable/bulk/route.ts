import { NextRequest, NextResponse } from 'next/server';

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = 'Components';

// Helper to fetch supplier name from Airtable
async function getSupplierName(recordId: string): Promise<string | null> {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) return null;
  
  try {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Suppliers/${recordId}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` },
    });
    if (res.ok) {
      const data = await res.json();
      const fields = data.fields || {};
      return fields['Name'] || 
             fields['Supplier Name'] || 
             fields['Supplier'] ||
             fields['Company'] ||
             Object.values(fields).find(v => typeof v === 'string' && v.length > 0) as string || null;
    }
  } catch (e) {
    console.error('Failed to fetch supplier:', e);
  }
  return null;
}

// Cache supplier names to avoid repeated lookups
const supplierNameCache = new Map<string, string>();

async function getSupplierNameCached(recordId: string): Promise<string> {
  if (supplierNameCache.has(recordId)) {
    return supplierNameCache.get(recordId)!;
  }
  const name = await getSupplierName(recordId) || 'Unknown';
  supplierNameCache.set(recordId, name);
  return name;
}

// GET - Fetch all components from Airtable for a supplier
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const supplierName = searchParams.get('supplier');

    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      return NextResponse.json({ 
        error: 'Airtable not configured', 
        message: 'Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID in environment' 
      }, { status: 500 });
    }

    // Fetch all records from Airtable (paginated)
    let allRecords: any[] = [];
    let offset: string | undefined;
    
    do {
      const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`);
      if (offset) url.searchParams.set('offset', offset);
      url.searchParams.set('pageSize', '100');
      
      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Airtable API error:', errorText);
        return NextResponse.json({ error: 'Airtable API error', message: errorText }, { status: response.status });
      }

      const data = await response.json();
      allRecords = allRecords.concat(data.records || []);
      offset = data.offset;
    } while (offset);

    // Process records - use the "Supplier Name" lookup field directly
    const processedRecords = allRecords.map((record) => {
      const fields = record.fields;
      
      // Get supplier name from the lookup field (preferred) or resolve from linked record
      let supplierNameResolved = '';
      const supplierNameField = fields['Supplier Name'];
      if (Array.isArray(supplierNameField) && supplierNameField.length > 0) {
        supplierNameResolved = supplierNameField[0];
      } else if (typeof supplierNameField === 'string') {
        supplierNameResolved = supplierNameField;
      } else {
        // Fallback: check if Supplier is a direct string
        const supplierField = fields['Supplier'];
        if (typeof supplierField === 'string') {
          supplierNameResolved = supplierField;
        }
      }

      return {
        airtable_record_id: record.id,
        code: fields['Code'] || '',
        description: fields['Product'] || '',
        supplier_name: supplierNameResolved || 'Unknown',
        price: fields['Supplier Price'] || 0,
        category: fields['Category'] || '',
        unit: fields['Unit'] || '',
        image_url: fields['Image']?.[0]?.url || null,
        internal_code: fields['Internal Code'] || null,
      };
    });

    // Filter by supplier if specified
    let filteredRecords = processedRecords;
    if (supplierName) {
      filteredRecords = processedRecords.filter(
        r => r.supplier_name.toLowerCase() === supplierName.toLowerCase()
      );
    }

    // Get unique suppliers for the dropdown
    const uniqueSuppliers = [...new Set(processedRecords.map(r => r.supplier_name).filter(Boolean))].sort();

    return NextResponse.json({
      success: true,
      total: filteredRecords.length,
      suppliers: uniqueSuppliers,
      items: filteredRecords,
    });

  } catch (error) {
    console.error('Airtable bulk fetch error:', error);
    return NextResponse.json({ error: 'Fetch failed', details: String(error) }, { status: 500 });
  }
}
