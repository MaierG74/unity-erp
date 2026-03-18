'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDateShort } from '@/lib/date-utils';
import { CalendarIcon, Link2, Paperclip, X, Loader2, FileIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { TODO_PRIORITIES, type TodoPriority } from '@/lib/db/todos';
import { useCreateTodo } from '@/hooks/useTodosApi';
import { useProfiles } from '@/hooks/useProfiles';
import { useAuth } from '@/components/common/auth-provider';
import { useTaskContext, type TaskContext } from '@/hooks/useTaskContext';
import { PRIORITY_CONFIG, initials, chipBase, formatFileSize } from '@/components/features/todos/task-utils';
import { uploadTodoAttachment } from '@/lib/client/todos';

interface TaskQuickCreateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TaskQuickCreate({ open, onOpenChange }: TaskQuickCreateProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const createMutation = useCreateTodo();
  const profilesQuery = useProfiles();
  const profiles = profilesQuery.data ?? [];
  const detectedContext = useTaskContext();

  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [priority, setPriority] = useState<TodoPriority>('medium');
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [linkedContext, setLinkedContext] = useState<TaskContext | null>(detectedContext);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);

  // Staged files (uploaded after task creation)
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setTitle('');
      setAssigneeId(user?.id ?? null);
      setPriority('medium');
      setDueDate(null);
      setLinkedContext(detectedContext);
      setStagedFiles([]);
      setUploading(false);
    }
  }, [open, user?.id, detectedContext]);

  // Paste handler — capture images/files from clipboard
  useEffect(() => {
    if (!open) return;

    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        setStagedFiles((prev) => [...prev, ...files]);
      }
    }

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [open]);

  const addFiles = useCallback((files: FileList | File[]) => {
    setStagedFiles((prev) => [...prev, ...Array.from(files)]);
  }, []);

  const removeFile = useCallback((index: number) => {
    setStagedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const assignee = profiles.find((p) => p.id === assigneeId);
  const assigneeName = assignee?.display_name ?? assignee?.username ?? 'Unassigned';
  const prioCfg = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.medium;

  const handleSubmit = async () => {
    if (!title.trim()) return;

    try {
      const result = await createMutation.mutateAsync({
        title: title.trim(),
        priority,
        assignedTo: assigneeId ?? user?.id,
        dueAt: dueDate
          ? new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate(), 23, 59, 59, 999).toISOString()
          : undefined,
        contextType: linkedContext?.contextType ?? undefined,
        contextId: linkedContext?.contextId ?? undefined,
        contextPath: linkedContext?.contextPath ?? undefined,
        contextSnapshot: linkedContext ? { label: linkedContext.contextLabel } : undefined,
      });

      // Upload staged files if any
      const todoId = result.todo?.id;
      if (todoId && stagedFiles.length > 0) {
        setUploading(true);
        for (const file of stagedFiles) {
          try {
            await uploadTodoAttachment(todoId, file);
          } catch {
            // Non-fatal — task is created, attachment failed
          }
        }
      }

      toast({ title: 'Task created', description: title.trim() });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: 'Failed to create task',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px] p-5">
        <DialogHeader className="pb-1">
          <DialogTitle className="text-base">New Task</DialogTitle>
        </DialogHeader>

        <div
          ref={dropZoneRef}
          className={cn(
            'space-y-4 rounded-lg transition-colors',
            isDragging && 'bg-primary/5 ring-1 ring-primary/30',
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            // Only clear if we're leaving the drop zone, not entering a child
            if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
              setIsDragging(false);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files.length) {
              addFiles(e.dataTransfer.files);
            }
          }}
        >
          {/* Title input */}
          <Input
            autoFocus
            placeholder="What needs to be done?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && title.trim() && !createMutation.isPending && !uploading) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            className="text-sm"
          />

          {/* Chip row */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Assignee chip */}
            <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
              <PopoverTrigger asChild>
                <button className={chipBase}>
                  <Avatar className="h-4 w-4">
                    <AvatarFallback className="text-[8px] bg-muted">
                      {initials(assigneeName)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="max-w-[80px] truncate">{assigneeName}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-1" align="start">
                {profiles.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setAssigneeId(p.id);
                      setAssigneeOpen(false);
                    }}
                    className={cn(
                      'w-full text-left px-2 py-1.5 text-xs rounded flex items-center gap-2 hover:bg-muted transition-colors',
                      assigneeId === p.id && 'bg-muted font-medium'
                    )}
                  >
                    <Avatar className="h-4 w-4">
                      <AvatarFallback className="text-[8px] bg-muted">
                        {initials(p.display_name ?? p.username)}
                      </AvatarFallback>
                    </Avatar>
                    {p.display_name ?? p.username ?? 'Unknown'}
                  </button>
                ))}
              </PopoverContent>
            </Popover>

            {/* Priority chip */}
            <Popover open={priorityOpen} onOpenChange={setPriorityOpen}>
              <PopoverTrigger asChild>
                <button className={chipBase}>
                  <span className={cn('h-2 w-2 rounded-full', prioCfg.dotColor)} />
                  {prioCfg.label}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-36 p-1" align="start">
                {TODO_PRIORITIES.map((p) => {
                  const cfg = PRIORITY_CONFIG[p] ?? PRIORITY_CONFIG.medium;
                  return (
                    <button
                      key={p}
                      onClick={() => {
                        setPriority(p);
                        setPriorityOpen(false);
                      }}
                      className={cn(
                        'w-full text-left px-2 py-1.5 text-xs rounded flex items-center gap-2 hover:bg-muted transition-colors',
                        priority === p && 'bg-muted font-medium'
                      )}
                    >
                      <span className={cn('h-2 w-2 rounded-full', cfg.dotColor)} />
                      {cfg.label}
                    </button>
                  );
                })}
              </PopoverContent>
            </Popover>

            {/* Due date chip */}
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger asChild>
                <button className={chipBase}>
                  <CalendarIcon className="h-3 w-3" />
                  {dueDate ? formatDateShort(dueDate) : 'No date'}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dueDate ?? undefined}
                  onSelect={(date) => {
                    setDueDate(date ?? null);
                    setDateOpen(false);
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>

            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              onChange={(e) => {
                if (e.target.files?.length) {
                  addFiles(e.target.files);
                  e.target.value = '';
                }
              }}
            />
          </div>

          {/* Context link chip */}
          {linkedContext && (
            <div className="flex items-center gap-2">
              <span className={cn(chipBase, 'border-primary/30 bg-primary/10 text-primary')}>
                <Link2 className="h-3 w-3" />
                <span className="max-w-[250px] truncate">{linkedContext.contextLabel}</span>
                <span
                  role="button"
                  className="ml-0.5 hover:text-destructive"
                  onClick={() => setLinkedContext(null)}
                >
                  <X className="h-3 w-3" />
                </span>
              </span>
            </div>
          )}

          {/* Staged files / drop zone */}
          {stagedFiles.length > 0 ? (
            <div className="space-y-1">
              {stagedFiles.map((file, i) => (
                <div
                  key={`${file.name}-${i}`}
                  className="flex items-center gap-2 rounded-md bg-muted/30 px-2 py-1.5 text-xs"
                >
                  <FileIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="flex-1 truncate">{file.name}</span>
                  <span className="text-muted-foreground shrink-0">{formatFileSize(file.size)}</span>
                  <button
                    onClick={() => removeFile(i)}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'flex w-full items-center justify-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-xs text-muted-foreground transition-colors cursor-pointer',
                isDragging
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border/60 hover:border-primary/40 hover:text-foreground',
              )}
            >
              <Paperclip className="h-3.5 w-3.5" />
              Drop, paste, or click to attach files
            </button>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-muted-foreground">Esc to cancel</span>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!title.trim() || createMutation.isPending || uploading}
            >
              {(createMutation.isPending || uploading) ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Create Task
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
