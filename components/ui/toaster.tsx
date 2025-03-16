"use client"

import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider as ToastPrimitiveProvider,
  ToastTitle,
  ToastViewport,
} from "./toast"
import { useToast, ToastProvider } from "./use-toast"

export function Toaster() {
  return (
    <ToastProvider>
      <ToasterContent />
    </ToastProvider>
  )
}

function ToasterContent() {
  const { toasts } = useToast()

  return (
    <ToastPrimitiveProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastPrimitiveProvider>
  )
} 