import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, type MemoryRouterProps, Route, Routes, useLocation } from "react-router";
import { vi } from "vitest";

export function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
}

export function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

export function renderRoutes(
  routes: Array<{ path: string; element: ReactElement }>,
  { initialEntries = ["/"], client = newQueryClient() }: { initialEntries?: MemoryRouterProps["initialEntries"]; client?: QueryClient } = {},
) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            {routes.map((r) => (
              <Route key={r.path} path={r.path} element={r.element} />
            ))}
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

export function jsonResponse(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** Sustituye fetch por un mock enrutado por "MÉTODO /ruta". Las rutas no previstas fallan la prueba. */
export function mockApi(routes: Record<string, (init: RequestInit) => Response | Promise<Response>>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://localhost");
    const key = `${init.method ?? "GET"} ${url.pathname}`;
    const handler = routes[key];
    if (!handler) throw new Error(`Petición no prevista en la prueba: ${key}`);
    return handler(init);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
