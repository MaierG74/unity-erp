'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Room, WallSide } from '../../types/room';
import type { Layer } from '../../types/floorPlan';
import type { ProjectPiece } from '@/lib/roomcraft/types';
import type { CupboardConfig } from '@/lib/configurator/templates/types';
import {
  buildCupboardModel,
  disposeObject,
  getFinishPalette,
  BROOKHILL_TEXTURE_URL,
  type CupboardFinishSelection,
} from '@/lib/configurator/render/cupboardThreeModel';
import { footprintAABB } from '../../utils/blocks';
import type { Opening } from '../../types/room';

const WALL_DEPTH_MM = 60;
const DEFAULT_VISIBLE_WALLS: Record<WallSide, boolean> = {
  north: true,
  south: false,
  east: true,
  west: true,
};

// Builds a wall as a set of panels with openings cut out.
// Local space: X = along wall from left edge, Y = height from floor, Z = wall normal.
// Caller applies world rotation/translation.
function buildWallGroup(
  wallLength: number,
  wallHeight: number,
  openings: Opening[],
  material: THREE.MeshStandardMaterial,
): THREE.Group {
  const group = new THREE.Group();
  const sorted = [...openings].sort((a, b) => a.position - b.position);

  const addRect = (alongStart: number, upStart: number, w: number, h: number) => {
    if (w <= 0 || h <= 0) return;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, WALL_DEPTH_MM), material);
    mesh.position.set(alongStart + w / 2, upStart + h / 2, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  let cursor = 0;
  for (const op of sorted) {
    addRect(cursor, 0, op.position - cursor, wallHeight);
    if (op.distanceFromFloor > 0) addRect(op.position, 0, op.width, op.distanceFromFloor);
    const openingTop = op.distanceFromFloor + op.height;
    addRect(op.position, openingTop, op.width, wallHeight - openingTop);
    cursor = op.position + op.width;
  }
  addRect(cursor, 0, wallLength - cursor, wallHeight);

  return group;
}

interface RoomCraftThreeSceneProps {
  room: Room;
  layers: Layer[];
  pieceMap: Map<string, ProjectPiece>;
  visibleWalls?: Record<WallSide, boolean>;
  className?: string;
}

const ROOM_FINISH: CupboardFinishSelection = { carcass: 'brookhill', fronts: 'white' };

const PLACEHOLDER_COLOR: Record<string, string> = {
  cupboard: '#8b7355',
  pigeonhole: '#6b7280',
  pedestal: '#4b5563',
};

