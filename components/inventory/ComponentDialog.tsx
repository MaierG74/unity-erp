'use client'

import { useState, useEffect } from "react"
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
import { Loader2, Upload, Check, ChevronsUpDown, X } from "lucide-react"
import { Textarea } from "@/components/ui/textarea"
import React from "react"
import { cn } from "@/lib/utils"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import ReactSelect from "react-select"

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
      })
    } else {
      form.reset({
        internal_code: "",
        description: "",
        unit_id: undefined,
        category_id: undefined,
        supplierComponents: [],
      })
    }
  }, [selectedItem])

  return form
}

export function ComponentDialog({ open, onOpenChange, selectedItem }: ComponentDialogProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [openPopover, setOpenPopover] = useState<number | null>(null)
  const queryClient = useQueryClient()
  const form = useComponentForm(selectedItem)
  const storageBucket = 'QButton';

  const { data: units = [] } = useQuery({
    queryKey: ["units"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("unitsofmeasure")
        .select("unit_id, unit_name")
        .order("unit_name")
      if (error) throw error
      console.log('Fetched units:', data)
      return data
    },
  })

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("component_categories")
        .select("cat_id, categoryname")
        .order("categoryname")
      if (error) throw error
      console.log('Fetched categories:', data)
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
      console.log('Fetched suppliers:', data)
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
        
        if (supplierComponentsError) {
          console.error('Error fetching supplier components:', supplierComponentsError)
          throw supplierComponentsError
        }
        
        // Fetch components for descriptions
        const { data: components, error: componentsError } = await supabase
          .from('components')
          .select('component_id, description')
        
        if (componentsError) {
          console.error('Error fetching components:', componentsError)
          throw componentsError
        }
        
        console.log('Raw supplier components data:', supplierComponents)
        console.log('Components data:', components)

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
        console.error('Error in supplier components query:', error)
        throw error
      }
    }
  })

  // Function to handle selecting an existing supplier component
  const handleSupplierComponentSelect = (index: number, supplierId: string, componentId: string) => {
    const supplierComponents = supplierComponentsMap[parseInt(supplierId)] || []
    const selected = supplierComponents.find((sc: SupplierComponentWithDescription) => 
      sc.component_id.toString() === componentId
    )
    
    if (selected) {
      form.setValue(`supplierComponents.${index}.supplier_code`, selected.supplier_code)
      form.setValue(`supplierComponents.${index}.price`, selected.price.toString())
    }
  }

  useEffect(() => {
    // Simple check to ensure we're authenticated
    async function checkAuth() {
      try {
        console.log('Checking Supabase authentication...');
        
        // Check authentication
        const { data: session } = await supabase.auth.getSession();
        if (!session?.session) {
          console.error('Not authenticated - storage operations will fail');
          return;
        }
        
        console.log('Authentication verified, storage operations should work');
      } catch (error) {
        console.error('Error checking authentication:', error);
      }
    }
    
    checkAuth();
  }, []);

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
                console.log('Attempting to delete file from storage:', filePath);
                
                const { error: deleteError } = await supabase.storage
                  .from(storageBucket)
                  .remove([filePath]);
                
                if (deleteError) {
                  console.warn('Error deleting file from storage:', deleteError);
                  // Continue anyway, as we still want to update the database
                } else {
                  console.log('File successfully deleted from storage');
                }
              }
            } catch (error) {
              console.warn('Error parsing image URL for deletion:', error);
              // Continue anyway, as we still want to update the database
            }
          }
          
          image_url = null;
          console.log('Image deleted, setting image_url to null');
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

            console.log('Attempting to upload file:', {
              bucket: storageBucket,
              filePath,
              fileName,
              fileType: file.type,
              fileSize: file.size
            })

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

            if (uploadError) {
              console.error('Upload error:', uploadError);
              throw uploadError;
            }
            
            console.log('File uploaded successfully:', uploadData);
            
            // Get the public URL
            const { data: urlData } = supabase.storage
              .from(storageBucket)
              .getPublicUrl(filePath);
              
            console.log('Generated public URL:', urlData);
            
            if (urlData && urlData.publicUrl) {
              image_url = urlData.publicUrl;
              console.log('Setting image_url to:', image_url);
            } else {
              console.error('Failed to get public URL for uploaded file');
              throw new Error('Failed to get public URL for uploaded file');
            }

            // Verify the URL is accessible
            try {
              const response = await fetch(image_url, { method: 'HEAD' })
              if (!response.ok) {
                console.warn('Generated URL might not be accessible:', {
                  status: response.status,
                  statusText: response.statusText,
                  url: image_url
                })
              } else {
                console.log('URL is accessible:', image_url)
              }
            } catch (urlError) {
              console.warn('Could not verify URL accessibility:', urlError)
            }
          } catch (error) {
            console.error('Error uploading image:', error)
            throw error
          } finally {
            setIsUploading(false)
          }
        } else {
          console.log('No image change detected, keeping existing image_url:', image_url)
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
          const { error } = await supabase
            .from('components')
            .update(componentData)
            .eq('component_id', selectedItem.component.component_id)
          if (error) throw error

          // Update supplier components
          if (values.supplierComponents) {
            // First delete all existing supplier components for this component
            const { error: deleteError } = await supabase
              .from('suppliercomponents')
              .delete()
              .eq('component_id', selectedItem.component.component_id)

            if (deleteError) throw deleteError

            // Then insert the new supplier components
            if (values.supplierComponents.length > 0) {
              const { error: insertError } = await supabase
                .from('suppliercomponents')
                .insert(
                  values.supplierComponents.map(sc => ({
                    component_id: selectedItem.component.component_id,
                    supplier_id: parseInt(sc.supplier_id),
                    supplier_code: sc.supplier_code,
                    price: parseFloat(sc.price),
                  }))
                )

              if (insertError) throw insertError
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
        }

        // Return success to trigger onSuccess callback
        return { success: true, shouldClose }
      } catch (error) {
        console.error('Mutation error:', error)
        throw error
      }
    },
    onSuccess: async (result) => {
      // Invalidate all relevant queries to force a refetch
      await queryClient.invalidateQueries({ queryKey: ['inventory'] })
      
      // If we're editing an existing component, refetch it to update the details view
      if (selectedItem) {
        const { data } = await supabase
          .from('components')
          .select(`
            *,
            category:component_categories (
              cat_id,
              categoryname
            ),
            unit:unitsofmeasure (
              unit_id,
              unit_code,
              unit_name
            ),
            inventory:inventory (
              inventory_id,
              quantity_on_hand,
              location,
              reorder_level
            ),
            transactions:inventory_transactions (
              transaction_id,
              quantity,
              transaction_type,
              transaction_date
            ),
            supplierComponents:suppliercomponents (
              supplier_component_id,
              supplier_id,
              supplier_code,
              price,
              supplier:suppliers (
                name
              )
            )
          `)
          .eq('component_id', selectedItem.component.component_id)
          .single()

        if (data) {
          queryClient.setQueryData(['inventory'], (oldData: any) => {
            if (Array.isArray(oldData)) {
              return oldData.map(item => 
                item.component_id === data.component_id ? data : item
              )
            }
            return oldData
          })
        }
      }
      
      // Only close dialog if shouldClose is true
      if (result.shouldClose) {
        onOpenChange(false)
        form.reset()
      }
    },
    onError: (error) => {
      console.error('Mutation error:', error)
    }
  })

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    console.log('Submitting form with values:', values)
    
    // Log image information for debugging
    if (values.image) {
      console.log('Image file being submitted:', {
        name: values.image.name,
        type: values.image.type,
        size: values.image.size
      });
    } else if (values.image_url === null) {
      console.log('Image being removed during submission');
    } else {
      console.log('No image change during submission');
    }
    
    mutation.mutate({ values, shouldClose: true })
  }

  // Add debugging for form values
  useEffect(() => {
    console.log('Current form values:', form.getValues())
  }, [form.watch()])

  // Add debugging for selected item
  useEffect(() => {
    if (selectedItem) {
      console.log('Selected item:', selectedItem)
    }
  }, [selectedItem])

  // Add an effect to make sure no "_empty" values remain
  useEffect(() => {
    const supplierComponents = form.getValues().supplierComponents || [];
    let needsUpdate = false;
    
    supplierComponents.forEach((component, index) => {
      if ((component.supplier_id === "_empty" || component.supplier_id === "") && suppliers.length > 0) {
        form.setValue(`supplierComponents.${index}.supplier_id`, suppliers[0].supplier_id.toString());
        needsUpdate = true;
      }
    });
    
    if (needsUpdate) {
      console.log("Fixed invalid supplier component values");
    }
  }, [form.watch("supplierComponents"), suppliers]);

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
                      <div className="flex flex-col gap-4">
                        <div
                          className={cn(
                            "border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors",
                            "hover:border-muted-foreground/50",
                            "text-muted-foreground"
                          )}
                          onDragOver={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                          onDrop={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            const file = e.dataTransfer.files?.[0]
                            if (file && file.type.startsWith('image/')) {
                              onChange(file)
                              console.log('Image file dropped:', file.name)
                            }
                          }}
                          onClick={() => {
                            const input = document.createElement('input')
                            input.type = 'file'
                            input.accept = 'image/*'
                            input.onchange = (e) => {
                              const file = (e.target as HTMLInputElement).files?.[0]
                              if (file) {
                                onChange(file)
                                console.log('Image file selected:', file.name)
                              }
                            }
                            input.click()
                          }}
                          onPaste={(e) => {
                            e.preventDefault()
                            e.stopPropagation()

                            // Handle pasted files
                            const pastedFile = e.clipboardData?.files?.[0]
                            if (pastedFile?.type.startsWith('image/')) {
                              onChange(pastedFile)
                              console.log('Image pasted:', pastedFile.name)
                              return
                            }

                            // Handle pasted image data
                            const items = e.clipboardData?.items
                            for (const item of Array.from(items || [])) {
                              if (item.type.startsWith('image/')) {
                                const blob = item.getAsFile()
                                if (blob) {
                                  // Create a new file with a meaningful name
                                  const file = new File([blob], `pasted-image.${item.type.split('/')[1]}`, {
                                    type: item.type
                                  })
                                  onChange(file)
                                  console.log('Image data pasted and converted to file')
                                  break
                                }
                              }
                            }
                          }}
                          tabIndex={0}
                        >
                          <Upload className="h-4 w-4" />
                          <div className="text-sm font-medium">
                            Click, drag and drop, or paste
                          </div>
                          <div className="text-xs">
                            SVG, PNG, JPG or GIF (max. 800x400px)
                          </div>
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
                                  console.log('Image file selection cleared');
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
                                  // Clear the image_url from the component
                                  form.setValue('image_url', null);
                                  console.log('Current image marked for deletion');
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
                render={({ field }) => {
                  console.log('Unit field render:', {
                    value: field.value,
                    type: typeof field.value,
                    units: units
                  });
                  return (
                    <FormItem>
                      <FormLabel>Unit</FormLabel>
                      <Select 
                        onValueChange={field.onChange} 
                        value={field.value || ""}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select unit" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {units.map((unit) => (
                            <SelectItem
                              key={unit.unit_id}
                              value={unit.unit_id.toString()}
                            >
                              {unit.unit_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />

              <FormField
                control={form.control}
                name="category_id"
                render={({ field }) => {
                  console.log('Category field render:', {
                    value: field.value,
                    type: typeof field.value,
                    categories: categories
                  });
                  return (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <Select 
                        onValueChange={field.onChange} 
                        value={field.value || ""}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
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
                  );
                }}
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
                    console.log('Adding new supplier component');
                    const firstSupplierId = suppliers.length > 0 ? suppliers[0].supplier_id.toString() : "1";
                    form.setValue("supplierComponents", [
                      ...current,
                      { supplier_id: firstSupplierId, supplier_code: "", price: "" },
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

                    <div className="grid grid-cols-3 gap-4 items-start">
                      <FormField
                        control={form.control}
                        name={`supplierComponents.${index}.supplier_id`}
                        render={({ field }) => {
                          // Ensure supplier_id has a valid value
                          if ((field.value === "_empty" || field.value === "") && suppliers.length > 0) {
                            field.onChange(suppliers[0].supplier_id.toString());
                          }
                          
                          console.log(`Supplier ${index} field render:`, {
                            value: field.value,
                            type: typeof field.value,
                            suppliers: suppliers
                          });
                          return (
                            <FormItem>
                              <FormLabel>Supplier</FormLabel>
                              <Select 
                                onValueChange={(value) => {
                                  console.log(`Supplier ${index} onValueChange:`, {
                                    newValue: value,
                                    type: typeof value
                                  });
                                  field.onChange(value);
                                  // Reset other fields when supplier changes
                                  form.setValue(`supplierComponents.${index}.supplier_code`, "");
                                  form.setValue(`supplierComponents.${index}.price`, "");
                                }} 
                                value={field.value || ""}
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
                          );
                        }}
                      />

                      <FormField
                        control={form.control}
                        name={`supplierComponents.${index}.supplier_code`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Component</FormLabel>
                            <FormControl>
                              <ReactSelect<OptionType>
                                value={field.value ? {
                                  value: field.value,
                                  label: field.value
                                } : null}
                                onChange={(newValue: OptionType | null) => {
                                  const selectedComponent = supplierComponentsMap[parseInt(form.watch(`supplierComponents.${index}.supplier_id`))]?.find(
                                    (sc: SupplierComponentWithDescription) => sc.supplier_code === newValue?.value
                                  )
                                  if (selectedComponent) {
                                    field.onChange(selectedComponent.supplier_code)
                                    form.setValue(`supplierComponents.${index}.price`, selectedComponent.price.toString())
                                  }
                                }}
                                options={
                                  form.watch(`supplierComponents.${index}.supplier_id`) 
                                    ? (supplierComponentsMap[parseInt(form.watch(`supplierComponents.${index}.supplier_id`))] || [])
                                        .map((sc: SupplierComponentWithDescription) => ({
                                          value: sc.supplier_code,
                                          label: `${sc.supplier_code} - ${sc.description}`,
                                        }))
                                    : []
                                }
                                isSearchable
                                placeholder="Select component"
                                className="w-full"
                                classNames={{
                                  control: (state) => cn(
                                    "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background text-foreground",
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
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`supplierComponents.${index}.price`}
                        render={({ field }) => (
                          <FormItem>
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
                  <Loader2 className="h-4 w-4 animate-spin" />
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