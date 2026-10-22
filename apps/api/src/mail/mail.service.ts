import { Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";

/** Contrato de envío de correo. Los adaptadores reales (SMTP) se añadirán sin tocar a los llamadores. */
export abstract class MailService {
  abstract sendPasswordReset(to: string, resetUrl: string): Promise<void>;
}

/**
 * SOLO DESARROLLO: escribe el "correo" en un fichero local (carpeta ignorada por git) en lugar de
 * enviarlo. El enlace NO se escribe en logs. No se permite en producción (lo impide la configuración).
 */
@Injectable()
export class FileMailService extends MailService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
  }

  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    const dir = resolve(this.config.mailDir);
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${Date.now()}-${randomUUID()}.json`);
    const message = {
      to,
      subject: "Restablecer contraseña",
      text: `Para restablecer tu contraseña abre este enlace (caduca pronto y solo sirve una vez):\n${resetUrl}`,
    };
    await writeFile(file, JSON.stringify(message, null, 2), { encoding: "utf8", mode: 0o600 });
  }
}

/** Sin proveedor de correo configurado: no se envía nada (la API responde igual, sin revelar nada). */
@Injectable()
export class DisabledMailService extends MailService {
  private readonly logger = new Logger("Correo");
  private warned = false;

  async sendPasswordReset(): Promise<void> {
    if (!this.warned) {
      this.warned = true;
      this.logger.warn("MAIL_DRIVER=disabled: la recuperación de contraseña no puede entregar correos.");
    }
  }
}
