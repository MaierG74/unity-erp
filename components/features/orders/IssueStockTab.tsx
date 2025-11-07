'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableHeader, TableBody, TableCell, TableHead, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Warehouse, AlertCircle, CheckCircle, Printer, RotateCcw, Info } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import type { Order } from '@/types/orders';
import type { ProductRequirement } from '@/types/components';
import { StockIssuancePDFDownload, StockIssuancePDFDocument } from './StockIssuancePDF';
import { pdf } from '@react-pdf/renderer';
import { ReverseIssuanceDialog } from './ReverseIssuanceDialog';

interface IssueStockTabProps {
  orderId: number;
  order: Order | null | undefined;
  componentRequirements: ProductRequirement[];
}

interface ComponentIssue {
  component_id: number;
  internal_code: string;
  description: string | null;
  required_quantity: number;
  available_quantity: number;
  issue_quantity: number;
  has_warning: boolean;
}

interface StockIssuance {
  issuance_id: number;
  component_id: number;
  component: {
    internal_code: string;
    description: string | null;
  };
  quantity_issued: number;
  issuance_date: string;
  notes: string | null;
  created_by: string | null;
}

function formatQuantity(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '0';
  }
  const numeric = Number(value);
  if (Math.abs(numeric - Math.round(numeric)) < 0.001) {
    return Math.round(numeric).toString();
  }
  return numeric.toFixed(2);
}

