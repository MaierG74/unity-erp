'use client';

import * as React from 'react';
import { Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import * as THREE from 'three';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { BROOKHILL_TEXTURE_URL } from '@/lib/configurator/render/cupboardThreeModel';
import type { PedestalConfig } from '@/lib/configurator/templates/types';

interface PedestalThreePreviewProps {
  config: PedestalConfig;
  height?: number;
}

const COLORS = {
  carcass: '#f3efe9',
  carcassEdge: '#d7d1ca',
  drawer: '#dbeafe',
  pencil: '#fef3c7',
  filing: '#d1fae5',
  back: '#f1f5f9',
  adjuster: '#475569',
  outline: '#64748b',
  shadow: '#0f172a',
} as const;

type PedestalRenderFinish = 'white' | 'brookhill';

interface FinishSelection {
  carcass: PedestalRenderFinish;
  drawers: PedestalRenderFinish;
}

interface PedestalPalette {
  carcass: SurfaceFinish;
  drawers: SurfaceFinish;
  back: SurfaceFinish;
}

interface SurfaceFinish {
  baseColor: string;
  edgeColor: string;
  map?: THREE.Texture | null;
}

const DEFAULT_FINISH_SELECTION: FinishSelection = {
  carcass: 'brookhill',
  drawers: 'white',
};

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
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) disposeMaterial(mesh.material);
  });
}

function panel({
  name,
  width,
  height,
  depth,
  color,
  edgeColor = COLORS.outline,
  finish,
}: {
  name: string;
  width: number;
  height: number;
  depth: number;
  color: string;
  edgeColor?: string;
  finish?: SurfaceFinish;
}) {
  const group = new THREE.Group();
  group.name = name;

  const geometry = new THREE.BoxGeometry(width, height, depth);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: finish?.baseColor ?? color,
      map: finish?.map ?? null,
      roughness: 0.82,
      metalness: 0.02,
    })
  );
  mesh.name = `${name} Mesh`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({
      color: finish?.edgeColor ?? edgeColor,
      transparent: true,
      opacity: 0.72,
    })
  );
  edges.name = `${name} Edges`;

  group.add(mesh, edges);
  return group;
}

function adjuster(name: string, size: number, height: number) {
  const geometry = new THREE.CylinderGeometry(size * 0.5, size * 0.5, height, 18);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: COLORS.adjuster,
      roughness: 0.72,
      metalness: 0.08,
    })
  );
  mesh.name = `${name} Mesh`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.name = name;
  group.add(mesh);
  return group;
}

function createSolidFinish(baseColor: string, edgeColor = baseColor): SurfaceFinish {
  return { baseColor, edgeColor };
}

function resolvePalette(selection: FinishSelection, brookhillTexture: THREE.Texture | null): PedestalPalette {
  const white = createSolidFinish(COLORS.carcass, COLORS.carcassEdge);
  const brookhill: SurfaceFinish = {
    baseColor: '#d5c4b3',
    edgeColor: '#7b6557',
    map: brookhillTexture,
  };
  const resolve = (finish: PedestalRenderFinish) => (finish === 'brookhill' ? brookhill : white);

  return {
    carcass: resolve(selection.carcass),
    drawers: resolve(selection.drawers),
    back: selection.carcass === 'brookhill'
      ? { ...brookhill, edgeColor: '#7b6557' }
      : createSolidFinish(COLORS.back, COLORS.outline),
  };
}

