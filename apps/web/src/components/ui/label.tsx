import { Label as LabelPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn("text-sm leading-none font-medium select-none peer-disabled:opacity-50", className)}
      {...props}
    />
  );
}
