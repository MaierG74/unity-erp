import type { CupboardConfig } from '@/lib/configurator/templates/types';
import { deriveCupboardGeometry } from '@/lib/configurator/templates/cupboardGeometry';

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
    topConstruction,
    baseConstruction,
    shelfCount,
    doorStyle,
    hasBack,
    backMaterialThickness: BT,
    doorGap,
    shelfSetback,
    adjusterHeight,
    topOverhangSides,
    topOverhangFront,
    topOverhangBack,
    baseOverhangSides,
    baseOverhangFront,
    baseOverhangBack,
    backSlotDepth,
    backRecess,
  } = config;
  const {
    valid,
    carcassWidth,
    carcassDepth,
    sideHeight,
    internalWidth,
    topWidth,
    topDepth,
    baseWidth,
    baseDepth,
    shelfDepth,
    topThickness,
    baseThickness,
    baseCleatWidth,
  } = deriveCupboardGeometry(config);
  const backThickness = Math.max(BT, 1);
  const topBreakY = topThickness > T ? T : null;
  const baseBreakY = baseThickness > T ? T : null;
  const topLabel = `Top (${rounded(topThickness)}mm)`;
  const baseLabel =
    baseConstruction === 'cleated'
      ? `Base (${rounded(baseThickness)}mm cleated)`
      : `Base (${rounded(baseThickness)}mm)`;
  const sideTopLabel = `Top ${rounded(topThickness)}mm`;

  if (!valid) {
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
  const smallText = u * 1.15;

  const frontX = margin;
  const frontY = margin + titleOffset;
  const sideX = frontX + W + columnGap;
  const sideY = frontY;
  const topX = sideX + D + columnGap;
  const topY = frontY;

  const explodedWidth = Math.max(topWidth, u * 60);
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

  const addNoteText = (
    x: number,
    y: number,
    text: string,
    viewKey: string,
    fontWeight: number | string = 500,
    fontSize: number = smallText
  ) => {
    nodes.push({
      type: 'text',
      x,
      y,
      text,
      fill: TECHNICAL_PREVIEW_COLORS.dimText,
      fontSize,
      fontWeight,
      fontFamily: 'sans-serif',
      textAnchor: 'start',
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
  const topBottomY = frontY + topThickness;
  const sideBottomY = topBottomY + sideHeight;
  const baseTopY = sideBottomY;
  const baseBottomY = sideBottomY + baseThickness;
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
  const overhangFront = Math.max(topOverhangFront, baseOverhangFront);
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
      height: topThickness,
      fill: TECHNICAL_PREVIEW_COLORS.topFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.1,
      meta: frontMeta('top', 'top'),
    },
    createCenteredLabel({
      x: (topLeftX + topRightX) / 2,
      y: topYFront + topThickness / 2,
      text: topLabel,
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
      height: baseThickness,
      fill: TECHNICAL_PREVIEW_COLORS.topFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.1,
      meta: frontMeta('base', 'base'),
    },
    createCenteredLabel({
      x: (baseLeftX + baseRightX) / 2,
      y: baseTopY + baseThickness / 2,
      text: baseLabel,
      unit: u,
      meta: frontMeta('base', 'base'),
    })
  );

  if (topBreakY !== null) {
    nodes.push({
      type: 'line',
      x1: topLeftX,
      y1: topYFront + topBreakY,
      x2: topRightX,
      y2: topYFront + topBreakY,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.06,
      dashArray: `${u * 0.6},${u * 0.4}`,
      meta: frontMeta('top', 'top'),
    });
  }

  if (baseBreakY !== null) {
    nodes.push({
      type: 'line',
      x1: baseLeftX,
      y1: baseTopY + baseBreakY,
      x2: baseRightX,
      y2: baseTopY + baseBreakY,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.06,
      dashArray: `${u * 0.6},${u * 0.4}`,
      meta: frontMeta('base', 'base'),
    });
  }

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

  const sideCarcassX = sideX + overhangFront;
  const sideTopX = sideX + overhangFront - topOverhangFront;
  const sideBaseX = sideX + overhangFront - baseOverhangFront;

  nodes.push(
    {
      type: 'rect',
      x: sideTopX,
      y: sideY,
      width: topDepth,
      height: topThickness,
      fill: TECHNICAL_PREVIEW_COLORS.topFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.1,
      meta: sideMeta('top', 'top'),
    },
    createCenteredLabel({
      x: sideTopX + topDepth / 2,
      y: sideY + topThickness / 2,
      text: sideTopLabel,
      unit: u,
      meta: sideMeta('top', 'top'),
    }),
    {
      type: 'rect',
      x: sideCarcassX,
      y: sideY + topThickness,
      width: carcassDepth,
      height: sideHeight,
      fill: TECHNICAL_PREVIEW_COLORS.panelFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.1,
      meta: sideMeta('side-section', 'side'),
    },
    {
      type: 'rect',
      x: sideBaseX,
      y: sideY + topThickness + sideHeight,
      width: baseDepth,
      height: baseThickness,
      fill: TECHNICAL_PREVIEW_COLORS.topFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.1,
      meta: sideMeta('base', 'base'),
    }
  );

  if (topBreakY !== null) {
    nodes.push({
      type: 'line',
      x1: sideTopX,
      y1: sideY + topBreakY,
      x2: sideTopX + topDepth,
      y2: sideY + topBreakY,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.06,
      dashArray: `${u * 0.6},${u * 0.4}`,
      meta: sideMeta('top', 'top'),
    });
  }

  if (baseBreakY !== null) {
    nodes.push({
      type: 'line',
      x1: sideBaseX,
      y1: sideY + topThickness + sideHeight + baseBreakY,
      x2: sideBaseX + baseDepth,
      y2: sideY + topThickness + sideHeight + baseBreakY,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.06,
      dashArray: `${u * 0.6},${u * 0.4}`,
      meta: sideMeta('base', 'base'),
    });
  }

  if (hasBack) {
    nodes.push({
      type: 'rect',
      x: sideCarcassX + carcassDepth - backRecess - Math.max(BT, 1),
      y: sideY + topThickness,
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
      x: sideCarcassX,
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
        x: sideCarcassX + 5,
        y: sideY + H - adjusterHeight,
        width: 8,
        height: adjusterHeight,
        fill: TECHNICAL_PREVIEW_COLORS.adjusterFill,
        rx: 1,
        meta: sideMeta('adjuster-left', 'adjuster'),
      },
      {
        type: 'rect',
        x: sideCarcassX + carcassDepth - 13,
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
  const backStripY = topInnerY + backRecess;
  const sidePlanLeftX = topX + topOverhangSides;
  const sidePlanRightX = topX + topOverhangSides + carcassWidth - T;
  const topBackLabelY =
    backThickness >= u * 1.15 ? backStripY + backThickness / 2 : backStripY + backThickness + u * 0.7;

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
    nodes.push(
      {
        type: 'rect',
        x: topX + topOverhangSides + T,
        y: backStripY,
        width: internalWidth,
        height: backThickness,
        fill: '#cbd5e1',
        fillOpacity: 0.95,
        stroke: TECHNICAL_PREVIEW_COLORS.labelColor,
        strokeWidth: u * 0.1,
        meta: topMeta('back', 'back'),
      },
      {
        type: 'text',
        x: topX + topWidth / 2,
        y: topBackLabelY,
        text: `Back ${rounded(BT)}mm`,
        fill: TECHNICAL_PREVIEW_COLORS.labelColor,
        fontSize: smallText * 0.95,
        fontWeight: 600,
        fontFamily: 'sans-serif',
        textAnchor: 'middle',
        dominantBaseline: backThickness >= u * 1.15 ? 'central' : 'hanging',
        meta: topMeta('back', 'back'),
      }
    );
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

  addViewTitle(topX + explodedWidth / 2, explodedY - u * 2, 'Assembly Details', 'exploded');

  const exOriginX = topX;
  const exOriginY = explodedY;
  const assemblyBoxX = exOriginX + u * 1.4;
  const assemblyBoxY = exOriginY + u * 2.2;
  const assemblyBoxW = explodedWidth - u * 2.8;
  const stepColumnW = assemblyBoxW * 0.43;
  const diagramColumnX = assemblyBoxX + stepColumnW + u * 2.4;
  const diagramColumnW = assemblyBoxW - stepColumnW - u * 3.6;
  const orderScale = Math.min(0.29, (diagramColumnW - u * 3.2) / W, (u * 22.5) / sideHeight);
  const orderTopH = Math.max(topThickness * orderScale, u * 0.72);
  const orderBaseH = Math.max(baseThickness * orderScale, u * 0.72);
  const orderSideH = sideHeight * orderScale;
  const assemblyBoxH = Math.max(u * 26.5, orderTopH + orderSideH + orderBaseH + u * 11);
  const orderTitleY = assemblyBoxY + u * 2.1;
  const orderStepFont = smallText * 1.05;
  const orderNoteFont = smallText;
  const orderLineHeight = orderStepFont * 1.55;
  const sideOverhangNote =
    topOverhangSides === baseOverhangSides
      ? `Side OH: ${rounded(topOverhangSides)}mm each side`
      : `Side overhangs: top ${rounded(topOverhangSides)} / base ${rounded(baseOverhangSides)}mm`;
  const frontOverhangNote =
    topOverhangFront === baseOverhangFront
      ? `Front OH: ${rounded(topOverhangFront)}mm`
      : `Front overhangs: top ${rounded(topOverhangFront)} / base ${rounded(baseOverhangFront)}mm`;
  const rearSideOverhangNote =
    topOverhangSides === baseOverhangSides
      ? `Side OH: ${rounded(topOverhangSides)}mm each side`
      : `Side OH: top ${rounded(topOverhangSides)} / base ${rounded(baseOverhangSides)}mm`;

  nodes.push(
    {
      type: 'rect',
      x: assemblyBoxX,
      y: assemblyBoxY,
      width: assemblyBoxW,
      height: assemblyBoxH,
      fill: TECHNICAL_PREVIEW_COLORS.explodedNoteFill,
      fillOpacity: 0.55,
      stroke: TECHNICAL_PREVIEW_COLORS.guideStroke,
      strokeWidth: u * 0.08,
      rx: u * 0.45,
      meta: explodedMeta(undefined, 'panel'),
    },
    {
      type: 'line',
      x1: diagramColumnX - u * 1.2,
      y1: assemblyBoxY + u * 1.6,
      x2: diagramColumnX - u * 1.2,
      y2: assemblyBoxY + assemblyBoxH - u * 1.6,
      stroke: TECHNICAL_PREVIEW_COLORS.guideStroke,
      strokeWidth: u * 0.06,
      dashArray: `${u * 0.45},${u * 0.35}`,
      meta: explodedMeta(undefined, 'guide'),
    },
    {
      type: 'text',
      x: assemblyBoxX + u * 2,
      y: orderTitleY,
      text: 'Assembly Order',
      fill: TECHNICAL_PREVIEW_COLORS.dimText,
      fontSize: u * 1.55,
      fontWeight: 600,
      fontFamily: 'sans-serif',
      textAnchor: 'start',
      meta: explodedMeta(undefined, 'note'),
    }
  );

  const assemblySteps = [
    baseConstruction === 'cleated' ? '1. Cleated base on adjusters' : '1. Base on adjusters',
    '2. Sides onto base',
    shelfCount > 0
      ? `3. ${shelfCount} ${shelfCount === 1 ? 'shelf' : 'shelves'} between sides`
      : '3. Open carcass',
    hasBack ? `4. ${rounded(BT)}mm back from rear onto base` : '4. No back panel',
    hasBack ? `5. Top down, capture ${rounded(backSlotDepth)}mm` : '5. Top closes carcass',
  ];

  assemblySteps.forEach((step, index) => {
    addNoteText(
      assemblyBoxX + u * 2,
      orderTitleY + u * 2.7 + index * orderLineHeight,
      step,
      'exploded',
      500,
      orderStepFont
    );
  });

  addNoteText(
    assemblyBoxX + u * 2,
    orderTitleY + u * 2.7 + assemblySteps.length * orderLineHeight + u * 1,
    sideOverhangNote,
    'exploded',
    600,
    orderNoteFont
  );
  addNoteText(
    assemblyBoxX + u * 2,
    orderTitleY + u * 2.7 + assemblySteps.length * orderLineHeight + u * 2.3,
    frontOverhangNote,
    'exploded',
    600,
    orderNoteFont
  );

  if (doorStyle !== 'none') {
    addNoteText(
      assemblyBoxX + u * 2,
      orderTitleY + u * 2.7 + assemblySteps.length * orderLineHeight + u * 4.2,
      `${doorStyle === 'double' ? 'Doors' : 'Door'} install${doorStyle === 'double' ? '' : 's'} after carcass assembly`,
      'exploded',
      500,
      orderNoteFont
    );
  }

  if (baseConstruction === 'cleated') {
    addNoteText(
      assemblyBoxX + u * 2,
      orderTitleY +
        u * 2.7 +
        assemblySteps.length * orderLineHeight +
        (doorStyle !== 'none' ? u * 5.6 : u * 4.2),
      `Base build: 16mm panel + ${rounded(baseCleatWidth)}mm underside cleats`,
      'exploded',
      500,
      orderNoteFont
    );
  }

  addNoteText(
    assemblyBoxX + u * 2,
    orderTitleY +
      u * 2.7 +
      assemblySteps.length * orderLineHeight +
      (doorStyle !== 'none'
        ? baseConstruction === 'cleated'
          ? u * 7
          : u * 5.6
        : baseConstruction === 'cleated'
          ? u * 5.6
          : u * 4.2),
    `Top build: ${topConstruction === 'single' ? `${rounded(topThickness)}mm single` : `${rounded(topThickness)}mm laminated`}`,
    'exploded',
    500,
    orderNoteFont
  );

  const orderOverallWidth = W * orderScale;
  const orderDiagramX = diagramColumnX + (diagramColumnW - orderOverallWidth) / 2;
  const orderTopY = assemblyBoxY + u * 4.7;
  const orderTopBottomY = orderTopY + orderTopH;
  const orderSideTopY = orderTopBottomY + u * 2.2;
  const orderSideBottomY = orderSideTopY + orderSideH;
  const orderBaseY = orderSideBottomY;
  const orderBaseBottomY = orderBaseY + orderBaseH;
  const orderOverhangSides = Math.max(topOverhangSides, baseOverhangSides) * orderScale;
  const orderTopX =
    orderDiagramX + (Math.max(topOverhangSides, baseOverhangSides) - topOverhangSides) * orderScale;
  const orderBaseX =
    orderDiagramX + (Math.max(topOverhangSides, baseOverhangSides) - baseOverhangSides) * orderScale;
  const orderSideWidth = Math.max(T * orderScale, u * 0.45);
  const orderSideLeftX = orderDiagramX + orderOverhangSides;
  const orderSideRightX = orderDiagramX + orderOverallWidth - orderOverhangSides - orderSideWidth;
  const orderInteriorLeftX = orderSideLeftX + orderSideWidth;
  const orderInteriorRightX = orderSideRightX;

  nodes.push(
    {
      type: 'rect',
      x: orderTopX,
      y: orderTopY,
      width: topWidth * orderScale,
      height: orderTopH,
      fill: TECHNICAL_PREVIEW_COLORS.topFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.08,
      meta: explodedMeta('top', 'top'),
    },
    {
      type: 'line',
      x1: orderDiagramX + orderOverallWidth / 2,
      y1: orderTopBottomY + u * 0.35,
      x2: orderDiagramX + orderOverallWidth / 2,
      y2: orderSideTopY - u * 0.45,
      stroke: TECHNICAL_PREVIEW_COLORS.dimColor,
      strokeWidth: u * 0.09,
      markerEnd: 'arrow',
      meta: explodedMeta('top', 'top'),
    },
    {
      type: 'rect',
      x: orderSideLeftX,
      y: orderSideTopY,
      width: orderSideWidth,
      height: orderSideH,
      fill: TECHNICAL_PREVIEW_COLORS.panelFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.08,
      meta: explodedMeta('left-side', 'side-left'),
    },
    {
      type: 'rect',
      x: orderSideRightX,
      y: orderSideTopY,
      width: orderSideWidth,
      height: orderSideH,
      fill: TECHNICAL_PREVIEW_COLORS.panelFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.08,
      meta: explodedMeta('right-side', 'side-right'),
    },
    {
      type: 'rect',
      x: orderBaseX,
      y: orderBaseY,
      width: baseWidth * orderScale,
      height: orderBaseH,
      fill: TECHNICAL_PREVIEW_COLORS.topFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.08,
      meta: explodedMeta('base', 'base'),
    }
  );

  if (shelfCount > 0) {
    for (let index = 1; index <= shelfCount; index += 1) {
      const shelfY = orderSideTopY + (sideHeight * index) / (shelfCount + 1) * orderScale - Math.max(T * orderScale, u * 0.4) / 2;
      nodes.push({
        type: 'rect',
        x: orderInteriorLeftX,
        y: shelfY,
        width: orderInteriorRightX - orderInteriorLeftX,
        height: Math.max(T * orderScale, u * 0.4),
        fill: TECHNICAL_PREVIEW_COLORS.panelFill,
        stroke: TECHNICAL_PREVIEW_COLORS.shelfStroke,
        strokeWidth: u * 0.08,
        dashArray: `${u * 0.35},${u * 0.24}`,
        meta: explodedMeta(`shelf-${index}`, 'shelf'),
      });
    }
  }

  nodes.push(
    createCenteredLabel({
      x: orderDiagramX + orderOverallWidth / 2,
      y: orderBaseBottomY + u * 1.9,
      text: hasBack ? 'Top/rear join shown below' : 'Open carcass view',
      unit: u * 0.7,
      fill: TECHNICAL_PREVIEW_COLORS.dimText,
      meta: explodedMeta(undefined, 'note'),
    })
  );

  const detailBoxX = assemblyBoxX;
  const detailBoxY = assemblyBoxY + assemblyBoxH + u * 2.8;
  const detailBoxW = assemblyBoxW;
  const detailBoxH = u * 19.5;
  const detailTitleY = detailBoxY + u * 2.1;
  const detailDiagramW = detailBoxW * 0.64;
  const detailNotesX = detailBoxX + detailDiagramW + u * 3;
  const detailNoteFont = smallText * 1.02;
  const rearVisibleFront = Math.max(24, backRecess + backThickness + shelfSetback + 22);
  const rearStartMm = -rearVisibleFront;
  const rearEndMm = Math.max(topOverhangBack, 8) + 8;
  const detailScaleX = (detailDiagramW - u * 5) / Math.max(1, rearEndMm - rearStartMm);
  const detailVisibleDropMm = Math.max(70, shelfSetback + backThickness + 40);
  const detailScaleY = Math.max(
    1.5,
    Math.min(2.8, (detailBoxH - u * 8) / Math.max(1, topThickness + backSlotDepth + detailVisibleDropMm))
  );
  const detailToX = (mm: number) => detailBoxX + u * 2.4 + (mm - rearStartMm) * detailScaleX;
  const detailTopY = detailBoxY + u * 4.2;
  const detailTopH = Math.max(topThickness * detailScaleY, u * 1.55);
  const detailTopUndersideY = detailTopY + detailTopH;
  const detailBackBottomY = Math.min(
    detailBoxY + detailBoxH - u * 4.2,
    detailTopUndersideY + detailVisibleDropMm * detailScaleY
  );
  const detailContinuationBottomY = detailBoxY + detailBoxH - u * 2.2;
  const detailSideRearX = detailToX(0);
  const detailTopRearX = detailToX(topOverhangBack);
  const detailFrontX = detailToX(rearStartMm);
  const detailBackRearX = detailToX(-backRecess);
  const detailBackFrontX = detailToX(-backRecess - backThickness);
  const detailBackTopY = detailTopUndersideY - backSlotDepth * detailScaleY;
  const detailSlotCaptureH = Math.max(backSlotDepth * detailScaleY, u * 0.4);
  const detailShelfY = detailTopUndersideY + Math.min((detailBackBottomY - detailTopUndersideY) * 0.46, u * 4.4);
  const detailShelfRearX = detailToX(-backRecess - backThickness - shelfSetback);
  const detailBackMidX = (detailBackFrontX + detailBackRearX) / 2;

  nodes.push(
    {
      type: 'rect',
      x: detailBoxX,
      y: detailBoxY,
      width: detailBoxW,
      height: detailBoxH,
      fill: TECHNICAL_PREVIEW_COLORS.explodedNoteFill,
      fillOpacity: 0.4,
      stroke: TECHNICAL_PREVIEW_COLORS.guideStroke,
      strokeWidth: u * 0.08,
      rx: u * 0.45,
      meta: explodedMeta(undefined, 'panel'),
    },
    {
      type: 'text',
      x: detailBoxX + u * 2,
      y: detailTitleY,
      text: 'Top Rear Detail (NTS)',
      fill: TECHNICAL_PREVIEW_COLORS.dimText,
      fontSize: u * 1.55,
      fontWeight: 600,
      fontFamily: 'sans-serif',
      textAnchor: 'start',
      meta: explodedMeta(undefined, 'note'),
    },
    {
      type: 'rect',
      x: detailFrontX,
      y: detailTopY,
      width: detailTopRearX - detailFrontX,
      height: detailTopH,
      fill: TECHNICAL_PREVIEW_COLORS.topFill,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.08,
      meta: explodedMeta('top', 'top'),
    },
    {
      type: 'line',
      x1: detailSideRearX,
      y1: detailTopUndersideY,
      x2: detailSideRearX,
      y2: detailContinuationBottomY,
      stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
      strokeWidth: u * 0.09,
      dashArray: `${u * 0.35},${u * 0.25}`,
      meta: explodedMeta(undefined, 'guide'),
    }
  );

  if (hasBack) {
    nodes.push(
      {
        type: 'rect',
        x: detailBackFrontX,
        y: detailTopUndersideY - detailSlotCaptureH,
        width: detailBackRearX - detailBackFrontX,
        height: detailSlotCaptureH,
        fill: '#93c5fd',
        fillOpacity: 0.45,
        stroke: TECHNICAL_PREVIEW_COLORS.doorStroke,
        strokeWidth: u * 0.06,
        dashArray: `${u * 0.28},${u * 0.18}`,
        meta: explodedMeta('top-slot', 'top'),
      },
      {
        type: 'rect',
        x: detailBackFrontX,
        y: detailBackTopY,
        width: detailBackRearX - detailBackFrontX,
        height: detailBackBottomY - detailBackTopY,
        fill: TECHNICAL_PREVIEW_COLORS.backFill,
        stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
        strokeWidth: u * 0.08,
        meta: explodedMeta('back', 'back'),
      },
      {
        type: 'rect',
        x: detailBackFrontX,
        y: detailBackTopY,
        width: detailBackRearX - detailBackFrontX,
        height: detailSlotCaptureH,
        fill: 'none',
        stroke: TECHNICAL_PREVIEW_COLORS.guideStroke,
        strokeWidth: u * 0.07,
        dashArray: `${u * 0.3},${u * 0.2}`,
        meta: explodedMeta('back', 'back'),
      },
      {
        type: 'line',
        x1: detailBackRearX + u * 1.3,
        y1: detailTopY + u * 0.7,
        x2: detailBackRearX + u * 0.28,
        y2: detailTopUndersideY - detailSlotCaptureH / 2,
        stroke: TECHNICAL_PREVIEW_COLORS.dimColor,
        strokeWidth: u * 0.07,
        markerEnd: 'arrow',
        meta: explodedMeta(undefined, 'guide'),
      },
      {
        type: 'text',
        x: detailBackRearX + u * 1.55,
        y: detailTopY + u * 0.82,
        text: `${rounded(backSlotDepth)}mm groove capture`,
        fill: TECHNICAL_PREVIEW_COLORS.dimText,
        fontSize: detailNoteFont,
        fontWeight: 600,
        fontFamily: 'sans-serif',
        textAnchor: 'start',
        dominantBaseline: 'middle',
        meta: explodedMeta(undefined, 'note'),
      },
      {
        type: 'line',
        x1: detailBackMidX,
        y1: detailBackBottomY,
        x2: detailBackMidX,
        y2: detailContinuationBottomY,
        stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
        strokeWidth: u * 0.08,
        dashArray: `${u * 0.34},${u * 0.22}`,
        meta: explodedMeta('back', 'back'),
      },
      {
        type: 'text',
        x: detailBackMidX,
        y: detailContinuationBottomY + u * 0.45,
        text: 'Back continues to base below',
        fill: TECHNICAL_PREVIEW_COLORS.dimText,
        fontSize: detailNoteFont * 0.98,
        fontWeight: 500,
        fontFamily: 'sans-serif',
        textAnchor: 'middle',
        dominantBaseline: 'hanging',
        meta: explodedMeta(undefined, 'note'),
      }
    );
  }

  if (shelfCount > 0) {
    nodes.push({
      type: 'line',
      x1: detailFrontX + u * 1.2,
      y1: detailShelfY,
      x2: detailShelfRearX,
      y2: detailShelfY,
      stroke: TECHNICAL_PREVIEW_COLORS.shelfStroke,
      strokeWidth: u * 0.11,
      dashArray: `${u * 0.35},${u * 0.24}`,
      meta: explodedMeta('shelf', 'shelf'),
    });
  }

  push(
    ...createHorizontalDimension({
      x1: detailSideRearX,
      x2: detailTopRearX,
      y: detailTopY - u * 0.9,
      label: `${rounded(topOverhangBack)} top OH`,
      side: 'above',
      unit: u * 0.55,
      meta: explodedMeta(undefined, 'dimension'),
    })
  );

  if (hasBack && backRecess > 0) {
    push(
      ...createHorizontalDimension({
        x1: detailBackRearX,
        x2: detailSideRearX,
        y: detailTopUndersideY + u * 0.55,
        label: `${rounded(backRecess)} recess`,
        side: 'below',
        unit: u * 0.55,
        meta: explodedMeta(undefined, 'dimension'),
      })
    );
  }

  if (hasBack && backSlotDepth > 0) {
    push(
      ...createVerticalDimension({
        y1: detailBackTopY,
        y2: detailTopUndersideY,
        x: detailBackFrontX - u * 0.85,
        label: `${rounded(backSlotDepth)} slot`,
        side: 'left',
        unit: u * 0.55,
        meta: explodedMeta(undefined, 'dimension'),
      })
    );
  }

  if (hasBack && shelfCount > 0 && shelfSetback > 0) {
    push(
      ...createHorizontalDimension({
        x1: detailShelfRearX,
        x2: detailBackFrontX,
        y: detailShelfY - u * 0.7,
        label: `${rounded(shelfSetback)} setback`,
        side: 'above',
        unit: u * 0.55,
        meta: explodedMeta(undefined, 'dimension'),
      })
    );
  }

  const rearNotes = [
    hasBack ? `Back: ${rounded(BT)}mm full-height panel` : 'Back panel disabled',
    hasBack ? `Top capture: ${rounded(backSlotDepth)}mm into groove` : null,
    `Rear OH: top ${rounded(topOverhangBack)}mm`,
    backRecess > 0 ? `Back recess: ${rounded(backRecess)}mm` : 'Back flush to carcass rear',
    shelfCount > 0 ? `Shelf setback: ${rounded(shelfSetback)}mm` : null,
  ].filter(Boolean) as string[];

  rearNotes.forEach((note, index) => {
    addNoteText(
      detailNotesX,
      detailTitleY + u * 1.8 + index * (smallText * 1.45),
      note,
      'exploded',
      index === 0 ? 600 : 500,
      detailNoteFont
    );
  });

  const sceneWidth = topX + Math.max(topWidth, explodedWidth) + margin;
  const sceneHeight = Math.max(frontY + H + margin, detailBoxY + detailBoxH + u * 4 + margin);

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
