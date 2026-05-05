'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableHeader, TableBody, TableCell, TableHead, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Warehouse, CheckCircle, Printer, RotateCcw, Info, Plus, X, Search, User, ChevronRight, ChevronDown, Layers } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatDateTime } from '@/lib/date-utils';
import { cn } from '@/lib/utils';
import { formatQuantity } from '@/lib/format-utils';
import type { Order } from '@/types/orders';
import type { ProductRequirement } from '@/types/components';
import type { CuttingPlan } from '@/lib/orders/cutting-plan-types';
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
  reserved_this_order: number;
}

interface ProductComponentGroup {
  orderDetailId: number;
  productName: string;
  quantity: number;
  issueUnits: number;
  remainingUnits: number;
  components: ComponentIssue[];
  allIssued: boolean;
  issuedCount: number;
  totalCount: number;
}

interface CuttingBoardIssue extends ComponentIssue {
  roles: string[];
  materialGroups: string[];
}

interface StockIssuance {
  issuance_id: number;
  component_id: number;
  component: {
    internal_code: string;
    description: string | null;
  };
  quantity_issued: number;
  quantity_reversed: number;
  remaining_quantity: number;
  issuance_date: string;
  notes: string | null;
  created_by: string | null;
  staff_id: number | null;
  staff: {
    first_name: string;
    last_name: string;
  } | null;
}

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

function groupIssuances(issuances: StockIssuance[]): GroupedIssuance[] {
  const groups = new Map<string, GroupedIssuance>();

  for (const issuance of issuances) {
    const dateMinute = issuance.issuance_date.substring(0, 16);
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
    if (issuance.remaining_quantity <= 0) continue;
    group.items.push({
      issuance_id: issuance.issuance_id,
      component_id: issuance.component_id,
      component: issuance.component,
      quantity_issued: issuance.remaining_quantity,
    });
  }

  return Array.from(groups.values())
    .filter((group) => group.items.length > 0)
    .sort(
      (a, b) => new Date(b.issuance_date).getTime() - new Date(a.issuance_date).getTime()
    );
}

// Composite key for per-product component tracking
function compKey(orderDetailId: number, componentId: number): string {
  return `${orderDetailId}_${componentId}`;
}

function cuttingKey(componentId: number): string {
  return `cutting_${componentId}`;
}

function setsEqual<T>(left: Set<T>, right: Set<T>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function clampQuantity(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, value), Math.max(0, max));
}


