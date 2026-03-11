'use client';

import * as React from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Download, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import * as THREE from 'three';
import type { WebGLPathTracer as WebGLPathTracerType } from 'three-gpu-pathtracer';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  BROOKHILL_TEXTURE_URL,
  buildCupboardModel,
  disposeObject,
  getFinishPalette,
  type CupboardFinishSelection,
  type CupboardRenderFinish,
  type CupboardThreeViewMode,
} from '@/lib/configurator/render/cupboardThreeModel';
import type { CupboardConfig } from '@/lib/configurator/templates/types';

interface CupboardThreePreviewProps {
  config: CupboardConfig;
  height?: number;
}

type RenderMode = 'preview' | 'render';
type RenderLightPreset = 'dim' | 'studio' | 'bright';
type CameraSnapshot = {
  position: THREE.Vector3;
  target: THREE.Vector3;
  up: THREE.Vector3;
};

const DEFAULT_FINISH_SELECTION: CupboardFinishSelection = {
  carcass: 'brookhill',
  fronts: 'white',
};

function downloadBlob(blob: Blob, fileName: string) {
  const anchor = window.document.createElement('a');
  anchor.href = window.URL.createObjectURL(blob);
  anchor.download = fileName;
  anchor.style.display = 'none';
  window.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(anchor.href), 0);
}

function setPreviewShadowVisibility(root: THREE.Object3D | null, visible: boolean) {
  const shadow = root?.getObjectByName('Preview Shadow');
  if (shadow) {
    shadow.visible = visible;
  }
}

