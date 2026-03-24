'use client'

import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'

export default function InventoryError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const hasAutoRetried = useRef(false)

  useEffect(() => {
    console.error('Inventory error:', error)
  }, [error])

  // Auto-recover when a valid auth session is restored (e.g. after logout/login in another tab)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session && !hasAutoRetried.current) {
        hasAutoRetried.current = true
        // Short delay to let the new session propagate to all hooks
        setTimeout(() => reset(), 500)
      }
    })
    return () => subscription.unsubscribe()
  }, [reset])

  return (
    <div className="container mx-auto py-10">
      <div className="flex flex-col items-center justify-center gap-4 p-8 border rounded-lg shadow-xs">
        <h2 className="text-2xl font-bold">Error Loading Inventory</h2>
        <p className="text-muted-foreground">
          There was a problem loading the inventory data.
        </p>
        <div className="flex gap-2">
          <Button
            onClick={() => reset()}
            variant="default"
          >
            Try again
          </Button>
          <Button
            onClick={() => window.location.href = '/'}
            variant="outline"
          >
            Go to Home
          </Button>
        </div>
      </div>
    </div>
  )
} 