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
import { Loader2, Upload, X, Crop, Trash2 } from "lucide-react"
import { ImageCropDialog } from '@/components/ui/image-crop-dialog'
import { Textarea } from "@/components/ui/textarea"
import React from "react"
import { cn } from "@/lib/utils"
import CreatableSelect from "react-select/creatable"
import { useToast } from "@/components/ui/use-toast"
import { useDropzone } from "react-dropzone"
import { updateComponentStockLevel } from "@/lib/client/inventory"

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

  const [cropDialogOpen, setCropDialogOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // Generate preview URL from File objects
  const imageFile = form.watch('image')
  useEffect(() => {
    if (imageFile instanceof File) {
      const url = URL.createObjectURL(imageFile)
      setPreviewUrl(url)
      return () => URL.revokeObjectURL(url)
    }
    setPreviewUrl(null)
  }, [imageFile])

  // Derived state for current image display
  const isImageDeleted = form.watch('image_url') === null
  const currentImageSrc = previewUrl || (!isImageDeleted ? selectedItem?.component.image_url : null) || null

  const handleRemoveImage = () => {
    form.setValue('image', undefined)
    form.setValue('image_url', null)
  }

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
        
        const nextQuantityOnHand = Number(values.quantity_on_hand?.toString() || '0')
        const nextReorderLevel = Number(values.reorder_level?.toString() || '0')
        const currentQuantityOnHand = Number(selectedItem?.quantity_on_hand || 0)

        if (selectedItem) {
          // Update existing component
          const { data: updateData, error } = await supabase
            .from('components')
            .update(componentData)
            .eq('component_id', selectedItem.component.component_id)
            .select();

            if (error) throw error;

            if (nextQuantityOnHand !== currentQuantityOnHand) {
              await updateComponentStockLevel(selectedItem.component.component_id, {
                new_quantity: nextQuantityOnHand,
                reason: 'Data Entry Correction',
                notes: 'Updated via component dialog',
                transaction_type: 'ADJUSTMENT',
              });
            }

            const { error: inventoryError } = await supabase
              .from('inventory')
              .upsert({
                component_id: selectedItem.component.component_id,
                location: values.location || null,
                reorder_level: nextReorderLevel,
                ...(nextQuantityOnHand === currentQuantityOnHand ? { quantity_on_hand: nextQuantityOnHand } : {})
              }, { onConflict: 'component_id' })
              .select();

            if (inventoryError) throw inventoryError;

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
            
            // Create the inventory row with metadata first.
            const { error: inventoryError } = await supabase
              .from('inventory')
              .insert({
                component_id: newComponent.component_id,
                quantity_on_hand: 0,
                location: values.location || null,
                reorder_level: nextReorderLevel
              })
            
            if (inventoryError) throw inventoryError

            if (nextQuantityOnHand > 0) {
              await updateComponentStockLevel(newComponent.component_id, {
                new_quantity: nextQuantityOnHand,
                reason: 'Opening Balance',
                notes: 'Initial stock entered during component creation',
                transaction_type: 'OPENING_BALANCE',
              })
            }
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
          await queryClient.invalidateQueries({ queryKey: ['inventory', 'snapshot'] });
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {selectedItem ? 'Edit Component' : 'Add Component'}
          </DialogTitle>
          <DialogDescription>
            {selectedItem
              ? 'Edit the details of an existing component.'
              : 'Add a new component to the inventory system.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* ── Image Section ── */}
            <div>
              {currentImageSrc ? (
                <div className="relative group rounded-lg overflow-hidden border border-border bg-muted/20">
                  <img
                    src={currentImageSrc}
                    alt="Component"
                    className="w-full object-contain max-h-[140px]"
                  />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                    <Button type="button" size="sm" variant="secondary" onClick={() => setCropDialogOpen(true)}>
                      <Crop className="h-3.5 w-3.5 mr-1.5" />
                      Crop
                    </Button>
                    <Button type="button" size="sm" variant="destructive" onClick={handleRemoveImage}>
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                      Remove
                    </Button>
                  </div>
                  {imageFile instanceof File && (
                    <p className="text-xs text-muted-foreground px-3 py-1 border-t border-border bg-muted/30">
                      {imageFile.name} ({(imageFile.size / 1024).toFixed(0)} KB)
                    </p>
                  )}
                </div>
              ) : (
                <div
                  {...getRootProps()}
                  onPaste={handlePaste}
                  tabIndex={0}
                  className={cn(
                    "border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer",
                    isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/50 hover:bg-muted/20",
                    isUploading && "opacity-50 cursor-not-allowed"
                  )}
                  onClick={(e) => { e.stopPropagation(); openFileDialog() }}
                >
                  <input {...getInputProps()} disabled={isUploading} />
                  {isUploading ? (
                    <>
                      <Loader2 className="mx-auto h-6 w-6 text-muted-foreground mb-2 animate-spin" />
                      <p className="text-sm text-muted-foreground">Uploading...</p>
                    </>
                  ) : isDragActive ? (
                    <>
                      <Upload className="mx-auto h-6 w-6 text-primary mb-2" />
                      <p className="text-sm text-foreground font-medium">Drop image here...</p>
                    </>
                  ) : (
                    <>
                      <Upload className="mx-auto h-6 w-6 text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground">
                        Drag & drop, paste, or{' '}
                        <span className="text-primary font-medium underline underline-offset-4">browse</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">PNG, JPG, SVG, GIF or WebP</p>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Crop Dialog */}
            {currentImageSrc && (
              <ImageCropDialog
                open={cropDialogOpen}
                onOpenChange={setCropDialogOpen}
                imageSrc={currentImageSrc}
                fileName={imageFile instanceof File ? imageFile.name : 'cropped-component.png'}
                onCropComplete={(croppedFile) => form.setValue('image', croppedFile)}
              />
            )}

            {/* ── Details Section ── */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground">Details</h4>
              <div className="grid grid-cols-3 gap-3">
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
                  name="category_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || "_none"}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="_none">None</SelectItem>
                          {categories.map((category) => (
                            <SelectItem key={category.cat_id} value={category.cat_id.toString()}>
                              {category.categoryname}
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
                  name="unit_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unit</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || "_none"}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select unit" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="_none">Select unit</SelectItem>
                          {uniqueUnits.map((unit) => (
                            <SelectItem key={unit.unit_id} value={unit.unit_id.toString()}>
                              {unit.unit_name}{unit.unit_code ? ` (${unit.unit_code.toUpperCase()})` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                      <Textarea {...field} rows={2} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* ── Inventory Section ── */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground">Inventory</h4>
              <div className="grid grid-cols-3 gap-3">
                <FormField
                  control={form.control}
                  name="quantity_on_hand"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Qty on Hand</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min="0"
                          value={field.value || ''}
                          placeholder="0"
                          onBlur={(e) => {
                            if (!e.target.value) field.onChange('0')
                          }}
                        />
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
                        <Input
                          {...field}
                          type="number"
                          min="0"
                          value={field.value || ''}
                          placeholder="0"
                          onBlur={(e) => {
                            if (!e.target.value) field.onChange('0')
                          }}
                        />
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
                        <Input {...field} placeholder="e.g. Shelf A3" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* ── Suppliers Section ── */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-muted-foreground">Suppliers</h4>
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

              {(!form.watch("supplierComponents") || form.watch("supplierComponents")!.length === 0) && (
                <p className="text-sm text-muted-foreground py-4 text-center">No suppliers added</p>
              )}

              <div className="space-y-3">
                {form.watch("supplierComponents")?.map((_, index) => (
                  <React.Fragment key={index}>
                    {index === 0 && (
                      <div className="grid grid-cols-12 gap-3 text-xs text-muted-foreground px-0.5">
                        <span className="col-span-4">Supplier</span>
                        <span className="col-span-4">Supplier Code</span>
                        <span className="col-span-3">Price</span>
                        <span className="col-span-1" />
                      </div>
                    )}
                    <div className="grid grid-cols-12 gap-3 items-center">
                      <FormField
                        control={form.control}
                        name={`supplierComponents.${index}.supplier_id`}
                        render={({ field }) => (
                          <FormItem className="col-span-4">
                            <Select
                              onValueChange={(value) => {
                                field.onChange(value)
                                form.setValue(`supplierComponents.${index}.supplier_code`, "")
                                form.setValue(`supplierComponents.${index}.price`, "")
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
                                  <SelectItem key={supplier.supplier_id} value={supplier.supplier_id.toString()}>
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
                            <FormItem className="col-span-4">
                              <FormControl>
                                <CreatableSelect<OptionType, false>
                                  value={field.value ? { value: field.value, label: field.value } : null}
                                  onChange={(newValue: OptionType | null) => {
                                    const selectedComponent = selectedSupplierId ? supplierComponentsMap[parseInt(selectedSupplierId)]?.find(
                                      (sc: SupplierComponentWithDescription) => sc.supplier_code === newValue?.value
                                    ) : undefined
                                    if (selectedComponent) {
                                      field.onChange(selectedComponent.supplier_code)
                                      form.setValue(`supplierComponents.${index}.price`, selectedComponent.price.toString())
                                      return
                                    }
                                    field.onChange(newValue?.value || "")
                                  }}
                                  onCreateOption={(inputValue) => {
                                    const trimmedValue = inputValue.trim()
                                    if (!trimmedValue) return
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
                                      : inputValue
                                        ? `No matches. Create "${inputValue}".`
                                        : "Type to search or create"
                                  }
                                  className="w-full"
                                  classNames={{
                                    control: (state) => cn(
                                      "flex h-10 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background text-foreground",
                                      state.isFocused && "ring-2 ring-ring ring-offset-2",
                                      state.isDisabled && "opacity-50 cursor-not-allowed"
                                    ),
                                    menu: () => "z-[9999] mt-2 bg-popover text-popover-foreground rounded-md border shadow-md",
                                    menuList: () => "p-1",
                                    option: ({ isSelected, isFocused }) => cn(
                                      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-hidden transition-colors",
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
                              <FormMessage />
                            </FormItem>
                          )
                        }}
                      />

                      <FormField
                        control={form.control}
                        name={`supplierComponents.${index}.price`}
                        render={({ field }) => (
                          <FormItem className="col-span-3">
                            <FormControl>
                              <Input {...field} type="number" step="0.01" placeholder="0.00" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="col-span-1 flex items-center justify-center pt-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            const current = form.getValues("supplierComponents") || []
                            form.setValue("supplierComponents", current.filter((_, i) => i !== index))
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </div>

            {/* ── Footer ── */}
            <div className="flex justify-end gap-3 pt-3 border-t">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending || isUploading}>
                {(mutation.isPending || isUploading) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {selectedItem ? 'Save Changes' : 'Add Component'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
} 
