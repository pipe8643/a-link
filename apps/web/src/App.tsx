import { Suspense, lazy } from "react";
import { RouterProvider, createBrowserRouter } from "react-router";
import { AppLayout } from "@/components/layout/app-layout";
import { ForgotPasswordPage } from "@/features/auth/forgot-password-page";
import { LoginPage } from "@/features/auth/login-page";
import { RegisterPage } from "@/features/auth/register-page";
import { ResetPasswordPage } from "@/features/auth/reset-password-page";
import { PublicOnly, RequireAuth } from "@/features/auth/route-guards";
import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { ExportsPage } from "@/features/exports/exports-page";
import { GraphDetailPage } from "@/features/library/graph-detail-page";
import { GraphsPage } from "@/features/library/graphs-page";
import { TrashPage } from "@/features/library/trash-page";
import { SettingsPage } from "@/features/settings/settings-page";
import { NotFoundPage, NotFoundView } from "@/pages/not-found";

// El editor (formularios + lienzo) se descarga solo al abrirlo, no con el resto de la aplicación.
// El visor público de enlaces compartidos (sin sesión) también se descarga solo al abrirlo.
const SharedViewPage = lazy(() => import("@/features/share/shared-view-page").then((m) => ({ default: m.SharedViewPage })));
const EditorPage = lazy(() => import("@/features/editor/editor-page").then((m) => ({ default: m.EditorPage })));

export const routes = [
  {
    element: <PublicOnly />,
    children: [
      { path: "/login", element: <LoginPage /> },
      { path: "/register", element: <RegisterPage /> },
      { path: "/forgot-password", element: <ForgotPasswordPage /> },
    ],
  },
  // Enlaces de solo lectura: se autorizan con el token del fragmento (`/s#token`), no con la sesión.
  {
    path: "/s",
    element: (
      <Suspense fallback={<p className="p-6 text-sm text-muted-foreground" role="status">Cargando el grafo…</p>}>
        <SharedViewPage />
      </Suspense>
    ),
  },
  // El enlace del correo debe funcionar aunque haya otra sesión abierta en el navegador.
  { path: "/reset-password", element: <ResetPasswordPage /> },
  {
    element: <RequireAuth />,
    children: [
      // El editor ocupa toda la ventana: tiene su propia cabecera y no usa el layout con menú lateral.
      {
        path: "graphs/:graphId/editor",
        element: (
          <Suspense fallback={<p className="p-6 text-sm text-muted-foreground" role="status">Cargando el editor…</p>}>
            <EditorPage />
          </Suspense>
        ),
      },
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: "graphs", element: <GraphsPage /> },
          { path: "graphs/:graphId", element: <GraphDetailPage /> },
          { path: "exports", element: <ExportsPage /> },
          { path: "trash", element: <TrashPage /> },
          { path: "settings", element: <SettingsPage /> },
          { path: "*", element: <NotFoundView /> },
        ],
      },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}

export function App({ router }: { router: ReturnType<typeof createBrowserRouter> }) {
  return <RouterProvider router={router} />;
}
