'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { CheckCircle, Loader2, Package, AlertCircle, Calendar, MessageSquare } from 'lucide-react';

// Public Supabase client (anon key only - no auth required)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type LineItem = {
  po_number: string;
  supplier_code: string;
  description: string;
  quantity_ordered: number;
  order_date: string;
  // Response fields
  item_status?: string;
  item_expected_date?: string;
  item_notes?: string;
};

type ResponseData = {
  id: number;
  token: string;
  expected_delivery_date: string | null;
  status: string | null;
  notes: string | null;
  responded_at: string | null;
  line_item_responses: LineItem[] | null;
  follow_up: {
    id: number;
    supplier_name: string;
    po_numbers: string[];
    sent_at: string;
    component: {
      internal_code: string;
      description: string;
    };
  };
};

const STATUS_OPTIONS = [
  { value: 'on_track', label: 'On Track', description: 'Progressing as expected', color: 'text-green-600 bg-green-50 border-green-200' },
  { value: 'shipped', label: 'Shipped', description: 'Has been dispatched', color: 'text-blue-600 bg-blue-50 border-blue-200' },
  { value: 'delayed', label: 'Delayed', description: 'Delayed but in progress', color: 'text-amber-600 bg-amber-50 border-amber-200' },
  { value: 'issue', label: 'Issue', description: 'Problem with this item', color: 'text-red-600 bg-red-50 border-red-200' },
];

