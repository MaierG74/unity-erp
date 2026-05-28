import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { RoomCraftProject, ProjectPiece } from '../lib/roomcraft/types';

// Stub localStorage for Node environment
const store: Record<string, string> = {};
globalThis.localStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  key: (i: number) => Object.keys(store)[i] ?? null,
  get length() { return Object.keys(store).length; },
} as unknown as Storage;

import {
  listProjects,
  getProject,
  saveProject,
  deleteProject,
  addPieceToProject,
  canvasStorageKey,
} from '../lib/roomcraft/project-store';

function makeProject(overrides: Partial<RoomCraftProject> = {}): RoomCraftProject {
  return {
    id: crypto.randomUUID(),
    customerId: 1,
    customerName: 'Acme',
    reference: 'Test project',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pieces: [],
    ...overrides,
  };
}

describe('project-store', () => {
  beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

  it('listProjects returns empty array when nothing saved', () => {
    assert.deepEqual(listProjects(), []);
  });

  it('saveProject persists and getProject retrieves it', () => {
    const p = makeProject();
    saveProject(p);
    const fetched = getProject(p.id);
    assert.equal(fetched?.id, p.id);
    assert.equal(fetched?.reference, 'Test project');
  });

  it('listProjects returns all saved projects', () => {
    saveProject(makeProject({ reference: 'A' }));
    saveProject(makeProject({ reference: 'B' }));
    assert.equal(listProjects().length, 2);
  });

  it('saveProject updates an existing project', () => {
    const p = makeProject();
    saveProject(p);
    saveProject({ ...p, reference: 'Updated' });
    assert.equal(getProject(p.id)?.reference, 'Updated');
    assert.equal(listProjects().length, 1);
  });

  it('deleteProject removes it', () => {
    const p = makeProject();
    saveProject(p);
    deleteProject(p.id);
    assert.equal(getProject(p.id), null);
    assert.equal(listProjects().length, 0);
  });

  it('addPieceToProject appends piece and returns updated project', () => {
    const p = makeProject();
    saveProject(p);
    const piece: ProjectPiece = {
      id: crypto.randomUUID(),
      blockId: 'block-1',
      roomId: 'room-1',
      furnitureType: 'cupboard',
      config: { width: 900, height: 1800, depth: 500 } as any,
      parts: [],
      savedAt: new Date().toISOString(),
    };
    const updated = addPieceToProject(p.id, piece);
    assert.equal(updated.pieces.length, 1);
    assert.equal(getProject(p.id)?.pieces.length, 1);
  });

  it('addPieceToProject replaces existing piece for same blockId', () => {
    const p = makeProject();
    saveProject(p);
    const piece: ProjectPiece = {
      id: crypto.randomUUID(),
      blockId: 'block-1',
      roomId: 'room-1',
      furnitureType: 'cupboard',
      config: { width: 900, height: 1800, depth: 500 } as any,
      parts: [],
      savedAt: new Date().toISOString(),
    };
    addPieceToProject(p.id, piece);
    addPieceToProject(p.id, { ...piece, id: crypto.randomUUID(), furnitureType: 'pedestal' });
    const saved = getProject(p.id)!;
    assert.equal(saved.pieces.length, 1);
    assert.equal(saved.pieces[0].furnitureType, 'pedestal');
  });

  it('canvasStorageKey returns correct key', () => {
    assert.equal(canvasStorageKey('abc-123'), 'unity-roomcraft:project:abc-123');
  });
});
