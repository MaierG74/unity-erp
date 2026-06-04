import type { RoomCraftProject, ProjectPiece } from './types';

const STORAGE_KEY = 'unity-roomcraft:projects';
export const PROJECTS_CHANGED_EVENT = 'roomcraft:projects-changed';

export function canvasStorageKey(projectId: string): string {
  return `unity-roomcraft:project:${projectId}`;
}

export function listProjects(): RoomCraftProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RoomCraftProject[];
  } catch {
    return [];
  }
}

export function getProject(id: string): RoomCraftProject | null {
  return listProjects().find((p) => p.id === id) ?? null;
}

export function saveProject(project: RoomCraftProject): void {
  const projects = listProjects();
  const idx = projects.findIndex((p) => p.id === project.id);
  const updated = { ...project, updatedAt: new Date().toISOString() };
  if (idx >= 0) {
    projects[idx] = updated;
  } else {
    projects.push(updated);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(PROJECTS_CHANGED_EVENT, { detail: { projectId: project.id } }),
    );
  }
}

export function deleteProject(id: string): void {
  const projects = listProjects().filter((p) => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  localStorage.removeItem(canvasStorageKey(id));
}

export function addPieceToProject(projectId: string, piece: ProjectPiece): RoomCraftProject {
  const project = getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  const pieces = [
    ...project.pieces.filter((p) => p.blockId !== piece.blockId),
    piece,
  ];
  const updated = { ...project, pieces };
  saveProject(updated);
  return updated;
}
