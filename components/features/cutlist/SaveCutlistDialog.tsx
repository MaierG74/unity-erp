'use client';

import * as React from 'react';
import { FolderPlus } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CutlistFolder } from '@/lib/cutlist/savedProjects';

interface SaveCutlistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName?: string;
  currentFolderId?: string | null;
  folders: CutlistFolder[];
  onSave: (name: string, folderId: string | null) => Promise<void>;
  onCreateFolder: (name: string) => Promise<CutlistFolder | null>;
  saving?: boolean;
}

export function SaveCutlistDialog({
  open,
  onOpenChange,
  currentName,
  currentFolderId,
  folders,
  onSave,
  onCreateFolder,
  saving,
}: SaveCutlistDialogProps) {
  const [name, setName] = React.useState(currentName ?? '');
  const [folderId, setFolderId] = React.useState<string | null>(
    currentFolderId ?? null
  );
  const [creatingFolder, setCreatingFolder] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setName(currentName ?? '');
      setFolderId(currentFolderId ?? null);
      setCreatingFolder(false);
      setNewFolderName('');
    }
  }, [open, currentName, currentFolderId]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await onSave(trimmed, folderId);
    onOpenChange(false);
  };

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    const folder = await onCreateFolder(trimmed);
    if (folder) {
      setFolderId(folder.id);
      setCreatingFolder(false);
      setNewFolderName('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save Cutlist</DialogTitle>
          <DialogDescription>
            Save the current cutlist so you can load it later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="cutlist-name">Name</Label>
            <Input
              id="cutlist-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Kitchen Cabinets"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>Folder</Label>
            <div className="flex gap-2">
              <Select
                value={folderId ?? '__root__'}
                onValueChange={(v) =>
                  setFolderId(v === '__root__' ? null : v)
                }
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="No folder (root)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root__">No folder (root)</SelectItem>
                  {folders.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => setCreatingFolder(!creatingFolder)}
                title="New folder"
              >
                <FolderPlus className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {creatingFolder && (
            <div className="flex gap-2">
              <Input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="New folder name"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolder();
                  if (e.key === 'Escape') setCreatingFolder(false);
                }}
              />
              <Button
                type="button"
                size="sm"
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim()}
              >
                Create
              </Button>
            </div>
          )}
        </div>
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
            onClick={handleSave}
            disabled={!name.trim() || saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
