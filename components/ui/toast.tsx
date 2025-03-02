import * as React from "react"
import { cn } from "@/lib/utils"

export interface ToastProps {
  id?: string
  title?: string
  description?: string
  duration?: number
  variant?: "default" | "success" | "destructive" | "warning"
}

const Toast = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & ToastProps
>(({ className, title, description, variant = "default", ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        "fixed top-4 right-4 z-50 rounded-md border p-4 shadow-md transition-all",
        {
          "bg-background text-foreground": variant === "default",
          "bg-success/10 border-success text-success": variant === "success",
          "bg-destructive/10 border-destructive text-destructive": variant === "destructive",
          "bg-warning/10 border-warning text-warning": variant === "warning",
        },
        className
      )}
      {...props}
    >
      {title && <div className="font-medium">{title}</div>}
      {description && <div className="text-sm opacity-90">{description}</div>}
    </div>
  )
})
Toast.displayName = "Toast"

export { Toast }

// Simple toast hook
export function useToast() {
  const [toasts, setToasts] = React.useState<ToastProps[]>([])

  const toast = React.useCallback((props: ToastProps) => {
    const id = Math.random().toString(36).substring(2, 9)
    const newToast = { ...props, id }
    setToasts((prev) => [...prev, newToast])
    
    if (props.duration !== 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, props.duration || 3000)
    }
    
    return id
  }, [])

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return { toast, dismiss, toasts }
}

// Toast provider component
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { toasts } = useToast()
  
  return (
    <>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <Toast key={toast.id} {...toast} />
        ))}
      </div>
    </>
  )
} 