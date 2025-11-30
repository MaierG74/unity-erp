'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Search, Check, ChevronLeft } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const formSchema = z.object({
  supplier_component_id: z.string().min(1, 'Please select a supplier component'),
  price_override: z.string().optional(),
});

const createComponentSchema = z.object({
  supplier_code: z.string().min(1, 'Supplier code is required'),
  description: z.string().optional(),
  price: z.string().min(1, 'Price is required'),
});

type Supplier = {
  supplier_id: number;
  name: string;
};

type SupplierComponent = {
  supplier_component_id: number;
  supplier_code: string;
  description: string | null;
  price: number | null;
  supplier: {
    supplier_id: number;
    name: string;
  };
};

type AddSupplierDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  componentId: number;
};

export function AddSupplierDialog({ open, onOpenChange, componentId }: AddSupplierDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [step, setStep] = useState<'select-supplier' | 'select-component'>('select-supplier');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSupplierComponent, setSelectedSupplierComponent] = useState<SupplierComponent | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      supplier_component_id: '',
      price_override: '',
    },
  });

  const createForm = useForm<z.infer<typeof createComponentSchema>>({
    resolver: zodResolver(createComponentSchema),
    defaultValues: {
      supplier_code: '',
      description: '',
      price: '',
    },
  });

  // Fetch all suppliers
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('supplier_id, name')
        .order('name');
      if (error) throw error;
      return data as Supplier[];
    },
    enabled: open,
  });

  // Fetch supplier components for selected supplier
  const { data: supplierComponents = [], isLoading } = useQuery({
    queryKey: ['available-supplier-components', componentId, selectedSupplierId],
    queryFn: async () => {
      if (!selectedSupplierId) return [];

      // First, get already linked supplier_component_ids
      const { data: existingLinks, error: linksError } = await supabase
        .from('suppliercomponents')
        .select('supplier_component_id')
        .eq('component_id', componentId);

      if (linksError) throw linksError;

      const linkedIds = existingLinks?.map((link) => link.supplier_component_id) || [];

      // Fetch all supplier components for this supplier not in the linked list
      let query = supabase
        .from('suppliercomponents')
        .select(`
          supplier_component_id,
          supplier_code,
          description,
          price,
          supplier:suppliers!inner (
            supplier_id,
            name
          )
        `)
        .eq('supplier_id', parseInt(selectedSupplierId))
        .is('component_id', null)
        .order('supplier_code');

      if (linkedIds.length > 0) {
        query = query.not('supplier_component_id', 'in', `(${linkedIds.join(',')})`);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as unknown as SupplierComponent[];
    },
    enabled: open && step === 'select-component' && !!selectedSupplierId,
  });

  // Filter supplier components based on search
  const filteredComponents = supplierComponents.filter((sc) => {
    const searchLower = searchTerm.toLowerCase();
    return (
      sc.supplier_code.toLowerCase().includes(searchLower) ||
      sc.description?.toLowerCase().includes(searchLower) ||
      sc.supplier.name.toLowerCase().includes(searchLower)
    );
  });

  // Create new supplier component mutation
  const createMutation = useMutation({
    mutationFn: async (values: z.infer<typeof createComponentSchema>) => {
      const { error } = await supabase.from('suppliercomponents').insert({
        component_id: componentId,
        supplier_id: parseInt(selectedSupplierId!),
        supplier_code: values.supplier_code,
        description: values.description || null,
        price: parseFloat(values.price),
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['component', componentId] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] });
      queryClient.invalidateQueries({ queryKey: ['available-supplier-components', componentId, selectedSupplierId] });
      toast({
        title: 'Supplier component created',
        description: 'The supplier component has been successfully created and linked.',
      });
      createForm.reset();
      setShowCreateForm(false);
      onOpenChange(false);
    },
    onError: (error) => {
      console.error('Error creating supplier component:', error);
      toast({
        title: 'Error',
        description: 'Failed to create supplier component. Please try again.',
        variant: 'destructive',
      });
    },
  });

  // Link supplier component mutation
  const linkMutation = useMutation({
    mutationFn: async (values: z.infer<typeof formSchema>) => {
      const supplierComponentId = parseInt(values.supplier_component_id);
      const priceOverride = values.price_override ? parseFloat(values.price_override) : undefined;

      // Update the supplier component with the new component_id link
      const updateData: any = {
        component_id: componentId,
      };

      // If price override is provided, update the price
      if (priceOverride !== undefined) {
        updateData.price = priceOverride;
      }

      const { error } = await supabase
        .from('suppliercomponents')
        .update(updateData)
        .eq('supplier_component_id', supplierComponentId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['component', componentId] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] });
      queryClient.invalidateQueries({ queryKey: ['available-supplier-components', componentId, selectedSupplierId] });
      toast({
        title: 'Supplier linked',
        description: 'The supplier component has been successfully linked.',
      });
      form.reset();
      setSelectedSupplierComponent(null);
      setSearchTerm('');
      onOpenChange(false);
    },
    onError: (error) => {
      console.error('Error linking supplier:', error);
      toast({
        title: 'Error',
        description: 'Failed to link supplier component. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const handleSelectSupplierComponent = (sc: SupplierComponent) => {
    setSelectedSupplierComponent(sc);
    form.setValue('supplier_component_id', sc.supplier_component_id.toString());
    form.setValue('price_override', sc.price?.toString() || '');
  };

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    linkMutation.mutate(values);
  };

  const onCreateSubmit = (values: z.infer<typeof createComponentSchema>) => {
    createMutation.mutate(values);
  };

  const handleClose = () => {
    form.reset();
    createForm.reset();
    setStep('select-supplier');
    setSelectedSupplierId(null);
    setSelectedSupplierComponent(null);
    setSearchTerm('');
    setShowCreateForm(false);
    onOpenChange(false);
  };

  const handleSupplierSelect = (supplierId: string) => {
    setSelectedSupplierId(supplierId);
    setStep('select-component');
  };

  const handleBack = () => {
    setStep('select-supplier');
    setSelectedSupplierId(null);
    setSelectedSupplierComponent(null);
    setSearchTerm('');
    setShowCreateForm(false);
  };

  const selectedSupplierName = suppliers.find(s => s.supplier_id.toString() === selectedSupplierId)?.name;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {step === 'select-component' && (
              <Button variant="ghost" size="sm" onClick={handleBack} className="h-8 w-8 p-0">
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <div className="flex-1">
              <DialogTitle>
                {step === 'select-supplier' ? 'Select Supplier' : `Select Component from ${selectedSupplierName}`}
              </DialogTitle>
              <DialogDescription>
                {step === 'select-supplier'
                  ? 'Choose which supplier you want to link to this component.'
                  : 'Select a supplier component from the list below to link to this component.'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col space-y-4">
          {step === 'select-supplier' ? (
            // Step 1: Select Supplier
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search suppliers..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>

              <div className="flex-1 overflow-auto border rounded-lg">
                {suppliers.filter(s => 
                  s.name.toLowerCase().includes(searchTerm.toLowerCase())
                ).length === 0 ? (
                  <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                    {searchTerm ? 'No suppliers match your search' : 'No suppliers found'}
                  </div>
                ) : (
                  <Table>
                    <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur">
                      <TableRow>
                        <TableHead>Supplier Name</TableHead>
                        <TableHead className="w-[100px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {suppliers
                        .filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase()))
                        .map((supplier) => (
                          <TableRow key={supplier.supplier_id} className="cursor-pointer hover:bg-muted/50">
                            <TableCell className="font-medium">{supplier.name}</TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                onClick={() => handleSupplierSelect(supplier.supplier_id.toString())}
                              >
                                Select
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </>
          ) : (
            // Step 2: Select Component
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by code or description..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>

              <div className="flex-1 overflow-auto border rounded-lg">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredComponents.length === 0 && !showCreateForm ? (
                  <div className="flex flex-col items-center justify-center py-12 px-6 text-center space-y-4">
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-muted-foreground">
                        {searchTerm ? 'No supplier components match your search' : `${selectedSupplierName} has no available components`}
                      </p>
                      {!searchTerm && (
                        <p className="text-xs text-muted-foreground">
                          Create a new supplier component to link to this inventory item
                        </p>
                      )}
                    </div>
                    {!searchTerm && (
                      <Button
                        variant="default"
                        onClick={() => setShowCreateForm(true)}
                      >
                        Create Supplier Component
                      </Button>
                    )}
                  </div>
                ) : showCreateForm ? (
                  <div className="p-6">
                    <Form {...createForm}>
                      <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4">
                        <div className="space-y-4">
                          <FormField
                            control={createForm.control}
                            name="supplier_code"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Supplier Code *</FormLabel>
                                <FormControl>
                                  <Input placeholder="e.g., L650" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={createForm.control}
                            name="description"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Description</FormLabel>
                                <FormControl>
                                  <Input placeholder="Optional description" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={createForm.control}
                            name="price"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Unit Price (ZAR) *</FormLabel>
                                <FormControl>
                                  <Input type="number" step="0.01" min="0" placeholder="0.00" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <div className="flex gap-2 pt-4">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              setShowCreateForm(false);
                              createForm.reset();
                            }}
                            className="flex-1"
                          >
                            Cancel
                          </Button>
                          <Button type="submit" disabled={createMutation.isPending} className="flex-1">
                            {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Create & Link
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </div>
                ) : (
                  <Table>
                    <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur">
                      <TableRow>
                        <TableHead className="w-[50px]"></TableHead>
                        <TableHead>Code</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Price (ZAR)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredComponents.map((sc) => (
                        <TableRow
                          key={sc.supplier_component_id}
                          className={cn(
                            'cursor-pointer hover:bg-muted/50',
                            selectedSupplierComponent?.supplier_component_id === sc.supplier_component_id &&
                              'bg-primary/10'
                          )}
                          onClick={() => handleSelectSupplierComponent(sc)}
                        >
                          <TableCell className="text-center">
                            {selectedSupplierComponent?.supplier_component_id === sc.supplier_component_id && (
                              <Check className="h-4 w-4 text-primary" />
                            )}
                          </TableCell>
                          <TableCell className="font-medium">{sc.supplier_code}</TableCell>
                          <TableCell className="max-w-[300px] truncate">{sc.description || '-'}</TableCell>
                          <TableCell className="text-right">
                            {sc.price ? `R ${sc.price.toFixed(2)}` : '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              {/* Price Override Form */}
              {selectedSupplierComponent && (
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4 border-t">
                    <div className="bg-muted/30 p-4 rounded-lg">
                      <h4 className="text-sm font-medium mb-2">Selected Supplier Component</h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">Supplier:</span>{' '}
                          <span className="font-medium">{selectedSupplierComponent.supplier.name}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Code:</span>{' '}
                          <span className="font-medium">{selectedSupplierComponent.supplier_code}</span>
                        </div>
                      </div>
                    </div>

                    <FormField
                      control={form.control}
                      name="price_override"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Price (ZAR) - Optional</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder={selectedSupplierComponent.price?.toString() || '0.00'}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                          <p className="text-xs text-muted-foreground">
                            Leave empty to keep current price (
                            {selectedSupplierComponent.price
                              ? `R ${selectedSupplierComponent.price.toFixed(2)}`
                              : 'not set'}
                            )
                          </p>
                        </FormItem>
                      )}
                    />

                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={handleClose}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={linkMutation.isPending}>
                        {linkMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Link Supplier
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

