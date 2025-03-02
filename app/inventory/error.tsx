'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function InventoryError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error('Inventory error:', error)
  }, [error])

  return (
    <div className="container mx-auto py-10">
      <div className="flex flex-col items-center justify-center gap-4 p-8 border rounded-lg shadow-sm">
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