export function IssueStockTab({ orderId, order, componentRequirements }: IssueStockTabProps) {
  const queryClient = useQueryClient();
  const [selectedOrderDetails, setSelectedOrderDetails] = useState<Set<number>>(new Set());
  const [issueQuantities, setIssueQuantities] = useState<Record<number, number>>({});
  const [notes, setNotes] = useState<string>('');
  const [purchaseOrderId, setPurchaseOrderId] = useState<number | null>(null);
  const [companyInfo, setCompanyInfo] = useState<any | null>(null);
  const [reversalDialogOpen, setReversalDialogOpen] = useState(false);
  const [selectedIssuanceForReversal, setSelectedIssuanceForReversal] = useState<StockIssuance | null>(null);

  // Fetch company info for PDF
  useEffect(() => {
    const loadCompanyInfo = async () => {
      try {
        const res = await fetch('/api/settings', { headers: { 'Accept': 'application/json' } });
        if (!res.ok) return;
        const json = await res.json();
        const s = json?.settings;
        if (!s) return;
        
        let logoUrl: string | undefined = undefined;
        if (s.company_logo_path) {
          const { data } = supabase.storage.from('QButton').getPublicUrl(s.company_logo_path);
          logoUrl = data.publicUrl;
        }
        const addressLines = [s.address_line1, s.address_line2, `${s.city ?? ''} ${s.postal_code ?? ''}`.trim(), s.country]
          .filter(Boolean)
          .join('\n');
        setCompanyInfo({
          name: s.company_name || undefined,
          address: addressLines || undefined,
          phone: s.phone || undefined,
          email: s.email || undefined,
          logo: logoUrl,
        });
      } catch (e) {
        console.warn('Failed to load company settings for PDF');
      }
    };
    loadCompanyInfo();
  }, []);

  // Fetch inventory data for components
  const { data: inventoryData = [] } = useQuery({
    queryKey: ['inventory', 'components'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory')
        .select(`
          component_id,
          quantity_on_hand,
          component:components(
            component_id,
            internal_code,
            description
          )
        `);

      if (error) throw error;
      return data || [];
    },
  });

  // Create inventory map
  const inventoryMap = useMemo(() => {
    const map = new Map<number, number>();
    inventoryData.forEach((item: any) => {
      if (item.component_id) {
        map.set(item.component_id, Number(item.quantity_on_hand || 0));
      }
    });
    return map;
  }, [inventoryData]);

  // Aggregate BOM requirements for selected order details
  const aggregatedComponents = useMemo(() => {
    if (selectedOrderDetails.size === 0) return [];

    const componentMap = new Map<number, ComponentIssue>();

    // Process each selected order detail
    selectedOrderDetails.forEach((orderDetailId) => {
      const orderDetail = order?.details?.find(d => d.order_detail_id === orderDetailId);
      if (!orderDetail) return;

      const productId = orderDetail.product_id;
      const productReq = componentRequirements.find(pr => pr.product_id === productId);
      if (!productReq) return;

      const orderQuantity = Number(orderDetail.quantity || 0);

      // Use the component requirements which already have BOM data
      productReq.components?.forEach((comp: any) => {
        const componentId = comp.component_id;
        const bomQuantity = Number(comp.quantity_required || 0);
        const totalRequired = bomQuantity * orderQuantity;

        if (componentMap.has(componentId)) {
          const existing = componentMap.get(componentId)!;
          existing.required_quantity += totalRequired;
          // Update pre-populated quantity to include this order detail's requirements
          existing.issue_quantity += totalRequired;
        } else {
          const available = inventoryMap.get(componentId) || 0;
          componentMap.set(componentId, {
            component_id: componentId,
            internal_code: comp.internal_code || 'Unknown',
            description: comp.description || null,
            required_quantity: totalRequired,
            available_quantity: available,
            issue_quantity: totalRequired, // Pre-populate with required quantity
            has_warning: available < totalRequired,
          });
        }
      });
    });

    return Array.from(componentMap.values());
  }, [selectedOrderDetails, componentRequirements, order?.details, inventoryMap]);

  // Toggle order detail selection
  const toggleOrderDetail = useCallback((orderDetailId: number) => {
    setSelectedOrderDetails(prev => {
      const next = new Set(prev);
      if (next.has(orderDetailId)) {
        next.delete(orderDetailId);
      } else {
        next.add(orderDetailId);
      }
      return next;
    });
  }, []);

  // Update issue quantity
  const updateIssueQuantity = useCallback((componentId: number, quantity: number) => {
    setIssueQuantities(prev => ({
      ...prev,
      [componentId]: Math.max(0, quantity),
    }));
  }, []);

  // Fetch issuance history
  const { data: issuanceHistory = [], refetch: refetchHistory } = useQuery<StockIssuance[]>({
    queryKey: ['stockIssuances', orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_issuances')
        .select(`
          issuance_id,
          component_id,
          quantity_issued,
          issuance_date,
          notes,
          created_by,
          component:components(
            internal_code,
            description
          )
        `)
        .eq('order_id', orderId)
        .order('issuance_date', { ascending: false });

      if (error) throw error;
      return (data || []).map((item: any) => ({
        issuance_id: item.issuance_id,
        component_id: item.component_id,
        component: item.component,
        quantity_issued: item.quantity_issued,
        issuance_date: item.issuance_date,
        notes: item.notes,
        created_by: item.created_by,
      }));
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Calculate issued quantities by component (aggregated across all issuances for this order)
  const issuedQuantitiesByComponent = useMemo(() => {
    const map = new Map<number, number>();
    issuanceHistory.forEach((issuance) => {
      const componentId = issuance.component_id;
      const quantity = Number(issuance.quantity_issued || 0);
      map.set(componentId, (map.get(componentId) || 0) + quantity);
    });
    return map;
  }, [issuanceHistory]);

  // Calculate which order details have all components issued
  const orderDetailsWithAllComponentsIssued = useMemo(() => {
    const completedSet = new Set<number>();
    
    order?.details?.forEach((detail) => {
      const orderDetailId = detail.order_detail_id;
      const productId = detail.product_id;
      const orderQuantity = Number(detail.quantity || 0);
      
      // Find the product's BOM requirements
      const productReq = componentRequirements.find(pr => pr.product_id === productId);
      if (!productReq || !productReq.components || productReq.components.length === 0) {
        // No BOM defined, can't determine if complete
        return;
      }

      // Check if all components for this product have been issued in sufficient quantities
      const allComponentsIssued = productReq.components.every((comp: any) => {
        const componentId = comp.component_id;
        const bomQuantity = Number(comp.quantity_required || 0);
        const totalRequired = bomQuantity * orderQuantity;
        const totalIssued = issuedQuantitiesByComponent.get(componentId) || 0;
        
        // Component is "issued" if total issued >= required for this product
        // Note: This checks order-level totals, so if multiple products share components,
        // we verify that enough has been issued to cover this product's requirements
        return totalIssued >= totalRequired;
      });

      if (allComponentsIssued) {
        completedSet.add(orderDetailId);
      }
    });

    return completedSet;
  }, [order?.details, componentRequirements, issuedQuantitiesByComponent]);

  // Issue stock mutation
  const issueStockMutation = useMutation({
    mutationFn: async (issues: Array<{ component_id: number; quantity: number }>) => {
      console.log('[IssueStock] Mutation started with issues:', issues);
      const results: Array<{ issuance_id: number; transaction_id: number; quantity_on_hand: number; success: boolean; message: string }> = [];
      for (const issue of issues) {
        console.log('[IssueStock] Processing issue:', issue);
        const { data, error } = await supabase.rpc('process_stock_issuance', {
          p_order_id: orderId,
          p_component_id: issue.component_id,
          p_quantity: issue.quantity,
          p_purchase_order_id: purchaseOrderId,
          p_notes: notes || null,
        });

        console.log('[IssueStock] RPC response:', { data, error });

        if (error) {
          console.error('[IssueStock] RPC error:', error);
          throw error;
        }
        if (!data || data.length === 0 || !data[0].success) {
          const errorMsg = data?.[0]?.message || 'Failed to issue stock';
          console.error('[IssueStock] RPC returned failure:', errorMsg);
          throw new Error(errorMsg);
        }
        results.push(data[0]);
      }
      console.log('[IssueStock] Mutation completed successfully:', results);
      return results;
    },
    onSuccess: () => {
      console.log('[IssueStock] onSuccess called');
      toast.success('Stock issued successfully');
      setSelectedOrderDetails(new Set());
      setIssueQuantities({});
      setNotes('');
      queryClient.invalidateQueries({ queryKey: ['stockIssuances', orderId] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] });
      queryClient.invalidateQueries({ queryKey: ['orderComponentRequirements', orderId] });
      refetchHistory();
    },
    onError: (error: any) => {
      console.error('[IssueStock] Mutation error:', error);
      toast.error(error.message || 'Failed to issue stock');
    },
  });

  // Handle issue stock
  const handleIssueStock = useCallback(() => {
    console.log('[IssueStock] handleIssueStock called', {
      aggregatedComponents: aggregatedComponents.length,
      issueQuantities,
      selectedOrderDetails: Array.from(selectedOrderDetails),
    });

    const issuesToProcess = aggregatedComponents
      .filter(comp => {
        const issueQty = issueQuantities[comp.component_id] ?? comp.issue_quantity;
        return issueQty > 0;
      })
      .map(comp => ({
        component_id: comp.component_id,
        quantity: issueQuantities[comp.component_id] ?? comp.issue_quantity,
      }));

    console.log('[IssueStock] Issues to process:', issuesToProcess);

    if (issuesToProcess.length === 0) {
      toast.error('Please select components to issue');
      return;
    }

    console.log('[IssueStock] Calling mutation...');
    issueStockMutation.mutate(issuesToProcess);
  }, [aggregatedComponents, issueQuantities, selectedOrderDetails, issueStockMutation]);

  // Handle reversal dialog open
  const handleOpenReversalDialog = useCallback((issuance: StockIssuance) => {
    setSelectedIssuanceForReversal(issuance);
    setReversalDialogOpen(true);
  }, []);

  // Handle reversal completion
  const handleReversalComplete = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['stockIssuances', orderId] });
    queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] });
    queryClient.invalidateQueries({ queryKey: ['orderComponentRequirements', orderId] });
    refetchHistory();
  }, [queryClient, orderId, refetchHistory]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Warehouse className="h-5 w-5" />
            Issue Stock
          </CardTitle>
          <CardDescription>
            Select products and issue components from inventory based on their BOM requirements.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Product Selection */}
          <div>
            <Label className="text-base font-medium mb-3 block">Select Products</Label>
            <div className="space-y-2">
              {order?.details?.map((detail) => {
                const orderDetailId = detail.order_detail_id;
                const isSelected = selectedOrderDetails.has(orderDetailId);
                const allComponentsIssued = orderDetailsWithAllComponentsIssued.has(orderDetailId);
                return (
                  <div
                    key={orderDetailId}
                    className={cn(
                      "flex items-center space-x-3 p-3 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors",
                      isSelected && "bg-muted border-primary",
                      allComponentsIssued && "border-green-200 bg-green-50/50"
                    )}
                    onClick={() => toggleOrderDetail(orderDetailId)}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleOrderDetail(orderDetailId)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="flex-1 flex items-center justify-between">
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {detail.product?.name || `Product ${detail.product_id}`}
                          {allComponentsIssued && (
                            <Badge 
                              variant="success" 
                              className="inline-flex items-center gap-1 bg-green-500 text-white hover:bg-green-600"
                            >
                              <CheckCircle className="h-3 w-3" />
                              All Issued
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Quantity: {formatQuantity(detail.quantity)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Aggregated Components */}
          {aggregatedComponents.length > 0 && (
            <div>
              <Label className="text-base font-medium mb-3 block">Components to Issue</Label>
              <Alert className="mb-4">
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Quantities are pre-populated based on BOM requirements. You can adjust them as needed.
                  Components used by multiple products are automatically aggregated.
                </AlertDescription>
              </Alert>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Component</TableHead>
                      <TableHead className="text-right">Required</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead className="text-right">Issue Qty</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aggregatedComponents.map((comp) => {
                      const issueQty = issueQuantities[comp.component_id] ?? comp.issue_quantity;
                      return (
                        <TableRow key={comp.component_id} className={comp.has_warning ? 'bg-amber-50' : ''}>
                          <TableCell>
                            <div className="font-medium">{comp.internal_code}</div>
                            {comp.description && (
                              <div className="text-sm text-muted-foreground">{comp.description}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{formatQuantity(comp.required_quantity)}</TableCell>
                          <TableCell className="text-right">
                            <span className={cn(
                              comp.available_quantity < comp.required_quantity ? 'text-amber-600 font-medium' : ''
                            )}>
                              {formatQuantity(comp.available_quantity)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={issueQty}
                              onChange={(e) => updateIssueQuantity(comp.component_id, parseFloat(e.target.value) || 0)}
                              className="w-24 ml-auto"
                              onClick={(e) => e.stopPropagation()}
                            />
                            {comp.has_warning && (
                              <div className="text-xs text-amber-600 mt-1">
                                Insufficient stock
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Notes and Purchase Order */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="purchase-order-id">Purchase Order ID (Optional)</Label>
              <Input
                id="purchase-order-id"
                type="number"
                placeholder="PO ID if applicable"
                value={purchaseOrderId || ''}
                onChange={(e) => setPurchaseOrderId(e.target.value ? parseInt(e.target.value) : null)}
              />
            </div>
            <div>
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                placeholder="Add any notes about this issuance..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          {/* Issue Button */}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              onClick={handleIssueStock}
              disabled={issueStockMutation.isPending || aggregatedComponents.length === 0}
            >
              {issueStockMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Issuing...
                </>
              ) : (
                <>
                  <Warehouse className="mr-2 h-4 w-4" />
                  Issue Stock
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Issuance History */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Issuance History</CardTitle>
              <CardDescription>
                Past stock issuances for this order
              </CardDescription>
            </div>
            {issuanceHistory.length > 0 && order && (
              <StockIssuancePDFDownload
                order={order}
                issuances={issuanceHistory}
                issuanceDate={issuanceHistory[0]?.issuance_date || new Date().toISOString()}
                companyInfo={companyInfo}
              />
            )}
          </div>
        </CardHeader>
        <CardContent>
          {issuanceHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No stock has been issued for this order yet.
            </p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Component</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {issuanceHistory.map((issuance) => (
                    <TableRow key={issuance.issuance_id}>
                      <TableCell>
                        {format(new Date(issuance.issuance_date), 'MMM d, yyyy HH:mm')}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{issuance.component?.internal_code || 'Unknown'}</div>
                        {issuance.component?.description && (
                          <div className="text-sm text-muted-foreground">{issuance.component.description}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{formatQuantity(issuance.quantity_issued)}</TableCell>
                      <TableCell>{issuance.notes || '-'}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {order && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={async () => {
                                try {
                                  const blob = await pdf(
                                    <StockIssuancePDFDocument
                                      order={order}
                                      issuances={[issuance]}
                                      issuanceDate={issuance.issuance_date}
                                      companyInfo={companyInfo}
                                    />
                                  ).toBlob();
                                  const pdfBlob = new Blob([blob], { type: 'application/pdf' });
                                  const url = URL.createObjectURL(pdfBlob);
                                  window.open(url, '_blank');
                                  setTimeout(() => URL.revokeObjectURL(url), 5000);
                                } catch (err) {
                                  console.error('Failed to generate PDF:', err);
                                  toast.error('Failed to generate PDF');
                                }
                              }}
                              title="Print PDF"
                            >
                              <Printer className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenReversalDialog(issuance)}
                            title="Reverse Issuance"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reversal Dialog */}
      <ReverseIssuanceDialog
        open={reversalDialogOpen}
        onOpenChange={setReversalDialogOpen}
        issuance={selectedIssuanceForReversal}
        onReversed={handleReversalComplete}
      />
    </div>
  );
}

