'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
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
import { Loader2, Warehouse, AlertCircle, CheckCircle, Printer, RotateCcw, Info, Plus, X, Search, User, Users, ChevronRight } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import type { Order } from '@/types/orders';
import type { ProductRequirement } from '@/types/components';
import { StockIssuancePDFDownload, StockIssuancePDFDocument } from './StockIssuancePDF';
import { StockPickingListDownload } from './StockPickingListPDF';
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
  staff_id: number | null;
  staff: {
    first_name: string;
    last_name: string;
  } | null;
}

// Grouped issuance for consolidated display (like inventory page)
interface GroupedIssuance {
  groupKey: string;
  issuance_date: string;
  staff_id: number | null;
  staff: { first_name: string; last_name: string } | null;
  notes: string | null;
  items: Array<{
    issuance_id: number;
    component_id: number;
    component: { internal_code: string; description: string | null };
    quantity_issued: number;
  }>;
}

// Group issuances by staff and timestamp (within same minute) - same pattern as inventory page
function groupIssuances(issuances: StockIssuance[]): GroupedIssuance[] {
  const groups = new Map<string, GroupedIssuance>();

  for (const issuance of issuances) {
    // Create group key from staff_id, notes, and timestamp (truncated to minute)
    const dateMinute = issuance.issuance_date.substring(0, 16); // YYYY-MM-DDTHH:mm
    const groupKey = `${issuance.staff_id || ''}_${issuance.notes || ''}_${dateMinute}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        groupKey,
        issuance_date: issuance.issuance_date,
        staff_id: issuance.staff_id,
        staff: issuance.staff,
        notes: issuance.notes,
        items: [],
      });
    }

    const group = groups.get(groupKey)!;
    group.items.push({
      issuance_id: issuance.issuance_id,
      component_id: issuance.component_id,
      component: issuance.component,
      quantity_issued: issuance.quantity_issued,
    });
  }

  // Sort by date descending and return as array
  return Array.from(groups.values()).sort(
    (a, b) => new Date(b.issuance_date).getTime() - new Date(a.issuance_date).getTime()
  );
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
  
  // Manual component addition state
  const [manualComponents, setManualComponents] = useState<ComponentIssue[]>([]);
  const [componentSearchOpen, setComponentSearchOpen] = useState(false);
  const [componentSearchTerm, setComponentSearchTerm] = useState('');
  
  // Staff assignment state
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);

  // Expanded rows state for issuance history
  const [expandedIssuances, setExpandedIssuances] = useState<Set<string>>(new Set());

  // Toggle expanded state for an issuance group
  const toggleIssuanceExpanded = useCallback((groupKey: string) => {
    setExpandedIssuances(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

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

  // Fetch active staff members
  const { data: staffMembers = [] } = useQuery({
    queryKey: ['staff', 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('staff_id, first_name, last_name, job_description')
        .eq('is_active', true)
        .order('first_name');

      if (error) throw error;
      return data || [];
    },
  });

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

  // Filter components for search
  const filteredSearchComponents = useMemo(() => {
    if (!componentSearchTerm.trim()) return [];
    const term = componentSearchTerm.toLowerCase();
    return inventoryData
      .filter((item: any) => {
        // Handle both array and object shapes from Supabase
        const comp = Array.isArray(item.component) ? item.component[0] : item.component;
        const code = comp?.internal_code?.toLowerCase() || '';
        const desc = comp?.description?.toLowerCase() || '';
        return code.includes(term) || desc.includes(term);
      })
      .map((item: any) => ({
        ...item,
        // Normalize component to always be an object
        component: Array.isArray(item.component) ? item.component[0] : item.component
      }))
      .slice(0, 10); // Limit to 10 results
  }, [inventoryData, componentSearchTerm]);

  // Add a manual component
  const addManualComponent = useCallback((item: any) => {
    const componentId = item.component_id;
    const available = Number(item.quantity_on_hand || 0);
    
    // Check if already in manual list or BOM list
    if (manualComponents.some(c => c.component_id === componentId)) {
      toast.error('Component already added');
      return;
    }
    
    setManualComponents(prev => [...prev, {
      component_id: componentId,
      internal_code: item.component?.internal_code || 'Unknown',
      description: item.component?.description || null,
      required_quantity: 0, // Manual components have no "required" quantity
      available_quantity: available,
      issue_quantity: 1, // Default to 1
      has_warning: available < 1,
    }]);
    
    setComponentSearchTerm('');
    setComponentSearchOpen(false);
  }, [manualComponents]);

  // Remove a manual component
  const removeManualComponent = useCallback((componentId: number) => {
    setManualComponents(prev => prev.filter(c => c.component_id !== componentId));
    setIssueQuantities(prev => {
      const next = { ...prev };
      delete next[componentId];
      return next;
    });
  }, []);

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

      // Use the component requirements which already have BOM data
      // Note: comp.quantity_required is already multiplied by order quantity in the parent
      productReq.components?.forEach((comp: any) => {
        const componentId = comp.component_id;
        // quantity_required already includes order quantity multiplication
        const totalRequired = Number(comp.quantity_required || 0);

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

  // Combined components (BOM + manual)
  const allComponentsToIssue = useMemo(() => {
    // Start with BOM components
    const combined = [...aggregatedComponents];
    
    // Add manual components that aren't already in the BOM list
    manualComponents.forEach(manual => {
      const existingIndex = combined.findIndex(c => c.component_id === manual.component_id);
      if (existingIndex === -1) {
        combined.push(manual);
      }
    });
    
    return combined;
  }, [aggregatedComponents, manualComponents]);

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
          staff_id,
          component:components(
            internal_code,
            description
          ),
          staff:staff(
            first_name,
            last_name
          )
        `)
        .eq('order_id', orderId)
        .order('issuance_date', { ascending: false });

      if (error) throw error;
      return (data || []).map((item: any) => ({
        issuance_id: item.issuance_id,
        component_id: item.component_id,
        component: Array.isArray(item.component) ? item.component[0] : item.component,
        quantity_issued: item.quantity_issued,
        issuance_date: item.issuance_date,
        notes: item.notes,
        created_by: item.created_by,
        staff_id: item.staff_id,
        staff: Array.isArray(item.staff) ? item.staff[0] : item.staff,
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
      
      // Find the product's BOM requirements
      const productReq = componentRequirements.find(pr => pr.product_id === productId);
      if (!productReq || !productReq.components || productReq.components.length === 0) {
        // No BOM defined, can't determine if complete
        return;
      }

      // Check if all components for this product have been issued in sufficient quantities
      const allComponentsIssued = productReq.components.every((comp: any) => {
        const componentId = comp.component_id;
        // quantity_required already includes order quantity multiplication
        const totalRequired = Number(comp.quantity_required || 0);
        const totalIssued = issuedQuantitiesByComponent.get(componentId) || 0;
        
        // Component is "issued" if total issued >= required for this product
        return totalIssued >= totalRequired;
      });

      if (allComponentsIssued) {
        completedSet.add(orderDetailId);
      }
    });

    return completedSet;
  }, [order?.details, componentRequirements, issuedQuantitiesByComponent]);

  // Group issuance history for consolidated display (like inventory page)
  const groupedIssuanceHistory = useMemo(
    () => groupIssuances(issuanceHistory),
    [issuanceHistory]
  );

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
          p_issuance_date: new Date().toISOString(),
          p_staff_id: selectedStaffId,
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
      setManualComponents([]);
      setSelectedStaffId(null);
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
      allComponentsToIssue: allComponentsToIssue.length,
      issueQuantities,
      selectedOrderDetails: Array.from(selectedOrderDetails),
    });

    const issuesToProcess = allComponentsToIssue
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
  }, [allComponentsToIssue, issueQuantities, selectedOrderDetails, issueStockMutation]);

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
                      allComponentsIssued && "border-green-500/30 bg-green-500/10"
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

          {/* Components to Issue (BOM + Manual) */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <Label className="text-base font-medium">Components to Issue</Label>
              <Popover open={componentSearchOpen} onOpenChange={setComponentSearchOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    Add Component
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="end">
                  <div className="p-3 border-b">
                    <div className="flex items-center gap-2">
                      <Search className="h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search components..."
                        value={componentSearchTerm}
                        onChange={(e) => setComponentSearchTerm(e.target.value)}
                        className="h-8"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto">
                    {componentSearchTerm.trim() === '' ? (
                      <p className="p-3 text-sm text-muted-foreground text-center">
                        Type to search for components...
                      </p>
                    ) : filteredSearchComponents.length === 0 ? (
                      <p className="p-3 text-sm text-muted-foreground text-center">
                        No components found
                      </p>
                    ) : (
                      filteredSearchComponents.map((item: any) => (
                        <div
                          key={item.component_id}
                          className="flex items-center justify-between p-3 hover:bg-muted cursor-pointer border-b last:border-0"
                          onClick={() => addManualComponent(item)}
                        >
                          <div>
                            <div className="font-medium">{item.component?.internal_code}</div>
                            <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                              {item.component?.description || 'No description'}
                            </div>
                          </div>
                          <Badge variant="outline" className="ml-2">
                            {formatQuantity(item.quantity_on_hand)} avail
                          </Badge>
                        </div>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            
            {allComponentsToIssue.length === 0 ? (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Select products above to see BOM components, or click "Add Component" to issue items not on the BOM.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                {aggregatedComponents.length > 0 && (
                  <Alert className="mb-4">
                    <Info className="h-4 w-4" />
                    <AlertDescription>
                      BOM quantities are pre-populated. Adjust as needed or add extra components.
                    </AlertDescription>
                  </Alert>
                )}
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Component</TableHead>
                        <TableHead className="text-right">Required</TableHead>
                        <TableHead className="text-right">Available</TableHead>
                        <TableHead className="text-right">Issue Qty</TableHead>
                        <TableHead className="w-[50px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allComponentsToIssue.map((comp) => {
                        const issueQty = issueQuantities[comp.component_id] ?? comp.issue_quantity;
                        const isManual = manualComponents.some(m => m.component_id === comp.component_id);
                        return (
                          <TableRow key={comp.component_id} className={cn(
                            comp.has_warning && 'bg-amber-500/10',
                            isManual && 'bg-blue-500/10'
                          )}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="font-medium">{comp.internal_code}</div>
                                {isManual && (
                                  <Badge variant="outline" className="text-xs bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30">
                                    Manual
                                  </Badge>
                                )}
                              </div>
                              {comp.description && (
                                <div className="text-sm text-muted-foreground">{comp.description}</div>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {isManual ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                formatQuantity(comp.required_quantity)
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <span className={cn(
                                comp.available_quantity < (issueQty || 0) ? 'text-amber-600 font-medium' : ''
                              )}>
                                {formatQuantity(comp.available_quantity)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="text"
                                inputMode="decimal"
                                value={issueQty === 0 ? '' : issueQty}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === '' || val === '.' || /^\d*\.?\d*$/.test(val)) {
                                    updateIssueQuantity(comp.component_id, val === '' || val === '.' ? 0 : parseFloat(val));
                                  }
                                }}
                                onBlur={(e) => {
                                  // Ensure we have a valid number on blur
                                  const val = parseFloat(e.target.value) || 0;
                                  updateIssueQuantity(comp.component_id, val);
                                }}
                                className="w-24 ml-auto text-right"
                                onClick={(e) => e.stopPropagation()}
                              />
                              {comp.has_warning && (
                                <div className="text-xs text-amber-600 mt-1">
                                  Insufficient stock
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              {isManual && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                                  onClick={() => removeManualComponent(comp.component_id)}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>

          {/* Staff Assignment and Notes */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="staff-select">Issue To (Optional)</Label>
              <Select
                value={selectedStaffId?.toString() || 'none'}
                onValueChange={(value) => setSelectedStaffId(value && value !== 'none' ? parseInt(value) : null)}
              >
                <SelectTrigger id="staff-select">
                  <SelectValue placeholder="Select staff member...">
                    {selectedStaffId ? (
                      <span className="flex items-center gap-2">
                        <User className="h-4 w-4" />
                        {staffMembers.find(s => s.staff_id === selectedStaffId)?.first_name}{' '}
                        {staffMembers.find(s => s.staff_id === selectedStaffId)?.last_name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Select staff member...</span>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <span className="text-muted-foreground">No staff assigned</span>
                  </SelectItem>
                  {staffMembers.map((staff: any) => (
                    <SelectItem key={staff.staff_id} value={staff.staff_id.toString()}>
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4" />
                        <span>{staff.first_name} {staff.last_name}</span>
                        {staff.job_description && (
                          <span className="text-xs text-muted-foreground">({staff.job_description})</span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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

          {/* Action Buttons */}
          <div className="flex justify-end gap-2">
            {/* Picking List PDF Download */}
            {order && (
              <StockPickingListDownload
                order={order}
                components={allComponentsToIssue.map(comp => ({
                  component_id: comp.component_id,
                  internal_code: comp.internal_code,
                  description: comp.description,
                  quantity: issueQuantities[comp.component_id] ?? comp.issue_quantity,
                }))}
                issuedTo={selectedStaffId ? 
                  `${staffMembers.find(s => s.staff_id === selectedStaffId)?.first_name || ''} ${staffMembers.find(s => s.staff_id === selectedStaffId)?.last_name || ''}`.trim() 
                  : null
                }
                notes={notes || null}
                companyInfo={companyInfo}
                disabled={issueStockMutation.isPending}
              />
            )}
            
            {/* Issue Stock Button */}
            <Button
              type="button"
              onClick={handleIssueStock}
              disabled={issueStockMutation.isPending || allComponentsToIssue.length === 0}
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
          {groupedIssuanceHistory.length === 0 ? (
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
                    <TableHead>Issued To</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupedIssuanceHistory.map((group) => {
                    const isExpanded = expandedIssuances.has(group.groupKey);
                    return (
                      <React.Fragment key={group.groupKey}>
                        {/* Summary row - always visible */}
                        <TableRow
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => toggleIssuanceExpanded(group.groupKey)}
                        >
                          <TableCell>
                            {format(new Date(group.issuance_date), 'MMM d, yyyy HH:mm')}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <ChevronRight
                                className={cn(
                                  "h-4 w-4 text-muted-foreground transition-transform",
                                  isExpanded && "rotate-90"
                                )}
                              />
                              <span className="font-medium">
                                {group.items.length} {group.items.length === 1 ? 'item' : 'items'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-muted-foreground">—</span>
                          </TableCell>
                          <TableCell>
                            {group.staff ? (
                              <div className="flex items-center gap-1.5">
                                <User className="h-3.5 w-3.5 text-muted-foreground" />
                                <span>{group.staff.first_name} {group.staff.last_name}</span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>{group.notes || '-'}</TableCell>
                          <TableCell className="text-right">
                            {order && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={async (e) => {
                                  e.stopPropagation(); // Prevent row toggle
                                  try {
                                    const groupIssuances = group.items.map(item => {
                                      const fullIssuance = issuanceHistory.find(i => i.issuance_id === item.issuance_id);
                                      return fullIssuance!;
                                    }).filter(Boolean);

                                    const blob = await pdf(
                                      <StockIssuancePDFDocument
                                        order={order}
                                        issuances={groupIssuances}
                                        issuanceDate={group.issuance_date}
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
                                title="Print PDF for this issuance"
                              >
                                <Printer className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>

                        {/* Expanded detail rows */}
                        {isExpanded && group.items.map((item) => (
                          <TableRow key={item.issuance_id} className="bg-muted/30">
                            <TableCell></TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2 pl-6">
                                <div className="flex-1">
                                  <div className="font-medium">{item.component?.internal_code || 'Unknown'}</div>
                                  {item.component?.description && (
                                    <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                                      {item.component.description}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {formatQuantity(item.quantity_issued)}
                            </TableCell>
                            <TableCell></TableCell>
                            <TableCell></TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 opacity-50 hover:opacity-100"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const fullIssuance = issuanceHistory.find(i => i.issuance_id === item.issuance_id);
                                  if (fullIssuance) handleOpenReversalDialog(fullIssuance);
                                }}
                                title="Reverse this item"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </React.Fragment>
                    );
                  })}
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

