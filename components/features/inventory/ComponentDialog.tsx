'use client'

import { useState, useEffect, useMemo } from "react"
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
import { useToast } from "@/components/ui/use-toast"

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
  const [openPopover, setOpenPopover] = useState<number | null>(null)
  const queryClient = useQueryClient()
  const form = useComponentForm(selectedItem)
  const storageBucket = 'QButton';
  const { toast } = useToast();

  const { data: units = [] } = useQuery<{ unit_id: number; unit_code?: string; unit_name: string }[]>({
    queryKey: ["units"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("unitsofmeasure")
        .select("unit_id, unit_code, unit_name")
        .order("unit_name")
      if (error) throw error
      console.log('Fetched units:', data)
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
        console.log('🔍 Starting component update/create process', { 
          isUpdate: !!selectedItem,
          componentId: selectedItem?.component.component_id,
          values 
        });
        
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
        
        console.log('📝 Component data to save:', componentData);

        if (selectedItem) {
          // Update existing component
          console.log('🔄 Updating existing component ID:', selectedItem.component.component_id);
          const { data: updateData, error } = await supabase
            .from('components')
            .update(componentData)
            .eq('component_id', selectedItem.component.component_id)
            .select();
            
            console.log('🔄 Component update result:', { data: updateData, error });
            
            if (error) {
              console.error('❌ Component update failed:', error);
              throw error;
            }

            // Update or create inventory record
            if (selectedItem.inventory_id) {
              // Update existing inventory record
              console.log('🔄 Updating inventory record ID:', selectedItem.inventory_id);
              const { data: invData, error: inventoryError } = await supabase
                .from('inventory')
                .update({
                  quantity_on_hand: parseInt(values.quantity_on_hand?.toString() || '0'),
                  location: values.location || null,
                  reorder_level: parseInt(values.reorder_level?.toString() || '0')
                })
                .eq('inventory_id', selectedItem.inventory_id)
                .select();
              
              console.log('🔄 Inventory update result:', { data: invData, error: inventoryError });
              
              if (inventoryError) {
                console.error('❌ Inventory update failed:', inventoryError);
                throw inventoryError;
              }
            } else {
              // Create new inventory record
              console.log('➕ Creating new inventory record for component ID:', selectedItem.component.component_id);
              const { data: invData, error: inventoryError } = await supabase
                .from('inventory')
                .insert({
                  component_id: selectedItem.component.component_id,
                  quantity_on_hand: parseInt(values.quantity_on_hand?.toString() || '0'),
                  location: values.location || null,
                  reorder_level: parseInt(values.reorder_level?.toString() || '0')
                })
                .select();
              
              console.log('➕ Inventory creation result:', { data: invData, error: inventoryError });
              
              if (inventoryError) {
                console.error('❌ Inventory creation failed:', inventoryError);
                throw inventoryError;
              }
            }

            // Update supplier components
            if (values.supplierComponents) {
              // First delete all existing supplier components for this component
              console.log('🗑️ Deleting existing supplier components for component ID:', selectedItem.component.component_id);
              const { data: deleteData, error: deleteError } = await supabase
                .from('suppliercomponents')
                .delete()
                .eq('component_id', selectedItem.component.component_id)
                .select();
              
              console.log('🗑️ Supplier components deletion result:', { data: deleteData, error: deleteError });

              if (deleteError) {
                console.error('❌ Supplier components deletion failed:', deleteError);
                throw deleteError;
              }

              // Then insert the new supplier components
              if (values.supplierComponents.length > 0) {
                const supplierComponentsData = values.supplierComponents.map(sc => ({
                  component_id: selectedItem.component.component_id,
                  supplier_id: parseInt(sc.supplier_id),
                  supplier_code: sc.supplier_code,
                  price: parseFloat(sc.price),
                }));
                
                console.log('➕ Inserting new supplier components:', supplierComponentsData);
                
                const { data: insertData, error: insertError } = await supabase
                  .from('suppliercomponents')
                  .insert(supplierComponentsData)
                  .select();
                
                console.log('➕ Supplier components insertion result:', { data: insertData, error: insertError });

                if (insertError) {
                  console.error('❌ Supplier components insertion failed:', insertError);
                  throw insertError;
                }
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

          console.log('✅ Component update/create process completed successfully');
          // Return success to trigger onSuccess callback
          return { success: true, shouldClose }
        } catch (error) {
          console.error('❌ Mutation error:', error)
          throw error
        }
      },
      onSuccess: async (result) => {
        try {
          // Log success for debugging
          console.log('✅ Update successful, refreshing data...');
          
          // Verify data in Supabase if we're updating
          if (selectedItem) {
            console.log('🔍 Verifying data in Supabase after update');
            const verificationResult = await verifyDataInSupabase(selectedItem.component.component_id);
            console.log('🔍 Verification result:', verificationResult);
          }
          
          // Invalidate all relevant queries to force a refetch
          await queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] });
          
          // Show success toast
          toast({
            title: selectedItem ? "Component Updated" : "Component Added",
            description: selectedItem 
              ? `${form.getValues().internal_code} has been successfully updated.` 
              : `${form.getValues().internal_code} has been added to inventory.`
          });
          
          // Force a complete refetch instead of trying to update the cache
          console.log('🔄 Forcing refetch of inventory components data');
          await queryClient.refetchQueries({ queryKey: ['inventory', 'components'] });
          
          // Only close dialog if shouldClose is true
          if (result.shouldClose) {
            console.log('🚪 Closing dialog and resetting form');
            onOpenChange(false);
            form.reset();
          }
        } catch (error) {
          console.error('❌ Error in onSuccess callback:', error);
          toast({
            title: "Warning",
            description: "Component was updated but the UI may not reflect all changes. Please refresh the page.",
            variant: "destructive"
          });
        }
      },
      onError: (error) => {
        console.error('❌ Mutation error:', error);
        
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

  // Add a function to check Supabase permissions
  const checkSupabasePermissions = async () => {
    console.log('🔍 Checking Supabase permissions and connectivity');
    
    try {
      // Check authentication status
      const { data: session, error: authError } = await supabase.auth.getSession();
      
      if (authError) {
        console.error('❌ Authentication error:', authError);
        return { success: false, error: authError };
      }
      
      console.log('✅ Authentication status:', session);
      
      // Try a simple read operation
      const { data: readData, error: readError } = await supabase
        .from('components')
        .select('component_id')
        .limit(1);
      
      if (readError) {
        console.error('❌ Read permission error:', readError);
        return { success: false, error: readError };
      }
      
      console.log('✅ Read permission check passed');
      
      // Try a simple write operation (that we'll roll back)
      // Create a temporary record
      const tempCode = `TEMP_${Date.now()}`;
      const { data: writeData, error: writeError } = await supabase
        .from('components')
        .insert({
          internal_code: tempCode,
          description: 'Temporary component for permission check',
          unit_id: 1,
          category_id: 1
        })
        .select();
      
      if (writeError) {
        console.error('❌ Write permission error:', writeError);
        return { success: false, error: writeError };
      }
      
      console.log('✅ Write permission check passed');
      
      // Delete the temporary record
      if (writeData && writeData.length > 0) {
        const { error: deleteError } = await supabase
          .from('components')
          .delete()
          .eq('internal_code', tempCode);
        
        if (deleteError) {
          console.error('❌ Delete permission error:', deleteError);
        } else {
          console.log('✅ Delete permission check passed');
        }
      }
      
      return { success: true };
    } catch (error) {
      console.error('❌ Error checking permissions:', error);
      return { success: false, error };
    }
  };

  // Add a button to check permissions
  useEffect(() => {
    if (open) {
      // Check permissions when dialog opens
      checkSupabasePermissions().then(result => {
        console.log('🔍 Permission check result:', result);
      });
    }
  }, [open]);

  // Modify the onSubmit function to include more error handling
  const onSubmit = (values: z.infer<typeof formSchema>) => {
    console.log('Submitting form with values:', values)
    
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
      
      if (error) {
        console.error('Error checking internal code:', error);
        return false;
      }
      
      // If we're editing, exclude the current component
      if (selectedItem) {
        return data.some(item => item.component_id !== selectedItem.component.component_id);
      }
      
      // For new components, any existing code is a duplicate
      return data.length > 0;
    } catch (error) {
      console.error('Error checking internal code:', error);
      return false;
    }
  }
  
  // Function to proceed with form submission
  const proceedWithSubmit = (values: z.infer<typeof formSchema>) => {
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
    
    // Check network connectivity
    fetch('https://api.supabase.io', { method: 'HEAD' })
      .then(() => console.log('✅ Network connectivity check passed'))
      .catch(error => console.error('❌ Network connectivity issue:', error));
    
    mutation.mutate({ values, shouldClose: true })
  }

  // Function to verify data in Supabase
  const verifyDataInSupabase = async (componentId: number) => {
    console.log('🔍 Verifying data in Supabase for component ID:', componentId);
    
    try {
      // Fetch component data
      const { data: componentData, error: componentError } = await supabase
        .from('components')
        .select('*')
        .eq('component_id', componentId)
        .single();
      
      if (componentError) {
        console.error('❌ Failed to verify component data:', componentError);
        return;
      }
      
      console.log('✅ Component data in Supabase:', componentData);
      
      // Fetch inventory data
      const { data: inventoryData, error: inventoryError } = await supabase
        .from('inventory')
        .select('*')
        .eq('component_id', componentId);
      
      if (inventoryError) {
        console.error('❌ Failed to verify inventory data:', inventoryError);
        return;
      }
      
      console.log('✅ Inventory data in Supabase:', inventoryData);
      
      // Fetch supplier components
      const { data: supplierComponentsData, error: supplierComponentsError } = await supabase
        .from('suppliercomponents')
        .select('*')
        .eq('component_id', componentId);
      
      if (supplierComponentsError) {
        console.error('❌ Failed to verify supplier components data:', supplierComponentsError);
        return;
      }
      
      console.log('✅ Supplier components data in Supabase:', supplierComponentsData);
      
      return {
        component: componentData,
        inventory: inventoryData,
        supplierComponents: supplierComponentsData
      };
    } catch (error) {
      console.error('❌ Error verifying data in Supabase:', error);
    }
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
                  );
                }}
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
                          
                          // Ensure we have a valid value for the Select component
                          const safeValue = field.value || "_none";
                          
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
                                value={safeValue}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select supplier" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="_none">Select a supplier</SelectItem>
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
