import { Inject, Injectable } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { PrismaService } from "../db/prisma.service.js";
import { CryptoService } from "./crypto.service.js";

/** No se escribe en BD en cada petición: solo si la última actividad registrada es anterior a esto. */
const TOUCH_INTERVAL_MS = 60_000;

export interface SessionPrincipal {
  userId: string;
  sessionId: string;
}

export interface SessionSummary {
  id: string;
  createdAt: Date;
  lastUsedAt: Date;
  userAgent: string | null;
  current: boolean;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Crea una sesión y devuelve el token EN CLARO (solo existirá en la cookie del cliente). */
  async create(userId: string, userAgent: string | undefined): Promise<{ token: string; sessionId: string }> {
    const token = this.crypto.generateToken();
    const now = Date.now();
    const session = await this.prisma.client.session.create({
      data: {
        userId,
        tokenHash: this.crypto.hashToken(token),
        expiresAt: new Date(now + this.config.sessionTtlMs),
        absoluteExpiresAt: new Date(now + this.config.sessionAbsoluteTtlMs),
        userAgent: userAgent ? userAgent.slice(0, 255) : null,
      },
      select: { id: true },
    });
    return { token, sessionId: session.id };
  }

  /** Valida el token de la cookie. Devuelve null si no existe, está revocada o caducada. */
  async validate(token: string): Promise<SessionPrincipal | null> {
    if (!token || token.length > 128) return null;
    const session = await this.prisma.client.session.findUnique({
      where: { tokenHash: this.crypto.hashToken(token) },
      select: { id: true, userId: true, revokedAt: true, expiresAt: true, absoluteExpiresAt: true, lastUsedAt: true },
    });
    if (!session || session.revokedAt) return null;
    const now = Date.now();
    if (session.expiresAt.getTime() <= now || session.absoluteExpiresAt.getTime() <= now) return null;

    // Caducidad deslizante, con tope absoluto.
    if (now - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
      const slid = Math.min(now + this.config.sessionTtlMs, session.absoluteExpiresAt.getTime());
      await this.prisma.client.session.update({
        where: { id: session.id },
        data: { lastUsedAt: new Date(now), expiresAt: new Date(slid) },
      });
    }
    return { userId: session.userId, sessionId: session.id };
  }

  /** Revoca una sesión CONCRETA del usuario indicado. false si no existe o no es suya. */
  async revoke(userId: string, sessionId: string): Promise<boolean> {
    const result = await this.prisma.client.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count === 1;
  }

  /** Revoca todas las sesiones activas del usuario, salvo (opcionalmente) una. */
  async revokeAll(userId: string, exceptSessionId?: string): Promise<number> {
    const result = await this.prisma.client.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  /** Sesiones activas del usuario. Nunca incluye hashes ni tokens. */
  async listActive(userId: string, currentSessionId: string): Promise<SessionSummary[]> {
    const now = new Date();
    const rows = await this.prisma.client.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now }, absoluteExpiresAt: { gt: now } },
      orderBy: { lastUsedAt: "desc" },
      select: { id: true, createdAt: true, lastUsedAt: true, userAgent: true },
    });
    return rows.map((r) => ({ ...r, current: r.id === currentSessionId }));
  }

  /** Tareas de retención: elimina sesiones caducadas/revocadas hace más de `olderThanDays` días. */
  async purgeExpired(olderThanDays = 7): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
    const result = await this.prisma.client.session.deleteMany({
      where: { OR: [{ absoluteExpiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
    });
    return result.count;
  }
}
