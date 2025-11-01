'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatDistanceToNow, parseISO, format } from 'date-fns';
import { ArrowLeft, CalendarIcon, CheckCircle2, Loader2, MessageSquare, Paperclip, Upload, X, Download, FileIcon, Edit2, Clock, User, Flag, ChevronDown, ChevronRight } from 'lucide-react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';

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
// Tooltips removed in redesign
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/components/common/auth-provider';
import { formatDate } from '@/lib/date-utils';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';

import { TODO_PRIORITIES, TODO_STATUSES } from '@/lib/db/todos';
import {
  useAcknowledgeTodo,
  useAddTodoComment,
  useTodoDetail,
  useUpdateTodo,
  useUploadTodoAttachment,
  useDeleteTodoAttachment,
} from '@/hooks/useTodosApi';
import { useProfiles } from '@/hooks/useProfiles';
import { TodoEntityLinkPicker } from '@/components/features/todos/TodoEntityLinkPicker';
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

function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('');
}

function statusBadge(status: string) {
  const normalized = status.toLowerCase();

  const statusConfig = {
    done: {
      variant: 'default' as const,
      label: 'Done',
      className: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
      icon: <CheckCircle2 className="h-3 w-3" />
    },
    blocked: {
      variant: 'destructive' as const,
      label: 'Blocked',
      className: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
      icon: <X className="h-3 w-3" />
    },
    in_progress: {
      variant: 'secondary' as const,
      label: 'In Progress',
      className: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
      icon: <Loader2 className="h-3 w-3" />
    },
    archived: {
      variant: 'outline' as const,
      label: 'Archived',
      className: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    },
    open: {
      variant: 'outline' as const,
      label: 'Open',
      className: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    }
  };

  const config = statusConfig[normalized as keyof typeof statusConfig] || statusConfig.open;

  return (
    <Badge variant={config.variant} className={cn('inline-flex items-center gap-1.5 font-medium', config.className)}>
      {config.icon}
      {config.label}
    </Badge>
  );
}

function priorityBadge(priority: string) {
  const normalized = priority.toLowerCase();

  const priorityConfig = {
    urgent: {
      label: 'Urgent',
      className: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
      icon: '🔥'
    },
    high: {
      label: 'High',
      className: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200',
      icon: '⬆️'
    },
    medium: {
      label: 'Medium',
      className: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
      icon: '➡️'
    },
    low: {
      label: 'Low',
      className: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
      icon: '⬇️'
    }
  };

  const config = priorityConfig[normalized as keyof typeof priorityConfig] || priorityConfig.medium;

  return (
    <Badge variant="outline" className={cn('font-medium gap-1.5', config.className)}>
      <span>{config.icon}</span>
      {config.label}
    </Badge>
  );
}

