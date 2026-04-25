'use client';

import { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useOrgSettings, type CutlistDefaults } from '@/hooks/use-org-settings';
import { useAuth } from '@/components/common/auth-provider';
import { getOrgId } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { isReusableOffcut } from '@/lib/cutlist/offcuts';
import type { GrainOrientation } from '@/lib/cutlist/types';

const GRAIN_OPTIONS: { value: GrainOrientation; icon: string; label: string }[] = [
  { value: 'any', icon: '○', label: 'Any direction' },
  { value: 'length', icon: '↕', label: 'Grain along length' },
  { value: 'width', icon: '↔', label: 'Grain along width' },
];

function nextGrain(current: GrainOrientation): GrainOrientation {
  const order: GrainOrientation[] = ['any', 'length', 'width'];
  return order[(order.indexOf(current) + 1) % order.length];
}

function getGrainOption(value: GrainOrientation) {
  return GRAIN_OPTIONS.find((o) => o.value === value) ?? GRAIN_OPTIONS[0];
}

function asPositiveNumber(value: number | undefined, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function scaleDiagramRect(
  actualW: number,
  actualH: number,
  scale: number,
  minW = 0,
  minH = 0,
) {
  return {
    w: Math.max(minW, Math.round(actualW * scale)),
    h: Math.max(minH, Math.round(actualH * scale)),
  };
}

function OffcutRuleDiagram({ defaults }: { defaults: CutlistDefaults }) {
  const minLength = asPositiveNumber(defaults.minReusableOffcutLengthMm, 300);
  const minWidth = asPositiveNumber(defaults.minReusableOffcutWidthMm, 300);
  const preferred = asPositiveNumber(defaults.preferredOffcutDimensionMm, 300);
  const grain = defaults.minReusableOffcutGrain ?? 'any';
  const grainLegendIcon = grain === 'any' ? '↕  ↔' : getGrainOption(grain).icon;
  const grainLegendLabel = grain === 'any' ? 'either direction' : 'sheet grain';
  const cfg = {
    minUsableLength: minLength,
    minUsableWidth: minWidth,
    minUsableGrain: grain,
  };

  const cleanLength = Math.max(minLength, preferred);
  const cleanWidth = Math.max(minWidth, preferred);
  const narrowWidth = Math.max(60, Math.round(minWidth * 0.55));
  const narrowLength = Math.max(minLength, preferred);
  const topScale = Math.min(132 / Math.max(minWidth, cleanWidth), 164 / Math.max(minLength, cleanLength));
  const narrowScale = Math.min(64 / narrowWidth, 86 / narrowLength, topScale);
  const reusableSize = scaleDiagramRect(minWidth, minLength, topScale, 82, 82);
  const preferredSize = scaleDiagramRect(cleanWidth, cleanLength, topScale, 82, 82);
  const narrowSize = scaleDiagramRect(narrowWidth, narrowLength, narrowScale, 40, 70);
  const sampleRects = [
    { key: 'pass', label: 'Reusable', x: 96, y: 70, w: reusableSize.w, h: reusableSize.h, actualW: minWidth, actualH: minLength, labelOutside: false },
    { key: 'preferred', label: 'Preferred', x: 268, y: 70, w: preferredSize.w, h: preferredSize.h, actualW: cleanWidth, actualH: cleanLength, labelOutside: false },
    { key: 'fail', label: 'Too narrow', x: 96, y: 266, w: narrowSize.w, h: narrowSize.h, actualW: narrowWidth, actualH: narrowLength, labelOutside: true },
  ];
  const classified = sampleRects.map((rect) => ({
    ...rect,
    reusable: isReusableOffcut({ w: rect.actualW, h: rect.actualH }, cfg),
  }));
  const reusableRect = classified[0]!;

  return (
    <div className="max-w-4xl">
      <svg
        viewBox="0 0 700 390"
        role="img"
        aria-label="Reusable offcut rule examples"
        className="w-full rounded-md border border-border bg-slate-950/40"
      >
        <defs>
          {classified.map((rect) => (
            <clipPath key={rect.key} id={`cutlist-grain-${rect.key}`}>
              <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx="4" />
            </clipPath>
          ))}
          <marker id="arrow-teal" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
            <path d="M 0 0 L 8 4 L 0 8 z" fill="rgb(45 212 191)" />
          </marker>
        </defs>

        <rect x="20" y="20" width="440" height="350" rx="6" fill="rgb(2 6 23)" stroke="rgb(71 85 105)" />
        <rect x="34" y="34" width="412" height="320" rx="3" fill="rgb(15 23 42)" opacity="0.55" />

        {classified.map((rect) => (
          <g key={rect.key}>
            <rect
              x={rect.x}
              y={rect.y}
              width={rect.w}
              height={rect.h}
              rx="4"
              fill={rect.key === 'preferred' ? 'rgb(20 184 166)' : rect.reusable ? 'rgb(34 197 94)' : 'rgb(100 116 139)'}
              fillOpacity={rect.key === 'preferred' ? 0.88 : rect.reusable ? 0.88 : 0.92}
              stroke={rect.key === 'preferred' ? 'rgb(45 212 191)' : rect.reusable ? 'rgb(74 222 128)' : 'rgb(148 163 184)'}
              strokeWidth={rect.key === 'preferred' ? 2.5 : 2}
              strokeDasharray={rect.key === 'preferred' ? '7 5' : undefined}
            />
            <g clipPath={`url(#cutlist-grain-${rect.key})`} opacity="0.22" stroke="rgb(226 232 240)" strokeWidth="1" pointerEvents="none">
              {grain !== 'width' && [18, 40, 62, 84, 106, 128, 150].map((offset) => (
                offset < rect.w - 6
                  ? <line key={`v-${offset}`} x1={rect.x + offset} y1={rect.y + 6} x2={rect.x + offset} y2={rect.y + rect.h - 6} />
                  : null
              ))}
              {grain !== 'length' && [18, 40, 62, 84, 106, 128, 150].map((offset) => (
                offset < rect.h - 6
                  ? <line key={`h-${offset}`} x1={rect.x + 6} y1={rect.y + offset} x2={rect.x + rect.w - 6} y2={rect.y + offset} />
                  : null
              ))}
            </g>
            <text x={rect.labelOutside ? rect.x + rect.w + 12 : rect.x + 10} y={rect.y + 24} fill="rgb(226 232 240)" fontSize="15" fontWeight="700">{rect.label}</text>
            <text x={rect.labelOutside ? rect.x + rect.w + 12 : rect.x + 10} y={rect.y + 45} fill="rgb(203 213 225)" fontSize="13">
              {rect.actualH} x {rect.actualW} mm
            </text>
            <text x={rect.labelOutside ? rect.x + rect.w + 12 : rect.x + 10} y={rect.labelOutside ? rect.y + 66 : rect.y + rect.h - 12} fill={rect.reusable ? 'rgb(134 239 172)' : 'rgb(203 213 225)'} fontSize="12">
              {rect.reusable ? 'counts as stock' : 'counts as scrap'}
            </text>
          </g>
        ))}

        <line x1={reusableRect.x} y1="52" x2={reusableRect.x + reusableRect.w} y2="52" stroke="rgb(45 212 191)" strokeWidth="2" markerStart="url(#arrow-teal)" markerEnd="url(#arrow-teal)" />
        <text x={reusableRect.x + reusableRect.w / 2} y="44" fill="rgb(153 246 228)" fontSize="13" textAnchor="middle">Min width {minWidth} mm</text>
        <line x1="56" y1={reusableRect.y} x2="56" y2={reusableRect.y + reusableRect.h} stroke="rgb(45 212 191)" strokeWidth="2" markerStart="url(#arrow-teal)" markerEnd="url(#arrow-teal)" />
        <text x="40" y={reusableRect.y + reusableRect.h / 2 + 22} fill="rgb(153 246 228)" fontSize="13" transform={`rotate(-90 40 ${reusableRect.y + reusableRect.h / 2 + 22})`}>Min length {minLength} mm</text>

        <g>
          <line x1="468" y1="52" x2="468" y2="338" stroke="rgb(71 85 105)" />
          <text x="493" y="62" fill="rgb(226 232 240)" fontSize="17" fontWeight="700">How the rule reads</text>
          <text x="493" y="94" fill="rgb(203 213 225)" fontSize="13">Both minimums are hard gates.</text>
          <text x="493" y="116" fill="rgb(203 213 225)" fontSize="13">Skinny strips stay out of stock.</text>
          <text x="493" y="150" fill="rgb(153 246 228)" fontSize="13">Preferred offcut dimension</text>
          <text x="493" y="170" fill="rgb(203 213 225)" fontSize="13">nudges the optimizer toward</text>
          <text x="493" y="190" fill="rgb(203 213 225)" fontSize="13">cleaner leftovers.</text>
          <text x="493" y="228" fill="rgb(226 232 240)" fontSize="13">Grain: {getGrainOption(grain).label}</text>
          <text x="493" y="263" fill="rgb(148 163 184)" fontSize="22" fontWeight="700">{grainLegendIcon}</text>
          <text x="493" y="288" fill="rgb(148 163 184)" fontSize="12">{grainLegendLabel}</text>
        </g>
      </svg>
    </div>
  );
}

export default function CutlistSettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const orgSettings = useOrgSettings();

  const [defaults, setDefaults] = useState<CutlistDefaults>({});
  const [saving, setSaving] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (!orgSettings.isLoading && !initialized.current) {
      setDefaults(orgSettings.cutlistDefaults);
      initialized.current = true;
    }
  }, [orgSettings.isLoading, orgSettings.cutlistDefaults]);

  const update = (key: keyof CutlistDefaults, value: number | GrainOrientation | undefined) => {
    setDefaults((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    const orgId = getOrgId(user);
    if (!orgId) return;
    setSaving(true);
    const cleaned: CutlistDefaults = {
      minReusableOffcutLengthMm: Number(defaults.minReusableOffcutLengthMm) || 300,
      minReusableOffcutWidthMm: Number(defaults.minReusableOffcutWidthMm) || 300,
      minReusableOffcutGrain: defaults.minReusableOffcutGrain ?? 'any',
      preferredOffcutDimensionMm: Number(defaults.preferredOffcutDimensionMm) || 300,
    };
    const { error } = await supabase
      .from('organizations')
      .update({ cutlist_defaults: cleaned })
      .eq('id', orgId);
    setSaving(false);
    if (error) {
      toast.error('Failed to save cutlist defaults');
    } else {
      toast.success('Cutlist defaults saved');
      queryClient.invalidateQueries({ queryKey: ['org-settings'] });
    }
  };

  const grain = defaults.minReusableOffcutGrain ?? 'any';
  const grainOpt = getGrainOption(grain);

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div>
          <h1 className="text-lg font-semibold">Cutlist Defaults</h1>
          <p className="text-sm text-muted-foreground">
            Organization-wide rules for what counts as a reusable offcut.
          </p>
        </div>

        <div className="space-y-2">
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_auto]">
            <div>
              <label className="block text-sm font-medium mb-1">Minimum length (mm)</label>
              <Input
                type="number"
                min={1}
                placeholder="0"
                value={defaults.minReusableOffcutLengthMm ?? ''}
                onChange={(e) => update('minReusableOffcutLengthMm', e.target.value === '' ? undefined : Number(e.target.value))}
                onBlur={() => { if (!defaults.minReusableOffcutLengthMm) update('minReusableOffcutLengthMm', 300); }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Minimum width (mm)</label>
              <Input
                type="number"
                min={1}
                placeholder="0"
                value={defaults.minReusableOffcutWidthMm ?? ''}
                onChange={(e) => update('minReusableOffcutWidthMm', e.target.value === '' ? undefined : Number(e.target.value))}
                onBlur={() => { if (!defaults.minReusableOffcutWidthMm) update('minReusableOffcutWidthMm', 300); }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Grain</label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="outline" size="sm" onClick={() => update('minReusableOffcutGrain', nextGrain(grain))} className="min-w-12">
                    <span aria-hidden>{grainOpt.icon}</span>
                    <span className="sr-only">{grainOpt.label}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{grainOpt.label}</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            A leftover counts as reusable stock only if it meets both minimums. Pick a grain
            direction to require a specific orientation; leave on Any to accept either.
          </p>
        </div>

        <div className="grid gap-3 grid-cols-1 sm:max-w-xs">
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium mb-1">
              Preferred offcut dimension (mm)
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="What is preferred offcut dimension?">
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs leading-snug">
                  Nudge the optimizer toward larger, cleaner leftover strips. Sizes between the
                  minimum reusable and this value are mildly penalised during packing — a quality
                  preference, not a hard rule.
                </TooltipContent>
              </Tooltip>
            </label>
            <Input
              type="number"
              min={1}
              placeholder="0"
              value={defaults.preferredOffcutDimensionMm ?? ''}
              onChange={(e) => update('preferredOffcutDimensionMm', e.target.value === '' ? undefined : Number(e.target.value))}
              onBlur={() => { if (!defaults.preferredOffcutDimensionMm) update('preferredOffcutDimensionMm', 300); }}
            />
          </div>
        </div>

        <OffcutRuleDiagram defaults={defaults} />

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Cutlist Defaults'}
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}
