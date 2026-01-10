'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableHeader, TableBody, TableCell, TableHead, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Loader2,
  Warehouse,
  AlertCircle,
  Printer,
  RotateCcw,
  Plus,
  X,
  Search,
  User,
  FileText,
  Package,
  Download,
  ChevronDown,
  Clock,
  Check,
  XCircle,
  ClipboardList
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { pdf } from '@react-pdf/renderer';
import { ManualIssuancePDFDocument } from './ManualIssuancePDF';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

// Issue categories for phased rollout
const ISSUE_CATEGORIES = [
  { value: 'production', label: 'Production', description: 'Manufacturing/assembly work' },
  { value: 'customer_order', label: 'Customer Order (Not in Unity)', description: 'Legacy order not yet in system' },
  { value: 'samples', label: 'Samples', description: 'Product samples or prototypes' },
  { value: 'wastage', label: 'Wastage/Scrap', description: 'Damaged or scrapped materials' },
  { value: 'rework', label: 'Rework', description: 'Fixing defective items' },
  { value: 'other', label: 'Other', description: 'Other reasons' },
];

interface ComponentIssue {
  component_id: number;
  internal_code: string;
  description: string | null;
  available_quantity: number;
  issue_quantity: number;
  has_warning: boolean;
}

interface ManualIssuance {
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
  external_reference: string | null;
  issue_category: string | null;
}

