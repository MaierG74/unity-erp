'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow, parseISO, format } from 'date-fns';
import { CheckCircle2, Loader2, MessageSquare, CalendarIcon, Paperclip, Upload, X, Download, FileIcon, ExternalLink } from 'lucide-react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/components/common/auth-provider';
import { formatDate } from '@/lib/date-utils';
import { cn } from '@/lib/utils';

import { TODO_PRIORITIES, TODO_STATUSES, type TodoItem } from '@/lib/db/todos';
import {
  useAcknowledgeTodo,
  useAddTodoComment,
  useTodoDetail,
  useUpdateTodo,
  useUploadTodoAttachment,
  useDeleteTodoAttachment,
} from '@/hooks/useTodosApi';
import { useProfiles } from '@/hooks/useProfiles';
import { TodoEntityLinkPicker } from './TodoEntityLinkPicker';
import type { EntityLink } from '@/lib/client/entity-links';

const formSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(4000).nullable(),
  status: z.enum(TODO_STATUSES),
  priority: z.enum(TODO_PRIORITIES),
  dueDate: z.date().nullable(),
  assignedTo: z.string().uuid().nullable(),
  watchers: z.array(z.string().uuid()),
  contextPath: z.string().max(255).nullable(),
  contextType: z.string().max(64).nullable(),
  contextId: z.string().uuid().nullable(),
});

type FormValues = z.infer<typeof formSchema>;

