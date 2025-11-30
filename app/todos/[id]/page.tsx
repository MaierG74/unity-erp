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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
// Tooltips removed in redesign
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
import { CheckSquare, Trash2, Plus, GripVertical } from 'lucide-react';
import { TodoChecklistItem } from '@/lib/db/todos';

import { createChecklistItem, updateChecklistItem, deleteChecklistItem } from '@/lib/client/todos';

function TodoChecklist({ todoId, initialItems }: { todoId: string; initialItems: TodoChecklistItem[] }) {
  const [items, setItems] = useState<TodoChecklistItem[]>(initialItems);
  const [newItemTitle, setNewItemTitle] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const { toast } = useToast();

  // Sync with initial items when they change (e.g. refetch)
  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  const addItem = async () => {
    if (!newItemTitle.trim()) return;
    const title = newItemTitle.trim();
    setNewItemTitle('');
    setIsAdding(true);

    try {
      const item = await createChecklistItem(todoId, title);
      setItems(prev => [...prev, item]);
    } catch (error) {
      toast({ title: 'Failed to add item', variant: 'destructive' });
      setNewItemTitle(title); // Restore title on failure
    } finally {
      setIsAdding(false);
    }
  };

  const toggleItem = async (itemId: string, currentStatus: boolean) => {
    // Optimistic update
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, isCompleted: !currentStatus } : i));

    try {
      await updateChecklistItem(todoId, itemId, { isCompleted: !currentStatus });
    } catch (error) {
      toast({ title: 'Failed to update item', variant: 'destructive' });
      // Revert
      setItems(prev => prev.map(i => i.id === itemId ? { ...i, isCompleted: currentStatus } : i));
    }
  };

  const deleteItem = async (itemId: string) => {
    // Optimistic update
    const originalItems = [...items];
    setItems(prev => prev.filter(i => i.id !== itemId));

    try {
      await deleteChecklistItem(todoId, itemId);
    } catch (error) {
      toast({ title: 'Failed to delete item', variant: 'destructive' });
      setItems(originalItems);
    }
  };

  const progress = items.length > 0
    ? Math.round((items.filter(i => i.isCompleted).length / items.length) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {items.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span>{progress}%</span>
        </div>
      )}

      <div className="space-y-2">
        {items.map(item => (
          <div key={item.id} className="group flex items-start gap-2 p-2 hover:bg-muted/30 rounded-md transition-colors">
            <Checkbox
              checked={item.isCompleted}
              onCheckedChange={() => toggleItem(item.id, item.isCompleted)}
              className="mt-0.5"
            />
            <span className={cn("flex-1 text-sm leading-tight break-words", item.isCompleted && "text-muted-foreground line-through")}>
              {item.title}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
              onClick={() => deleteItem(item.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Plus className="h-4 w-4 text-muted-foreground" />
        <Input
          value={newItemTitle}
          onChange={(e) => setNewItemTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addItem();
          }}
          placeholder="Add an item..."
          className="h-8 text-sm border-none shadow-none focus-visible:ring-0 px-0 placeholder:text-muted-foreground"
          disabled={isAdding}
        />
      </div>
    </div>
  );
}

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
  const [isDueDatePickerOpen, setIsDueDatePickerOpen] = useState(false);

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
              return (
                <Popover open={isDueDatePickerOpen} onOpenChange={setIsDueDatePickerOpen}>
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
                        setIsDueDatePickerOpen(false); // Close the popover first
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

      {/* Main Content - Tabs Layout */}
      <div className="max-w-5xl mx-auto p-4">
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-3 lg:w-[400px]">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="discussion">Discussion</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="mt-6 space-y-8">
            {/* Description */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Description</h3>
              {editingDescription ? (
                <Controller
                  control={control}
                  name="description"
                  render={({ field }) => (
                    <Textarea
                      {...field}
                      value={field.value ?? ''}
                      autoFocus
                      rows={8}
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
                  className="group cursor-pointer rounded-md p-4 hover:bg-muted/30 transition-colors relative border border-transparent hover:border-border"
                >
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {description || <span className="text-muted-foreground italic">No description provided. Click to add one.</span>}
                  </p>
                  <Edit2 className="absolute top-4 right-4 h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              )}
              {todo?.updatedAt && (
                <p className="text-xs text-muted-foreground px-4">
                  Last updated {formatDistanceToNow(parseISO(todo.updatedAt), { addSuffix: true })}
                </p>
              )}
            </div>

            <Separator />

            {/* Checklist Section */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Checklist</h3>
              <TodoChecklist todoId={todoId} initialItems={todo.checklist} />
            </div>

            <Separator />

            {/* Watchers Section (Moved from Sidebar) */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Watchers</h3>
              <div className="bg-muted/30 rounded-lg p-4">
                <Controller
                  control={control}
                  name="watchers"
                  render={({ field }) => (
                    <div className="flex flex-wrap gap-3">
                      {profiles
                        .filter(p => p.id !== todo?.assignedTo && p.id !== todo?.createdBy)
                        .map(p => {
                          const checked = field.value.includes(p.id);
                          return (
                            <div
                              key={p.id}
                              className={cn(
                                "flex items-center gap-2 px-3 py-1.5 rounded-full border transition-colors cursor-pointer select-none",
                                checked ? "bg-background border-primary/50 shadow-sm" : "bg-transparent border-transparent hover:bg-background hover:border-border"
                              )}
                              onClick={() => {
                                const next = checked
                                  ? field.value.filter(id => id !== p.id)
                                  : [...field.value, p.id];
                                field.onChange(next);
                                updateField({ watchers: next });
                              }}
                            >
                              <Avatar className="h-5 w-5">
                                {p.avatarUrl && (
                                  <AvatarImage src={p.avatarUrl} alt={p.username ?? ''} />
                                )}
                                <AvatarFallback className="text-[10px]">{initials(p.username)}</AvatarFallback>
                              </Avatar>
                              <span className={cn("text-xs font-medium", checked ? "text-foreground" : "text-muted-foreground")}>
                                {p.username ?? p.email ?? 'Unknown'}
                              </span>
                              {checked && <CheckCircle2 className="h-3 w-3 text-primary" />}
                            </div>
                          );
                        })}
                    </div>
                  )}
                />
              </div>
            </div>
          </TabsContent>

          {/* Discussion Tab (Comments + Activity) */}
          <TabsContent value="discussion" className="mt-6 grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-8">
            {/* Left: Comments */}
            <div className="space-y-6">
              <div className="space-y-4">
                {comments.length > 0 ? (
                  <div className="space-y-6">
                    {comments.map(comment => (
                      <div key={comment.id} className="flex gap-3 group">
                        <Avatar className="h-8 w-8 flex-shrink-0 mt-1">
                          {comment.author?.avatarUrl && (
                            <AvatarImage src={comment.author.avatarUrl} alt={comment.author.username ?? ''} />
                          )}
                          <AvatarFallback className="text-xs">{initials(comment.author?.username)}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{comment.author?.username ?? 'User'}</span>
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(parseISO(comment.createdAt), { addSuffix: true })}
                            </span>
                          </div>
                          <div className="text-sm leading-relaxed text-foreground/90 bg-muted/30 p-3 rounded-r-lg rounded-bl-lg">
                            {comment.body}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 bg-muted/20 rounded-lg border border-dashed">
                    <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                    <p className="text-sm text-muted-foreground">No comments yet. Start the conversation!</p>
                  </div>
                )}
              </div>

              {/* Add Comment Input */}
              <div className="flex gap-3 pt-4 border-t">
                <Avatar className="h-8 w-8 flex-shrink-0">
                  <AvatarFallback className="text-xs">{initials(user?.email)}</AvatarFallback>
                </Avatar>
                <div className="flex-1 space-y-2">
                  <Textarea
                    placeholder="Write a comment..."
                    value={commentBody}
                    onChange={event => setCommentBody(event.target.value)}
                    rows={2}
                    className="min-h-[80px] resize-none text-sm"
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
                      size="sm"
                      onClick={submitComment}
                      disabled={commentMutation.isPending || !commentBody.trim()}
                    >
                      {commentMutation.isPending ? 'Posting...' : 'Post Comment'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Activity Timeline */}
            <div className="space-y-4 pl-0 lg:pl-6 lg:border-l">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Activity Log</h3>
              <div className="relative space-y-6 before:absolute before:inset-0 before:ml-2.5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-muted before:to-transparent">
                {activities.map((activity) => (
                  <div key={activity.id} className="relative flex gap-3 items-start">
                    <span className="absolute left-2.5 -translate-x-1/2 top-2 h-2 w-2 rounded-full bg-muted ring-4 ring-background" />
                    <div className="flex-1 pl-2 space-y-0.5">
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{activity.actor?.username ?? 'Someone'}</span>
                        {' '}
                        {activity.eventType.replace(/_/g, ' ')}
                      </p>
                      <p className="text-[10px] text-muted-foreground/70">
                        {formatDistanceToNow(parseISO(activity.createdAt), { addSuffix: true })}
                      </p>
                      {activity.note && (
                        <p className="text-xs bg-muted/30 p-1.5 rounded mt-1">{activity.note}</p>
                      )}
                    </div>
                  </div>
                ))}
                {activities.length === 0 && (
                  <p className="text-xs text-muted-foreground pl-2">No activity recorded.</p>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Files Tab */}
          <TabsContent value="files" className="mt-6 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Attachments</h3>
              <label htmlFor="file-upload" className="cursor-pointer">
                <div className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm font-medium",
                  uploadingFile && "opacity-50 cursor-not-allowed"
                )}>
                  {uploadingFile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {uploadingFile ? 'Uploading...' : 'Upload File'}
                </div>
                <input
                  id="file-upload"
                  type="file"
                  className="hidden"
                  onChange={handleFileUpload}
                  disabled={uploadingFile}
                />
              </label>
            </div>

            {attachments.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {attachments.map(attachment => {
                  const ext = attachment.fileName.split('.').pop()?.toLowerCase();
                  const sizeKB = attachment.fileSize ? (attachment.fileSize / 1024).toFixed(1) : '?';
                  const isImg = isImage(attachment.fileName);

                  return (
                    <div
                      key={attachment.id}
                      className="group relative rounded-lg border bg-card hover:shadow-md transition-all cursor-pointer overflow-hidden"
                      onClick={() => downloadAttachment(attachment.id, attachment.fileName)}
                    >
                      <div className="aspect-video w-full bg-muted/30 flex items-center justify-center border-b">
                        {isImg ? (
                          <div className="w-full h-full flex items-center justify-center bg-muted/10">
                            <FileIcon className="h-8 w-8 text-muted-foreground/50" />
                            {/* Note: Real image preview would go here if we had a signed URL ready */}
                          </div>
                        ) : (
                          <FileIcon className="h-10 w-10 text-muted-foreground/40" />
                        )}
                      </div>
                      <div className="p-3">
                        <p className="text-sm font-medium truncate" title={attachment.fileName}>{attachment.fileName}</p>
                        <p className="text-xs text-muted-foreground mt-1">{sizeKB} KB • {ext?.toUpperCase()}</p>
                      </div>

                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          size="icon"
                          variant="secondary"
                          className="h-7 w-7 shadow-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadAttachment(attachment.id, attachment.fileName);
                          }}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="destructive"
                          className="h-7 w-7 shadow-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteAttachment(attachment.id);
                          }}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed rounded-lg bg-muted/10">
                <Paperclip className="h-10 w-10 text-muted-foreground/30 mb-3" />
                <p className="text-sm font-medium text-muted-foreground">No files attached</p>
                <p className="text-xs text-muted-foreground mt-1">Upload documents, images, or other files related to this task.</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
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
