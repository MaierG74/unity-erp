'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { packPartsIntoSheets, type PartSpec, type StockSheetSpec, type LayoutResult } from './packing';
import { Trash2 } from 'lucide-react';
import { SheetPreview } from './preview';
import { exportCutlistToQuote } from '@/components/features/cutlist/export';
import ComponentSelectionDialog from '@/components/features/quotes/ComponentSelectionDialog';

export interface CutlistToolProps {
  onExport?: (result: LayoutResult) => void;
  onResultsChange?: (result: LayoutResult | null) => void;
  quoteItemId?: string | null;
  onExportSuccess?: () => void;
}

export default function CutlistTool({ onExport, onResultsChange, quoteItemId, onExportSuccess }: CutlistToolProps) {
  const [parts, setParts] = React.useState<Array<PartSpec & { label?: string }>>([
    { id: 'P1', length_mm: 500, width_mm: 300, qty: 2, grain: 'length', band_edges: { top: true, right: true, bottom: true, left: true } },
  ]);
  const [stock, setStock] = React.useState<StockSheetSpec[]>([
    { id: 'S1', length_mm: 2750, width_mm: 1830, qty: 10, kerf_mm: 3 },
  ]);
  const [allowRotation, setAllowRotation] = React.useState(true);
  const [singleSheetOnly, setSingleSheetOnly] = React.useState(false);
  const [kerf, setKerf] = React.useState(3);
  const [activeTab, setActiveTab] = React.useState<'inputs' | 'stock' | 'results'>('inputs');
  const [result, setResult] = React.useState<LayoutResult | null>(null);
  const [backerResult, setBackerResult] = React.useState<LayoutResult | null>(null);
  const [sheetOverrides, setSheetOverrides] = React.useState<Record<string, { mode: 'auto' | 'full' | 'manual'; manualPct: number }>>({});
  const [globalFullBoard, setGlobalFullBoard] = React.useState(false);
  const [zoomSheetId, setZoomSheetId] = React.useState<string | null>(null);

  // Costing state
  const [primarySheetDescription, setPrimarySheetDescription] = React.useState<string>('MELAMINE SHEET');
  const [primaryPricePerSheet, setPrimaryPricePerSheet] = React.useState<number | ''>('');
  const [backerSheetDescription, setBackerSheetDescription] = React.useState<string>('BACKER BOARD');
  const [backerPricePerSheet, setBackerPricePerSheet] = React.useState<number | ''>('');
  const [bandingDesc16, setBandingDesc16] = React.useState<string>('EDGE BANDING 16mm (m)');
  const [bandingPrice16, setBandingPrice16] = React.useState<number | ''>('');
  const [bandingDesc32, setBandingDesc32] = React.useState<string>('EDGE BANDING 32mm (m)');
  const [bandingPrice32, setBandingPrice32] = React.useState<number | ''>('');

  // Selected components (optional)
  type SelectedComponent = { description: string; component_id?: number; supplier_component_id?: number; unit_cost?: number | null } | null;
  const [primaryComponent, setPrimaryComponent] = React.useState<SelectedComponent>(null);
  const [backerComponent, setBackerComponent] = React.useState<SelectedComponent>(null);
  const [band16Component, setBand16Component] = React.useState<SelectedComponent>(null);
  const [band32Component, setBand32Component] = React.useState<SelectedComponent>(null);
  const [pickerFor, setPickerFor] = React.useState<null | 'primary' | 'backer' | 'band16' | 'band32'>(null);

  const sheet = stock[0];

  const addPartRow = () => {
    const nextIndex = parts.length + 1;
    setParts([...parts, { id: `P${nextIndex}`, length_mm: 400, width_mm: 300, qty: 1, grain: 'length', band_edges: { top: true, right: true, bottom: true, left: true } }]);
  };

  const removePartRow = (idx: number) => {
    setParts(parts.filter((_, i) => i !== idx));
  };

  const updatePart = (idx: number, updates: Partial<PartSpec & { label?: string }>) => {
    const next = [...parts];
    next[idx] = { ...next[idx], ...updates } as any;
    setParts(next);
  };

  const updateStock = (updates: Partial<StockSheetSpec>) => {
    const next = [{ ...stock[0], ...updates } as StockSheetSpec];
    setStock(next);
  };

  const handleCalculate = () => {
    // Ensure kerf from options applied to stock sheet
    const normalized: StockSheetSpec[] = [{ ...stock[0], kerf_mm: Math.max(0, kerf) }];
    const res = packPartsIntoSheets(parts, normalized, { allowRotation, singleSheetOnly });
    setResult(res);
    setSheetOverrides({});
    setGlobalFullBoard(false);
    // Optional backer calculation (laminate=true parts, grain-any)
    if (parts.some(p => p.laminate)) {
      const backerParts: PartSpec[] = parts
        .filter(p => p.laminate)
        .map(p => ({ ...p, grain: 'any', require_grain: undefined, band_edges: undefined } as PartSpec));
      const resBacker = packPartsIntoSheets(backerParts, normalized, { allowRotation: true, singleSheetOnly });
      setBackerResult(resBacker);
    } else {
      setBackerResult(null);
    }
    setActiveTab('results');
    onResultsChange?.(res);
  };

  const handleExport = async () => {
    if (!result) return;
    // If a quote item id is provided, export directly with costing
    if (quoteItemId) {
      const laminationOn = parts.some(p => p.laminate);
      const pricePerSheetVal = primaryPricePerSheet === '' ? (primaryComponent?.unit_cost ?? null) : Number(primaryPricePerSheet);
      const backerPriceVal = backerPricePerSheet === '' ? (backerComponent?.unit_cost ?? null) : Number(backerPricePerSheet);
      // Build extra lines (component-backed when available)
      const allExtras: Array<{ description: string; qty: number; unit_cost?: number | null; component_id?: number; supplier_component_id?: number }> = [];
      // Primary sheet as its own line (we'll suppress default by sending fractionalSheetQty=0)
      allExtras.push({
        description: primaryComponent?.description || primarySheetDescription,
        qty: primarySheetsFractional,
        unit_cost: pricePerSheetVal ?? undefined,
        component_id: primaryComponent?.component_id,
        supplier_component_id: primaryComponent?.supplier_component_id,
      });
      // Backer sheet if applicable
      if (backerResult && backerSheetsFractional > 0.0001 && laminationOn) {
        allExtras.push({
          description: backerComponent?.description || backerSheetDescription,
          qty: backerSheetsFractional,
          unit_cost: backerPriceVal ?? undefined,
          component_id: backerComponent?.component_id,
          supplier_component_id: backerComponent?.supplier_component_id,
        });
      }
      // Banding 16mm and 32mm
      if (bandLen16 > 0.0001) {
        allExtras.push({
          description: band16Component?.description || bandingDesc16,
          qty: bandLen16 / 1000,
          unit_cost: band16Component?.unit_cost ?? (bandingPrice16 === '' ? null : Number(bandingPrice16)) ?? undefined,
          component_id: band16Component?.component_id,
          supplier_component_id: band16Component?.supplier_component_id,
        });
      }
      if (bandLen32 > 0.0001) {
        allExtras.push({
          description: band32Component?.description || bandingDesc32,
          qty: bandLen32 / 1000,
          unit_cost: band32Component?.unit_cost ?? (bandingPrice32 === '' ? null : Number(bandingPrice32)) ?? undefined,
          component_id: band32Component?.component_id,
          supplier_component_id: band32Component?.supplier_component_id,
        });
      }

      try {
        await exportCutlistToQuote({
          quoteItemId,
          result,
          sheetDescription: '',
          edgeBandingDescription: '',
          pricePerSheet: null,
          pricePerMeterBanding: null,
          fractionalSheetQty: 0,
          addDefaultSheetLine: false,
          addDefaultBandingLine: false,
          extraManualLines: allExtras,
        });
        // Notify parent so it can close dialog and optionally expand cluster
        onExportSuccess?.();
      } catch (e) {
        console.error('Cutlist export failed:', e);
      }
    } else {
      onExport?.(result);
    }
  };

  const usedSheets = result?.sheets.length || 0;
  const usedArea = result?.stats.used_area_mm2 || 0;
  const wasteArea = result?.stats.waste_area_mm2 || 0;
  const totalArea = usedArea + wasteArea;
  const usedPct = totalArea > 0 ? (usedArea / totalArea) * 100 : 0;
  const bandLen = result?.stats.edgebanding_length_mm || 0;
  const bandLen16 = result?.stats.edgebanding_16mm_mm || 0;
  const bandLen32 = result?.stats.edgebanding_32mm_mm || 0;
  const sheetArea = sheet.length_mm * sheet.width_mm;
  const primarySheetsFractional = sheetArea > 0 ? usedArea / sheetArea : 0;
  const backerUsedArea = backerResult?.stats.used_area_mm2 || 0;
  const backerSheetsFractional = sheetArea > 0 ? backerUsedArea / sheetArea : 0;
  const computeSheetCharge = React.useCallback((layout: LayoutResult | null): number => {
    if (!layout) return 0;
    const area = sheetArea > 0 ? sheetArea : 0;
    if (area <= 0) return 0;
    return layout.sheets.reduce((sum, s) => {
      const used = s.used_area_mm2 ?? 0;
      const autoPct = Math.min(100, Math.max(0, (used / area) * 100));
      const override = sheetOverrides[s.sheet_id];
      let pct = autoPct;
      if (globalFullBoard) {
        pct = 100;
      } else if (override) {
        if (override.mode === 'full') pct = 100;
        if (override.mode === 'manual') pct = Math.min(100, Math.max(0, override.manualPct));
      }
      return sum + pct / 100;
    }, 0);
  }, [globalFullBoard, sheetArea, sheetOverrides]);

  const primaryChargeSheets = computeSheetCharge(result);
  const backerChargeSheets = computeSheetCharge(backerResult);

  const [activePage, setActivePage] = React.useState(0); // 0-based, 3 sheets per page
  React.useEffect(() => { setActivePage(0); }, [result?.sheets.length]);

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="inputs">Inputs</TabsTrigger>
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="costing">Costing</TabsTrigger>
        </TabsList>
        <TabsContent value="inputs" className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-3">
              <div className="font-medium">Parts</div>
              <div className="space-y-2">
                <div className="grid grid-cols-9 gap-4 md:gap-8 text-xs text-muted-foreground items-center">
                  <div>ID</div>
                  <div>Length (mm)</div>
                  <div>Width (mm)</div>
                  <div>Qty</div>
                  <div>Grain</div>
                  <div className="pl-1">Edge length</div>
                  <div>Edge width</div>
                  <div className="flex items-center justify-center w-[48px]">Lami</div>
                  <div></div>
                </div>
                {parts.map((p, idx) => (
                  <div key={idx} className="grid grid-cols-9 gap-4 md:gap-8 items-start">
                    <div>
                      <Label htmlFor={`pid-${idx}`} className="sr-only">ID</Label>
                      <Input id={`pid-${idx}`} className="w-[72px]" value={p.id} onChange={(e) => updatePart(idx, { id: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor={`len-${idx}`} className="sr-only">Length (mm)</Label>
                      <Input id={`len-${idx}`} className="w-[88px]" type="number" value={p.length_mm} onChange={(e) => updatePart(idx, { length_mm: Number(e.target.value || 0) })} onFocus={(e) => e.target.select()} />
                    </div>
                    <div>
                      <Label htmlFor={`wid-${idx}`} className="sr-only">Width (mm)</Label>
                      <Input id={`wid-${idx}`} className="w-[88px]" type="number" value={p.width_mm} onChange={(e) => updatePart(idx, { width_mm: Number(e.target.value || 0) })} onFocus={(e) => e.target.select()} />
                    </div>
                    <div>
                      <Label htmlFor={`qty-${idx}`} className="sr-only">Qty</Label>
                      <Input id={`qty-${idx}`} className="w-[72px]" type="number" value={p.qty} onChange={(e) => updatePart(idx, { qty: Number(e.target.value || 0) })} onFocus={(e) => e.target.select()} />
                    </div>
                    <div className="md:pr-4">
                      <Label htmlFor={`grain-${idx}`} className="sr-only">Grain</Label>
                      <Select value={p.grain ?? (p.require_grain ? 'length' : 'any')} onValueChange={(v) => updatePart(idx, { grain: v as any, require_grain: undefined })}>
                        <SelectTrigger id={`grain-${idx}`} className="w-[120px]">
                          <SelectValue placeholder="Grain" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">Any</SelectItem>
                          <SelectItem value="length">Length</SelectItem>
                          <SelectItem value="width">Width</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1 text-xs w-[130px] whitespace-nowrap ml-2 md:ml-4">
                      <div className="flex items-center gap-1" title="Apply edging to left length edge">
                        <Checkbox id={`len-left-${idx}`} className="h-4 w-4" checked={Boolean(p.band_edges?.left)} onCheckedChange={(v) => updatePart(idx, { band_edges: { ...p.band_edges, left: Boolean(v) } })} />
                        <Label htmlFor={`len-left-${idx}`} className="leading-none">Left <span className="ml-1 text-[11px] text-muted-foreground">({p.length_mm})</span></Label>
                      </div>
                      <div className="flex items-center gap-1" title="Apply edging to right length edge">
                        <Checkbox id={`len-right-${idx}`} className="h-4 w-4" checked={Boolean(p.band_edges?.right)} onCheckedChange={(v) => updatePart(idx, { band_edges: { ...p.band_edges, right: Boolean(v) } })} />
                        <Label htmlFor={`len-right-${idx}`} className="leading-none">Right <span className="ml-1 text-[11px] text-muted-foreground">({p.length_mm})</span></Label>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 text-xs w-[130px] whitespace-nowrap">
                      <div className="flex items-center gap-1" title="Apply edging to top width edge">
                        <Checkbox id={`wid-top-${idx}`} className="h-4 w-4" checked={Boolean(p.band_edges?.top)} onCheckedChange={(v) => updatePart(idx, { band_edges: { ...p.band_edges, top: Boolean(v) } })} />
                        <Label htmlFor={`wid-top-${idx}`} className="leading-none">Top <span className="ml-1 text-[11px] text-muted-foreground">({p.width_mm})</span></Label>
                      </div>
                      <div className="flex items-center gap-1" title="Apply edging to bottom width edge">
                        <Checkbox id={`wid-bot-${idx}`} className="h-4 w-4" checked={Boolean(p.band_edges?.bottom)} onCheckedChange={(v) => updatePart(idx, { band_edges: { ...p.band_edges, bottom: Boolean(v) } })} />
                        <Label htmlFor={`wid-bot-${idx}`} className="leading-none">Bottom <span className="ml-1 text-[11px] text-muted-foreground">({p.width_mm})</span></Label>
                      </div>
                    </div>
                    <div className="flex items-center justify-center w-[48px]">
                      <Checkbox id={`lam-${idx}`} checked={Boolean(p.laminate)} onCheckedChange={(v) => updatePart(idx, { laminate: Boolean(v) })} />
                      <Label htmlFor={`lam-${idx}`} className="sr-only">Laminate with backer</Label>
                    </div>
                    <div className="flex items-center w-[48px] justify-end">
                      <Button variant="destructiveSoft" size="icon" className="h-8 w-8" type="button" onClick={() => removePartRow(idx)} aria-label="Delete row">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                <div>
                  <Button type="button" variant="secondary" onClick={addPartRow}>+ Add Part</Button>
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleCalculate}>Calculate</Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="costing" className="space-y-4">
          <div className="space-y-3">
            <div className="font-medium">Costing</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Primary sheet</div>
                <div className="grid grid-cols-2 gap-2 items-center">
                  <div>
                    <Label>Component</Label>
                    <div className="flex items-center gap-2">
                      <Input readOnly value={primaryComponent?.description || primarySheetDescription} />
                      <Button type="button" variant="outline" onClick={() => setPickerFor('primary')}>{primaryComponent ? 'Change' : 'Select'}</Button>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="cost-primary-price">Price per sheet</Label>
                    <Input id="cost-primary-price" type="number" value={primaryPricePerSheet} onChange={e => setPrimaryPricePerSheet(e.target.value === '' ? '' : Number(e.target.value))} onFocus={e => e.target.select()} placeholder={primaryComponent?.unit_cost != null ? String(primaryComponent.unit_cost) : undefined} />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Backer sheet</div>
                <div className="grid grid-cols-2 gap-2 items-center">
                  <div>
                    <Label>Component</Label>
                    <div className="flex items-center gap-2">
                      <Input readOnly value={backerComponent?.description || backerSheetDescription} />
                      <Button type="button" variant="outline" onClick={() => setPickerFor('backer')}>{backerComponent ? 'Change' : 'Select'}</Button>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="cost-backer-price">Price per sheet</Label>
                    <Input id="cost-backer-price" type="number" value={backerPricePerSheet} onChange={e => setBackerPricePerSheet(e.target.value === '' ? '' : Number(e.target.value))} onFocus={e => e.target.select()} placeholder={backerComponent?.unit_cost != null ? String(backerComponent.unit_cost) : undefined} />
                  </div>
                </div>
              </div>
            </div>
            <Separator />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Banding (16mm)</div>
                <div className="grid grid-cols-2 gap-2 items-center">
                  <div>
                    <Label>Component</Label>
                    <div className="flex items-center gap-2">
                      <Input readOnly value={band16Component?.description || bandingDesc16} />
                      <Button type="button" variant="outline" onClick={() => setPickerFor('band16')}>{band16Component ? 'Change' : 'Select'}</Button>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="cost-band16-price">Price per meter</Label>
                    <Input id="cost-band16-price" type="number" value={bandingPrice16} onChange={e => setBandingPrice16(e.target.value === '' ? '' : Number(e.target.value))} onFocus={e => e.target.select()} placeholder={band16Component?.unit_cost != null ? String(band16Component.unit_cost) : undefined} />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Banding (32mm)</div>
                <div className="grid grid-cols-2 gap-2 items-center">
                  <div>
                    <Label>Component</Label>
                    <div className="flex items-center gap-2">
                      <Input readOnly value={band32Component?.description || bandingDesc32} />
                      <Button type="button" variant="outline" onClick={() => setPickerFor('band32')}>{band32Component ? 'Change' : 'Select'}</Button>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="cost-band32-price">Price per meter</Label>
                    <Input id="cost-band32-price" type="number" value={bandingPrice32} onChange={e => setBandingPrice32(e.target.value === '' ? '' : Number(e.target.value))} onFocus={e => e.target.select()} placeholder={band32Component?.unit_cost != null ? String(band32Component.unit_cost) : undefined} />
                  </div>
                </div>
              </div>
            </div>
            {(onExport || quoteItemId) && (
              <div className="flex justify-end pt-2">
                <Button onClick={handleExport}>Export to Quote</Button>
              </div>
            )}
          </div>
          <ComponentSelectionDialog
            open={pickerFor !== null}
            onClose={() => setPickerFor(null)}
            onAddComponent={(comp) => {
              const sel = {
                description: comp.description,
                component_id: comp.component_id,
                supplier_component_id: comp.supplier_component_id,
                unit_cost: comp.unit_cost,
              } as any;
              if (pickerFor === 'primary') { setPrimaryComponent(sel); if (primaryPricePerSheet === '') setPrimaryPricePerSheet(comp.unit_cost || ''); }
              if (pickerFor === 'backer') { setBackerComponent(sel); if (backerPricePerSheet === '') setBackerPricePerSheet(comp.unit_cost || ''); }
              if (pickerFor === 'band16') { setBand16Component(sel); if (bandingPrice16 === '') setBandingPrice16(comp.unit_cost || ''); }
              if (pickerFor === 'band32') { setBand32Component(sel); if (bandingPrice32 === '') setBandingPrice32(comp.unit_cost || ''); }
              setPickerFor(null);
            }}
          />
        </TabsContent>
        <TabsContent value="stock" className="space-y-4">
          <div className="space-y-3">
            <div className="font-medium">Stock Sheet</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="s-l">Length (mm)</Label>
                <Input id="s-l" type="number" value={sheet.length_mm} onChange={(e) => updateStock({ length_mm: Number(e.target.value || 0) })} onFocus={(e) => e.target.select()} />
              </div>
              <div>
                <Label htmlFor="s-w">Width (mm)</Label>
                <Input id="s-w" type="number" value={sheet.width_mm} onChange={(e) => updateStock({ width_mm: Number(e.target.value || 0) })} onFocus={(e) => e.target.select()} />
              </div>
              <div>
                <Label htmlFor="s-q">Qty Available</Label>
                <Input id="s-q" type="number" value={sheet.qty} onChange={(e) => updateStock({ qty: Number(e.target.value || 0) })} onFocus={(e) => e.target.select()} />
              </div>
              <div>
                <Label htmlFor="kerf">Kerf (mm)</Label>
                <Input id="kerf" type="number" value={kerf} onChange={(e) => setKerf(Number(e.target.value || 0))} onFocus={(e) => e.target.select()} />
              </div>
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <Checkbox id="rot" checked={allowRotation} onCheckedChange={(v) => setAllowRotation(Boolean(v))} />
                <Label htmlFor="rot" className="text-sm text-muted-foreground">Allow 90° rotation</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="single" checked={singleSheetOnly} onCheckedChange={(v) => setSingleSheetOnly(Boolean(v))} />
                <Label htmlFor="single" className="text-sm text-muted-foreground">Single sheet only</Label>
              </div>
            </div>
            
          </div>
        </TabsContent>

        <TabsContent value="results" className="space-y-4">
          {!result ? (
            <div className="text-muted-foreground">No results yet. Enter inputs and click Calculate.</div>
          ) : (
            <div className="space-y-4">
              <div className={`grid grid-cols-2 ${backerResult ? 'md:grid-cols-6' : 'md:grid-cols-5'} gap-3`}>
                <Stat label="Sheets used" value={`${primarySheetsFractional.toFixed(3)}`} />
                <Stat label="Billable sheets" value={`${primaryChargeSheets.toFixed(3)}`} />
                <Stat label="Board used %" value={`${usedPct.toFixed(1)}%`} />
                <Stat label="Edge 16mm" value={`${(bandLen16 / 1000).toFixed(2)}m`} />
                <Stat label="Edge 32mm" value={`${(bandLen32 / 1000).toFixed(2)}m`} />
                <Stat label="Lamination" value={parts.some(p => p.laminate) ? 'On' : 'Off'} />
                {backerResult && <Stat label="Backer sheets" value={`${backerSheetsFractional.toFixed(3)}`} />}
                {backerResult && <Stat label="Billable backer" value={`${backerChargeSheets.toFixed(3)}`} />}
              </div>
              <div className="flex items-center gap-3 bg-muted/40 border rounded px-3 py-2">
                <Switch id="full-board-switch" checked={globalFullBoard} onCheckedChange={(v) => setGlobalFullBoard(Boolean(v))} />
                <Label htmlFor="full-board-switch" className="text-sm">Charge full sheet for every used board</Label>
              </div>
              {result.unplaced && result.unplaced.length > 0 && (
                <Alert variant="warning">
                  <AlertTitle>Unplaced parts</AlertTitle>
                  <AlertDescription>
                    <div className="text-sm leading-relaxed space-y-1">
                      {result.unplaced.map((item, idx) => (
                        <div key={idx}>
                          <span className="font-medium">{item.part.id}</span>
                          {` × ${item.count} — `}
                          {item.reason === 'too_large_for_sheet'
                            ? 'Part exceeds stock sheet dimensions (check grain/rotation and sizing).'
                            : 'No sheet capacity remaining. Increase available sheets or adjust layout.'}
                          {` (${item.part.length_mm} × ${item.part.width_mm} mm)`}
                        </div>
                      ))}
                    </div>
                  </AlertDescription>
                </Alert>
              )}
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2 items-center">
                  <div className="text-sm text-muted-foreground mr-1">Pages:</div>
                  {Array.from({ length: Math.ceil(result.sheets.length / 3) }).map((_, idx) => (
                    <Button key={idx} size="sm" variant={idx === activePage ? 'default' : 'outline'} onClick={() => setActivePage(idx)}>
                      {idx + 1}
                    </Button>
                  ))}
                  <div className="ml-auto text-xs text-muted-foreground">
                    Showing {activePage * 3 + 1}-{Math.min((activePage + 1) * 3, result.sheets.length)} of {result.sheets.length}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {result.sheets.slice(activePage * 3, activePage * 3 + 3).map((sheetLayout, idx) => {
                    const autoPct = sheetArea > 0 ? (sheetLayout.used_area_mm2 || 0) / sheetArea * 100 : 0;
                    const override = sheetOverrides[sheetLayout.sheet_id];
                    const mode = globalFullBoard ? 'full' : override?.mode ?? 'auto';
                    const manualPct = override?.manualPct ?? autoPct;
                    const chargePct = mode === 'full' ? 100 : mode === 'manual' ? manualPct : autoPct;
                    return (
                      <div key={sheetLayout.sheet_id} className="border rounded p-2 space-y-2">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Sheet {activePage * 3 + idx + 1}</span>
                          <button className="text-foreground hover:underline" onClick={() => setZoomSheetId(sheetLayout.sheet_id)}>Zoom</button>
                        </div>
                        <SheetPreview sheetWidth={sheet.width_mm} sheetLength={sheet.length_mm} layout={sheetLayout} maxWidth={260} maxHeight={200} />
                        <div className="text-xs text-muted-foreground">
                          Used {(autoPct).toFixed(1)}% ({((sheetLayout.used_area_mm2 || 0) / 1_000_000).toFixed(2)} m² of {(sheetArea / 1_000_000).toFixed(2)} m²)
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-xs">
                            <Switch
                              id={`full-${sheetLayout.sheet_id}`}
                              checked={mode === 'full'}
                              disabled={globalFullBoard}
                              onCheckedChange={(v) => {
                                setSheetOverrides(prev => ({
                                  ...prev,
                                  [sheetLayout.sheet_id]: v ? { mode: 'full', manualPct: manualPct } : { mode: 'auto', manualPct: manualPct },
                                }));
                              }}
                            />
                            <Label htmlFor={`full-${sheetLayout.sheet_id}`} className="text-xs">Charge full sheet</Label>
                          </div>
                          <div className="grid grid-cols-[auto_1fr] items-center gap-2 text-xs">
                            <Label htmlFor={`manual-${sheetLayout.sheet_id}`}>Manual %</Label>
                            <Input
                              id={`manual-${sheetLayout.sheet_id}`}
                              type="number"
                              value={Math.round(chargePct)}
                              min={0}
                              max={100}
                              disabled={globalFullBoard}
                              onChange={(e) => {
                                const next = Number(e.target.value || 0);
                                setSheetOverrides(prev => ({
                                  ...prev,
                                  [sheetLayout.sheet_id]: { mode: 'manual', manualPct: next },
                                }));
                              }}
                            />
                          </div>
                          <div className="text-xs text-muted-foreground">Billing {chargePct.toFixed(1)}%</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {(onExport || quoteItemId) && (
                <div className="pt-2">
                  <Button onClick={handleExport}>Export to Quote</Button>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
      <Dialog open={zoomSheetId != null} onOpenChange={(open) => { if (!open) setZoomSheetId(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Sheet preview</DialogTitle>
          </DialogHeader>
          {zoomSheetId && result && result.sheets.find(s => s.sheet_id === zoomSheetId) && (
            <div className="flex justify-center">
              <SheetPreview
                sheetWidth={sheet.width_mm}
                sheetLength={sheet.length_mm}
                layout={result.sheets.find(s => s.sheet_id === zoomSheetId)!}
                maxWidth={800}
                maxHeight={600}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">
        {value} {unit ? <span className="font-normal text-muted-foreground">{unit}</span> : null}
      </div>
    </div>
  );
}

