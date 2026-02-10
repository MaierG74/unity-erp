'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search, CheckCircle2, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import DeliveryNoteUpload from '@/components/features/purchasing/DeliveryNoteUpload';
import { uploadPOAttachment } from '@/lib/db/purchase-order-attachments';
import { supabase } from '@/lib/supabase';

type PurchaseOrderResult = {
  purchase_order_id: number;
  q_number: string | null;
  order_date: string | null;
  status: { status_name: string } | null;
  suppliers: { name: string } | null;
  supplier_orders: {
    order_id: number;
    receipts: { receipt_id: number; quantity_received: number; receipt_date: string }[];
  }[];
};

type ReceiptOption = {
  receipt_id: number;
  quantity_received: number;
  receipt_date: string;
};

function getStatusColor(status: string | undefined) {
  switch (status?.toLowerCase()) {
    case 'approved': return 'bg-green-100 text-green-800 border-green-200';
    case 'partially received': return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'fully received': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'draft': return 'bg-gray-100 text-gray-800 border-gray-200';
    case 'pending approval': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    default: return 'bg-gray-100 text-gray-800 border-gray-200';
  }
}

export default function QuickUploadPage() {
  // State
  const [file, setFile] = useState<File | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PurchaseOrderResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrderResult | null>(null);
  const [selectedReceiptId, setSelectedReceiptId] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced PO search
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    setUploadError(null);

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const { data, error } = await supabase
          .from('purchase_orders')
          .select(`
            purchase_order_id,
            q_number,
            order_date,
            status:supplier_order_statuses!purchase_orders_status_id_fkey(status_name),
            suppliers(name),
            supplier_orders(
              order_id,
              receipts:supplier_order_receipts(receipt_id, quantity_received, receipt_date)
            )
          `)
          .neq('status_id', 4) // Exclude cancelled
          .or(`q_number.ilike.%${query}%`)
          .order('purchase_order_id', { ascending: false })
          .limit(10);

        if (error) throw error;
        setSearchResults((data ?? []) as unknown as PurchaseOrderResult[]);
      } catch (err) {
        console.error('Search failed:', err);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }, []);

  // Cleanup timeout
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, []);

  // Get all receipts for selected PO
  const allReceipts: ReceiptOption[] = selectedPO?.supplier_orders
    ?.flatMap((so) => so.receipts || [])
    ?.sort((a, b) => b.receipt_id - a.receipt_id) ?? [];

  // Upload handler
  async function handleUpload() {
    if (!file || !selectedPO) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      await uploadPOAttachment(file, selectedPO.purchase_order_id, {
        receiptId: selectedReceiptId ?? undefined,
        attachmentType: 'delivery_note',
      });
      setUploadSuccess(true);
    } catch (err) {
      console.error('Upload failed:', err);
      setUploadError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
    }
  }

  // Reset for another upload
  function handleReset() {
    setFile(null);
    setSearchQuery('');
    setSearchResults([]);
    setSelectedPO(null);
    setSelectedReceiptId(null);
    setUploadSuccess(false);
    setUploadError(null);
  }

  // Success state
  if (uploadSuccess && selectedPO) {
    return (
      <div className="mx-auto max-w-[500px] px-4 py-8">
        <div className="text-center space-y-4">
          <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <CheckCircle2 className="h-8 w-8 text-green-600" />
          </div>
          <h1 className="text-xl font-semibold">Delivery note uploaded</h1>
          <p className="text-sm text-muted-foreground">
            Attached to {selectedPO.q_number || `PO #${selectedPO.purchase_order_id}`}
          </p>
          <div className="flex flex-col gap-3 pt-4">
            <Button asChild>
              <Link href={`/purchasing/purchase-orders/${selectedPO.purchase_order_id}`}>
                View Order
              </Link>
            </Button>
            <Button variant="outline" onClick={handleReset}>
              Upload Another
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/purchasing">Back to Purchasing</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[500px] px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link href="/purchasing">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <h1 className="text-lg font-semibold">Upload Delivery Note</h1>
      </div>

      {/* Step 1: Select photo */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">1. Select delivery note</Label>
        <DeliveryNoteUpload
          onFileSelect={setFile}
          selectedFile={file}
          large
        />
      </div>

      {/* Step 2: Find PO */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">2. Find purchase order</Label>
        {selectedPO ? (
          <Card>
            <CardContent className="p-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">
                    {selectedPO.q_number || `PO #${selectedPO.purchase_order_id}`}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {selectedPO.suppliers?.name ?? 'Unknown supplier'}
                  </p>
                  {selectedPO.order_date && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(selectedPO.order_date).toLocaleDateString('en-ZA')}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={getStatusColor(selectedPO.status?.status_name)}
                  >
                    {selectedPO.status?.status_name ?? 'Unknown'}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      setSelectedPO(null);
                      setSelectedReceiptId(null);
                      setSearchQuery('');
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by PO number (e.g. Q26-001)"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-9 h-12 text-base"
              />
              {isSearching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>

            {searchResults.length > 0 && (
              <div className="border rounded-lg divide-y max-h-[300px] overflow-y-auto">
                {searchResults.map((po) => (
                  <button
                    key={po.purchase_order_id}
                    type="button"
                    onClick={() => {
                      setSelectedPO(po);
                      setSearchResults([]);
                      setSearchQuery('');
                    }}
                    className="w-full text-left px-3 py-3 hover:bg-muted/50 transition-colors flex items-center justify-between"
                  >
                    <div>
                      <p className="font-medium text-sm">
                        {po.q_number || `PO #${po.purchase_order_id}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {po.suppliers?.name ?? 'Unknown supplier'}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${getStatusColor(po.status?.status_name)}`}
                    >
                      {po.status?.status_name}
                    </Badge>
                  </button>
                ))}
              </div>
            )}

            {searchQuery.length >= 2 && !isSearching && searchResults.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-3">
                No matching orders found
              </p>
            )}
          </div>
        )}
      </div>

      {/* Step 3: Link to receipt (optional) */}
      {selectedPO && allReceipts.length > 0 && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">3. Link to receipt (optional)</Label>
          <select
            value={selectedReceiptId ?? ''}
            onChange={(e) => setSelectedReceiptId(e.target.value ? Number(e.target.value) : null)}
            className="w-full border rounded-md p-3 text-sm bg-background h-12"
          >
            <option value="">General attachment</option>
            {allReceipts.map((r) => (
              <option key={r.receipt_id} value={r.receipt_id}>
                Receipt #{r.receipt_id} — {r.quantity_received} items —{' '}
                {new Date(r.receipt_date).toLocaleDateString('en-ZA')}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Upload error */}
      {uploadError && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-md text-sm">
          {uploadError}
        </div>
      )}

      {/* Upload button */}
      <Button
        onClick={handleUpload}
        disabled={!file || !selectedPO || isUploading}
        className="w-full h-14 text-base"
        size="lg"
      >
        {isUploading ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Uploading...
          </>
        ) : (
          'Upload Delivery Note'
        )}
      </Button>
    </div>
  );
}
