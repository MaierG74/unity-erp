'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Save, ArrowRight, Ruler } from 'lucide-react';
import { toast } from 'sonner';
import type { CutlistPart } from '@/lib/cutlist/types';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import type { CupboardConfig } from '@/lib/configurator/templates/types';
import { DEFAULT_CUPBOARD_CONFIG } from '@/lib/configurator/templates/types';
import { generateCupboardParts } from '@/lib/configurator/templates/cupboard';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { CupboardForm } from './CupboardForm';
import { CupboardPreview } from './CupboardPreview';

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

export function FurnitureConfigurator({ productId }: FurnitureConfiguratorProps) {
  const router = useRouter();
  const [config, setConfig] = React.useState<CupboardConfig>(DEFAULT_CUPBOARD_CONFIG);
  const [saving, setSaving] = React.useState(false);

  // Generate parts from config (recomputes on every change)
  const parts = React.useMemo(() => generateCupboardParts(config), [config]);

  // Total part count
  const totalParts = parts.reduce((sum, p) => sum + p.quantity, 0);

  // Save parts to product cutlist groups and optionally navigate to builder
  // Split laminated parts (top/base) into a 32mm-both group, rest into 16mm group
  const saveParts = React.useCallback(
    async (navigateToBuilder: boolean) => {
      setSaving(true);
      try {
        const configLabel = `${config.width} × ${config.height} × ${config.depth}`;
        const laminatedParts = parts.filter((p) => p.lamination_type === 'same-board');
        const standardParts = parts.filter((p) => p.lamination_type !== 'same-board');

        const groups = [];
        if (laminatedParts.length > 0) {
          groups.push({
            name: `Cupboard Laminated (${configLabel})`,
            board_type: '32mm-both' as const,
            parts: laminatedParts,
            sort_order: 0,
          });
        }
        if (standardParts.length > 0) {
          groups.push({
            name: `Cupboard Panels (${configLabel})`,
            board_type: '16mm' as const,
            parts: standardParts,
            sort_order: 1,
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

        if (navigateToBuilder) {
          router.push(`/products/${productId}/cutlist-builder`);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to save parts');
      } finally {
        setSaving(false);
      }
    },
    [config, parts, productId, router]
  );

  return (
    <div className="space-y-6">
      {/* Two-column layout: Form + Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Configuration Form */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Ruler className="h-4 w-4" />
              Configuration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CupboardForm config={config} onChange={setConfig} />
          </CardContent>
        </Card>

        {/* Right: SVG Preview */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <CupboardPreview config={config} />
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => saveParts(false)}
                disabled={saving || parts.length === 0}
                className="gap-1.5"
              >
                <Save className="h-4 w-4" />
                Save to Product
              </Button>
              <Button
                size="sm"
                onClick={() => saveParts(true)}
                disabled={saving || parts.length === 0}
                className="gap-1.5"
              >
                <ArrowRight className="h-4 w-4" />
                Save & Open Cutlist Builder
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {parts.length === 0 ? (
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
                  {parts.map((part) => (
                    <tr key={part.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{part.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{part.length_mm}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{part.width_mm}</td>
                      <td className="px-3 py-2 text-center">{part.quantity}</td>
                      <td className="px-3 py-2 text-center capitalize">{part.grain}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-center">
                          <EdgeBadges edges={part.band_edges} />
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