export default function TodoDetailPage() {
  const params = useParams();
  const router = useRouter();
  const todoId = params.id as string;
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
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(true);
  const [attachmentsOpen, setAttachmentsOpen] = useState(true);
  const [isScrolled, setIsScrolled] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { isDirty },
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

      if (todo.contextPath && todo.contextType) {
        setSelectedLink({
          type: todo.contextType as any,
          path: todo.contextPath,
          label: todo.contextPath,
          meta: {},
        });
      }
    }
  }, [todo, reset]);

  // Track scroll position for header shadow
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const profiles = profilesQuery.data ?? [];
  const canAcknowledge =
    todo?.status === 'done' &&
    !todo?.acknowledgedAt &&
    user?.id &&
    (user.id === todo.createdBy || user.id === todo.assignedTo);

  const title = watch('title');
  const description = watch('description');
  const status = watch('status');
  const priority = watch('priority');
  const dueDate = watch('dueDate');
  const assignedTo = watch('assignedTo');

  const onSubmit = async (values: FormValues) => {
    if (!todoId) return;
    try {
      await updateMutation.mutateAsync({
        title: values.title,
        description: values.description,
        status: values.status,
        priority: values.priority,
        dueAt: values.dueDate?.toISOString() ?? null,
        assignedTo: values.assignedTo ?? undefined,
        watchers: values.watchers,
        contextPath: values.contextPath,
        contextType: values.contextType,
        contextId: values.contextId,
      });
      toast({ title: 'Task updated' });
      setEditingTitle(false);
      setEditingDescription(false);
    } catch (error) {
      toast({
        title: 'Update failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const updateField = async (field: Partial<FormValues>) => {
    if (!todoId) return;
    try {
      await updateMutation.mutateAsync({
        ...field,
        dueAt: field.dueDate?.toISOString() ?? (field.dueDate === null ? null : undefined),
      } as any);
      toast({ title: 'Updated' });
    } catch (error) {
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

  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

  const isPreviewable = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'pdf'].includes(ext || '');
  };

  const isImage = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext || '');
  };

  const getAttachmentUrl = async (attachmentId: string) => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      const token = data?.session?.access_token;
      if (!token) throw new Error('Not authenticated');

      const response = await fetch(`/api/todos/${todoId}/attachments/${attachmentId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error('Failed to get download URL');
      const { url } = await response.json();
      return url;
    } catch (error) {
      console.error('Failed to get attachment URL', error);
      return null;
    }
  };

  const downloadAttachment = async (attachmentId: string, fileName: string) => {
    try {
      const url = await getAttachmentUrl(attachmentId);
      if (!url) throw new Error('Failed to get download URL');
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

  // Load preview URLs for attachments
  useEffect(() => {
    const loadPreviews = async () => {
      const urls: Record<string, string> = {};
      for (const attachment of attachments) {
        if (isPreviewable(attachment.fileName)) {
          const url = await getAttachmentUrl(attachment.id);
          if (url) urls[attachment.id] = url;
        }
      }
      setPreviewUrls(urls);
    };
    if (attachments.length > 0) {
      loadPreviews();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!todo) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-lg text-muted-foreground">Task not found</p>
        <Button onClick={() => router.push('/todos')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Tasks
        </Button>
      </div>
    );
  }

  const assignedProfile = profiles.find(p => p.id === assignedTo);

  return (
    <div className="min-h-screen bg-background isolate">
      {/* Sticky Compact Header with Inline Selectors */}
      <div
        className={cn(
          "sticky top-0 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2 transition-shadow duration-200",
          "bg-white dark:bg-gray-950 isolate",
          isScrolled ? "shadow-md" : "shadow-sm"
        )}
        style={{ zIndex: 9999 }}
      >
        {/* Left: Back link + Title */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <button
            onClick={() => router.push('/todos')}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Tasks
          </button>
          <Separator orientation="vertical" className="h-4" />
          <div className="flex-1 min-w-0">
            {editingTitle ? (
              <Controller
                control={control}
                name="title"
                render={({ field }) => (
                  <Input
                    {...field}
                    autoFocus
                    className="text-sm font-semibold border-0 px-0 shadow-none focus-visible:ring-1 focus-visible:ring-primary h-7"
                    placeholder="Task title..."
                    onBlur={() => {
                      if (isDirty) handleSubmit(onSubmit)();
                      setEditingTitle(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (isDirty) handleSubmit(onSubmit)();
                        setEditingTitle(false);
                      }
                      if (e.key === 'Escape') {
                        setEditingTitle(false);
                        reset();
                      }
                    }}
                  />
                )}
              />
            ) : (
              <h1
                onClick={() => setEditingTitle(true)}
                className="text-sm font-semibold cursor-pointer hover:text-muted-foreground transition-colors truncate leading-tight"
              >
                {title}
              </h1>
            )}
          </div>
        </div>

        {/* Right: Inline Metadata Selectors */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Status */}
          <Controller
            control={control}
            name="status"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={(value) => {
                  field.onChange(value);
                  updateField({ status: value as any });
                }}
              >
                <SelectTrigger className="h-8 text-sm rounded-md border-none bg-muted/50 hover:bg-muted">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TODO_STATUSES.map(s => (
                    <SelectItem key={s} value={s}>
                      {statusBadge(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />

          {/* Priority */}
          <Controller
            control={control}
            name="priority"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={(value) => {
                  field.onChange(value);
                  updateField({ priority: value as any });
                }}
              >
                <SelectTrigger className="h-8 text-sm rounded-md border-none bg-muted/50 hover:bg-muted">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TODO_PRIORITIES.map(p => (
                    <SelectItem key={p} value={p}>
                      {priorityBadge(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />

          {/* Assignee */}
          <Controller
            control={control}
            name="assignedTo"
            render={({ field }) => (
              <Select
                value={field.value ?? undefined}
                onValueChange={(value) => {
                  field.onChange(value);
                  updateField({ assignedTo: value });
                }}
              >
                <SelectTrigger className="h-8 text-sm rounded-md border-none bg-muted/50 hover:bg-muted w-[140px]">
                  <SelectValue placeholder="Unassigned">
                    {assignedProfile ? (
                      <div className="flex items-center gap-1.5">
                        <Avatar className="h-4 w-4">
                          {assignedProfile.avatarUrl && (
                            <AvatarImage src={assignedProfile.avatarUrl} />
                          )}
                          <AvatarFallback className="text-[10px]">{initials(assignedProfile.username)}</AvatarFallback>
                        </Avatar>
                        <span className="truncate text-xs">{assignedProfile.username ?? assignedProfile.email}</span>
                      </div>
                    ) : (
                      'Unassigned'
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {profiles.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      <div className="flex items-center gap-2">
                        <Avatar className="h-4 w-4">
                          {p.avatarUrl && <AvatarImage src={p.avatarUrl} />}
                          <AvatarFallback className="text-[10px]">{initials(p.username)}</AvatarFallback>
                        </Avatar>
                        <span className="text-xs">{p.username ?? p.email}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />

          {/* Due Date */}
          <Controller
            control={control}
            name="dueDate"
            render={({ field }) => {
              const [datePickerOpen, setDatePickerOpen] = useState(false);

              return (
                <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 text-sm rounded-md border-none bg-muted/50 hover:bg-muted">
                      <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                      {field.value ? format(field.value, 'MMM d') : 'No date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      mode="single"
                      selected={field.value ?? undefined}
                      onSelect={async (date) => {
                        setDatePickerOpen(false); // Close the popover first
                        await updateField({ dueDate: date ?? null }); // Save directly
                        // Don't call field.onChange - let the refetch update the form
                      }}
                      initialFocus
                      modifiers={{
                        today: new Date(),
                      }}
                      modifiersClassNames={{
                        today: "bg-accent text-accent-foreground font-semibold",
                        selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                      }}
                    />
                  </PopoverContent>
                </Popover>
              );
            }}
          />

          {/* Save Button */}
          {isDirty && (
            <Button size="sm" className="h-8" onClick={handleSubmit(onSubmit)} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
            </Button>
          )}
        </div>
      </div>

      {/* Main Content - Compact Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6 p-4 max-w-6xl mx-auto">
        {/* Left Column - Main Content */}
        <div className="space-y-3">

              {/* Description */}
              <Card className="p-3">
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Description</h3>
                  {editingDescription ? (
                    <Controller
                      control={control}
                      name="description"
                      render={({ field }) => (
                        <Textarea
                          {...field}
                          value={field.value ?? ''}
                          autoFocus
                          rows={5}
                          placeholder="Add a description..."
                          className="resize-none text-sm"
                          onBlur={() => {
                            if (isDirty) handleSubmit(onSubmit)();
                            setEditingDescription(false);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              setEditingDescription(false);
                              reset();
                            }
                          }}
                        />
                      )}
                    />
                  ) : (
                    <div
                      onClick={() => setEditingDescription(true)}
                      className="group cursor-pointer rounded-md p-2 min-h-[80px] hover:bg-muted/50 transition-colors relative"
                    >
                      <p className="text-sm leading-tight whitespace-pre-wrap">
                        {description || 'No description yet...'}
                      </p>
                      <Edit2 className="absolute top-2 right-2 h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  )}
                  {todo?.updatedAt && (
                    <p className="text-xs text-muted-foreground">
                      Edited {formatDistanceToNow(parseISO(todo.updatedAt), { addSuffix: true })}
                    </p>
                  )}
                </div>
              </Card>

              {/* Comments */}
              <Card className="p-3">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">Comments</h3>
                    <Badge variant="secondary" className="h-5 text-xs">{comments.length}</Badge>
                  </div>

                  {/* Comments List */}
                  {comments.length > 0 && (
                    <div className="space-y-2">
                      {comments.map(comment => (
                        <div key={comment.id} className="flex gap-2 p-2 rounded-md border">
                          <Avatar className="h-6 w-6 flex-shrink-0">
                            {comment.author?.avatarUrl && (
                              <AvatarImage src={comment.author.avatarUrl} alt={comment.author.username ?? ''} />
                            )}
                            <AvatarFallback className="text-xs">{initials(comment.author?.username)}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-1.5 mb-0.5">
                              <span className="text-sm font-medium">{comment.author?.username ?? 'User'}</span>
                              <span className="text-xs text-muted-foreground">
                                {formatDistanceToNow(parseISO(comment.createdAt), { addSuffix: true })}
                              </span>
                            </div>
                            <p className="text-sm leading-tight whitespace-pre-wrap">{comment.body}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add Comment */}
                  <div className="space-y-2">
                    <Textarea
                      placeholder="Add a comment..."
                      value={commentBody}
                      onChange={event => setCommentBody(event.target.value)}
                      rows={3}
                      className="text-sm resize-none"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          submitComment();
                        }
                      }}
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Cmd + Enter to submit</span>
                      <Button
                        type="button"
                        size="sm"
                        onClick={submitComment}
                        disabled={commentMutation.isPending || !commentBody.trim()}
                      >
                        {commentMutation.isPending ? 'Posting...' : 'Comment'}
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Attachments */}
              <Card className="p-3">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">Attachments</h3>
                    <Badge variant="secondary" className="h-5 text-xs">{attachments.length}</Badge>
                  </div>

                  {/* Attachments Grid */}
                  {attachments.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {attachments.map(attachment => {
                        const ext = attachment.fileName.split('.').pop()?.toLowerCase();
                        const sizeKB = attachment.fileSize ? (attachment.fileSize / 1024).toFixed(1) : '?';
                        const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext ?? '');

                        return (
                          <div
                            key={attachment.id}
                            className="group relative rounded-md border p-2 hover:bg-muted/50 transition-colors cursor-pointer"
                            onClick={() => downloadAttachment(attachment.id, attachment.fileName)}
                          >
                            <div className="flex flex-col items-center gap-1.5">
                              {isImage ? (
                                <div className="w-full aspect-square rounded-md bg-muted flex items-center justify-center overflow-hidden">
                                  <FileIcon className="h-8 w-8 text-muted-foreground" />
                                </div>
                              ) : (
                                <div className="w-full aspect-square rounded-md bg-muted flex items-center justify-center">
                                  <FileIcon className="h-8 w-8 text-muted-foreground" />
                                </div>
                              )}
                              <div className="w-full text-center">
                                <p className="text-xs font-medium truncate">{attachment.fileName}</p>
                                <p className="text-xs text-muted-foreground">{sizeKB} KB</p>
                              </div>
                            </div>
                            <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                type="button"
                                variant="secondary"
                                size="icon"
                                className="h-6 w-6"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  downloadAttachment(attachment.id, attachment.fileName);
                                }}
                              >
                                <Download className="h-3 w-3" />
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                size="icon"
                                className="h-6 w-6"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteAttachment(attachment.id);
                                }}
                                disabled={deleteAttachmentMutation.isPending}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Upload Button */}
                  <label htmlFor="file-upload" className="block">
                    <div className="flex items-center justify-center gap-2 p-2 border-2 border-dashed rounded-md hover:bg-muted/30 transition-colors cursor-pointer">
                      {uploadingFile ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span className="text-xs text-muted-foreground">Uploading...</span>
                        </>
                      ) : (
                        <>
                          <Upload className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Upload file</span>
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
              </Card>
            </div>

            {/* Right Sidebar - Activity & Watchers */}
            <div className="space-y-3">
              {/* Watchers */}
              <Card className="p-3">
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Watchers</h3>
                  <Controller
                    control={control}
                    name="watchers"
                    render={({ field }) => (
                      <div className="space-y-1.5">
                        {profiles
                          .filter(p => p.id !== todo?.assignedTo && p.id !== todo?.createdBy)
                          .map(p => {
                            const checked = field.value.includes(p.id);
                            return (
                              <div key={p.id} className="flex items-center gap-2">
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={isChecked => {
                                    const next = isChecked
                                      ? [...field.value, p.id]
                                      : field.value.filter(id => id !== p.id);
                                    field.onChange(next);
                                    updateField({ watchers: next });
                                  }}
                                  className="h-4 w-4"
                                />
                                <Avatar className="h-5 w-5">
                                  {p.avatarUrl && (
                                    <AvatarImage src={p.avatarUrl} alt={p.username ?? ''} />
                                  )}
                                  <AvatarFallback className="text-xs">{initials(p.username)}</AvatarFallback>
                                </Avatar>
                                <Label className="text-xs cursor-pointer flex-1">
                                  {p.username ?? p.email ?? 'Unknown'}
                                </Label>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  />
                </div>
              </Card>

              {/* Activity Timeline */}
              <Card className="p-3">
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Activity</h3>

                  {activities.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-1">No activity yet</p>
                  ) : (
                    <div className="space-y-2">
                      {activities.map((activity, index) => (
                        <div key={activity.id} className="flex gap-2 relative">
                          {/* Timeline Line */}
                          {index < activities.length - 1 && (
                            <div className="absolute left-2.5 top-6 bottom-0 w-px bg-border" />
                          )}
                          <Avatar className="h-5 w-5 flex-shrink-0 relative bg-background z-10">
                            {activity.actor?.avatarUrl && (
                              <AvatarImage src={activity.actor.avatarUrl} alt={activity.actor.username ?? ''} />
                            )}
                            <AvatarFallback className="text-xs">{initials(activity.actor?.username)}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0 py-0.5">
                            <p className="text-xs leading-tight">
                              <span className="font-medium">{activity.actor?.username ?? 'Someone'}</span>
                              {' '}
                              <span className="text-muted-foreground">
                                {activity.eventType.replace(/_/g, ' ')}
                              </span>
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatDistanceToNow(parseISO(activity.createdAt), { addSuffix: true })}
                            </p>
                            {activity.note && (
                              <p className="text-xs text-muted-foreground mt-0.5">{activity.note}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </div>

        <TodoEntityLinkPicker
          open={linkPickerOpen}
          onOpenChange={setLinkPickerOpen}
          onSelect={link => {
            setSelectedLink(link);
            setValue('contextPath', link.path, { shouldDirty: true });
            setValue('contextType', link.type, { shouldDirty: true });
            setValue('contextId', link.id ?? null, { shouldDirty: true });
            updateField({ contextPath: link.path, contextType: link.type, contextId: link.id ?? null });
            setLinkPickerOpen(false);
          }}
        />
    </div>
  );
}
