import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import "../common/request-context.js";
import { APP_CONFIG, type AppConfig, cookieNameFor } from "../config/app-config.js";
import { SessionService } from "./session.service.js";

const IS_PUBLIC = "isPublic";

/** Marca explícitamente una ruta como pública. TODO lo demás exige sesión (denegar por defecto). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Identidad autenticada (userId, sessionId) tomada de la sesión del servidor, NUNCA del cuerpo/URL. */
export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.auth) throw new UnauthorizedException();
  return req.auth;
});

export function sessionCookieOptions(config: AppConfig) {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax" as const,
    path: "/",
    maxAge: config.sessionAbsoluteTtlMs,
  };
}

export function setSessionCookie(res: Response, config: AppConfig, token: string): void {
  res.cookie(cookieNameFor(config), token, sessionCookieOptions(config));
}

export function clearSessionCookie(res: Response, config: AppConfig): void {
  const { maxAge: _maxAge, ...options } = sessionCookieOptions(config);
  res.clearCookie(cookieNameFor(config), options);
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const token = (req.cookies as Record<string, string> | undefined)?.[cookieNameFor(this.config)];
    const principal = token ? await this.sessions.validate(token) : null;
    if (!principal) {
      if (token) clearSessionCookie(http.getResponse<Response>(), this.config); // cookie obsoleta
      throw new UnauthorizedException({ code: "UNAUTHENTICATED", message: "Debes iniciar sesión." });
    }
    req.auth = principal;
    return true;
  }
}
