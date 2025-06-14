import { Loader2 } from 'lucide-react'

export default function InventoryLoading() {
  return (
    <div className="container mx-auto py-10">
      <div className="flex flex-col items-center justify-center gap-4 p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">
          Loading inventory data...
        </p>
      </div>
    </div>
  )
} 