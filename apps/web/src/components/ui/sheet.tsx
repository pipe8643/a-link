import { X } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;

/** Panel lateral deslizante (menú móvil). Es un Dialog de Radix: atrapa el foco y se cierra con Escape. */
export function SheetContent({
  className,
  children,
  side = "left",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & { side?: "left" | "right" }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <SheetPrimitive.Content
        className={cn(
          "fixed inset-y-0 z-50 flex w-72 max-w-[85vw] flex-col gap-2 border-border bg-sidebar p-4 shadow-lg data-[state=closed]:animate-out data-[state=open]:animate-in",
          side === "left"
            ? "left-0 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left"
            : "right-0 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="absolute top-3 right-3 rounded-md p-1 opacity-70 hover:opacity-100">
          <X className="size-4" aria-hidden="true" />
          <span className="sr-only">Cerrar</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

export function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title className={cn("sr-only", className)} {...props} />;
}

export function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description className={cn("sr-only", className)} {...props} />;
}
