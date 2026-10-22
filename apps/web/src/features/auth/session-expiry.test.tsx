import { QueryClientProvider, useQuery, type QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, setUnauthorizedHandler } from "@/lib/api";
import { LocationProbe, jsonResponse, mockApi, newQueryClient } from "@/test/render";
import { setSession } from "./queries";
import { RequireAuth } from "./route-guards";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "ana@example.test", displayName: "Ana", createdAt: "2026-01-01T00:00:00Z" };

function PrivateScreen() {
  const q = useQuery({ queryKey: ["graphs", "lista"], queryFn: () => api<{ items: string[] }>("/graphs") });
  return (
    <div>
      <p>{q.data ? `DATOS PRIVADOS: ${q.data.items.join(",")}` : "sin datos"}</p>
      <button onClick={() => void q.refetch()}>Recargar</button>
    </div>
  );
}

function renderApp(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route path="/" element={<PrivateScreen />} />
          </Route>
          <Route path="/login" element={<p>PANTALLA DE LOGIN</p>} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  setUnauthorizedHandler(null);
  vi.unstubAllGlobals();
});

describe("sesión caducada o revocada mientras se usa la aplicación", () => {
  it("al primer 401 la interfaz vuelve al login, sin datos privados en pantalla ni en caché", async () => {
    // Regresión: con `queryClient.clear()` seguido de `setQueryData`, RequireAuth no se enteraba y la
    // pantalla seguía mostrando datos privados (lo detectó el E2E de Playwright).
    let calls = 0;
    mockApi({
      "GET /api/v1/users/me": () => jsonResponse(200, { user: USER }),
      "GET /api/v1/graphs": () =>
        ++calls === 1
          ? jsonResponse(200, { items: ["Dato privado"] })
          : jsonResponse(401, { code: "UNAUTHENTICATED", message: "Debes iniciar sesión." }),
    });
    const client = newQueryClient();
    setUnauthorizedHandler(() => setSession(client, null)); // mismo cableado que main.tsx

    const { container } = renderApp(client);
    expect(await screen.findByText("DATOS PRIVADOS: Dato privado")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Recargar" }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/login"));
    expect(screen.getByText("PANTALLA DE LOGIN")).toBeInTheDocument();
    expect(container.textContent).not.toContain("Dato privado");
    expect(client.getQueryCache().findAll({ queryKey: ["graphs"] })).toHaveLength(0);
    expect(client.getQueryData(["me"])).toBeNull();
  });
});
