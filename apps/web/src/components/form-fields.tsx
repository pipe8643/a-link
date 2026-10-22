import { Eye, EyeOff } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import type * as React from "react";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FieldShellProps {
  label: string;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children: (a11y: { id: string; "aria-invalid": boolean; "aria-describedby": string | undefined }) => ReactNode;
}

/** Etiqueta + control + ayuda + error, con los atributos ARIA correctamente enlazados. */
export function FieldShell({ label, error, hint, className, children }: FieldShellProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({ id, "aria-invalid": !!error, "aria-describedby": describedBy })}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

type Common = { label: string; error?: string; hint?: ReactNode; wrapperClassName?: string };

export function TextField({
  label,
  error,
  hint,
  wrapperClassName,
  ...props
}: Common & Omit<React.ComponentProps<"input">, "id">) {
  return (
    <FieldShell label={label} error={error} hint={hint} className={wrapperClassName}>
      {(a11y) => <Input {...a11y} {...props} />}
    </FieldShell>
  );
}

export function PasswordField({
  label,
  error,
  hint,
  wrapperClassName,
  ...props
}: Common & Omit<React.ComponentProps<"input">, "id" | "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <FieldShell label={label} error={error} hint={hint} className={wrapperClassName}>
      {(a11y) => (
        <div className="relative">
          <Input {...a11y} type={visible ? "text" : "password"} className="pr-10" {...props} />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
            aria-pressed={visible}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground"
          >
            {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
          </button>
        </div>
      )}
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  error,
  hint,
  wrapperClassName,
  ...props
}: Common & Omit<React.ComponentProps<"textarea">, "id">) {
  return (
    <FieldShell label={label} error={error} hint={hint} className={wrapperClassName}>
      {(a11y) => <Textarea {...a11y} {...props} />}
    </FieldShell>
  );
}

export function SelectField({
  label,
  error,
  hint,
  wrapperClassName,
  children,
  ...props
}: Common & Omit<React.ComponentProps<"select">, "id">) {
  return (
    <FieldShell label={label} error={error} hint={hint} className={wrapperClassName}>
      {(a11y) => (
        <NativeSelect {...a11y} {...props}>
          {children}
        </NativeSelect>
      )}
    </FieldShell>
  );
}

/** Banner de error general de un formulario (errores que no son de un campo concreto). */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </div>
  );
}
