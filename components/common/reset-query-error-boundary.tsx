'use client';

import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { ErrorBoundary, FallbackProps } from 'react-error-boundary';
import { QueryError } from '@/components/ui/query-error';

interface ResetQueryErrorBoundaryProps {
  children: React.ReactNode;
}

export function ResetQueryErrorBoundary({ children }: ResetQueryErrorBoundaryProps) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          onReset={reset}
          fallbackRender={({ error, resetErrorBoundary }: FallbackProps) => (
            <div className="p-4">
              <QueryError
                error={error}
                resetErrorBoundary={resetErrorBoundary}
              />
            </div>
          )}
        >
          {children}
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
} 