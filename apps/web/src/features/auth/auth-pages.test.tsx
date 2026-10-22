import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./login-page";
import { RegisterPage } from "./register-page";
import { ResetPasswordPage } from "./reset-password-page";
import { PublicOnly, RequireAuth } from "./route-guards";
import { LocationProbe, jsonResponse, mockApi, newQueryClient, renderRoutes } from "@/test/render";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "ana@example.test", displayName: "Ana", createdAt: "2026-01-01T00:00:00Z" };
const GOOD = "Una-Frase-Larga-2026!";

afterEach(() => vi.unstubAllGlobals());

describe("LoginPage", () => {
  const routes = [
    { path: "/login", element: <LoginPage /> },
    { path: "/", element: <p>INICIO</p> },
    { path: "/graphs", element: <p>GRAFOS</p> },
  ];

  it("valida en el cliente sin llamar a la API y enlaza los errores con sus campos (ARIA)", async () => {
    const fetchMock = mockApi({});
    renderRoutes(routes, { initialEntries: ["/login"] });
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    const email = await screen.findByLabelText("Correo electrónico");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual(
      expect.arrayContaining(["Introduce tu correo", "Introduce tu contraseña"]),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("credenciales incorrectas: muestra el mensaje del servidor y se queda en la página", async () => {
    mockApi({
      "POST /api/v1/auth/login": () => jsonResponse(401, { code: "INVALID_CREDENTIALS", message: "Correo o contraseña incorrectos.", requestId: "r" }),
    });
    renderRoutes(routes, { initialEntries: ["/login"] });
    await userEvent.type(screen.getByLabelText("Correo electrónico"), "ana@example.test");
    await userEvent.type(screen.getByLabelText("Contraseña"), "mala-clave-123");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByText("Correo o contraseña incorrectos.")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/login");
  });

  it("login correcto: envía el correo normalizado y vuelve a la ruta que se pedía", async () => {
    const fetchMock = mockApi({ "POST /api/v1/auth/login": () => jsonResponse(200, { user: USER }) });
    renderRoutes(routes, { initialEntries: [{ pathname: "/login", state: { from: "/graphs?folder=root" } }] });
    await userEvent.type(screen.getByLabelText("Correo electrónico"), "  ANA@Example.test ");
    await userEvent.type(screen.getByLabelText("Contraseña"), GOOD);
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/graphs"));
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ email: "ana@example.test", password: GOOD });
  });

  it("una ruta de retorno externa se ignora (sin redirección abierta)", async () => {
    mockApi({ "POST /api/v1/auth/login": () => jsonResponse(200, { user: USER }) });
    renderRoutes(routes, { initialEntries: [{ pathname: "/login", state: { from: "//evil.example" } }] });
    await userEvent.type(screen.getByLabelText("Correo electrónico"), "ana@example.test");
    await userEvent.type(screen.getByLabelText("Contraseña"), GOOD);
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/));
  });

  it("el botón para mostrar la contraseña alterna el tipo del campo", async () => {
    mockApi({});
    renderRoutes(routes, { initialEntries: ["/login"] });
    const pw = screen.getByLabelText("Contraseña");
    expect(pw).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(pw).toHaveAttribute("type", "text");
  });

  it("429: informa del tiempo de espera", async () => {
    mockApi({
      "POST /api/v1/auth/login": () =>
        jsonResponse(429, { code: "TOO_MANY_ATTEMPTS", message: "Demasiados intentos.", retryAfterSeconds: 600 }, { "Retry-After": "600" }),
    });
    renderRoutes(routes, { initialEntries: ["/login"] });
    await userEvent.type(screen.getByLabelText("Correo electrónico"), "ana@example.test");
    await userEvent.type(screen.getByLabelText("Contraseña"), GOOD);
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText(/Espera 10 minutos/)).toBeInTheDocument();
  });
});

describe("RegisterPage", () => {
  it("muestra el error de campo que devuelve el servidor sin perder lo escrito", async () => {
    mockApi({
      "POST /api/v1/auth/register": () =>
        jsonResponse(400, { code: "VALIDATION_ERROR", message: "Los datos enviados no son válidos.", errors: [{ field: "email", rule: "isEmail" }] }),
    });
    renderRoutes([{ path: "/register", element: <RegisterPage /> }], { initialEntries: ["/register"] });
    await userEvent.type(screen.getByLabelText("Correo electrónico"), "ana@example.test");
    await userEvent.type(screen.getByLabelText("Contraseña"), GOOD);
    await userEvent.type(screen.getByLabelText("Repite la contraseña"), GOOD);
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await screen.findByText("Introduce un correo válido")).toBeInTheDocument();
    expect(screen.getByLabelText("Correo electrónico")).toHaveValue("ana@example.test");
  });

  it("no envía displayName vacío y no manda la confirmación de contraseña", async () => {
    const fetchMock = mockApi({ "POST /api/v1/auth/register": () => jsonResponse(201, { user: USER }) });
    renderRoutes(
      [
        { path: "/register", element: <RegisterPage /> },
        { path: "/", element: <p>INICIO</p> },
      ],
      { initialEntries: ["/register"] },
    );
    await userEvent.type(screen.getByLabelText("Correo electrónico"), "ana@example.test");
    await userEvent.type(screen.getByLabelText("Contraseña"), GOOD);
    await userEvent.type(screen.getByLabelText("Repite la contraseña"), GOOD);
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ email: "ana@example.test", password: GOOD });
  });
});

