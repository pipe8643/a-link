import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AuditService } from "../audit/audit.service.js";
import { APP_CONFIG, type AppConfig, cookieNameFor } from "../config/app-config.js";
import { AuthService, type ClientContext } from "./auth.service.js";
import { CurrentAuth, Public, clearSessionCookie, setSessionCookie } from "./auth.guard.js";
import { ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from "./dto.js";
import type { AuthContext } from "../common/request-context.js";
import { SessionService } from "./session.service.js";

function clientContext(req: Request): ClientContext {
  return { ip: req.ip ?? "desconocida", userAgent: req.headers["user-agent"] };
}

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post("register")
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, token } = await this.auth.register(dto, clientContext(req));
    setSessionCookie(res, this.config, token);
    res.status(201);
    return { user };
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, token } = await this.auth.login(dto, clientContext(req));
    setSessionCookie(res, this.config, token);
    return { user };
  }

  /** Idempotente: siempre limpia la cookie, tenga o no sesión válida. */
  @Public()
  @Post("logout")
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = (req.cookies as Record<string, string> | undefined)?.[cookieNameFor(this.config)];
    await this.auth.logout(token);
    clearSessionCookie(res, this.config);
  }

  /** 202 con el mismo cuerpo exista o no la cuenta. */
  @Public()
  @Post("forgot-password")
  @HttpCode(202)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.requestPasswordReset(dto.email);
    return { message: "Si la cuenta existe, recibirás un correo con instrucciones." };
  }

  @Public()
  @Post("reset-password")
  @HttpCode(204)
  async resetPassword(@Body() dto: ResetPasswordDto, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.resetPassword(dto.token, dto.newPassword);
    clearSessionCookie(res, this.config);
  }

  @Get("sessions")
  listSessions(@CurrentAuth() auth: AuthContext) {
    return this.sessions.listActive(auth.userId, auth.sessionId).then((items) => ({ items }));
  }

  /** Solo se puede revocar una sesión PROPIA: si el ID es de otro usuario la respuesta es idéntica a "no existe". */
  @Delete("sessions/:id")
  @HttpCode(204)
  async revokeSession(
    @CurrentAuth() auth: AuthContext,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const revoked = await this.sessions.revoke(auth.userId, id);
    if (!revoked) throw new NotFoundException();
    await this.audit.record({ actorId: auth.userId, action: "auth.session_revoked", resourceType: "session", resourceId: id });
    if (id === auth.sessionId) clearSessionCookie(res, this.config);
  }

  @Post("sessions/revoke-others")
  @HttpCode(204)
  async revokeOthers(@CurrentAuth() auth: AuthContext): Promise<void> {
    const count = await this.sessions.revokeAll(auth.userId, auth.sessionId);
    await this.audit.record({
      actorId: auth.userId,
      action: "auth.sessions_revoked_others",
      resourceType: "session",
      metadata: { count },
    });
  }
}
