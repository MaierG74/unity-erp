'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, CheckCircle2, Loader2, Plus, Search, Link2, RotateCcw, ImageIcon, X, ChevronRight, ChevronLeft, Package, Check, SkipForward } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { supabase } from '@/lib/supabase';

type Supplier = { supplier_id: number; name: string };
type Category = { cat_id: number; categoryname: string };
type Unit = { unit_id: number; unit_name: string; unit_code: string };

type AirtableItem = {
  airtable_record_id: string;
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

type BatchItem = {
  airtableItem: AirtableItem;
  linkMode: 'new' | 'existing';
  selectedComponent: UnityComponent | null;
  customMasterCode: string;
  descriptionOverride: string;
  supplierId: string;
  categoryId: string;
  unitId: string;
  priceOverride: string;
  imageUrlOverride: string | null;
};

type ImportResult = {
  code: string;
  success: boolean;
  message: string;
  internal_code?: string;
};

export function AirtableBulkImportTab() {
  // Lookup data
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);

  // Airtable suppliers (from Airtable)
  const [airtableSuppliers, setAirtableSuppliers] = useState<string[]>([]);
  const [selectedAirtableSupplier, setSelectedAirtableSupplier] = useState('');
  const [fetchStats, setFetchStats] = useState<{ total: number; skipped: number; pending: number } | null>(null);
  
  // Fetch state
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [allItems, setAllItems] = useState<AirtableItem[]>([]);
  const [existingCodes, setExistingCodes] = useState<Set<string>>(new Set());
  
  // Queue state
  const [pendingItems, setPendingItems] = useState<AirtableItem[]>([]);
  const [currentItem, setCurrentItem] = useState<AirtableItem | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  
  // Current item form state
  const [linkMode, setLinkMode] = useState<'new' | 'existing'>('new');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UnityComponent[]>([]);
  const [selectedComponent, setSelectedComponent] = useState<UnityComponent | null>(null);
  const [searching, setSearching] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [priceOverride, setPriceOverride] = useState('');
  const [customMasterCode, setCustomMasterCode] = useState('');
  const [descriptionOverride, setDescriptionOverride] = useState('');
  const [imageUrlOverride, setImageUrlOverride] = useState<string | null>(null);
  
  // Batch state
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [step, setStep] = useState<'select' | 'review' | 'complete'>('select');

  // Load Unity lookup data
  useEffect(() => {
    async function loadLookups() {
      try {
        const [suppliersRes, categoriesRes, unitsRes] = await Promise.all([
          supabase.from('suppliers').select('supplier_id, name').eq('is_active', true).order('name'),
          supabase.from('component_categories').select('cat_id, categoryname').order('categoryname'),
          supabase.from('unitsofmeasure').select('unit_id, unit_name, unit_code').order('unit_name'),
        ]);
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

  // Fetch Airtable suppliers on mount
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);
  
  useEffect(() => {
    async function fetchAirtableSuppliers() {
      setLoadingSuppliers(true);
      try {
        console.log('Fetching Airtable suppliers...');
        const res = await fetch('/api/inventory/import/airtable/bulk');
        console.log('Response status:', res.status);
        if (res.ok) {
          const data = await res.json();
          console.log('Airtable suppliers:', data.suppliers);
          setAirtableSuppliers(data.suppliers || []);
        } else {
          console.error('Failed to fetch suppliers:', await res.text());
        }
      } catch (error) {
        console.error('Failed to fetch Airtable suppliers:', error);
      } finally {
        setLoadingSuppliers(false);
      }
    }
    fetchAirtableSuppliers();
  }, []);

  // Fetch items for selected supplier
  const handleFetchItems = async () => {
    if (!selectedAirtableSupplier) return;
    
    setFetching(true);
    setFetchError(null);
    
    try {
      // Fetch from Airtable
      const res = await fetch(`/api/inventory/import/airtable/bulk?supplier=${encodeURIComponent(selectedAirtableSupplier)}`);
      if (!res.ok) {
        const err = await res.json();
        setFetchError(err.message || 'Failed to fetch items');
        return;
      }
      
      const data = await res.json();
      setAllItems(data.items || []);
      
      // Find the matching Unity supplier to filter by
      const matchedSupplier = suppliers.find(
        s => s.name.toLowerCase() === selectedAirtableSupplier.toLowerCase()
      );
      
      // Check which codes already exist in Unity for THIS supplier
      const codes = data.items.map((i: AirtableItem) => i.code);
      let existingSet = new Set<string>();
      
      if (matchedSupplier) {
        const { data: existing } = await supabase
          .from('suppliercomponents')
          .select('supplier_code')
          .eq('supplier_id', matchedSupplier.supplier_id)
          .in('supplier_code', codes);
        
        existingSet = new Set<string>((existing || []).map(e => e.supplier_code));
      }
      setExistingCodes(existingSet);
      
      // Filter to pending items (not yet imported)
      const pending = (data.items || []).filter((item: AirtableItem) => !existingSet.has(item.code));
      const skipped = data.items.length - pending.length;
      setPendingItems(pending);
      setFetchStats({ total: data.items.length, skipped, pending: pending.length });
      
      if (pending.length > 0) {
        setCurrentItem(pending[0]);
        setCurrentIndex(0);
        initializeFormForItem(pending[0]);
        setStep('review');
      } else if (data.items.length > 0) {
        setFetchError(`All ${data.items.length} items from this supplier have already been imported.`);
      } else {
        setFetchError('No items found for this supplier.');
      }
      
    } catch (error) {
      setFetchError(String(error));
    } finally {
      setFetching(false);
    }
  };

  // Initialize form fields for an item
  const initializeFormForItem = (item: AirtableItem) => {
    // Reset form
    setLinkMode('new');
    setSearchQuery('');
    setSearchResults([]);
    setSelectedComponent(null);
    setCustomMasterCode('');
    setDescriptionOverride(item.description || '');
    setPriceOverride(String(item.price || ''));
    setImageUrlOverride(item.image_url || null);
    
    // Auto-match supplier
    const matchedSupplier = suppliers.find(
      s => s.name.toLowerCase() === item.supplier_name.toLowerCase()
    );
    setSupplierId(matchedSupplier ? String(matchedSupplier.supplier_id) : '');
    
    // Auto-match category
    const matchedCategory = categories.find(
      c => c.categoryname.toLowerCase() === item.category.toLowerCase()
    );
    setCategoryId(matchedCategory ? String(matchedCategory.cat_id) : '');
    
    // Auto-match unit
    const matchedUnit = units.find(
      u => u.unit_code.toLowerCase() === item.unit.toLowerCase() ||
           u.unit_name.toLowerCase() === item.unit.toLowerCase()
    );
    setUnitId(matchedUnit ? String(matchedUnit.unit_id) : '');
  };

  // Search Unity components
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
        .select(`component_id, internal_code, description, category:component_categories(categoryname)`)
        .or(`internal_code.ilike.${searchTerm},description.ilike.${searchTerm}`)
        .order('internal_code')
        .limit(20);

      if (!error) {
        setSearchResults(data || []);
      }
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  // Add current item to batch
  const handleAddToBatch = () => {
    if (!currentItem || !supplierId) return;
    
    const batchItem: BatchItem = {
      airtableItem: currentItem,
      linkMode,
      selectedComponent,
      customMasterCode,
      descriptionOverride,
      supplierId,
      categoryId,
      unitId,
      priceOverride,
      imageUrlOverride,
    };
    
    setBatch(prev => [...prev, batchItem]);
    moveToNextItem();
  };

  // Skip current item
  const handleSkipItem = () => {
    moveToNextItem();
  };

  // Move to next item in queue
  const moveToNextItem = () => {
    const nextIndex = currentIndex + 1;
    if (nextIndex < pendingItems.length) {
      setCurrentIndex(nextIndex);
      setCurrentItem(pendingItems[nextIndex]);
      initializeFormForItem(pendingItems[nextIndex]);
    } else {
      // No more items
      setCurrentItem(null);
    }
  };

  // Remove item from batch
  const handleRemoveFromBatch = (index: number) => {
    setBatch(prev => prev.filter((_, i) => i !== index));
  };

  // Submit batch
  const handleSubmitBatch = async () => {
    if (batch.length === 0) return;
    
    setImporting(true);
    const results: ImportResult[] = [];
    
    for (const item of batch) {
      try {
        const supplierIdNum = parseInt(item.supplierId);
        const supplierCode = item.airtableItem.code;
        const price = item.priceOverride ? parseFloat(item.priceOverride) : (item.airtableItem.price || 0);
        
        // Check if already exists
        const { data: existing } = await supabase
          .from('suppliercomponents')
          .select('supplier_component_id')
          .eq('supplier_id', supplierIdNum)
          .eq('supplier_code', supplierCode)
          .single();

        if (existing) {
          results.push({ code: supplierCode, success: false, message: 'Already exists' });
          continue;
        }

        let componentId: number;
        let finalInternalCode: string;

        if (item.linkMode === 'existing' && item.selectedComponent) {
          componentId = item.selectedComponent.component_id;
          finalInternalCode = item.selectedComponent.internal_code;
        } else {
          // Create new component
          if (item.customMasterCode.trim()) {
            const { data: codeExists } = await supabase
              .from('components')
              .select('component_id')
              .eq('internal_code', item.customMasterCode.trim())
              .single();

            if (codeExists) {
              results.push({ code: supplierCode, success: false, message: `Master code ${item.customMasterCode} already exists` });
              continue;
            }
            finalInternalCode = item.customMasterCode.trim();
          } else {
            // Auto-generate
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
              if (match) nextNum = parseInt(match[1], 10) + 1;
            }
            finalInternalCode = `COMP-${String(nextNum).padStart(8, '0')}`;
          }

          const finalDescription = item.descriptionOverride.trim() || item.airtableItem.description;
          const { data: newComponent, error: componentError } = await supabase
            .from('components')
            .insert({
              internal_code: finalInternalCode,
              description: finalDescription,
              category_id: item.categoryId ? parseInt(item.categoryId) : null,
              unit_id: item.unitId ? parseInt(item.unitId) : null,
              image_url: item.imageUrlOverride || null,
            })
            .select('component_id')
            .single();

          if (componentError) {
            results.push({ code: supplierCode, success: false, message: componentError.message });
            continue;
          }
          componentId = newComponent.component_id;
        }

        // Create supplier component
        const finalDesc = item.descriptionOverride.trim() || item.airtableItem.description;
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
          results.push({ code: supplierCode, success: false, message: scError.message });
          continue;
        }

        results.push({ code: supplierCode, success: true, message: 'Imported successfully', internal_code: finalInternalCode });
        
      } catch (error) {
        results.push({ code: item.airtableItem.code, success: false, message: String(error) });
      }
    }
    
    setImportResults(results);
    setImporting(false);
    setStep('complete');
  };

  // Reset everything
  const handleReset = () => {
    setStep('select');
    setSelectedAirtableSupplier('');
    setAllItems([]);
    setPendingItems([]);
    setCurrentItem(null);
    setCurrentIndex(0);
    setBatch([]);
    setImportResults([]);
    setFetchError(null);
    setFetchStats(null);
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
      {/* Main Panel */}
      <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Bulk Import from Airtable
            </CardTitle>
            <CardDescription>
              Import multiple items from Airtable for a supplier, review and configure each one, then submit as a batch.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            
            {/* Step 1: Select Supplier */}
            {step === 'select' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Select Airtable Supplier</Label>
                  <Select value={selectedAirtableSupplier} onValueChange={setSelectedAirtableSupplier} disabled={loadingSuppliers}>
                    <SelectTrigger>
                      <SelectValue placeholder={loadingSuppliers ? "Loading suppliers..." : "Choose a supplier..."} />
                    </SelectTrigger>
                    <SelectContent>
                      {airtableSuppliers.length === 0 ? (
                        <div className="p-2 text-sm text-muted-foreground text-center">
                          {loadingSuppliers ? 'Loading...' : 'No suppliers found'}
                        </div>
                      ) : (
                        airtableSuppliers.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  {loadingSuppliers && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Loading suppliers from Airtable (this may take a moment)...
                    </p>
                  )}
                </div>
                
                <Button 
                  onClick={handleFetchItems} 
                  disabled={!selectedAirtableSupplier || fetching}
                  className="w-full"
                >
                  {fetching ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Fetching items...</>
                  ) : (
                    <><Search className="mr-2 h-4 w-4" />Fetch Items</>
                  )}
                </Button>
                
                {fetchError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{fetchError}</AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            {/* Step 2: Review Items */}
            {step === 'review' && (
              <div className="space-y-6">
                {/* Stats banner */}
                {fetchStats && fetchStats.skipped > 0 && (
                  <Alert>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertTitle>Found {fetchStats.total} items for {selectedAirtableSupplier}</AlertTitle>
                    <AlertDescription>
                      {fetchStats.skipped} already imported (skipped) • {fetchStats.pending} ready to review
                    </AlertDescription>
                  </Alert>
                )}
                
                {/* Progress indicator */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Reviewing item {currentIndex + 1} of {pendingItems.length}
                  </span>
                  <div className="flex gap-2">
                    <Badge variant="outline">{batch.length} in batch</Badge>
                    <Badge variant="secondary">{pendingItems.length - currentIndex - (currentItem ? 1 : 0)} remaining</Badge>
                  </div>
                </div>
                
                {/* Current item review */}
                {currentItem ? (
                  <div className="space-y-4">
                    {/* Airtable data display */}
                    <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                      <h3 className="font-medium flex items-center gap-2">
                        <Package className="h-4 w-4" />
                        {currentItem.code}
                      </h3>
                      <div className="text-sm space-y-1">
                        <div><span className="text-muted-foreground">Description:</span> {currentItem.description}</div>
                        <div className="grid grid-cols-2 gap-2">
                          <div><span className="text-muted-foreground">Price:</span> R{currentItem.price?.toFixed(2)}</div>
                          <div><span className="text-muted-foreground">Category:</span> {currentItem.category || '-'}</div>
                        </div>
                      </div>
                    </div>

                    <Separator />

                    {/* Link mode selection */}
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

                    {/* New component options */}
                    {linkMode === 'new' && (
                      <div className="space-y-2 pl-6 border-l-2 border-muted">
                        <Label>Master Code</Label>
                        <Input
                          placeholder="Leave blank to auto-generate"
                          value={customMasterCode}
                          onChange={(e) => setCustomMasterCode(e.target.value)}
                        />
                      </div>
                    )}

                    {/* Existing component search */}
                    {linkMode === 'existing' && (
                      <div className="space-y-3 pl-6 border-l-2 border-muted">
                        <div className="flex gap-2">
                          <Input
                            placeholder="Search Unity components..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearchUnity()}
                          />
                          <Button onClick={handleSearchUnity} disabled={searching} size="icon" variant="outline">
                            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                          </Button>
                        </div>
                        
                        {searchResults.length > 0 && (
                          <div className="border rounded-lg divide-y max-h-40 overflow-auto">
                            {searchResults.map((c) => (
                              <div
                                key={c.component_id}
                                className={`p-2 cursor-pointer hover:bg-muted text-sm ${selectedComponent?.component_id === c.component_id ? 'bg-primary/10' : ''}`}
                                onClick={() => setSelectedComponent(c)}
                              >
                                <div className="font-medium">{c.internal_code}</div>
                                <div className="text-muted-foreground text-xs truncate">{c.description}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        
                        {selectedComponent && (
                          <Alert>
                            <CheckCircle2 className="h-4 w-4" />
                            <AlertTitle>Selected: {selectedComponent.internal_code}</AlertTitle>
                            <AlertDescription className="text-xs">{selectedComponent.description}</AlertDescription>
                          </Alert>
                        )}
                      </div>
                    )}

                    <Separator />

                    {/* Override fields */}
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Description</Label>
                        <Textarea
                          value={descriptionOverride}
                          onChange={(e) => setDescriptionOverride(e.target.value)}
                          rows={2}
                        />
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Supplier *</Label>
                          <Select value={supplierId} onValueChange={setSupplierId}>
                            <SelectTrigger className={!supplierId ? 'border-orange-500' : ''}>
                              <SelectValue placeholder="Select..." />
                            </SelectTrigger>
                            <SelectContent>
                              {suppliers.map((s) => (
                                <SelectItem key={s.supplier_id} value={String(s.supplier_id)}>{s.name}</SelectItem>
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
                              <SelectValue placeholder="Select..." />
                            </SelectTrigger>
                            <SelectContent>
                              {categories.map((c) => (
                                <SelectItem key={c.cat_id} value={String(c.cat_id)}>{c.categoryname}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Unit</Label>
                          <Select value={unitId} onValueChange={setUnitId}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select..." />
                            </SelectTrigger>
                            <SelectContent>
                              {units.map((u) => (
                                <SelectItem key={u.unit_id} value={String(u.unit_id)}>{u.unit_name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2 pt-4">
                      <Button
                        onClick={handleAddToBatch}
                        disabled={!supplierId || (linkMode === 'existing' && !selectedComponent)}
                        className="flex-1"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add to Batch
                      </Button>
                      <Button variant="outline" onClick={handleSkipItem}>
                        <SkipForward className="mr-2 h-4 w-4" />
                        Skip
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
                    <p className="font-medium">All items reviewed!</p>
                    <p className="text-sm">Submit your batch or go back to add more.</p>
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Complete */}
            {step === 'complete' && (
              <div className="space-y-4">
                <Alert className={importResults.every(r => r.success) ? '' : 'border-orange-500'}>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle>Import Complete</AlertTitle>
                  <AlertDescription>
                    {importResults.filter(r => r.success).length} of {importResults.length} items imported successfully.
                  </AlertDescription>
                </Alert>
                
                <div className="h-60 border rounded-lg overflow-auto">
                  <div className="divide-y">
                    {importResults.map((r, i) => (
                      <div key={i} className="p-3 flex items-center justify-between">
                        <div>
                          <span className="font-mono text-sm">{r.code}</span>
                          {r.internal_code && <span className="text-muted-foreground text-xs ml-2">→ {r.internal_code}</span>}
                        </div>
                        <Badge variant={r.success ? 'default' : 'destructive'}>
                          {r.success ? 'Imported' : r.message}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
                
                <Button onClick={handleReset} className="w-full">
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Start New Import
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Batch Sidebar */}
      <div className="lg:col-span-1">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Import Batch</CardTitle>
            <CardDescription>{batch.length} items ready to import</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {batch.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">
                <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                No items in batch yet
              </div>
            ) : (
              <>
                <div className="h-64 overflow-auto">
                  <div className="space-y-2">
                    {batch.map((item, i) => (
                      <div key={i} className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm">
                        <div className="truncate flex-1">
                          <div className="font-medium">{item.airtableItem.code}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {item.linkMode === 'existing' ? `→ ${item.selectedComponent?.internal_code}` : item.customMasterCode || 'Auto-generate'}
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleRemoveFromBatch(i)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
                
                <Separator />
                
                <Button 
                  onClick={handleSubmitBatch} 
                  disabled={batch.length === 0 || importing}
                  className="w-full"
                >
                  {importing ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Importing...</>
                  ) : (
                    <><Check className="mr-2 h-4 w-4" />Import {batch.length} Items</>
                  )}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
