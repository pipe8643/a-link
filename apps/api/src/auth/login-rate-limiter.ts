import { Inject, Injectable } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";

const WINDOW_IP_EMAIL_MS = 15 * 60_000;
const WINDOW_EMAIL_MS = 60 * 60_000;
const MAX_TRACKED_KEYS = 50_000;

/**
 * Limita los INTENTOS FALLIDOS de inicio de sesión por dos claves:
 *  - IP + correo (ventana de 15 min): frena la fuerza bruta sin permitir que un tercero bloquee a la víctima desde otra IP.
 *  - Correo (ventana de 1 h, umbral alto): frena ataques distribuidos contra una misma cuenta.
 *
 * Estado EN MEMORIA: válido para una sola instancia de la API. Con varias instancias hay que
 * moverlo a un almacén compartido (Redis); está documentado como limitación conocida.
 */
@Injectable()
export class LoginRateLimiter {
  private readonly failures = new Map<string, number[]>();

  /** Reloj inyectable por las pruebas (no es una dependencia de Nest). */
  clock: () => number = Date.now;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private now(): number {
    return this.clock();
  }

  private ipEmailKey(ip: string, email: string) {
    return `ip|${ip}|${email}`;
  }
  private emailKey(email: string) {
    return `em|${email}`;
  }

  private recent(key: string, windowMs: number): number[] {
    const cutoff = this.now() - windowMs;
    const kept = (this.failures.get(key) ?? []).filter((t) => t > cutoff);
    if (kept.length) this.failures.set(key, kept);
    else this.failures.delete(key);
    return kept;
  }

  /** Devuelve los segundos de espera si está bloqueado, o 0 si puede intentar. */
  retryAfterSeconds(ip: string, email: string): number {
    const checks: Array<[number[], number, number]> = [
      [this.recent(this.ipEmailKey(ip, email), WINDOW_IP_EMAIL_MS), this.config.loginMaxAttemptsPerIpEmail, WINDOW_IP_EMAIL_MS],
      [this.recent(this.emailKey(email), WINDOW_EMAIL_MS), this.config.loginMaxAttemptsPerEmail, WINDOW_EMAIL_MS],
    ];
    let wait = 0;
    for (const [times, max, windowMs] of checks) {
      if (times.length >= max) {
        const oldestRelevant = times[times.length - max]!;
        wait = Math.max(wait, Math.ceil((oldestRelevant + windowMs - this.now()) / 1000));
      }
    }
    return Math.max(0, wait);
  }

  recordFailure(ip: string, email: string): void {
    if (this.failures.size > MAX_TRACKED_KEYS) this.sweep();
    for (const key of [this.ipEmailKey(ip, email), this.emailKey(email)]) {
      const list = this.failures.get(key) ?? [];
      list.push(this.now());
      this.failures.set(key, list);
    }
  }

  /** Un inicio de sesión correcto limpia el contador de esa pareja IP+correo. */
  recordSuccess(ip: string, email: string): void {
    this.failures.delete(this.ipEmailKey(ip, email));
  }

  private sweep(): void {
    const cutoff = this.now() - WINDOW_EMAIL_MS;
    for (const [key, times] of this.failures) {
      if (!times.some((t) => t > cutoff)) this.failures.delete(key);
    }
  }
}
