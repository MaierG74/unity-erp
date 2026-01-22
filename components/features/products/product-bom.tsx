'use client';

import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Edit, Save, X, Search, Loader2, Building2, SlidersHorizontal, XCircle, Upload } from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/use-debounce';
import React from 'react';
import {
  cloneCutlistDimensions,
  summariseCutlistDimensions,
  CutlistDimensions,
} from '@/lib/cutlist/cutlistDimensions';

// Dynamically import dialogs on the client only to avoid server bundling issues
const AddFromCollectionDialog = dynamic(() => import('./AddFromCollectionDialog'), { ssr: false });
const AddProductToBOMDialog = dynamic(() => import('./AddProductToBOMDialog'), { ssr: false });
const AddComponentDialog = dynamic(() => import('./AddComponentDialog'), { ssr: false });
const BOMOverrideDialog = dynamic(() => import('./BOMOverrideDialog'), { ssr: false });
const ImportCutlistCSVDialog = dynamic(() => import('./ImportCutlistCSVDialog'), { ssr: false });

// Define types
interface Component {
  component_id: number;
  internal_code: string;
  description: string | null;
}

interface Supplier {
  supplier_id: number;
  name: string;
}

interface SupplierComponent {
  supplier_component_id: number;
  component_id: number;
  supplier_id: number;
  price: number;
  supplier: Supplier;
}

// Our normalized BOM item type for use in the component
interface BOMItem {
  bom_id: number;
  product_id: number;
  component_id: number;
  quantity_required: number;
  supplier_component_id: number | null;
  component: Component;
  supplierComponent?: {
    supplier_component_id: number;
    component_id: number;
    supplier_id: number;
    price: number;
    supplier: {
      supplier_id: number;
      name: string;
    };
  };
  is_cutlist_item: boolean;
  cutlist_category: string | null;
  cutlist_dimensions: CutlistDimensions | null;
}

// Effective BOM unified item type (server aggregate)
interface EffectiveBOMItem {
  bom_id?: number | null;
  component_id: number;
  quantity_required: number;
  supplier_component_id: number | null;
  suppliercomponents?: { price?: number } | null;
  _source?: 'direct' | 'link';
  _sub_product_id?: number;
  _editable?: boolean;
  is_cutlist_item?: boolean | null;
  cutlist_category?: string | null;
  cutlist_dimensions?: CutlistDimensions | null;
}

// Linked sub-product record for badge list
interface ProductLink {
  sub_product_id: number;
  scale: number;
  mode: string;
  product?: { product_id: number; internal_code: string; name: string };
}

// Form schema for adding/editing BOM items
const preprocessOptionalNumber = (value: unknown) => {
  if (value === '' || value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return undefined;
    const num = Number(trimmed);
    return Number.isNaN(num) ? value : num;
  }
  return value;
};

const optionalNumber = (message: string, { allowZero = false }: { allowZero?: boolean } = {}) =>
  z
    .preprocess(
      preprocessOptionalNumber,
      z
        .number({ invalid_type_error: message })
        .refine((num) => (allowZero ? num >= 0 : num > 0), { message })
    )
    .optional();

const bomItemSchema = z.object({
  component_id: z.string().min(1, 'Component is required'),
  // Allow any positive decimal
  quantity_required: z.coerce
    .number()
    .positive('Quantity must be greater than 0'),
  supplier_component_id: z.string().optional(),
  is_cutlist_item: z.boolean().optional(),
  cutlist_category: z.string().max(120, 'Category is too long').optional(),
  cutlist_length_mm: optionalNumber('Length must be greater than 0'),
  cutlist_width_mm: optionalNumber('Width must be greater than 0'),
  cutlist_thickness_mm: optionalNumber('Thickness must be greater than 0'),
  cutlist_quantity_per: optionalNumber('Quantity per must be greater than 0'),
  cutlist_grain: z.enum(['any', 'length', 'width']).optional(),
  cutlist_edge_top: z.boolean().optional(),
  cutlist_edge_right: z.boolean().optional(),
  cutlist_edge_bottom: z.boolean().optional(),
  cutlist_edge_left: z.boolean().optional(),
  cutlist_laminate_enabled: z.boolean().optional(),
  cutlist_laminate_backer_component_id: z.string().optional(),
  cutlist_material_code: z.string().optional(),
  cutlist_material_label: z.string().optional(),
  cutlist_colour_family: z.string().optional(),
  cutlist_finish_side: z.enum(['single', 'double', 'none']).optional(),
  cutlist_notes: z.string().optional(),
});

type BOMItemFormValues = z.infer<typeof bomItemSchema>;

interface ProductBOMProps {
  productId: number;
}

const defaultFormValues: BOMItemFormValues = {
  component_id: '',
  quantity_required: 1,
  supplier_component_id: '',
  is_cutlist_item: false,
  cutlist_category: '',
  cutlist_length_mm: undefined,
  cutlist_width_mm: undefined,
  cutlist_thickness_mm: undefined,
  cutlist_quantity_per: undefined,
  cutlist_grain: undefined,
  cutlist_edge_top: false,
  cutlist_edge_right: false,
  cutlist_edge_bottom: false,
  cutlist_edge_left: false,
  cutlist_laminate_enabled: false,
  cutlist_laminate_backer_component_id: '',
  cutlist_material_code: '',
  cutlist_material_label: '',
  cutlist_colour_family: '',
  cutlist_finish_side: undefined,
  cutlist_notes: '',
};

const mapItemToFormValues = (item: BOMItem): BOMItemFormValues => {
  const dims = item.cutlist_dimensions ?? null;
  const bandEdges = dims?.band_edges ?? {};
  return {
    component_id: item.component_id.toString(),
    quantity_required: Number(item.quantity_required ?? 1),
    supplier_component_id: item.supplier_component_id ? item.supplier_component_id.toString() : '',
    is_cutlist_item: Boolean(item.is_cutlist_item),
    cutlist_category: item.cutlist_category ?? '',
    cutlist_length_mm: dims?.length_mm ?? undefined,
    cutlist_width_mm: dims?.width_mm ?? undefined,
    cutlist_thickness_mm: dims?.thickness_mm ?? undefined,
    cutlist_quantity_per: dims?.quantity_per ?? undefined,
    cutlist_grain: dims?.grain ?? undefined,
    cutlist_edge_top: Boolean(bandEdges.top),
    cutlist_edge_right: Boolean(bandEdges.right),
    cutlist_edge_bottom: Boolean(bandEdges.bottom),
    cutlist_edge_left: Boolean(bandEdges.left),
    cutlist_laminate_enabled: Boolean(dims?.laminate?.enabled),
    cutlist_laminate_backer_component_id:
      dims?.laminate?.backer_component_id != null ? String(dims.laminate.backer_component_id) : '',
    cutlist_material_code: dims?.material_code ?? '',
    cutlist_material_label: dims?.material_label ?? '',
    cutlist_colour_family: dims?.colour_family ?? '',
    cutlist_finish_side: dims?.finish_side ?? undefined,
    cutlist_notes: dims?.notes ?? '',
  };
};

