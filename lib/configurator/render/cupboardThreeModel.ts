import * as THREE from 'three';

import { deriveCupboardGeometry } from '@/lib/configurator/templates/cupboardGeometry';
import type { CupboardConfig } from '@/lib/configurator/templates/types';

export type CupboardThreeViewMode = 'assembly' | 'interior';
export type CupboardRenderFinish = 'white' | 'brookhill';
export type ThicknessAxis = 'x' | 'y' | 'z';

export interface SurfaceFinish {
  baseColor: string;
  edgeColor: string;
  roughness: number;
  metalness: number;
  map?: THREE.Texture | null;
}

export interface FinishPalette {
  carcass: SurfaceFinish;
  fronts: SurfaceFinish;
  backPanel: SurfaceFinish;
  hardboardBack: SurfaceFinish;
}

export interface CupboardFinishSelection {
  carcass: CupboardRenderFinish;
  fronts: CupboardRenderFinish;
}

interface PanelMeshOptions {
  name: string;
  width: number;
  height: number;
  depth: number;
  color: string;
  finish?: SurfaceFinish;
  thicknessAxis?: ThicknessAxis;
  opacity?: number;
  outlineColor?: string;
  outlineOpacity?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  userData?: Record<string, unknown>;
}

export const BROOKHILL_TEXTURE_URL = '/materials/pg-bison/brookhill-face.jpg';

const COLORS = {
  shell: '#e2e8f0',
  shellGhost: '#e2e8f0',
  topBase: '#bfdbfe',
  back: '#f1f5f9',
  door: '#dbeafe',
  outline: '#64748b',
  adjuster: '#475569',
  shadow: '#0f172a',
} as const;

export function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose());
    return;
  }

  if ('map' in material && material.map) {
    material.map.dispose();
  }

  material.dispose();
}

export function disposeObject(root: THREE.Object3D) {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    if (mesh.material) {
      disposeMaterial(mesh.material);
    }
  });
}