export function RoomCraftThreeScene({ room, layers, pieceMap, visibleWalls, className }: RoomCraftThreeSceneProps) {
  const activeVisibleWalls = visibleWalls ?? DEFAULT_VISIBLE_WALLS;
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<{ update(): void; target: THREE.Vector3; dispose(): void } | null>(null);
  const contentGroupRef = useRef<THREE.Group | null>(null);
  const animFrameRef = useRef<number>(0);
  const textureRef = useRef<THREE.Texture | null>(null);
  const [textureLoaded, setTextureLoaded] = useState(false);
  const [controlsReady, setControlsReady] = useState(false);
  const hasFramedRef = useRef(false);
  const framedRoomIdRef = useRef<string>('');

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f7f8fb');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(28, width / height, 1, 100000);
    cameraRef.current = camera;

    const hemi = new THREE.HemisphereLight('#ffffff', '#cbd5e1', 1.15);
    const keyLight = new THREE.DirectionalLight('#ffffff', 1.2);
    keyLight.position.set(-3000, 4000, -3000);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 500;
    keyLight.shadow.camera.far = 30000;
    keyLight.shadow.camera.left = -8000;
    keyLight.shadow.camera.right = 8000;
    keyLight.shadow.camera.top = 8000;
    keyLight.shadow.camera.bottom = -8000;
    const fillLight = new THREE.DirectionalLight('#ffffff', 0.5);
    fillLight.position.set(3000, 2000, 2000);
    scene.add(hemi, keyLight, fillLight);

    new THREE.TextureLoader().load(BROOKHILL_TEXTURE_URL, (texture) => {
      if (cancelled) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.needsUpdate = true;
      textureRef.current = texture;
      setTextureLoaded(true);
    });

    import('three/examples/jsm/controls/OrbitControls.js').then(({ OrbitControls }) => {
      if (cancelled) return;
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.screenSpacePanning = true;
      controlsRef.current = controls;
      setControlsReady(true);

      const animate = () => {
        animFrameRef.current = requestAnimationFrame(animate);
        controls.update();
        if (rendererRef.current && sceneRef.current && cameraRef.current) {
          rendererRef.current.render(sceneRef.current, cameraRef.current);
        }
      };
      animate();
    });

    const observer = new ResizeObserver(() => {
      const nextWidth = container.clientWidth || 1;
      const nextHeight = container.clientHeight || 1;
      rendererRef.current?.setSize(nextWidth, nextHeight);
      if (cameraRef.current) {
        cameraRef.current.aspect = nextWidth / nextHeight;
        cameraRef.current.updateProjectionMatrix();
      }
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    });
    observer.observe(container);

    return () => {
      cancelled = true;
      observer.disconnect();
      cancelAnimationFrame(animFrameRef.current);
      controlsRef.current?.dispose();
      controlsRef.current = null;
      if (contentGroupRef.current) {
        disposeObject(contentGroupRef.current);
        contentGroupRef.current = null;
      }
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      textureRef.current?.dispose();
      textureRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera) return;
    if (!controlsReady) return;

    if (contentGroupRef.current) {
      scene.remove(contentGroupRef.current);
      disposeObject(contentGroupRef.current);
      contentGroupRef.current = null;
    }

    const contentGroup = new THREE.Group();
    contentGroup.name = 'RoomContent';
    scene.add(contentGroup);
    contentGroupRef.current = contentGroup;

    const palette = getFinishPalette(ROOM_FINISH, textureRef.current);
    const layerById = new Map(layers.map((layer) => [layer.id, layer]));
    const { length: roomLength, width: roomWidth, height: roomHeight } = room.dimensions;

    const floorMat = new THREE.MeshStandardMaterial({ color: '#e2e8f0', roughness: 0.95, metalness: 0 });
    const wallMat = new THREE.MeshStandardMaterial({ color: '#f1f5f9', roughness: 0.9, metalness: 0, side: THREE.DoubleSide });

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(roomLength, roomWidth), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(roomLength / 2, 0, roomWidth / 2);
    floor.receiveShadow = true;
    contentGroup.add(floor);

    const openingsFor = (side: string) => {
      const wall = room.walls.find((w) => w.side === side);
      return wall ? room.openings.filter((o) => o.wallId === wall.id) : [];
    };

    if (activeVisibleWalls.north) {
      // North wall (Z=0): local X = world X (west→east)
      const northGroup = buildWallGroup(roomLength, roomHeight, openingsFor('north'), wallMat);
      northGroup.position.z = -WALL_DEPTH_MM / 2;
      contentGroup.add(northGroup);
    }

    if (activeVisibleWalls.south) {
      // South wall (Z=roomWidth): local X = world X (west→east), shifted outward.
      const southGroup = buildWallGroup(roomLength, roomHeight, openingsFor('south'), wallMat);
      southGroup.position.z = roomWidth + WALL_DEPTH_MM / 2;
      contentGroup.add(southGroup);
    }

    if (activeVisibleWalls.west) {
      // West wall (X=0): local X = world Z (north→south), rotation maps local +X → world +Z
      const westGroup = buildWallGroup(roomWidth, roomHeight, openingsFor('west'), wallMat);
      westGroup.rotation.y = -Math.PI / 2;
      westGroup.position.x = -WALL_DEPTH_MM / 2;
      contentGroup.add(westGroup);
    }

    if (activeVisibleWalls.east) {
      // East wall (X=roomLength): same orientation as west, shifted outward
      const eastGroup = buildWallGroup(roomWidth, roomHeight, openingsFor('east'), wallMat);
      eastGroup.rotation.y = -Math.PI / 2;
      eastGroup.position.x = roomLength + WALL_DEPTH_MM / 2;
      contentGroup.add(eastGroup);
    }

    for (const item of room.items) {
      const layer = layerById.get(item.layerId);
      if (!layer || !layer.visible) continue;

      const footprint = footprintAABB(item);
      const centerX = (footprint.minX + footprint.maxX) / 2;
      const centerZ = (footprint.minY + footprint.maxY) / 2;
      const rotationY = -(item.rotation * Math.PI) / 180;
      const piece = pieceMap.get(item.id);

      if (piece?.furnitureType === 'cupboard' && piece.config) {
        const config = piece.config as CupboardConfig;
        // includePreviewShadow: false — the preview shadow mesh sits at -(topTopY/2)+0.5
        // in local space and corrupts setFromObject bounds, causing the cabinet to float.
        // Real-time shadows via the renderer are used instead.
        const group = buildCupboardModel(config, 'assembly', palette, { includePreviewShadow: false });
        // local Y=0 is the floor-contact point (bottom of adjusters), so setting
        // position.y = layer.z places the cabinet exactly on the layer floor.
        group.position.set(centerX, layer.z, centerZ);
        group.rotation.y = rotationY;
        contentGroup.add(group);
      } else {
        const color = PLACEHOLDER_COLOR[piece?.furnitureType ?? ''] ?? '#94a3b8';
        const geometry = new THREE.BoxGeometry(item.length, item.height, item.depth);
        const material = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(centerX, layer.z + item.height / 2, centerZ);
        mesh.rotation.y = rotationY;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        contentGroup.add(mesh);
      }
    }

    const shouldFrame = !hasFramedRef.current || framedRoomIdRef.current !== room.id;
    if (controls && shouldFrame) {
      const bounds = new THREE.Box3().setFromObject(contentGroup);
      if (!bounds.isEmpty()) {
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        const halfFovY = THREE.MathUtils.degToRad(camera.fov / 2);
        const halfFovX = Math.atan(Math.tan(halfFovY) * camera.aspect);
        const fitHeight = size.y / (2 * Math.tan(halfFovY));
        const fitWidth = size.x / (2 * Math.tan(halfFovX));
        const distance = Math.max(fitHeight, fitWidth, 1000) + size.z * 1.25;
        const direction = new THREE.Vector3(1.25, 0.88, 1.75).normalize();

        camera.position.copy(center).addScaledVector(direction, distance * 1.02);
        camera.near = Math.max(5, distance / 60);
        camera.far = distance * 24;
        camera.updateProjectionMatrix();
        controls.target.copy(center);
        controls.update();
        hasFramedRef.current = true;
        framedRoomIdRef.current = room.id;
      }
    }
  }, [room, layers, pieceMap, textureLoaded, controlsReady, activeVisibleWalls]);

  return <div ref={containerRef} className={className ?? 'h-full w-full'} />;
}
