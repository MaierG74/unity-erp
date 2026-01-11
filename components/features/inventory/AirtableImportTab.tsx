'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, CheckCircle2, Loader2, Plus, Search, Link2, RotateCcw, ImageIcon, X, Upload } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { supabase } from '@/lib/supabase';

type Supplier = { supplier_id: number; name: string };
type Category = { cat_id: number; categoryname: string };
type Unit = { unit_id: number; unit_name: string; unit_code: string };

type AirtableData = {
  code: string;
  description: string;
  supplier_name: string;
  price: number;
  category: string;
  unit: string;
  image_url: string | null;
  internal_code: string | null;
};

type UnityComponent = {
  component_id: number;
  internal_code: string;
  description: string;
  category?: { categoryname: string };
};

type ImportResult = {
  success?: boolean;
  error?: string;
  message?: string;
  component_id?: number;
  internal_code?: string;
  supplier_component_id?: number;
  is_new_component?: boolean;
};

type Step = 'lookup' | 'review' | 'complete';

export function AirtableImportTab() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Workflow state
  const [step, setStep] = useState<Step>('lookup');
  const [airtableCode, setAirtableCode] = useState('');
  const [fetching, setFetching] = useState(false);
  const [airtableData, setAirtableData] = useState<AirtableData | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  
  // Link options
  const [linkMode, setLinkMode] = useState<'new' | 'existing'>('new');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UnityComponent[]>([]);
  const [selectedComponent, setSelectedComponent] = useState<UnityComponent | null>(null);
  const [searching, setSearching] = useState(false);
  
  // Form overrides
  const [supplierId, setSupplierId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [priceOverride, setPriceOverride] = useState('');
  const [customMasterCode, setCustomMasterCode] = useState('');
  const [descriptionOverride, setDescriptionOverride] = useState('');
  const [imageUrlOverride, setImageUrlOverride] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  // Import state
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importHistory, setImportHistory] = useState<ImportResult[]>([]);

  // Load lookup data directly from Supabase
  useEffect(() => {
    async function loadLookups() {
      try {
        const [suppliersRes, categoriesRes, unitsRes] = await Promise.all([
          supabase.from('suppliers').select('supplier_id, name').order('name'),
          supabase.from('component_categories').select('cat_id, categoryname').order('categoryname'),
          supabase.from('unitsofmeasure').select('unit_id, unit_name, unit_code').order('unit_name'),
        ]);

        if (suppliersRes.error) console.error('Suppliers error:', suppliersRes.error);
        if (categoriesRes.error) console.error('Categories error:', categoriesRes.error);
        if (unitsRes.error) console.error('Units error:', unitsRes.error);

        setSuppliers(suppliersRes.data || []);
        setCategories(categoriesRes.data || []);
        setUnits(unitsRes.data || []);
      } catch (error) {
        console.error('Failed to load lookup data:', error);
      } finally {
        setLoading(false);
      }
    }
    loadLookups();
  }, []);

  // Auto-match supplier, category, unit when airtable data loads
  useEffect(() => {
    if (!airtableData) return;
    
    // Match supplier by name
    const matchedSupplier = suppliers.find(
      s => s.name.toLowerCase() === airtableData.supplier_name.toLowerCase()
    );
    if (matchedSupplier) setSupplierId(String(matchedSupplier.supplier_id));
    
    // Match category by name
    const matchedCategory = categories.find(
      c => c.categoryname.toLowerCase() === airtableData.category.toLowerCase()
    );
    if (matchedCategory) setCategoryId(String(matchedCategory.cat_id));
    
    // Match unit by code or name
    const matchedUnit = units.find(
      u => u.unit_code.toLowerCase() === airtableData.unit.toLowerCase() ||
           u.unit_name.toLowerCase() === airtableData.unit.toLowerCase()
    );
    if (matchedUnit) setUnitId(String(matchedUnit.unit_id));
    
    // Set price
    setPriceOverride(String(airtableData.price || ''));
    
    // Set description
    setDescriptionOverride(airtableData.description || '');
    
    // Set image URL
    setImageUrlOverride(airtableData.image_url || null);
  }, [airtableData, suppliers, categories, units]);

  const handleFetchFromAirtable = async () => {
    if (!airtableCode.trim()) return;
    
    setFetching(true);
    setFetchError(null);
    setAirtableData(null);
    
    try {
      const res = await fetch(`/api/inventory/import/airtable?code=${encodeURIComponent(airtableCode.trim())}`);
      const data = await res.json();
      
      if (!res.ok) {
        setFetchError(data.message || data.error || 'Failed to fetch from Airtable');
        return;
      }
      
      setAirtableData(data.data);
      setStep('review');
    } catch (error) {
      setFetchError(String(error));
    } finally {
      setFetching(false);
    }
  };

  const handleImageFileSelect = async (file: File) => {
    setImageFile(file);
    setUploadingImage(true);

    try {
      const fileExt = file.name.split('.').pop();
      const timestamp = new Date().getTime();
      const fileName = `airtable_import_${airtableCode}_${timestamp}.${fileExt}`;
      const filePath = fileName;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('QButton')
        .upload(filePath, file, {
          upsert: true,
          contentType: file.type
        });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        throw uploadError;
      }

      const { data: urlData } = supabase.storage
        .from('QButton')
        .getPublicUrl(filePath);

      if (urlData && urlData.publicUrl) {
        setImageUrlOverride(urlData.publicUrl);
      } else {
        throw new Error('Failed to get public URL for uploaded file');
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Failed to upload image. Please try again.');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSearchUnity = useCallback(async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const searchTerm = `%${searchQuery.trim()}%`;
      const { data, error } = await supabase
        .from('components')
        .select(`
          component_id,
          internal_code,
          description,
          category:component_categories(categoryname)
        `)
        .or(`internal_code.ilike.${searchTerm},description.ilike.${searchTerm}`)
        .order('internal_code')
        .limit(20);

      if (error) {
        console.error('Search error:', error);
      } else {
        setSearchResults(data || []);
      }
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  const handleImport = async () => {
    if (!airtableData || !supplierId) return;
    
    setImporting(true);
    setResult(null);
    
    try {
      const supplierIdNum = parseInt(supplierId);
      const supplierCode = airtableData.code;
      const price = priceOverride ? parseFloat(priceOverride) : (airtableData.price || 0);
      
      // Check if supplier component already exists
      const { data: existingSupplierComponent } = await supabase
        .from('suppliercomponents')
        .select('supplier_component_id, component_id, components(internal_code, description)')
        .eq('supplier_id', supplierIdNum)
        .eq('supplier_code', supplierCode)
        .single();

      if (existingSupplierComponent) {
        setResult({
          error: 'Duplicate',
          message: `Supplier code "${supplierCode}" already exists for this supplier`,
        });
        return;
      }

      let componentId: number;
      let finalInternalCode: string;
      let isNewComponent = false;

      if (linkMode === 'existing' && selectedComponent) {
        // Use existing component
        componentId = selectedComponent.component_id;
        finalInternalCode = selectedComponent.internal_code;
      } else {
        // Use custom code or auto-generate
        if (customMasterCode.trim()) {
          // Check if custom code already exists
          const { data: existingCode } = await supabase
            .from('components')
            .select('component_id')
            .eq('internal_code', customMasterCode.trim())
            .single();

          if (existingCode) {
            setResult({
              error: 'Code exists',
              message: `Master code "${customMasterCode.trim()}" already exists. Use "Link to existing" instead.`,
            });
            return;
          }
          finalInternalCode = customMasterCode.trim();
        } else {
          // Auto-generate internal code
          const { data: lastComponent } = await supabase
            .from('components')
            .select('internal_code')
            .like('internal_code', 'COMP-%')
            .order('internal_code', { ascending: false })
            .limit(1)
            .single();

          let nextNum = 1;
          if (lastComponent?.internal_code) {
            const match = lastComponent.internal_code.match(/COMP-(\d+)/);
            if (match) {
              nextNum = parseInt(match[1], 10) + 1;
            }
          }
          finalInternalCode = `COMP-${String(nextNum).padStart(8, '0')}`;
        }

        // Create new component
        const finalDescription = descriptionOverride.trim() || airtableData.description;
        const finalImageUrl = imageUrlOverride || null;
        const { data: newComponent, error: componentError } = await supabase
          .from('components')
          .insert({
            internal_code: finalInternalCode,
            description: finalDescription,
            category_id: categoryId ? parseInt(categoryId) : null,
            unit_id: unitId ? parseInt(unitId) : null,
            image_url: finalImageUrl,
          })
          .select('component_id')
          .single();

        if (componentError) {
          setResult({ error: 'Failed to create component', message: componentError.message });
          return;
        }
        componentId = newComponent.component_id;
        isNewComponent = true;
      }

      // Create supplier component
      const finalDesc = descriptionOverride.trim() || airtableData.description;
      const { error: scError } = await supabase
        .from('suppliercomponents')
        .insert({
          component_id: componentId,
          supplier_id: supplierIdNum,
          supplier_code: supplierCode,
          price: price,
          description: finalDesc,
        });

      if (scError) {
        setResult({ error: 'Failed to create supplier component', message: scError.message });
        return;
      }

      const resultData = {
        success: true,
        component_id: componentId,
        internal_code: finalInternalCode,
        is_new_component: isNewComponent,
        message: isNewComponent 
          ? `Created new component ${finalInternalCode} with supplier link`
          : `Added supplier link to existing component ${finalInternalCode}`
      };
      
      setResult(resultData);
      setImportHistory(prev => [resultData, ...prev].slice(0, 10));
      setStep('complete');
      
    } catch (error) {
      setResult({ error: 'Import failed', message: String(error) });
    } finally {
      setImporting(false);
    }
  };

  const handleReset = () => {
    setStep('lookup');
    setAirtableCode('');
    setAirtableData(null);
    setFetchError(null);
    setLinkMode('new');
    setSearchQuery('');
    setSearchResults([]);
    setSelectedComponent(null);
    setSupplierId('');
    setCategoryId('');
    setUnitId('');
    setPriceOverride('');
    setCustomMasterCode('');
    setDescriptionOverride('');
    setImageUrlOverride(null);
    setImageFile(null);
    setResult(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Import from Airtable
          </CardTitle>
          <CardDescription>
            Enter an Airtable supplier code to fetch the component, then link it to an existing Unity master code or create a new one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Step 1: Lookup */}
          {step === 'lookup' && (
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="flex-1">
                  <Label htmlFor="airtable-code">Airtable Supplier Code</Label>
                  <Input
                    id="airtable-code"
                    placeholder="Enter the Code from Airtable..."
                    value={airtableCode}
                    onChange={(e) => setAirtableCode(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleFetchFromAirtable()}
                  />
                </div>
                <div className="flex items-end">
                  <Button onClick={handleFetchFromAirtable} disabled={fetching || !airtableCode.trim()}>
                    {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                    {fetching ? 'Fetching...' : 'Fetch'}
                  </Button>
                </div>
              </div>
              
              {fetchError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{fetchError}</AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* Step 2: Review & Link */}
          {step === 'review' && airtableData && (
            <div className="space-y-6">
              {/* Fetched Data Display */}
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <h3 className="font-medium flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Fetched from Airtable
                </h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <div><span className="text-muted-foreground">Code:</span> <code className="bg-muted px-1 rounded">{airtableData.code}</code></div>
                  <div><span className="text-muted-foreground">Supplier:</span> {airtableData.supplier_name || <span className="text-orange-500">Not found</span>}</div>
                  <div className="col-span-2"><span className="text-muted-foreground">Description:</span> {airtableData.description}</div>
                  <div><span className="text-muted-foreground">Price:</span> R{airtableData.price?.toFixed(2) || '0.00'}</div>
                  <div><span className="text-muted-foreground">Category:</span> {airtableData.category || '-'}</div>
                  <div><span className="text-muted-foreground">Unit:</span> {airtableData.unit || '-'}</div>
                </div>
              </div>

              <Separator />

              {/* Link Mode Selection */}
              <div className="space-y-4">
                <Label>How would you like to import this?</Label>
                <RadioGroup value={linkMode} onValueChange={(v) => setLinkMode(v as 'new' | 'existing')}>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="new" id="new" />
                    <Label htmlFor="new" className="font-normal cursor-pointer">
                      <Plus className="h-4 w-4 inline mr-1" />
                      Create new Unity component
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="existing" id="existing" />
                    <Label htmlFor="existing" className="font-normal cursor-pointer">
                      <Link2 className="h-4 w-4 inline mr-1" />
                      Link to existing Unity component
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Custom Master Code for new components */}
              {linkMode === 'new' && (
                <div className="space-y-2 pl-6 border-l-2 border-muted">
                  <Label htmlFor="custom-code">Master Code</Label>
                  <Input
                    id="custom-code"
                    placeholder="Leave blank to auto-generate (e.g., COMP-00000001)"
                    value={customMasterCode}
                    onChange={(e) => setCustomMasterCode(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter your own code or leave blank for auto-generated code
                  </p>
                </div>
              )}

              {/* Search for existing component */}
              {linkMode === 'existing' && (
                <div className="space-y-3 pl-6 border-l-2 border-muted">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Search Unity components by code or description..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearchUnity()}
                    />
                    <Button variant="outline" onClick={handleSearchUnity} disabled={searching}>
                      {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
                    </Button>
                  </div>
                  
                  {searchResults.length > 0 && (
                    <div className="border rounded-md max-h-48 overflow-y-auto">
                      {searchResults.map((comp) => (
                        <div
                          key={comp.component_id}
                          className={`p-2 cursor-pointer hover:bg-muted border-b last:border-0 ${
                            selectedComponent?.component_id === comp.component_id ? 'bg-primary/10' : ''
                          }`}
                          onClick={() => setSelectedComponent(comp)}
                        >
                          <code className="text-xs bg-muted px-1 rounded">{comp.internal_code}</code>
                          <span className="ml-2 text-sm">{comp.description}</span>
                          {comp.category && (
                            <Badge variant="outline" className="ml-2 text-xs">{comp.category.categoryname}</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {selectedComponent && (
                    <Alert>
                      <Link2 className="h-4 w-4" />
                      <AlertTitle>Will link to:</AlertTitle>
                      <AlertDescription>
                        <code>{selectedComponent.internal_code}</code> - {selectedComponent.description}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}

              <Separator />

              {/* Override Fields */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground">Confirm / Override</h3>
                
                {/* Description */}
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={descriptionOverride}
                    onChange={(e) => setDescriptionOverride(e.target.value)}
                    rows={2}
                    placeholder="Component description..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Supplier *</Label>
                    <Select value={supplierId} onValueChange={setSupplierId}>
                      <SelectTrigger className={!supplierId ? 'border-orange-500' : ''}>
                        <SelectValue placeholder="Select supplier..." />
                      </SelectTrigger>
                      <SelectContent>
                        {suppliers.map((s) => (
                          <SelectItem key={s.supplier_id} value={String(s.supplier_id)}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Price</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={priceOverride}
                      onChange={(e) => setPriceOverride(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select value={categoryId} onValueChange={setCategoryId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select category..." />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((c) => (
                          <SelectItem key={c.cat_id} value={String(c.cat_id)}>
                            {c.categoryname}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Unit</Label>
                    <Select value={unitId} onValueChange={setUnitId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select unit..." />
                      </SelectTrigger>
                      <SelectContent>
                        {units.map((u) => (
                          <SelectItem key={u.unit_id} value={String(u.unit_id)}>
                            {u.unit_name} ({u.unit_code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Image Preview & Edit */}
                <div className="space-y-2">
                  <Label>Image</Label>
                  <div className="flex gap-4 items-start">
                    {imageUrlOverride ? (
                      <div className="relative w-32 h-32 border rounded-lg overflow-hidden bg-muted flex-shrink-0">
                        <img
                          src={imageUrlOverride}
                          alt="Component preview"
                          className="w-full h-full object-contain"
                        />
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute top-1 right-1 h-6 w-6"
                          onClick={() => {
                            setImageUrlOverride(null);
                            setImageFile(null);
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <div className="w-32 h-32 border rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                        <ImageIcon className="h-8 w-8 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 space-y-2">
                      <div className="flex gap-2">
                        <Input
                          placeholder="Paste image URL..."
                          value={imageUrlOverride || ''}
                          onChange={(e) => {
                            setImageUrlOverride(e.target.value || null);
                            setImageFile(null);
                          }}
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          disabled={uploadingImage}
                          onClick={() => {
                            const input = document.createElement('input');
                            input.type = 'file';
                            input.accept = 'image/*';
                            input.onchange = (e) => {
                              const file = (e.target as HTMLInputElement).files?.[0];
                              if (file) {
                                handleImageFileSelect(file);
                              }
                            };
                            input.click();
                          }}
                        >
                          {uploadingImage ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Upload className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {imageFile ? (
                          <span className="text-green-600">Uploaded: {imageFile.name}</span>
                        ) : (
                          'Paste an image URL or click upload button to browse files'
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {result && !result.success && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{result.error}</AlertTitle>
                  <AlertDescription>{result.message}</AlertDescription>
                </Alert>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4">
                <Button
                  onClick={handleImport}
                  disabled={importing || !supplierId || (linkMode === 'existing' && !selectedComponent)}
                  className="flex-1"
                >
                  {importing ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Importing...</>
                  ) : (
                    <><Plus className="mr-2 h-4 w-4" />Import Component</>
                  )}
                </Button>
                <Button variant="outline" onClick={handleReset}>
                  <RotateCcw className="mr-2 h-4 w-4" />Start Over
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Complete */}
          {step === 'complete' && result?.success && (
            <div className="space-y-6">
              <Alert>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <AlertTitle>Import Successful!</AlertTitle>
                <AlertDescription>
                  {result.message}
                  <div className="mt-2">
                    <code className="bg-muted px-2 py-1 rounded">{result.internal_code}</code>
                    {result.is_new_component ? (
                      <Badge className="ml-2">New Component</Badge>
                    ) : (
                      <Badge variant="secondary" className="ml-2">Linked to Existing</Badge>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
              
              <Button onClick={handleReset} className="w-full">
                <Plus className="mr-2 h-4 w-4" />Import Another
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Import History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Imports</CardTitle>
          <CardDescription>This session</CardDescription>
        </CardHeader>
        <CardContent>
          {importHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No imports yet</p>
          ) : (
            <div className="space-y-3">
              {importHistory.map((item, idx) => (
                <div key={idx} className="flex items-start gap-2 text-sm border-b pb-2 last:border-0">
                  <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <code className="text-xs bg-muted px-1 rounded">{item.internal_code}</code>
                    {item.is_new_component ? (
                      <Badge variant="secondary" className="ml-2 text-xs">New</Badge>
                    ) : (
                      <Badge variant="outline" className="ml-2 text-xs">Linked</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
