'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { useState } from 'react'
import { AuthProvider } from '@/components/common/auth-provider'
import { ResetQueryErrorBoundary } from '@/components/common/reset-query-error-boundary'
import { ToastProvider } from '@/components/ui/use-toast'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())

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
  )
}
