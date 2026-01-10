'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Clock,
  TrendingUp,
  TrendingDown,
  BarChart3,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface TimeStats {
  avg_actual_minutes: number | null;
  avg_estimated_minutes: number | null;
  avg_variance_minutes: number | null;
  min_actual_minutes: number | null;
  max_actual_minutes: number | null;
  sample_size: number;
  last_recorded_at: string | null;
}

interface JobTimeAnalysisProps {
  jobId: number;
  productId?: number | null;
}

// Format minutes as a readable duration string
function formatDuration(minutes: number | null): string {
  if (minutes === null) return '-';
  const absMinutes = Math.abs(minutes);
  const hours = Math.floor(absMinutes / 60);
  const mins = Math.round(absMinutes % 60);

  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

// Format variance with sign
function formatVariance(minutes: number | null): string {
  if (minutes === null) return '-';
  const sign = minutes > 0 ? '+' : '';
  return `${sign}${formatDuration(minutes)}`;
}

export function JobTimeAnalysis({ jobId, productId }: JobTimeAnalysisProps) {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['job-time-stats', jobId, productId],
    queryFn: async (): Promise<TimeStats | null> => {
      // Try to call the database function first
      const { data, error } = await supabase.rpc('get_job_time_stats', {
        p_job_id: jobId,
        p_product_id: productId ?? null,
      });

      if (error) {
        console.warn('get_job_time_stats RPC failed, falling back to manual query:', error);
        // Fallback to manual query if function doesn't exist yet
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('job_time_history')
          .select('estimated_minutes, actual_minutes, variance_minutes, recorded_at')
          .eq('job_id', jobId)
          .order('recorded_at', { ascending: false });

        if (fallbackError) throw fallbackError;

        if (!fallbackData || fallbackData.length === 0) {
          return null;
        }

        // Calculate stats manually
        const actuals = fallbackData
          .map((r) => r.actual_minutes)
          .filter((v): v is number => v !== null);
        const estimates = fallbackData
          .map((r) => r.estimated_minutes)
          .filter((v): v is number => v !== null);
        const variances = fallbackData
          .map((r) => r.variance_minutes)
          .filter((v): v is number => v !== null);

        const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

        return {
          avg_actual_minutes: avg(actuals),
          avg_estimated_minutes: avg(estimates),
          avg_variance_minutes: avg(variances),
          min_actual_minutes: actuals.length > 0 ? Math.min(...actuals) : null,
          max_actual_minutes: actuals.length > 0 ? Math.max(...actuals) : null,
          sample_size: fallbackData.length,
          last_recorded_at: fallbackData[0]?.recorded_at ?? null,
        };
      }

      // Handle single row result from RPC
      if (Array.isArray(data) && data.length > 0) {
        return data[0] as TimeStats;
      }
      return data as TimeStats | null;
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Time Analysis
          </CardTitle>
          <CardDescription>Average times from completed jobs</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !stats || stats.sample_size === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Time Analysis
          </CardTitle>
          <CardDescription>Average times from completed jobs</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <TrendingUp className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No time data available yet</p>
            <p className="text-sm">Complete jobs to see average times</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const variancePercent =
    stats.avg_estimated_minutes && stats.avg_actual_minutes
      ? ((stats.avg_actual_minutes - stats.avg_estimated_minutes) / stats.avg_estimated_minutes) * 100
      : null;

  const isOverEstimated = (stats.avg_variance_minutes ?? 0) < 0;
  const isUnderEstimated = (stats.avg_variance_minutes ?? 0) > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Time Analysis
        </CardTitle>
        <CardDescription className="flex items-center gap-2">
          Based on {stats.sample_size} completed job{stats.sample_size !== 1 ? 's' : ''}
          <Badge variant="secondary" className="ml-1">
            <BarChart3 className="h-3 w-3 mr-1" />
            {stats.sample_size}
          </Badge>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Average Actual Time */}
        <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Average Actual Time</p>
            <p className="text-2xl font-bold">{formatDuration(stats.avg_actual_minutes)}</p>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            <p>Range</p>
            <p>
              {formatDuration(stats.min_actual_minutes)} - {formatDuration(stats.max_actual_minutes)}
            </p>
          </div>
        </div>

        {/* Estimated vs Variance */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg border bg-muted/30">
            <p className="text-sm font-medium text-muted-foreground">Avg Estimated</p>
            <p className="text-lg font-semibold">
              {formatDuration(stats.avg_estimated_minutes)}
            </p>
          </div>

          <div
            className={cn(
              'p-3 rounded-lg border',
              isUnderEstimated
                ? 'bg-amber-500/10 border-amber-500/30'
                : isOverEstimated
                  ? 'bg-green-500/10 border-green-500/30'
                  : 'bg-muted/30'
            )}
          >
            <p className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              {isUnderEstimated ? (
                <TrendingUp className="h-3 w-3 text-amber-500" />
              ) : isOverEstimated ? (
                <TrendingDown className="h-3 w-3 text-green-500" />
              ) : null}
              Variance
            </p>
            <p
              className={cn(
                'text-lg font-semibold',
                isUnderEstimated ? 'text-amber-600' : isOverEstimated ? 'text-green-600' : ''
              )}
            >
              {formatVariance(stats.avg_variance_minutes)}
            </p>
          </div>
        </div>

        {/* Variance Alert */}
        {variancePercent !== null && Math.abs(variancePercent) > 20 && (
          <div
            className={cn(
              'flex items-start gap-2 p-3 rounded-lg text-sm',
              isUnderEstimated
                ? 'bg-amber-500/10 text-amber-700'
                : 'bg-green-500/10 text-green-700'
            )}
          >
            {isUnderEstimated ? (
              <>
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Jobs taking longer than estimated</p>
                  <p className="text-xs opacity-80">
                    Consider updating the Bill of Labor time estimates for this job.
                    Average is {Math.abs(variancePercent).toFixed(0)}% longer than estimated.
                  </p>
                </div>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Jobs completing faster than estimated</p>
                  <p className="text-xs opacity-80">
                    Time estimates may be conservative.
                    Average is {Math.abs(variancePercent).toFixed(0)}% faster than estimated.
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {/* Last recorded */}
        {stats.last_recorded_at && (
          <p className="text-xs text-muted-foreground text-right">
            Last recorded: {new Date(stats.last_recorded_at).toLocaleDateString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
