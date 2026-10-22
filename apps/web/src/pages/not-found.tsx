import { Compass } from "lucide-react";
import { Link } from "react-router";
import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";

/** Mismo mensaje para "no existe" y "no es tuyo": no revela si un identificador pertenece a otra cuenta. */
export function NotFoundView() {
  return (
    <EmptyState
      icon={Compass}
      title="No encontramos lo que buscas"
      description="La página o el recurso no existe, o no tienes acceso a él."
      action={
        <Button asChild>
          <Link to="/">Ir al panel</Link>
        </Button>
      }
    />
  );
}

export function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg items-center px-4">
      <div className="w-full">
        <NotFoundView />
      </div>
    </main>
  );
}
