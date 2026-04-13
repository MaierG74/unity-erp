// components/features/todos/TaskSidePanel.tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  FileIcon,
  Loader2,
  MoreHorizontal,
  Paperclip,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { useAuth } from '@/components/common/auth-provider';
import {
  useTodoDetail,
  useUpdateTodo,
  useAddTodoComment,
  useUploadTodoAttachment,
  useDeleteTodoAttachment,
  useAcknowledgeTodo,
} from '@/hooks/useTodosApi';
import { useProfiles } from '@/hooks/useProfiles';
import {
  createChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
} from '@/lib/client/todos';
import { TaskMetadataChips } from '@/components/features/todos/TaskMetadataChips';
import { TodoEntityLinkPicker } from '@/components/features/todos/TodoEntityLinkPicker';
import { initials, formatFileSize } from '@/components/features/todos/task-utils';

import type { TodoChecklistItem, TodoComment, TodoActivity } from '@/lib/db/todos';
import type { EntityLink } from '@/lib/client/entity-links';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TaskSidePanelProps {
  todoId: string;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaskSidePanel({ todoId, onClose }: TaskSidePanelProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Data fetching
  const { data, isLoading } = useTodoDetail(todoId);
  const todo = data?.todo ?? null;
  const activities = data?.activities ?? [];
  const comments = data?.comments ?? [];
  const attachments = data?.attachments ?? [];

  // Mutations
  const updateMutation = useUpdateTodo(todoId);
  const commentMutation = useAddTodoComment(todoId);
  const uploadMutation = useUploadTodoAttachment(todoId);
  const deleteMutation = useDeleteTodoAttachment(todoId);
  const acknowledgeMutation = useAcknowledgeTodo(todoId);

  // Profiles for metadata chips
  const { data: profiles } = useProfiles();
  const profileList = (profiles ?? []).map((p) => ({
    id: p.id,
    username: p.username ?? p.display_name ?? null,
    display_name: p.display_name ?? p.username ?? null,
    avatar_url: p.avatar_url ?? null,
  }));

  // ---------------------------------------------------------------------------
  // Title auto-save
  // ---------------------------------------------------------------------------

  const [title, setTitle] = useState('');
  const [titleSaved, setTitleSaved] = useState(false);
  const titleRef = useRef('');

  useEffect(() => {
    if (todo) {
      setTitle(todo.title);
      titleRef.current = todo.title;
    }
  }, [todo]);

  const handleTitleBlur = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === titleRef.current) return;
    titleRef.current = trimmed;
    await updateMutation.mutateAsync({ title: trimmed });
    setTitleSaved(true);
    setTimeout(() => setTitleSaved(false), 1500);
  }, [title, updateMutation]);

  // ---------------------------------------------------------------------------
  // Description auto-save
  // ---------------------------------------------------------------------------

  const [description, setDescription] = useState('');
  const [descSaved, setDescSaved] = useState(false);
  const descRef = useRef('');

  useEffect(() => {
    if (todo) {
      setDescription(todo.description ?? '');
      descRef.current = todo.description ?? '';
    }
  }, [todo]);

  const handleDescBlur = useCallback(async () => {
    const val = description;
    if (val === descRef.current) return;
    descRef.current = val;
    await updateMutation.mutateAsync({ description: val || null });
    setDescSaved(true);
    setTimeout(() => setDescSaved(false), 1500);
  }, [description, updateMutation]);

  // ---------------------------------------------------------------------------
  // Link picker
  // ---------------------------------------------------------------------------

  const [linkPickerOpen, setLinkPickerOpen] = useState(false);

  const handleLinkSelect = useCallback(
    async (link: EntityLink) => {
      await updateMutation.mutateAsync({
        contextType: link.type,
        contextId: link.id,
        contextPath: link.path,
        contextSnapshot: { label: link.label, ...(link.meta ?? {}) },
      });
    },
    [updateMutation],
  );

  // ---------------------------------------------------------------------------
  // Checklist
  // ---------------------------------------------------------------------------

  const [newCheckItem, setNewCheckItem] = useState('');

  const handleAddCheckItem = useCallback(async () => {
    const t = newCheckItem.trim();
    if (!t) return;
    await createChecklistItem(todoId, t);
    setNewCheckItem('');
    queryClient.invalidateQueries({ queryKey: ['todos', 'detail', todoId] });
  }, [newCheckItem, todoId, queryClient]);

  const handleToggleCheck = useCallback(
    async (item: TodoChecklistItem) => {
      await updateChecklistItem(todoId, item.id, {
        isCompleted: !item.isCompleted,
      });
      queryClient.invalidateQueries({ queryKey: ['todos', 'detail', todoId] });
    },
    [todoId, queryClient],
  );

  const handleDeleteCheck = useCallback(
    async (itemId: string) => {
      await deleteChecklistItem(todoId, itemId);
      queryClient.invalidateQueries({ queryKey: ['todos', 'detail', todoId] });
    },
    [todoId, queryClient],
  );

  // ---------------------------------------------------------------------------
  // Attachments
  // ---------------------------------------------------------------------------

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleUploadFiles = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        await uploadMutation.mutateAsync(file);
      }
    },
    [uploadMutation],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length) {
        handleUploadFiles(e.dataTransfer.files);
      }
    },
    [handleUploadFiles],
  );

  const handleDownload = useCallback(
    (attachmentId: string) => {
      window.open(
        `/api/todos/${todoId}/attachments/${attachmentId}?download=1`,
        '_blank',
        'noopener,noreferrer',
      );
    },
    [todoId],
  );

  // ---------------------------------------------------------------------------
  // Comments
  // ---------------------------------------------------------------------------

  const [commentText, setCommentText] = useState('');

  const handlePostComment = useCallback(async () => {
    const body = commentText.trim();
    if (!body) return;
    await commentMutation.mutateAsync(body);
    setCommentText('');
  }, [commentText, commentMutation]);

  // ---------------------------------------------------------------------------
  // Activity log
  // ---------------------------------------------------------------------------

  const [activityOpen, setActivityOpen] = useState(false);

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="w-full md:w-[30rem] border-l-0 md:border-l bg-background flex flex-col h-full overflow-hidden shrink-0">
        <div className="flex items-center justify-between p-3 border-b">
          <Button variant="ghost" size="sm" onClick={onClose}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!todo) {
    return (
      <div className="w-full md:w-[30rem] border-l-0 md:border-l bg-background flex flex-col h-full overflow-hidden shrink-0">
        <div className="flex items-center justify-between p-3 border-b">
          <Button variant="ghost" size="sm" onClick={onClose}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        </div>
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          Task not found.
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Acknowledge banner
  // ---------------------------------------------------------------------------

  const showAckBanner =
    todo.status === 'done' &&
    todo.createdBy === user?.id &&
    !todo.acknowledgedAt;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const checklist = todo.checklist ?? [];

  return (
    <div className="w-full md:w-[30rem] border-l-0 md:border-l bg-background flex flex-col h-full overflow-hidden shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() =>
                updateMutation.mutateAsync({ status: 'archived' })
              }
            >
              Archive
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => router.push(`/todos/${todoId}`)}
            >
              Open full page
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                navigator.clipboard.writeText(
                  `${window.location.origin}/todos/${todoId}`,
                );
              }}
            >
              Copy link
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Acknowledge banner */}
        {showAckBanner && (
          <div className="flex items-center justify-between rounded-md bg-teal-500/15 border border-teal-500/30 px-3 py-2">
            <span className="text-sm text-teal-300">
              This task was completed. Acknowledge?
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="text-teal-300 hover:text-teal-200 hover:bg-teal-500/20"
              onClick={() => acknowledgeMutation.mutateAsync(undefined)}
              disabled={acknowledgeMutation.isPending}
            >
              {acknowledgeMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <Check className="h-3.5 w-3.5 mr-1" />
              )}
              Acknowledge
            </Button>
          </div>
        )}

        {/* Title */}
        <div className="relative">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            className="border-none shadow-none text-xl font-semibold p-0 h-auto focus-visible:ring-0"
            placeholder="Task title"
          />
          {titleSaved && (
            <span className="absolute right-0 top-1/2 -translate-y-1/2 text-xs text-emerald-400">
              Saved
            </span>
          )}
        </div>

        {/* Metadata chips */}
        <TaskMetadataChips
          todo={todo}
          profiles={profileList}
          onUpdate={(field, value) =>
            updateMutation.mutateAsync({ [field]: value })
          }
          onNavigateToLink={
            todo.contextPath
              ? () => router.push(todo.contextPath!)
              : undefined
          }
          onClearLink={() =>
            updateMutation.mutateAsync({
              contextType: null,
              contextId: null,
              contextPath: null,
              contextSnapshot: null,
            })
          }
          onOpenLinkPicker={() => setLinkPickerOpen(true)}
          saving={updateMutation.isPending}
        />

        {/* Description */}
        <div className="relative">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={handleDescBlur}
            rows={1}
            placeholder="Add a description..."
            className="min-h-[120px] resize-none border-none shadow-none p-0 text-sm focus-visible:ring-0"
          />
          {descSaved && (
            <span className="absolute right-0 top-1 text-xs text-emerald-400">
              Saved
            </span>
          )}
        </div>

        <Separator />

        {/* Checklist */}
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Checklist
            {checklist.length > 0 && (
              <span className="ml-1.5 text-muted-foreground/60">
                {checklist.filter((c) => c.isCompleted).length}/
                {checklist.length}
              </span>
            )}
          </h3>

          {checklist.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 group"
            >
              <button
                onClick={() => handleToggleCheck(item)}
                className={cn(
                  'h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                  item.isCompleted
                    ? 'bg-primary border-primary text-primary-foreground'
                    : 'border-border hover:border-primary/50',
                )}
              >
                {item.isCompleted && <Check className="h-3 w-3" />}
              </button>
              <span
                className={cn(
                  'flex-1 text-sm',
                  item.isCompleted && 'line-through text-muted-foreground',
                )}
              >
                {item.title}
              </span>
              <button
                onClick={() => handleDeleteCheck(item.id)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              value={newCheckItem}
              onChange={(e) => setNewCheckItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddCheckItem();
                }
              }}
              placeholder="Add item..."
              className="h-7 text-sm border-none shadow-none p-0 focus-visible:ring-0"
            />
          </div>
        </div>

        <Separator />

        {/* Attachments */}
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Paperclip className="h-3 w-3" />
            Attachments
            {attachments.length > 0 && (
              <span className="text-muted-foreground/60">
                ({attachments.length})
              </span>
            )}
          </h3>

          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-2 group rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors"
            >
              <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              <button
                onClick={() => handleDownload(att.id)}
                className="flex-1 text-left"
              >
                <span className="text-sm truncate block">{att.fileName}</span>
                <span className="text-xs text-muted-foreground">
                  {formatFileSize(att.fileSize)}
                </span>
              </button>
              <button
                onClick={() => deleteMutation.mutateAsync(att.id)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'flex items-center justify-center gap-2 rounded-md border border-dashed p-4 cursor-pointer transition-colors text-xs text-muted-foreground',
              isDragging
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/50',
            )}
          >
            {uploadMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Drop files or click to upload
          </div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            onChange={(e) => {
              if (e.target.files?.length) {
                handleUploadFiles(e.target.files);
                e.target.value = '';
              }
            }}
          />
        </div>

        <Separator />

        {/* Comments */}
        <div className="space-y-3">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Comments
            {comments.length > 0 && (
              <span className="ml-1.5 text-muted-foreground/60">
                ({comments.length})
              </span>
            )}
          </h3>

          {comments.map((c: TodoComment) => (
            <div key={c.id} className="flex gap-2">
              <Avatar className="h-6 w-6 shrink-0 mt-0.5">
                <AvatarFallback className="text-[9px] bg-muted">
                  {initials(
                    c.author?.username ?? c.author?.displayName,
                  )}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium">
                    {c.author?.username ??
                      c.author?.displayName ??
                      'Unknown'}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(c.createdAt), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
                <p className="text-sm text-foreground/90 mt-0.5 whitespace-pre-wrap">
                  {c.body}
                </p>
              </div>
            </div>
          ))}

          {comments.length === 0 && (
            <p className="text-xs text-muted-foreground">No comments yet.</p>
          )}
        </div>

        <Separator />

        {/* Activity log (collapsed) */}
        <div>
          <button
            onClick={() => setActivityOpen((prev) => !prev)}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {activityOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Activity
            {activities.length > 0 && (
              <span className="text-muted-foreground/60">
                ({activities.length})
              </span>
            )}
          </button>

          {activityOpen && (
            <div className="mt-2 space-y-2 pl-1">
              {activities.map((a: TodoActivity) => (
                <div key={a.id} className="flex items-start gap-2 text-xs">
                  <span className="font-medium text-foreground/80">
                    {a.actor?.username ?? a.actor?.displayName ?? 'System'}
                  </span>
                  <span className="text-muted-foreground">
                    {a.eventType.replace(/_/g, ' ')}
                  </span>
                  <span className="text-muted-foreground/60 ml-auto shrink-0">
                    {formatDistanceToNow(new Date(a.createdAt), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
              ))}
              {activities.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No activity recorded.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Sticky comment input */}
      <div className="border-t p-3 flex gap-2">
        <Input
          placeholder="Add a comment..."
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handlePostComment();
            }
          }}
          className="flex-1 text-sm"
          disabled={commentMutation.isPending}
        />
        <Button
          size="sm"
          onClick={handlePostComment}
          disabled={!commentText.trim() || commentMutation.isPending}
        >
          {commentMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            'Post'
          )}
        </Button>
      </div>

      {/* Entity link picker dialog */}
      <TodoEntityLinkPicker
        open={linkPickerOpen}
        onOpenChange={setLinkPickerOpen}
        onSelect={handleLinkSelect}
      />
    </div>
  );
}
