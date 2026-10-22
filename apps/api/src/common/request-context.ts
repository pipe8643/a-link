export interface AuthContext {
  userId: string;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Identificador de correlación de la petición (también en la cabecera X-Request-Id). */
      requestId: string;
      /** Rellenado por AuthGuard. Su ausencia significa "no autenticado". */
      auth?: AuthContext;
    }
  }
}
