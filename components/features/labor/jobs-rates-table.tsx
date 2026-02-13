'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { format } from 'date-fns';
import {
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Trash2,
  Loader2,
  ExternalLink,
  Keyboard,
  Briefcase,
} from 'lucide-react';
import { CreateJobModal } from './create-job-modal';
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

// Types
interface JobCategory {
  category_id: number;
  name: string;
  description: string | null;
  current_hourly_rate: number;
}

interface LaborRole {
  role_id: number;
  name: string;
  color: string | null;
}

interface HourlyRate {
  rate_id: number;
  job_id: number;
  hourly_rate: number;
  effective_date: string;
  end_date: string | null;
}

interface PieceRate {
  rate_id: number;
  job_id: number;
  product_id: number | null;
  rate: number;
  effective_date: string;
  end_date: string | null;
}

interface JobWithRates {
  job_id: number;
  name: string;
  description: string | null;
  category_id: number;
  role_id?: number | null;
  estimated_minutes?: number | null;
  time_unit?: string | null;
  category?: JobCategory;
  labor_roles?: LaborRole | null;
  currentHourlyRate: number | null;
  currentPieceRate: number | null;
}

// Editable rate cell component
function EditableRateCell({
  value,
  suffix,
  onSave,
  placeholder,
}: {
  value: number | null;
  suffix: string;
  onSave: (newValue: number) => Promise<void>;
  placeholder?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const startEditing = () => {
    setEditValue(value?.toString() ?? '');
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditValue('');
  };

  const saveValue = async () => {
    const parsed = parseFloat(editValue);
    if (isNaN(parsed) || parsed < 0) {
      cancelEditing();
      return;
    }
    if (value !== null && Math.abs(parsed - value) < 0.001) {
      cancelEditing();
      return;
    }
    setIsSaving(true);
    try {
      await onSave(parsed);
      setIsEditing(false);
    } catch {
      // Error handled by mutation's onError
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveValue();
    } else if (e.key === 'Escape') {
      cancelEditing();
    }
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground text-xs">R</span>
        <Input
          ref={inputRef}
          type="number"
          step="0.01"
          min="0"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={saveValue}
          onKeyDown={handleKeyDown}
          className="h-7 w-24 text-sm"
          disabled={isSaving}
        />
        {isSaving && <Loader2 className="h-3 w-3 animate-spin" />}
      </div>
    );
  }

  return (
    <button
      onClick={startEditing}
      className="text-sm hover:bg-muted/50 px-2 py-1 rounded transition-colors cursor-pointer text-left"
      title="Click to edit"
    >
      {value !== null ? (
        <span className="font-medium">R{value.toFixed(2)}{suffix}</span>
      ) : (
        <span className="text-muted-foreground italic text-xs">{placeholder || 'Set rate'}</span>
      )}
    </button>
  );
}

