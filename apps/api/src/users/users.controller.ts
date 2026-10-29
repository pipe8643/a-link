import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Patch, Post, Put, Req, Res, StreamableFile } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AuditService } from "../audit/audit.service.js";
import { CurrentAuth } from "../auth/auth.guard.js";
import { AuthService } from "../auth/auth.service.js";
import { ChangePasswordDto, UpdateProfileDto } from "../auth/dto.js";
import type { AuthContext } from "../common/request-context.js";
import { PrismaService } from "../db/prisma.service.js";
import { sendImage } from "../images/images.controller.js";
import { LetterheadService } from "./letterhead.service.js";

const USER_SELECT = { id: true, email: true, displayName: true, createdAt: true } as const;

@ApiTags("users")
@Controller("users/me")
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly letterhead: LetterheadService,
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

  /** Sustituye el membrete personal. El cuerpo es la imagen ya re-codificada (sin EXIF). */
  @Put("letterhead")
  async putLetterhead(@CurrentAuth() auth: AuthContext, @Req() req: Request) {
    const letterhead = await this.letterhead.upsert(auth.userId, { data: req.body, declaredMime: req.headers["content-type"] });
    return { letterhead };
  }

  @Get("letterhead")
  async getLetterhead(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<StreamableFile | undefined> {
    return sendImage(req, res, await this.letterhead.open(auth.userId));
  }

  @Delete("letterhead")
  @HttpCode(204)
  async deleteLetterhead(@CurrentAuth() auth: AuthContext): Promise<void> {
    await this.letterhead.remove(auth.userId);
  }
}
