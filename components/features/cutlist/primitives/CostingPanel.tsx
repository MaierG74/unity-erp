'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ChevronDown, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CutlistMaterialDefinition, SelectedComponent } from '@/lib/cutlist/types';

// =============================================================================
// Helper Components
// =============================================================================

type CostingSectionKey = 'backer' | 'primary' | 'palette' | 'edgebanding';

interface CostingSectionCardProps {
  section: CostingSectionKey;
  title: string;
  description?: string;
  accent?: string;
  isOpen: boolean;
  onToggle: (section: CostingSectionKey) => void;
  children: React.ReactNode;
}

/**
 * Collapsible card component for costing sections.
 */
export function CostingSectionCard({
  section,
  title,
  description,
  accent,
  isOpen,
  onToggle,
  children,
}: CostingSectionCardProps) {
  return (
    <section className={cn('rounded-xl border shadow-sm backdrop-blur-sm transition-colors', accent)}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onToggle(section)}
      >
        <div>
          <div className="font-semibold text-foreground">{title}</div>
          {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform duration-200',
            isOpen ? 'rotate-180' : 'rotate-0'
          )}
        />
      </button>
      <Separator />
      <div className={cn('px-4 py-4 space-y-4', !isOpen && 'hidden')}>{children}</div>
    </section>
  );
}

type CurrencyInputProps = React.ComponentProps<typeof Input>;

/**
 * Input with currency prefix (R).
 */
function CurrencyInput({ className, onFocus, ...rest }: CurrencyInputProps) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        R
      </span>
      <Input
        {...rest}
        className={cn('w-full pl-7', className)}
        onFocus={(event) => {
          onFocus?.(event);
          event.currentTarget.select();
        }}
      />
    </div>
  );
}

// =============================================================================
// Picker Type
// =============================================================================

export type CostingPickerTarget =
  | 'primary'
  | 'backer'
  | 'band16'
  | 'band32'
  | { mode: 'material'; materialId: string };

// =============================================================================
// CostingPanel Props
// =============================================================================

export interface CostingPanelProps {
  // Backer
  backerDescription: string;
  onBackerDescriptionChange: (value: string) => void;
  backerPrice: number | '';
  onBackerPriceChange: (value: number | '') => void;
  backerComponent: SelectedComponent | null;
  onBackerComponentChange: (component: SelectedComponent | null) => void;

  // Primary
  primaryDescription: string;
  onPrimaryDescriptionChange: (value: string) => void;
  primaryPrice: number | '';
  onPrimaryPriceChange: (value: number | '') => void;
  primaryComponent: SelectedComponent | null;
  onPrimaryComponentChange: (component: SelectedComponent | null) => void;

  // Edgebanding 16mm
  band16Description: string;
  onBand16DescriptionChange: (value: string) => void;
  band16Price: number | '';
  onBand16PriceChange: (value: number | '') => void;
  band16Component: SelectedComponent | null;
  onBand16ComponentChange: (component: SelectedComponent | null) => void;

  // Edgebanding 32mm
  band32Description: string;
  onBand32DescriptionChange: (value: string) => void;
  band32Price: number | '';
  onBand32PriceChange: (value: number | '') => void;
  band32Component: SelectedComponent | null;
  onBand32ComponentChange: (component: SelectedComponent | null) => void;

  // Material palette mode
  enableMaterialPalette?: boolean;
  materials?: CutlistMaterialDefinition[];
  onMaterialsChange?: (materials: CutlistMaterialDefinition[]) => void;
  onAddMaterial?: () => void;
  onRemoveMaterial?: (id: string) => void;
  onUpdateMaterial?: (id: string, updates: Partial<CutlistMaterialDefinition>) => void;

  // Component picker dialog
  onOpenComponentPicker: (type: CostingPickerTarget) => void;
}

// =============================================================================
// CostingPanel Component
// =============================================================================

/**
 * Reusable costing configuration panel for cutlist tools.
 * Renders collapsible sections for backer, primary material, edgebanding,
 * and optionally a material palette with multiple materials.
 */