interface TodoDetailDialogProps {
  todoId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function initials(name?: string | null) {
  if (!name) return '?';
  const parts = name.split(' ').filter(Boolean);
  if (parts.length === 0) return name.slice(0, 2).toUpperCase();
  return parts
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function TodoDetailDialog({ todoId, open, onOpenChange }: TodoDetailDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const profilesQuery = useProfiles();
  const updateMutation = useUpdateTodo(todoId);
  const commentMutation = useAddTodoComment(todoId);
  const acknowledgeMutation = useAcknowledgeTodo(todoId);
  const uploadAttachmentMutation = useUploadTodoAttachment(todoId);
  const deleteAttachmentMutation = useDeleteTodoAttachment(todoId);

  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [selectedLink, setSelectedLink] = useState<EntityLink | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: '',
      description: null,
      status: 'open',
      priority: 'medium',
      dueDate: null,
      assignedTo: null,
      watchers: [],
      contextPath: null,
      contextType: null,
      contextId: null,
    },
  });

  const { data, isLoading } = useTodoDetail(todoId);
  const todo = data?.todo ?? null;
  const activities = data?.activities ?? [];
  const comments = data?.comments ?? [];
  const attachments = data?.attachments ?? [];

  useEffect(() => {
    if (todo) {
      reset({
        title: todo.title,
        description: todo.description ?? null,
        status: todo.status,
        priority: todo.priority,
        dueDate: todo.dueAt ? parseISO(todo.dueAt) : null,
        assignedTo: todo.assignedTo ?? null,
        watchers: todo.watchers.map(w => w.userId),
        contextPath: todo.contextPath ?? null,
        contextType: todo.contextType ?? null,
        contextId: todo.contextId ?? null,
      });

      if (todo.contextPath) {
        const snapshot = todo.contextSnapshot && typeof todo.contextSnapshot === 'object' ? todo.contextSnapshot : null;
        const label =
          (snapshot && typeof snapshot.label === 'string' && snapshot.label) ||
          todo.contextPath;
        setSelectedLink({
          type: (todo.contextType ?? 'order') as EntityLink['type'],
          id: todo.contextId ?? '',
          path: todo.contextPath,
          label,
          meta: snapshot,
        });
      } else {
        setSelectedLink(null);
      }
    }
  }, [todo, reset]);

  const profiles = profilesQuery.data ?? [];
  const watcherOptions = useMemo(() => profiles, [profiles]);

  const canAcknowledge = useMemo(() => {
    if (!todo || !user) return false;
    return todo.createdBy === user.id && todo.status === 'done' && !todo.acknowledgedAt;
  }, [todo, user]);

  const onSubmit = async (values: FormValues) => {
    if (!todoId) return;
    try {
      const payload = {
        title: values.title,
        description: values.description,
        status: values.status,
        priority: values.priority,
        dueAt: values.dueDate
          ? new Date(new Date(values.dueDate).setHours(23, 59, 59, 999)).toISOString()
          : null,
        assignedTo: values.assignedTo ?? undefined,
        watchers: values.watchers,
        contextPath: selectedLink?.path ?? null,
        contextType: selectedLink?.type ?? null,
        contextId: selectedLink?.id ?? null,
        contextSnapshot: selectedLink?.meta ?? null,
      } as const;

      await updateMutation.mutateAsync(payload);
      toast({ title: 'Task updated' });
    } catch (error) {
      console.error('Failed to update todo', error);
      toast({
        title: 'Update failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const [commentBody, setCommentBody] = useState('');

  const submitComment = async () => {
    if (!todoId || !commentBody.trim()) return;
    try {
      await commentMutation.mutateAsync(commentBody.trim());
      setCommentBody('');
    } catch (error) {
      console.error('Failed to add comment', error);
      toast({
        title: 'Could not add comment',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const onAcknowledge = async () => {
    if (!todoId) return;
    try {
      await acknowledgeMutation.mutateAsync();
      toast({ title: 'Completion acknowledged' });
    } catch (error) {
      console.error('Failed to acknowledge', error);
      toast({
        title: 'Acknowledge failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !todoId) return;

    setUploadingFile(true);
    try {
      await uploadAttachmentMutation.mutateAsync(file);
      toast({ title: 'Attachment uploaded successfully' });
      // Reset the input
      event.target.value = '';
    } catch (error) {
      console.error('Failed to upload attachment', error);
      toast({
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setUploadingFile(false);
    }
  };

  const handleDeleteAttachment = async (attachmentId: string) => {
    if (!todoId) return;
    try {
      await deleteAttachmentMutation.mutateAsync(attachmentId);
      toast({ title: 'Attachment deleted' });
    } catch (error) {
      console.error('Failed to delete attachment', error);
      toast({
        title: 'Delete failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const downloadAttachment = async (attachmentId: string, fileName: string) => {
    try {
      const response = await fetch(`/api/todos/${todoId}/attachments/${attachmentId}`);
      if (!response.ok) throw new Error('Failed to get download URL');
      const { url } = await response.json();

      // Open in new tab for download
      window.open(url, '_blank');
    } catch (error) {
      console.error('Failed to download attachment', error);
      toast({
        title: 'Download failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Task Details</DialogTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                router.push(`/todos/${todoId}`);
                onOpenChange(false);
              }}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Open in full view
            </Button>
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="flex min-h-[200px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !todo ? (
          <div className="py-10 text-center text-muted-foreground">Task not found or you no longer have access.</div>
        ) : (
          <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <input type="hidden" {...register('contextPath')} />
              <input type="hidden" {...register('contextType')} />
              <input type="hidden" {...register('contextId')} />

              <div>
                <Controller
                  control={control}
                  name="title"
                  render={({ field }) => (
                    <Input
                      id="title"
                      {...field}
                      className="text-2xl font-semibold border-0 px-0 shadow-none focus-visible:ring-0"
                      placeholder="Task title..."
                    />
                  )}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="description" className="text-sm text-muted-foreground">Description</Label>
                <Controller
                  control={control}
                  name="description"
                  render={({ field }) => (
                    <Textarea
                      id="description"
                      rows={5}
                      {...field}
                      value={field.value ?? ''}
                      placeholder="Add more details..."
                      className="resize-none"
                    />
                  )}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <Controller
                    control={control}
                    name="status"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TODO_STATUSES.map(status => (
                            <SelectItem key={status} value={status} className="capitalize">
                              {status.replace(/_/g, ' ')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>

                <div className="grid gap-2">
                  <Label className="text-xs text-muted-foreground">Priority</Label>
                  <Controller
                    control={control}
                    name="priority"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TODO_PRIORITIES.map(priority => (
                            <SelectItem key={priority} value={priority} className="capitalize">
                              {priority.replace(/_/g, ' ')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>

                <div className="grid gap-2">
                  <Label className="text-xs text-muted-foreground">Due date</Label>
                  <Controller
                    control={control}
                    name="dueDate"
                    render={({ field }) => (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              'justify-start text-left font-normal',
                              !field.value && 'text-muted-foreground'
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {field.value ? formatDate(field.value) : <span>Pick a date</span>}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value || undefined}
                            onSelect={field.onChange}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    )}
                  />
                </div>

                <div className="grid gap-2">
                  <Label className="text-xs text-muted-foreground">Assignee</Label>
                  <Controller
                    control={control}
                    name="assignedTo"
                    render={({ field }) => {
                      const UNASSIGNED = 'unassigned';
                      return (
                        <Select
                          value={field.value ?? UNASSIGNED}
                          onValueChange={value => field.onChange(value === UNASSIGNED ? null : value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select teammate" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                            {profiles.map(profile => (
                              <SelectItem key={profile.id} value={profile.id}>
                                {profile.display_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      );
                    }}
                  />
                </div>
              </div>

              <details className="group">
                <summary className="flex cursor-pointer items-center justify-between rounded-lg border bg-muted/20 px-4 py-3 hover:bg-muted/30 transition-colors">
                  <span className="text-sm font-medium">Watchers</span>
                  <svg className="h-4 w-4 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                <div className="mt-2 px-1">
                  <Label className="text-xs text-muted-foreground">Select watchers</Label>
                <Controller
                  control={control}
                  name="watchers"
                  render={({ field }) => (
                    <div className="max-h-32 space-y-2 overflow-y-auto rounded-md border p-3">
                      {watcherOptions.map(profile => {
                        const checked = field.value?.includes(profile.id) ?? false;
                        return (
                          <label key={profile.id} className="flex cursor-pointer items-center gap-2 text-sm">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={value => {
                                if (value) {
                                  const next = new Set(field.value ?? []);
                                  next.add(profile.id);
                                  field.onChange(Array.from(next));
                                } else {
                                  field.onChange((field.value ?? []).filter(id => id !== profile.id));
                                }
                              }}
                            />
                            <span>{profile.display_name}</span>
                          </label>
                        );
                      })}
                      {watcherOptions.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No teammates found.</p>
                      ) : null}
                    </div>
                  )}
                />
                </div>
              </details>

              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label>Linked record</Label>
                    <p className="text-sm text-muted-foreground">
                      Update or clear the record this task references.
                    </p>
                  </div>
                  <Button type="button" variant="outline" onClick={() => setLinkPickerOpen(true)}>
                    Select record
                  </Button>
                </div>

                {selectedLink ? (
                  <div className="rounded-md border bg-muted/30 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium leading-tight">{selectedLink.label}</p>
                        <p className="text-sm text-muted-foreground">{selectedLink.path}</p>
                      </div>
                      <Badge variant="outline" className="capitalize">
                        {selectedLink.type.replace('_', ' ')}
                      </Badge>
                    </div>
                    {selectedLink.meta && Object.keys(selectedLink.meta).length > 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {Object.entries(selectedLink.meta)
                          .filter(([, value]) => typeof value === 'string' && value)
                          .map(([, value]) => value as string)
                          .join(' • ')}
                      </p>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      className="mt-2 h-8 px-2 text-xs text-muted-foreground"
                      onClick={() => {
                        setSelectedLink(null);
                        setValue('contextPath', null, { shouldDirty: true });
                        setValue('contextType', null, { shouldDirty: true });
                        setValue('contextId', null, { shouldDirty: true });
                      }}
                    >
                      Clear link
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No record linked.</p>
                )}
              </div>

              <div className="flex items-center gap-3">
                <Button type="submit" disabled={isSubmitting || updateMutation.isPending}>
                  {isSubmitting || updateMutation.isPending ? 'Saving...' : 'Save changes'}
                </Button>
                {canAcknowledge ? (
                  <Button type="button" variant="outline" onClick={onAcknowledge} disabled={acknowledgeMutation.isPending}>
                    {acknowledgeMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    Acknowledge completion
                  </Button>
                ) : null}
              </div>
            </form>

            <div className="space-y-4">
              <details className="group">
                <summary className="flex cursor-pointer items-center justify-between rounded-lg border bg-muted/20 px-4 py-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Activity</span>
                    <Badge variant="outline" className="ml-2">
                      {activities.length}
                    </Badge>
                  </div>
                  <svg className="h-4 w-4 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>

                <div className="mt-2 px-1">
                  <TooltipProvider>
                    <div className="space-y-4">
                      {activities.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No activity logged yet.</p>
                      ) : (
                        activities.map(activity => (
                          <div key={activity.id} className="flex items-start gap-3">
                            <Avatar className="h-8 w-8">
                              {activity.actor?.avatarUrl ? (
                                <AvatarImage src={activity.actor.avatarUrl} alt={activity.actor.username ?? 'actor'} />
                              ) : null}
                              <AvatarFallback>{initials(activity.actor?.username)}</AvatarFallback>
                            </Avatar>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{activity.actor?.username ?? 'Someone'}</span>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="text-xs text-muted-foreground cursor-help">
                                      {formatDistanceToNow(parseISO(activity.createdAt), { addSuffix: true })}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{format(parseISO(activity.createdAt), 'PPpp')}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {activity.eventType.replace(/_/g, ' ')}
                                {activity.note ? ` – ${activity.note}` : ''}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </TooltipProvider>
                </div>
              </details>

              <details className="group" open>
                <summary className="flex cursor-pointer items-center justify-between rounded-lg border bg-muted/20 px-4 py-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Comments</span>
                    <Badge variant="outline" className="ml-2">
                      <MessageSquare className="mr-1 h-3 w-3" /> {comments.length}
                    </Badge>
                  </div>
                  <svg className="h-4 w-4 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>

                <div className="mt-2 px-1">
                  <TooltipProvider>
                    <div className="space-y-4">
                      {comments.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Be the first to leave a note.</p>
                      ) : (
                        comments.map(comment => (
                          <div key={comment.id} className="rounded-lg border p-3">
                            <div className="mb-2 flex items-center gap-2">
                              <Avatar className="h-8 w-8">
                                {comment.author?.avatarUrl ? (
                                  <AvatarImage src={comment.author.avatarUrl} alt={comment.author.username ?? 'Author'} />
                                ) : null}
                                <AvatarFallback>{initials(comment.author?.username)}</AvatarFallback>
                              </Avatar>
                              <div>
                                <div className="text-sm font-medium">{comment.author?.username ?? 'User'}</div>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="text-xs text-muted-foreground cursor-help">
                                      {formatDistanceToNow(parseISO(comment.createdAt), { addSuffix: true })}
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{format(parseISO(comment.createdAt), 'PPpp')}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                            </div>
                            <p className="text-sm text-foreground">{comment.body}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </TooltipProvider>

                  <div className="space-y-2 mt-4">
                    <Textarea
                      placeholder="Leave a comment"
                      value={commentBody}
                      onChange={event => setCommentBody(event.target.value)}
                      rows={3}
                    />
                    <div className="flex items-center gap-2">
                      <Button type="button" onClick={submitComment} disabled={commentMutation.isPending || !commentBody.trim()}>
                        {commentMutation.isPending ? 'Posting...' : 'Add comment'}
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setCommentBody('')}>
                        Clear
                      </Button>
                    </div>
                  </div>
                </div>
              </details>

              <details className="group" open>
                <summary className="flex cursor-pointer items-center justify-between rounded-lg border bg-muted/20 px-4 py-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Attachments</span>
                    <Badge variant="outline" className="ml-2">
                      <Paperclip className="mr-1 h-3 w-3" /> {attachments.length}
                    </Badge>
                  </div>
                  <svg className="h-4 w-4 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>

                <div className="mt-2 px-1">
                  <div className="space-y-4">
                    {attachments.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No attachments yet.</p>
                    ) : (
                      attachments.map(attachment => (
                        <div key={attachment.id} className="flex items-start gap-3 rounded-lg border p-3">
                          <div className="flex-shrink-0">
                            <FileIcon className="h-8 w-8 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">{attachment.fileName}</p>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <span>{attachment.uploader?.username ?? 'Unknown'}</span>
                                  <span>•</span>
                                  <span>{attachment.fileSize ? `${(attachment.fileSize / 1024).toFixed(1)} KB` : 'Unknown size'}</span>
                                  <span>•</span>
                                  <span>{formatDistanceToNow(parseISO(attachment.createdAt), { addSuffix: true })}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => downloadAttachment(attachment.id, attachment.fileName)}
                                >
                                  <Download className="h-4 w-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteAttachment(attachment.id)}
                                  disabled={deleteAttachmentMutation.isPending}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="mt-4">
                    <label htmlFor="file-upload" className="cursor-pointer">
                      <div className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed bg-muted/30 p-4 hover:bg-muted/50 transition-colors">
                        {uploadingFile ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span className="text-sm text-muted-foreground">Uploading...</span>
                          </>
                        ) : (
                          <>
                            <Upload className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Click to upload file</span>
                          </>
                        )}
                      </div>
                    </label>
                    <input
                      id="file-upload"
                      type="file"
                      className="hidden"
                      onChange={handleFileUpload}
                      disabled={uploadingFile}
                    />
                  </div>
                </div>
              </details>
            </div>
          </div>
        )}
      </DialogContent>
      <TodoEntityLinkPicker
        open={linkPickerOpen}
        onOpenChange={setLinkPickerOpen}
        onSelect={link => {
          setSelectedLink(link);
          setValue('contextPath', link.path, { shouldDirty: true });
          setValue('contextType', link.type, { shouldDirty: true });
          setValue('contextId', link.id, { shouldDirty: true });
        }}
      />
    </Dialog>
  );
}
