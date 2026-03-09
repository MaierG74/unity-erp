'use client';

import * as React from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Download, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import * as THREE from 'three';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { deriveCupboardGeometry } from '@/lib/configurator/templates/cupboardGeometry';
import type { CupboardConfig } from '@/lib/configurator/templates/types';

interface CupboardThreePreviewProps {
  config: CupboardConfig;
  height?: number;
}

type ViewMode = 'assembly' | 'interior';

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

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose());
    return;
  }

  material.dispose();
}

function disposeObject(root: THREE.Object3D) {
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

function createPanelMesh(options: {
  width: number;
  height: number;
  depth: number;
  color: string;
  opacity?: number;
  outlineColor?: string;
  outlineOpacity?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
}) {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(options.width, options.height, options.depth);
  const opacity = options.opacity ?? 1;
  const material = new THREE.MeshStandardMaterial({
    color: options.color,
    roughness: 0.86,
    metalness: 0.03,
    transparent: opacity < 1,
    opacity,
  });
  const mesh = new THREE.Mesh(geometry, material);
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

  group.add(mesh, edges);
  return group;
}

function createAdjuster(size: number, height: number) {
  const geometry = new THREE.CylinderGeometry(size * 0.5, size * 0.5, height, 18);
  const material = new THREE.MeshStandardMaterial({
    color: COLORS.adjuster,
    roughness: 0.72,
    metalness: 0.08,
  });
  const mesh = new THREE.Mesh(geometry, material);
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

  const group = new THREE.Group();
  group.add(mesh, edges);
  return group;
}

function buildCupboardModel(config: CupboardConfig, viewMode: ViewMode) {
  const derived = deriveCupboardGeometry(config);
  const root = new THREE.Group();

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
    width: topWidth,
    height: topThickness,
    depth: topDepth,
    color: COLORS.topBase,
    opacity: topGhostOpacity,
  });
  top.position.set(0, topBottomY + topThickness / 2, (topFront + topBack) / 2);
  root.add(top);

  if (baseConstruction === 'cleated') {
    const basePanel = createPanelMesh({
      width: baseWidth,
      height: T,
      depth: baseDepth,
      color: COLORS.topBase,
      opacity: baseOpacity,
    });
    basePanel.position.set(0, baseTopY - T / 2, (baseFront + baseBack) / 2);
    root.add(basePanel);

    const frontCleat = createPanelMesh({
      width: baseWidth,
      height: T,
      depth: baseCleatWidth,
      color: COLORS.topBase,
      opacity: baseOpacity,
    });
    frontCleat.position.set(0, baseBottomY + T / 2, baseFront + baseCleatWidth / 2);
    root.add(frontCleat);

    const backCleat = createPanelMesh({
      width: baseWidth,
      height: T,
      depth: baseCleatWidth,
      color: COLORS.topBase,
      opacity: baseOpacity,
    });
    backCleat.position.set(0, baseBottomY + T / 2, baseBack - baseCleatWidth / 2);
    root.add(backCleat);

    const sideCleatDepth = Math.max(0, baseDepth - baseCleatWidth * 2);
    if (sideCleatDepth > 0) {
      const leftCleat = createPanelMesh({
        width: baseCleatWidth,
        height: T,
        depth: sideCleatDepth,
        color: COLORS.topBase,
        opacity: baseOpacity,
      });
      leftCleat.position.set(baseLeft + baseCleatWidth / 2, baseBottomY + T / 2, (baseFront + baseBack) / 2);
      root.add(leftCleat);

      const rightCleat = createPanelMesh({
        width: baseCleatWidth,
        height: T,
        depth: sideCleatDepth,
        color: COLORS.topBase,
        opacity: baseOpacity,
      });
      rightCleat.position.set(baseRight - baseCleatWidth / 2, baseBottomY + T / 2, (baseFront + baseBack) / 2);
      root.add(rightCleat);
    }
  } else {
    const base = createPanelMesh({
      width: baseWidth,
      height: baseThickness,
      depth: baseDepth,
      color: COLORS.topBase,
      opacity: baseOpacity,
    });
    base.position.set(0, baseBottomY + baseThickness / 2, (baseFront + baseBack) / 2);
    root.add(base);
  }

  const leftSide = createPanelMesh({
    width: T,
    height: sideHeight,
    depth: carcassDepth,
    color: COLORS.shellGhost,
    opacity: nearSideOpacity,
    outlineOpacity: viewMode === 'interior' ? 0.45 : 1,
  });
  leftSide.position.set(carcassLeft + T / 2, sideBottomY + sideHeight / 2, (carcassFront + carcassBack) / 2);
  root.add(leftSide);

  const rightSide = createPanelMesh({
    width: T,
    height: sideHeight,
    depth: carcassDepth,
    color: COLORS.shell,
    opacity: farSideOpacity,
  });
  rightSide.position.set(carcassRight - T / 2, sideBottomY + sideHeight / 2, (carcassFront + carcassBack) / 2);
  root.add(rightSide);

  if (shelfCount > 0 && shelfDepth > 0) {
    for (let index = 1; index <= shelfCount; index += 1) {
      const y = sideBottomY + (sideHeight * index) / (shelfCount + 1);
      const shelf = createPanelMesh({
        width: internalWidth,
        height: T,
        depth: shelfDepth,
        color: COLORS.shell,
        opacity: 1,
      });
      shelf.position.set(
        0,
        y,
        carcassFront + shelfDepth / 2
      );
      root.add(shelf);
    }
  }

  if (hasBack) {
    const back = createPanelMesh({
      width: internalWidth,
      height: sideHeight + backSlotDepth,
      depth: BT,
      color: COLORS.back,
      opacity: viewMode === 'interior' ? 0.9 : 1,
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
      pivot.position.set(carcassLeft + doorGap, doorCenterY, doorCenterZ);
      pivot.rotation.y = openAngle;

      const door = createPanelMesh({
        width: doorWidth,
        height: doorHeight,
        depth: doorDepth,
        color: COLORS.door,
        opacity: 0.95,
      });
      door.position.set(doorWidth / 2, 0, 0);
      pivot.add(door);
      root.add(pivot);
    } else {
      const doorWidth = Math.floor((carcassWidth - doorGap * 3) / 2);

      const leftPivot = new THREE.Group();
      leftPivot.position.set(carcassLeft + doorGap, doorCenterY, doorCenterZ);
      leftPivot.rotation.y = openAngle;
      const leftDoor = createPanelMesh({
        width: doorWidth,
        height: doorHeight,
        depth: doorDepth,
        color: COLORS.door,
        opacity: 0.95,
      });
      leftDoor.position.set(doorWidth / 2, 0, 0);
      leftPivot.add(leftDoor);
      root.add(leftPivot);

      const rightPivot = new THREE.Group();
      rightPivot.position.set(carcassRight - doorGap, doorCenterY, doorCenterZ);
      rightPivot.rotation.y = -openAngle;
      const rightDoor = createPanelMesh({
        width: doorWidth,
        height: doorHeight,
        depth: doorDepth,
        color: COLORS.door,
        opacity: 0.92,
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
      [-footX, overallFront + footZ],
      [footX, overallFront + footZ],
      [-footX, overallBack - footZ],
      [footX, overallBack - footZ],
    ].forEach(([x, z]) => {
      const foot = createAdjuster(Math.max(18, T * 0.9), adjusterHeight);
      foot.position.set(x, adjusterHeight / 2, z);
      root.add(foot);
    });
  }

  const shadowGeometry = new THREE.PlaneGeometry(Math.max(topWidth, baseWidth) * 1.1, Math.max(topDepth, baseDepth) * 1.1);
  const shadowMaterial = new THREE.ShadowMaterial({
    opacity: viewMode === 'interior' ? 0.1 : 0.14,
    color: new THREE.Color(COLORS.shadow),
  });
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -topTopY / 2 + 0.5;
  shadow.receiveShadow = true;
  root.add(shadow);

  return root;
}

export function CupboardThreePreview({ config, height = 420 }: CupboardThreePreviewProps) {
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<ViewMode>(
    config.doorStyle === 'none' ? 'interior' : 'assembly'
  );
  const configRef = React.useRef(config);
  const viewModeRef = React.useRef<ViewMode>(config.doorStyle === 'none' ? 'interior' : 'assembly');
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const rendererRef = React.useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = React.useRef<THREE.Scene | null>(null);
  const cameraRef = React.useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = React.useRef<any>(null);
  const modelRef = React.useRef<THREE.Object3D | null>(null);
  const animationFrameRef = React.useRef<number | null>(null);
  const resizeObserverRef = React.useRef<ResizeObserver | null>(null);
  const frameSceneRef = React.useRef<((mode?: ViewMode) => void) | null>(null);

  React.useEffect(() => {
    configRef.current = config;
  }, [config]);

  React.useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  React.useEffect(() => {
    if (config.doorStyle === 'none') {
      setViewMode((current) => (current === 'assembly' ? 'interior' : current));
    }
  }, [config.doorStyle]);

  React.useEffect(() => {
    let cancelled = false;

    async function setup() {
      const viewport = viewportRef.current;
      if (!viewport) return;

      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
      if (cancelled || !viewportRef.current) return;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#ffffff');

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
      });
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      const camera = new THREE.PerspectiveCamera(28, 1, 1, 12000);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enablePan = true;
      controls.screenSpacePanning = true;
      controls.panSpeed = 0.6;
      controls.minPolarAngle = THREE.MathUtils.degToRad(12);
      controls.maxPolarAngle = THREE.MathUtils.degToRad(168);

      const hemi = new THREE.HemisphereLight('#ffffff', '#cbd5e1', 1.15);
      const keyLight = new THREE.DirectionalLight('#ffffff', 1.2);
      keyLight.position.set(-900, 1400, -1200);
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.width = 2048;
      keyLight.shadow.mapSize.height = 2048;
      keyLight.shadow.camera.near = 200;
      keyLight.shadow.camera.far = 5000;
      keyLight.shadow.camera.left = -1200;
      keyLight.shadow.camera.right = 1200;
      keyLight.shadow.camera.top = 1200;
      keyLight.shadow.camera.bottom = -1200;

      const fillLight = new THREE.DirectionalLight('#ffffff', 0.5);
      fillLight.position.set(1000, 700, 800);

      scene.add(hemi, keyLight, fillLight);
      viewport.innerHTML = '';
      viewport.appendChild(renderer.domElement);

      const frameScene = (nextMode: ViewMode = viewModeRef.current) => {
        if (!modelRef.current || !cameraRef.current || !controlsRef.current || !rendererRef.current || !sceneRef.current) {
          return;
        }

        const box = new THREE.Box3().setFromObject(modelRef.current);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const aspect = Math.max(1, viewport.clientWidth) / Math.max(1, viewport.clientHeight);
        const halfFovY = THREE.MathUtils.degToRad(camera.fov / 2);
        const halfFovX = Math.atan(Math.tan(halfFovY) * aspect);
        const fitHeightDistance = size.y / (2 * Math.tan(halfFovY));
        const fitWidthDistance = size.x / (2 * Math.tan(halfFovX));
        const distance = Math.max(fitHeightDistance, fitWidthDistance) + size.z * 1.25;
        const direction =
          nextMode === 'interior'
            ? new THREE.Vector3(-1.0, 0.75, -1.5).normalize()
            : new THREE.Vector3(-1.25, 0.88, -1.75).normalize();

        camera.position.copy(center).addScaledVector(direction, distance * 1.02);
        camera.near = Math.max(5, distance / 60);
        camera.far = distance * 24;
        camera.updateProjectionMatrix();

        controls.target.copy(center.clone().add(new THREE.Vector3(0, size.y * 0.03, 0)));
        controls.minDistance = distance * 0.55;
        controls.maxDistance = distance * 2.8;
        controls.update();
        renderer.render(scene, camera);
      };

      const resize = () => {
        if (!viewportRef.current || !rendererRef.current || !cameraRef.current) return;
        const width = Math.max(1, viewportRef.current.clientWidth);
        const nextHeight = Math.max(1, viewportRef.current.clientHeight);
        renderer.setSize(width, nextHeight, false);
        camera.aspect = width / nextHeight;
        camera.updateProjectionMatrix();
        if (frameSceneRef.current) {
          frameSceneRef.current(viewModeRef.current);
        }
      };

      frameSceneRef.current = frameScene;
      rendererRef.current = renderer;
      sceneRef.current = scene;
      cameraRef.current = camera;
      controlsRef.current = controls;

      const initialModel = buildCupboardModel(configRef.current, viewModeRef.current);
      scene.add(initialModel);
      modelRef.current = initialModel;

      resizeObserverRef.current = new ResizeObserver(() => resize());
      resizeObserverRef.current.observe(viewport);
      resize();

      const animate = () => {
        if (!rendererRef.current || !sceneRef.current || !cameraRef.current || !controlsRef.current) return;
        controls.update();
        renderer.render(scene, camera);
        animationFrameRef.current = window.requestAnimationFrame(animate);
      };

      animate();
    }

    setup();

    return () => {
      cancelled = true;
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      resizeObserverRef.current?.disconnect();
      controlsRef.current?.dispose?.();
      if (modelRef.current) {
        disposeObject(modelRef.current);
      }
      rendererRef.current?.dispose();
      const viewport = viewportRef.current;
      if (viewport) {
        viewport.innerHTML = '';
      }
    };
  }, []);

  React.useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (modelRef.current) {
      scene.remove(modelRef.current);
      disposeObject(modelRef.current);
    }

    const model = buildCupboardModel(config, viewMode);
    scene.add(model);
    modelRef.current = model;
    frameSceneRef.current?.(viewMode);
  }, [config, viewMode]);

  React.useEffect(() => {
    frameSceneRef.current?.(viewMode);
  }, [isFullscreen, viewMode]);

  const handleReset = React.useCallback(() => {
    frameSceneRef.current?.(viewMode);
  }, [viewMode]);

  const handlePan = React.useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const distance = camera.position.distanceTo(controls.target);
    const step = Math.max(12, distance * 0.07);
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const screenUp = new THREE.Vector3();
    const delta = new THREE.Vector3();

    camera.getWorldDirection(forward);
    right.crossVectors(forward, camera.up).normalize();
    screenUp.crossVectors(right, forward).normalize();

    if (direction === 'up') delta.copy(screenUp).multiplyScalar(step);
    if (direction === 'down') delta.copy(screenUp).multiplyScalar(-step);
    if (direction === 'left') delta.copy(right).multiplyScalar(-step);
    if (direction === 'right') delta.copy(right).multiplyScalar(step);

    camera.position.add(delta);
    controls.target.add(delta);
    controls.update();
  }, []);

  const handleDownload = React.useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const anchor = window.document.createElement('a');
    anchor.href = renderer.domElement.toDataURL('image/png');
    anchor.download = `cupboard-${config.width}x${config.height}x${config.depth}-3d-preview.png`;
    anchor.style.display = 'none';
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, [config.depth, config.height, config.width]);

  return (
    <div
      className={cn(
        'w-full',
        isFullscreen && 'fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm'
      )}
    >
      <div
        className={cn(
          'mb-2 flex items-center justify-between gap-3',
          isFullscreen && 'border-b px-4 py-3'
        )}
      >
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
            <Button
              variant={viewMode === 'assembly' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setViewMode('assembly')}
            >
              Assembly
            </Button>
            <Button
              variant={viewMode === 'interior' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setViewMode('interior')}
            >
              Interior
            </Button>
          </div>
          <span className="hidden text-xs text-muted-foreground md:inline">
            Drag to rotate. Use the pan arrows to nudge the view. Scroll to zoom.
          </span>
        </div>
        <div className="flex items-center gap-1">
          <div className="mr-1 inline-flex items-center rounded-md border bg-muted/30 p-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => handlePan('left')}
              title="Pan left"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => handlePan('up')}
              title="Pan up"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => handlePan('down')}
              title="Pan down"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => handlePan('right')}
              title="Pan right"
            >
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={handleReset}
            title="Reset camera"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={handleDownload}
            title="Download PNG"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => setIsFullscreen((current) => !current)}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
      <div
        ref={viewportRef}
        className={cn(
          'w-full overflow-hidden rounded border bg-white',
          isFullscreen ? 'flex-1' : ''
        )}
        style={{
          height: isFullscreen ? 'calc(100vh - 88px)' : height,
        }}
      />
    </div>
  );
}
