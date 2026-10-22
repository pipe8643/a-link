import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentAuth } from "../auth/auth.guard.js";
import { uuidParam } from "../common/dto-helpers.js";
import type { AuthContext } from "../common/request-context.js";
import { CreateFolderDto, DeleteFolderQuery, UpdateFolderDto } from "./dto.js";
import { FoldersService } from "./folders.service.js";

/** El propietario sale SIEMPRE de la sesión (`auth.userId`); ningún endpoint lo recibe del cliente. */
@ApiTags("folders")
@Controller("folders")
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext) {
    return this.folders.list(auth.userId);
  }

  @Post()
  async create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateFolderDto) {
    return { folder: await this.folders.create(auth.userId, dto) };
  }

  @Get(":id")
  async get(@CurrentAuth() auth: AuthContext, @Param("id", uuidParam()) id: string) {
    return { folder: await this.folders.get(auth.userId, id) };
  }

  @Patch(":id")
  async update(@CurrentAuth() auth: AuthContext, @Param("id", uuidParam()) id: string, @Body() dto: UpdateFolderDto) {
    return { folder: await this.folders.update(auth.userId, id, dto) };
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param("id", uuidParam()) id: string,
    @Query() query: DeleteFolderQuery,
  ): Promise<void> {
    await this.folders.remove(auth.userId, id, query.contents);
  }
}