export default function SupplierResponsePage() {
  const params = useParams();
  const token = params.token as string;
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ResponseData | null>(null);
  
  // Per-item responses
  const [itemResponses, setItemResponses] = useState<Record<number, { status: string; expected_date: string; notes: string }>>({});
  const [globalNotes, setGlobalNotes] = useState('');

  useEffect(() => {
    async function fetchData() {
      // First get the response record
      const { data: response, error: respError } = await supabase
        .from('supplier_follow_up_responses')
        .select(`
          id,
          token,
          expected_delivery_date,
          status,
          notes,
          responded_at,
          line_item_responses,
          follow_up:component_follow_up_emails(
            id,
            supplier_name,
            po_numbers,
            sent_at,
            component:components(
              internal_code,
              description
            )
          )
        `)
        .eq('token', token)
        .single();

      if (respError || !response) {
        setError('Invalid or expired link. Please contact the purchasing department for a new link.');
        setLoading(false);
        return;
      }

      // Normalize nested data
      const followUp = Array.isArray(response.follow_up) 
        ? response.follow_up[0] 
        : response.follow_up;
      
      const component = followUp?.component 
        ? (Array.isArray(followUp.component) ? followUp.component[0] : followUp.component)
        : null;

      const normalizedData: ResponseData = {
        ...response,
        follow_up: {
          ...followUp,
          component: component || { internal_code: 'N/A', description: 'N/A' }
        }
      };

      setData(normalizedData);
      
      // Pre-fill if already responded
      if (response.responded_at) {
        setSubmitted(true);
        setGlobalNotes(response.notes || '');
        
        // Restore line item responses
        if (response.line_item_responses) {
          const restored: Record<number, { status: string; expected_date: string; notes: string }> = {};
          (response.line_item_responses as LineItem[]).forEach((item, idx) => {
            restored[idx] = {
              status: item.item_status || 'on_track',
              expected_date: item.item_expected_date || '',
              notes: item.item_notes || ''
            };
          });
          setItemResponses(restored);
        }
      }
      
      setLoading(false);
    }

    if (token) {
      fetchData();
    }
  }, [token]);

  // Initialize item responses when data loads
  useEffect(() => {
    if (data && !submitted) {
      const items = data.line_item_responses || [];
      const initial: Record<number, { status: string; expected_date: string; notes: string }> = {};
      items.forEach((_, idx) => {
        initial[idx] = { status: 'on_track', expected_date: '', notes: '' };
      });
      setItemResponses(initial);
    }
  }, [data, submitted]);

  const updateItemResponse = (idx: number, field: string, value: string) => {
    setItemResponses(prev => ({
      ...prev,
      [idx]: { ...prev[idx], [field]: value }
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    // Build line item responses with status
    const items = data?.line_item_responses || [];
    const updatedItems = items.map((item, idx) => ({
      ...item,
      item_status: itemResponses[idx]?.status || 'on_track',
      item_expected_date: itemResponses[idx]?.expected_date || null,
      item_notes: itemResponses[idx]?.notes || null
    }));

    // Determine overall status (worst case)
    const statuses = Object.values(itemResponses).map(r => r.status);
    let overallStatus = 'on_track';
    if (statuses.includes('issue')) overallStatus = 'issue';
    else if (statuses.includes('delayed')) overallStatus = 'delayed';
    else if (statuses.includes('shipped') && statuses.every(s => s === 'shipped')) overallStatus = 'shipped';

    const { error } = await supabase
      .from('supplier_follow_up_responses')
      .update({
        status: overallStatus,
        notes: globalNotes || null,
        line_item_responses: updatedItems,
        responded_at: new Date().toISOString(),
      })
      .eq('token', token);

    if (error) {
      setError('Failed to submit response. Please try again.');
      setSubmitting(false);
      return;
    }

    setSubmitted(true);
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm p-6 text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  const items = data?.line_item_responses || [];
  const hasMultipleItems = items.length > 1;

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="max-w-lg w-full bg-white rounded-xl shadow-sm p-6 text-center">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Response Submitted</h2>
          <p className="text-gray-600 mb-4">
            Thank you for your update. We have recorded your response.
          </p>
          
          {/* Show summary */}
          <div className="bg-gray-50 rounded-lg p-4 text-left text-sm space-y-3">
            {items.map((item, idx) => (
              <div key={idx} className="border-b pb-2 last:border-0 last:pb-0">
                <p className="font-medium">{item.po_number} - {item.supplier_code}</p>
                <p className="text-gray-500">
                  Status: {STATUS_OPTIONS.find(s => s.value === itemResponses[idx]?.status)?.label || 'On Track'}
                  {itemResponses[idx]?.expected_date && ` • Expected: ${new Date(itemResponses[idx].expected_date).toLocaleDateString()}`}
                </p>
              </div>
            ))}
            {globalNotes && (
              <p className="pt-2 text-gray-600 italic">&ldquo;{globalNotes}&rdquo;</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          {/* Header */}
          <div className="text-center p-6 border-b bg-gradient-to-b from-blue-50 to-white">
            <Package className="h-10 w-10 text-blue-600 mx-auto mb-3" />
            <h1 className="text-xl font-semibold text-gray-900">Order Delivery Update</h1>
            <p className="text-gray-500 text-sm mt-1">Please provide an update on the delivery status</p>
          </div>
          
          {/* Order Info */}
          <div className="bg-blue-50 border-b border-blue-100 p-4">
            <div className="text-sm text-blue-900 space-y-1">
              <p><span className="text-blue-600">PO Number:</span> <strong>{data?.follow_up?.po_numbers?.join(', ')}</strong></p>
              <p><span className="text-blue-600">Component:</span> {data?.follow_up?.component?.internal_code} - {data?.follow_up?.component?.description}</p>
              <p><span className="text-blue-600">Follow-up sent:</span> {data?.follow_up?.sent_at ? new Date(data.follow_up.sent_at).toLocaleDateString() : 'N/A'}</p>
            </div>
          </div>

          {/* Response Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            
            {hasMultipleItems && (
              <p className="text-sm text-gray-600 bg-amber-50 border border-amber-200 rounded-lg p-3">
                <strong>Multiple items on this order.</strong> Please provide status for each item below.
              </p>
            )}

            {/* Per-item status */}
            {items.map((item, idx) => (
              <div key={idx} className="border rounded-lg p-4 space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium text-gray-900">{item.po_number}</p>
                    <p className="text-sm text-gray-600">{item.supplier_code} - {item.description}</p>
                    <p className="text-xs text-gray-400">Qty: {item.quantity_ordered} • Ordered: {item.order_date}</p>
                  </div>
                </div>

                {/* Status selection */}
                <div className="grid grid-cols-2 gap-2">
                  {STATUS_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => updateItemResponse(idx, 'status', option.value)}
                      className={`p-3 rounded-lg border text-left transition-all ${
                        itemResponses[idx]?.status === option.value
                          ? option.color + ' border-2 ring-2 ring-offset-1 ring-current'
                          : 'bg-white hover:bg-gray-50 border-gray-200'
                      }`}
                    >
                      <p className="font-medium text-sm">{option.label}</p>
                      <p className="text-xs opacity-70">{option.description}</p>
                    </button>
                  ))}
                </div>

                {/* Expected date for this item */}
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-gray-400" />
                  <input
                    type="date"
                    value={itemResponses[idx]?.expected_date || ''}
                    onChange={(e) => updateItemResponse(idx, 'expected_date', e.target.value)}
                    className="flex-1 px-3 py-2 border rounded-lg text-sm text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Expected delivery"
                  />
                </div>

                {/* Item-specific notes (only show if delayed or issue) */}
                {(itemResponses[idx]?.status === 'delayed' || itemResponses[idx]?.status === 'issue') && (
                  <div className="flex items-start gap-2">
                    <MessageSquare className="h-4 w-4 text-gray-400 mt-2" />
                    <textarea
                      value={itemResponses[idx]?.notes || ''}
                      onChange={(e) => updateItemResponse(idx, 'notes', e.target.value)}
                      placeholder="Please explain the delay or issue..."
                      rows={2}
                      className="flex-1 px-3 py-2 border rounded-lg text-sm text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                )}
              </div>
            ))}

            {/* Global notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Additional Notes (optional)</label>
              <textarea
                placeholder="Any other information about this order..."
                value={globalNotes}
                onChange={(e) => setGlobalNotes(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border rounded-lg text-sm text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Submit Update'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-500 mt-4">
          Secure form • No login required • Unity ERP
        </p>
      </div>
    </div>
  );
}
