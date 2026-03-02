'use client'

import { useState, useEffect, useMemo, useCallback } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabaseClient"
import type { InventoryItem } from "@/types/inventory"
import { Loader2, Upload, Check, X } from "lucide-react"
import { Textarea } from "@/components/ui/textarea"
import React from "react"
import { cn } from "@/lib/utils"
import CreatableSelect from "react-select/creatable"
import { useToast } from "@/components/ui/use-toast"
import { useDropzone } from "react-dropzone"

type OptionType = {
  value: string
  label: string
}

const formSchema = z.object({
  internal_code: z.string().min(1, "Code is required"),
  description: z.string().min(1, "Description is required"),
  unit_id: z.string().min(1, "Unit is required"),
  category_id: z.string().min(1, "Category is required"),
  image: z.instanceof(File).optional(),
  image_url: z.string().nullable().optional(),
  supplierComponents: z.array(z.object({
    supplier_id: z.string().min(1, "Supplier is required"),
    supplier_code: z.string().min(1, "Supplier code is required"),
    price: z.string().min(1, "Price is required"),
  })).optional(),
  quantity_on_hand: z.string().optional(),
  location: z.string().optional(),
  reorder_level: z.string().optional(),
})

type ComponentDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedItem?: InventoryItem
}

type SupplierComponentResponse = {
  supplier_component_id: number
  supplier_code: string
  price: number
  supplier_id: number
  component_id: number
  components: {
    description: string
  } | null
}

type SupplierComponentWithDescription = {
  supplier_component_id: number
  supplier_code: string
  price: number
  supplier_id: number
  component_id: number
  description: string
}

function useComponentForm(selectedItem: ComponentDialogProps['selectedItem']) {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      internal_code: selectedItem?.component.internal_code || "",
      description: selectedItem?.component.description || "",
      unit_id: selectedItem?.component.unit?.unit_id ? selectedItem.component.unit.unit_id.toString() : undefined,
      category_id: selectedItem?.component.category?.cat_id ? selectedItem.component.category.cat_id.toString() : undefined,
      supplierComponents: selectedItem?.supplierComponents?.map(sc => ({
        supplier_id: sc.supplier_id.toString(),
        supplier_code: sc.supplier_code,
        price: sc.price.toString(),
      })) || [],
      quantity_on_hand: selectedItem?.quantity_on_hand?.toString() || "",
      location: selectedItem?.location || "",
      reorder_level: selectedItem?.reorder_level?.toString() || "",
    },
  })

  useEffect(() => {
    if (selectedItem) {
      form.reset({
        internal_code: selectedItem.component.internal_code,
        description: selectedItem.component.description || "",
        unit_id: selectedItem.component.unit?.unit_id ? selectedItem.component.unit.unit_id.toString() : undefined,
        category_id: selectedItem.component.category?.cat_id ? selectedItem.component.category.cat_id.toString() : undefined,
        supplierComponents: selectedItem.supplierComponents?.map(sc => ({
          supplier_id: sc.supplier_id.toString(),
          supplier_code: sc.supplier_code,
          price: sc.price.toString(),
        })) || [],
        quantity_on_hand: selectedItem.quantity_on_hand?.toString() || "",
        location: selectedItem.location || "",
        reorder_level: selectedItem.reorder_level?.toString() || "",
      })
    } else {
      form.reset({
        internal_code: "",
        description: "",
        unit_id: undefined,
        category_id: undefined,
        supplierComponents: [],
        quantity_on_hand: "",
        location: "",
        reorder_level: "",
      })
    }
  }, [selectedItem])

  return form
}

