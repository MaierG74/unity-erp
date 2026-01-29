'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  loadFolders as dbLoadFolders,
  loadProjects as dbLoadProjects,
  saveProject as dbSaveProject,
  updateProject as dbUpdateProject,
  deleteProject as dbDeleteProject,
  createFolder as dbCreateFolder,
  renameFolder as dbRenameFolder,
  deleteFolder as dbDeleteFolder,
  type CutlistFolder,
  type SavedCutlistProject,
  type SavedCutlistData,
} from '@/lib/cutlist/savedProjects';

export function useSavedCutlists() {
  const [folders, setFolders] = useState<CutlistFolder[]>([]);
  const [projects, setProjects] = useState<SavedCutlistProject[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [f, p] = await Promise.all([dbLoadFolders(), dbLoadProjects()]);
    setFolders(f);
    setProjects(p);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveProject = useCallback(
    async (name: string, data: SavedCutlistData, folderId?: string | null) => {
      const project = await dbSaveProject(name, data, folderId);
      if (project) {
        setProjects((prev) => [project, ...prev]);
      }
      return project;
    },
    []
  );

  const updateProjectFn = useCallback(
    async (
      id: string,
      updates: { name?: string; folderId?: string | null; data?: SavedCutlistData }
    ) => {
      const success = await dbUpdateProject(id, updates);
      if (success) {
        setProjects((prev) =>
          prev.map((p) => {
            if (p.id !== id) return p;
            return {
              ...p,
              ...(updates.name !== undefined && { name: updates.name }),
              ...(updates.folderId !== undefined && { folder_id: updates.folderId }),
              ...(updates.data !== undefined && { data: updates.data }),
              updated_at: new Date().toISOString(),
            };
          })
        );
      }
      return success;
    },
    []
  );

  const deleteProjectFn = useCallback(async (id: string) => {
    const success = await dbDeleteProject(id);
    if (success) {
      setProjects((prev) => prev.filter((p) => p.id !== id));
    }
    return success;
  }, []);

  const createFolderFn = useCallback(
    async (name: string, parentId?: string | null) => {
      const folder = await dbCreateFolder(name, parentId);
      if (folder) {
        setFolders((prev) => [...prev, folder]);
      }
      return folder;
    },
    []
  );

  const renameFolderFn = useCallback(
    async (id: string, name: string) => {
      const success = await dbRenameFolder(id, name);
      if (success) {
        setFolders((prev) =>
          prev.map((f) => (f.id === id ? { ...f, name } : f))
        );
      }
      return success;
    },
    []
  );

  const deleteFolderFn = useCallback(async (id: string) => {
    const success = await dbDeleteFolder(id);
    if (success) {
      setFolders((prev) => prev.filter((f) => f.id !== id));
      // Projects in deleted folder get folder_id set to null by DB
      setProjects((prev) =>
        prev.map((p) => (p.folder_id === id ? { ...p, folder_id: null } : p))
      );
    }
    return success;
  }, []);

  return {
    folders,
    projects,
    loading,
    saveProject,
    updateProject: updateProjectFn,
    deleteProject: deleteProjectFn,
    createFolder: createFolderFn,
    renameFolder: renameFolderFn,
    deleteFolder: deleteFolderFn,
    refresh,
  };
}
