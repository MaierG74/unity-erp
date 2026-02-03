'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, FilePlus, FolderOpen, Save, SaveAll } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

// Import the reusable calculator component
import { CutlistCalculator } from '@/components/features/cutlist/CutlistCalculator';
import type { CutlistCalculatorData } from '@/components/features/cutlist/CutlistCalculator';

// Import save/load
import { useSavedCutlists } from '@/hooks/useSavedCutlists';
import type { SavedCutlistData, SavedCutlistProject } from '@/lib/cutlist/savedProjects';
import { SaveCutlistDialog } from '@/components/features/cutlist/SaveCutlistDialog';
import { LoadCutlistDialog } from '@/components/features/cutlist/LoadCutlistDialog';

// =============================================================================
// Local Storage Keys
// =============================================================================

const PARTS_STORAGE_KEY = 'cutlist-parts';
const OPTIMIZATION_PRIORITY_KEY = 'cutlist-optimization-priority';

// =============================================================================
// Main Page Component
// =============================================================================

export default function CutlistPage() {
  // ============== Save/Load Project State ==============
  const [currentProjectId, setCurrentProjectId] = React.useState<string | null>(null);
  const [currentProjectName, setCurrentProjectName] = React.useState<string | null>(null);
  const [currentFolderId, setCurrentFolderId] = React.useState<string | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = React.useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const {
    folders,
    projects,
    saveProject,
    updateProject,
    deleteProject,
    createFolder,
    renameFolder,
    deleteFolder,
  } = useSavedCutlists();

  // Track current calculator data for save operations
  const calculatorDataRef = React.useRef<CutlistCalculatorData | null>(null);

  // Initial data from loaded project
  const [loadedData, setLoadedData] = React.useState<Partial<CutlistCalculatorData> | undefined>(undefined);
  // Key to force remount of CutlistCalculator when loading a project
  const [calculatorKey, setCalculatorKey] = React.useState(0);

  const handleDataChange = React.useCallback((data: CutlistCalculatorData) => {
    calculatorDataRef.current = data;
  }, []);

  // ============== Save/Load Handlers ==============

  const gatherProjectData = React.useCallback((): SavedCutlistData => {
    const data = calculatorDataRef.current;
    if (!data) {
      return {
        parts: [],
        primaryBoards: [],
        backerBoards: [],
        edging: [],
        kerf: 3,
        optimizationPriority: 'fast',
      };
    }
    return {
      parts: data.parts,
      primaryBoards: data.primaryBoards,
      backerBoards: data.backerBoards,
      edging: data.edging,
      kerf: data.kerf,
      optimizationPriority: data.optimizationPriority,
    };
  }, []);

  const handleSaveProject = React.useCallback(
    async (name: string, folderId: string | null) => {
      setIsSaving(true);
      try {
        const data = gatherProjectData();
        if (currentProjectId) {
          const success = await updateProject(currentProjectId, { name, folderId, data });
          if (success) {
            setCurrentProjectName(name);
            setCurrentFolderId(folderId);
            toast.success(`Saved "${name}"`);
          } else {
            toast.error('Failed to save cutlist');
          }
        } else {
          const project = await saveProject(name, data, folderId);
          if (project) {
            setCurrentProjectId(project.id);
            setCurrentProjectName(name);
            setCurrentFolderId(folderId);
            toast.success(`Saved "${name}"`);
          } else {
            toast.error('Failed to save cutlist');
          }
        }
      } finally {
        setIsSaving(false);
      }
    },
    [currentProjectId, gatherProjectData, saveProject, updateProject]
  );

  const handleQuickSave = React.useCallback(async () => {
    if (!currentProjectId || !currentProjectName) {
      setSaveDialogOpen(true);
      return;
    }
    setIsSaving(true);
    try {
      const data = gatherProjectData();
      const success = await updateProject(currentProjectId, { data });
      if (success) {
        toast.success(`Saved "${currentProjectName}"`);
      } else {
        toast.error('Failed to save cutlist');
      }
    } finally {
      setIsSaving(false);
    }
  }, [currentProjectId, currentProjectName, gatherProjectData, updateProject]);

  const handleLoadProject = React.useCallback((project: SavedCutlistProject) => {
    const d = project.data;
    setLoadedData({
      parts: d.parts ?? [],
      primaryBoards: d.primaryBoards ?? [],
      backerBoards: d.backerBoards ?? [],
      edging: d.edging ?? [],
      kerf: d.kerf,
      optimizationPriority: d.optimizationPriority ?? 'fast',
    });
    setCalculatorKey((k) => k + 1);
    setCurrentProjectId(project.id);
    setCurrentProjectName(project.name);
    setCurrentFolderId(project.folder_id);
    setLoadDialogOpen(false);
    toast.success(`Loaded "${project.name}"`);
  }, []);

  const handleNewProject = React.useCallback(() => {
    setLoadedData({ parts: [], primaryBoards: [], backerBoards: [], edging: [], kerf: 3, optimizationPriority: 'fast' });
    setCalculatorKey((k) => k + 1);
    setCurrentProjectId(null);
    setCurrentProjectName(null);
    setCurrentFolderId(null);
  }, []);

  // ============== Render ==============

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold text-foreground">Cutlist Calculator</h1>
              {currentProjectName && (
                <Badge variant="secondary" className="text-sm font-normal">
                  {currentProjectName}
                </Badge>
              )}
            </div>
            <p className="mt-2 text-sm text-muted-foreground max-w-3xl">
              Run quick board calculations. Enter parts in the compact table, configure materials, and preview optimized
              sheet layouts.
            </p>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleNewProject}
              className="gap-1.5"
              title="New cutlist"
            >
              <FilePlus className="h-4 w-4" />
              New
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLoadDialogOpen(true)}
              className="gap-1.5"
              title="Open saved cutlist"
            >
              <FolderOpen className="h-4 w-4" />
              Open
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleQuickSave}
              disabled={isSaving}
              className="gap-1.5"
              title={currentProjectId ? `Save "${currentProjectName}"` : 'Save cutlist'}
            >
              <Save className="h-4 w-4" />
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSaveDialogOpen(true)}
              className="gap-1.5"
              title="Save as new cutlist"
            >
              <SaveAll className="h-4 w-4" />
              Save As
            </Button>
          </div>
        </div>
      </div>

      <CutlistCalculator
        key={calculatorKey}
        initialData={loadedData}
        onDataChange={handleDataChange}
        loadMaterialDefaults={true}
        saveMaterialDefaults={true}
        partsStorageKey={PARTS_STORAGE_KEY}
        optimizationStorageKey={OPTIMIZATION_PRIORITY_KEY}
      />

      {/* Save/Load Dialogs */}
      <SaveCutlistDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        currentName={currentProjectName ?? undefined}
        currentFolderId={currentFolderId}
        folders={folders}
        onSave={handleSaveProject}
        onCreateFolder={createFolder}
        saving={isSaving}
      />
      <LoadCutlistDialog
        open={loadDialogOpen}
        onOpenChange={setLoadDialogOpen}
        folders={folders}
        projects={projects}
        onLoad={handleLoadProject}
        onDeleteProject={deleteProject}
        onRenameProject={async (id, name) => {
          const success = await updateProject(id, { name });
          return success;
        }}
        onMoveProject={async (id, folderId) => {
          const success = await updateProject(id, { folderId });
          return success;
        }}
        onCreateFolder={createFolder}
        onRenameFolder={renameFolder}
        onDeleteFolder={deleteFolder}
      />
    </div>
  );
}
