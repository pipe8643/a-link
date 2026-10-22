import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../db/prisma.service.js";

export type AuditAction =
  | "auth.register"
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "auth.password_changed"
  | "auth.password_reset_requested"
  | "auth.password_reset"
  | "auth.session_revoked"
  | "auth.sessions_revoked_others"
  | "user.profile_updated"
  | "folder.created"
  | "folder.updated"
  | "folder.deleted"
  | "graph.created"
  | "graph.updated"
  | "graph.trashed"
  | "graph.restored"
  | "graph.deleted"
  | "graph.duplicated"
  | "image.uploaded"
  | "share.created"
  | "share.revoked"
  | "export.created"
  | "export.updated"
  | "export.deleted"
  | "export.downloaded";

export interface AuditEntry {
  actorId: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  /** SOLO información mínima y no sensible: nunca correos, contraseñas, tokens ni contenido de grafos. */
  metadata?: Record<string, string | number | boolean>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger("Auditoría");

  constructor(private readonly prisma: PrismaService) {}

  /** La auditoría nunca debe romper la operación principal: un fallo se registra y se continúa. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.client.auditLog.create({
        data: {
          actorId: entry.actorId,
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId ?? null,
          metadata: entry.metadata ?? undefined,
        },
      });
    } catch {
      this.logger.error(`No se pudo registrar la acción ${entry.action}`);
    }
  }
}
