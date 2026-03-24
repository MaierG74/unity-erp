'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Switch } from '@/components/ui/switch';
import { BookMarked, ChevronDown, Trash2, Users, User, Loader2 } from 'lucide-react';
import { useSavedViews, useSaveView, useDeleteView } from '@/hooks/use-saved-views';
import { useAuth } from '@/components/common/auth-provider';
import type { ViewConfig } from '@/types/transaction-views';

const TABLE_KEY = 'inventory_transactions';

type Props = {
  config: ViewConfig;
  onLoadView: (config: ViewConfig, viewId: string, viewName: string) => void;
  activeViewId: string | null;
  activeViewName: string | null;
};

export function ViewManager({ config, onLoadView, activeViewId, activeViewName }: Props) {
  const { user } = useAuth();
  const { data: views = [], isLoading } = useSavedViews(TABLE_KEY);
  const saveViewMutation = useSaveView(TABLE_KEY);
  const deleteViewMutation = useDeleteView(TABLE_KEY);

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [viewToDelete, setViewToDelete] = useState<string | null>(null);
  const [viewName, setViewName] = useState('');
  const [isShared, setIsShared] = useState(false);

  const personalViews = views.filter((v) => v.user_id === user?.id && !v.is_shared);
  const sharedViews = views.filter((v) => v.is_shared);

  const handleSave = async () => {
    if (!viewName.trim()) return;
    await saveViewMutation.mutateAsync({
      name: viewName.trim(),
      config,
      isShared,
    });
    setSaveDialogOpen(false);
    setViewName('');
    setIsShared(false);
  };

  const handleDelete = async () => {
    if (!viewToDelete) return;
    await deleteViewMutation.mutateAsync(viewToDelete);
    setDeleteDialogOpen(false);
    setViewToDelete(null);
  };

  const confirmDelete = (viewId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setViewToDelete(viewId);
    setDeleteDialogOpen(true);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-1.5">
            <BookMarked className="h-4 w-4" />
            <span className="hidden sm:inline">
              {activeViewName || 'Views'}
            </span>
            {!activeViewId && activeViewName === null && views.length > 0 && (
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            )}
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[240px]">
          {personalViews.length > 0 && (
            <>
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-1">
                <User className="h-3 w-3" />
                My Views
              </div>
              {personalViews.map((view) => (
                <DropdownMenuItem
                  key={view.view_id}
                  className="flex items-center justify-between"
                  onClick={() => onLoadView(view.config, view.view_id, view.name)}
                >
                  <span className="truncate">{view.name}</span>
                  <button
                    type="button"
                    onClick={(e) => confirmDelete(view.view_id, e)}
                    className="ml-2 p-0.5 rounded-sm hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuItem>
              ))}
            </>
          )}

          {sharedViews.length > 0 && (
            <>
              {personalViews.length > 0 && <DropdownMenuSeparator />}
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Users className="h-3 w-3" />
                Shared Views
              </div>
              {sharedViews.map((view) => (
                <DropdownMenuItem
                  key={view.view_id}
                  className="flex items-center justify-between"
                  onClick={() => onLoadView(view.config, view.view_id, view.name)}
                >
                  <span className="truncate">{view.name}</span>
                  {view.user_id === user?.id && (
                    <button
                      type="button"
                      onClick={(e) => confirmDelete(view.view_id, e)}
                      className="ml-2 p-0.5 rounded-sm hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </DropdownMenuItem>
              ))}
            </>
          )}

          {(personalViews.length > 0 || sharedViews.length > 0) && <DropdownMenuSeparator />}

          <DropdownMenuItem onClick={() => setSaveDialogOpen(true)}>
            Save Current View...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Save Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Save View</DialogTitle>
            <DialogDescription>
              Save your current filters and grouping as a reusable view.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="view-name">View Name</Label>
              <Input
                id="view-name"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                placeholder="e.g., Apollo Stock This Month"
                autoFocus
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="view-shared">Share with team</Label>
                <p className="text-xs text-muted-foreground">
                  Visible to all org members
                </p>
              </div>
              <Switch
                id="view-shared"
                checked={isShared}
                onCheckedChange={setIsShared}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!viewName.trim() || saveViewMutation.isPending}
            >
              {saveViewMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete View</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this saved view? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
