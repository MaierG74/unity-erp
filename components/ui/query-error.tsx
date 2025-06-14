'use client';

import { Button } from '@/components/ui/button';
import { useQueryClient } from '@tanstack/react-query';

interface QueryErrorProps {
  error: unknown;
  queryKey?: string | readonly unknown[];
  resetErrorBoundary?: () => void;
}

export function QueryError({ error, queryKey, resetErrorBoundary }: QueryErrorProps) {
  const queryClient = useQueryClient();

  const handleRetry = () => {
    if (queryKey) {
      // Invalidate the specific query that failed
      queryClient.invalidateQueries({ queryKey: Array.isArray(queryKey) ? queryKey : [queryKey] });
    }
    
    // If a resetErrorBoundary function is provided, call it
    if (resetErrorBoundary) {
      resetErrorBoundary();
    }
  };

  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-6 text-destructive">
      <h3 className="text-lg font-medium mb-2">Something went wrong</h3>
      <p className="mb-4">
        {error instanceof Error 
          ? error.message 
          : typeof error === 'string' 
            ? error 
            : 'An unexpected error occurred'}
      </p>
      <div className="flex gap-3">
        <Button onClick={handleRetry} variant="secondary">
          Try again
        </Button>
        <Button onClick={() => window.location.reload()} variant="outline">
          Refresh page
        </Button>
      </div>
    </div>
  );
} 