// Keyboard shortcuts tooltip
function KeyboardShortcutsHelp() {
  const shortcuts = [
    { key: '/', description: 'Focus search' },
    { key: 'N', description: 'Add new job' },
    { key: 'E', description: 'Expand / collapse all' },
  ];

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" className="h-9 gap-1.5 text-muted-foreground">
            <Keyboard className="h-4 w-4" />
            <span className="text-xs hidden sm:inline">Shortcuts</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" className="p-3">
          <p className="text-xs font-semibold mb-2">Keyboard Shortcuts</p>
          <div className="space-y-1.5">
            {shortcuts.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-4">
                <span className="text-xs text-muted-foreground">{s.description}</span>
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-muted border rounded">
                  {s.key}
                </kbd>
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function JobsRatesTable() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // URL-based filter state
  const [searchQuery, setSearchQuery] = useState(() => searchParams?.get('q') || '');
  const [categoryFilter, setCategoryFilter] = useState<string>(
    () => searchParams?.get('category') || ''
  );
  const [collapsedCategories, setCollapsedCategories] = useState<Set<number>>(new Set());
  const [hasInitializedCollapsed, setHasInitializedCollapsed] = useState(false);
  const [expandedJobs, setExpandedJobs] = useState<Set<number>>(new Set());
  const [isAddJobOpen, setIsAddJobOpen] = useState(false);
  const [deleteJob, setDeleteJob] = useState<JobWithRates | null>(null);

  // Persist filters to URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (categoryFilter) params.set('category', categoryFilter);
    const queryString = params.toString();
    const newUrl = queryString ? `?${queryString}` : window.location.pathname;
    window.history.replaceState(null, '', newUrl);
  }, [searchQuery, categoryFilter]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't fire shortcuts when typing in inputs/textareas
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return;
      }

      if (e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setIsAddJobOpen(true);
      } else if (e.key === 'e' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        toggleAllCategories();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  // Fetch categories
  const { data: categories = [] } = useQuery({
    queryKey: ['jobCategories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_categories')
        .select('*')
        .order('name');
      if (error) throw error;
      return data as JobCategory[];
    },
  });

  // Fetch all jobs with relations
  const { data: allJobs = [], isLoading: jobsLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select(`
          job_id, name, description, category_id, role_id,
          estimated_minutes, time_unit,
          job_categories (category_id, name, description, current_hourly_rate),
          labor_roles (role_id, name, color)
        `)
        .order('name');
      if (error) throw error;
      return (data || []).map((job: any) => ({
        ...job,
        category: job.job_categories,
        labor_roles: job.labor_roles,
      }));
    },
  });

  // Fetch current hourly rates (end_date IS NULL = current)
  const { data: hourlyRates = [] } = useQuery({
    queryKey: ['all-job-hourly-rates-current'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_hourly_rates')
        .select('rate_id, job_id, hourly_rate, effective_date, end_date')
        .is('end_date', null);
      if (error) throw error;
      return (data || []) as HourlyRate[];
    },
  });

  // Fetch current piece rates (job defaults only: product_id IS NULL, end_date IS NULL)
  const { data: pieceRates = [] } = useQuery({
    queryKey: ['all-piece-rates-current'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('piece_work_rates')
        .select('rate_id, job_id, product_id, rate, effective_date, end_date')
        .is('product_id', null)
        .is('end_date', null);
      if (error) throw error;
      return (data || []) as PieceRate[];
    },
  });

  // Build lookup maps for rates
  const hourlyRateMap = useMemo(() => {
    const map = new Map<number, number>();
    hourlyRates.forEach((r) => map.set(r.job_id, r.hourly_rate));
    return map;
  }, [hourlyRates]);

  const pieceRateMap = useMemo(() => {
    const map = new Map<number, number>();
    pieceRates.forEach((r) => map.set(r.job_id, r.rate));
    return map;
  }, [pieceRates]);

  // Merge jobs with their current rates
  const jobsWithRates: JobWithRates[] = useMemo(() => {
    return allJobs.map((job: any) => ({
      ...job,
      currentHourlyRate: hourlyRateMap.get(job.job_id) ?? null,
      currentPieceRate: pieceRateMap.get(job.job_id) ?? null,
    }));
  }, [allJobs, hourlyRateMap, pieceRateMap]);

  // Filter jobs
  const filteredJobs = useMemo(() => {
    let filtered = jobsWithRates;
    if (categoryFilter) {
      filtered = filtered.filter((j) => j.category_id.toString() === categoryFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (j) =>
          j.name.toLowerCase().includes(q) ||
          j.description?.toLowerCase().includes(q) ||
          j.category?.name.toLowerCase().includes(q) ||
          j.labor_roles?.name.toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [jobsWithRates, categoryFilter, searchQuery]);

  // Group jobs by category
  const groupedJobs = useMemo(() => {
    const groups = new Map<number, { category: JobCategory; jobs: JobWithRates[] }>();
    filteredJobs.forEach((job) => {
      const catId = job.category_id;
      if (!groups.has(catId)) {
        groups.set(catId, {
          category: job.category || { category_id: catId, name: 'Uncategorized', description: null, current_hourly_rate: 0 },
          jobs: [],
        });
      }
      groups.get(catId)!.jobs.push(job);
    });
    return Array.from(groups.values()).sort((a, b) =>
      a.category.name.localeCompare(b.category.name)
    );
  }, [filteredJobs]);

  // Initialize collapsedCategories to all categories on first render only
  useEffect(() => {
    if (!hasInitializedCollapsed && groupedJobs.length > 0) {
      setCollapsedCategories(new Set(groupedJobs.map((g) => g.category.category_id)));
      setHasInitializedCollapsed(true);
    }
  }, [groupedJobs, hasInitializedCollapsed]);

  // Toggle category collapse
  const toggleCategory = (categoryId: number) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  };

  // Toggle all categories
  const toggleAllCategories = () => {
    if (collapsedCategories.size === groupedJobs.length) {
      setCollapsedCategories(new Set());
    } else {
      setCollapsedCategories(new Set(groupedJobs.map((g) => g.category.category_id)));
    }
  };

  // Toggle job expansion (rate history)
  const toggleJobExpanded = (jobId: number) => {
    setExpandedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  // Inline hourly rate save mutation
  const saveHourlyRate = useMutation({
    mutationFn: async ({ jobId, newRate }: { jobId: number; newRate: number }) => {
      const today = new Date().toISOString().split('T')[0];
      const { data: current } = await supabase
        .from('job_hourly_rates')
        .select('rate_id')
        .eq('job_id', jobId)
        .is('end_date', null)
        .maybeSingle();
      if (current) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        await supabase
          .from('job_hourly_rates')
          .update({ end_date: yesterday.toISOString().split('T')[0] })
          .eq('rate_id', current.rate_id);
      }
      const { error } = await supabase
        .from('job_hourly_rates')
        .insert({ job_id: jobId, hourly_rate: newRate, effective_date: today, end_date: null });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-job-hourly-rates-current'] });
      queryClient.invalidateQueries({ queryKey: ['job-hourly-rates'] });
      toast({ title: 'Rate updated', description: 'New hourly rate version created' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to update hourly rate', variant: 'destructive' });
    },
  });

  // Inline piece rate save mutation
  const savePieceRate = useMutation({
    mutationFn: async ({ jobId, newRate }: { jobId: number; newRate: number }) => {
      const today = new Date().toISOString().split('T')[0];
      const { data: current } = await supabase
        .from('piece_work_rates')
        .select('rate_id')
        .eq('job_id', jobId)
        .is('product_id', null)
        .is('end_date', null)
        .maybeSingle();
      if (current) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        await supabase
          .from('piece_work_rates')
          .update({ end_date: yesterday.toISOString().split('T')[0] })
          .eq('rate_id', current.rate_id);
      }
      const { error } = await supabase
        .from('piece_work_rates')
        .insert({ job_id: jobId, product_id: null, rate: newRate, effective_date: today, end_date: null });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-piece-rates-current'] });
      queryClient.invalidateQueries({ queryKey: ['piece-rates'] });
      toast({ title: 'Rate updated', description: 'New piece rate version created' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to update piece rate', variant: 'destructive' });
    },
  });

  // Delete job mutation
  const deleteJobMutation = useMutation({
    mutationFn: async (jobId: number) => {
      const { error } = await supabase.from('jobs').delete().eq('job_id', jobId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast({ title: 'Success', description: 'Job deleted' });
      setDeleteJob(null);
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to delete job. It may be in use.', variant: 'destructive' });
      setDeleteJob(null);
    },
  });

  // Format estimated time
  const formatEstTime = (minutes: number | null | undefined, unit: string | null | undefined) => {
    if (!minutes) return '--';
    if (unit === 'hours') return `${minutes}h`;
    if (unit === 'seconds') return `${minutes}s`;
    return `${minutes}m`;
  };

  // Stats
  const stats = useMemo(() => {
    const total = jobsWithRates.length;
    const withHourly = jobsWithRates.filter((j) => j.currentHourlyRate !== null).length;
    const withPiece = jobsWithRates.filter((j) => j.currentPieceRate !== null).length;
    return { total, withHourly, withPiece, categoryCount: categories.length };
  }, [jobsWithRates, categories]);

  return (
    <div className="space-y-3">
      {/* Stats bar */}
      <div className="flex items-center gap-6 text-sm text-muted-foreground">
        <span><strong className="text-foreground">{stats.total}</strong> jobs</span>
        <span><strong className="text-foreground">{stats.categoryCount}</strong> categories</span>
        <span><strong className="text-foreground">{stats.withHourly}</strong> with hourly rates</span>
        <span><strong className="text-foreground">{stats.withPiece}</strong> with piece rates</span>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button onClick={() => setIsAddJobOpen(true)} size="sm" className="h-9">
            <Plus className="h-4 w-4 mr-2" />
            Add Job
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={toggleAllCategories}
            title={collapsedCategories.size === groupedJobs.length ? 'Expand all' : 'Collapse all'}
          >
            <ChevronsUpDown className="h-4 w-4" />
          </Button>
          <KeyboardShortcutsHelp />
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder="Search jobs...  /"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 pl-9"
            />
          </div>
          <Select
            value={categoryFilter || '_all'}
            onValueChange={(v) => setCategoryFilter(v === '_all' ? '' : v)}
          >
            <SelectTrigger className="h-9 w-full sm:w-48">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.category_id} value={c.category_id.toString()}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {jobsLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading jobs...
            </div>
          ) : groupedJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Briefcase className="h-10 w-10 mb-3 opacity-40" />
              <p className="font-medium text-foreground">
                {searchQuery || categoryFilter ? 'No jobs match your filters' : 'No jobs defined yet'}
              </p>
              <p className="text-sm mt-1">
                {searchQuery || categoryFilter
                  ? 'Try adjusting your search or category filter'
                  : 'Get started by adding your first job'}
              </p>
              {!searchQuery && !categoryFilter && (
                <Button onClick={() => setIsAddJobOpen(true)} size="sm" className="mt-4">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Job
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-auto max-h-[calc(100vh-320px)]">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Job Name</TableHead>
                    <TableHead className="w-32">Hourly Rate</TableHead>
                    <TableHead className="w-32">Piece Rate</TableHead>
                    <TableHead className="w-28">Role</TableHead>
                    <TableHead className="w-24">Est. Time</TableHead>
                    <TableHead className="w-24 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupedJobs.map((group) => {
                    const isCollapsed = collapsedCategories.has(group.category.category_id);
                    return (
                      <GroupSection
                        key={group.category.category_id}
                        group={group}
                        isCollapsed={isCollapsed}
                        onToggleCollapse={() => toggleCategory(group.category.category_id)}
                        expandedJobs={expandedJobs}
                        onToggleJobExpanded={toggleJobExpanded}
                        onSaveHourlyRate={(jobId, rate) =>
                          saveHourlyRate.mutateAsync({ jobId, newRate: rate })
                        }
                        onSavePieceRate={(jobId, rate) =>
                          savePieceRate.mutateAsync({ jobId, newRate: rate })
                        }
                        onEditJob={(job) => router.push(`/labor/jobs/${job.job_id}`)}
                        onDeleteJob={(job) => setDeleteJob(job)}
                        formatEstTime={formatEstTime}
                      />
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Job Modal */}
      <CreateJobModal
        isOpen={isAddJobOpen}
        onClose={() => setIsAddJobOpen(false)}
        onJobCreated={() => {
          queryClient.invalidateQueries({ queryKey: ['jobs'] });
          setIsAddJobOpen(false);
        }}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteJob} onOpenChange={(open) => !open && setDeleteJob(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Job</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteJob?.name}&quot;? This cannot be undone.
              Jobs that are used in a Bill of Labour cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteJob && deleteJobMutation.mutate(deleteJob.job_id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteJobMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Group section component
function GroupSection({
  group,
  isCollapsed,
  onToggleCollapse,
  expandedJobs,
  onToggleJobExpanded,
  onSaveHourlyRate,
  onSavePieceRate,
  onEditJob,
  onDeleteJob,
  formatEstTime,
}: {
  group: { category: JobCategory; jobs: JobWithRates[] };
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  expandedJobs: Set<number>;
  onToggleJobExpanded: (jobId: number) => void;
  onSaveHourlyRate: (jobId: number, rate: number) => Promise<void>;
  onSavePieceRate: (jobId: number, rate: number) => Promise<void>;
  onEditJob: (job: JobWithRates) => void;
  onDeleteJob: (job: JobWithRates) => void;
  formatEstTime: (m: number | null | undefined, u: string | null | undefined) => string;
}) {
  return (
    <>
      {/* Category group header row */}
      <TableRow
        className="bg-muted/40 hover:bg-muted/60 cursor-pointer border-t-2 border-border"
        onClick={onToggleCollapse}
      >
        <TableCell className="py-2">
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell className="py-2 font-semibold" colSpan={2}>
          {group.category.name}
          <span className="text-muted-foreground font-normal ml-2 text-sm">
            ({group.jobs.length} {group.jobs.length === 1 ? 'job' : 'jobs'})
          </span>
        </TableCell>
        <TableCell className="py-2 text-sm text-muted-foreground" colSpan={4}>
          Category rate: R{group.category.current_hourly_rate.toFixed(2)}/hr
        </TableCell>
      </TableRow>

      {/* Job rows */}
      {!isCollapsed &&
        group.jobs.map((job) => (
          <JobRow
            key={job.job_id}
            job={job}
            isExpanded={expandedJobs.has(job.job_id)}
            onToggleExpanded={() => onToggleJobExpanded(job.job_id)}
            onSaveHourlyRate={onSaveHourlyRate}
            onSavePieceRate={onSavePieceRate}
            onEdit={() => onEditJob(job)}
            onDelete={() => onDeleteJob(job)}
            formatEstTime={formatEstTime}
          />
        ))}
    </>
  );
}

// Individual job row
function JobRow({
  job,
  isExpanded,
  onToggleExpanded,
  onSaveHourlyRate,
  onSavePieceRate,
  onEdit,
  onDelete,
  formatEstTime,
}: {
  job: JobWithRates;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onSaveHourlyRate: (jobId: number, rate: number) => Promise<void>;
  onSavePieceRate: (jobId: number, rate: number) => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
  formatEstTime: (m: number | null | undefined, u: string | null | undefined) => string;
}) {
  return (
    <>
      <TableRow className="hover:bg-muted/20">
        <TableCell className="py-2">
          <button
            onClick={onToggleExpanded}
            className="p-0.5 hover:bg-muted rounded transition-colors"
            title="View rate history"
          >
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
        </TableCell>
        <TableCell className="py-2">
          <div className="flex items-center gap-2">
            <button
              onClick={onEdit}
              className="font-medium text-sm hover:underline text-left"
              title="Open job details"
            >
              {job.name}
            </button>
          </div>
          {job.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{job.description}</p>
          )}
        </TableCell>
        <TableCell className="py-2">
          <EditableRateCell
            value={job.currentHourlyRate}
            suffix="/hr"
            onSave={(v) => onSaveHourlyRate(job.job_id, v)}
          />
        </TableCell>
        <TableCell className="py-2">
          <EditableRateCell
            value={job.currentPieceRate}
            suffix="/pc"
            onSave={(v) => onSavePieceRate(job.job_id, v)}
          />
        </TableCell>
        <TableCell className="py-2">
          {job.labor_roles ? (
            <Badge
              style={{ backgroundColor: job.labor_roles.color || undefined }}
              className="text-white text-xs"
            >
              {job.labor_roles.name}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">--</span>
          )}
        </TableCell>
        <TableCell className="py-2 text-sm text-muted-foreground">
          {formatEstTime(job.estimated_minutes, job.time_unit)}
        </TableCell>
        <TableCell className="py-2 text-right">
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} title="Edit job">
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={onDelete}
              title="Delete job"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </TableCell>
      </TableRow>

      {/* Expanded rate history */}
      {isExpanded && (
        <TableRow className="bg-muted/10">
          <TableCell colSpan={7} className="py-3 px-4">
            <RateHistoryPanel jobId={job.job_id} jobName={job.name} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// Rate history panel shown when a job row is expanded
function RateHistoryPanel({ jobId, jobName }: { jobId: number; jobName: string }) {
  const { data: hourlyHistory = [], isLoading: hourlyLoading } = useQuery({
    queryKey: ['job-hourly-rates', jobId.toString()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_hourly_rates')
        .select('rate_id, job_id, hourly_rate, effective_date, end_date')
        .eq('job_id', jobId)
        .order('effective_date', { ascending: false });
      if (error) throw error;
      return (data || []) as HourlyRate[];
    },
  });

  const { data: pieceHistory = [], isLoading: pieceLoading } = useQuery({
    queryKey: ['piece-rates-history', jobId.toString()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('piece_work_rates')
        .select('rate_id, job_id, product_id, rate, effective_date, end_date')
        .eq('job_id', jobId)
        .is('product_id', null)
        .order('effective_date', { ascending: false });
      if (error) throw error;
      return (data || []) as PieceRate[];
    },
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-6">
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
          Hourly Rate History
        </h4>
        {hourlyLoading ? (
          <p className="text-xs text-muted-foreground">Loading...</p>
        ) : hourlyHistory.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No hourly rate history</p>
        ) : (
          <div className="space-y-1">
            {hourlyHistory.map((r) => (
              <div
                key={r.rate_id}
                className="flex items-center justify-between text-xs py-1 px-2 rounded bg-background border"
              >
                <span className="font-medium">R{r.hourly_rate.toFixed(2)}/hr</span>
                <span className="text-muted-foreground">
                  {format(new Date(r.effective_date), 'dd MMM yyyy')}
                  {' - '}
                  {r.end_date ? format(new Date(r.end_date), 'dd MMM yyyy') : 'Current'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
          Piece Rate History
        </h4>
        {pieceLoading ? (
          <p className="text-xs text-muted-foreground">Loading...</p>
        ) : pieceHistory.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No piece rate history</p>
        ) : (
          <div className="space-y-1">
            {pieceHistory.map((r) => (
              <div
                key={r.rate_id}
                className="flex items-center justify-between text-xs py-1 px-2 rounded bg-background border"
              >
                <span className="font-medium">R{r.rate.toFixed(2)}/pc</span>
                <span className="text-muted-foreground">
                  {format(new Date(r.effective_date), 'dd MMM yyyy')}
                  {' - '}
                  {r.end_date ? format(new Date(r.end_date), 'dd MMM yyyy') : 'Current'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
