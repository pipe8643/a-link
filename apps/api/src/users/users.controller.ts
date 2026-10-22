import { Body, Controller, Get, HttpCode, NotFoundException, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuditService } from "../audit/audit.service.js";
import { CurrentAuth } from "../auth/auth.guard.js";
import { AuthService } from "../auth/auth.service.js";
import { ChangePasswordDto, UpdateProfileDto } from "../auth/dto.js";
import type { AuthContext } from "../common/request-context.js";
import { PrismaService } from "../db/prisma.service.js";

const USER_SELECT = { id: true, email: true, displayName: true, createdAt: true } as const;

@ApiTags("users")
@Controller("users/me")
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  /** La identidad sale SIEMPRE de la sesión: no existe ningún /users/:id que un cliente pueda manipular. */
  @Get()
  async me(@CurrentAuth() auth: AuthContext) {
    const user = await this.prisma.client.user.findUnique({ where: { id: auth.userId }, select: USER_SELECT });
    if (!user) throw new NotFoundException();
    return { user };
  }

  @Patch()
  async update(@CurrentAuth() auth: AuthContext, @Body() dto: UpdateProfileDto) {
    const user = await this.prisma.client.user.update({
      where: { id: auth.userId },
      data: { ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}) },
      select: USER_SELECT,
    });
    await this.audit.record({ actorId: auth.userId, action: "user.profile_updated", resourceType: "user", resourceId: auth.userId });
    return { user };
  }

  @Post("password")
  @HttpCode(204)
  async changePassword(@CurrentAuth() auth: AuthContext, @Body() dto: ChangePasswordDto): Promise<void> {
    await this.auth.changePassword(auth, dto.currentPassword, dto.newPassword);
  }
}