describe("ResetPasswordPage", () => {
  const routes = [
    { path: "/reset-password", element: <ResetPasswordPage /> },
    { path: "/login", element: <p>LOGIN</p> },
    { path: "/forgot-password", element: <p>OLVIDO</p> },
  ];

  it("quita el token de la barra de direcciones y aun así lo usa al enviar", async () => {
    const fetchMock = mockApi({ "POST /api/v1/auth/reset-password": () => new Response(null, { status: 204 }) });
    renderRoutes(routes, { initialEntries: ["/reset-password#TOKEN_SECRETO_1234567890"] });

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/reset-password$/));
    await userEvent.type(screen.getByLabelText("Nueva contraseña"), GOOD);
    await userEvent.type(screen.getByLabelText("Repite la contraseña"), GOOD);
    await userEvent.click(screen.getByRole("button", { name: "Cambiar contraseña" }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/login"));
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ token: "TOKEN_SECRETO_1234567890", newPassword: GOOD });
  });

  it("sin token muestra un aviso y enlaza a solicitar uno nuevo", async () => {
    mockApi({});
    renderRoutes(routes, { initialEntries: ["/reset-password"] });
    expect(await screen.findByText("Enlace no válido")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Solicitar un enlace nuevo" })).toHaveAttribute("href", "/forgot-password");
  });

  it("token inválido o caducado: muestra el mensaje del servidor", async () => {
    mockApi({
      "POST /api/v1/auth/reset-password": () => jsonResponse(400, { code: "INVALID_RESET_TOKEN", message: "El enlace no es válido o ha caducado." }),
    });
    renderRoutes(routes, { initialEntries: ["/reset-password#abc"] });
    await userEvent.type(screen.getByLabelText("Nueva contraseña"), GOOD);
    await userEvent.type(screen.getByLabelText("Repite la contraseña"), GOOD);
    await userEvent.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
    expect(await screen.findByText("El enlace no es válido o ha caducado.")).toBeInTheDocument();
  });
});

describe("protección de rutas", () => {
  const routes = [
    {
      path: "/",
      element: <RequireAuth />,
    },
    { path: "/login", element: <PublicOnly /> },
  ];

  it("sin sesión (401) las rutas privadas redirigen al login", async () => {
    mockApi({ "GET /api/v1/users/me": () => jsonResponse(401, { code: "UNAUTHENTICATED", message: "No autenticado." }) });
    renderRoutes(routes, { initialEntries: ["/"] });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/login"));
  });

  it("un error de servidor NO se confunde con 'sin sesión': se muestra con opción de reintentar", async () => {
    mockApi({ "GET /api/v1/users/me": () => jsonResponse(500, { code: "INTERNAL_ERROR", message: "Error interno del servidor." }) });
    renderRoutes(routes, { initialEntries: ["/"] });
    expect(await screen.findByText("Error interno del servidor.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
  });

  it("login dentro de PublicOnly: tras entrar vuelve a la ruta pedida (regresión: PublicOnly mandaba siempre a «/»)", async () => {
    let logged = false;
    mockApi({
      "GET /api/v1/users/me": () => (logged ? jsonResponse(200, { user: USER }) : jsonResponse(401, { code: "UNAUTHENTICATED", message: "x" })),
      "POST /api/v1/auth/login": () => {
        logged = true;
        return jsonResponse(200, { user: USER });
      },
    });
    // Ruta real: /login envuelta en PublicOnly, con el estado "from" que pone RequireAuth.
    render(
      <QueryClientProvider client={newQueryClient()}>
        <MemoryRouter initialEntries={[{ pathname: "/login", state: { from: "/graphs?q=demo" } }]}>
          <Routes>
            <Route element={<PublicOnly />}>
              <Route path="/login" element={<LoginPage />} />
            </Route>
            <Route path="/graphs" element={<p>GRAFOS</p>} />
            <Route path="/" element={<p>INICIO</p>} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await userEvent.type(await screen.findByLabelText("Correo electrónico"), "ana@example.test");
    await userEvent.type(screen.getByLabelText("Contraseña"), GOOD);
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/graphs?q=demo"));
    expect(screen.getByText("GRAFOS")).toBeInTheDocument();
  });
  it("con sesión, login/registro redirigen al inicio", async () => {
    mockApi({ "GET /api/v1/users/me": () => jsonResponse(200, { user: USER }) });
    renderRoutes([...routes, { path: "/x", element: <p>x</p> }], { initialEntries: ["/login"] });
    // PublicOnly sin ruta "/" hija renderiza el Outlet vacío; lo relevante es que navega a "/".
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/));
  });
});
