import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentAuth } from "../auth/auth.guard.js";
import { uuidParam } from "../common/dto-helpers.js";
import type { AuthContext } from "../common/request-context.js";
import { CreateGraphDto, DuplicateGraphDto, ListGraphsQuery, UpdateGraphDto } from "./dto.js";
import { GraphContentService } from "./graph-content.service.js";
import { GraphsService } from "./graphs.service.js";

/** Metadatos del grafo y su contenido (`:id/content`). */
@ApiTags("graphs")
@Controller("graphs")
export class GraphsController {
  constructor(
    private readonly graphs: GraphsService,
    private readonly content: GraphContentService,
  ) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext, @Query() query: ListGraphsQuery) {
    return this.graphs.list(auth.userId, query);
  }

  @Post()
  async create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateGraphDto) {
    return { graph: await this.graphs.create(auth.userId, dto) };
  }

  @Get(":id")
  async get(@CurrentAuth() auth: AuthContext, @Param("id", uuidParam()) id: string) {
    return { graph: await this.graphs.get(auth.userId, id) };
  }

  @Patch(":id")
  async update(@CurrentAuth() auth: AuthContext, @Param("id", uuidParam()) id: string, @Body() dto: UpdateGraphDto) {
    return { graph: await this.graphs.update(auth.userId, id, dto) };
  }

  /** Envía a la papelera (reversible). */
  @Delete(":id")
  @HttpCode(204)
  async trash(@CurrentAuth() auth: AuthContext, @Param("id", uuidParam()) id: string): Promise<void> {
    await this.graphs.trash(auth.userId, id);
  }

  @Post(":id/restore")
  @HttpCode(200)
  async restore(@CurrentAuth() auth: AuthContext, @Param("id", uuidParam()) id: string) {
    return { graph: await this.graphs.restore(auth.userId, id) };
  }

  /** Solo grafos que ya están en la papelera. */
  @Delete(":id/permanent")
  @HttpCode(204)
  async deletePermanently(@CurrentAuth() auth: AuthContext, @Param("id", uuidParam()) id: string): Promise<void> {
    await this.graphs.deletePermanently(auth.userId, id);
  }

  /** Contenido (entidades y relaciones) y revisión vigente. */
  @Get(":id/content")
  getContent(@CurrentAuth() auth: AuthContext, @Param("id", uuidParam()) id: string) {
    return this.content.get(auth.userId, id);
  }

  /**
   * Guarda el contenido completo con concurrencia optimista: `{ expectedRevision, nodes, edges }`.
   * Se valida con el esquema compartido (no con class-validator) porque es la misma regla que usa el editor.
   */
  @Put(":id/content")
  saveContent(@CurrentAuth() auth: AuthContext, @Param("id", uuidParam()) id: string, @Body() body: unknown) {
    return this.content.save(auth.userId, id, body);
  }

  @Post(":id/duplicate")
  async duplicate(@CurrentAuth() auth: AuthContext, @Param("id", uuidParam()) id: string, @Body() dto: DuplicateGraphDto) {
    return { graph: await this.graphs.duplicate(auth.userId, id, dto) };
  }
}