// Grouped issuance for consolidated display
interface GroupedIssuance {
  groupKey: string;
  external_reference: string | null;
  issue_category: string | null;
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

// Group issuances by reference, category, staff, and timestamp (within same minute)
function groupIssuances(issuances: ManualIssuance[]): GroupedIssuance[] {
  const groups = new Map<string, GroupedIssuance>();
  
  for (const issuance of issuances) {
    // Create group key from reference, category, staff, and timestamp (truncated to minute)
    const dateMinute = issuance.issuance_date.substring(0, 16); // YYYY-MM-DDTHH:mm
    const groupKey = `${issuance.external_reference || ''}_${issuance.issue_category || ''}_${issuance.staff_id || ''}_${dateMinute}`;
    
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        groupKey,
        external_reference: issuance.external_reference,
        issue_category: issuance.issue_category,
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

interface PendingIssuance {
  pending_id: number;
  external_reference: string;
  issue_category: string;
  staff_id: number | null;
  staff: { first_name: string; last_name: string } | null;
  notes: string | null;
  status: 'pending' | 'issued' | 'cancelled';
  created_at: string;
  items: Array<{
    item_id: number;
    component_id: number;
    component: { internal_code: string; description: string | null };
    quantity: number;
  }>;
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

export function ManualStockIssueTab() {
  const queryClient = useQueryClient();
  
  // Form state
  const [selectedComponents, setSelectedComponents] = useState<ComponentIssue[]>([]);
  const [issueQuantities, setIssueQuantities] = useState<Record<number, number>>({});
  const [notes, setNotes] = useState<string>('');
  const [externalReference, setExternalReference] = useState<string>('');
  const [issueCategory, setIssueCategory] = useState<string>('production');
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);
  
  // Component search state
  const [componentSearchOpen, setComponentSearchOpen] = useState(false);
  const [componentSearchTerm, setComponentSearchTerm] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(true);

  // Missing inventory dialog state
  const [missingInventoryDialog, setMissingInventoryDialog] = useState<{
    open: boolean;
    componentIds: number[];
    componentCodes: string[];
  }>({ open: false, componentIds: [], componentCodes: [] });

  // Company info for PDF
  const [companyInfo, setCompanyInfo] = useState<any | null>(null);

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

  // Search components directly from components table
  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ['component-search', componentSearchTerm],
    queryFn: async () => {
      if (!componentSearchTerm.trim() || componentSearchTerm.length < 2) return [];

      const term = `%${componentSearchTerm}%`;
      const { data, error } = await supabase
        .from('components')
        .select(`
          component_id,
          internal_code,
          description,
          inventory(quantity_on_hand)
        `)
        .or(`internal_code.ilike.${term},description.ilike.${term}`)
        .limit(15);

      if (error) throw error;

      return (data || []).map((comp: any) => {
        const inv = Array.isArray(comp.inventory) ? comp.inventory[0] : comp.inventory;
        return {
          component_id: comp.component_id,
          internal_code: comp.internal_code,
          description: comp.description,
          quantity_on_hand: inv?.quantity_on_hand || 0,
        };
      });
    },
    enabled: componentSearchTerm.trim().length >= 2,
    staleTime: 30000,
  });

  // Add component to list
  const addComponent = useCallback((item: any) => {
    const componentId = item.component_id;
    const available = Number(item.quantity_on_hand || 0);
    
    if (selectedComponents.some(c => c.component_id === componentId)) {
      toast.error('Component already added');
      return;
    }
    
    setSelectedComponents(prev => [...prev, {
      component_id: componentId,
      internal_code: item.internal_code || 'Unknown',
      description: item.description || null,
      available_quantity: available,
      issue_quantity: 1,
      has_warning: available < 1,
    }]);
    
    setComponentSearchTerm('');
    setComponentSearchOpen(false);
  }, [selectedComponents]);

  // Remove component from list
  const removeComponent = useCallback((componentId: number) => {
    setSelectedComponents(prev => prev.filter(c => c.component_id !== componentId));
    setIssueQuantities(prev => {
      const next = { ...prev };
      delete next[componentId];
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

  // Fetch manual issuance history (no order_id)
  const { data: issuanceHistory = [], refetch: refetchHistory } = useQuery<ManualIssuance[]>({
    queryKey: ['manualStockIssuances'],
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
          external_reference,
          issue_category,
          component:components(
            internal_code,
            description
          ),
          staff:staff(
            first_name,
            last_name
          )
        `)
        .is('order_id', null)
        .order('issuance_date', { ascending: false })
        .limit(50);

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
        external_reference: item.external_reference,
        issue_category: item.issue_category,
      }));
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Fetch pending issuances
  const { data: pendingIssuances = [], refetch: refetchPending } = useQuery<PendingIssuance[]>({
    queryKey: ['pendingStockIssuances'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pending_stock_issuances')
        .select(`
          pending_id,
          external_reference,
          issue_category,
          staff_id,
          notes,
          status,
          created_at,
          staff:staff(first_name, last_name),
          items:pending_stock_issuance_items(
            item_id,
            component_id,
            quantity,
            component:components(internal_code, description)
          )
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []).map((item: any) => ({
        ...item,
        staff: Array.isArray(item.staff) ? item.staff[0] : item.staff,
        items: (item.items || []).map((i: any) => ({
          ...i,
          component: Array.isArray(i.component) ? i.component[0] : i.component,
        })),
      }));
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Group issuance history for consolidated display
  const groupedIssuanceHistory = useMemo(() => 
    groupIssuances(issuanceHistory), 
    [issuanceHistory]
  );

  // Create inventory record mutation
  const createInventoryMutation = useMutation({
    mutationFn: async (componentIds: number[]) => {
      const results = [];
      for (const componentId of componentIds) {
        const { data, error } = await supabase.rpc('create_inventory_for_component', {
          p_component_id: componentId,
          p_initial_quantity: 0,
        });
        if (error) throw error;
        if (!data || data.length === 0 || !data[0].success) {
          throw new Error(data?.[0]?.message || 'Failed to create inventory');
        }
        results.push(data[0]);
      }
      return results;
    },
    onSuccess: () => {
      toast.success('Inventory records created');
      setMissingInventoryDialog({ open: false, componentIds: [], componentCodes: [] });
      queryClient.invalidateQueries({ queryKey: ['component-search'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create inventory records');
    },
  });

  // Create pending issuance (picking list) mutation
  const createPendingMutation = useMutation({
    mutationFn: async (components: Array<{ component_id: number; quantity: number }>) => {
      const { data, error } = await supabase.rpc('create_pending_stock_issuance', {
        p_components: JSON.stringify(components),
        p_external_reference: externalReference,
        p_issue_category: issueCategory,
        p_staff_id: selectedStaffId,
        p_notes: notes || null,
      });
      if (error) throw error;
      if (!data || data.length === 0 || !data[0].success) {
        throw new Error(data?.[0]?.message || 'Failed to create picking list');
      }
      return data[0];
    },
    onSuccess: async (result) => {
      toast.success('Picking list created');
      // Generate and open PDF
      await handleGeneratePickingListPdf();
      // Reset form
      setSelectedComponents([]);
      setIssueQuantities({});
      setNotes('');
      setExternalReference('');
      setSelectedStaffId(null);
      refetchPending();
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create picking list');
    },
  });

  // Complete pending issuance mutation
  const completePendingMutation = useMutation({
    mutationFn: async (pendingId: number) => {
      const { data, error } = await supabase.rpc('complete_pending_stock_issuance', {
        p_pending_id: pendingId,
      });
      if (error) throw error;
      if (!data || data.length === 0 || !data[0].success) {
        throw new Error(data?.[0]?.message || 'Failed to issue stock');
      }
      return data[0];
    },
    onSuccess: () => {
      toast.success('Stock issued successfully');
      queryClient.invalidateQueries({ queryKey: ['pendingStockIssuances'] });
      queryClient.invalidateQueries({ queryKey: ['manualStockIssuances'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      refetchPending();
      refetchHistory();
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to issue stock');
    },
  });

  // Cancel pending issuance mutation
  const cancelPendingMutation = useMutation({
    mutationFn: async (pendingId: number) => {
      const { data, error } = await supabase.rpc('cancel_pending_stock_issuance', {
        p_pending_id: pendingId,
      });
      if (error) throw error;
      if (!data || data.length === 0 || !data[0].success) {
        throw new Error(data?.[0]?.message || 'Failed to cancel');
      }
      return data[0];
    },
    onSuccess: () => {
      toast.success('Pending issuance cancelled');
      refetchPending();
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to cancel');
    },
  });

  // Issue stock mutation
  const issueStockMutation = useMutation({
    mutationFn: async (issues: Array<{ component_id: number; quantity: number }>) => {
      const results: any[] = [];
      const missingInventory: { componentId: number; code: string }[] = [];

      for (const issue of issues) {
        const { data, error } = await supabase.rpc('process_manual_stock_issuance', {
          p_component_id: issue.component_id,
          p_quantity: issue.quantity,
          p_notes: notes || null,
          p_external_reference: externalReference || null,
          p_issue_category: issueCategory,
          p_staff_id: selectedStaffId,
          p_issuance_date: new Date().toISOString(),
        });

        if (error) {
          console.error('Manual issuance RPC error:', error);
          throw error;
        }

        if (!data || data.length === 0 || !data[0].success) {
          const errorMsg = data?.[0]?.message || 'Failed to issue stock';
          // Check if it's a missing inventory error
          if (errorMsg.startsWith('NO_INVENTORY:')) {
            const code = errorMsg.replace('NO_INVENTORY:', '');
            missingInventory.push({ componentId: issue.component_id, code });
            continue;
          }
          throw new Error(errorMsg);
        }

        results.push(data[0]);
      }

      // If we have missing inventory, throw special error
      if (missingInventory.length > 0) {
        const error = new Error('MISSING_INVENTORY') as any;
        error.missingInventory = missingInventory;
        throw error;
      }

      return results;
    },
    onSuccess: () => {
      toast.success('Stock issued successfully');
      setSelectedComponents([]);
      setIssueQuantities({});
      setNotes('');
      setExternalReference('');
      setSelectedStaffId(null);
      queryClient.invalidateQueries({ queryKey: ['manualStockIssuances'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] });
      refetchHistory();
    },
    onError: (error: any) => {
      console.error('Manual issuance error:', error);
      // Handle missing inventory error - show dialog
      if (error.message === 'MISSING_INVENTORY' && error.missingInventory) {
        const missing = error.missingInventory as Array<{ componentId: number; code: string }>;
        setMissingInventoryDialog({
          open: true,
          componentIds: missing.map(m => m.componentId),
          componentCodes: missing.map(m => m.code),
        });
        return;
      }
      toast.error(error.message || 'Failed to issue stock');
    },
  });

  // Handle issue stock
  const handleIssueStock = useCallback(() => {
    const issuesToProcess = selectedComponents
      .filter(comp => {
        const issueQty = issueQuantities[comp.component_id] ?? comp.issue_quantity;
        return issueQty > 0;
      })
      .map(comp => ({
        component_id: comp.component_id,
        quantity: issueQuantities[comp.component_id] ?? comp.issue_quantity,
      }));

    if (issuesToProcess.length === 0) {
      toast.error('Please add components to issue');
      return;
    }

    if (!externalReference.trim()) {
      toast.error('Please enter an external reference (PO#, Job#, etc.)');
      return;
    }

    issueStockMutation.mutate(issuesToProcess);
  }, [selectedComponents, issueQuantities, externalReference, issueStockMutation]);

  // Generate picking list PDF (helper function)
  const handleGeneratePickingListPdf = async () => {
    try {
      const components = selectedComponents.map(comp => ({
        component_id: comp.component_id,
        internal_code: comp.internal_code,
        description: comp.description,
        quantity: issueQuantities[comp.component_id] ?? comp.issue_quantity,
      }));

      const staffName = selectedStaffId
        ? `${staffMembers.find(s => s.staff_id === selectedStaffId)?.first_name || ''} ${staffMembers.find(s => s.staff_id === selectedStaffId)?.last_name || ''}`.trim()
        : null;

      const blob = await pdf(
        <ManualIssuancePDFDocument
          components={components}
          externalReference={externalReference}
          issueCategory={ISSUE_CATEGORIES.find(c => c.value === issueCategory)?.label || issueCategory}
          issuedTo={staffName}
          notes={notes || null}
          issuanceDate={new Date().toISOString()}
          companyInfo={companyInfo}
          type="picking"
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
  };

  // Save as picking list (creates pending issuance)
  const handleSaveAsPickingList = useCallback(() => {
    const componentsToSave = selectedComponents
      .filter(comp => {
        const issueQty = issueQuantities[comp.component_id] ?? comp.issue_quantity;
        return issueQty > 0;
      })
      .map(comp => ({
        component_id: comp.component_id,
        quantity: issueQuantities[comp.component_id] ?? comp.issue_quantity,
      }));

    if (componentsToSave.length === 0) {
      toast.error('Please add components to the picking list');
      return;
    }

    if (!externalReference.trim()) {
      toast.error('Please enter an external reference (PO#, Job#, etc.)');
      return;
    }

    createPendingMutation.mutate(componentsToSave);
  }, [selectedComponents, issueQuantities, externalReference, createPendingMutation]);

  // Generate picking list PDF only (no save)
  const handleGeneratePickingList = async () => {
    if (selectedComponents.length === 0) {
      toast.error('Please add components first');
      return;
    }
    await handleGeneratePickingListPdf();
  };

  // Reverse issuance mutation
  const reverseIssuanceMutation = useMutation({
    mutationFn: async ({ issuanceId, quantity, reason }: { issuanceId: number; quantity: number; reason: string }) => {
      const { data, error } = await supabase.rpc('reverse_stock_issuance', {
        p_issuance_id: issuanceId,
        p_quantity_to_reverse: quantity,
        p_reason: reason || null,
      });

      if (error) throw error;
      if (!data || data.length === 0 || !data[0].success) {
        throw new Error(data?.[0]?.message || 'Failed to reverse issuance');
      }
      return data[0];
    },
    onSuccess: () => {
      toast.success('Issuance reversed successfully');
      queryClient.invalidateQueries({ queryKey: ['manualStockIssuances'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] });
      refetchHistory();
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to reverse issuance');
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Warehouse className="h-5 w-5" />
            Issue Stock Manually
          </CardTitle>
          <CardDescription>
            Issue components from inventory without linking to an order in Unity.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Reference and Category */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <div className="space-y-2">
              <Label htmlFor="external-reference" className="flex items-center gap-1">
                External Reference <span className="text-destructive">*</span>
              </Label>
              <Input
                id="external-reference"
                placeholder="e.g., PO-2024-001, JOB-123, Customer Name"
                value={externalReference}
                onChange={(e) => setExternalReference(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="issue-category">Issue Category</Label>
              <Select value={issueCategory} onValueChange={setIssueCategory}>
                <SelectTrigger id="issue-category" className="h-11">
                  <SelectValue placeholder="Select category..." />
                </SelectTrigger>
                <SelectContent>
                  {ISSUE_CATEGORIES.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Component Selection */}
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
                    {componentSearchTerm.trim().length < 2 ? (
                      <p className="p-3 text-sm text-muted-foreground text-center">
                        Type at least 2 characters to search...
                      </p>
                    ) : isSearching ? (
                      <div className="p-3 flex items-center justify-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm">Searching...</span>
                      </div>
                    ) : searchResults.length === 0 ? (
                      <p className="p-3 text-sm text-muted-foreground text-center">
                        No components found for "{componentSearchTerm}"
                      </p>
                    ) : (
                      searchResults.map((item: any) => (
                        <div
                          key={item.component_id}
                          className="flex items-center justify-between p-3 hover:bg-muted cursor-pointer border-b last:border-0"
                          onClick={() => addComponent(item)}
                        >
                          <div>
                            <div className="font-medium">{item.internal_code}</div>
                            <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                              {item.description || 'No description'}
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
            
            {selectedComponents.length === 0 ? (
              <div className="border rounded-lg p-8 text-center text-muted-foreground">
                <Package className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p>No components added yet.</p>
                <p className="text-sm">Click "Add Component" to search and add items to issue.</p>
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Component</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead className="text-right">Issue Qty</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedComponents.map((comp) => {
                      const issueQty = issueQuantities[comp.component_id] ?? comp.issue_quantity;
                      const hasWarning = comp.available_quantity < issueQty;
                      return (
                        <TableRow key={comp.component_id} className={cn(hasWarning && 'bg-amber-50')}>
                          <TableCell>
                            <div className="font-medium">{comp.internal_code}</div>
                            {comp.description && (
                              <div className="text-sm text-muted-foreground">{comp.description}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={cn(hasWarning && 'text-amber-600 font-medium')}>
                              {formatQuantity(comp.available_quantity)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min="0"
                              value={issueQty}
                              onChange={(e) => updateIssueQuantity(comp.component_id, parseFloat(e.target.value) || 0)}
                              className="w-24 ml-auto text-right"
                            />
                            {hasWarning && (
                              <div className="text-xs text-amber-600 mt-1">
                                Insufficient stock
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                              onClick={() => removeComponent(comp.component_id)}
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
          </div>

          {/* Staff and Notes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
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
            <div className="space-y-2">
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
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={handleGeneratePickingList}
              disabled={selectedComponents.length === 0}
            >
              <FileText className="mr-2 h-4 w-4" />
              Print Picking List
            </Button>
            <Button
              variant="secondary"
              onClick={handleSaveAsPickingList}
              disabled={createPendingMutation.isPending || selectedComponents.length === 0}
            >
              {createPendingMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <ClipboardList className="mr-2 h-4 w-4" />
                  Save as Picking List
                </>
              )}
            </Button>
            <Button
              onClick={handleIssueStock}
              disabled={issueStockMutation.isPending || selectedComponents.length === 0}
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

      {/* Pending Issues */}
      <Collapsible open={pendingOpen} onOpenChange={setPendingOpen}>
        <Card>
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Pending Issues
                {pendingIssuances.length > 0 && (
                  <Badge variant="secondary">{pendingIssuances.length}</Badge>
                )}
              </CardTitle>
              <CardDescription>
                Picking lists waiting to be issued from inventory
              </CardDescription>
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 self-start">
                {pendingOpen ? 'Hide' : 'Show'}
                <ChevronDown
                  className={cn('h-4 w-4 transition-transform', pendingOpen ? 'rotate-180' : 'rotate-0')}
                />
              </Button>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent>
              {pendingIssuances.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No pending issues. Picking lists will appear here.
                </p>
              ) : (
                <div className="space-y-4">
                  {pendingIssuances.map((pending) => (
                    <div key={pending.pending_id} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="font-semibold text-lg">{pending.external_reference}</div>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Badge variant="outline">
                              {ISSUE_CATEGORIES.find(c => c.value === pending.issue_category)?.label || pending.issue_category}
                            </Badge>
                            <span>•</span>
                            <span>{format(new Date(pending.created_at), 'MMM d, yyyy HH:mm')}</span>
                            {pending.staff && (
                              <>
                                <span>•</span>
                                <span className="flex items-center gap-1">
                                  <User className="h-3 w-3" />
                                  {pending.staff.first_name} {pending.staff.last_name}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => completePendingMutation.mutate(pending.pending_id)}
                            disabled={completePendingMutation.isPending}
                          >
                            {completePendingMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <Check className="h-4 w-4 mr-1" />
                                Issue Stock
                              </>
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (confirm('Cancel this pending issuance?')) {
                                cancelPendingMutation.mutate(pending.pending_id);
                              }
                            }}
                            disabled={cancelPendingMutation.isPending}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Component</TableHead>
                            <TableHead className="text-right">Quantity</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pending.items.map((item) => (
                            <TableRow key={item.item_id}>
                              <TableCell>
                                <div className="font-medium">{item.component?.internal_code || 'Unknown'}</div>
                                {item.component?.description && (
                                  <div className="text-xs text-muted-foreground">{item.component.description}</div>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {formatQuantity(item.quantity)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {pending.notes && (
                        <div className="mt-2 text-sm text-muted-foreground">
                          <span className="font-medium">Notes:</span> {pending.notes}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Issuance History */}
      <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
        <Card>
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>Manual Issuance History</CardTitle>
              <CardDescription>
                Recent manual stock issuances (not linked to Unity orders)
              </CardDescription>
            </div>
            <CollapsibleTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 self-start"
              >
                {historyOpen ? 'Hide history' : 'Show history'}
                <ChevronDown
                  className={cn('h-4 w-4 transition-transform', historyOpen ? 'rotate-180' : 'rotate-0')}
                />
              </Button>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent>
              {groupedIssuanceHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No manual issuances recorded yet.
                </p>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Component</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead>Issued To</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {groupedIssuanceHistory.map((group) => (
                        <TableRow key={group.groupKey}>
                          <TableCell className="text-sm align-top">
                            {format(new Date(group.issuance_date), 'MMM d, yyyy HH:mm')}
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="font-medium">{group.external_reference || '-'}</div>
                          </TableCell>
                          <TableCell className="align-top">
                            <Badge variant="outline">
                              {ISSUE_CATEGORIES.find(c => c.value === group.issue_category)?.label || group.issue_category || '-'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              {group.items.map((item) => (
                                <div key={item.issuance_id} className="flex items-center gap-2">
                                  <div className="flex-1">
                                    <div className="font-medium">{item.component?.internal_code || 'Unknown'}</div>
                                    {item.component?.description && (
                                      <div className="text-xs text-muted-foreground truncate max-w-[150px]">
                                        {item.component.description}
                                      </div>
                                    )}
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0 opacity-50 hover:opacity-100"
                                    onClick={() => {
                                      if (confirm(`Reverse ${formatQuantity(item.quantity_issued)} of ${item.component?.internal_code}?`)) {
                                        reverseIssuanceMutation.mutate({
                                          issuanceId: item.issuance_id,
                                          quantity: item.quantity_issued,
                                          reason: 'Manual reversal',
                                        });
                                      }
                                    }}
                                    title="Reverse this item"
                                  >
                                    <RotateCcw className="h-3 w-3" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-right align-top">
                            <div className="space-y-1">
                              {group.items.map((item) => (
                                <div key={item.issuance_id} className="font-medium h-6 flex items-center justify-end">
                                  {formatQuantity(item.quantity_issued)}
                                </div>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            {group.staff ? (
                              <div className="flex items-center gap-1.5">
                                <User className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="text-sm">{group.staff.first_name} {group.staff.last_name}</span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right align-top">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={async () => {
                                try {
                                  const staffName = group.staff 
                                    ? `${group.staff.first_name} ${group.staff.last_name}`
                                    : null;
                                  // Include all components in the group for a single consolidated PDF
                                  const components = group.items.map(item => ({
                                    component_id: item.component_id,
                                    internal_code: item.component?.internal_code || 'Unknown',
                                    description: item.component?.description || null,
                                    quantity: item.quantity_issued,
                                  }));
                                  const blob = await pdf(
                                    <ManualIssuancePDFDocument
                                      components={components}
                                      externalReference={group.external_reference || ''}
                                      issueCategory={ISSUE_CATEGORIES.find(c => c.value === group.issue_category)?.label || group.issue_category || 'Unknown'}
                                      issuedTo={staffName}
                                      notes={group.notes || null}
                                      issuanceDate={group.issuance_date}
                                      companyInfo={companyInfo}
                                      type="issuance"
                                    />
                                  ).toBlob();
                                  const url = URL.createObjectURL(blob);
                                  const link = document.createElement('a');
                                  link.href = url;
                                  link.download = `issuance-${group.external_reference || group.groupKey}-${format(new Date(group.issuance_date), 'yyyyMMdd')}.pdf`;
                                  document.body.appendChild(link);
                                  link.click();
                                  document.body.removeChild(link);
                                  URL.revokeObjectURL(url);
                                } catch (error) {
                                  console.error('Failed to generate PDF:', error);
                                  toast.error('Failed to generate PDF');
                                }
                              }}
                              title="Download PDF"
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Missing Inventory Dialog */}
      <Dialog
        open={missingInventoryDialog.open}
        onOpenChange={(open) => {
          if (!open) setMissingInventoryDialog({ open: false, componentIds: [], componentCodes: [] });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              Missing Inventory Records
            </DialogTitle>
            <DialogDescription>
              The following components don't have inventory records. Would you like to create them?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <ul className="space-y-2">
              {missingInventoryDialog.componentCodes.map((code, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{code}</span>
                  <span className="text-muted-foreground">— No inventory record</span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground mt-4">
              Creating inventory records will initialize stock quantity to 0. You can then:
            </p>
            <ul className="text-sm text-muted-foreground mt-2 space-y-1 ml-4 list-disc">
              <li>Issue stock (creating negative inventory for tracking)</li>
              <li>Receive stock to add positive quantities</li>
            </ul>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMissingInventoryDialog({ open: false, componentIds: [], componentCodes: [] })}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createInventoryMutation.mutate(missingInventoryDialog.componentIds)}
              disabled={createInventoryMutation.isPending}
            >
              {createInventoryMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Inventory Records'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
