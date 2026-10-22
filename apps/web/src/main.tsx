import "./lib/zod-config"; // PRIMERO: ver el comentario del módulo
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, createAppRouter } from "./App";
import { ThemeProvider, useTheme } from "./components/theme-provider";
import { Toaster } from "./components/ui/sonner";
import { setSession } from "./features/auth/queries";
import { isApiError, setUnauthorizedHandler } from "./lib/api";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // No se reintentan errores del cliente (4xx): no se arreglan solos.
      retry: (failureCount, error) => !(isApiError(error) && error.status >= 400 && error.status < 500) && failureCount < 2,
    },
  },
});

// Si la sesión caduca o se revoca mientras se usa la app: se olvida todo y las rutas privadas redirigen al login.
setUnauthorizedHandler(() => {
  setSession(queryClient, null);
});

function ThemedToaster() {
  return <Toaster dark={useTheme().dark} />;
}

const root = document.getElementById("root");
if (!root) throw new Error("No se encontró el elemento #root");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <App router={createAppRouter()} />
        <ThemedToaster />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
