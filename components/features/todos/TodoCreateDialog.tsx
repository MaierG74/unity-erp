'use client';

import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { useCreateTodo } from '@/hooks/useTodosApi';
import { TODO_PRIORITIES } from '@/lib/db/todos';
import { useProfiles } from '@/hooks/useProfiles';
import { useAuth } from '@/components/common/auth-provider';
import { useToast } from '@/components/ui/use-toast';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/date-utils';
import { cn } from '@/lib/utils';

import { TodoEntityLinkPicker } from './TodoEntityLinkPicker';
import type { EntityLink } from '@/lib/client/entity-links';

const createSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().max(4000).optional(),
  priority: z.enum(TODO_PRIORITIES).default('medium'),
  dueDate: z.date().optional().nullable(),
  assignedTo: z.string().uuid().optional(),
  watchers: z.array(z.string().uuid()).optional(),
  contextPath: z.string().max(255).optional().nullable(),
  contextType: z.string().max(64).optional().nullable(),
  contextId: z.string().uuid().optional().nullable(),
});

type CreateValues = z.infer<typeof createSchema>;

interface TodoCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TodoCreateDialog({ open, onOpenChange }: TodoCreateDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const profilesQuery = useProfiles();
  const createMutation = useCreateTodo();

  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [selectedLink, setSelectedLink] = useState<EntityLink | null>(null);

  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { isDirty, isSubmitting, errors },
  } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      title: '',
      description: '',
      priority: 'medium',
      dueDate: null,
      assignedTo: user?.id,
      watchers: [],
      contextPath: null,
      contextType: null,
      contextId: null,
    },
  });

  useEffect(() => {
    if (!open) {
      reset({
        title: '',
        description: '',
        priority: 'medium',
        dueDate: null,
        assignedTo: user?.id,
        watchers: [],
        contextPath: null,
        contextType: null,
        contextId: null,
      });
      setSelectedLink(null);
    }
  }, [open, reset, user?.id]);

  const onSubmit = async (values: CreateValues) => {
    console.log('Form submitted with values:', values);
    console.log('Form errors:', errors);
    try {
      const dueAt = values.dueDate
        ? new Date(new Date(values.dueDate).setHours(23, 59, 59, 999)).toISOString()
        : null;
      console.log('Submitting todo with dueAt:', dueAt);
      const result = await createMutation.mutateAsync({
        title: values.title,
        description: values.description || null,
        priority: values.priority,
        dueAt,
        assignedTo: values.assignedTo || user?.id,
        watchers: values.watchers?.filter(Boolean),
        contextPath: selectedLink?.path ?? null,
        contextType: selectedLink?.type ?? null,
        contextId: selectedLink?.id ?? null,
        contextSnapshot: selectedLink?.meta ?? null,
      });

      if (result?.todo) {
        toast({ title: 'Task created', description: `Assigned to ${result.todo.assignee?.username ?? 'you'}` });
      } else {
        toast({ title: 'Task created', description: 'The new task is ready.' });
      }

      onOpenChange(false);
      setSelectedLink(null);
      reset();
    } catch (error) {
      console.error('Failed to create todo', error);
      toast({
        title: 'Failed to create task',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const profiles = profilesQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Task</DialogTitle>
          <DialogDescription>Capture the work, pick an owner, and keep watchers in the loop.</DialogDescription>
        </DialogHeader>
        {Object.keys(errors).length > 0 && (
          <div className="rounded-lg bg-destructive/15 p-3 text-sm text-destructive">
            <p className="font-medium">Please fix the following errors:</p>
            <ul className="mt-2 list-disc list-inside">
              {Object.entries(errors).map(([key, error]) => (
                <li key={key}>{key}: {error.message}</li>
              ))}
            </ul>
          </div>
        )}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="max-h-[60vh] overflow-y-auto px-1 space-y-6">
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="title">Title</Label>
                <Input id="title" placeholder="Follow up with supplier..." {...register('title')} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" rows={4} placeholder="Add context or steps..." {...register('description')} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="priority">Priority</Label>
                <Controller
                  control={control}
                  name="priority"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="priority">
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
                <Label htmlFor="dueDate">Due date</Label>
                <Controller
                  control={control}
                  name="dueDate"
                  render={({ field }) => (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            'justify-start text-left font-normal h-9',
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
                <Label htmlFor="assignedTo">Assign to</Label>
                <Controller
                  control={control}
                  name="assignedTo"
                  render={({ field }) => {
                    const UNASSIGNED = 'unassigned';
                    return (
                      <Select
                        value={field.value ?? UNASSIGNED}
                        onValueChange={value => field.onChange(value === UNASSIGNED ? undefined : value)}
                      >
                        <SelectTrigger id="assignedTo">
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

              <div className="grid gap-2">
                <Label>Watchers</Label>
                <div className="max-h-32 space-y-2 overflow-y-auto rounded-md border p-3">
                  {profiles.map(profile => (
                    <Controller
                      key={profile.id}
                      name="watchers"
                      control={control}
                      render={({ field }) => {
                        const checked = field.value?.includes(profile.id) ?? false;
                        return (
                          <label className="flex cursor-pointer items-center gap-2 text-sm">
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
                      }}
                    />
                  ))}
                  {profiles.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No teammates found.</p>
                  ) : null}
                </div>
              </div>
            </div>

            <input type="hidden" {...register('contextPath')} />
            <input type="hidden" {...register('contextType')} />
            <input type="hidden" {...register('contextId')} />

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>Linked record</Label>
                  <p className="text-sm text-muted-foreground">
                    Attach a customer order, supplier order, or quote so the assignee lands on the right screen.
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
                      setValue('contextPath', '', { shouldDirty: true });
                      setValue('contextType', '', { shouldDirty: true });
                      setValue('contextId', undefined, { shouldDirty: true });
                    }}
                  >
                    Clear link
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No record linked yet.</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || createMutation.isPending}>
              {isSubmitting || createMutation.isPending ? 'Creating...' : 'Create task'}
            </Button>
          </DialogFooter>
        </form>
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
