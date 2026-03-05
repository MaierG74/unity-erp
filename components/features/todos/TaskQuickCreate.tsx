'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { CalendarIcon, Link2, X, Loader2 } from 'lucide-react';
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

const PRIORITY_CONFIG: Record<string, { label: string; dotColor: string }> = {
  urgent: { label: 'Urgent', dotColor: 'bg-red-500' },
  high: { label: 'High', dotColor: 'bg-orange-500' },
  medium: { label: 'Medium', dotColor: 'bg-blue-500' },
  low: { label: 'Low', dotColor: 'bg-gray-400' },
};

function initials(name?: string | null): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

const chipBase =
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs border cursor-pointer hover:bg-muted/50 transition-colors select-none border-border';

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

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setTitle('');
      setAssigneeId(user?.id ?? null);
      setPriority('medium');
      setDueDate(null);
      setLinkedContext(detectedContext);
    }
  }, [open, user?.id, detectedContext]);

  const assignee = profiles.find((p) => p.id === assigneeId);
  const assigneeName = assignee?.display_name ?? assignee?.username ?? 'Unassigned';
  const prioCfg = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.medium;

  const handleSubmit = async () => {
    if (!title.trim()) return;

    try {
      await createMutation.mutateAsync({
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
        <DialogHeader>
          <DialogTitle className="text-base">New Task</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Title input */}
          <Input
            autoFocus
            placeholder="What needs to be done?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && title.trim()) {
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
                  {dueDate ? format(dueDate, 'MMM d') : 'No date'}
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

          {/* Footer */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-muted-foreground">Esc to cancel</span>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!title.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? (
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
