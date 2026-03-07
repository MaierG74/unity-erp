'use client';

import * as React from 'react';

import type { CupboardConfig } from '@/lib/configurator/templates/types';
import { buildCupboardPreviewScene } from '@/lib/configurator/preview/cupboardScene';
import { TechnicalSvgPreview } from './shared/TechnicalSvgPreview';

interface CupboardPreviewProps {
  config: CupboardConfig;
}

export function CupboardPreview({ config }: CupboardPreviewProps) {
  const scene = React.useMemo(() => buildCupboardPreviewScene(config), [config]);

  return <TechnicalSvgPreview scene={scene} height={420} />;
}
