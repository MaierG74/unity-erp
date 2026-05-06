'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { CupboardConfig } from '@/lib/configurator/templates/types';
import { buildCupboardPreviewScene } from '@/lib/configurator/preview/cupboardScene';
import { TechnicalSvgPreview } from './shared/TechnicalSvgPreview';

const CupboardThreePreview = dynamic(
  () => import('./CupboardThreePreview').then((module) => module.CupboardThreePreview),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[420px] items-center justify-center rounded border bg-background text-sm text-muted-foreground">
        Loading 3D preview...
      </div>
    ),
  }
);

interface CupboardPreviewProps {
  config: CupboardConfig;
}

export const CupboardPreview = React.forwardRef<HTMLDivElement, CupboardPreviewProps>(
function CupboardPreview({ config }, ref) {
  const technicalScene = React.useMemo(() => buildCupboardPreviewScene(config), [config]);

  return (
    <Tabs defaultValue="technical" className="w-full">
      <TabsList className="mb-3 h-8 bg-muted/40">
        <TabsTrigger value="technical" className="h-7 px-3 text-xs">
          Technical
        </TabsTrigger>
        <TabsTrigger value="isometric" className="h-7 px-3 text-xs">
          3D
        </TabsTrigger>
      </TabsList>
      <TabsContent value="technical" className="mt-0">
        <TechnicalSvgPreview ref={ref} scene={technicalScene} height={420} />
      </TabsContent>
      <TabsContent value="isometric" className="mt-0">
        <CupboardThreePreview config={config} height={420} />
      </TabsContent>
    </Tabs>
  );
});

CupboardPreview.displayName = 'CupboardPreview';
