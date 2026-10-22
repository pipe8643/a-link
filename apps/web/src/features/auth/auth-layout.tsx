import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <Brand />
      <Card className="w-full max-w-md">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent className="pt-3">{children}</CardContent>
      </Card>
      {footer && <p className="text-center text-sm text-muted-foreground">{footer}</p>}
      <p className="max-w-md text-center text-xs text-muted-foreground">
        Tus datos se guardan en este servidor y no se comparten con terceros.
      </p>
    </main>
  );
}
