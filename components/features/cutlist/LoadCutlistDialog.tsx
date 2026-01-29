'use client';

import * as React from 'react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FolderPlus,
  FileText,
  Pencil,
  Trash2,
  Check,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type {
  CutlistFolder,
  SavedCutlistProject,
} from '@/lib/cutlist/savedProjects';

interface LoadCutlistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: CutlistFolder[];
  projects: SavedCutlistProject[];
  onLoad: (project: SavedCutlistProject) => void;
  onDeleteProject: (id: string) => Promise<boolean>;
  onRenameProject: (id: string, name: string) => Promise<boolean>;
  onMoveProject: (id: string, folderId: string | null) => Promise<boolean>;
  onCreateFolder: (name: string) => Promise<CutlistFolder | null>;
  onRenameFolder: (id: string, name: string) => Promise<boolean>;
  onDeleteFolder: (id: string) => Promise<boolean>;
}

const dateFormatter = new Intl.DateTimeFormat('en-ZA', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function partCountLabel(project: SavedCutlistProject): string {
  const count = project.data?.parts?.length ?? 0;
  return `${count} part${count === 1 ? '' : 's'}`;
}

export function LoadCutlistDialog({
  open,
  onOpenChange,
  folders,
  projects,
  onLoad,
  onDeleteProject,
  onRenameProject,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: LoadCutlistDialogProps) {
  const [expandedFolders, setExpandedFolders] = React.useState<Set<string>>(
    new Set()
  );
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  const [renamingType, setRenamingType] = React.useState<
    'project' | 'folder'
  >('project');
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(
    null
  );
  const [confirmDeleteType, setConfirmDeleteType] = React.useState<
    'project' | 'folder'
  >('project');
  const [creatingFolder, setCreatingFolder] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setSelectedId(null);
      setRenamingId(null);
      setConfirmDeleteId(null);
      setCreatingFolder(false);
      // Auto-expand all folders
      setExpandedFolders(new Set(folders.map((f) => f.id)));
    }
  }, [open, folders]);

  const toggleFolder = (id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const rootProjects = projects.filter((p) => !p.folder_id);
  const projectsByFolder = React.useMemo(() => {
    const map = new Map<string, SavedCutlistProject[]>();
    for (const p of projects) {
      if (p.folder_id) {
        const list = map.get(p.folder_id) ?? [];
        list.push(p);
        map.set(p.folder_id, list);
      }
    }
    return map;
  }, [projects]);

  const selectedProject = projects.find((p) => p.id === selectedId) ?? null;

  const startRename = (
    id: string,
    currentName: string,
    type: 'project' | 'folder'
  ) => {
    setRenamingId(id);
    setRenameValue(currentName);
    setRenamingType(type);
  };

  const commitRename = async () => {
    if (!renamingId || !renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    if (renamingType === 'project') {
      await onRenameProject(renamingId, renameValue.trim());
    } else {
      await onRenameFolder(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  };

  const handleDelete = async () => {
    if (!confirmDeleteId) return;
    if (confirmDeleteType === 'project') {
      await onDeleteProject(confirmDeleteId);
      if (selectedId === confirmDeleteId) setSelectedId(null);
    } else {
      await onDeleteFolder(confirmDeleteId);
    }
    setConfirmDeleteId(null);
  };

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    await onCreateFolder(trimmed);
    setCreatingFolder(false);
    setNewFolderName('');
  };

  const handleLoadSelected = () => {
    if (selectedProject) {
      onLoad(selectedProject);
      onOpenChange(false);
    }
  };

  const renderProject = (project: SavedCutlistProject) => {
    const isSelected = selectedId === project.id;
    const isRenaming = renamingId === project.id;

    return (
      <div
        key={project.id}
        className={cn(
          'group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-sm',
          isSelected
            ? 'bg-accent text-accent-foreground'
            : 'hover:bg-muted/50'
        )}
        onClick={() => setSelectedId(project.id)}
        onDoubleClick={() => {
          onLoad(project);
          onOpenChange(false);
        }}
      >
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        {isRenaming ? (
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            className="h-6 text-sm py-0 px-1"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setRenamingId(null);
            }}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <span className="truncate flex-1 font-medium">{project.name}</span>
            <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
              {partCountLabel(project)}
            </span>
            <span className="text-xs text-muted-foreground shrink-0 hidden lg:inline">
              {dateFormatter.format(new Date(project.updated_at))}
            </span>
            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                className="p-1 rounded hover:bg-accent"
                onClick={(e) => {
                  e.stopPropagation();
                  startRename(project.id, project.name, 'project');
                }}
                title="Rename"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                className="p-1 rounded hover:bg-destructive/10 text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDeleteId(project.id);
                  setConfirmDeleteType('project');
                }}
                title="Delete"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderFolder = (folder: CutlistFolder) => {
    const isExpanded = expandedFolders.has(folder.id);
    const folderProjects = projectsByFolder.get(folder.id) ?? [];
    const isRenaming = renamingId === folder.id;
    const Icon = isExpanded ? ChevronDown : ChevronRight;
    const FolderIcon = isExpanded ? FolderOpen : Folder;

    return (
      <div key={folder.id}>
        <div className="group flex items-center gap-1 px-2 py-1.5 rounded-md hover:bg-muted/50 cursor-pointer text-sm">
          <button
            className="p-0.5"
            onClick={() => toggleFolder(folder.id)}
          >
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <FolderIcon className="h-4 w-4 shrink-0 text-amber-500" />
          {isRenaming ? (
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="h-6 text-sm py-0 px-1 flex-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRenamingId(null);
              }}
              onBlur={commitRename}
            />
          ) : (
            <>
              <span
                className="truncate flex-1 font-medium"
                onClick={() => toggleFolder(folder.id)}
              >
                {folder.name}
              </span>
              <span className="text-xs text-muted-foreground shrink-0">
                {folderProjects.length}
              </span>
              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  className="p-1 rounded hover:bg-accent"
                  onClick={() =>
                    startRename(folder.id, folder.name, 'folder')
                  }
                  title="Rename folder"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  className="p-1 rounded hover:bg-destructive/10 text-destructive"
                  onClick={() => {
                    setConfirmDeleteId(folder.id);
                    setConfirmDeleteType('folder');
                  }}
                  title="Delete folder"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </>
          )}
        </div>
        {isExpanded && (
          <div className="ml-5 border-l border-border pl-2 space-y-0.5">
            {folderProjects.length === 0 ? (
              <div className="px-3 py-1.5 text-xs text-muted-foreground italic">
                Empty folder
              </div>
            ) : (
              folderProjects.map(renderProject)
            )}
          </div>
        )}
      </div>
    );
  };

  const isEmpty = folders.length === 0 && projects.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Open Cutlist</DialogTitle>
          <DialogDescription>
            Select a saved cutlist to load into the workspace.
          </DialogDescription>
        </DialogHeader>

        {/* Toolbar */}
        <div className="flex gap-2">
          {creatingFolder ? (
            <div className="flex gap-2 flex-1">
              <Input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Folder name"
                autoFocus
                className="h-8 text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolder();
                  if (e.key === 'Escape') setCreatingFolder(false);
                }}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim()}
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8"
                onClick={() => setCreatingFolder(false)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              onClick={() => {
                setCreatingFolder(true);
                setNewFolderName('');
              }}
            >
              <FolderPlus className="h-3.5 w-3.5" />
              New Folder
            </Button>
          )}
        </div>

        {/* File browser */}
        <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[400px] border rounded-md p-2 space-y-0.5">
          {isEmpty ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              No saved cutlists yet
            </div>
          ) : (
            <>
              {folders.map(renderFolder)}
              {rootProjects.length > 0 && folders.length > 0 && (
                <div className="border-t border-border my-2" />
              )}
              {rootProjects.map(renderProject)}
            </>
          )}
        </div>

        {/* Delete confirmation */}
        {confirmDeleteId && (
          <div className="flex items-center gap-2 text-sm bg-destructive/10 border border-destructive/20 rounded-md p-3">
            <span className="flex-1">
              Delete this {confirmDeleteType}
              {confirmDeleteType === 'folder'
                ? '? Projects inside will be moved to root.'
                : '? This cannot be undone.'}
            </span>
            <Button
              size="sm"
              variant="destructive"
              className="h-7"
              onClick={handleDelete}
            >
              Delete
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => setConfirmDeleteId(null)}
            >
              Cancel
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleLoadSelected}
            disabled={!selectedProject}
          >
            Open
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
