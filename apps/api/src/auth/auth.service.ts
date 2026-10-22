import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { PrismaService } from "../db/prisma.service.js";
import { MailService } from "../mail/mail.service.js";
import { CryptoService } from "./crypto.service.js";
import { LoginRateLimiter } from "./login-rate-limiter.js";
import { SessionService } from "./session.service.js";

export interface UserView {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;
}

export interface ClientContext {
  ip: string;
  userAgent: string | undefined;
}

const USER_SELECT = { id: true, email: true, displayName: true, createdAt: true } as const;

/** Una contraseña no puede contener la parte local del correo (si es suficientemente larga). */
export function passwordViolatesPolicy(password: string, email: string): boolean {
  const lower = password.toLowerCase();
  const local = email.split("@")[0] ?? "";
  return lower === email.toLowerCase() || (local.length >= 4 && lower.includes(local.toLowerCase()));
}

const INVALID_CREDENTIALS = () =>
  new UnauthorizedException({ code: "INVALID_CREDENTIALS", message: "Correo o contraseña incorrectos." });

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly limiter: LoginRateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async register(
    input: { email: string; password: string; displayName?: string },
    ctx: ClientContext,
  ): Promise<{ user: UserView; token: string }> {
    if (!this.config.registrationEnabled) {
      throw new ForbiddenException({ code: "REGISTRATION_DISABLED", message: "El registro está deshabilitado." });
    }
    if (passwordViolatesPolicy(input.password, input.email)) {
      throw new BadRequestException({
        code: "WEAK_PASSWORD",
        message: "La contraseña no puede contener tu correo.",
      });
    }
    // Se calcula SIEMPRE el hash antes de tocar la base de datos: iguala el tiempo con/sin cuenta previa.
    const passwordHash = await this.crypto.hashPassword(input.password);
    let user: UserView;
    try {
      user = await this.prisma.client.user.create({
        data: { email: input.email, passwordHash, displayName: input.displayName ?? "" },
        select: USER_SELECT,
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        throw new ConflictException({ code: "REGISTER_FAILED", message: "No se pudo completar el registro con esos datos." });
      }
      throw err;
    }
    const { token } = await this.sessions.create(user.id, ctx.userAgent);
    await this.audit.record({ actorId: user.id, action: "auth.register", resourceType: "user", resourceId: user.id });
    return { user, token };
  }

  async login(input: { email: string; password: string }, ctx: ClientContext): Promise<{ user: UserView; token: string }> {
    const wait = this.limiter.retryAfterSeconds(ctx.ip, input.email);
    if (wait > 0) {
      throw new HttpException(
        {
          code: "TOO_MANY_ATTEMPTS",
          message: "Demasiados intentos fallidos. Inténtalo de nuevo más tarde.",
          retryAfterSeconds: wait,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const found = await this.prisma.client.user.findUnique({
      where: { email: input.email },
      select: { ...USER_SELECT, passwordHash: true },
    });
    const valid = found
      ? await this.crypto.verifyPassword(found.passwordHash, input.password)
      : (await this.crypto.burnVerification(input.password), false);

    if (!found || !valid) {
      this.limiter.recordFailure(ctx.ip, input.email);
      await this.audit.record({
        actorId: found?.id ?? null,
        action: "auth.login_failed",
        resourceType: "user",
        resourceId: found?.id ?? null,
      });
      throw INVALID_CREDENTIALS();
    }

    this.limiter.recordSuccess(ctx.ip, input.email);
    const { token } = await this.sessions.create(found.id, ctx.userAgent);
    await this.audit.record({ actorId: found.id, action: "auth.login", resourceType: "user", resourceId: found.id });
    const { passwordHash: _omit, ...user } = found;
    return { user, token };
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    const principal = await this.sessions.validate(token);
    if (!principal) return;
    await this.sessions.revoke(principal.userId, principal.sessionId);
    await this.audit.record({
      actorId: principal.userId,
      action: "auth.logout",
      resourceType: "session",
      resourceId: principal.sessionId,
    });
  }

  /** Respuesta idéntica exista o no la cuenta (anti-enumeración). */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.client.user.findUnique({ where: { email }, select: { id: true, email: true } });
    if (!user) return;

    // Un solo enlace válido a la vez: se invalidan los anteriores sin usar.
    await this.prisma.client.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    const token = this.crypto.generateToken();
    await this.prisma.client.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: this.crypto.hashToken(token),
        expiresAt: new Date(Date.now() + this.config.passwordResetTtlMs),
      },
    });
    const base = this.config.appOrigins[0]!;
    await this.mail.sendPasswordReset(user.email, `${base}/reset-password#${encodeURIComponent(token)}`);
    await this.audit.record({
      actorId: user.id,
      action: "auth.password_reset_requested",
      resourceType: "user",
      resourceId: user.id,
    });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const invalid = () =>
      new BadRequestException({ code: "INVALID_RESET_TOKEN", message: "El enlace no es válido o ha caducado." });

    const row = await this.prisma.client.passwordResetToken.findUnique({
      where: { tokenHash: this.crypto.hashToken(token) },
      select: { id: true, userId: true, usedAt: true, expiresAt: true, user: { select: { email: true } } },
    });
    if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) throw invalid();
    if (passwordViolatesPolicy(newPassword, row.user.email)) {
      throw new BadRequestException({ code: "WEAK_PASSWORD", message: "La contraseña no puede contener tu correo." });
    }

    const passwordHash = await this.crypto.hashPassword(newPassword);
    await this.prisma.client.$transaction(async (tx) => {
      // Consumo atómico: solo UNA petición concurrente puede marcarlo como usado.
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) throw invalid();
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
      // Tras un restablecimiento se cierran TODAS las sesiones (puede haber un atacante dentro).
      await tx.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    await this.audit.record({ actorId: row.userId, action: "auth.password_reset", resourceType: "user", resourceId: row.userId });
  }

  async changePassword(
    principal: { userId: string; sessionId: string },
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: principal.userId },
      select: { id: true, email: true, passwordHash: true },
    });
    if (!user || !(await this.crypto.verifyPassword(user.passwordHash, currentPassword))) {
      throw new BadRequestException({ code: "INVALID_CURRENT_PASSWORD", message: "La contraseña actual no es correcta." });
    }
    if (passwordViolatesPolicy(newPassword, user.email) || newPassword === currentPassword) {
      throw new BadRequestException({
        code: "WEAK_PASSWORD",
        message: "La nueva contraseña debe ser distinta de la actual y no contener tu correo.",
      });
    }
    const passwordHash = await this.crypto.hashPassword(newPassword);
    await this.prisma.client.user.update({ where: { id: user.id }, data: { passwordHash } });
    await this.sessions.revokeAll(user.id, principal.sessionId); // las demás sesiones se cierran
    await this.audit.record({ actorId: user.id, action: "auth.password_changed", resourceType: "user", resourceId: user.id });
  }
}