function createPanelMesh(options: PanelMeshOptions) {
  const group = new THREE.Group();
  group.name = options.name;
  group.userData = {
    partName: options.name,
    ...(options.userData ?? {}),
  };

  const geometry = new THREE.BoxGeometry(options.width, options.height, options.depth);
  const opacity = options.opacity ?? 1;
  const finish = options.finish;
  const edgeColor = finish?.edgeColor ?? options.color;
  const roughness = finish?.roughness ?? 0.86;
  const metalness = finish?.metalness ?? 0.03;
  const broadRotation = options.thicknessAxis === 'y' ? Math.PI / 2 : 0;
  const edgeMaterial = new THREE.MeshStandardMaterial({
    color: edgeColor,
    roughness,
    metalness,
    transparent: opacity < 1,
    opacity,
  });

  const mesh = new THREE.Mesh(geometry, edgeMaterial);
  mesh.name = `${options.name} Mesh`;
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({
      color: options.outlineColor ?? COLORS.outline,
      transparent: true,
      opacity: options.outlineOpacity ?? Math.max(0.45, opacity),
    })
  );
  edges.name = `${options.name} Edges`;

  group.add(mesh, edges);

  const createBroadMaterial = () => {
    const broadMap = finish?.map ? finish.map.clone() : null;
    if (broadMap) {
      broadMap.colorSpace = THREE.SRGBColorSpace;
      broadMap.wrapS = THREE.ClampToEdgeWrapping;
      broadMap.wrapT = THREE.ClampToEdgeWrapping;
      broadMap.center.set(0.5, 0.5);
      broadMap.rotation = broadRotation;
      broadMap.needsUpdate = true;
    }

    return new THREE.MeshStandardMaterial({
      color: finish?.baseColor ?? options.color,
      map: broadMap,
      roughness,
      metalness,
      transparent: opacity < 1,
      opacity,
    });
  };

  if (options.thicknessAxis) {
    const epsilon = 0.03;
    let frontFaceGeometry: THREE.BufferGeometry;
    let backFaceGeometry: THREE.BufferGeometry;
    let frontPosition = new THREE.Vector3();
    let backPosition = new THREE.Vector3();
    let frontRotation = new THREE.Euler();
    let backRotation = new THREE.Euler();

    if (options.thicknessAxis === 'x') {
      frontFaceGeometry = new THREE.PlaneGeometry(options.depth, options.height);
      backFaceGeometry = new THREE.PlaneGeometry(options.depth, options.height);
      frontPosition = new THREE.Vector3(options.width / 2 + epsilon, 0, 0);
      backPosition = new THREE.Vector3(-options.width / 2 - epsilon, 0, 0);
      frontRotation = new THREE.Euler(0, Math.PI / 2, 0);
      backRotation = new THREE.Euler(0, -Math.PI / 2, 0);
    } else if (options.thicknessAxis === 'y') {
      frontFaceGeometry = new THREE.PlaneGeometry(options.width, options.depth);
      backFaceGeometry = new THREE.PlaneGeometry(options.width, options.depth);
      frontPosition = new THREE.Vector3(0, options.height / 2 + epsilon, 0);
      backPosition = new THREE.Vector3(0, -options.height / 2 - epsilon, 0);
      frontRotation = new THREE.Euler(-Math.PI / 2, 0, 0);
      backRotation = new THREE.Euler(Math.PI / 2, 0, 0);
    } else {
      frontFaceGeometry = new THREE.PlaneGeometry(options.width, options.height);
      backFaceGeometry = new THREE.PlaneGeometry(options.width, options.height);
      frontPosition = new THREE.Vector3(0, 0, options.depth / 2 + epsilon);
      backPosition = new THREE.Vector3(0, 0, -options.depth / 2 - epsilon);
      backRotation = new THREE.Euler(0, Math.PI, 0);
    }

    const frontFace = new THREE.Mesh(frontFaceGeometry, createBroadMaterial());
    frontFace.name = `${options.name} Face Front`;
    frontFace.position.copy(frontPosition);
    frontFace.rotation.copy(frontRotation);
    frontFace.castShadow = options.castShadow ?? true;
    frontFace.receiveShadow = options.receiveShadow ?? true;

    const backFace = new THREE.Mesh(backFaceGeometry, createBroadMaterial());
    backFace.name = `${options.name} Face Back`;
    backFace.position.copy(backPosition);
    backFace.rotation.copy(backRotation);
    backFace.castShadow = options.castShadow ?? true;
    backFace.receiveShadow = options.receiveShadow ?? true;

    group.add(frontFace, backFace);
  }

  return group;
}

