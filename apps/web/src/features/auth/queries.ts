import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, isApiError } from "@/lib/api";
import type { SessionInfo, User } from "@/lib/types";

export const ME_KEY = ["me"] as const;

/**
 * Establece (o borra, con `null`) la identidad en caché y olvida TODOS los datos privados de la sesión anterior.
 *
 * El orden importa: `qc.clear()` desvincula a los observadores activos (p. ej. RequireAuth) y un
 * `setQueryData` posterior no los notifica, así que la pantalla no reaccionaba. Primero se publica la
 * identidad (los observadores se enteran y redirigen) y después se eliminan el resto de consultas.
 */
export function setSession(qc: QueryClient, user: User | null): void {
  void qc.cancelQueries();
  qc.setQueryData(ME_KEY, user);
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] });
}

/** `null` = sin sesión (no es un error); `undefined` mientras carga. */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<User | null> => {
      try {
        const res = await api<{ user: User }>("/users/me", { quiet401: true });
        return res.user;
      } catch (err) {
        if (isApiError(err) && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      api<{ user: User }>("/auth/login", { method: "POST", body: input, quiet401: true }),
    onSuccess: ({ user }) => {
      setSession(qc, user); // olvida datos de otra cuenta que pudieran quedar en la caché
    },
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string; displayName?: string }) =>
      api<{ user: User }>("/auth/register", { method: "POST", body: input, quiet401: true }),
    onSuccess: ({ user }) => {
      setSession(qc, user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("/auth/logout", { method: "POST", quiet401: true }),
    // Pase lo que pase en la red, el cliente olvida la sesión y TODOS los datos en caché.
    onSettled: () => {
      setSession(qc, null);
    },
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (input: { email: string }) => api<{ message: string }>("/auth/forgot-password", { method: "POST", body: input, quiet401: true }),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (input: { token: string; newPassword: string }) =>
      api("/auth/reset-password", { method: "POST", body: input, quiet401: true }),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { displayName: string }) => api<{ user: User }>("/users/me", { method: "PATCH", body: input }),
    onSuccess: ({ user }) => qc.setQueryData(ME_KEY, user),
  });
}

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      api("/users/me/password", { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
  });
}

export function useSessions() {
  return useQuery({
    queryKey: ["sessions"],
    queryFn: async () => (await api<{ items: SessionInfo[] }>("/auth/sessions")).items,
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
  });
}

export function useRevokeOtherSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("/auth/sessions/revoke-others", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
  });
}
