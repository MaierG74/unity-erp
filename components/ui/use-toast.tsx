// This is a simplified version of the shadcn/ui toast component
// Adapted from: https://ui.shadcn.com/docs/components/toast

import { useState, useEffect, createContext, useContext } from "react";
import { 
  Toast, 
  ToastClose, 
  ToastDescription, 
  ToastContainer, 
  ToastTitle, 
  ToastViewport 
} from "./toast";

type ToastProps = {
  id: string;
  title?: string;
  description?: string;
  action?: React.ReactNode;
  variant?: "default" | "destructive" | "success";
  duration?: number;
};

type ToastActionElement = React.ReactElement<typeof Toast>;

type ToastContextType = {
  toasts: ToastProps[];
  addToast: (props: Omit<ToastProps, "id">) => void;
  removeToast: (id: string) => void;
};

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastProps[]>([]);

  const addToast = (props: Omit<ToastProps, "id">) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, ...props }]);
    
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      removeToast(id);
    }, props.duration || 5000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer>
        {toasts.map(({ id, title, description, action, variant }) => (
          <Toast key={id} variant={variant}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose onClick={() => removeToast(id)} />
          </Toast>
        ))}
        <ToastViewport />
      </ToastContainer>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  
  return { 
    toast: context.addToast,
    dismiss: context.removeToast,
    toasts: context.toasts
  };
} 