function createAdjuster(name: string, size: number, height: number) {
  const geometry = new THREE.CylinderGeometry(size * 0.5, size * 0.5, height, 18);
  const material = new THREE.MeshStandardMaterial({
    color: COLORS.adjuster,
    roughness: 0.72,
    metalness: 0.08,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${name} Mesh`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({
      color: COLORS.outline,
      transparent: true,
      opacity: 0.8,
    })
  );
  edges.name = `${name} Edges`;

  const group = new THREE.Group();
  group.name = name;
  group.userData = { partName: name, partRole: 'adjuster' };
  group.add(mesh, edges);
  return group;
}

function createSolidFinish(baseColor: string, edgeColor = baseColor, roughness = 0.86, metalness = 0.03): SurfaceFinish {
  return { baseColor, edgeColor, roughness, metalness };
}

function createWhiteMelamineFinish(): SurfaceFinish {
  return createSolidFinish('#f3efe9', '#d7d1ca', 0.82, 0.02);
}

function createBrookhillPalette(texture: THREE.Texture | null): FinishPalette {
  const brookhill: SurfaceFinish = {
    baseColor: '#d5c4b3',
    edgeColor: '#7b6557',
    roughness: 0.84,
    metalness: 0.03,
    map: texture,
  };

  return {
    carcass: brookhill,
    fronts: brookhill,
    backPanel: brookhill,
    hardboardBack: createSolidFinish('#8c6f5c', '#8c6f5c', 0.9, 0.01),
  };
}

export function getFinishPalette(
  finishSelection: CupboardFinishSelection,
  brookhillTexture: THREE.Texture | null
): FinishPalette {
  const brookhillPalette = createBrookhillPalette(brookhillTexture);
  const resolveFinish = (finish: CupboardRenderFinish): SurfaceFinish =>
    finish === 'brookhill' ? brookhillPalette.carcass : createWhiteMelamineFinish();

  return {
    carcass: resolveFinish(finishSelection.carcass),
    fronts: resolveFinish(finishSelection.fronts),
    backPanel: resolveFinish(finishSelection.carcass),
    hardboardBack: createSolidFinish(COLORS.back, COLORS.back, 0.92, 0.01),
  };
}

export function buildCupboardModel(
  config: CupboardConfig,
  viewMode: CupboardThreeViewMode,
  palette: FinishPalette,
  options?: {
    includePreviewShadow?: boolean;
  }
) {
  const derived = deriveCupboardGeometry(config);
  const root = new THREE.Group();
  root.name = 'Cupboard Model';
  root.userData = {
    productType: 'cupboard',
    width: config.width,
    height: config.height,
    depth: config.depth,
    viewMode,
  };

  if (!derived.valid) {
    return root;
  }

  const {
    materialThickness: T,
    baseConstruction,
    shelfCount,
    doorStyle,
    hasBack,
    backMaterialThickness: BT,
    doorGap,
    backSlotDepth,
    backRecess,
    adjusterHeight,
  } = config;
  const {
    carcassWidth,
    carcassDepth,
    sideHeight,
    internalWidth,
    shelfDepth,
    topWidth,
    topDepth,
    baseWidth,
    baseDepth,
    topThickness,
    baseThickness,
    baseCleatWidth,
    overallFront,
    overallBack,
    carcassLeft,
    carcassRight,
    carcassFront,
    carcassBack,
    baseBottomY,
    baseTopY,
    sideBottomY,
    sideTopY,
    topBottomY,
    topTopY,
  } = derived;
  const topFront = carcassFront - config.topOverhangFront;
  const topBack = carcassBack + config.topOverhangBack;
  const baseFront = carcassFront - config.baseOverhangFront;
  const baseBack = carcassBack + config.baseOverhangBack;
  const baseLeft = -baseWidth / 2;
  const baseRight = baseWidth / 2;

  root.position.y = -(topTopY / 2);

  const topGhostOpacity = viewMode === 'interior' ? 0.22 : 1;
  const nearSideOpacity = viewMode === 'interior' ? 0.12 : 1;
  const farSideOpacity = viewMode === 'interior' ? 0.92 : 1;
  const baseOpacity = 1;

  const top = createPanelMesh({
    name: 'Top',
    width: topWidth,
    height: topThickness,
    depth: topDepth,
    color: COLORS.topBase,
    finish: palette.carcass,
    thicknessAxis: 'y',
    opacity: topGhostOpacity,
    userData: { partRole: 'top' },
  });
  top.position.set(0, topBottomY + topThickness / 2, (topFront + topBack) / 2);
  root.add(top);

  if (baseConstruction === 'cleated') {
    const baseAssembly = new THREE.Group();
    baseAssembly.name = 'Base Cleated Assembly';
    baseAssembly.userData = { partRole: 'base', construction: 'cleated' };

    const basePanel = createPanelMesh({
      name: 'Base Panel',
      width: baseWidth,
      height: T,
      depth: baseDepth,
      color: COLORS.topBase,
      finish: palette.carcass,
      thicknessAxis: 'y',
      opacity: baseOpacity,
      userData: { partRole: 'base_panel' },
    });
    basePanel.position.set(0, baseTopY - T / 2, (baseFront + baseBack) / 2);
    baseAssembly.add(basePanel);

    const frontCleat = createPanelMesh({
      name: 'Base Cleat Front',
      width: baseWidth,
      height: T,
      depth: baseCleatWidth,
      color: COLORS.topBase,
      finish: palette.carcass,
      thicknessAxis: 'y',
      opacity: baseOpacity,
      userData: { partRole: 'base_cleat', side: 'front' },
    });
    frontCleat.position.set(0, baseBottomY + T / 2, baseFront + baseCleatWidth / 2);
    baseAssembly.add(frontCleat);

    const backCleat = createPanelMesh({
      name: 'Base Cleat Back',
      width: baseWidth,
      height: T,
      depth: baseCleatWidth,
      color: COLORS.topBase,
      finish: palette.carcass,
      thicknessAxis: 'y',
      opacity: baseOpacity,
      userData: { partRole: 'base_cleat', side: 'back' },
    });
    backCleat.position.set(0, baseBottomY + T / 2, baseBack - baseCleatWidth / 2);
    baseAssembly.add(backCleat);

    const sideCleatDepth = Math.max(0, baseDepth - baseCleatWidth * 2);
    if (sideCleatDepth > 0) {
      const leftCleat = createPanelMesh({
        name: 'Base Cleat Left',
        width: baseCleatWidth,
        height: T,
        depth: sideCleatDepth,
        color: COLORS.topBase,
        finish: palette.carcass,
        thicknessAxis: 'y',
        opacity: baseOpacity,
        userData: { partRole: 'base_cleat', side: 'left' },
      });
      leftCleat.position.set(baseLeft + baseCleatWidth / 2, baseBottomY + T / 2, (baseFront + baseBack) / 2);
      baseAssembly.add(leftCleat);

      const rightCleat = createPanelMesh({
        name: 'Base Cleat Right',
        width: baseCleatWidth,
        height: T,
        depth: sideCleatDepth,
        color: COLORS.topBase,
        finish: palette.carcass,
        thicknessAxis: 'y',
        opacity: baseOpacity,
        userData: { partRole: 'base_cleat', side: 'right' },
      });
      rightCleat.position.set(baseRight - baseCleatWidth / 2, baseBottomY + T / 2, (baseFront + baseBack) / 2);
      baseAssembly.add(rightCleat);
    }

    root.add(baseAssembly);
  } else {
    const base = createPanelMesh({
      name: 'Base',
      width: baseWidth,
      height: baseThickness,
      depth: baseDepth,
      color: COLORS.topBase,
      finish: palette.carcass,
      thicknessAxis: 'y',
      opacity: baseOpacity,
      userData: { partRole: 'base', construction: baseConstruction },
    });
    base.position.set(0, baseBottomY + baseThickness / 2, (baseFront + baseBack) / 2);
    root.add(base);
  }

  const leftSide = createPanelMesh({
    name: 'Left Side',
    width: T,
    height: sideHeight,
    depth: carcassDepth,
    color: COLORS.shellGhost,
    finish: palette.carcass,
    thicknessAxis: 'x',
    opacity: nearSideOpacity,
    outlineOpacity: viewMode === 'interior' ? 0.45 : 1,
    userData: { partRole: 'side', side: 'left' },
  });
  leftSide.position.set(carcassLeft + T / 2, sideBottomY + sideHeight / 2, (carcassFront + carcassBack) / 2);
  root.add(leftSide);

  const rightSide = createPanelMesh({
    name: 'Right Side',
    width: T,
    height: sideHeight,
    depth: carcassDepth,
    color: COLORS.shell,
    finish: palette.carcass,
    thicknessAxis: 'x',
    opacity: farSideOpacity,
    userData: { partRole: 'side', side: 'right' },
  });
  rightSide.position.set(carcassRight - T / 2, sideBottomY + sideHeight / 2, (carcassFront + carcassBack) / 2);
  root.add(rightSide);

  if (shelfCount > 0 && shelfDepth > 0) {
    for (let index = 1; index <= shelfCount; index += 1) {
      const y = sideBottomY + (sideHeight * index) / (shelfCount + 1);
      const shelf = createPanelMesh({
        name: `Shelf ${index}`,
        width: internalWidth,
        height: T,
        depth: shelfDepth,
        color: COLORS.shell,
        finish: palette.carcass,
        thicknessAxis: 'y',
        opacity: 1,
        userData: { partRole: 'shelf', shelfIndex: index },
      });
      shelf.position.set(0, y, carcassFront + shelfDepth / 2);
      root.add(shelf);
    }
  }

  if (hasBack) {
    const backFinish = BT >= T ? palette.backPanel : palette.hardboardBack;
    const back = createPanelMesh({
      name: 'Back',
      width: internalWidth,
      height: sideHeight + backSlotDepth,
      depth: BT,
      color: COLORS.back,
      finish: backFinish,
      thicknessAxis: 'z',
      opacity: 1,
      userData: { partRole: 'back' },
    });
    back.position.set(
      0,
      sideBottomY + (sideHeight + backSlotDepth) / 2,
      carcassBack - backRecess - BT / 2
    );
    root.add(back);
  }

  if (doorStyle !== 'none' && viewMode !== 'interior') {
    const doorDepth = T;
    const doorHeight = Math.max(0, sideHeight - doorGap * 2);
    const doorCenterY = sideBottomY + doorGap + doorHeight / 2;
    const doorCenterZ = overallFront - doorDepth / 2;
    const assemblyAngle = THREE.MathUtils.degToRad(28);
    const openAngle = assemblyAngle;

    if (doorStyle === 'single') {
      const doorWidth = Math.max(0, carcassWidth - doorGap * 2);
      const pivot = new THREE.Group();
      pivot.name = 'Door Pivot Single';
      pivot.position.set(carcassLeft + doorGap, doorCenterY, doorCenterZ);
      pivot.rotation.y = openAngle;

      const door = createPanelMesh({
        name: 'Door',
        width: doorWidth,
        height: doorHeight,
        depth: doorDepth,
        color: COLORS.door,
        finish: palette.fronts,
        thicknessAxis: 'z',
        opacity: 1,
        userData: { partRole: 'door', side: 'single' },
      });
      door.position.set(doorWidth / 2, 0, 0);
      pivot.add(door);
      root.add(pivot);
    } else {
      const doorWidth = Math.floor((carcassWidth - doorGap * 3) / 2);

      const leftPivot = new THREE.Group();
      leftPivot.name = 'Door Pivot Left';
      leftPivot.position.set(carcassLeft + doorGap, doorCenterY, doorCenterZ);
      leftPivot.rotation.y = openAngle;
      const leftDoor = createPanelMesh({
        name: 'Door Left',
        width: doorWidth,
        height: doorHeight,
        depth: doorDepth,
        color: COLORS.door,
        finish: palette.fronts,
        thicknessAxis: 'z',
        opacity: 1,
        userData: { partRole: 'door', side: 'left' },
      });
      leftDoor.position.set(doorWidth / 2, 0, 0);
      leftPivot.add(leftDoor);
      root.add(leftPivot);

      const rightPivot = new THREE.Group();
      rightPivot.name = 'Door Pivot Right';
      rightPivot.position.set(carcassRight - doorGap, doorCenterY, doorCenterZ);
      rightPivot.rotation.y = -openAngle;
      const rightDoor = createPanelMesh({
        name: 'Door Right',
        width: doorWidth,
        height: doorHeight,
        depth: doorDepth,
        color: COLORS.door,
        finish: palette.fronts,
        thicknessAxis: 'z',
        opacity: 1,
        userData: { partRole: 'door', side: 'right' },
      });
      rightDoor.position.set(-doorWidth / 2, 0, 0);
      rightPivot.add(rightDoor);
      root.add(rightPivot);
    }
  }

  if (adjusterHeight > 0) {
    const widestWidth = Math.max(topWidth, baseWidth);
    const footInsetX = Math.min(45, widestWidth * 0.18);
    const footInsetZ = Math.min(45, baseDepth * 0.18);
    const footX = Math.max(18, widestWidth / 2 - footInsetX);
    const footZ = Math.max(18, baseDepth / 2 - footInsetZ);

    [
      [-footX, overallFront + footZ, 'Adjuster Front Left'],
      [footX, overallFront + footZ, 'Adjuster Front Right'],
      [-footX, overallBack - footZ, 'Adjuster Back Left'],
      [footX, overallBack - footZ, 'Adjuster Back Right'],
    ].forEach(([x, z, name]) => {
      const foot = createAdjuster(String(name), Math.max(18, T * 0.9), adjusterHeight);
      foot.position.set(Number(x), adjusterHeight / 2, Number(z));
      root.add(foot);
    });
  }

  if (options?.includePreviewShadow ?? true) {
    const shadowGeometry = new THREE.PlaneGeometry(
      Math.max(topWidth, baseWidth) * 1.1,
      Math.max(topDepth, baseDepth) * 1.1
    );
    const shadowMaterial = new THREE.ShadowMaterial({
      opacity: viewMode === 'interior' ? 0.1 : 0.14,
      color: new THREE.Color(COLORS.shadow),
    });
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadow.name = 'Preview Shadow';
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -topTopY / 2 + 0.5;
    shadow.receiveShadow = true;
    root.add(shadow);
  }

  return root;
}