export function IssueStockTab({ orderId, order, componentRequirements }: IssueStockTabProps) {
  const queryClient = useQueryClient();

  // Accordion state: which products are expanded
  const [expandedProducts, setExpandedProducts] = useState<Set<number>>(new Set());

  // Issue quantities keyed by composite key (orderDetailId_componentId)
  const [issueQuantities, setIssueQuantities] = useState<Record<string, number>>({});

  // Product quantities to issue in this batch, keyed by order_detail_id
  const [issueUnitsByProduct, setIssueUnitsByProduct] = useState<Record<number, number>>({});

  // Which component rows are checked, keyed by composite key
  const [includedComponents, setIncludedComponents] = useState<Set<string>>(new Set());
  const [hasInitializedIncludedComponents, setHasInitializedIncludedComponents] = useState(false);

  const [notes, setNotes] = useState<string>('');
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

  const toggleIssuanceExpanded = useCallback((groupKey: string) => {
    setExpandedIssuances(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }, []);

  useEffect(() => {
    setHasInitializedIncludedComponents(false);
    setIncludedComponents(new Set());
    setIssueQuantities({});
    setIssueUnitsByProduct({});
  }, [orderId]);

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

  const selectedStaff = useMemo(
    () => staffMembers.find(s => s.staff_id === selectedStaffId),
    [staffMembers, selectedStaffId]
  );

  const { data: cuttingPlan = null, isLoading: cuttingPlanLoading } = useQuery<CuttingPlan | null>({
    queryKey: ['order-cutting-plan', orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('cutting_plan')
        .eq('order_id', orderId)
        .maybeSingle();
      if (error) throw error;
      return (data?.cutting_plan ?? null) as CuttingPlan | null;
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

  const inventoryMap = useMemo(() => {
    const map = new Map<number, number>();
    inventoryData.forEach((item: any) => {
      if (item.component_id) {
        map.set(item.component_id, Number(item.quantity_on_hand || 0));
      }
    });
    return map;
  }, [inventoryData]);

  const inventoryComponentMap = useMemo(() => {
    const map = new Map<number, { internal_code: string; description: string | null }>();
    inventoryData.forEach((item: any) => {
      if (!item.component_id) return;
      const component = Array.isArray(item.component) ? item.component[0] : item.component;
      if (!component) return;
      map.set(item.component_id, {
        internal_code: component.internal_code || 'Unknown',
        description: component.description || null,
      });
    });
    return map;
  }, [inventoryData]);

  // Filter components for manual search
  const filteredSearchComponents = useMemo(() => {
    if (!componentSearchTerm.trim()) return [];
    const term = componentSearchTerm.toLowerCase();
    return inventoryData
      .filter((item: any) => {
        const comp = Array.isArray(item.component) ? item.component[0] : item.component;
        const code = comp?.internal_code?.toLowerCase() || '';
        const desc = comp?.description?.toLowerCase() || '';
        return code.includes(term) || desc.includes(term);
      })
      .map((item: any) => ({
        ...item,
        component: Array.isArray(item.component) ? item.component[0] : item.component
      }))
      .slice(0, 10);
  }, [inventoryData, componentSearchTerm]);

  // Add a manual component
  const addManualComponent = useCallback((item: any) => {
    const componentId = item.component_id;
    const available = Number(item.quantity_on_hand || 0);

    if (manualComponents.some(c => c.component_id === componentId)) {
      toast.error('Component already added');
      return;
    }

    setManualComponents(prev => [...prev, {
      component_id: componentId,
      internal_code: item.component?.internal_code || 'Unknown',
      description: item.component?.description || null,
      required_quantity: 0,
      available_quantity: available,
      issue_quantity: 1,
      has_warning: available < 1,
      reserved_this_order: 0,
    }]);

    // Auto-include manual components
    const key = compKey(0, componentId); // orderDetailId=0 for manual
    setIncludedComponents(prev => new Set([...prev, key]));

    setComponentSearchTerm('');
    setComponentSearchOpen(false);
  }, [manualComponents]);

  const removeManualComponent = useCallback((componentId: number) => {
    setManualComponents(prev => prev.filter(c => c.component_id !== componentId));
    const key = compKey(0, componentId);
    setIssueQuantities(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setIncludedComponents(prev => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
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

      const issuanceIds = (data || [])
        .map((item: any) => item.issuance_id)
        .filter((id: any) => id !== null && id !== undefined);

      const reversedByIssuance = new Map<number, number>();
      if (issuanceIds.length > 0) {
        const reversalResponse = await authorizedFetch(`/api/orders/${orderId}/stock-issuance-reversals`);

        if (!reversalResponse.ok) {
          console.warn('[IssueStock] Failed to load issuance reversals', reversalResponse.status);
        } else {
          const reversalJson = await reversalResponse.json();
          (reversalJson.reversals || []).forEach((reversal: any) => {
            const issuanceId = Number(reversal.issuance_id);
            reversedByIssuance.set(
              issuanceId,
              (reversedByIssuance.get(issuanceId) || 0) + Number(reversal.quantity_reversed || 0)
            );
          });
        }
      }

      return (data || []).map((item: any) => {
        const quantityIssued = Number(item.quantity_issued || 0);
        const quantityReversed = reversedByIssuance.get(Number(item.issuance_id)) || 0;
        const remainingQuantity = Math.max(0, quantityIssued - quantityReversed);

        return {
          issuance_id: item.issuance_id,
          component_id: item.component_id,
          component: Array.isArray(item.component) ? item.component[0] : item.component,
          quantity_issued: quantityIssued,
          quantity_reversed: quantityReversed,
          remaining_quantity: remainingQuantity,
          issuance_date: item.issuance_date,
          notes: item.notes,
          created_by: item.created_by,
          staff_id: item.staff_id,
          staff: Array.isArray(item.staff) ? item.staff[0] : item.staff,
        };
      });
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const activeIssuanceHistory = useMemo(
    () => issuanceHistory.filter((issuance) => issuance.remaining_quantity > 0),
    [issuanceHistory]
  );

  // Issued quantities by component (aggregated across all issuances)
  const issuedQuantitiesByComponent = useMemo(() => {
    const map = new Map<number, number>();
    activeIssuanceHistory.forEach((issuance) => {
      const cid = issuance.component_id;
      map.set(cid, (map.get(cid) || 0) + Number(issuance.remaining_quantity || 0));
    });
    return map;
  }, [activeIssuanceHistory]);

  const canIssueCuttingPlanBoards = Boolean(cuttingPlan && !cuttingPlan.stale);

  const cuttingBoardIssues = useMemo((): CuttingBoardIssue[] => {
    if (!cuttingPlan || !Array.isArray(cuttingPlan.material_groups)) return [];

    const boards = new Map<number, {
      component_id: number;
      fallbackName: string;
      requiredQuantity: number;
      roles: Set<string>;
      materialGroups: Set<string>;
    }>();

    const addBoard = (
      componentId: number | null | undefined,
      fallbackName: string | null | undefined,
      quantity: number | null | undefined,
      role: string,
      groupLabel: string | null | undefined,
    ) => {
      const id = Number(componentId ?? 0);
      const requiredQuantity = Number(quantity ?? 0);
      if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(requiredQuantity) || requiredQuantity <= 0) {
        return;
      }

      const existing = boards.get(id);
      if (existing) {
        existing.requiredQuantity += requiredQuantity;
        existing.roles.add(role);
        if (groupLabel) existing.materialGroups.add(groupLabel);
        return;
      }

      boards.set(id, {
        component_id: id,
        fallbackName: fallbackName || `Component ${id}`,
        requiredQuantity,
        roles: new Set([role]),
        materialGroups: new Set(groupLabel ? [groupLabel] : []),
      });
    };

    cuttingPlan.material_groups.forEach((group) => {
      addBoard(
        group.material_id,
        group.material_name,
        group.sheets_required,
        group.kind === 'backer' ? 'Backer sheets' : 'Primary sheets',
        `${group.sheet_thickness_mm}mm ${group.material_name}${group.kind === 'backer' ? ' backer' : ''}`,
      );
    });

    return Array.from(boards.values()).map((board) => {
      const componentMeta = inventoryComponentMap.get(board.component_id);
      const alreadyIssued = issuedQuantitiesByComponent.get(board.component_id) || 0;
      const remaining = Math.max(0, board.requiredQuantity - alreadyIssued);
      const issueQuantity = clampQuantity(
        issueQuantities[cuttingKey(board.component_id)] ?? remaining,
        remaining,
      );
      const available = inventoryMap.get(board.component_id) || 0;

      return {
        component_id: board.component_id,
        internal_code: componentMeta?.internal_code || board.fallbackName,
        description: componentMeta?.description || board.fallbackName,
        required_quantity: board.requiredQuantity,
        available_quantity: available,
        issue_quantity: issueQuantity,
        has_warning: available < issueQuantity,
        reserved_this_order: 0,
        roles: Array.from(board.roles),
        materialGroups: Array.from(board.materialGroups),
      };
    }).sort((a, b) => a.internal_code.localeCompare(b.internal_code));
  }, [cuttingPlan, inventoryComponentMap, inventoryMap, issueQuantities, issuedQuantitiesByComponent]);

  const cuttingBoardTotals = useMemo(() => {
    const required = cuttingBoardIssues.reduce((sum, board) => sum + board.required_quantity, 0);
    const remaining = cuttingBoardIssues.reduce((sum, board) => {
      const issued = issuedQuantitiesByComponent.get(board.component_id) || 0;
      return sum + Math.max(0, board.required_quantity - issued);
    }, 0);
    const issuedCount = cuttingBoardIssues.filter((board) => {
      const issued = issuedQuantitiesByComponent.get(board.component_id) || 0;
      return board.required_quantity > 0 && issued >= board.required_quantity;
    }).length;

    return {
      required,
      remaining,
      issuedCount,
      totalCount: cuttingBoardIssues.filter((board) => board.required_quantity > 0).length,
      allIssued: cuttingBoardIssues.length > 0 && remaining <= 0.0001,
    };
  }, [cuttingBoardIssues, issuedQuantitiesByComponent]);

  // Per-product component breakdown
  const productComponentGroups = useMemo((): ProductComponentGroup[] => {
    if (!order?.details) return [];

    return order.details.map((detail) => {
      const orderDetailId = detail.order_detail_id;
      const productReq = componentRequirements.find(pr => pr.product_id === detail.product_id);

      const orderedUnits = Number(detail.quantity || 0);
      const baseComponents = productReq?.components || [];

      const remainingUnits = baseComponents.reduce((lowest: number, comp: any) => {
        const totalRequired = Number(comp.quantity_required || 0);
        const perUnitQuantity = orderedUnits > 0 ? totalRequired / orderedUnits : 0;
        if (perUnitQuantity <= 0) return lowest;

        const alreadyIssued = issuedQuantitiesByComponent.get(comp.component_id) || 0;
        const remaining = Math.max(0, totalRequired - alreadyIssued);
        return Math.min(lowest, remaining / perUnitQuantity);
      }, orderedUnits);

      const issueUnits = clampQuantity(
        issueUnitsByProduct[orderDetailId] ?? remainingUnits,
        remainingUnits
      );

      const components: ComponentIssue[] = baseComponents.map((comp: any) => {
        const componentId = comp.component_id;
        const totalRequired = Number(comp.quantity_required || 0);
        const perUnitQuantity = orderedUnits > 0 ? totalRequired / orderedUnits : 0;
        const available = inventoryMap.get(componentId) || 0;
        const alreadyIssued = issuedQuantitiesByComponent.get(componentId) || 0;
        const remaining = Math.max(0, totalRequired - alreadyIssued);
        const issueQuantity = clampQuantity(perUnitQuantity * issueUnits, remaining);

        return {
          component_id: componentId,
          internal_code: comp.internal_code || 'Unknown',
          description: comp.description || null,
          required_quantity: totalRequired,
          available_quantity: available,
          issue_quantity: issueQuantity,
          has_warning: available < issueQuantity,
          reserved_this_order: Number(comp.reserved_this_order ?? 0),
        };
      });

      const issuedCount = components.filter(c => {
        const issued = issuedQuantitiesByComponent.get(c.component_id) || 0;
        return issued >= c.required_quantity && c.required_quantity > 0;
      }).length;
      const totalCount = components.filter(c => c.required_quantity > 0).length;

      return {
        orderDetailId,
        productName: detail.product?.name || `Product ${detail.product_id}`,
        quantity: detail.quantity,
        issueUnits,
        remainingUnits,
        components,
        allIssued: totalCount > 0 && issuedCount === totalCount,
        issuedCount,
        totalCount,
      };
    });
  }, [order?.details, componentRequirements, inventoryMap, issuedQuantitiesByComponent, issueUnitsByProduct]);

  // Auto-expand products that have remaining components on mount
  useEffect(() => {
    if (productComponentGroups.length === 0) return;

    setExpandedProducts((prev) => {
      if (prev.size > 0) return prev;

      const next = new Set<number>();
      productComponentGroups.forEach((group) => {
        // Expand products that still have components to issue
        if (!group.allIssued && group.components.length > 0) {
          next.add(group.orderDetailId);
        }
      });

      // If nothing to expand (all issued), expand first product
      if (next.size === 0) {
        next.add(productComponentGroups[0].orderDetailId);
      }

      return setsEqual(prev, next) ? prev : next;
    });
  }, [productComponentGroups]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-include components with remaining qty > 0 once per order load/reset.
  // After that, preserve explicit operator checkbox choices while Issue units changes.
  useEffect(() => {
    if (hasInitializedIncludedComponents) return;
    if (cuttingPlanLoading) return;
    if (productComponentGroups.length === 0 && manualComponents.length === 0) return;

    const next = new Set<string>();
    productComponentGroups.forEach((group) => {
      group.components.forEach((comp) => {
        if (comp.issue_quantity > 0) {
          next.add(compKey(group.orderDetailId, comp.component_id));
        }
      });
    });
    // Include manual components
    manualComponents.forEach((comp) => {
      next.add(compKey(0, comp.component_id));
    });

    setIncludedComponents((prev) => (setsEqual(prev, next) ? prev : next));
    setHasInitializedIncludedComponents(true);
  }, [
    productComponentGroups,
    manualComponents,
    cuttingPlanLoading,
    hasInitializedIncludedComponents,
  ]);

  // Toggle product accordion
  const toggleProduct = useCallback((orderDetailId: number) => {
    setExpandedProducts(prev => {
      const next = new Set(prev);
      if (next.has(orderDetailId)) next.delete(orderDetailId);
      else next.add(orderDetailId);
      return next;
    });
  }, []);

  // Toggle component inclusion
  const toggleComponentInclusion = useCallback((key: string) => {
    setIncludedComponents(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Toggle all components for a product
  const toggleAllProductComponents = useCallback((orderDetailId: number, checked: boolean, components: ComponentIssue[]) => {
    setIncludedComponents(prev => {
      const next = new Set(prev);
      components.forEach(comp => {
        const key = compKey(orderDetailId, comp.component_id);
        if (checked) next.add(key);
        else next.delete(key);
      });
      return next;
    });
  }, []);

  const toggleAllCuttingBoards = useCallback((checked: boolean, boards: CuttingBoardIssue[]) => {
    setIncludedComponents(prev => {
      const next = new Set(prev);
      boards.forEach(board => {
        const key = cuttingKey(board.component_id);
        if (checked) next.add(key);
        else next.delete(key);
      });
      return next;
    });
  }, []);

  // Update issue quantity with composite key
  const updateIssueQuantity = useCallback((key: string, quantity: number) => {
    setIssueQuantities(prev => ({
      ...prev,
      [key]: Math.max(0, quantity),
    }));
  }, []);

  const updateProductIssueUnits = useCallback((group: ProductComponentGroup, quantity: number) => {
    const nextQuantity = clampQuantity(quantity, group.remainingUnits);

    setIssueUnitsByProduct(prev => ({
      ...prev,
      [group.orderDetailId]: nextQuantity,
    }));

    setIssueQuantities(prev => {
      const next = { ...prev };
      group.components.forEach((comp) => {
        delete next[compKey(group.orderDetailId, comp.component_id)];
      });
      return next;
    });
  }, []);

  // Calculate which order details have all components issued
  const orderDetailsWithAllComponentsIssued = useMemo(() => {
    const completedSet = new Set<number>();

    order?.details?.forEach((detail) => {
      const orderDetailId = detail.order_detail_id;
      const productId = detail.product_id;

      const productReq = componentRequirements.find(pr => pr.product_id === productId);
      if (!productReq || !productReq.components || productReq.components.length === 0) return;

      const allComponentsIssued = productReq.components.every((comp: any) => {
        const componentId = comp.component_id;
        const totalRequired = Number(comp.quantity_required || 0);
        const totalIssued = issuedQuantitiesByComponent.get(componentId) || 0;
        return totalIssued >= totalRequired;
      });

      if (allComponentsIssued) completedSet.add(orderDetailId);
    });

    return completedSet;
  }, [order?.details, componentRequirements, issuedQuantitiesByComponent]);

  const groupedIssuanceHistory = useMemo(
    () => groupIssuances(activeIssuanceHistory),
    [activeIssuanceHistory]
  );

  // Build flat list of all checked components for issuance (aggregated by component_id)
  const checkedComponentsForIssuance = useMemo(() => {
    const aggregated = new Map<number, { component_id: number; quantity: number; internal_code: string; description: string | null }>();

    // From product groups
    productComponentGroups.forEach(group => {
      group.components.forEach(comp => {
        const key = compKey(group.orderDetailId, comp.component_id);
        if (!includedComponents.has(key)) return;
        const issueQty = issueQuantities[key] ?? comp.issue_quantity;
        if (issueQty <= 0) return;

        if (aggregated.has(comp.component_id)) {
          aggregated.get(comp.component_id)!.quantity += issueQty;
        } else {
          aggregated.set(comp.component_id, {
            component_id: comp.component_id,
            quantity: issueQty,
            internal_code: comp.internal_code,
            description: comp.description,
          });
        }
      });
    });

    // From manual components
    manualComponents.forEach(comp => {
      const key = compKey(0, comp.component_id);
      if (!includedComponents.has(key)) return;
      const issueQty = issueQuantities[key] ?? comp.issue_quantity;
      if (issueQty <= 0) return;

      if (aggregated.has(comp.component_id)) {
        aggregated.get(comp.component_id)!.quantity += issueQty;
      } else {
        aggregated.set(comp.component_id, {
          component_id: comp.component_id,
          quantity: issueQty,
          internal_code: comp.internal_code,
          description: comp.description,
        });
      }
    });

    if (canIssueCuttingPlanBoards) {
      cuttingBoardIssues.forEach((board) => {
        const key = cuttingKey(board.component_id);
        if (!includedComponents.has(key)) return;
        const alreadyIssued = issuedQuantitiesByComponent.get(board.component_id) || 0;
        const remaining = Math.max(0, board.required_quantity - alreadyIssued);
        const issueQty = clampQuantity(issueQuantities[key] ?? board.issue_quantity, remaining);
        if (issueQty <= 0) return;

        if (aggregated.has(board.component_id)) {
          aggregated.get(board.component_id)!.quantity += issueQty;
        } else {
          aggregated.set(board.component_id, {
            component_id: board.component_id,
            quantity: issueQty,
            internal_code: board.internal_code,
            description: board.description,
          });
        }
      });
    }

    return Array.from(aggregated.values());
  }, [
    productComponentGroups,
    manualComponents,
    cuttingBoardIssues,
    canIssueCuttingPlanBoards,
    includedComponents,
    issueQuantities,
    issuedQuantitiesByComponent,
  ]);

  const checkedCuttingBoardsForIssuance = useMemo(() => {
    if (!canIssueCuttingPlanBoards) return [];

    return cuttingBoardIssues.flatMap((board) => {
      const key = cuttingKey(board.component_id);
      if (!includedComponents.has(key)) return [];

      const alreadyIssued = issuedQuantitiesByComponent.get(board.component_id) || 0;
      const remaining = Math.max(0, board.required_quantity - alreadyIssued);
      const issueQty = clampQuantity(issueQuantities[key] ?? board.issue_quantity, remaining);
      if (issueQty <= 0) return [];

      return [{
        component_id: board.component_id,
        quantity: issueQty,
        internal_code: board.internal_code,
        description: board.description,
      }];
    });
  }, [
    cuttingBoardIssues,
    canIssueCuttingPlanBoards,
    includedComponents,
    issueQuantities,
    issuedQuantitiesByComponent,
  ]);

  // Issue stock mutation
  const issueStockMutation = useMutation({
    mutationFn: async (issues: Array<{ component_id: number; quantity: number }>) => {
      const results: Array<{ issuance_id: number; transaction_id: number; quantity_on_hand: number; success: boolean; message: string }> = [];
      for (const issue of issues) {
        const { data, error } = await supabase.rpc('process_stock_issuance', {
          p_order_id: orderId,
          p_component_id: issue.component_id,
          p_quantity: issue.quantity,
          p_purchase_order_id: null,
          p_notes: notes || null,
          p_issuance_date: new Date().toISOString(),
          p_staff_id: selectedStaffId,
        });

        if (error) throw error;
        if (!data || data.length === 0 || !data[0].success) {
          throw new Error(data?.[0]?.message || 'Failed to issue stock');
        }
        results.push(data[0]);
      }
      return results;
    },
    onSuccess: () => {
      toast.success('Stock issued successfully');
      setIssueQuantities({});
      setIncludedComponents(new Set());
      setNotes('');
      setManualComponents([]);
      setSelectedStaffId(null);
      setIssueUnitsByProduct({});
      setHasInitializedIncludedComponents(false);
      invalidateStockQueries();
    },
    onError: (error: any) => {
      console.error('[IssueStock] Mutation error:', error);
      toast.error(error.message || 'Failed to issue stock');
    },
  });

  const invalidateStockQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['stockIssuances', orderId] });
    queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] });
    queryClient.invalidateQueries({ queryKey: ['orderComponentRequirements', orderId] });
    queryClient.invalidateQueries({ queryKey: ['orderComponentStatusRows', orderId] });
    queryClient.invalidateQueries({ queryKey: ['orderSmartCounts', orderId] });
    refetchHistory();
  }, [queryClient, orderId, refetchHistory]);

  const handleIssueStock = useCallback(() => {
    if (checkedComponentsForIssuance.length === 0) {
      toast.error('Please select components to issue');
      return;
    }
    issueStockMutation.mutate(
      checkedComponentsForIssuance.map(c => ({ component_id: c.component_id, quantity: c.quantity }))
    );
  }, [checkedComponentsForIssuance, issueStockMutation]);

  const handleIssueCuttingBoardStock = useCallback(() => {
    if (checkedCuttingBoardsForIssuance.length === 0) {
      toast.error('Please select board stock to issue');
      return;
    }
    issueStockMutation.mutate(
      checkedCuttingBoardsForIssuance.map(c => ({ component_id: c.component_id, quantity: c.quantity }))
    );
  }, [checkedCuttingBoardsForIssuance, issueStockMutation]);

  const handleOpenReversalDialog = useCallback((issuance: StockIssuance) => {
    setSelectedIssuanceForReversal(issuance);
    setReversalDialogOpen(true);
  }, []);

  const handleReversalComplete = useCallback(() => {
    invalidateStockQueries();
  }, [invalidateStockQueries]);

  const hasAnyProducts = (order?.details?.length ?? 0) > 0;
  const hasCuttingPlan = Boolean(cuttingPlan);
  const allCuttingBoardsChecked = cuttingBoardIssues.length > 0 &&
    cuttingBoardIssues.every(board => includedComponents.has(cuttingKey(board.component_id)));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Warehouse className="h-5 w-5" />
                Issue Stock
              </CardTitle>
              <CardDescription>
                Issue BOM components and saved cutting-list board stock for this order.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {order && (
                <StockPickingListDownload
                  order={order}
                  components={checkedComponentsForIssuance.map(c => ({
                    component_id: c.component_id,
                    internal_code: c.internal_code,
                    description: c.description,
                    quantity: c.quantity,
                  }))}
                  issuedTo={selectedStaff
                    ? `${selectedStaff.first_name || ''} ${selectedStaff.last_name || ''}`.trim()
                    : null
                  }
                  notes={notes || null}
                  companyInfo={companyInfo}
                  disabled={issueStockMutation.isPending}
                />
              )}
              <Button
                type="button"
                onClick={handleIssueStock}
                disabled={issueStockMutation.isPending || checkedComponentsForIssuance.length === 0}
                size="lg"
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
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!hasAnyProducts ? (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                No products on this order. Add products in the Products tab first.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {/* Product Accordions */}
              <div className="space-y-2">
                {productComponentGroups.map((group) => {
                  const isExpanded = expandedProducts.has(group.orderDetailId);
                  const allCheckedForProduct = group.components.length > 0 &&
                    group.components.every(c => includedComponents.has(compKey(group.orderDetailId, c.component_id)));

                  return (
                    <div
                      key={group.orderDetailId}
                      className={cn(
                        "border rounded-lg overflow-hidden transition-colors",
                        group.allIssued && "border-green-500/30",
                        isExpanded && "border-primary/50"
                      )}
                    >
                      {/* Product Header - always visible */}
                      <div
                        className={cn(
                          "flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors",
                          group.allIssued && "bg-green-500/5",
                        )}
                        onClick={() => toggleProduct(group.orderDetailId)}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium flex items-center gap-2">
                            <span className="truncate">{group.productName}</span>
                            {group.allIssued && (
                              <Badge
                                variant="outline"
                                className="inline-flex items-center gap-1 bg-green-500/10 text-green-600 border-green-500/30 shrink-0"
                              >
                                <CheckCircle className="h-3 w-3" />
                                All Issued
                              </Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground flex items-center gap-3 flex-wrap">
                            <span>Qty: {formatQuantity(group.quantity)}</span>
                            <span>{formatQuantity(group.remainingUnits)} units remaining</span>
                            {group.totalCount > 0 && !group.allIssued && (
                              <span>{group.issuedCount}/{group.totalCount} components issued</span>
                            )}
                            {group.components.length === 0 && (
                              <span className="italic">No BOM defined</span>
                            )}
                          </div>
                        </div>
                        {group.components.length > 0 && !group.allIssued && (
                          <div
                            className="flex items-center gap-2 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Label
                              htmlFor={`issue-units-${group.orderDetailId}`}
                              className="text-xs text-muted-foreground whitespace-nowrap"
                            >
                              Issue units
                            </Label>
                            <Input
                              id={`issue-units-${group.orderDetailId}`}
                              type="text"
                              inputMode="decimal"
                              value={group.issueUnits === 0 ? '' : group.issueUnits}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === '' || val === '.' || /^\d*\.?\d*$/.test(val)) {
                                  updateProductIssueUnits(
                                    group,
                                    val === '' || val === '.' ? 0 : parseFloat(val)
                                  );
                                }
                              }}
                              onBlur={(e) => {
                                updateProductIssueUnits(group, parseFloat(e.target.value) || 0);
                              }}
                              className="h-8 w-20 text-right"
                            />
                          </div>
                        )}
                      </div>

                      {/* Expanded: Component Table */}
                      {isExpanded && group.components.length > 0 && (
                        <div className="border-t">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-[40px] pl-4">
                                  <Checkbox
                                    checked={allCheckedForProduct}
                                    onCheckedChange={(checked) =>
                                      toggleAllProductComponents(group.orderDetailId, !!checked, group.components)
                                    }
                                    aria-label="Select all components for this product"
                                  />
                                </TableHead>
                                <TableHead>Component</TableHead>
                                <TableHead className="text-right">Required</TableHead>
                                <TableHead className="text-right">Issued</TableHead>
                                <TableHead className="text-right">Reserved</TableHead>
                                <TableHead className="text-right">Available</TableHead>
                                <TableHead className="text-right pr-4">Issue Qty</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {group.components.map((comp) => {
                                const key = compKey(group.orderDetailId, comp.component_id);
                                const issueQty = issueQuantities[key] ?? comp.issue_quantity;
                                const isIncluded = includedComponents.has(key);
                                const alreadyIssued = issuedQuantitiesByComponent.get(comp.component_id) || 0;

                                return (
                                  <TableRow
                                    key={comp.component_id}
                                    className={cn(
                                      comp.has_warning && isIncluded && 'bg-amber-500/10',
                                      !isIncluded && 'opacity-50'
                                    )}
                                  >
                                    <TableCell className="pl-4">
                                      <Checkbox
                                        checked={isIncluded}
                                        onCheckedChange={() => toggleComponentInclusion(key)}
                                        aria-label={`Include ${comp.internal_code}`}
                                      />
                                    </TableCell>
                                    <TableCell>
                                      <div className="font-medium">{comp.internal_code}</div>
                                      {comp.description && (
                                        <div className="text-sm text-muted-foreground">{comp.description}</div>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      {formatQuantity(comp.required_quantity)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      {alreadyIssued > 0 ? (
                                        <span className={cn(
                                          'font-medium',
                                          alreadyIssued >= comp.required_quantity
                                            ? 'text-green-600'
                                            : 'text-muted-foreground'
                                        )}>
                                          {formatQuantity(alreadyIssued)}
                                        </span>
                                      ) : (
                                        <span className="text-muted-foreground">—</span>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      {comp.reserved_this_order > 0 ? (
                                        <span className="text-blue-600 font-medium">{formatQuantity(comp.reserved_this_order)}</span>
                                      ) : (
                                        <span className="text-muted-foreground">—</span>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <span className={cn(
                                        comp.available_quantity < (issueQty || 0) ? 'text-amber-600 font-medium' : ''
                                      )}>
                                        {formatQuantity(comp.available_quantity)}
                                      </span>
                                    </TableCell>
                                    <TableCell className="text-right pr-4">
                                      <Input
                                        type="text"
                                        inputMode="decimal"
                                        value={issueQty === 0 ? '' : issueQty}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          if (val === '' || val === '.' || /^\d*\.?\d*$/.test(val)) {
                                            updateIssueQuantity(key, val === '' || val === '.' ? 0 : parseFloat(val));
                                          }
                                        }}
                                        onBlur={(e) => {
                                          const val = parseFloat(e.target.value) || 0;
                                          updateIssueQuantity(key, val);
                                        }}
                                        className="w-24 ml-auto text-right"
                                        disabled={!isIncluded}
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                      {comp.has_warning && isIncluded && (
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
                      )}

                      {/* Expanded but no BOM */}
                      {isExpanded && group.components.length === 0 && (
                        <div className="border-t px-4 py-3">
                          <p className="text-sm text-muted-foreground">
                            No BOM components defined for this product. Use "+ Add Component" below to issue items manually.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Cutting List Board Stock */}
              <div className="border rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium flex items-center gap-2">
                      <Layers className="h-4 w-4 text-primary" />
                      <span>Cutting List Board Stock</span>
                      {cuttingBoardTotals.allIssued && (
                        <Badge
                          variant="outline"
                          className="inline-flex items-center gap-1 bg-green-500/10 text-green-600 border-green-500/30"
                        >
                          <CheckCircle className="h-3 w-3" />
                          All Issued
                        </Badge>
                      )}
                      {cuttingPlan?.stale && (
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30">
                          Stale plan
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground flex items-center gap-3 flex-wrap">
                      {cuttingBoardIssues.length > 0 ? (
                        <>
                          <span>{formatQuantity(cuttingBoardTotals.required)} sheets required</span>
                          <span>{formatQuantity(cuttingBoardTotals.remaining)} sheets remaining</span>
                          <span>{cuttingBoardTotals.issuedCount}/{cuttingBoardTotals.totalCount} board items issued</span>
                        </>
                      ) : (
                        <span>
                          {cuttingPlanLoading
                            ? 'Loading cutting plan...'
                            : hasCuttingPlan
                              ? 'No board stock required by the saved cutting plan'
                              : 'No saved cutting plan yet'}
                        </span>
                      )}
                    </div>
                  </div>
                  {cuttingBoardIssues.length > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleIssueCuttingBoardStock}
                      disabled={
                        issueStockMutation.isPending ||
                        !canIssueCuttingPlanBoards ||
                        checkedCuttingBoardsForIssuance.length === 0
                      }
                      className="shrink-0"
                    >
                      {issueStockMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Warehouse className="mr-2 h-4 w-4" />
                      )}
                      Issue Boards
                    </Button>
                  )}
                </div>

                {cuttingPlanLoading ? (
                  <div className="px-4 py-4 text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading cutting plan board stock...
                  </div>
                ) : !hasCuttingPlan ? (
                  <div className="px-4 py-4 text-sm text-muted-foreground">
                    Save a cutting plan before issuing board stock for the cut list.
                  </div>
                ) : (
                  <>
                    {cuttingPlan?.stale && (
                      <div className="px-4 py-3 border-b">
                        <Alert>
                          <Info className="h-4 w-4" />
                          <AlertDescription>
                            Regenerate the cutting plan before issuing board stock from this section.
                          </AlertDescription>
                        </Alert>
                      </div>
                    )}

                    {cuttingBoardIssues.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[40px] pl-4">
                              <Checkbox
                                checked={canIssueCuttingPlanBoards && allCuttingBoardsChecked}
                                disabled={!canIssueCuttingPlanBoards}
                                onCheckedChange={(checked) => toggleAllCuttingBoards(!!checked, cuttingBoardIssues)}
                                aria-label="Select all cutting list board stock"
                              />
                            </TableHead>
                            <TableHead>Board Stock</TableHead>
                            <TableHead>Use</TableHead>
                            <TableHead className="text-right">Required</TableHead>
                            <TableHead className="text-right">Issued</TableHead>
                            <TableHead className="text-right">Available</TableHead>
                            <TableHead className="text-right pr-4">Issue Sheets</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {cuttingBoardIssues.map((board) => {
                            const key = cuttingKey(board.component_id);
                            const isIncluded = includedComponents.has(key);
                            const isEnabled = canIssueCuttingPlanBoards && isIncluded;
                            const issueQty = issueQuantities[key] ?? board.issue_quantity;
                            const alreadyIssued = issuedQuantitiesByComponent.get(board.component_id) || 0;
                            const remaining = Math.max(0, board.required_quantity - alreadyIssued);

                            return (
                              <TableRow
                                key={board.component_id}
                                className={cn(
                                  board.has_warning && isEnabled && 'bg-amber-500/10',
                                  !isEnabled && 'opacity-60'
                                )}
                              >
                                <TableCell className="pl-4">
                                  <Checkbox
                                    checked={canIssueCuttingPlanBoards && isIncluded}
                                    disabled={!canIssueCuttingPlanBoards || remaining <= 0}
                                    onCheckedChange={() => toggleComponentInclusion(key)}
                                    aria-label={`Include ${board.internal_code}`}
                                  />
                                </TableCell>
                                <TableCell>
                                  <div className="font-medium">{board.internal_code}</div>
                                  {board.description && (
                                    <div className="text-sm text-muted-foreground">{board.description}</div>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <div className="text-sm">{board.roles.join(', ')}</div>
                                  {board.materialGroups.length > 0 && (
                                    <div className="text-xs text-muted-foreground">
                                      {board.materialGroups.join(', ')}
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  {formatQuantity(board.required_quantity)}
                                </TableCell>
                                <TableCell className="text-right">
                                  {alreadyIssued > 0 ? (
                                    <span className={cn(
                                      'font-medium',
                                      alreadyIssued >= board.required_quantity
                                        ? 'text-green-600'
                                        : 'text-muted-foreground'
                                    )}>
                                      {formatQuantity(alreadyIssued)}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  <span className={cn(
                                    board.available_quantity < (issueQty || 0) ? 'text-amber-600 font-medium' : ''
                                  )}>
                                    {formatQuantity(board.available_quantity)}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right pr-4">
                                  <Input
                                    type="text"
                                    inputMode="decimal"
                                    value={issueQty === 0 ? '' : issueQty}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (val === '' || val === '.' || /^\d*\.?\d*$/.test(val)) {
                                        updateIssueQuantity(key, val === '' || val === '.' ? 0 : parseFloat(val));
                                      }
                                    }}
                                    onBlur={(e) => {
                                      const val = parseFloat(e.target.value) || 0;
                                      updateIssueQuantity(key, clampQuantity(val, remaining));
                                    }}
                                    className="w-24 ml-auto text-right"
                                    disabled={!isEnabled || remaining <= 0}
                                  />
                                  {board.has_warning && isEnabled && (
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
                    ) : (
                      <div className="px-4 py-4 text-sm text-muted-foreground">
                        This saved cutting plan has no primary or backer board sheets to issue.
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Manual Components Section */}
              {manualComponents.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-blue-500/5 border-b flex items-center gap-2">
                    <span className="text-sm font-medium">Additional Components</span>
                    <Badge variant="outline" className="text-xs bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30">
                      Manual
                    </Badge>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40px] pl-4"></TableHead>
                        <TableHead>Component</TableHead>
                        <TableHead className="text-right">Available</TableHead>
                        <TableHead className="text-right">Issue Qty</TableHead>
                        <TableHead className="w-[50px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {manualComponents.map((comp) => {
                        const key = compKey(0, comp.component_id);
                        const issueQty = issueQuantities[key] ?? comp.issue_quantity;
                        const isIncluded = includedComponents.has(key);

                        return (
                          <TableRow key={comp.component_id} className={cn(!isIncluded && 'opacity-50')}>
                            <TableCell className="pl-4">
                              <Checkbox
                                checked={isIncluded}
                                onCheckedChange={() => toggleComponentInclusion(key)}
                                aria-label={`Include ${comp.internal_code}`}
                              />
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">{comp.internal_code}</div>
                              {comp.description && (
                                <div className="text-sm text-muted-foreground">{comp.description}</div>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatQuantity(comp.available_quantity)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="text"
                                inputMode="decimal"
                                value={issueQty === 0 ? '' : issueQty}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === '' || val === '.' || /^\d*\.?\d*$/.test(val)) {
                                    updateIssueQuantity(key, val === '' || val === '.' ? 0 : parseFloat(val));
                                  }
                                }}
                                onBlur={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  updateIssueQuantity(key, val);
                                }}
                                className="w-24 ml-auto text-right"
                                disabled={!isIncluded}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                                onClick={() => removeManualComponent(comp.component_id)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Add Component Button */}
              <div className="flex justify-end">
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
            </>
          )}

          {/* Staff Assignment and Notes */}
          {hasAnyProducts && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t">
              <div>
                <Label htmlFor="staff-select" className="text-xs text-muted-foreground">Issue To</Label>
                <Select
                  value={selectedStaffId?.toString() || 'none'}
                  onValueChange={(value) => setSelectedStaffId(value && value !== 'none' ? parseInt(value) : null)}
                >
                  <SelectTrigger id="staff-select" className="h-9">
                    <SelectValue placeholder="Select staff member...">
                      {selectedStaffId ? (
                        <span className="flex items-center gap-2">
                          <User className="h-3.5 w-3.5" />
                          {selectedStaff?.first_name}{' '}
                          {selectedStaff?.last_name}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Staff member...</span>
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
                <Label htmlFor="notes" className="text-xs text-muted-foreground">Notes</Label>
                <Input
                  id="notes"
                  placeholder="Issuance notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>
          )}
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
            {activeIssuanceHistory.length > 0 && order && (
              <StockIssuancePDFDownload
                order={order}
                issuances={activeIssuanceHistory.map((issuance) => ({
                  ...issuance,
                  quantity_issued: issuance.remaining_quantity,
                }))}
                issuanceDate={activeIssuanceHistory[0]?.issuance_date || new Date().toISOString()}
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
                        <TableRow
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => toggleIssuanceExpanded(group.groupKey)}
                        >
                          <TableCell>
                            {formatDateTime(group.issuance_date)}
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
                                  e.stopPropagation();
                                  try {
                                    const groupIssuances = group.items.flatMap(item => {
                                      const fullIssuance = activeIssuanceHistory.find(i => i.issuance_id === item.issuance_id);
                                      return fullIssuance
                                        ? [{ ...fullIssuance, quantity_issued: fullIssuance.remaining_quantity }]
                                        : [];
                                    });

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
                                  const fullIssuance = activeIssuanceHistory.find(i => i.issuance_id === item.issuance_id);
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

      <ReverseIssuanceDialog
        open={reversalDialogOpen}
        onOpenChange={setReversalDialogOpen}
        issuance={selectedIssuanceForReversal}
        onReversed={handleReversalComplete}
      />
    </div>
  );
}