function buildPedestalModel(config: PedestalConfig, palette: PedestalPalette) {
  const {
    width: W,
    height: H,
    depth: D,
    materialThickness: T,
    drawerCount,
    hasPencilDrawer,
    pencilDrawerHeight,
    hasFilingDrawer,
    filingDrawerHeight,
    drawerGap,
    hasBack,
    backMaterialThickness: BT,
    adjusterHeight,
    shelfSetback,
    backRecess,
    backSlotDepth,
  } = config;

  const root = new THREE.Group();
  root.name = 'Pedestal Model';
  root.userData = { productType: 'pedestal', width: W, height: H, depth: D };

  const sideHeight = H - adjusterHeight;
  const baseWidth = W - T * 2;
  const baseDepth = D - shelfSetback - (hasBack ? BT + backRecess : 0);
  if (sideHeight <= 0 || baseWidth <= 0 || baseDepth <= 0) return root;

  const leftX = -W / 2 + T / 2;
  const rightX = W / 2 - T / 2;
  const sideY = adjusterHeight + sideHeight / 2;
  const centerZ = 0;
  const frontZ = -D / 2;
  const backZ = D / 2;

  const leftSide = panel({
    name: 'Left Side',
    width: T,
    height: sideHeight,
    depth: D,
    color: COLORS.carcass,
    edgeColor: COLORS.carcassEdge,
    finish: palette.carcass,
  });
  leftSide.position.set(leftX, sideY, centerZ);
  root.add(leftSide);

  const rightSide = panel({
    name: 'Right Side',
    width: T,
    height: sideHeight,
    depth: D,
    color: COLORS.carcass,
    edgeColor: COLORS.carcassEdge,
    finish: palette.carcass,
  });
  rightSide.position.set(rightX, sideY, centerZ);
  root.add(rightSide);

  const base = panel({
    name: 'Base',
    width: baseWidth,
    height: T,
    depth: baseDepth,
    color: COLORS.carcass,
    edgeColor: COLORS.carcassEdge,
    finish: palette.carcass,
  });
  base.position.set(0, adjusterHeight + T / 2, frontZ + baseDepth / 2);
  root.add(base);

  if (hasBack) {
    const backHeight = sideHeight + backSlotDepth;
    const back = panel({
      name: 'Back',
      width: baseWidth,
      height: backHeight,
      depth: Math.max(BT, 1),
      color: COLORS.back,
      finish: palette.back,
    });
    back.position.set(0, adjusterHeight + backHeight / 2, backZ - backRecess - Math.max(BT, 1) / 2);
    root.add(back);
  }

  const totalFronts = drawerCount + (hasPencilDrawer ? 1 : 0) + (hasFilingDrawer ? 1 : 0);
  const totalGaps = totalFronts > 1 ? (totalFronts - 1) * drawerGap : 0;
  const pencilH = hasPencilDrawer ? pencilDrawerHeight : 0;
  const filingH = hasFilingDrawer ? filingDrawerHeight : 0;
  const standardTotal = sideHeight - pencilH - filingH - totalGaps;
  const standardH = drawerCount > 0 ? Math.max(0, Math.round(standardTotal / drawerCount)) : 0;
  const frontWidth = Math.max(0, baseWidth - drawerGap * 2);
  const frontDepth = T;
  const drawerZ = frontZ - frontDepth / 2;

  let cursorTop = adjusterHeight + sideHeight;
  const addDrawerFront = (name: string, h: number, color: string) => {
    if (h <= 0 || frontWidth <= 0) return;
    const drawer = panel({
      name,
      width: frontWidth,
      height: h,
      depth: frontDepth,
      color,
      finish: palette.drawers,
    });
    drawer.position.set(0, cursorTop - h / 2, drawerZ);
    root.add(drawer);
    cursorTop -= h + drawerGap;
  };

  if (hasPencilDrawer) addDrawerFront('Pencil Drawer Front', pencilH, COLORS.pencil);
  for (let i = 0; i < drawerCount; i += 1) {
    addDrawerFront(`Standard Drawer Front ${i + 1}`, standardH, COLORS.drawer);
  }
  if (hasFilingDrawer) addDrawerFront('Filing Drawer Front', filingH, COLORS.filing);

  if (adjusterHeight > 0) {
    const footInsetX = Math.min(45, W * 0.18);
    const footInsetZ = Math.min(45, D * 0.18);
    const footX = Math.max(18, W / 2 - footInsetX);
    const footZ = Math.max(18, D / 2 - footInsetZ);
    [
      [-footX, -footZ, 'Adjuster Front Left'],
      [footX, -footZ, 'Adjuster Front Right'],
      [-footX, footZ, 'Adjuster Back Left'],
      [footX, footZ, 'Adjuster Back Right'],
    ].forEach(([x, z, name]) => {
      const foot = adjuster(String(name), Math.max(18, T * 0.9), adjusterHeight);
      foot.position.set(Number(x), adjusterHeight / 2, Number(z));
      root.add(foot);
    });
  }

  const shadowGeometry = new THREE.PlaneGeometry(W * 1.12, D * 1.12);
  const shadowMaterial = new THREE.ShadowMaterial({
    opacity: 0.14,
    color: new THREE.Color(COLORS.shadow),
  });
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadow.name = 'Preview Shadow';
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.5;
  shadow.receiveShadow = true;
  root.add(shadow);

  root.position.y = -H / 2;
  return root;
}

