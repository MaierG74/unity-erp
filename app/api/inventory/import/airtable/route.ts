import { NextRequest, NextResponse } from 'next/server';

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = 'Components'; // Or could be made configurable

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
      // Try various common field names for supplier name
      const fields = data.fields || {};
      const name = fields['Name'] || 
                   fields['Supplier Name'] || 
                   fields['Supplier'] ||
                   fields['Company'] ||
                   fields['Company Name'] ||
                   // If no standard name field, use the first text field
                   Object.values(fields).find(v => typeof v === 'string' && v.length > 0);
      console.log('Airtable supplier fields:', Object.keys(fields));
      return name || null;
    } else {
      console.error('Failed to fetch supplier from Airtable:', await res.text());
    }
  } catch (e) {
    console.error('Failed to fetch supplier:', e);
  }
  return null;
}

// GET - Fetch a component from Airtable by supplier code
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');

    if (!code) {
      return NextResponse.json({ error: 'Missing code parameter' }, { status: 400 });
    }

    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      return NextResponse.json({ 
        error: 'Airtable not configured', 
        message: 'Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID in environment' 
      }, { status: 500 });
    }

    // Search Airtable for records matching this code
    const filterFormula = encodeURIComponent(`{Code}="${code}"`);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}?filterByFormula=${filterFormula}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Airtable API error:', errorText);
      return NextResponse.json({ 
        error: 'Airtable API error', 
        details: errorText 
      }, { status: response.status });
    }

    const data = await response.json();
    
    if (!data.records || data.records.length === 0) {
      return NextResponse.json({ 
        error: 'Not found', 
        message: `No component found with code "${code}"` 
      }, { status: 404 });
    }

    // Return the first matching record
    const record = data.records[0];
    const fields = record.fields;

    // Resolve supplier name from linked record
    let supplierName = '';
    const supplierField = fields['Supplier'];
    if (Array.isArray(supplierField) && supplierField.length > 0) {
      // It's a linked record ID - fetch the actual name
      supplierName = await getSupplierName(supplierField[0]) || '';
    } else if (typeof supplierField === 'string') {
      supplierName = supplierField;
    }

    // Map Airtable fields to our expected format
    return NextResponse.json({
      success: true,
      airtable_record_id: record.id,
      data: {
        code: fields['Code'] || code,
        description: fields['Product'] || '',
        supplier_name: supplierName,
        price: fields['Supplier Price'] || 0,
        category: fields['Category'] || '',
        unit: fields['Unit'] || '',
        image_url: fields['Image']?.[0]?.url || null,
        internal_code: fields['Internal Code'] || null,
      }
    });

  } catch (error) {
    console.error('Airtable fetch error:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch from Airtable', 
      details: String(error) 
    }, { status: 500 });
  }
}
