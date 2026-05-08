'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Save, ArrowRight, Ruler, RotateCcw } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { CutlistPart } from '@/lib/cutlist/types';
import { EdgeBandingPopover } from '@/components/features/cutlist/primitives/EdgeBandingPopover';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import type { CupboardConfig } from '@/lib/configurator/templates/types';
import type { PigeonholeConfig } from '@/lib/configurator/templates/types';
import type { PedestalConfig } from '@/lib/configurator/templates/types';
import { DEFAULT_CUPBOARD_CONFIG, DEFAULT_PIGEONHOLE_CONFIG, DEFAULT_PEDESTAL_CONFIG } from '@/lib/configurator/templates/types';
import { generateCupboardParts } from '@/lib/configurator/templates/cupboard';
import { generatePigeonholeParts } from '@/lib/configurator/templates/pigeonhole';
import { generatePedestalParts } from '@/lib/configurator/templates/pedestal';
import { TEMPLATES } from '@/lib/configurator/templates';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { useOrgSettings } from '@/hooks/use-org-settings';
import { CupboardForm } from './CupboardForm';
import { CupboardPreview } from './CupboardPreview';
import { PigeonholeForm } from './PigeonholeForm';
import { PigeonholePreview } from './PigeonholePreview';
import { PedestalForm } from './PedestalForm';
import { PedestalPreview } from './PedestalPreview';
import { captureAndUploadProductDrawing } from '@/lib/configurator/captureProductDrawing';

interface FurnitureConfiguratorProps {
  productId: number;
}

// Edge banding display helper
function EdgeBadges({ edges }: { edges: CutlistPart['band_edges'] }) {
  const labels = [
    { key: 'top', label: 'T' },
    { key: 'right', label: 'R' },
    { key: 'bottom', label: 'B' },
    { key: 'left', label: 'L' },
  ] as const;

  const active = labels.filter((l) => edges[l.key]);
  if (active.length === 0) return <span className="text-muted-foreground">None</span>;

  return (
    <span className="flex gap-0.5">
      {active.map((l) => (
        <span
          key={l.key}
          className="inline-flex items-center justify-center w-5 h-5 rounded-sm bg-orange-100 text-orange-700 text-[10px] font-medium dark:bg-orange-950 dark:text-orange-400"
        >
          {l.label}
        </span>
      ))}
    </span>
  );
}

type TemplateId = 'cupboard' | 'pigeonhole' | 'pedestal';