export function ProductBOM({ productId }: ProductBOMProps) {
  const [editingItem, setEditingItem] = useState<BOMItem | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [componentSearch, setComponentSearch] = useState('');
  const [supplierSearch, setSupplierSearch] = useState('');
  const [cutlistBackerSearch, setCutlistBackerSearch] = useState('');
  const [cutlistBackerPickerOpen, setCutlistBackerPickerOpen] = useState(false);
  const [supplierFilter, setSupplierFilter] = useState('');
  const [showComponentDropdown, setShowComponentDropdown] = useState(false);
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Quick view dialog state
  const [quickViewOpen, setQuickViewOpen] = useState(false);
  const [quickViewProductId, setQuickViewProductId] = useState<number | null>(null);
  const [quickTab, setQuickTab] = useState<'overview' | 'bom' | 'bol'>('overview')
  const openQuickView = useCallback((id: number) => {
    setQuickViewProductId(id);
    setQuickTab('overview')
    setQuickViewOpen(true);
  }, []);

  // Browse-by-supplier side panel state
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseSupplierQuery, setBrowseSupplierQuery] = useState('');
  const [browseComponentQuery, setBrowseComponentQuery] = useState('');
  const [browseSupplierId, setBrowseSupplierId] = useState<number | null>(null);
  // Add Component (controlled) state for opening dialog from Browse-by-supplier
  const [addComponentOpen, setAddComponentOpen] = useState(false)
  const [addComponentPrefill, setAddComponentPrefill] = useState<{ component_id?: number; supplier_component_id?: number } | undefined>(undefined)
  const [overrideDialog, setOverrideDialog] = useState<{ bomId: number; componentId: number | null } | null>(null)
  
  // Initialize form
  const form = useForm<BOMItemFormValues>({
    resolver: zodResolver(bomItemSchema),
    defaultValues: defaultFormValues,
  });

  // Watch the component_id to fetch suppliers when it changes
  const watchedComponentId = form.watch('component_id');
  
  // Add state to track if supplier feature is available
  const [supplierFeatureAvailable, setSupplierFeatureAvailable] = useState(false);

  // Check if supplier_component_id column exists
  useEffect(() => {
    const checkSupplierFeature = async () => {
      try {
        // Try to query a BOM item with supplier_component_id
        const { data, error } = await supabase
          .from('billofmaterials')
          .select('supplier_component_id')
          .limit(1);
          
        if (error) {
          console.error('Error checking supplier feature:', error);
          setSupplierFeatureAvailable(false);
        } else {
          setSupplierFeatureAvailable(true);
          console.log('Supplier feature is available');
        }
      } catch (err) {
        console.error('Error checking supplier feature:', err);
        setSupplierFeatureAvailable(false);
      }
    };
    
    checkSupplierFeature();
  }, []);

  // Fetch BOM items for this product
  const { data: bomItems = [], isLoading: bomLoading } = useQuery({
    queryKey: ['productBOM', productId, supplierFeatureAvailable],
    queryFn: async () => {
      console.log('Fetching BOM items for product ID:', productId);
      
      let query = supabase
        .from('billofmaterials')
        .select(`
          bom_id,
          product_id,
          component_id,
          quantity_required,
          is_cutlist_item,
          cutlist_category,
          cutlist_dimensions,
          components (
            component_id,
            internal_code,
            description
          )
        `);

      // Add supplier_component_id and join with suppliercomponents only if the feature is available
      if (supplierFeatureAvailable) {
        query = supabase
          .from('billofmaterials')
          .select(`
            bom_id,
            product_id,
            component_id,
            quantity_required,
            supplier_component_id,
            is_cutlist_item,
            cutlist_category,
            cutlist_dimensions,
            components (
              component_id,
              internal_code,
              description
            ),
            supplierComponent:suppliercomponents (
              supplier_component_id,
              component_id,
              supplier_id,
              price,
              supplier:suppliers (
                supplier_id,
                name
              )
            )
          `);
      }
        
      const { data, error } = await query.eq('product_id', productId);
        
      if (error) {
        console.error('Error fetching BOM items:', error);
        throw error;
      }
      
      console.log('Fetched BOM items:', data);
      
      // Transform the response to match our BOMItem interface
      return data.map((item: any) => ({
        bom_id: item.bom_id,
        product_id: item.product_id,
        component_id: item.component_id,
        quantity_required: item.quantity_required,
        supplier_component_id: item.supplier_component_id || null,
        component: item.components,
        supplierComponent: item.supplierComponent || undefined,
        is_cutlist_item: Boolean(item.is_cutlist_item),
        cutlist_category: item.cutlist_category ?? null,
        cutlist_dimensions: cloneCutlistDimensions(item.cutlist_dimensions) ?? null,
      }));
    },
  });

  // Map: bom_id -> full direct BOM row (for inline editing within unified table)
  const bomById = React.useMemo(() => {
    const m = new Map<number, BOMItem>()
    for (const b of bomItems || []) {
      if (typeof b?.bom_id === 'number') m.set(Number(b.bom_id), b)
    }
    return m
  }, [bomItems])

  // Effective BOM (includes attached links) for totals; fetch unconditionally and choose at compute time
  const featureAttach = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_FEATURE_ATTACH_BOM === 'true'
  const { data: effectiveBOM } = useQuery({
    // Always fetch; we'll decide whether to use it when computing totals
    enabled: true,
    queryKey: ['effectiveBOM', productId],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/products/${productId}/effective-bom`)
        if (!res.ok) return { items: [] }
        return (await res.json()) as { items: EffectiveBOMItem[] }
      } catch {
        return { items: [] }
      }
    }
  })

  // Helpers for BOL math in quick view
  const convertToHoursQuick = (time: number | null, unit: string): number => {
    if (!time) return 0
    switch (unit) {
      case 'hours':
        return time
      case 'minutes':
        return time / 60
      case 'seconds':
        return time / 3600
      default:
        return time
    }
  }
  const calcBOLCostQuick = (item: any): number => {
    if ((item.pay_type || 'hourly') === 'piece') {
      const pieceRate = item.piece_rate?.rate || 0
      return pieceRate * (item.quantity || 1)
    }
    const hourlyRate = item.rate?.hourly_rate || item.job?.category?.current_hourly_rate || 0
    const hours = convertToHoursQuick(item.time_required, item.time_unit)
    return hourlyRate * hours * (item.quantity || 1)
  }

  // Quick effective BOM for popup (read-only)
  const { data: quickEffectiveBOM, isLoading: quickBomLoading } = useQuery({
    enabled: quickViewOpen && !!quickViewProductId && quickTab === 'bom',
    queryKey: ['quickEffectiveBOM', quickViewProductId],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/products/${quickViewProductId}/effective-bom`)
        if (!res.ok) return { items: [] }
        return (await res.json()) as { items: EffectiveBOMItem[] }
      } catch {
        return { items: [] }
      }
    }
  })

  // Quick BOL for popup (read-only)
  const { data: quickBOL = [], isLoading: quickBolLoading } = useQuery({
    enabled: quickViewOpen && !!quickViewProductId && quickTab === 'bol',
    queryKey: ['quickBOL', quickViewProductId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billoflabour')
        .select(`
          bol_id,
          product_id,
          job_id,
          time_required,
          time_unit,
          quantity,
          rate_id,
          pay_type,
          piece_rate_id,
          jobs (
            job_id,
            name,
            description,
            category_id,
            job_categories (
              category_id,
              name,
              description,
              current_hourly_rate
            )
          ),
          job_category_rates (
            rate_id,
            category_id,
            hourly_rate,
            effective_date,
            end_date
          ),
          piece_rate:piece_work_rates (
            rate_id,
            rate
          )
        `)
        .eq('product_id', quickViewProductId as number)
      if (error) throw error
      return (data || []).map((item: any) => ({
        bol_id: item.bol_id,
        product_id: item.product_id,
        job_id: item.job_id,
        time_required: item.time_required,
        time_unit: item.time_unit,
        quantity: item.quantity,
        rate_id: item.rate_id,
        pay_type: item.pay_type || 'hourly',
        piece_rate_id: item.piece_rate_id,
        job: {
          ...item.jobs,
          category: item.jobs.job_categories
        },
        rate: item.job_category_rates,
        piece_rate: item.piece_rate
      }))
    }
  })

  // Quick product fetch for the popup
  const { data: quickProduct, isLoading: quickLoading } = useQuery({
    enabled: quickViewOpen && !!quickViewProductId,
    queryKey: ['quickProduct', quickViewProductId],
    queryFn: async () => {
      // Fetch basic product fields (products table does not include primary_image)
      const { data: product, error } = await supabase
        .from('products')
        .select('product_id, internal_code, name, description')
        .eq('product_id', quickViewProductId as number)
        .single();
      if (error) throw error;

      // Fetch images to resolve a primary image, mirroring product detail page
      const { data: images, error: imgErr } = await supabase
        .from('product_images')
        .select('*')
        .eq('product_id', quickViewProductId as number);
      if (imgErr) throw imgErr;

      const primaryImage = images?.find((img: any) => img.is_primary)?.image_url ||
                           (images && images.length > 0 ? (images[0] as any).image_url : null);

      return {
        ...(product as any),
        primary_image: primaryImage as string | null,
      } as { product_id: number; internal_code: string; name: string | null; description: string | null; primary_image: string | null };
    }
  })

  // Fetch linked sub-products for badges and detach controls
  const { data: productLinks = [], isLoading: linksLoading } = useQuery({
    enabled: featureAttach,
    queryKey: ['productBOMLinks', productId],
    queryFn: async () => {
      try {
        const { data: links, error: linkErr } = await supabase
          .from('product_bom_links')
          .select('sub_product_id, scale, mode')
          .eq('product_id', productId)
        if (linkErr) throw linkErr

        const ids = (links || []).map((l: any) => l.sub_product_id)
        let map: Record<number, { product_id: number; internal_code: string; name: string }> = {}
        if (ids.length > 0) {
          const { data: prods, error: prodErr } = await supabase
            .from('products')
            .select('product_id, internal_code, name')
            .in('product_id', ids)
          if (!prodErr && prods) {
            for (const p of prods as any[]) map[(p as any).product_id] = p as any
          }
        }

        return (links || []).map((l: any) => ({
          sub_product_id: Number(l.sub_product_id),
          scale: Number(l.scale ?? 1),
          mode: String(l.mode || 'phantom'),
          product: map[Number(l.sub_product_id)],
        })) as ProductLink[]
      } catch (e) {
        console.error('Failed to load product links', e)
        return [] as ProductLink[]
      }
    }
  })

  // Allow detaching a linked sub-product
  const detachLink = useMutation({
    mutationFn: async (subProductId: number) => {
      const res = await fetch(`/api/products/${productId}/bom/attach-product?sub_product_id=${subProductId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to detach')
      return true
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productBOMLinks', productId] })
      queryClient.invalidateQueries({ queryKey: ['effectiveBOM', productId] })
      queryClient.invalidateQueries({ queryKey: ['cutlist-effective-bom', productId] })
      toast({ title: 'Detached', description: 'Sub-product link removed' })
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to detach sub-product', variant: 'destructive' })
    },
  })

  // Map sub_product_id -> product for showing source code in Effective BOM
  const linkProductMap = React.useMemo(() => {
    const m = new Map<number, { product_id: number; internal_code: string; name: string }>()
    for (const l of productLinks || []) {
      if (l?.product) m.set(Number(l.sub_product_id), l.product)
    }
    return m
  }, [productLinks])

  // Helper to build a lookup map for components (defined here to avoid TDZ issues)
  const buildComponentsById = (list: Component[]) => {
    const m = new Map<number, Component>()
    for (const c of list || []) {
      if (c) m.set(c.component_id, c)
    }
    return m
  }

  // Debug: log effective BOM and computed total when data changes (dev only)
  useEffect(() => {
    if (typeof window !== 'undefined' && effectiveBOM) {
      const items = effectiveBOM.items || []
      const total = items.reduce((sum, it) => {
        const price = (it as any)?.suppliercomponents?.price
        return price != null ? sum + Number(price) * Number((it as any).quantity_required) : sum
      }, 0)
      console.debug('[BOM] effective items:', items.length, 'computed total:', total)
    }
  }, [effectiveBOM])
  
  // Fetch all components for the dropdown
  const { data: componentsList = [], isLoading: componentsLoading } = useQuery({
    queryKey: ['components'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('components')
        .select('component_id, internal_code, description');
        
      if (error) throw error;
      return data as Component[];
    },
  });

  // Map of components for quick lookup when rendering effective BOM (now safe, after query declaration)
  const componentsById = React.useMemo(() => buildComponentsById(componentsList || []), [componentsList])
  const componentSummaries = React.useMemo(() => {
    return (componentsList || []).map((component: any) => ({
      component_id: Number(component.component_id),
      internal_code: component.internal_code || '',
      description: component.description || null,
    }));
  }, [componentsList])
  
  // Suppliers list for the browser
  const { data: allSuppliers = [] } = useQuery({
    queryKey: ['suppliers','simple-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('supplier_id, name')
        .order('name');
      if (error) throw error;
      return data as Supplier[];
    },
  });

  // Supplier components for chosen supplier (joined to master component)
  const { data: browseSupplierComponents = [], isLoading: browseLoading } = useQuery({
    queryKey: ['suppliercomponents-by-supplier', browseSupplierId],
    enabled: !!browseSupplierId,
    queryFn: async () => {
      if (!browseSupplierId) return [] as any[];
      const { data, error } = await supabase
        .from('suppliercomponents')
        .select(`
          supplier_component_id,
          supplier_id,
          component_id,
          supplier_code,
          price,
          component:components ( component_id, internal_code, description )
        `)
        .eq('supplier_id', browseSupplierId)
        .order('component_id');
      if (error) throw error;
      return data as Array<{ supplier_component_id: number; supplier_id: number; component_id: number; supplier_code: string; price: number; component: Component }>;
    },
  });

  // Fetch suppliers for the selected component
  const { data: supplierComponents = [], isLoading: suppliersLoading } = useQuery({
    queryKey: ['supplierComponents', watchedComponentId],
    queryFn: async () => {
      if (!watchedComponentId) return [];
      
      const { data, error } = await supabase
        .from('suppliercomponents')
        .select(`
          supplier_component_id,
          component_id,
          supplier_id,
          price,
          lead_time,
          min_order_quantity,
          supplier:suppliers (
            supplier_id,
            name
          )
        `)
        .eq('component_id', parseInt(watchedComponentId));
        
      if (error) throw error;
      
      return data as unknown as SupplierComponent[];
    },
    enabled: !!watchedComponentId, // Only run query when a component is selected
  });

  // Completely remove all filtering logic and use a simple approach
  const getFilteredComponents = () => {
    if (!componentsList || componentsList.length === 0) return [];
    if (!componentSearch) return componentsList;
    
    console.log("Filtering components with search term:", componentSearch);
    
    const normalizedSearch = componentSearch.toLowerCase().trim();
    const filtered = componentsList.filter(component => {
      if (!component) return false;
      
      const codeText = (component.internal_code || '').toLowerCase();
      const descText = (component.description || '').toLowerCase();
      
      return codeText.includes(normalizedSearch) || descText.includes(normalizedSearch);
    });
    
    console.log(`Found ${filtered.length} components matching '${componentSearch}'`);
    return filtered;
  };
  
  const getFilteredSupplierComponents = () => {
    if (!supplierComponents || supplierComponents.length === 0) return [];
    if (!supplierSearch) return supplierComponents;
    
    console.log("Filtering suppliers with search term:", supplierSearch);
    
    const normalizedSearch = supplierSearch.toLowerCase().trim();
    const filtered = supplierComponents.filter(sc => {
      if (!sc) return false;
      
      const supplierName = (sc?.supplier?.name || '').toLowerCase();
      
      return supplierName.includes(normalizedSearch);
    });
    
    console.log(`Found ${filtered.length} suppliers matching '${supplierSearch}'`);
    return filtered;
  };
  
  // Get filtered lists directly when rendering
  const filteredComponents = getFilteredComponents();
  const filteredSuppliers = getFilteredSupplierComponents();
  const filteredBackerComponents = React.useMemo(() => {
    if (!componentsList || componentsList.length === 0) return [] as typeof componentsList;
    const search = cutlistBackerSearch.trim().toLowerCase();
    if (!search) return componentsList;
    return componentsList.filter((component: any) => {
      if (!component) return false;
      const code = (component.internal_code || '').toLowerCase();
      const desc = (component.description || '').toLowerCase();
      return code.includes(search) || desc.includes(search);
    });
  }, [componentsList, cutlistBackerSearch]);

  // Add BOM item mutation
  const addBOMItem = useMutation({
    mutationFn: async (values: BOMItemFormValues) => {
      try {
        let cutlistPayload: CutlistDimensions | null = null;
        try {
          cutlistPayload = buildCutlistPayloadFromValues(values);
        } catch (error: any) {
          throw new Error(error?.message ?? 'Cutlist configuration invalid');
        }

        // Build the insert object
        const insertData: any = {
          product_id: productId,
          component_id: parseInt(values.component_id),
          // Store quantity as a decimal
          quantity_required: Number(values.quantity_required),
          is_cutlist_item: Boolean(values.is_cutlist_item),
          cutlist_category: values.cutlist_category?.trim() || null,
          cutlist_dimensions: cutlistPayload,
        };
        
        // Only include supplier_component_id if the feature is available and a value is provided
        if (supplierFeatureAvailable && values.supplier_component_id) {
          insertData.supplier_component_id = parseInt(values.supplier_component_id);
        }
        
        console.log('Adding BOM item with data:', insertData);
        
        const { data, error } = await supabase
          .from('billofmaterials')
          .insert(insertData)
          .select();
          
        if (error) {
          console.error('Supabase error:', error);
          throw new Error(`Database error: ${error.message}`);
        }
        
        console.log('Successfully added BOM item:', data);
        return data;
      } catch (error: any) {
        console.error('Error in mutation:', error);
        throw error;
      }
    },
    onSuccess: (data) => {
      console.log('BOM item added successfully, invalidating queries', data);
      queryClient.invalidateQueries({ queryKey: ['productBOM', productId] });
      // Also refresh Effective BOM (explicit + linked) and any consumers like Costing
      queryClient.invalidateQueries({ queryKey: ['effectiveBOM', productId] });
      queryClient.invalidateQueries({ queryKey: ['effective-bom', productId] });
      queryClient.invalidateQueries({ queryKey: ['cutlist-effective-bom', productId] });
      form.reset(defaultFormValues);
      handleComponentSearchChange('');  // Reset search term
      handleSupplierSearchChange('');  // Reset supplier search term
      toast({
        title: 'Success',
        description: 'Component added to BOM',
      });
    },
    onError: (error) => {
      console.error('Error adding BOM item:', error);
      
      // Create a more user-friendly error message
      let errorMessage = 'Failed to add component to BOM';
      
      if (error.message && error.message.includes('invalid input syntax')) {
        errorMessage = 'The quantity must be a whole number. Please adjust your input.';
      } else if (error.message) {
        errorMessage = `${errorMessage}: ${error.message}`;
      }
      
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    },
  });
  
  // Update BOM item mutation
  const updateBOMItem = useMutation({
    mutationFn: async (values: BOMItemFormValues & { bom_id: number; cutlist_payload: CutlistDimensions | null }) => {
      try {
        // Build the update object
        const updateData: any = {
          component_id: parseInt(values.component_id),
          // Store quantity as a decimal
          quantity_required: Number(values.quantity_required),
          is_cutlist_item: Boolean(values.is_cutlist_item),
          cutlist_category: values.cutlist_category?.trim() || null,
          cutlist_dimensions: values.cutlist_payload ?? null,
        };
        
        // Only include supplier_component_id if the feature is available and a value is provided
        if (supplierFeatureAvailable && values.supplier_component_id) {
          updateData.supplier_component_id = parseInt(values.supplier_component_id);
        }
        
        console.log('Updating BOM item with data:', updateData);
        
        const { data, error } = await supabase
          .from('billofmaterials')
          .update(updateData)
          .eq('bom_id', values.bom_id)
          .select();
          
        if (error) {
          console.error('Supabase error:', error);
          throw new Error(`Database error: ${error.message}`);
        }
        
        console.log('Successfully updated BOM item:', data);
        return data;
      } catch (error: any) {
        console.error('Error in update mutation:', error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productBOM', productId] });
      queryClient.invalidateQueries({ queryKey: ['effectiveBOM', productId] });
      queryClient.invalidateQueries({ queryKey: ['effective-bom', productId] });
      queryClient.invalidateQueries({ queryKey: ['cutlist-effective-bom', productId] });
      setEditingItem(null);
      setEditDialogOpen(false);
      form.reset(defaultFormValues);
      toast({
        title: 'Success',
        description: 'BOM item updated',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: 'Failed to update BOM item',
        variant: 'destructive',
      });
      console.error('Error updating BOM item:', error);
    },
  });
  
  // Delete BOM item mutation
  const deleteBOMItem = useMutation({
    mutationFn: async (bomId: number) => {
      const { error } = await supabase
        .from('billofmaterials')
        .delete()
        .eq('bom_id', bomId);
        
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productBOM', productId] });
      queryClient.invalidateQueries({ queryKey: ['effectiveBOM', productId] });
      queryClient.invalidateQueries({ queryKey: ['effective-bom', productId] });
      queryClient.invalidateQueries({ queryKey: ['cutlist-effective-bom', productId] });
      toast({
        title: 'Success',
        description: 'Component removed from BOM',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: 'Failed to remove component from BOM',
        variant: 'destructive',
      });
      console.error('Error deleting BOM item:', error);
    },
  });
  
  // Handle form submission for adding new BOM item
  const onSubmit = (values: BOMItemFormValues) => {
    console.log('Form submitted with values:', values);
    console.log('Current product ID:', productId);
    
    // Validate component_id is a valid number
    if (!values.component_id || isNaN(parseInt(values.component_id))) {
      console.error('Invalid component_id:', values.component_id);
      toast({
        title: 'Validation Error',
        description: 'Please select a valid component',
        variant: 'destructive',
      });
      return;
    }
    
    // Extra validation for supplier if the feature is available
    if (supplierFeatureAvailable && values.supplier_component_id) {
      if (isNaN(parseInt(values.supplier_component_id))) {
        console.error('Invalid supplier_component_id:', values.supplier_component_id);
        toast({
          title: 'Validation Error',
          description: 'Please select a valid supplier',
          variant: 'destructive',
        });
        return;
      }
    }
    
    addBOMItem.mutate(values);
  };
  
  // Start editing a BOM item
  const startEditing = (item: BOMItem) => {
    setEditingItem(item);
    form.reset(mapItemToFormValues(item));
    setCutlistBackerSearch('');
    setCutlistBackerPickerOpen(false);
    setEditDialogOpen(true);
  };

// Cancel editing
  const cancelEditing = () => {
    setEditingItem(null);
    setEditDialogOpen(false);
    handleComponentSearchChange('');
    handleSupplierSearchChange('');
    form.reset(defaultFormValues);
    setCutlistBackerSearch('');
    setCutlistBackerPickerOpen(false);
  };

const buildCutlistPayloadFromValues = (values: BOMItemFormValues): CutlistDimensions | null => {
  const isCutlist = Boolean(values.is_cutlist_item);
  const payload: CutlistDimensions = {};
  let hasData = false;

  if (values.cutlist_length_mm !== undefined) {
    payload.length_mm = values.cutlist_length_mm;
    hasData = true;
  }
  if (values.cutlist_width_mm !== undefined) {
    payload.width_mm = values.cutlist_width_mm;
    hasData = true;
  }
  if (values.cutlist_thickness_mm !== undefined) {
    payload.thickness_mm = values.cutlist_thickness_mm;
    hasData = true;
  }
  if (values.cutlist_quantity_per !== undefined) {
    payload.quantity_per = values.cutlist_quantity_per;
    hasData = true;
  }
  if (values.cutlist_grain) {
    payload.grain = values.cutlist_grain;
    hasData = true;
  }

  const bandEdges: Required<CutlistDimensions>['band_edges'] = {};
  if (values.cutlist_edge_top) bandEdges.top = true;
  if (values.cutlist_edge_right) bandEdges.right = true;
  if (values.cutlist_edge_bottom) bandEdges.bottom = true;
  if (values.cutlist_edge_left) bandEdges.left = true;
  if (Object.keys(bandEdges).length > 0) {
    payload.band_edges = bandEdges;
    hasData = true;
  }

  const laminateEnabled = Boolean(values.cutlist_laminate_enabled);
  const backerId = values.cutlist_laminate_backer_component_id?.trim();
  if (laminateEnabled || (backerId && backerId.length > 0)) {
    payload.laminate = {
      enabled: laminateEnabled,
      backer_component_id: backerId && !Number.isNaN(Number(backerId)) ? Number(backerId) : null,
    };
    hasData = true;
  }

  const materialCode = values.cutlist_material_code?.trim();
  if (materialCode) {
    payload.material_code = materialCode;
    hasData = true;
  }
  const materialLabel = values.cutlist_material_label?.trim();
  if (materialLabel) {
    payload.material_label = materialLabel;
    hasData = true;
  }
  const colourFamily = values.cutlist_colour_family?.trim();
  if (colourFamily) {
    payload.colour_family = colourFamily;
    hasData = true;
  }
  if (values.cutlist_finish_side) {
    payload.finish_side = values.cutlist_finish_side;
    hasData = true;
  }
  const notes = values.cutlist_notes?.trim();
  if (notes) {
    payload.notes = notes;
    hasData = true;
  }

  if (!hasData) {
    return null;
  }

  if (isCutlist) {
    if (payload.length_mm === undefined || payload.width_mm === undefined) {
      throw new Error('Length and width are required for cutlist items.');
    }
    if (payload.quantity_per === undefined) {
      payload.quantity_per = 1;
    }
  }

  return cloneCutlistDimensions(payload);
};

// Save edited BOM item
const saveEdit = (overrideBomId?: number) => {
  const bomId = overrideBomId ?? editingItem?.bom_id;
  if (!bomId) {
    toast({
      title: 'Nothing to save',
      description: 'No BOM row is currently selected for editing.',
      variant: 'destructive',
    });
    return;
  }
  const values = form.getValues();
  let cutlistPayload: CutlistDimensions | null = null;
  try {
    cutlistPayload = buildCutlistPayloadFromValues(values);
  } catch (error: any) {
    toast({
      title: 'Cutlist incomplete',
      description: error?.message ?? 'Provide required cutlist dimensions before saving.',
      variant: 'destructive',
    });
    return;
  }

  updateBOMItem.mutate({
    ...values,
    bom_id: bomId,
    cutlist_payload: cutlistPayload,
  });
};

const renderCutlistEditor = () => {
  const isCutlist = form.watch('is_cutlist_item');
  const laminateEnabled = form.watch('cutlist_laminate_enabled');
  const backerValue = form.watch('cutlist_laminate_backer_component_id');
  const lengthValue = form.watch('cutlist_length_mm');
  const widthValue = form.watch('cutlist_width_mm');
  const backerComponent = backerValue ? componentsById.get(Number(backerValue)) : undefined;
  const showMissingDimensions = Boolean(isCutlist) && (!lengthValue || !widthValue);

  return (
    <div className="flex flex-col gap-3 text-xs">
      <FormField
        control={form.control}
        name="is_cutlist_item"
        render={({ field }) => (
          <FormItem className="flex items-center gap-2">
            <FormControl>
              <Checkbox
                id="cutlist-toggle"
                checked={Boolean(field.value)}
                onCheckedChange={(checked) => field.onChange(Boolean(checked))}
              />
            </FormControl>
            <FormLabel htmlFor="cutlist-toggle" className="text-xs font-medium">
              Cutlist item
            </FormLabel>
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="cutlist_category"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-[11px] text-muted-foreground">Cutlist category</FormLabel>
            <FormControl>
              <Input
                placeholder="e.g., Panels"
                value={field.value ?? ''}
                onChange={(event) => field.onChange(event.target.value)}
              />
            </FormControl>
          </FormItem>
        )}
      />

      <div className="grid grid-cols-2 gap-2">
        <FormField
          control={form.control}
          name="cutlist_length_mm"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[11px] text-muted-foreground">Length (mm)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min="0"
                  step="0.1"
                  value={field.value === undefined ? '' : field.value}
                  onChange={(event) =>
                    field.onChange(event.target.value === '' ? undefined : Number(event.target.value))
                  }
                />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="cutlist_width_mm"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[11px] text-muted-foreground">Width (mm)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min="0"
                  step="0.1"
                  value={field.value === undefined ? '' : field.value}
                  onChange={(event) =>
                    field.onChange(event.target.value === '' ? undefined : Number(event.target.value))
                  }
                />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="cutlist_thickness_mm"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[11px] text-muted-foreground">Thickness (mm)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min="0"
                  step="0.1"
                  value={field.value === undefined ? '' : field.value}
                  onChange={(event) =>
                    field.onChange(event.target.value === '' ? undefined : Number(event.target.value))
                  }
                />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="cutlist_quantity_per"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[11px] text-muted-foreground">Quantity per</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min="0"
                  step="0.1"
                  value={field.value === undefined ? '' : field.value}
                  onChange={(event) =>
                    field.onChange(event.target.value === '' ? undefined : Number(event.target.value))
                  }
                />
              </FormControl>
            </FormItem>
          )}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <FormField
          control={form.control}
          name="cutlist_grain"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[11px] text-muted-foreground">Grain</FormLabel>
              <Select
                value={field.value ?? 'any'}
                onValueChange={(value) => field.onChange(value as BOMItemFormValues['cutlist_grain'])}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select grain" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="length">Length</SelectItem>
                  <SelectItem value="width">Width</SelectItem>
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="cutlist_finish_side"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[11px] text-muted-foreground">Finish side</FormLabel>
              <Select
                value={field.value ?? 'none'}
                onValueChange={(value) => field.onChange(value as BOMItemFormValues['cutlist_finish_side'])}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select finish" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="single">Single</SelectItem>
                  <SelectItem value="double">Double</SelectItem>
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <FormField
          control={form.control}
          name="cutlist_edge_top"
          render={({ field }) => (
            <FormItem className="flex items-center gap-2">
              <FormControl>
                <Checkbox
                  id="edge-top"
                  checked={Boolean(field.value)}
                  onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                />
              </FormControl>
              <FormLabel htmlFor="edge-top" className="text-xs">Edge band top</FormLabel>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="cutlist_edge_bottom"
          render={({ field }) => (
            <FormItem className="flex items-center gap-2">
              <FormControl>
                <Checkbox
                  id="edge-bottom"
                  checked={Boolean(field.value)}
                  onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                />
              </FormControl>
              <FormLabel htmlFor="edge-bottom" className="text-xs">Edge band bottom</FormLabel>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="cutlist_edge_left"
          render={({ field }) => (
            <FormItem className="flex items-center gap-2">
              <FormControl>
                <Checkbox
                  id="edge-left"
                  checked={Boolean(field.value)}
                  onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                />
              </FormControl>
              <FormLabel htmlFor="edge-left" className="text-xs">Edge band left</FormLabel>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="cutlist_edge_right"
          render={({ field }) => (
            <FormItem className="flex items-center gap-2">
              <FormControl>
                <Checkbox
                  id="edge-right"
                  checked={Boolean(field.value)}
                  onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                />
              </FormControl>
              <FormLabel htmlFor="edge-right" className="text-xs">Edge band right</FormLabel>
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name="cutlist_laminate_enabled"
        render={({ field }) => (
          <FormItem className="flex items-center gap-2">
            <FormControl>
              <Checkbox
                id="laminate-enabled"
                checked={Boolean(field.value)}
                onCheckedChange={(checked) => field.onChange(Boolean(checked))}
              />
            </FormControl>
            <FormLabel htmlFor="laminate-enabled" className="text-xs">
              Laminate / backer required
            </FormLabel>
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="cutlist_laminate_backer_component_id"
        render={({ field }) => (
          <FormItem className="space-y-2">
            <FormLabel className="text-[11px] text-muted-foreground">Backer component</FormLabel>
            <Popover
              open={cutlistBackerPickerOpen}
              onOpenChange={(open) => {
                setCutlistBackerPickerOpen(open);
                if (!open) setCutlistBackerSearch('');
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between"
                  disabled={!laminateEnabled}
                >
                  {field.value && backerComponent ? (
                    <span>
                      {backerComponent.internal_code || `Component #${backerComponent.component_id}`}
                      {backerComponent.description ? (
                        <span className="ml-2 text-[11px] text-muted-foreground">{backerComponent.description}</span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Select backer component</span>
                  )}
                  <Search className="ml-2 h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[360px] p-3" align="start">
                <div className="space-y-2">
                  <Input
                    autoFocus
                    placeholder="Search components..."
                    value={cutlistBackerSearch}
                    onChange={(event) => setCutlistBackerSearch(event.target.value)}
                    className="h-8"
                  />
                  <div className="max-h-56 overflow-y-auto space-y-1">
                    {filteredBackerComponents.length === 0 ? (
                      <div className="py-4 text-center text-xs text-muted-foreground">No components found</div>
                    ) : (
                      filteredBackerComponents.map((component: any) => (
                        <button
                          key={component.component_id}
                          type="button"
                          className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                          onClick={() => {
                            field.onChange(String(component.component_id));
                            setCutlistBackerPickerOpen(false);
                            setCutlistBackerSearch('');
                          }}
                        >
                          <div className="font-medium text-foreground">
                            {component.internal_code || `Component #${component.component_id}`}
                          </div>
                          {component.description && (
                            <div className="text-[11px] text-muted-foreground">{component.description}</div>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            {field.value && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => field.onChange('')}
              >
                Clear backer
              </Button>
            )}
          </FormItem>
        )}
      />

      <div className="grid grid-cols-2 gap-2">
        <FormField
          control={form.control}
          name="cutlist_material_code"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[11px] text-muted-foreground">Material code</FormLabel>
              <FormControl>
                <Input value={field.value ?? ''} onChange={(event) => field.onChange(event.target.value)} />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="cutlist_material_label"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[11px] text-muted-foreground">Material label</FormLabel>
              <FormControl>
                <Input value={field.value ?? ''} onChange={(event) => field.onChange(event.target.value)} />
              </FormControl>
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name="cutlist_colour_family"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-[11px] text-muted-foreground">Colour family</FormLabel>
            <FormControl>
              <Input value={field.value ?? ''} onChange={(event) => field.onChange(event.target.value)} />
            </FormControl>
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="cutlist_notes"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-[11px] text-muted-foreground">Notes</FormLabel>
            <FormControl>
              <Textarea
                rows={2}
                value={field.value ?? ''}
                onChange={(event) => field.onChange(event.target.value)}
              />
            </FormControl>
          </FormItem>
        )}
      />

      {showMissingDimensions && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
          Provide length and width when marking a component as a cutlist item.
        </div>
      )}
    </div>
  );
};
  
  // Show total cost of all components in the BOM
  const totalBOMCost = (() => {
    if ((featureAttach || true) && effectiveBOM?.items && effectiveBOM.items.length > 0) {
      return effectiveBOM.items.reduce((total, item) => {
        const price = item?.suppliercomponents?.price
        if (price != null) {
          return total + Number(price) * Number(item.quantity_required)
        }
        return total
      }, 0)
    }
    return bomItems.reduce((total, item) => {
      if (item.supplierComponent) {
        return total + (parseFloat(item.supplierComponent.price.toString()) * item.quantity_required);
      }
      return total;
    }, 0)
  })();

  // Add wrapper functions to track state changes
  const handleComponentSearchChange = (value: string) => {
    console.log("Component search changed to:", value);
    setComponentSearch(value);
  };

  const handleSupplierSearchChange = (value: string) => {
    console.log("Supplier search changed to:", value);
    setSupplierSearch(value);
    // Show the dropdown when searching
    if (value.length > 0) {
      setShowSupplierDropdown(true);
    }
  };

  // Add refs to the supplier dropdown containers
  const supplierDropdownRef = React.useRef<HTMLDivElement>(null);
  const formSupplierDropdownRef = React.useRef<HTMLDivElement>(null);

  // Add a click outside handler
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const clickedOutsideTableDropdown = supplierDropdownRef.current && 
                                          !supplierDropdownRef.current.contains(event.target as Node);
      const clickedOutsideFormDropdown = formSupplierDropdownRef.current && 
                                          !formSupplierDropdownRef.current.contains(event.target as Node);
      
      // If clicked outside both dropdowns, hide them
      if (clickedOutsideTableDropdown && clickedOutsideFormDropdown) {
        setShowSupplierDropdown(false);
      }
    }

    // Bind the event listener
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      // Unbind the event listener on clean up
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [supplierDropdownRef, formSupplierDropdownRef]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Bill of Materials</CardTitle>
              <CardDescription>
                Manage the components required to manufacture this product
              </CardDescription>
            </div>
            <div className="flex gap-2">
              {/* Add From Collection */}
              <AddFromCollectionDialog
                productId={productId}
                onApplied={() => {
                  queryClient.invalidateQueries({ queryKey: ['productBOM', productId, supplierFeatureAvailable] })
                  queryClient.invalidateQueries({ queryKey: ['effectiveBOM', productId] })
                  queryClient.invalidateQueries({ queryKey: ['effective-bom', productId] })
                  queryClient.invalidateQueries({ queryKey: ['cutlist-effective-bom', productId] })
                }}
              />
              {/* Browse by supplier (opens right-side panel) */}
              <Button variant="outline" onClick={() => setBrowseOpen(true)}>
                <Building2 className="h-4 w-4 mr-2" /> Browse by supplier
              </Button>
              {/* Import CSV (SketchUp cutlist) */}
              <ImportCutlistCSVDialog
                productId={productId}
                onApplied={() => {
                  queryClient.invalidateQueries({ queryKey: ['productBOM', productId, supplierFeatureAvailable] })
                  queryClient.invalidateQueries({ queryKey: ['effectiveBOM', productId] })
                  queryClient.invalidateQueries({ queryKey: ['effective-bom', productId] })
                  queryClient.invalidateQueries({ queryKey: ['cutlist-effective-bom', productId] })
                }}
              />
              {/* Add Component */}
              <AddComponentDialog
                productId={productId}
                supplierFeatureAvailable={supplierFeatureAvailable}
                onApplied={() => {
                  queryClient.invalidateQueries({ queryKey: ['productBOM', productId, supplierFeatureAvailable] })
                  queryClient.invalidateQueries({ queryKey: ['effectiveBOM', productId] })
                  queryClient.invalidateQueries({ queryKey: ['effective-bom', productId] })
                  queryClient.invalidateQueries({ queryKey: ['cutlist-effective-bom', productId] })
                }}
              />
              {/* Add Product (explode/copy its BOM) */}
              <AddProductToBOMDialog
                productId={productId}
                onApplied={() => {
                  queryClient.invalidateQueries({ queryKey: ['productBOM', productId, supplierFeatureAvailable] })
                  queryClient.invalidateQueries({ queryKey: ['effectiveBOM', productId] })
                  queryClient.invalidateQueries({ queryKey: ['effective-bom', productId] })
                  queryClient.invalidateQueries({ queryKey: ['productBOMLinks', productId] })
                  queryClient.invalidateQueries({ queryKey: ['productBOL', productId] })
                  queryClient.invalidateQueries({ queryKey: ['cutlist-effective-bom', productId] })
                }}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {featureAttach && (productLinks?.length || 0) > 0 && (
            <div className="mb-4">
              <div className="text-xs text-muted-foreground mb-2">Linked sub-products (phantom):</div>
              <div className="flex flex-wrap gap-2">
                {productLinks.map((lnk) => (
                  <div key={lnk.sub_product_id} className="flex items-center gap-2">
                    <button onClick={() => openQuickView(lnk.sub_product_id)} className="no-underline">
                      <Badge variant="secondary" className="cursor-pointer">
                        {(lnk.product?.internal_code || `#${lnk.sub_product_id}`)}
                        {lnk.scale !== 1 && <span className="ml-1 text-[10px] text-muted-foreground">× {Number(lnk.scale).toString()}</span>}
                      </Badge>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      title="Detach"
                      onClick={() => detachLink.mutate(lnk.sub_product_id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {supplierFeatureAvailable && (
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="text-right md:text-left">
                <span className="text-sm font-medium text-muted-foreground">Total component cost</span>
                <div className="text-lg font-bold text-foreground">R{totalBOMCost.toFixed(2)}</div>
              </div>
              <div className="w-full md:w-auto md:min-w-[18rem]">
                <div className="relative w-full">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={supplierFilter}
                    onChange={(e) => setSupplierFilter(e.target.value)}
                    placeholder="Filter by supplier"
                    className="h-9 pl-9 pr-10 placeholder:text-muted-foreground"
                  />
                  {supplierFilter && (
                    <button
                      type="button"
                      onClick={() => setSupplierFilter('')}
                      className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                      aria-label="Clear supplier filter"
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          {bomLoading ? (
            <div className="text-center py-4">Loading BOM data...</div>
          ) : (
            <>
              {/* Unified Effective BOM table (direct + linked) with inline editing for direct rows */}
              <div className="rounded-md border mb-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Component</TableHead>
                      <TableHead>Description</TableHead>
                      {supplierFeatureAvailable && (
                        <>
                          <TableHead>Supplier</TableHead>
                          <TableHead>Unit Price</TableHead>
                        </>
                      )}
                      <TableHead>Quantity</TableHead>
                      {supplierFeatureAvailable && <TableHead>Total</TableHead>}
                      <TableHead>Cutlist</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      const rows: EffectiveBOMItem[] = (effectiveBOM?.items && effectiveBOM.items.length > 0)
                        ? (effectiveBOM.items as EffectiveBOMItem[])
                        : (bomItems.map((b) => ({
                            bom_id: b.bom_id,
                            component_id: b.component_id,
                            quantity_required: b.quantity_required,
                            supplier_component_id: b.supplier_component_id,
                            _source: 'direct',
                            _editable: true,
                          })) as EffectiveBOMItem[])
                      if (rows.length === 0) {
                        return (
                          <TableRow>
                            <TableCell colSpan={supplierFeatureAvailable ? 9 : 6} className="text-center py-4">
                              No components added yet
                            </TableCell>
                          </TableRow>
                        )
                      }
                      const supplierQuery = supplierFeatureAvailable ? supplierFilter.trim().toLowerCase() : ''
                      const filteredRows = supplierQuery
                        ? rows.filter((row) => {
                            if (!supplierFeatureAvailable || !supplierQuery) return true
                            const directRow = row._editable && typeof row.bom_id === 'number'
                              ? bomById.get(Number(row.bom_id))
                              : undefined
                            const supplierName = directRow?.supplierComponent?.supplier?.name?.toLowerCase() ?? ''
                            return supplierName.includes(supplierQuery)
                          })
                        : rows

                      if (filteredRows.length === 0) {
                        return (
                          <TableRow key="no-filter-results">
                            <TableCell colSpan={supplierFeatureAvailable ? 9 : 6} className="text-center py-4 text-sm text-muted-foreground">
                              No components match the current supplier filter.
                            </TableCell>
                          </TableRow>
                        )
                      }

                      return filteredRows.map((it, idx) => {
                        const comp = componentsById.get(Number(it.component_id))
                        const code = comp?.internal_code || String(it.component_id)
                        const desc = comp?.description || ''
                        const direct = (it._editable && typeof it.bom_id === 'number') ? bomById.get(Number(it.bom_id)) : undefined
                        // Price resolution
                        const linkedPrice = (it as any)?.suppliercomponents?.price
                        const directUnitPrice = direct?.supplierComponent ? Number(direct.supplierComponent.price) : null
                        const qty = Number(it.quantity_required || direct?.quantity_required || 0)
                        const unitPrice = (directUnitPrice != null ? directUnitPrice : (linkedPrice != null ? Number(linkedPrice) : null))
                        const total = unitPrice != null ? unitPrice * qty : null
                        const fromCode = typeof it._sub_product_id === 'number' ? linkProductMap.get(Number(it._sub_product_id))?.internal_code : undefined
                        const resolvedCutlistDimensions = cloneCutlistDimensions(
                          direct?.cutlist_dimensions ?? (it as any)?.cutlist_dimensions ?? null
                        );
                        const resolvedCutlistCategory = direct?.cutlist_category ?? (it as any)?.cutlist_category ?? null;
                        const resolvedIsCutlist = Boolean(
                          direct?.is_cutlist_item ?? (it as any)?.is_cutlist_item ?? false
                        );
                        const cutlistSummary = summariseCutlistDimensions(resolvedCutlistDimensions);
                        const hasCutlistDetails =
                          resolvedCutlistDimensions != null && Object.keys(resolvedCutlistDimensions).length > 0;

                        // Read-only row (either direct not editing or linked)
                        return (
                          <TableRow key={`row-${idx}`}>
                            <TableCell>{code}</TableCell>
                            <TableCell>{desc}</TableCell>
                            {supplierFeatureAvailable && (
                              <>
                                <TableCell>{direct?.supplierComponent?.supplier?.name || '-'}</TableCell>
                                <TableCell>{unitPrice != null ? `R${unitPrice.toFixed(2)}` : '-'}</TableCell>
                              </>
                            )}
                            <TableCell>{qty.toFixed(2)}</TableCell>
                            {supplierFeatureAvailable && (
                              <TableCell>{total != null ? `R${total.toFixed(2)}` : '-'}</TableCell>
                            )}
                            <TableCell className="align-top">
                              {resolvedIsCutlist ? (
                                <div className="space-y-1">
                                  <div className="text-xs font-medium text-foreground">
                                    {cutlistSummary.headline ?? 'Cutlist item'}
                                  </div>
                                  {resolvedCutlistCategory ? (
                                    <div className="text-[11px] text-muted-foreground">
                                      Category: {resolvedCutlistCategory}
                                    </div>
                                  ) : null}
                                  {cutlistSummary.details.length > 0 ? (
                                    <>
                                      {cutlistSummary.details.slice(0, 2).map((detail, detailIndex) => (
                                        <div key={`${detail}-${detailIndex}`} className="text-[11px] text-muted-foreground">
                                          • {detail}
                                        </div>
                                      ))}
                                      {cutlistSummary.details.length > 2 && (
                                        <div className="text-[11px] text-muted-foreground italic">
                                          +{cutlistSummary.details.length - 2} more
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <div className="text-[11px] text-amber-600">Dimensions not specified</div>
                                  )}
                                </div>
                              ) : hasCutlistDetails ? (
                                <div className="space-y-1">
                                  <div className="text-xs font-medium text-foreground">Dimensions captured</div>
                                  {cutlistSummary.details.slice(0, 2).map((detail, detailIndex) => (
                                    <div key={`${detail}-${detailIndex}`} className="text-[11px] text-muted-foreground">
                                      • {detail}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {it._source === 'link' ? (
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline">Linked</Badge>
                                  {fromCode && (
                                    <button onClick={() => openQuickView(Number(it._sub_product_id))}>
                                      <Badge variant="secondary" className="cursor-pointer">{fromCode}</Badge>
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">Direct</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {direct ? (
                                <div className="flex items-center gap-2">
                                  <Button variant="ghost" size="icon" onClick={() => startEditing(direct)}>
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setOverrideDialog({ bomId: direct.bom_id, componentId: direct.component_id })}
                                    aria-label="Configure option overrides"
                                  >
                                    <SlidersHorizontal className="h-4 w-4" />
                                  </Button>
                                  <Button variant="destructiveSoft" size="icon" onClick={() => deleteBOMItem.mutate(direct.bom_id)} aria-label="Delete component">
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })
                    })()}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <Dialog open={editDialogOpen} onOpenChange={(open) => (open ? setEditDialogOpen(true) : cancelEditing())}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Edit BOM Component</DialogTitle>
            <DialogDescription>
              Update component details, supplier information, and cutlist metadata for this BOM row.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6">
            <Form {...form}>
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      {editingItem?.component?.internal_code || 'Component'}
                      {editingItem?.component?.description ? (
                        <span className="text-muted-foreground"> – {editingItem.component.description}</span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      BOM ID: {editingItem?.bom_id ?? '—'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={cancelEditing}>
                      Cancel
                    </Button>
                    <Button onClick={() => saveEdit()}>
                      Save changes
                    </Button>
                  </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                  <div className="space-y-6">
                    <FormField
                      control={form.control}
                      name="component_id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-medium text-foreground">Component</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  className={cn('w-full justify-between', !field.value && 'text-muted-foreground')}
                                >
                                  {field.value
                                    ? componentsList.find((c) => c?.component_id?.toString() === field.value)?.internal_code || 'Select component'
                                    : 'Select component'}
                                  <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-[420px] p-0">
                              <Command>
                                <CommandInput
                                  placeholder="Search components..."
                                  className="h-9"
                                  onValueChange={handleComponentSearchChange}
                                  value={componentSearch}
                                />
                                <CommandList>
                                  <CommandEmpty>No components found</CommandEmpty>
                                  <CommandGroup>
                                    {filteredComponents.map((component) => (
                                      <div
                                        key={component.component_id}
                                        className="px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                                        onClick={() => {
                                          form.setValue('component_id', component.component_id.toString());
                                          handleComponentSearchChange('');
                                          handleSupplierSearchChange('');
                                          setShowSupplierDropdown(false);
                                          const el = document.querySelector('[data-state="open"][role="dialog"]');
                                          if (el) (el as HTMLElement).click();
                                        }}
                                      >
                                        <div className="flex flex-col">
                                          <span className="font-medium">{component.internal_code || 'No code'}</span>
                                          {component.description && (
                                            <span className="text-xs text-muted-foreground">{component.description}</span>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {supplierFeatureAvailable ? (
                      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,220px)]">
                        <FormField
                          control={form.control}
                          name="supplier_component_id"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-sm font-medium text-foreground">Supplier</FormLabel>
                              <div className="relative" ref={formSupplierDropdownRef}>
                                <Input
                                  placeholder="Search suppliers..."
                                  value={supplierSearch}
                                  onChange={(event) => handleSupplierSearchChange(event.target.value)}
                                  className="mb-1 focus-visible:ring-1"
                                  disabled={!form.getValues().component_id || suppliersLoading}
                                  onFocus={() => setShowSupplierDropdown(true)}
                                />
                                {form.getValues().component_id && showSupplierDropdown && (
                                  <div className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-background shadow" data-supplier-dropdown>
                                    {supplierSearch && getFilteredSupplierComponents().length === 0 ? (
                                      <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                                        No suppliers found
                                      </div>
                                    ) : (
                                      <div>
                                        <div className="border-b p-2 text-xs font-semibold text-muted-foreground">
                                          Suppliers (sorted by lowest price first)
                                        </div>
                                        {getFilteredSupplierComponents()
                                          .sort((a, b) => {
                                            const priceA = parseFloat(a?.price?.toString() || '0');
                                            const priceB = parseFloat(b?.price?.toString() || '0');
                                            return priceA - priceB;
                                          })
                                          .map((sc) => (
                                            <div
                                              key={sc.supplier_component_id}
                                              className="px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                                              onClick={() => {
                                                form.setValue('supplier_component_id', sc.supplier_component_id.toString());
                                                handleSupplierSearchChange('');
                                                setShowSupplierDropdown(false);
                                              }}
                                            >
                                              <div className="flex items-center justify-between">
                                                <span>{sc?.supplier?.name || 'Unknown'}</span>
                                                <span className="font-medium">R{parseFloat(sc?.price?.toString() || '0').toFixed(2)}</span>
                                              </div>
                                            </div>
                                          ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                                {field.value && (
                                  <div className="mt-2 rounded-md border bg-accent/10 p-2.5 text-xs">
                                    <div className="flex items-center justify-between gap-2">
                                      <span>
                                        <span className="text-muted-foreground mr-1">Selected:</span>
                                        <span className="font-medium">
                                          {supplierComponents.find((sc) => sc.supplier_component_id.toString() === field.value)?.supplier?.name || 'Unknown'}
                                        </span>
                                      </span>
                                      <span className="font-medium text-primary">
                                        R{parseFloat(supplierComponents.find((sc) => sc.supplier_component_id.toString() === field.value)?.price?.toString() || '0').toFixed(2)}
                                      </span>
                                    </div>
                                  </div>
                                )}
                              </div>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {(() => {
                          const quantityValue = form.watch('quantity_required');
                          const supplierComponentValue = form.watch('supplier_component_id');
                          const supplierRecord = supplierComponentValue
                            ? supplierComponents.find(
                                (sc) => sc.supplier_component_id.toString() === supplierComponentValue
                              )
                            : undefined;
                          const unitPrice = supplierRecord ? Number(supplierRecord.price || 0) : null;
                          const total = unitPrice != null && quantityValue
                            ? unitPrice * Number(quantityValue)
                            : null;

                          return (
                            <div className="space-y-3">
                              <FormField
                                control={form.control}
                                name="quantity_required"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-sm font-medium text-foreground">
                                      Quantity required
                                    </FormLabel>
                                    <FormControl>
                                      <Input
                                        type="number"
                                        min="0.0001"
                                        step="any"
                                        placeholder="e.g., 0.05"
                                        title="Enter quantity (decimals allowed; supports < 0.1)"
                                        {...field}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                      Decimal values allowed (e.g., 1.5, 2.75)
                                    </p>
                                  </FormItem>
                                )}
                              />
                              <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
                                <div className="flex items-center justify-between">
                                  <span>Unit price</span>
                                  <span className="font-semibold text-foreground">
                                    {unitPrice != null ? `R${unitPrice.toFixed(2)}` : '—'}
                                  </span>
                                </div>
                                <div className="mt-1 flex items-center justify-between">
                                  <span>Total</span>
                                  <span className="font-semibold text-foreground">
                                    {total != null ? `R${total.toFixed(2)}` : '—'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    ) : (
                      <FormField
                        control={form.control}
                        name="quantity_required"
                        render={({ field }) => (
                          <FormItem className="md:max-w-xs">
                            <FormLabel className="text-sm font-medium text-foreground">Quantity required</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min="0.0001"
                                step="any"
                                placeholder="e.g., 0.05"
                                title="Enter quantity (decimals allowed; supports < 0.1)"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              Decimal values allowed (e.g., 1.5, 2.75)
                            </p>
                          </FormItem>
                        )}
                      />
                    )}
                  </div>

                  <div className="rounded-md border bg-muted/20 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-foreground">Cutlist</h4>
                      {form.watch('is_cutlist_item') ? (
                        <Badge variant="secondary">Enabled</Badge>
                      ) : (
                        <Badge variant="outline">Optional</Badge>
                      )}
                    </div>
                    {renderCutlistEditor()}
                  </div>
                </div>
              </div>
            </Form>
          </div>
        </DialogContent>
      </Dialog>

      <BOMOverrideDialog
        productId={productId}
        bomId={overrideDialog?.bomId ?? null}
        open={Boolean(overrideDialog)}
        onOpenChange={(open) => {
          if (!open) setOverrideDialog(null);
        }}
        baseComponent={overrideDialog?.componentId ? componentsById.get(Number(overrideDialog.componentId)) ?? null : null}
        components={componentSummaries}
      />
      {/* Quick Product View Dialog */}
      <Dialog open={quickViewOpen} onOpenChange={setQuickViewOpen}>
        <DialogContent className="sm:max-w-[820px]">
          <DialogHeader>
            <DialogTitle>{quickProduct?.internal_code || 'Product'}</DialogTitle>
            <DialogDescription>
              {quickProduct?.name || ''}
            </DialogDescription>
          </DialogHeader>
          <Tabs value={quickTab} onValueChange={(v) => setQuickTab(v as any)} className="mt-2">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="bom">Effective BOM</TabsTrigger>
              <TabsTrigger value="bol">Bill of Labor</TabsTrigger>
            </TabsList>

            {/* Overview */}
            <TabsContent value="overview" className="mt-4">
              <div className="space-y-3">
                {quickLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                  </div>
                ) : (
                  <>
                    {quickProduct?.primary_image && (
                      <div className="w-full rounded-md border bg-muted/10 p-2 flex items-center justify-center">
                        <img
                          src={quickProduct.primary_image}
                          alt={quickProduct.internal_code}
                          className="max-h-48 w-auto object-contain"
                        />
                      </div>
                    )}
                    {quickProduct?.description && (
                      <p className="text-sm whitespace-pre-wrap">{quickProduct.description}</p>
                    )}
                  </>
                )}
              </div>
            </TabsContent>

            {/* Effective BOM */}
            <TabsContent value="bom" className="mt-4">
              {quickBomLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading BOM…
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Component</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead>Unit Price</TableHead>
                        <TableHead>Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(quickEffectiveBOM?.items || []).map((it, idx) => {
                        const comp = componentsById.get(Number((it as any).component_id))
                        const code = comp?.internal_code || String((it as any).component_id)
                        const desc = comp?.description || ''
                        const qty = Number((it as any).quantity_required || 0)
                        const price = (it as any)?.suppliercomponents?.price
                        const total = price != null ? Number(price) * qty : null
                        return (
                          <TableRow key={`q-bom-${idx}`}>
                            <TableCell>{code}</TableCell>
                            <TableCell>{desc || '-'}</TableCell>
                            <TableCell>{qty.toFixed(2)}</TableCell>
                            <TableCell>{price != null ? `R${Number(price).toFixed(2)}` : '-'}</TableCell>
                            <TableCell>{total != null ? `R${total.toFixed(2)}` : '-'}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            {/* Bill of Labor */}
            <TabsContent value="bol" className="mt-4">
              {quickBolLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading BOL…
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead>Job</TableHead>
                        <TableHead>Time</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead>Rate</TableHead>
                        <TableHead>Total Time (hrs)</TableHead>
                        <TableHead>Total Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {quickBOL.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-4 text-sm text-muted-foreground">No jobs</TableCell>
                        </TableRow>
                      ) : (
                        quickBOL.map((item: any) => {
                          const category = item.job?.category
                          const rate = (item.pay_type || 'hourly') === 'piece' ? item.piece_rate?.rate : (item.rate?.hourly_rate || category?.current_hourly_rate)
                          const totalHrs = (item.pay_type || 'hourly') === 'piece' ? null : convertToHoursQuick(item.time_required, item.time_unit) * (item.quantity || 1)
                          const totalCost = calcBOLCostQuick(item)
                          return (
                            <TableRow key={`q-bol-${item.bol_id}`}>
                              <TableCell>{category?.name || '-'}</TableCell>
                              <TableCell>{item.job?.name || '-'}</TableCell>
                              <TableCell>{(item.pay_type || 'hourly') === 'piece' ? '—' : `${item.time_required} ${item.time_unit}`}</TableCell>
                              <TableCell>{item.quantity}</TableCell>
                              <TableCell>{(item.pay_type || 'hourly') === 'piece' ? `R${(rate || 0).toFixed(2)}/pc` : `R${(rate || 0).toFixed(2)}/hr`}</TableCell>
                              <TableCell>{totalHrs == null ? '—' : totalHrs.toFixed(2)}</TableCell>
                              <TableCell>R{totalCost.toFixed(2)}</TableCell>
                            </TableRow>
                          )
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
          <DialogFooter className="mt-4">
            {quickViewProductId && (
              <Link href={`/products/${quickViewProductId}`} className="no-underline">
                <Button variant="outline">Open full page</Button>
              </Link>
            )}
            <Button onClick={() => setQuickViewOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Controlled Add Component dialog for prefill from Browse-by-supplier */}
      <AddComponentDialog
        productId={productId}
        supplierFeatureAvailable={supplierFeatureAvailable}
        showTriggerButton={false}
        open={addComponentOpen}
        onOpenChange={setAddComponentOpen}
        prefill={addComponentPrefill}
        onApplied={() => {
          setAddComponentPrefill(undefined)
          queryClient.invalidateQueries({ queryKey: ['productBOM', productId, supplierFeatureAvailable] })
          queryClient.invalidateQueries({ queryKey: ['effectiveBOM', productId] })
          queryClient.invalidateQueries({ queryKey: ['effective-bom', productId] })
          queryClient.invalidateQueries({ queryKey: ['cutlist-effective-bom', productId] })
        }}
      />

      {/* Browse by Supplier – right side panel */}
      <Dialog open={browseOpen} onOpenChange={setBrowseOpen}>
        <DialogContent className="fixed left-auto right-0 top-0 translate-x-0 translate-y-0 h-screen max-w-[90vw] w-[1200px] sm:rounded-none p-0 overflow-hidden border-l shadow-2xl">
          <div className="flex h-full">
            {/* Suppliers */}
            <div className="w-64 shrink-0 border-r bg-card flex flex-col">
              <div className="p-4 border-b">
                <div className="text-sm font-medium mb-2">Suppliers</div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={browseSupplierQuery}
                    onChange={(e) => setBrowseSupplierQuery(e.target.value)}
                    placeholder="Search suppliers"
                    className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-auto">
                {(allSuppliers || [])
                  .filter(s => s.name.toLowerCase().includes(browseSupplierQuery.toLowerCase()))
                  .map(s => (
                    <button
                      key={s.supplier_id}
                      onClick={() => { setBrowseSupplierId(s.supplier_id); setBrowseComponentQuery(''); }}
                      className={cn('w-full text-left px-4 py-3 border-b hover:bg-accent hover:text-accent-foreground text-sm', browseSupplierId === s.supplier_id && 'bg-accent/50')}
                    >
                      {s.name}
                    </button>
                  ))}
                {(allSuppliers || []).length === 0 && (
                  <div className="p-4 text-sm text-muted-foreground">No suppliers</div>
                )}
              </div>
            </div>

            {/* Components for selected supplier */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="p-4 border-b flex items-center gap-4">
                <div className="text-sm font-medium">{browseSupplierId ? 'Components' : 'Select a supplier'}</div>
                {browseSupplierId && (
                  <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={browseComponentQuery}
                      onChange={(e) => setBrowseComponentQuery(e.target.value)}
                      placeholder="Filter components"
                      className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-auto">
                {browseSupplierId ? (
                  browseLoading ? (
                    <div className="p-4 text-sm text-muted-foreground">Loading…</div>
                  ) : (
                    <div className="min-w-full">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-background border-b">
                          <tr className="text-muted-foreground">
                            <th className="text-left p-3 w-32 font-medium">Code</th>
                            <th className="text-left p-3 font-medium">Description</th>
                            <th className="text-left p-3 w-36 font-medium">Supplier Code</th>
                            <th className="text-right p-3 w-24 font-medium">Price</th>
                            <th className="text-right p-3 w-32 font-medium">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(browseSupplierComponents || [])
                            .filter(it => {
                              const q = browseComponentQuery.toLowerCase();
                              if (!q) return true;
                              const f = [it.component?.internal_code || '', it.component?.description || '', it.supplier_code || ''].map(v => v.toLowerCase());
                              return f.some(x => x.includes(q));
                            })
                            .map((it) => (
                              <tr key={it.supplier_component_id} className="border-b hover:bg-muted/40">
                                <td className="p-3 font-medium">{it.component?.internal_code}</td>
                                <td className="p-3 max-w-0 truncate">{it.component?.description || '-'}</td>
                                <td className="p-3 truncate">{it.supplier_code || '-'}</td>
                                <td className="p-3 text-right">R{Number(it.price || 0).toFixed(2)}</td>
                                <td className="p-3 text-right">
                                  <Button 
                                    size="sm" 
                                    className="min-w-[80px]" 
                                    onClick={() => {
                                      setAddComponentPrefill({ component_id: it.component_id, supplier_component_id: supplierFeatureAvailable ? it.supplier_component_id : undefined })
                                      setBrowseOpen(false)
                                      setAddComponentOpen(true)
                                    }}
                                  >
                                    Select
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          {(!browseSupplierComponents || browseSupplierComponents.length === 0) && (
                            <tr>
                              <td className="p-6 text-center text-muted-foreground" colSpan={5}>No components available for this supplier</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : (
                  <div className="p-6 text-center text-muted-foreground">Choose a supplier on the left to browse their components.</div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
