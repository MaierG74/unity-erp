'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState, type ReactNode } from 'react';
import { ResetQueryErrorBoundary } from './reset-query-error-boundary';
import { AuthProvider } from './auth-provider';
import { ToastProvider } from '@/components/ui/use-toast';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000, // 5 minutes
            refetchOnWindowFocus: false,
            retry: 2,
          },
          mutations: {},
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
            <ResetQueryErrorBoundary>
        <ToastProvider>
          {children}
        </ToastProvider>
      </ResetQueryErrorBoundary>
            <ReactQueryDevtools initialIsOpen={false} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
