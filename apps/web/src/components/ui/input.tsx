import type * as React from "react";
import { cn } from "@/lib/utils";

const fieldClasses =
  "w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm shadow-xs transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive";

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return <input type={type} className={cn(fieldClasses, "h-9 py-1", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(fieldClasses, "min-h-20 py-2", className)} {...props} />;
}

/** `<select>` nativo con estilo: accesible por defecto y cómodo en móvil. */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select className={cn(fieldClasses, "h-9 py-1 pr-8", className)} {...props}>
      {children}
    </select>
  );
}