export function FurnitureConfigurator({ productId }: FurnitureConfiguratorProps) {
  const router = useRouter();
  const { configuratorDefaults, isLoading: orgLoading } = useOrgSettings();
  const [templateId, setTemplateId] = React.useState<TemplateId>('cupboard');
  const [cupboardConfig, setCupboardConfig] = React.useState<CupboardConfig>(DEFAULT_CUPBOARD_CONFIG);
  const [pigeonholeConfig, setPigeonholeConfig] = React.useState<PigeonholeConfig>(DEFAULT_PIGEONHOLE_CONFIG);
  const [pedestalConfig, setPedestalConfig] = React.useState<PedestalConfig>(DEFAULT_PEDESTAL_CONFIG);
  const [saving, setSaving] = React.useState(false);
  const [orgApplied, setOrgApplied] = React.useState(false);
  const previewRef = React.useRef<SVGSVGElement>(null);
  // Edge banding overrides keyed by part id
  const [edgeOverrides, setEdgeOverrides] = React.useState<Record<string, CutlistPart['band_edges']>>({});

  // Apply org defaults once loaded (only on initial mount)
  React.useEffect(() => {
    if (!orgLoading && !orgApplied && Object.keys(configuratorDefaults).length > 0) {
      setCupboardConfig(prev => ({ ...prev, ...configuratorDefaults }));
      // Apply shared fields to pigeonhole too
      const shared: Partial<PigeonholeConfig> = {};
      if (configuratorDefaults.materialThickness) shared.materialThickness = configuratorDefaults.materialThickness;
      if (configuratorDefaults.backMaterialThickness) shared.backMaterialThickness = configuratorDefaults.backMaterialThickness;
      if (configuratorDefaults.adjusterHeight !== undefined) shared.adjusterHeight = configuratorDefaults.adjusterHeight;
      if (configuratorDefaults.shelfSetback !== undefined) shared.shelfSetback = configuratorDefaults.shelfSetback;
      if (configuratorDefaults.backSlotDepth !== undefined) shared.backSlotDepth = configuratorDefaults.backSlotDepth;
      if (configuratorDefaults.backRecess !== undefined) shared.backRecess = configuratorDefaults.backRecess;
      if (configuratorDefaults.doorGap !== undefined) shared.doorGap = configuratorDefaults.doorGap;
      if (Object.keys(shared).length > 0) {
        setPigeonholeConfig(prev => ({ ...prev, ...shared }));
      }
      // Apply shared fields to pedestal too
      const pedestalShared: Partial<PedestalConfig> = {};
      if (configuratorDefaults.materialThickness) pedestalShared.materialThickness = configuratorDefaults.materialThickness;
      if (configuratorDefaults.backMaterialThickness) pedestalShared.backMaterialThickness = configuratorDefaults.backMaterialThickness;
      if (configuratorDefaults.adjusterHeight !== undefined) pedestalShared.adjusterHeight = configuratorDefaults.adjusterHeight;
      if (configuratorDefaults.shelfSetback !== undefined) pedestalShared.shelfSetback = configuratorDefaults.shelfSetback;
      if (configuratorDefaults.backSlotDepth !== undefined) pedestalShared.backSlotDepth = configuratorDefaults.backSlotDepth;
      if (configuratorDefaults.backRecess !== undefined) pedestalShared.backRecess = configuratorDefaults.backRecess;
      if (configuratorDefaults.doorGap !== undefined) pedestalShared.drawerGap = configuratorDefaults.doorGap;
      if (Object.keys(pedestalShared).length > 0) {
        setPedestalConfig(prev => ({ ...prev, ...pedestalShared }));
      }
      setOrgApplied(true);
    }
  }, [orgLoading, orgApplied, configuratorDefaults]);

  // Generate parts from active config
  const parts = React.useMemo(() => {
    if (templateId === 'cupboard') return generateCupboardParts(cupboardConfig);
    if (templateId === 'pedestal') return generatePedestalParts(pedestalConfig);
    return generatePigeonholeParts(pigeonholeConfig);
  }, [templateId, cupboardConfig, pigeonholeConfig, pedestalConfig]);

  // Merge edge overrides into generated parts
  const finalParts = React.useMemo(() =>
    parts.map(p => edgeOverrides[p.id] ? { ...p, band_edges: edgeOverrides[p.id] } : p),
    [parts, edgeOverrides]
  );

  const hasEdgeOverrides = Object.keys(edgeOverrides).length > 0;

  const totalParts = finalParts.reduce((sum, p) => sum + p.quantity, 0);

  const activeConfig = templateId === 'cupboard' ? cupboardConfig : templateId === 'pigeonhole' ? pigeonholeConfig : pedestalConfig;
  const templateName = TEMPLATES[templateId]?.name ?? templateId;

  // Save parts to product cutlist groups
  const saveParts = React.useCallback(
    async (navigateToBuilder: boolean) => {
      setSaving(true);
      try {
        const { width, height, depth, materialThickness: thickness } = activeConfig as { width: number; height: number; depth: number; materialThickness: number };
        const configLabel = `${width} × ${height} × ${depth}`;
        const laminatedParts = finalParts.filter((p) => p.lamination_type === 'same-board');
        const standardParts = finalParts.filter((p) => p.lamination_type !== 'same-board');

        const groups: { name: string; board_type: string; parts: CutlistPart[]; sort_order: number }[] = [];
        if (laminatedParts.length > 0) {
          groups.push({
            name: `${templateName} Laminated (${configLabel})`,
            board_type: `${thickness * 2}mm-both`,
            parts: laminatedParts,
            sort_order: 0,
          });
        }
        if (standardParts.length > 0) {
          groups.push({
            name: `${templateName} Panels (${configLabel})`,
            board_type: `${thickness}mm`,
            parts: standardParts,
            sort_order: groups.length,
          });
        }

        const res = await authorizedFetch(
          `/api/products/${productId}/cutlist-groups?module=${MODULE_KEYS.FURNITURE_CONFIGURATOR}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groups }),
          }
        );

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to save');
        }

        toast.success('Parts saved to product');

        if (previewRef.current) {
          try {
            await captureAndUploadProductDrawing(previewRef.current, productId);
          } catch (captureError) {
            console.error('Product drawing capture failed:', captureError);
            toast.warning('Parts saved, but reference drawing capture failed');
          }
        }

        if (navigateToBuilder) {
          router.push(`/products/${productId}/cutlist-builder`);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to save parts');
      } finally {
        setSaving(false);
      }
    },
    [activeConfig, finalParts, productId, router, templateName]
  );

  return (
    <div className="space-y-6">
      {/* Two-column layout: Form (scrollable) + Preview (fixed height) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left: Configuration Form — scrollable within fixed height */}
        <Card className="lg:max-h-[520px] lg:flex lg:flex-col">
          <CardHeader className="pb-3 flex-shrink-0">
            <div className="flex items-center gap-2 mb-2">
              <Ruler className="h-4 w-4" />
              <CardTitle className="text-base">Configuration</CardTitle>
            </div>
            <Select value={templateId} onValueChange={(v) => setTemplateId(v as TemplateId)}>
              <SelectTrigger className="w-full h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(TEMPLATES).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="pt-0 lg:overflow-y-auto lg:flex-1">
            {templateId === 'cupboard' && (
              <CupboardForm config={cupboardConfig} onChange={setCupboardConfig} />
            )}
            {templateId === 'pigeonhole' && (
              <PigeonholeForm config={pigeonholeConfig} onChange={setPigeonholeConfig} />
            )}
            {templateId === 'pedestal' && (
              <PedestalForm config={pedestalConfig} onChange={setPedestalConfig} />
            )}
          </CardContent>
        </Card>

        {/* Right: SVG Preview */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Preview</CardTitle>
          </CardHeader>
          <CardContent className="overflow-hidden">
            {templateId === 'cupboard' && <CupboardPreview ref={previewRef} config={cupboardConfig} />}
            {templateId === 'pigeonhole' && <PigeonholePreview config={pigeonholeConfig} />}
            {templateId === 'pedestal' && <PedestalPreview config={pedestalConfig} />}
          </CardContent>
        </Card>
      </div>

      {/* Generated Parts Table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              Generated Parts ({totalParts} panel{totalParts !== 1 ? 's' : ''})
            </CardTitle>
            <div className="flex gap-2">
              {hasEdgeOverrides && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEdgeOverrides({})}
                      className="gap-1.5 text-muted-foreground"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reset Edges
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Reset all edge banding to defaults</TooltipContent>
                </Tooltip>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => saveParts(false)}
                disabled={saving || finalParts.length === 0}
                className="gap-1.5"
              >
                <Save className="h-4 w-4" />
                Save to Product
              </Button>
              <Button
                size="sm"
                onClick={() => saveParts(true)}
                disabled={saving || finalParts.length === 0}
                className="gap-1.5"
              >
                <ArrowRight className="h-4 w-4" />
                Save & Open Cutlist Builder
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {finalParts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Dimensions too small to generate valid panels. Increase width, height, or depth.
            </p>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-3 py-2 text-left font-medium">Part</th>
                    <th className="px-3 py-2 text-right font-medium">Length</th>
                    <th className="px-3 py-2 text-right font-medium">Width</th>
                    <th className="px-3 py-2 text-center font-medium">Qty</th>
                    <th className="px-3 py-2 text-center font-medium">Grain</th>
                    <th className="px-3 py-2 text-center font-medium">Edge Banding</th>
                  </tr>
                </thead>
                <tbody>
                  {finalParts.map((part) => (
                    <tr key={part.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{part.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{part.length_mm}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{part.width_mm}</td>
                      <td className="px-3 py-2 text-center">{part.quantity}</td>
                      <td className="px-3 py-2 text-center capitalize">{part.grain}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-center">
                          <EdgeBandingPopover
                            length={part.length_mm}
                            width={part.width_mm}
                            edges={part.band_edges}
                            onEdgesChange={(edges) =>
                              setEdgeOverrides(prev => ({ ...prev, [part.id]: edges }))
                            }
                            trigger={
                              <button type="button" className="cursor-pointer hover:opacity-80 transition-opacity">
                                <EdgeBadges edges={part.band_edges} />
                              </button>
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