export function PedestalThreePreview({ config, height = 420 }: PedestalThreePreviewProps) {
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [finishSelection, setFinishSelection] = React.useState<FinishSelection>(DEFAULT_FINISH_SELECTION);
  const [brookhillReady, setBrookhillReady] = React.useState(false);
  const [materialRevision, setMaterialRevision] = React.useState(0);
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const rendererRef = React.useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = React.useRef<THREE.Scene | null>(null);
  const cameraRef = React.useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = React.useRef<any>(null);
  const modelRef = React.useRef<THREE.Object3D | null>(null);
  const brookhillTextureRef = React.useRef<THREE.Texture | null>(null);
  const animationFrameRef = React.useRef<number | null>(null);
  const resizeObserverRef = React.useRef<ResizeObserver | null>(null);
  const frameSceneRef = React.useRef<(() => void) | null>(null);

  const configSignature = React.useMemo(() => JSON.stringify(config), [config]);

  React.useEffect(() => {
    let cancelled = false;
    const loader = new THREE.TextureLoader();

    loader.load(
      BROOKHILL_TEXTURE_URL,
      (texture) => {
        if (cancelled) {
          texture.dispose();
          return;
        }

        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1.2, 1.2);
        texture.anisotropy = rendererRef.current?.capabilities.getMaxAnisotropy?.() ?? 8;
        texture.needsUpdate = true;
        brookhillTextureRef.current = texture;
        setBrookhillReady(true);
        setMaterialRevision((current) => current + 1);
      },
      undefined,
      () => {
        if (!cancelled) {
          setBrookhillReady(false);
          setFinishSelection({ carcass: 'white', drawers: 'white' });
        }
      }
    );

    return () => {
      cancelled = true;
      brookhillTextureRef.current?.dispose();
      brookhillTextureRef.current = null;
    };
  }, []);

  const buildCurrentModel = React.useCallback(() => {
    const palette = resolvePalette(finishSelection, brookhillTextureRef.current);
    return buildPedestalModel(config, palette);
  }, [config, finishSelection]);

  React.useEffect(() => {
    let cancelled = false;

    async function setup() {
      const viewport = viewportRef.current;
      if (!viewport) return;

      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
      if (cancelled || !viewportRef.current) return;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#f7f8fb');

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      const camera = new THREE.PerspectiveCamera(28, 1, 1, 12000);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enablePan = true;
      controls.screenSpacePanning = true;
      controls.minPolarAngle = THREE.MathUtils.degToRad(12);
      controls.maxPolarAngle = THREE.MathUtils.degToRad(168);

      const hemi = new THREE.HemisphereLight('#ffffff', '#cbd5e1', 1.15);
      const keyLight = new THREE.DirectionalLight('#ffffff', 1.25);
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

      rendererRef.current = renderer;
      sceneRef.current = scene;
      cameraRef.current = camera;
      controlsRef.current = controls;

      const model = buildCurrentModel();
      scene.add(model);
      modelRef.current = model;

      const frameScene = () => {
        if (!modelRef.current || !cameraRef.current || !controlsRef.current || !rendererRef.current || !sceneRef.current || !viewportRef.current) {
          return;
        }
        const box = new THREE.Box3().setFromObject(modelRef.current);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const aspect = Math.max(1, viewportRef.current.clientWidth) / Math.max(1, viewportRef.current.clientHeight);
        const halfFovY = THREE.MathUtils.degToRad(camera.fov / 2);
        const halfFovX = Math.atan(Math.tan(halfFovY) * aspect);
        const fitHeightDistance = size.y / (2 * Math.tan(halfFovY));
        const fitWidthDistance = size.x / (2 * Math.tan(halfFovX));
        const distance = Math.max(fitHeightDistance, fitWidthDistance) + size.z * 1.2;

        camera.position.copy(center).addScaledVector(new THREE.Vector3(-1.2, 0.85, -1.7).normalize(), distance * 1.08);
        camera.near = Math.max(5, distance / 60);
        camera.far = distance * 24;
        camera.updateProjectionMatrix();

        controls.target.copy(center.clone().add(new THREE.Vector3(0, size.y * 0.02, 0)));
        controls.minDistance = distance * 0.55;
        controls.maxDistance = distance * 2.8;
        controls.update();
        renderer.render(scene, camera);
      };
      frameSceneRef.current = frameScene;

      const resize = () => {
        if (!viewportRef.current || !rendererRef.current || !cameraRef.current) return;
        const width = Math.max(1, viewportRef.current.clientWidth);
        const nextHeight = Math.max(1, viewportRef.current.clientHeight);
        renderer.setSize(width, nextHeight, false);
        camera.aspect = width / nextHeight;
        camera.updateProjectionMatrix();
        frameScene();
      };

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
      if (modelRef.current) disposeObject(modelRef.current);
      rendererRef.current?.dispose();
      if (viewportRef.current) viewportRef.current.innerHTML = '';
    };
  }, [buildCurrentModel]);

  React.useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (modelRef.current) {
      scene.remove(modelRef.current);
      disposeObject(modelRef.current);
    }
    const model = buildCurrentModel();
    scene.add(model);
    modelRef.current = model;
    frameSceneRef.current?.();
  }, [buildCurrentModel, config, configSignature, materialRevision]);

  React.useEffect(() => {
    frameSceneRef.current?.();
  }, [isFullscreen]);

  const setFinishSlot = React.useCallback((slot: keyof FinishSelection, finish: PedestalRenderFinish) => {
    setFinishSelection((current) => ({
      ...current,
      [slot]: finish,
    }));
  }, []);

  return (
    <div
      className={cn(
        'w-full',
        isFullscreen && 'fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm'
      )}
    >
      <div
        className={cn(
          'mb-2 flex items-center justify-between gap-2',
          isFullscreen && 'border-b px-4 py-3'
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="hidden text-xs text-muted-foreground md:inline">
            Drag to rotate. Scroll to zoom.
          </span>
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">Carcass</span>
            <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
              <Button
                variant={finishSelection.carcass === 'white' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setFinishSlot('carcass', 'white')}
              >
                White
              </Button>
              <Button
                variant={finishSelection.carcass === 'brookhill' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setFinishSlot('carcass', 'brookhill')}
                disabled={!brookhillReady}
              >
                Brookhill
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">Drawers</span>
            <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
              <Button
                variant={finishSelection.drawers === 'white' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setFinishSlot('drawers', 'white')}
              >
                White
              </Button>
              <Button
                variant={finishSelection.drawers === 'brookhill' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setFinishSlot('drawers', 'brookhill')}
                disabled={!brookhillReady}
              >
                Brookhill
              </Button>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => frameSceneRef.current?.()}
            title="Reset camera"
          >
            <RotateCcw className="h-3.5 w-3.5" />
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
          height: isFullscreen ? 'calc(100vh - 64px)' : height,
        }}
      />
    </div>
  );
}
