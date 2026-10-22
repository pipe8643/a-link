import { Inject, Injectable } from "@nestjs/common";
import argon2 from "argon2";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";

/** Contraseña ficticia usada para igualar el tiempo de respuesta cuando el usuario no existe. */
const DUMMY_PASSWORD = "contrasena-ficticia-para-igualar-tiempos";

@Injectable()
export class CryptoService {
  private dummyHash: Promise<string> | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  // ---- Contraseñas (Argon2id) ----------------------------------------------------------------

  hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id, ...this.config.argon2 });
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false; // hash corrupto o parámetros no válidos: se trata como credencial incorrecta
    }
  }

  /** Consume el mismo tiempo que una verificación real (mitiga la enumeración de cuentas por tiempo). */
  async burnVerification(password: string): Promise<void> {
    this.dummyHash ??= this.hashPassword(DUMMY_PASSWORD);
    await this.verifyPassword(await this.dummyHash, password);
  }

  // ---- Tokens opacos (sesiones y recuperación) -----------------------------------------------

  /** Token aleatorio de 256 bits, apto para cookies y URLs. */
  generateToken(): string {
    return randomBytes(32).toString("base64url");
  }

  /**
   * HMAC-SHA256(SESSION_SECRET, token). En la base de datos solo se guarda este valor: un volcado
   * de la tabla no permite suplantar sesiones ni usar tokens de recuperación.
   */
  hashToken(token: string): string {
    return createHmac("sha256", this.config.sessionSecret).update(token).digest("hex");
  }

  safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}
