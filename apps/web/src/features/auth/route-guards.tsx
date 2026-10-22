import { Loader2 } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router";
import { QueryError } from "@/components/page";
import { useMe } from "./queries";

function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="Cargando">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
    </div>
  );
}

/** Rutas privadas: sin sesión se redirige al login recordando a dónde quería ir el usuario. */
export function RequireAuth() {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <FullPageSpinner />;
  if (me.isError) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md items-center px-4">
        <QueryError error={me.error} onRetry={() => void me.refetch()} />
      </div>
    );
  }
  if (!me.data) {
    const from = `${location.pathname}${location.search}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }
  return <Outlet />;
}

/**
 * Login/registro: si ya hay sesión no tiene sentido mostrarlos. Al iniciar sesión, esta guarda reacciona
 * ANTES que la página, así que también debe respetar la ruta que el usuario pedía (siempre saneada).
 */
export function PublicOnly() {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <FullPageSpinner />;
  if (me.data) return <Navigate to={safeRedirectPath((location.state as { from?: unknown } | null)?.from)} replace />;
  return <Outlet />;
}

/** Evita redirecciones abiertas: solo se acepta una ruta interna ("/algo"), nunca "//host" ni "http://...". */
export function safeRedirectPath(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}