export function ComponentDialog({ open, onOpenChange, selectedItem }: ComponentDialogProps) {
  const [isUploading, setIsUploading] = useState(false)
  const queryClient = useQueryClient()
  const form = useComponentForm(selectedItem)
  const storageBucket = 'QButton';
  const { toast } = useToast();

  // Dropzone handlers for image upload
  const onDropImage = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0]
      form.setValue('image', file)
    }
  }, [form])

  const { getRootProps, getInputProps, isDragActive, open: openFileDialog } = useDropzone({
    onDrop: onDropImage,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.bmp', '.webp']
    },
    multiple: false,
    noClick: true // Prevent auto-opening file dialog on click
  })

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (isUploading) return
    const items = e.clipboardData?.items
    if (!items || items.length === 0) return

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          e.preventDefault()
          // Create a new file with a meaningful name
          const newFile = new File([file], `pasted-image-${Date.now()}.${item.type.split('/')[1]}`, {
            type: item.type
          })
          form.setValue('image', newFile)
          break
        }
      }
    }
  }, [form, isUploading])

  const { data: units = [] } = useQuery<{ unit_id: number; unit_code?: string; unit_name: string }[]>({
    queryKey: ["units"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("unitsofmeasure")
        .select("unit_id, unit_code, unit_name")
        .order("unit_name")
      if (error) throw error
      return data
    },
  })
  // Ensure we never show duplicates in the dropdown (defensive in case of future inserts)
  const uniqueUnits = useMemo(() => {
    const byName = new Map<string, { unit_id: number; unit_code?: string; unit_name: string }>()
    for (const u of units) {
      const key = (u.unit_name || '').trim().toLowerCase()
      if (!byName.has(key)) byName.set(key, u)
    }
    return Array.from(byName.values()).sort((a, b) => a.unit_name.localeCompare(b.unit_name))
  }, [units])

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("component_categories")
        .select("cat_id, categoryname")
        .order("categoryname")
      if (error) throw error
      return data
    },
  })

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("supplier_id, name")
        .order("name")
      if (error) throw error
      return data
    },
  })

  // Add query for supplier components
  const { data: supplierComponentsMap = {} } = useQuery({
    queryKey: ["supplierComponents"],
    queryFn: async () => {
      try {
        // Fetch supplier components
        const { data: supplierComponents, error: supplierComponentsError } = await supabase
          .from('suppliercomponents')
          .select('supplier_component_id, component_id, supplier_id, supplier_code, price')
          .order('supplier_code')
        
        if (supplierComponentsError) throw supplierComponentsError
        
        // Fetch components for descriptions
        const { data: components, error: componentsError } = await supabase
          .from('components')
          .select('component_id, description')
        
        if (componentsError) throw componentsError

        // Group by supplier_id for easier lookup
        return supplierComponents.reduce((acc, item) => {
          if (!acc[item.supplier_id]) {
            acc[item.supplier_id] = []
          }
          
          // Find the component description
          const component = components.find(c => c.component_id === item.component_id)
          
          const supplierComponent: SupplierComponentWithDescription = {
            supplier_component_id: item.supplier_component_id,
            supplier_code: item.supplier_code,
            price: item.price,
            supplier_id: item.supplier_id,
            component_id: item.component_id,
            description: component?.description || 'Unknown Component'
          }
          acc[item.supplier_id].push(supplierComponent)
          return acc
        }, {} as Record<number, SupplierComponentWithDescription[]>)
      } catch (error) {
        throw error
      }
    }
  })

  const mutation = useMutation({
    mutationFn: async ({ values, shouldClose = true }: { values: z.infer<typeof formSchema>, shouldClose?: boolean }) => {
      try {
        let image_url = selectedItem?.component.image_url

        // Handle image deletion
        if (values.image_url === null) {
          // If there was a previous image, try to delete it from storage
          if (selectedItem?.component.image_url) {
            try {
              // Extract the file path from the URL
              const url = new URL(selectedItem.component.image_url);
              const pathParts = url.pathname.split('/');
              // The last two parts should be the bucket name and the file path
              if (pathParts.length >= 3) {
                const filePath = pathParts.slice(2).join('/');
                const { error: deleteError } = await supabase.storage
                  .from(storageBucket)
                  .remove([filePath]);
                
                if (deleteError) {
                  // Continue anyway, as we still want to update the database
                }
              }
            } catch {
              // Continue anyway, as we still want to update the database
            }
          }
          
          image_url = null;
        }
        // Handle image upload if a new file is selected
        else if (values.image) {
          setIsUploading(true)
          try {
            const file = values.image
            const fileExt = file.name.split('.').pop()
            // Generate a unique filename using component code and timestamp
            const timestamp = new Date().getTime()
            const fileName = `${values.internal_code}_${timestamp}.${fileExt}`
            
            // Upload directly to the root of the bucket
            const filePath = fileName

            // Check if we're authenticated
            const { data: session } = await supabase.auth.getSession()
            if (!session?.session) {
              throw new Error('Not authenticated - please log in')
            }

            // Attempt the upload directly to the bucket (assuming it exists)
            const { data: uploadData, error: uploadError } = await supabase.storage
              .from(storageBucket)
              .upload(filePath, file, {
                upsert: true,
                contentType: file.type
              })

            if (uploadError) throw uploadError;

            // Get the public URL
            const { data: urlData } = supabase.storage
              .from(storageBucket)
              .getPublicUrl(filePath);
              
            if (urlData && urlData.publicUrl) {
              image_url = urlData.publicUrl;
            } else {
              throw new Error('Failed to get public URL for uploaded file');
            }
          } catch {
            toast({
              title: "Image Upload Failed",
              description: "The component was updated but the image could not be uploaded. Please try again.",
              variant: "destructive"
            });
            // Continue with the update without the image
            image_url = selectedItem?.component.image_url || null;
          } finally {
            setIsUploading(false)
          }
        }

        // Update or create component
        const componentData = {
          internal_code: values.internal_code,
          description: values.description,
          unit_id: parseInt(values.unit_id),
          category_id: parseInt(values.category_id),
          image_url,
        }
        
        if (selectedItem) {
          // Update existing component
          const { data: updateData, error } = await supabase
            .from('components')
            .update(componentData)
            .eq('component_id', selectedItem.component.component_id)
            .select();

            if (error) throw error;

            // Update or create inventory record
            if (selectedItem.inventory_id) {
              // Update existing inventory record
              const { data: invData, error: inventoryError } = await supabase
                .from('inventory')
                .update({
                  quantity_on_hand: parseInt(values.quantity_on_hand?.toString() || '0'),
                  location: values.location || null,
                  reorder_level: parseInt(values.reorder_level?.toString() || '0')
                })
                .eq('inventory_id', selectedItem.inventory_id)
                .select();

              if (inventoryError) throw inventoryError;
            } else {
              // Create new inventory record
              const { data: invData, error: inventoryError } = await supabase
                .from('inventory')
                .insert({
                  component_id: selectedItem.component.component_id,
                  quantity_on_hand: parseInt(values.quantity_on_hand?.toString() || '0'),
                  location: values.location || null,
                  reorder_level: parseInt(values.reorder_level?.toString() || '0')
                })
                .select();

              if (inventoryError) throw inventoryError;
            }

            // Update supplier components
            if (values.supplierComponents) {
              // First delete all existing supplier components for this component
              const { data: deleteData, error: deleteError } = await supabase
                .from('suppliercomponents')
                .delete()
                .eq('component_id', selectedItem.component.component_id)
                .select();

              if (deleteError) throw deleteError;

              // Then insert the new supplier components
              if (values.supplierComponents.length > 0) {
                const supplierComponentsData = values.supplierComponents.map(sc => ({
                  component_id: selectedItem.component.component_id,
                  supplier_id: parseInt(sc.supplier_id),
                  supplier_code: sc.supplier_code,
                  price: parseFloat(sc.price),
                }));

                const { data: insertData, error: insertError } = await supabase
                  .from('suppliercomponents')
                  .insert(supplierComponentsData)
                  .select();

                if (insertError) throw insertError;
              }
            }
          } else {
            // Create new component
            const { data: newComponent, error } = await supabase
              .from('components')
              .insert(componentData)
              .select()
              .single()
            if (error) throw error

            // Insert supplier components
            if (values.supplierComponents?.length) {
              const { error: supplierError } = await supabase
                .from('suppliercomponents')
                .insert(
                  values.supplierComponents.map(sc => ({
                    component_id: newComponent.component_id,
                    supplier_id: parseInt(sc.supplier_id),
                    supplier_code: sc.supplier_code,
                    price: parseFloat(sc.price),
                  }))
                )
              if (supplierError) throw supplierError
            }
            
            // Create inventory record for the new component
            const { error: inventoryError } = await supabase
              .from('inventory')
              .insert({
                component_id: newComponent.component_id,
                quantity_on_hand: parseInt(values.quantity_on_hand?.toString() || '0'),
                location: values.location || null,
                reorder_level: parseInt(values.reorder_level?.toString() || '0')
              })
            
            if (inventoryError) throw inventoryError
          }

          return { success: true, shouldClose }
        } catch (error) {
          throw error
        }
      },
      onSuccess: async (result) => {
        try {
          // Invalidate all relevant queries to force a refetch
          await queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] });
          toast({
            title: selectedItem ? "Component Updated" : "Component Added",
            description: selectedItem 
              ? `${form.getValues().internal_code} has been successfully updated.` 
              : `${form.getValues().internal_code} has been added to inventory.`
          });
          
          // Force a complete refetch instead of trying to update the cache
          await queryClient.refetchQueries({ queryKey: ['inventory', 'components'] });
          
          // Only close dialog if shouldClose is true
          if (result.shouldClose) {
            onOpenChange(false);
            form.reset();
          }
        } catch {
          toast({
            title: "Warning",
            description: "Component was updated but the UI may not reflect all changes. Please refresh the page.",
            variant: "destructive"
          });
        }
      },
      onError: (error) => {
        // Check for unique constraint violation on internal_code
        const errorMessage = error?.message || '';
        if (errorMessage.includes('duplicate key value') && errorMessage.includes('components_internal_code_key')) {
          toast({
            title: "Duplicate Code Error",
            description: `The code "${form.getValues().internal_code}" is already in use. Please use a unique code.`,
            variant: "destructive"
          });
        } else {
          // Show generic error toast
          toast({
            title: "Error",
            description: `Failed to ${selectedItem ? 'update' : 'add'} component. ${errorMessage}`,
            variant: "destructive"
          });
        }
      }
    })

  // Modify the onSubmit function to include more error handling
  const onSubmit = (values: z.infer<typeof formSchema>) => {
    // Check if we're updating and the internal code has changed
    if (selectedItem && values.internal_code !== selectedItem.component.internal_code) {
      // Check if the new code already exists
      checkInternalCodeExists(values.internal_code).then(exists => {
        if (exists) {
          toast({
            title: "Duplicate Code Error",
            description: `The code "${values.internal_code}" is already in use. Please use a unique code.`,
            variant: "destructive"
          });
        } else {
          proceedWithSubmit(values);
        }
      });
    } else {
      proceedWithSubmit(values);
    }
  }
  
  // Function to check if an internal code already exists
  const checkInternalCodeExists = async (code: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase
        .from('components')
        .select('component_id')
        .eq('internal_code', code);
      
      if (error) return false;

      // If we're editing, exclude the current component
      if (selectedItem) {
        return data.some(item => item.component_id !== selectedItem.component.component_id);
      }

      // For new components, any existing code is a duplicate
      return data.length > 0;
    } catch {
      return false;
    }
  }
  
  // Function to proceed with form submission
  const proceedWithSubmit = (values: z.infer<typeof formSchema>) => {
    mutation.mutate({ values, shouldClose: true })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto z-50">
        <DialogHeader>
          <DialogTitle className="mb-4">
            {selectedItem ? 'Edit Component' : 'Add Component'}
          </DialogTitle>
          <DialogDescription>
            {selectedItem 
              ? 'Edit the details of an existing component.' 
              : 'Add a new component to the inventory system.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="internal_code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="image"
                render={({ field: { onChange, value, ...field } }) => (
                  <FormItem>
                    <FormLabel>Image</FormLabel>
                    <FormControl>
                      <div className="flex flex-col gap-2">
                        <div
                          {...getRootProps()}
                          onPaste={handlePaste}
                          tabIndex={0}
                          title="Drag files here or paste from clipboard"
                          className={cn(
                            "border-2 border-dashed rounded-lg p-4 text-center transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
                            "cursor-text",
                            isDragActive ? "border-primary bg-muted/40" : "border-border hover:bg-muted/40",
                            isUploading && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          <input {...getInputProps()} disabled={isUploading} />
                          <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                          {isUploading ? (
                            <p className="text-sm text-muted-foreground">Uploading...</p>
                          ) : isDragActive ? (
                            <p className="text-sm text-foreground">Drop image here...</p>
                          ) : (
                            <div className="space-y-1">
                              <p className="text-sm text-muted-foreground">
                                Drag & drop, or paste with <span className="font-medium">Ctrl/Cmd+V</span>
                              </p>
                              <div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    openFileDialog()
                                  }}
                                  disabled={isUploading}
                                >
                                  Click to select
                                </Button>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                SVG, PNG, JPG or GIF (max. 800×400px)
                              </p>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {value instanceof File && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Check className="h-4 w-4 text-green-500" />
                              {value.name}
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-4 w-4 p-0"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onChange(undefined);
                                }}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
                          {!value && selectedItem?.component.image_url && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Check className="h-4 w-4 text-green-500" />
                              Current image
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-4 w-4 p-0"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  form.setValue('image_url', null);
                                }}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
                          {isUploading && (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          )}
                        </div>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="unit_id"
                render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unit</FormLabel>
                      <Select 
                        onValueChange={field.onChange} 
                        value={field.value || "_none"}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select unit" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="_none">Select unit</SelectItem>
                          {uniqueUnits.map((unit) => (
                            <SelectItem
                              key={unit.unit_id}
                              value={unit.unit_id.toString()}
                            >
                              {unit.unit_name}{unit.unit_code ? ` (${unit.unit_code.toUpperCase()})` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="category_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select 
                      onValueChange={field.onChange} 
                      value={field.value || "_none"}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="_none">None</SelectItem>
                        {categories.map((category) => (
                          <SelectItem
                            key={category.cat_id}
                            value={category.cat_id.toString()}
                          >
                            {category.categoryname}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="quantity_on_hand"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantity on Hand</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" min="0" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="reorder_level"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reorder Level</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" min="0" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <FormLabel className="text-base">Suppliers</FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const current = form.getValues("supplierComponents") || []
                    form.setValue("supplierComponents", [
                      ...current,
                      { supplier_id: "", supplier_code: "", price: "" },
                    ])
                  }}
                >
                  Add Supplier
                </Button>
              </div>
              
              <div className="space-y-4">
                {form.watch("supplierComponents")?.map((_, index) => (
                  <div key={index} className="space-y-4 p-4 border rounded-lg">
                    <div className="flex justify-between items-center">
                      <FormLabel>Supplier {index + 1}</FormLabel>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          const current = form.getValues("supplierComponents") || []
                          form.setValue(
                            "supplierComponents",
                            current.filter((_, i) => i !== index)
                          )
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-12 gap-4 items-start">
                      <FormField
                        control={form.control}
                        name={`supplierComponents.${index}.supplier_id`}
                        render={({ field }) => (
                            <FormItem className="col-span-4">
                              <FormLabel>Supplier</FormLabel>
                              <Select 
                                onValueChange={(value) => {
                                  field.onChange(value);
                                  // Reset other fields when supplier changes
                                  form.setValue(`supplierComponents.${index}.supplier_code`, "");
                                  form.setValue(`supplierComponents.${index}.price`, "");
                                }} 
                                value={field.value || undefined}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select supplier" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {suppliers.map((supplier) => (
                                    <SelectItem
                                      key={supplier.supplier_id}
                                      value={supplier.supplier_id.toString()}
                                    >
                                      {supplier.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`supplierComponents.${index}.supplier_code`}
                        render={({ field }) => {
                          const selectedSupplierId = form.watch(`supplierComponents.${index}.supplier_id`)

                          return (
                          <FormItem className="col-span-5">
                            <FormLabel>Component</FormLabel>
                            <FormControl>
                              <CreatableSelect<OptionType, false>
                                value={field.value ? {
                                  value: field.value,
                                  label: field.value
                                } : null}
                                onChange={(newValue: OptionType | null) => {
                                  const selectedComponent = supplierComponentsMap[parseInt(selectedSupplierId)]?.find(
                                    (sc: SupplierComponentWithDescription) => sc.supplier_code === newValue?.value
                                  )
                                  if (selectedComponent) {
                                    field.onChange(selectedComponent.supplier_code)
                                    form.setValue(`supplierComponents.${index}.price`, selectedComponent.price.toString())
                                    return
                                  }

                                  field.onChange(newValue?.value || "")
                                }}
                                onCreateOption={(inputValue) => {
                                  const trimmedValue = inputValue.trim()
                                  if (!trimmedValue) {
                                    return
                                  }

                                  field.onChange(trimmedValue)
                                }}
                                options={
                                  selectedSupplierId
                                    ? (supplierComponentsMap[parseInt(selectedSupplierId)] || [])
                                        .map((sc: SupplierComponentWithDescription) => ({
                                          value: sc.supplier_code,
                                          label: `${sc.supplier_code} - ${sc.description}`,
                                        }))
                                    : []
                                }
                                isSearchable
                                isDisabled={!selectedSupplierId}
                                placeholder={selectedSupplierId ? "Search or type code" : "Select supplier first"}
                                formatCreateLabel={(inputValue) => `Create "${inputValue}"`}
                                noOptionsMessage={({ inputValue }) =>
                                  !selectedSupplierId
                                    ? "Select a supplier first"
                                    :
                                  inputValue
                                    ? `No matches. Create "${inputValue}".`
                                    : "Type to search or create a supplier code"
                                }
                                className="w-full"
                                classNames={{
                                  control: (state) => cn(
                                    "flex min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background text-foreground",
                                    state.isFocused && "ring-2 ring-ring ring-offset-2",
                                    state.isDisabled && "opacity-50 cursor-not-allowed"
                                  ),
                                  menu: () => "z-[9999] mt-2 bg-popover text-popover-foreground rounded-md border shadow-md",
                                  menuList: () => "p-1",
                                  option: ({ isSelected, isFocused }) => cn(
                                    "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors",
                                    isSelected && "bg-primary text-primary-foreground",
                                    !isSelected && isFocused && "bg-accent text-accent-foreground",
                                    !isSelected && !isFocused && "text-popover-foreground hover:bg-accent hover:text-accent-foreground"
                                  ),
                                  placeholder: () => "text-muted-foreground",
                                  input: () => "text-sm text-foreground",
                                  singleValue: () => "text-sm text-foreground",
                                  valueContainer: () => "gap-1",
                                  indicatorsContainer: () => "gap-1",
                                  clearIndicator: () => "text-muted-foreground p-1 hover:text-foreground rounded-sm hover:bg-accent",
                                  dropdownIndicator: () => "text-muted-foreground p-1 hover:text-foreground rounded-sm hover:bg-accent",
                                  indicatorSeparator: () => "bg-muted"
                                }}
                                theme={(theme) => ({
                                  ...theme,
                                  colors: {
                                    ...theme.colors,
                                    neutral0: 'hsl(var(--background))',
                                    neutral5: 'hsl(var(--border))',
                                    neutral10: 'hsl(var(--input))',
                                    neutral20: 'hsl(var(--border))',
                                    neutral30: 'hsl(var(--border))',
                                    neutral40: 'hsl(var(--muted-foreground))',
                                    neutral50: 'hsl(var(--muted-foreground))',
                                    neutral60: 'hsl(var(--foreground))',
                                    neutral70: 'hsl(var(--foreground))',
                                    neutral80: 'hsl(var(--foreground))',
                                    neutral90: 'hsl(var(--foreground))',
                                    primary: 'hsl(var(--primary))',
                                    primary25: 'hsl(var(--accent))',
                                    primary50: 'hsl(var(--accent))',
                                    primary75: 'hsl(var(--accent))',
                                  },
                                })}
                                unstyled
                              />
                            </FormControl>
                            <p className="text-xs text-muted-foreground">
                              Pick an existing code or type a new one.
                            </p>
                            <FormMessage />
                          </FormItem>
                        )}}
                      />

                      <FormField
                        control={form.control}
                        name={`supplierComponents.${index}.price`}
                        render={({ field }) => (
                          <FormItem className="col-span-3">
                            <FormLabel>Price</FormLabel>
                            <FormControl>
                              <Input {...field} type="number" step="0.01" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-4 pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending || isUploading}>
                {mutation.isPending || isUploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {selectedItem ? 'Updating...' : 'Adding...'}
                  </>
                ) : selectedItem ? (
                  'Update Component'
                ) : (
                  'Add Component'
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
} 
