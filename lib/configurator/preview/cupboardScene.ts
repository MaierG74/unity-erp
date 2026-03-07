import type { CupboardConfig } from '@/lib/configurator/templates/types';

import {
  createCenteredLabel,
  createHorizontalDimension,
  createVerticalDimension,
  type ConfiguratorPreviewScene,
  type PreviewNode,
  TECHNICAL_PREVIEW_COLORS,
} from './scene';

function rounded(value: number): number {
  return Math.round(value);
}

export function buildCupboardPreviewScene(config: CupboardConfig): ConfiguratorPreviewScene {
  const { width: W, height: H, depth: D, materialThickness: T } = config;
  const {
    shelfCount,
    doorStyle,
    hasBack,
    backMaterialThickness: BT,
    doorGap,
    shelfSetback,
    adjusterHeight,
    topOverhangSides,
    topOverhangBack,
    baseOverhangSides,
    baseOverhangBack,
    backSlotDepth,
    backRecess,
  } = config;

  const T2 = T * 2;
  const carcassWidth = W - Math.max(topOverhangSides, baseOverhangSides) * 2;
  const carcassDepth = D - Math.max(topOverhangBack, baseOverhangBack);
  const sideHeight = H - adjusterHeight - T2 - T2;
  const internalWidth = carcassWidth - T * 2;
  const topWidth = carcassWidth + topOverhangSides * 2;
  const topDepth = carcassDepth + topOverhangBack;
  const baseWidth = carcassWidth + baseOverhangSides * 2;
  const baseDepth = carcassDepth + baseOverhangBack;
  const shelfDepth = carcassDepth - shelfSetback - (hasBack ? BT + backRecess : 0);
  const backWidth = internalWidth;
  const backHeight = sideHeight + backSlotDepth;

  if (sideHeight <= 0 || internalWidth <= 0 || carcassDepth <= T) {
    return {
      width: 840,
      height: 420,
      title: 'Cupboard Technical Preview',
      subtitle: `${W} × ${H} × ${D}mm`,
      exportFileName: `cupboard-${W}x${H}x${D}-technical-preview.svg`,
      backgroundFill: '#ffffff',
      nodes: [
        {
          type: 'text',
          x: 420,
          y: 210,
          text: 'Dimensions too small to generate a valid cupboard preview.',
          fill: TECHNICAL_PREVIEW_COLORS.dimText,
          fontSize: 26,
          fontWeight: 600,
          fontFamily: 'sans-serif',
          textAnchor: 'middle',
          dominantBaseline: 'central',
        },
      ],
    };
  }

  const u = Math.min(W + D + 80, H + D) / 85;
  const margin = u * 10;
  const columnGap = u * 8;
  const rowGap = u * 7;
  const titleOffset = u * 6;
  const smallText = u * 1.7;

  const frontX = margin;
  const frontY = margin + titleOffset;
  const sideX = frontX + W + columnGap;
  const sideY = frontY;
  const topX = sideX + D + columnGap;
  const topY = frontY;

  const explodedScale = Math.min(0.45, (H * 0.46) / Math.max(sideHeight, topWidth));
  const exTopW = topWidth * explodedScale;
  const exTopH = Math.max(T2 * explodedScale, u * 0.6);
  const exBaseW = baseWidth * explodedScale;
  const exBaseH = Math.max(T2 * explodedScale, u * 0.6);
  const exSideW = Math.max(carcassDepth * explodedScale, u * 1.1);
  const exSideH = sideHeight * explodedScale;
  const exShelfW = Math.max(internalWidth * explodedScale, u * 6);
  const exShelfH = Math.max(T * explodedScale, u * 0.55);
  const exBackW = Math.max(backWidth * explodedScale, u * 6);
  const exBackH = backHeight * explodedScale;
  const exDoorW =
    doorStyle === 'double'
      ? Math.max(Math.floor((carcassWidth - doorGap * 3) / 2) * explodedScale, u * 5)
      : Math.max((carcassWidth - doorGap * 2) * explodedScale, u * 5);
  const exDoorH = Math.max((sideHeight - doorGap * 2) * explodedScale, u * 7);
  const explodedWidth = Math.max(exTopW, exBaseW, exSideW * 2 + exShelfW + u * 8, exBackW + u * 10, exDoorW * (doorStyle === 'double' ? 2 : 1) + u * 8) + u * 8;
  const explodedY = topY + D + rowGap + titleOffset;

  const nodes: PreviewNode[] = [];
  const push = (...entries: PreviewNode[]) => {
    nodes.push(...entries);
  };

  const addViewTitle = (x: number, y: number, text: string, viewKey: string) => {
    nodes.push({
      type: 'text',
      x,
      y,
      text,
      fill: TECHNICAL_PREVIEW_COLORS.dimText,
      fontSize: u * 2.8,
      fontWeight: 600,
      fontFamily: 'sans-serif',
      textAnchor: 'middle',
      meta: { viewKey },
    });
  };

  const frontMeta = (partKey?: string, partRole?: string) => ({
    viewKey: 'front',
    partKey,
    partRole,
  });
  const sideMeta = (partKey?: string, partRole?: string) => ({
    viewKey: 'side',
    partKey,
    partRole,
  });
  const topMeta = (partKey?: string, partRole?: string) => ({
    viewKey: 'top',
    partKey,
    partRole,
  });
  const explodedMeta = (partKey?: string, partRole?: string) => ({
    viewKey: 'exploded',
    partKey,
    partRole,
  });

  const topYFront = frontY;
  const topBottomY = frontY + T2;
  const sideBottomY = topBottomY + sideHeight;
  const baseTopY = sideBottomY;
  const baseBottomY = sideBottomY + T2;
  const adjusterBottomY = baseBottomY + adjusterHeight;
  const overhangSides = Math.max(topOverhangSides, baseOverhangSides);
  const sideLeftOuterX = frontX + overhangSides;
  const sideRightOuterX = frontX + W - overhangSides;
  const sideLeftInnerX = sideLeftOuterX + T;
  const sideRightInnerX = sideRightOuterX - T;
  const topLeftX = frontX + overhangSides - topOverhangSides;
  const topRightX = topLeftX + topWidth;
  const baseLeftX = frontX + overhangSides - baseOverhangSides;
  const baseRightX = baseLeftX + baseWidth;
  const shelfPositions: number[] = [];

  if (shelfCount > 0) {
    const interiorTopY = topBottomY;
    const interiorBottomY = sideBottomY;
    const interiorHeight = interiorBottomY - interiorTopY;
    for (let index = 1; index <= shelfCount; index += 1) {
      shelfPositions.push(interiorTopY + (interiorHeight * index) / (shelfCount + 1));
    }
  }

  addViewTitle(frontX + W / 2, frontY - u * 2, 'Front View', 'front');

  nodes.push(
    {
      type: 'rect',
      x: topLeftX,
      y: topYFront,
      width: topWidth,
      height: T2,
      fill: TECHNICAL_PREVIEW_COLORS.topFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.1,
      meta: frontMeta('top', 'top'),
    },
    {
      type: 'line',
      x1: topLeftX,
      y1: topYFront + T,
      x2: topRightX,
      y2: topYFront + T,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.06,
      dashArray: `${u * 0.6},${u * 0.4}`,
      meta: frontMeta('top', 'top'),
    },
    createCenteredLabel({
      x: (topLeftX + topRightX) / 2,
      y: topYFront + T2 / 2,
      text: `Top (${T2}mm)`,
      unit: u,
      meta: frontMeta('top', 'top'),
    }),
    {
      type: 'rect',
      x: sideLeftOuterX,
      y: topBottomY,
      width: T,
      height: sideHeight,
      fill: TECHNICAL_PREVIEW_COLORS.panelFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.1,
      meta: frontMeta('left-side', 'side-left'),
    },
    {
      type: 'rect',
      x: sideRightOuterX - T,
      y: topBottomY,
      width: T,
      height: sideHeight,
      fill: TECHNICAL_PREVIEW_COLORS.panelFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.1,
      meta: frontMeta('right-side', 'side-right'),
    },
    createCenteredLabel({
      x: sideLeftOuterX + T / 2,
      y: topBottomY + sideHeight / 2,
      text: 'L',
      unit: u,
      meta: frontMeta('left-side', 'side-left'),
    }),
    createCenteredLabel({
      x: sideRightOuterX - T / 2,
      y: topBottomY + sideHeight / 2,
      text: 'R',
      unit: u,
      meta: frontMeta('right-side', 'side-right'),
    }),
    {
      type: 'rect',
      x: baseLeftX,
      y: baseTopY,
      width: baseWidth,
      height: T2,
      fill: TECHNICAL_PREVIEW_COLORS.topFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.1,
      meta: frontMeta('base', 'base'),
    },
    {
      type: 'line',
      x1: baseLeftX,
      y1: baseTopY + T,
      x2: baseRightX,
      y2: baseTopY + T,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.06,
      dashArray: `${u * 0.6},${u * 0.4}`,
      meta: frontMeta('base', 'base'),
    },
    createCenteredLabel({
      x: (baseLeftX + baseRightX) / 2,
      y: baseTopY + T2 / 2,
      text: `Base (${T2}mm)`,
      unit: u,
      meta: frontMeta('base', 'base'),
    })
  );

  shelfPositions.forEach((shelfY, index) => {
    nodes.push(
      {
        type: 'rect',
        x: sideLeftInnerX,
        y: shelfY - T / 2,
        width: sideRightInnerX - sideLeftInnerX,
        height: T,
        fill: TECHNICAL_PREVIEW_COLORS.panelFill,
        stroke: TECHNICAL_PREVIEW_COLORS.shelfStroke,
        strokeWidth: u * 0.1,
        dashArray: `${u * 0.4},${u * 0.2}`,
        meta: frontMeta(`shelf-${index + 1}`, 'shelf'),
      },
      createCenteredLabel({
        x: (sideLeftInnerX + sideRightInnerX) / 2,
        y: shelfY,
        text: `S${index + 1}`,
        unit: u,
        meta: frontMeta(`shelf-${index + 1}`, 'shelf'),
      })
    );
  });

  if (doorStyle === 'single') {
    nodes.push({
      type: 'rect',
      x: sideLeftOuterX + doorGap,
      y: topBottomY + doorGap,
      width: carcassWidth - doorGap * 2,
      height: sideHeight - doorGap * 2,
      fill: TECHNICAL_PREVIEW_COLORS.doorFill,
      fillOpacity: 0.4,
      stroke: TECHNICAL_PREVIEW_COLORS.doorStroke,
      strokeWidth: u * 0.15,
      rx: u * 0.25,
      meta: frontMeta('door', 'door'),
    });
  } else if (doorStyle === 'double') {
    const doorWidth = Math.floor((carcassWidth - doorGap * 3) / 2);
    nodes.push(
      {
        type: 'rect',
        x: sideLeftOuterX + doorGap,
        y: topBottomY + doorGap,
        width: doorWidth,
        height: sideHeight - doorGap * 2,
        fill: TECHNICAL_PREVIEW_COLORS.doorFill,
        fillOpacity: 0.4,
        stroke: TECHNICAL_PREVIEW_COLORS.doorStroke,
        strokeWidth: u * 0.15,
        rx: u * 0.25,
        meta: frontMeta('door-left', 'door-left'),
      },
      {
        type: 'rect',
        x: sideLeftOuterX + doorGap * 2 + doorWidth,
        y: topBottomY + doorGap,
        width: doorWidth,
        height: sideHeight - doorGap * 2,
        fill: TECHNICAL_PREVIEW_COLORS.doorFill,
        fillOpacity: 0.4,
        stroke: TECHNICAL_PREVIEW_COLORS.doorStroke,
        strokeWidth: u * 0.15,
        rx: u * 0.25,
        meta: frontMeta('door-right', 'door-right'),
      }
    );
  }

  if (adjusterHeight > 0) {
    nodes.push(
      {
        type: 'rect',
        x: sideLeftOuterX + 5,
        y: baseBottomY,
        width: 8,
        height: adjusterHeight,
        fill: TECHNICAL_PREVIEW_COLORS.adjusterFill,
        rx: 1,
        meta: frontMeta('adjuster-left', 'adjuster'),
      },
      {
        type: 'rect',
        x: sideRightOuterX - 13,
        y: baseBottomY,
        width: 8,
        height: adjusterHeight,
        fill: TECHNICAL_PREVIEW_COLORS.adjusterFill,
        rx: 1,
        meta: frontMeta('adjuster-right', 'adjuster'),
      }
    );
  }

  push(
    ...createHorizontalDimension({
      x1: frontX,
      x2: frontX + W,
      y: adjusterBottomY + u,
      label: `${rounded(W)}`,
      side: 'below',
      unit: u,
      meta: frontMeta(undefined, 'dimension'),
    }),
    ...createVerticalDimension({
      y1: topYFront,
      y2: adjusterBottomY,
      x: frontX - u,
      label: `${rounded(H)}`,
      side: 'left',
      unit: u,
      meta: frontMeta(undefined, 'dimension'),
    }),
    ...createHorizontalDimension({
      x1: sideLeftOuterX,
      x2: sideRightOuterX,
      y: topYFront - u,
      label: `${rounded(carcassWidth)} (carcass)`,
      side: 'above',
      unit: u,
      meta: frontMeta(undefined, 'dimension'),
    })
  );

  addViewTitle(sideX + D / 2, sideY - u * 2, 'Side View', 'side');

  nodes.push(
    {
      type: 'rect',
      x: sideX,
      y: sideY,
      width: topDepth,
      height: T2,
      fill: TECHNICAL_PREVIEW_COLORS.topFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.1,
      meta: sideMeta('top', 'top'),
    },
    {
      type: 'line',
      x1: sideX,
      y1: sideY + T,
      x2: sideX + topDepth,
      y2: sideY + T,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.06,
      dashArray: `${u * 0.6},${u * 0.4}`,
      meta: sideMeta('top', 'top'),
    },
    createCenteredLabel({
      x: sideX + topDepth / 2,
      y: sideY + T,
      text: `Top ${T2}mm`,
      unit: u,
      meta: sideMeta('top', 'top'),
    }),
    {
      type: 'rect',
      x: sideX,
      y: sideY + T2,
      width: carcassDepth,
      height: sideHeight,
      fill: TECHNICAL_PREVIEW_COLORS.panelFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.1,
      meta: sideMeta('side-section', 'side'),
    },
    {
      type: 'rect',
      x: sideX,
      y: sideY + T2 + sideHeight,
      width: baseDepth,
      height: T2,
      fill: TECHNICAL_PREVIEW_COLORS.topFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.1,
      meta: sideMeta('base', 'base'),
    },
    {
      type: 'line',
      x1: sideX,
      y1: sideY + T2 + sideHeight + T,
      x2: sideX + baseDepth,
      y2: sideY + T2 + sideHeight + T,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.06,
      dashArray: `${u * 0.6},${u * 0.4}`,
      meta: sideMeta('base', 'base'),
    }
  );

  if (hasBack) {
    nodes.push({
      type: 'rect',
      x: sideX + carcassDepth - backRecess - Math.max(BT, 1),
      y: sideY + T2,
      width: Math.max(BT, 1),
      height: sideHeight + backSlotDepth,
      fill: TECHNICAL_PREVIEW_COLORS.backFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.1,
      meta: sideMeta('back', 'back'),
    });
  }

  shelfPositions.forEach((shelfY, index) => {
    nodes.push({
      type: 'rect',
      x: sideX,
      y: shelfY - T / 2,
      width: carcassDepth - (hasBack ? BT + backRecess : 0) - shelfSetback,
      height: T,
      fill: TECHNICAL_PREVIEW_COLORS.panelFill,
      stroke: TECHNICAL_PREVIEW_COLORS.shelfStroke,
      strokeWidth: u * 0.1,
      dashArray: `${u * 0.4},${u * 0.2}`,
      meta: sideMeta(`shelf-${index + 1}`, 'shelf'),
    });
  });

  if (adjusterHeight > 0) {
    nodes.push(
      {
        type: 'rect',
        x: sideX + 5,
        y: sideY + H - adjusterHeight,
        width: 8,
        height: adjusterHeight,
        fill: TECHNICAL_PREVIEW_COLORS.adjusterFill,
        rx: 1,
        meta: sideMeta('adjuster-left', 'adjuster'),
      },
      {
        type: 'rect',
        x: sideX + carcassDepth - 13,
        y: sideY + H - adjusterHeight,
        width: 8,
        height: adjusterHeight,
        fill: TECHNICAL_PREVIEW_COLORS.adjusterFill,
        rx: 1,
        meta: sideMeta('adjuster-right', 'adjuster'),
      }
    );
  }

  push(
    ...createHorizontalDimension({
      x1: sideX,
      x2: sideX + D,
      y: sideY + H + u,
      label: `${rounded(D)}`,
      side: 'below',
      unit: u,
      meta: sideMeta(undefined, 'dimension'),
    }),
    ...createVerticalDimension({
      y1: sideY,
      y2: sideY + H,
      x: sideX + D + u,
      label: `${rounded(H)}`,
      side: 'right',
      unit: u,
      meta: sideMeta(undefined, 'dimension'),
    })
  );

  addViewTitle(topX + W / 2, topY - u * 2, 'Top View', 'top');

  const topOuterY = topY;
  const topInnerY = topOuterY + topOverhangBack;
  const topInnerDepth = carcassDepth;
  const backStripY = topInnerY + carcassDepth - backRecess - Math.max(BT, 1);
  const sidePlanLeftX = topX + topOverhangSides;
  const sidePlanRightX = topX + topOverhangSides + carcassWidth - T;

  nodes.push(
    {
      type: 'rect',
      x: topX,
      y: topOuterY,
      width: topWidth,
      height: topDepth,
      fill: TECHNICAL_PREVIEW_COLORS.topFill,
      fillOpacity: 0.45,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.1,
      meta: topMeta('top', 'top'),
    },
    {
      type: 'rect',
      x: topX + topOverhangSides,
      y: topY + topOverhangBack,
      width: carcassWidth,
      height: topInnerDepth,
      fill: 'none',
      stroke: TECHNICAL_PREVIEW_COLORS.guideStroke,
      strokeWidth: u * 0.08,
      dashArray: `${u * 0.5},${u * 0.35}`,
      meta: topMeta(undefined, 'guide'),
    },
    {
      type: 'rect',
      x: sidePlanLeftX,
      y: topInnerY,
      width: T,
      height: topInnerDepth,
      fill: TECHNICAL_PREVIEW_COLORS.panelFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.08,
      meta: topMeta('left-side', 'side-left'),
    },
    {
      type: 'rect',
      x: sidePlanRightX,
      y: topInnerY,
      width: T,
      height: topInnerDepth,
      fill: TECHNICAL_PREVIEW_COLORS.panelFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.08,
      meta: topMeta('right-side', 'side-right'),
    }
  );

  if (hasBack) {
    nodes.push({
      type: 'rect',
      x: topX + topOverhangSides + T,
      y: backStripY,
      width: internalWidth,
      height: Math.max(BT, 1),
      fill: TECHNICAL_PREVIEW_COLORS.backFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.08,
      meta: topMeta('back', 'back'),
    });
  }

  nodes.push(
    createCenteredLabel({
      x: topX + topWidth / 2,
      y: topY + topDepth + u * 2.2,
      text: 'Front',
      unit: u,
      fill: TECHNICAL_PREVIEW_COLORS.dimText,
      fontWeight: 600,
      meta: topMeta(undefined, 'note'),
    })
  );

  push(
    ...createHorizontalDimension({
      x1: topX,
      x2: topX + topWidth,
      y: topY - u,
      label: `${rounded(topWidth)} (top)`,
      side: 'above',
      unit: u,
      meta: topMeta(undefined, 'dimension'),
    }),
    ...createVerticalDimension({
      y1: topY,
      y2: topY + topDepth,
      x: topX + topWidth + u,
      label: `${rounded(topDepth)} (depth)`,
      side: 'right',
      unit: u,
      meta: topMeta(undefined, 'dimension'),
    })
  );

  addViewTitle(topX + explodedWidth / 2, explodedY - u * 2, 'Exploded Assembly', 'exploded');

  const exOriginX = topX;
  const exOriginY = explodedY;
  const exTopX = exOriginX + (explodedWidth - exTopW) / 2;
  const exTopY = exOriginY + u * 4;
  const exSideTopY = exTopY + exTopH + u * 5;
  const exLeftSideX = exOriginX + u * 2;
  const exRightSideX = exOriginX + explodedWidth - u * 2 - exSideW;
  const exBackX = exOriginX + (explodedWidth - exBackW) / 2;
  const exBackY = exSideTopY - u * 1.5;
  const exShelfX = exOriginX + (explodedWidth - exShelfW) / 2;
  const exBaseY = exSideTopY + exSideH + u * 6;
  const exBaseX = exOriginX + (explodedWidth - exBaseW) / 2;
  const shelfCountForSketch = Math.max(1, Math.min(shelfCount, 3));

  nodes.push(
    {
      type: 'rect',
      x: exBackX,
      y: exBackY,
      width: exBackW,
      height: exBackH,
      fill: TECHNICAL_PREVIEW_COLORS.backFill,
      fillOpacity: 0.55,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.08,
      dashArray: `${u * 0.45},${u * 0.35}`,
      meta: explodedMeta('back', 'back'),
    },
    {
      type: 'rect',
      x: exTopX,
      y: exTopY,
      width: exTopW,
      height: exTopH,
      fill: TECHNICAL_PREVIEW_COLORS.topFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.08,
      meta: explodedMeta('top', 'top'),
    },
    {
      type: 'rect',
      x: exLeftSideX,
      y: exSideTopY,
      width: exSideW,
      height: exSideH,
      fill: TECHNICAL_PREVIEW_COLORS.panelFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.08,
      meta: explodedMeta('left-side', 'side-left'),
    },
    {
      type: 'rect',
      x: exRightSideX,
      y: exSideTopY,
      width: exSideW,
      height: exSideH,
      fill: TECHNICAL_PREVIEW_COLORS.panelFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.08,
      meta: explodedMeta('right-side', 'side-right'),
    },
    {
      type: 'rect',
      x: exBaseX,
      y: exBaseY,
      width: exBaseW,
      height: exBaseH,
      fill: TECHNICAL_PREVIEW_COLORS.topFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.08,
      meta: explodedMeta('base', 'base'),
    }
  );

  for (let index = 0; index < shelfCountForSketch; index += 1) {
    const shelfY = exSideTopY + u * 4 + index * (u * 4.4);
    nodes.push({
      type: 'rect',
      x: exShelfX,
      y: shelfY,
      width: exShelfW,
      height: exShelfH,
      fill: TECHNICAL_PREVIEW_COLORS.panelFill,
      stroke: TECHNICAL_PREVIEW_COLORS.shelfStroke,
      strokeWidth: u * 0.08,
      dashArray: `${u * 0.4},${u * 0.25}`,
      meta: explodedMeta(`shelf-${index + 1}`, 'shelf'),
    });
  }

  if (doorStyle !== 'none') {
    const exDoorY = exSideTopY + u * 4;
    const singleDoorX =
      doorStyle === 'double' ? exOriginX + (explodedWidth - exDoorW * 2 - u * 2) / 2 : exOriginX + (explodedWidth - exDoorW) / 2;

    nodes.push({
      type: 'rect',
      x: singleDoorX,
      y: exDoorY,
      width: exDoorW,
      height: exDoorH,
      fill: TECHNICAL_PREVIEW_COLORS.doorFill,
      fillOpacity: 0.45,
      stroke: TECHNICAL_PREVIEW_COLORS.doorStroke,
      strokeWidth: u * 0.1,
      rx: u * 0.25,
      meta: explodedMeta(doorStyle === 'double' ? 'door-left' : 'door', doorStyle === 'double' ? 'door-left' : 'door'),
    });

    if (doorStyle === 'double') {
      nodes.push({
        type: 'rect',
        x: singleDoorX + exDoorW + u * 2,
        y: exDoorY,
        width: exDoorW,
        height: exDoorH,
        fill: TECHNICAL_PREVIEW_COLORS.doorFill,
        fillOpacity: 0.45,
        stroke: TECHNICAL_PREVIEW_COLORS.doorStroke,
        strokeWidth: u * 0.1,
        rx: u * 0.25,
        meta: explodedMeta('door-right', 'door-right'),
      });
    }
  }

  const callout = (text: string, x: number, y: number, partKey: string, partRole: string) => {
    nodes.push(
      {
        type: 'rect',
        x: x - u * 2.2,
        y: y - u * 1.45,
        width: u * 4.4,
        height: u * 2.9,
        fill: TECHNICAL_PREVIEW_COLORS.explodedNoteFill,
        stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
        strokeWidth: u * 0.08,
        rx: u * 0.4,
        meta: explodedMeta(partKey, partRole),
      },
      createCenteredLabel({
        x,
        y,
        text,
        unit: u * 0.7,
        fill: TECHNICAL_PREVIEW_COLORS.dimText,
        meta: explodedMeta(partKey, partRole),
      })
    );
  };

  callout('Top', exTopX + exTopW / 2, exTopY - u * 1.8, 'top', 'top');
  callout('L Side', exLeftSideX + exSideW / 2, exSideTopY + exSideH / 2, 'left-side', 'side-left');
  callout('R Side', exRightSideX + exSideW / 2, exSideTopY + exSideH / 2, 'right-side', 'side-right');
  callout('Base', exBaseX + exBaseW / 2, exBaseY + exBaseH + u * 2, 'base', 'base');
  if (hasBack) {
    callout('Back', exBackX + exBackW / 2, exBackY + exBackH / 2, 'back', 'back');
  }
  if (shelfCount > 0) {
    callout(
      shelfCount === 1 ? 'Shelf' : `${shelfCount} Shelves`,
      exShelfX + exShelfW / 2,
      exSideTopY + u * 1.7,
      'shelf',
      'shelf'
    );
  }

  const sceneWidth = topX + Math.max(topWidth, explodedWidth) + margin;
  const sceneHeight = Math.max(frontY + H + margin, exBaseY + exBaseH + u * 5 + margin);

  return {
    width: sceneWidth,
    height: sceneHeight,
    title: 'Cupboard Technical Preview',
    subtitle: `${W} × ${H} × ${D}mm`,
    exportFileName: `cupboard-${W}x${H}x${D}-technical-preview.svg`,
    backgroundFill: '#ffffff',
    nodes,
  };
}