export function CostingPanel({
  // Backer
  backerDescription,
  onBackerDescriptionChange,
  backerPrice,
  onBackerPriceChange,
  backerComponent,
  // Primary
  primaryDescription,
  onPrimaryDescriptionChange,
  primaryPrice,
  onPrimaryPriceChange,
  primaryComponent,
  // Edgebanding 16mm
  band16Description,
  onBand16DescriptionChange,
  band16Price,
  onBand16PriceChange,
  band16Component,
  // Edgebanding 32mm
  band32Description,
  onBand32DescriptionChange,
  band32Price,
  onBand32PriceChange,
  band32Component,
  // Material palette
  enableMaterialPalette = false,
  materials = [],
  onAddMaterial,
  onRemoveMaterial,
  onUpdateMaterial,
  // Component picker
  onOpenComponentPicker,
}: CostingPanelProps) {
  const [costingSections, setCostingSections] = React.useState<Record<CostingSectionKey, boolean>>({
    backer: false,
    primary: false,
    palette: false,
    edgebanding: false,
  });

  const toggleCostingSection = React.useCallback((section: CostingSectionKey) => {
    setCostingSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  return (
    <div className="space-y-4">
      {/* Backer defaults section */}
      <CostingSectionCard
        section="backer"
        title="Backer defaults"
        description="Set the laminate backer and rate that applies whenever lamination is on."
        accent="bg-muted/15"
        isOpen={costingSections.backer}
        onToggle={toggleCostingSection}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Backer description</Label>
            <Input
              value={backerDescription}
              onChange={(e) => onBackerDescriptionChange(e.target.value)}
              className="w-full"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cost-backer-price">Price per sheet</Label>
            <CurrencyInput
              id="cost-backer-price"
              type="number"
              value={backerPrice}
              onChange={(e) => onBackerPriceChange(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder={backerComponent?.unit_cost != null ? String(backerComponent.unit_cost) : undefined}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenComponentPicker('backer')}>
            {backerComponent ? 'Change backer component' : 'Select backer component'}
          </Button>
          {backerComponent && (
            <span className="text-sm text-muted-foreground">{backerComponent.description}</span>
          )}
        </div>
        {backerComponent?.unit_cost != null && (
          <div className="text-xs text-muted-foreground">
            Current rate: <span className="font-medium text-foreground">{backerComponent.unit_cost.toFixed(2)}</span>
          </div>
        )}
      </CostingSectionCard>

      {/* Material palette mode */}
      {enableMaterialPalette ? (
        <CostingSectionCard
          section="palette"
          title="Material palette"
          description="Define sheet and edging pricing for every finish. Assign materials in the Inputs tab; the first entry exports by default."
          accent="bg-card/50"
          isOpen={costingSections.palette}
          onToggle={toggleCostingSection}
        >
          <div className="space-y-5">
            {materials.map((mat, idx) => (
              <div
                key={mat.id}
                className={cn(
                  'rounded-lg border p-5 space-y-5 transition-colors',
                  idx % 2 === 0 ? 'bg-white/60 dark:bg-muted/30' : 'bg-muted/25'
                )}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="w-full lg:max-w-xs space-y-2">
                    <Label htmlFor={`material-name-${mat.id}`}>Material name</Label>
                    <Input
                      id={`material-name-${mat.id}`}
                      value={mat.name}
                      onChange={(e) => onUpdateMaterial?.(mat.id, { name: e.target.value })}
                      placeholder={`Material ${idx + 1}`}
                      className="w-full"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {idx === 0 ? 'Primary / export default' : `Material ${idx + 1}`}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => onRemoveMaterial?.(mat.id)}
                      disabled={materials.length <= 1}
                      aria-label="Remove material"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor={`material-sheet-${mat.id}`}>Sheet description</Label>
                    <Input
                      id={`material-sheet-${mat.id}`}
                      value={mat.sheetDescription}
                      onChange={(e) => onUpdateMaterial?.(mat.id, { sheetDescription: e.target.value })}
                      placeholder="e.g. White Melamine"
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`material-price-${mat.id}`}>Price per sheet</Label>
                    <CurrencyInput
                      id={`material-price-${mat.id}`}
                      type="number"
                      value={mat.pricePerSheet}
                      onChange={(e) =>
                        onUpdateMaterial?.(mat.id, {
                          pricePerSheet: e.target.value === '' ? '' : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`material-band16-desc-${mat.id}`}>Edgebanding 16mm description</Label>
                    <Input
                      id={`material-band16-desc-${mat.id}`}
                      value={mat.band16Description}
                      onChange={(e) => onUpdateMaterial?.(mat.id, { band16Description: e.target.value })}
                      placeholder="e.g. White PVC 16mm"
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`material-band16-price-${mat.id}`}>Edgebanding 16mm price / meter</Label>
                    <CurrencyInput
                      id={`material-band16-price-${mat.id}`}
                      type="number"
                      value={mat.band16Price}
                      onChange={(e) =>
                        onUpdateMaterial?.(mat.id, {
                          band16Price: e.target.value === '' ? '' : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`material-band32-desc-${mat.id}`}>Edgebanding 32mm description</Label>
                    <Input
                      id={`material-band32-desc-${mat.id}`}
                      value={mat.band32Description}
                      onChange={(e) => onUpdateMaterial?.(mat.id, { band32Description: e.target.value })}
                      placeholder="e.g. White PVC 32mm"
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`material-band32-price-${mat.id}`}>Edgebanding 32mm price / meter</Label>
                    <CurrencyInput
                      id={`material-band32-price-${mat.id}`}
                      type="number"
                      value={mat.band32Price}
                      onChange={(e) =>
                        onUpdateMaterial?.(mat.id, {
                          band32Price: e.target.value === '' ? '' : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenComponentPicker({ mode: 'material', materialId: mat.id })}
                  >
                    Choose sheet...
                  </Button>
                  {mat.component_id && <span>Component #{mat.component_id}</span>}
                </div>

                {idx === 0 && (
                  <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    <span className="uppercase tracking-wide text-xs text-muted-foreground">Export components</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => onOpenComponentPicker('primary')}>
                      {primaryComponent ? 'Change sheet component' : 'Select sheet component'}
                    </Button>
                    {primaryComponent && <span>{primaryComponent.description}</span>}
                    <Button type="button" variant="outline" size="sm" onClick={() => onOpenComponentPicker('band16')}>
                      {band16Component ? 'Change 16mm component' : 'Select 16mm component'}
                    </Button>
                    {band16Component && <span>{band16Component.description}</span>}
                    <Button type="button" variant="outline" size="sm" onClick={() => onOpenComponentPicker('band32')}>
                      {band32Component ? 'Change 32mm component' : 'Select 32mm component'}
                    </Button>
                    {band32Component && <span>{band32Component.description}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
          <Button type="button" variant="secondary" onClick={onAddMaterial}>
            + Add material
          </Button>
        </CostingSectionCard>
      ) : (
        <>
          {/* Primary material section */}
          <CostingSectionCard
            section="primary"
            title="Primary material"
            description="Set the sheet that exports to the costing cluster by default."
            accent="bg-card/50"
            isOpen={costingSections.primary}
            onToggle={toggleCostingSection}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="primary-sheet-desc">Sheet description</Label>
                <Input
                  id="primary-sheet-desc"
                  value={primaryDescription}
                  onChange={(e) => onPrimaryDescriptionChange(e.target.value)}
                  placeholder="e.g. White Melamine"
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="primary-sheet-price">Price per sheet</Label>
                <CurrencyInput
                  id="primary-sheet-price"
                  type="number"
                  value={primaryPrice}
                  onChange={(e) => onPrimaryPriceChange(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder={primaryComponent?.unit_cost != null ? String(primaryComponent.unit_cost) : undefined}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenComponentPicker('primary')}>
                {primaryComponent ? 'Change sheet component' : 'Select sheet component'}
              </Button>
              {primaryComponent && (
                <span className="text-sm text-muted-foreground">{primaryComponent.description}</span>
              )}
            </div>
          </CostingSectionCard>

          {/* Edgebanding section */}
          <CostingSectionCard
            section="edgebanding"
            title="Edgebanding"
            description="Configure the banding descriptions and supplier selections that export with the cutlist."
            accent="bg-muted/20"
            isOpen={costingSections.edgebanding}
            onToggle={toggleCostingSection}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="band16-desc">Edgebanding 16mm description</Label>
                  <Input
                    id="band16-desc"
                    value={band16Description}
                    onChange={(e) => onBand16DescriptionChange(e.target.value)}
                    placeholder="e.g. White PVC 16mm"
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="band16-price">Edgebanding 16mm price / meter</Label>
                  <CurrencyInput
                    id="band16-price"
                    type="number"
                    value={band16Price}
                    onChange={(e) => onBand16PriceChange(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder={band16Component?.unit_cost != null ? String(band16Component.unit_cost) : undefined}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" onClick={() => onOpenComponentPicker('band16')}>
                    {band16Component ? 'Change 16mm component' : 'Select 16mm component'}
                  </Button>
                  {band16Component && (
                    <span className="text-sm text-muted-foreground">{band16Component.description}</span>
                  )}
                </div>
              </div>
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="band32-desc">Edgebanding 32mm description</Label>
                  <Input
                    id="band32-desc"
                    value={band32Description}
                    onChange={(e) => onBand32DescriptionChange(e.target.value)}
                    placeholder="e.g. White PVC 32mm"
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="band32-price">Edgebanding 32mm price / meter</Label>
                  <CurrencyInput
                    id="band32-price"
                    type="number"
                    value={band32Price}
                    onChange={(e) => onBand32PriceChange(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder={band32Component?.unit_cost != null ? String(band32Component.unit_cost) : undefined}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" onClick={() => onOpenComponentPicker('band32')}>
                    {band32Component ? 'Change 32mm component' : 'Select 32mm component'}
                  </Button>
                  {band32Component && (
                    <span className="text-sm text-muted-foreground">{band32Component.description}</span>
                  )}
                </div>
              </div>
            </div>
          </CostingSectionCard>
        </>
      )}
    </div>
  );
}

export default CostingPanel;