export function CupboardThreePreview({ config, height = 420 }: CupboardThreePreviewProps) {
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<CupboardThreeViewMode>(
    config.doorStyle === 'none' ? 'interior' : 'assembly'
  );
  const [renderMode, setRenderMode] = React.useState<RenderMode>('preview');
  const [renderPaused, setRenderPaused] = React.useState(false);
  const [renderLightPreset, setRenderLightPreset] = React.useState<RenderLightPreset>('studio');
  const [finishSelection, setFinishSelection] = React.useState<CupboardFinishSelection>(DEFAULT_FINISH_SELECTION);
  const [brookhillReady, setBrookhillReady] = React.useState(false);
  const [renderError, setRenderError] = React.useState<string | null>(null);
  const [sampleCount, setSampleCount] = React.useState(0);
  const [materialRevision, setMaterialRevision] = React.useState(0);
  const configRef = React.useRef(config);
  const viewModeRef = React.useRef<CupboardThreeViewMode>(config.doorStyle === 'none' ? 'interior' : 'assembly');
  const renderModeRef = React.useRef<RenderMode>('preview');
  const renderPausedRef = React.useRef(false);
  const renderLightPresetRef = React.useRef<RenderLightPreset>('studio');
  const finishSelectionRef = React.useRef<CupboardFinishSelection>(DEFAULT_FINISH_SELECTION);
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const rendererRef = React.useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = React.useRef<THREE.Scene | null>(null);
  const cameraRef = React.useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = React.useRef<any>(null);
  const ensurePathTracerRef = React.useRef<(() => boolean) | null>(null);
  const applyRenderLightingRef = React.useRef<((preset?: RenderLightPreset) => void) | null>(null);
  const invalidatePathTraceRef = React.useRef<(() => void) | null>(null);
  const pathTracerRef = React.useRef<WebGLPathTracerType | null>(null);
  const renderLightsRef = React.useRef<THREE.RectAreaLight[]>([]);
  const previewLightsRef = React.useRef<THREE.Light[]>([]);
  const modelRef = React.useRef<THREE.Object3D | null>(null);
  const animationFrameRef = React.useRef<number | null>(null);
  const resizeObserverRef = React.useRef<ResizeObserver | null>(null);
  const frameSceneRef = React.useRef<((mode?: CupboardThreeViewMode) => void) | null>(null);
  const brookhillTextureRef = React.useRef<THREE.Texture | null>(null);
  const previousViewStateRef = React.useRef<{ configSignature: string; viewMode: CupboardThreeViewMode } | null>(null);

  const configSignature = React.useMemo(() => JSON.stringify(config), [config]);

  React.useEffect(() => {
    configRef.current = config;
  }, [config]);

  React.useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  React.useEffect(() => {
    renderModeRef.current = renderMode;
  }, [renderMode]);

  React.useEffect(() => {
    renderPausedRef.current = renderPaused;
  }, [renderPaused]);

  React.useEffect(() => {
    renderLightPresetRef.current = renderLightPreset;
  }, [renderLightPreset]);

  React.useEffect(() => {
    finishSelectionRef.current = finishSelection;
  }, [finishSelection]);

  React.useEffect(() => {
    if (config.doorStyle === 'none') {
      setViewMode((current) => (current === 'assembly' ? 'interior' : current));
    }
  }, [config.doorStyle]);

  const captureCameraSnapshot = React.useCallback((): CameraSnapshot | null => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) {
      return null;
    }

    return {
      position: camera.position.clone(),
      target: controls.target.clone(),
      up: camera.up.clone(),
    };
  }, []);

  const restoreCameraSnapshot = React.useCallback((snapshot: CameraSnapshot) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) {
      return;
    }

    camera.position.copy(snapshot.position);
    camera.up.copy(snapshot.up);
    controls.target.copy(snapshot.target);
    controls.update();
    camera.updateProjectionMatrix();

    if (pathTracerRef.current) {
      pathTracerRef.current.updateCamera();
      pathTracerRef.current.reset();
      setSampleCount(0);
    } else if (rendererRef.current && sceneRef.current) {
      rendererRef.current.render(sceneRef.current, camera);
    }
  }, []);

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
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
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
          setFinishSelection({
            carcass: 'white',
            fronts: 'white',
          });
        }
      }
    );

    return () => {
      cancelled = true;
      brookhillTextureRef.current?.dispose();
      brookhillTextureRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    async function setup() {
      try {
        const viewport = viewportRef.current;
        if (!viewport) return;

        const [{ OrbitControls }, { WebGLPathTracer }] = await Promise.all([
          import('three/examples/jsm/controls/OrbitControls.js'),
          import('three-gpu-pathtracer'),
        ]);
        if (cancelled || !viewportRef.current) return;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color('#f7f8fb');
        scene.environment = null;

        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          preserveDrawingBuffer: true,
        });
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.25;
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

        previewLightsRef.current = [hemi, keyLight, fillLight];
        scene.add(hemi, keyLight, fillLight);

        const keyArea = new THREE.RectAreaLight('#ffffff', 32, 1200, 1200);
        keyArea.name = 'Render Key Area';
        keyArea.visible = false;
        scene.add(keyArea);

        const fillArea = new THREE.RectAreaLight('#ffffff', 20, 1000, 1000);
        fillArea.name = 'Render Fill Area';
        fillArea.visible = false;
        scene.add(fillArea);

        const topArea = new THREE.RectAreaLight('#ffffff', 24, 1400, 1400);
        topArea.name = 'Render Top Area';
        topArea.visible = false;
        scene.add(topArea);

        renderLightsRef.current = [keyArea, fillArea, topArea];
        viewport.innerHTML = '';
        viewport.appendChild(renderer.domElement);

        const ensurePathTracer = () => {
          if (pathTracerRef.current) {
            return true;
          }

          try {
            const pathTracer = new WebGLPathTracer(renderer);
            pathTracer.renderDelay = 0;
            pathTracer.fadeDuration = 0;
            pathTracer.minSamples = 1;
            pathTracer.dynamicLowRes = true;
            pathTracer.lowResScale = 0.25;
            pathTracer.filterGlossyFactor = 0.25;
            pathTracer.bounces = 5;
            pathTracer.tiles.set(2, 2);
            pathTracer.setScene(scene, camera);
            pathTracerRef.current = pathTracer;
            setRenderError(null);
            return true;
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Render mode is currently unavailable on this device.';
            console.error('Path tracer setup failed', error);
            setRenderError(message);
            return false;
          }
        };

        const frameScene = (nextMode: CupboardThreeViewMode = viewModeRef.current) => {
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
        if (pathTracerRef.current) {
          pathTracerRef.current.updateCamera();
          pathTracerRef.current.reset();
          setSampleCount(0);
        } else {
          renderer.render(scene, camera);
        }
        };

        const applyRenderLighting = (preset: RenderLightPreset = renderLightPresetRef.current) => {
          const exposureByPreset: Record<RenderLightPreset, number> = {
            dim: 0.95,
            studio: 1.08,
            bright: 1.22,
          };
          const intensityMultiplier: Record<RenderLightPreset, number> = {
            dim: 0.72,
            studio: 0.92,
            bright: 1.08,
          };

          renderer.toneMappingExposure = exposureByPreset[preset];

          const multiplier = intensityMultiplier[preset];
          keyLight.intensity = 1.2 * multiplier;
          fillLight.intensity = 0.5 * multiplier;
          hemi.intensity = 1.05 * multiplier;

          keyArea.intensity = 12 * multiplier;
          fillArea.intensity = 8 * multiplier;
          topArea.intensity = 10 * multiplier;
        };
        applyRenderLightingRef.current = applyRenderLighting;

        const syncRenderStage = () => {
          if (!modelRef.current) return;

        const box = new THREE.Box3().setFromObject(modelRef.current);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const span = Math.max(size.x, size.z);
        const roomWidth = Math.max(2200, span * 7.5);
        const roomDepth = Math.max(2200, span * 7.5);

        keyArea.position.set(
          center.x - roomWidth * 0.16,
          box.max.y + size.y * 0.3,
          center.z - roomDepth * 0.16
        );
        keyArea.lookAt(center.x, center.y + size.y * 0.08, center.z);

        fillArea.position.set(
          center.x + roomWidth * 0.18,
          center.y + size.y * 0.18,
          center.z + roomDepth * 0.12
        );
        fillArea.lookAt(center.x, center.y + size.y * 0.08, center.z);

        topArea.position.set(center.x, box.max.y + size.y * 0.55, center.z);
        topArea.lookAt(center.x, center.y, center.z);

        const renderVisible = renderModeRef.current === 'render';
        setPreviewShadowVisibility(modelRef.current, !renderVisible);
        renderLightsRef.current.forEach((light) => {
          light.visible = renderVisible;
        });
        previewLightsRef.current.forEach((light) => {
          light.visible = !renderVisible;
        });

        applyRenderLighting(renderLightPresetRef.current);
        };

        const invalidatePathTrace = () => {
          if (!pathTracerRef.current) return;
          pathTracerRef.current.updateCamera();
          pathTracerRef.current.reset();
          setSampleCount(0);
        };
        invalidatePathTraceRef.current = invalidatePathTrace;
        controls.addEventListener('change', invalidatePathTrace);

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

        const initialPalette = getFinishPalette(
          finishSelectionRef.current,
          brookhillTextureRef.current
        );
        const initialModel = buildCupboardModel(configRef.current, viewModeRef.current, initialPalette);
        scene.add(initialModel);
        modelRef.current = initialModel;
        syncRenderStage();
        ensurePathTracerRef.current = ensurePathTracer;
        if (renderModeRef.current === 'render') {
          ensurePathTracer();
        }

        resizeObserverRef.current = new ResizeObserver(() => resize());
        resizeObserverRef.current.observe(viewport);
        resize();

        const animate = () => {
          if (!rendererRef.current || !sceneRef.current || !cameraRef.current || !controlsRef.current) return;
          controls.update();
          if (renderModeRef.current === 'render' && pathTracerRef.current) {
            if (!renderPausedRef.current) {
              pathTracerRef.current.pausePathTracing = false;
              pathTracerRef.current.renderSample();
              const nextSamples = Math.floor(pathTracerRef.current.samples);
              setSampleCount((current) => (current === nextSamples ? current : nextSamples));
            }
          } else {
            renderer.render(scene, camera);
          }
          animationFrameRef.current = window.requestAnimationFrame(animate);
        };

        animate();
      } catch (error) {
        console.error('Cupboard 3D preview setup failed', error);
        setRenderError(error instanceof Error ? error.message : '3D preview failed to initialize.');
      }
    }

    setup();

    return () => {
      cancelled = true;
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      resizeObserverRef.current?.disconnect();
      ensurePathTracerRef.current = null;
      applyRenderLightingRef.current = null;
      if (controlsRef.current && invalidatePathTraceRef.current) {
        controlsRef.current.removeEventListener('change', invalidatePathTraceRef.current);
      }
      invalidatePathTraceRef.current = null;
      controlsRef.current?.dispose?.();
      pathTracerRef.current?.dispose();
      pathTracerRef.current = null;
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

    const previousViewState = previousViewStateRef.current;
    const shouldPreserveView =
      previousViewState !== null &&
      previousViewState.configSignature === configSignature &&
      previousViewState.viewMode === viewMode;
    const cameraSnapshot = shouldPreserveView ? captureCameraSnapshot() : null;

    if (modelRef.current) {
      scene.remove(modelRef.current);
      disposeObject(modelRef.current);
    }

    const palette = getFinishPalette(
      finishSelection,
      brookhillTextureRef.current
    );
    const model = buildCupboardModel(config, viewMode, palette);
    scene.add(model);
    modelRef.current = model;
    setPreviewShadowVisibility(modelRef.current, renderModeRef.current !== 'render');
    if (modelRef.current) {
      const box = new THREE.Box3().setFromObject(modelRef.current);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const span = Math.max(size.x, size.z);
      const roomWidth = Math.max(2200, span * 7.5);
      const roomDepth = Math.max(2200, span * 7.5);

      const [keyArea, fillArea, topArea] = renderLightsRef.current;
      keyArea?.position.set(center.x - roomWidth * 0.16, box.max.y + size.y * 0.3, center.z - roomDepth * 0.16);
      keyArea?.lookAt(center.x, center.y + size.y * 0.08, center.z);
      fillArea?.position.set(center.x + roomWidth * 0.18, center.y + size.y * 0.18, center.z + roomDepth * 0.12);
      fillArea?.lookAt(center.x, center.y + size.y * 0.08, center.z);
      topArea?.position.set(center.x, box.max.y + size.y * 0.55, center.z);
      topArea?.lookAt(center.x, center.y, center.z);
    }
    if (pathTracerRef.current && cameraRef.current) {
      pathTracerRef.current.setScene(scene, cameraRef.current);
      pathTracerRef.current.reset();
      setSampleCount(0);
    }
    if (cameraSnapshot) {
      restoreCameraSnapshot(cameraSnapshot);
    } else {
      frameSceneRef.current?.(viewMode);
    }

    previousViewStateRef.current = {
      configSignature,
      viewMode,
    };
  }, [captureCameraSnapshot, config, configSignature, restoreCameraSnapshot, viewMode, finishSelection, materialRevision]);

  React.useEffect(() => {
    frameSceneRef.current?.(viewMode);
  }, [isFullscreen, viewMode]);

  React.useEffect(() => {
    if (renderMode === 'render' && !pathTracerRef.current) {
      const ready = ensurePathTracerRef.current?.() ?? false;
      if (!ready) {
        return;
      }
    }

    if (!pathTracerRef.current || !cameraRef.current || !sceneRef.current) return;

    renderLightsRef.current.forEach((light) => {
      light.visible = renderMode === 'render';
    });
    previewLightsRef.current.forEach((light) => {
      light.visible = renderMode !== 'render';
    });
    setPreviewShadowVisibility(modelRef.current, renderMode !== 'render');
    applyRenderLightingRef.current?.(renderLightPresetRef.current);

    pathTracerRef.current.setScene(sceneRef.current, cameraRef.current);
    pathTracerRef.current.reset();
    setSampleCount(0);
  }, [renderMode]);

  React.useEffect(() => {
    if (!rendererRef.current) return;

    applyRenderLightingRef.current?.(renderLightPreset);

    if (pathTracerRef.current && cameraRef.current && sceneRef.current) {
      pathTracerRef.current.setScene(sceneRef.current, cameraRef.current);
      pathTracerRef.current.reset();
      setSampleCount(0);
    }
  }, [renderLightPreset]);

  React.useEffect(() => {
    if (renderMode === 'preview' && renderPaused) {
      setRenderPaused(false);
    }
  }, [renderMode, renderPaused]);

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
    if (pathTracerRef.current) {
      pathTracerRef.current.updateCamera();
      pathTracerRef.current.reset();
      setSampleCount(0);
    }
  }, []);

  const handleDownload = React.useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const dataUrl = renderer.domElement.toDataURL('image/png');
    const blob = fetch(dataUrl).then((response) => response.blob());
    blob.then((resolvedBlob) => {
      downloadBlob(
        resolvedBlob,
        `cupboard-${config.width}x${config.height}x${config.depth}-3d-preview.png`
      );
    });
  }, [config.depth, config.height, config.width]);

  const handleToggleRenderPaused = React.useCallback(() => {
    setRenderPaused((current) => !current);
  }, []);

  const setFinishSlot = React.useCallback((slot: keyof CupboardFinishSelection, finish: CupboardRenderFinish) => {
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
          'mb-2 flex flex-wrap items-center justify-between gap-3',
          isFullscreen && 'border-b px-4 py-3'
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
            <Button
              variant={renderMode === 'preview' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                setRenderMode('preview');
                setRenderPaused(false);
              }}
            >
              Preview
            </Button>
            <Button
              variant={renderMode === 'render' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                setRenderError(null);
                setRenderMode('render');
                setRenderPaused(false);
              }}
            >
              Render
            </Button>
          </div>
          {renderMode === 'render' ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={handleToggleRenderPaused}
                title={renderPaused ? 'Resume render' : 'Pause render'}
              >
                {renderPaused ? 'Resume Render' : 'Pause Render'}
              </Button>
              <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
                <Button
                  variant={renderLightPreset === 'dim' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setRenderLightPreset('dim')}
                >
                  Dim
                </Button>
                <Button
                  variant={renderLightPreset === 'studio' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setRenderLightPreset('studio')}
                >
                  Studio
                </Button>
                <Button
                  variant={renderLightPreset === 'bright' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setRenderLightPreset('bright')}
                >
                  Bright
                </Button>
              </div>
              <span className="rounded border bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
                Samples {sampleCount}
              </span>
            </>
          ) : (
            <span className="hidden text-xs text-muted-foreground md:inline">
              Drag to rotate. Use the pan arrows to nudge the view. Scroll to zoom.
            </span>
          )}
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
          <div className="flex flex-wrap items-center gap-2">
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
              <span className="text-xs text-muted-foreground">Doors</span>
              <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
                <Button
                  variant={finishSelection.fronts === 'white' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setFinishSlot('fronts', 'white')}
                >
                  White
                </Button>
                <Button
                  variant={finishSelection.fronts === 'brookhill' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setFinishSlot('fronts', 'brookhill')}
                  disabled={!brookhillReady}
                >
                  Brookhill
                </Button>
              </div>
            </div>
          </div>
          {renderError ? (
            <span className="max-w-[18rem] truncate rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
              Render: {renderError}
            </span>
          ) : null}
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
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleDownload}
            title="Save PNG"
          >
            <Download className="mr-1 h-3.5 w-3.5" />
            Save PNG
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
