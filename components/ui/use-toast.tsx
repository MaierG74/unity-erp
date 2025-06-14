"use client"

// This is a simplified version of the shadcn/ui toast component
// Adapted from: https://ui.shadcn.com/docs/components/toast

import * as React from "react"
import { 
  Toast, 
  ToastClose, 
  ToastDescription, 
  ToastProvider as ToastPrimitiveProvider, 
  ToastTitle, 
  ToastViewport,
  type ToastProps as PrimitiveToastProps
} from "./toast"

interface ToastProps {
  id: string
  title?: string
  description?: string
  action?: React.ReactNode
  variant?: "default" | "destructive"
  duration?: number
}

type ToastContextType = {
  toasts: ToastProps[]
  addToast: (props: Omit<ToastProps, "id">) => void
  removeToast: (id: string) => void
}

const ToastContext = React.createContext<ToastContextType | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastProps[]>([])

  const addToast = React.useCallback((props: Omit<ToastProps, "id">) => {
    const id = Math.random().toString(36).substring(2, 9)
    setToasts((prev) => [...prev, { id, ...props }])
    
    if (props.duration !== 0) {
      setTimeout(() => {
        removeToast(id)
      }, props.duration || 5000)
    }
  }, [])

  const removeToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = React.useContext(ToastContext)
  
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  
  return { 
    toast: context.addToast,
    dismiss: context.removeToast,
    toasts: context.toasts
  }
}

export type { ToastProps } 