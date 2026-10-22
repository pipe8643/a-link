import { expect, test } from "@playwright/test";
import { STACK_URL } from "./helpers";

/**
 * Limitador de Nginx en la autenticación (30 peticiones/min por IP, ráfaga de 20). Va el ÚLTIMO (nombre `99-`):
 * agota el cupo de la IP y las demás pruebas tardarían en recuperarlo. Distingue la respuesta de Nginx de la de la
 * API porque la de Nginx no lleva `X-Request-Id`.
 */
test("una ráfaga de intentos de login es frenada por Nginx antes de llegar a la API (429)", async ({ request }) => {
  const statuses: number[] = [];
  let nginxResponse: { requestId: string | undefined; retryAfterBody: string } | undefined;
  for (let i = 0; i < 80; i++) {
    const res = await request.post("/api/v1/auth/login", {
      headers: { Origin: STACK_URL },
      data: { email: `burst${i}@example.test`, password: "Una-Frase-Larga-2026!" },
    });
    statuses.push(res.status());
    if (res.status() === 429 && !res.headers()["x-request-id"]) {
      nginxResponse = { requestId: res.headers()["x-request-id"], retryAfterBody: (await res.text()).slice(0, 80) };
      break;
    }
  }
  expect(statuses.slice(0, 15), "las primeras peticiones llegan a la API (401 por credenciales inexistentes)").toEqual(Array(15).fill(401));
  expect(nginxResponse, `nunca respondió Nginx con 429: ${statuses.join(",")}`).toBeDefined();
  expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(55);
});
