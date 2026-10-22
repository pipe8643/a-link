import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { MAX_EXPORTS_PER_USER } from "../src/common/limits.js";
import { errorShape, mkFolder, mkGraph, resetDatabase } from "./helpers/domain.js";
import { MIME, makeJpeg, makePdf, makePng, makePptx } from "./helpers/files.js";
import { type TestApp, createTestApp, register } from "./helpers/test-app.js";

const hasDb = !!process.env.TEST_DATABASE_URL;

type Agent = Awaited<ReturnType<typeof register>>["agent"];

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function upload(agent: Agent, graphId: string, body: Buffer | string, opts: { mime?: string; name?: string | null; query?: string } = {}) {
  let req = agent.post(`/api/v1/graphs/${graphId}/exports${opts.query ?? ""}`).set("Content-Type", opts.mime ?? MIME.png);
  if (opts.name !== null) req = req.set("X-Export-Name", encodeURIComponent(opts.name ?? "Mi exportación"));
  return req.send(body);
}

/** Todos los ficheros que hay ahora mismo en el almacenamiento privado (rutas relativas). */
function storedObjects(t: TestApp): string[] {
  const root = join(t.storageDir, "exports");
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(t.storageDir.length + 1).replaceAll("\\", "/"));
}

function clearStorage(t: TestApp) {
  rmSync(join(t.storageDir, "exports"), { recursive: true, force: true });
}

/** PNG válido con relleno hasta `bytes` (el contenido tras IEND no invalida la firma). */
function bigPng(bytes: number): Buffer {
  return Buffer.concat([makePng(), Buffer.alloc(bytes, 7)]);
}

describe.skipIf(!hasDb)("exportaciones guardadas: subida, descarga y gestión (API real + MySQL + disco)", () => {
  let t: TestApp;
  let U: Awaited<ReturnType<typeof register>>;
  let graphId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await resetDatabase(t);
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    clearStorage(t);
    U = await register(t);
    graphId = await mkGraph(U.agent, "Caso de prueba");
  });

  describe("subir", () => {
    it.each([
      ["png", makePng, MIME.png, "png"],
      ["jpeg", makeJpeg, MIME.jpeg, "jpg"],
      ["pdf", makePdf, MIME.pdf, "pdf"],
      ["pptx", makePptx, MIME.pptx, "pptx"],
    ] as const)("guarda un %s: metadatos correctos, huella SHA-256 y objeto privado fuera de las rutas servidas", async (format, make, mime, ext) => {
      const data = make();
      const res = await upload(U.agent, graphId, data, { mime, name: `Informe final.${ext}` });
      expect(res.status).toBe(201);
      const file = res.body.file;
      expect(file).toMatchObject({ graphId, graphName: "Caso de prueba", folderId: null, name: "Informe final", format, fileSize: data.length, sha256: sha(data), graphTrashed: false });
      expect(file.id).toMatch(/^[0-9a-f-]{36}$/);

      // Nunca se expone ni el propietario ni la clave interna del almacenamiento.
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/ownerId|storageKey|exports\//);

      // El objeto existe con una clave generada por el servidor (nada del nombre del usuario en la ruta).
      const row = await t.prisma.exportFile.findFirstOrThrow({ where: { id: file.id } });
      expect(row.storageKey).toMatch(new RegExp(`^exports/${U.userId}/[0-9a-f-]{36}$`));
      expect(row.storageKey.toLowerCase()).not.toContain("informe");
      expect(readFileSync(join(t.storageDir, ...row.storageKey.split("/"))).equals(data)).toBe(true);
    });

    it("la carpeta por defecto es la del grafo; `folderId=root` la quita; una carpeta propia se respeta", async () => {
      const folder = await mkFolder(U.agent, "Casos");
      const other = await mkFolder(U.agent, "Archivo");
      const inFolder = await mkGraph(U.agent, "En carpeta", folder);
      expect((await upload(U.agent, inFolder, makePng())).body.file.folderId).toBe(folder);
      expect((await upload(U.agent, inFolder, makePng(), { query: "?folderId=root" })).body.file.folderId).toBeNull();
      expect((await upload(U.agent, inFolder, makePng(), { query: `?folderId=${other}` })).body.file.folderId).toBe(other);
    });

    it("sin nombre usa el del grafo; el nombre llega saneado (sin rutas ni caracteres de control) y con acentos", async () => {
      expect((await upload(U.agent, graphId, makePng(), { name: null })).body.file.name).toBe("Caso de prueba");
      expect((await upload(U.agent, graphId, makePng(), { name: "../../etc/passwd" })).body.file.name).not.toMatch(/[/\\]/);
      expect((await upload(U.agent, graphId, makePng(), { name: "Relación «ñandú» 日本" })).body.file.name).toBe("Relación «ñandú» 日本");
      expect((await upload(U.agent, graphId, makePng(), { name: "a\u0001b\u007fc" })).body.file.name).toBe("a b c");
      expect((await upload(U.agent, graphId, makePng(), { name: "x".repeat(400) })).body.file.name).toHaveLength(120);
    });

    it("un nombre con codificación rota o desmesurado se rechaza con 400", async () => {
      const bad = await U.agent.post(`/api/v1/graphs/${graphId}/exports`).set("Content-Type", MIME.png).set("X-Export-Name", "%E0%A4%A").send(makePng());
      expect(bad.status).toBe(400);
      const long = await U.agent.post(`/api/v1/graphs/${graphId}/exports`).set("Content-Type", MIME.png).set("X-Export-Name", "a".repeat(1000)).send(makePng());
      expect(long.status).toBe(400);
      expect(storedObjects(t)).toEqual([]);
    });

    it("rechaza lo que no es un fichero admitido, aunque el cliente declare otro tipo, y no guarda nada", async () => {
      const cases: Array<[string, Buffer | string, string, number, string]> = [
        ["vacío", Buffer.alloc(0), MIME.png, 400, "EMPTY_FILE"],
        ["HTML disfrazado de PNG", "<html><script>alert(1)</script></html>", MIME.png, 415, "UNSUPPORTED_FILE"],
        ["ejecutable", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200)]), "application/octet-stream", 415, "UNSUPPORTED_FILE"],
        ["PNG declarado como PDF", makePng(), MIME.pdf, 415, "MIME_MISMATCH"],
        ["PDF declarado como JPEG", makePdf(), MIME.jpeg, 415, "MIME_MISMATCH"],
        ["PNG sin tipo declarado", makePng(), "application/octet-stream", 415, "MIME_MISMATCH"],
        ["ZIP que no es PowerPoint", Buffer.from("PK\u0003\u0004" + "x".repeat(40), "latin1"), MIME.pptx, 415, "UNSUPPORTED_FILE"],
      ];
      for (const [name, body, mime, status, code] of cases) {
        const res = await upload(U.agent, graphId, body, { mime });
        expect(res.status, name).toBe(status);
        expect(res.body.code, name).toBe(code);
      }
      expect(storedObjects(t)).toEqual([]);
      expect(await t.prisma.exportFile.count()).toBe(0);
    });

    it("exige sesión y cabecera Origin válida (CSRF)", async () => {
      expect((await t.raw().post(`/api/v1/graphs/${graphId}/exports`).set("Origin", "http://localhost:5173").set("Content-Type", MIME.png).send(makePng())).status).toBe(401);
      const noOrigin = await t.raw().post(`/api/v1/graphs/${graphId}/exports`).set("Cookie", `alink_sid=x`).set("Content-Type", MIME.png).send(makePng());
      expect(noOrigin.status).toBe(403);
      const evil = await U.agent.post(`/api/v1/graphs/${graphId}/exports`).set("Origin", "http://evil.test").set("Content-Type", MIME.png).send(makePng());
      expect(evil.status).toBe(403);
      expect(storedObjects(t)).toEqual([]);
    });

    it("no se guarda en un grafo de la papelera y no queda nada en el almacenamiento", async () => {
      await U.agent.delete(`/api/v1/graphs/${graphId}`);
      const res = await upload(U.agent, graphId, makePng());
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("GRAPH_IN_TRASH");
      expect(storedObjects(t)).toEqual([]);
    });

    it("una carpeta ajena o inexistente da 404 y no deja un objeto huérfano", async () => {
      const B = await register(t);
      const folderOfB = await mkFolder(B.agent, "De B");
      const foreign = await upload(U.agent, graphId, makePng(), { query: `?folderId=${folderOfB}` });
      const missing = await upload(U.agent, graphId, makePng(), { query: `?folderId=${randomUUID()}` });
      expect(foreign.status).toBe(404);
      expect(errorShape(foreign.body)).toEqual(errorShape(missing.body));
      expect(storedObjects(t)).toEqual([]);
      expect(await t.prisma.exportFile.count()).toBe(0);
    });

    it("valida el formato de los parámetros", async () => {
      expect((await upload(U.agent, graphId, makePng(), { query: "?folderId=no-es-uuid" })).status).toBe(400);
      expect((await upload(U.agent, graphId, makePng(), { query: "?otra=cosa" })).status).toBe(400);
      expect((await upload(U.agent, "no-es-uuid", makePng())).status).toBe(400);
    });

    it("registra la auditoría sin nombres ni contenido", async () => {
      const res = await upload(U.agent, graphId, makePng(), { name: "Nombre-secreto-del-caso" });
      const entry = await t.prisma.auditLog.findFirstOrThrow({ where: { action: "export.created", resourceId: res.body.file.id } });
      expect(entry.actorId).toBe(U.userId);
      expect(JSON.stringify(entry)).not.toContain("Nombre-secreto-del-caso");
      expect(entry.metadata).toMatchObject({ format: "PNG" });
    });
  });

  describe("descargar", () => {
    it("devuelve exactamente los mismos bytes, como descarga, con el tipo real y sin que el navegador lo reinterprete", async () => {
      const data = makePdf();
      const { body } = await upload(U.agent, graphId, data, { mime: MIME.pdf, name: "Resumen ñandú" });
      const res = await U.agent.get(`/api/v1/files/${body.file.id}/content`).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
      expect(res.status).toBe(200);
      expect((res.body as Buffer).equals(data)).toBe(true);
      expect(sha(res.body as Buffer)).toBe(body.file.sha256);
      expect(res.headers["content-type"]).toBe("application/pdf");
      expect(res.headers["content-length"]).toBe(String(data.length));
      expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="Resumen _and_\.pdf"; filename\*=UTF-8''Resumen%20%C3%B1and%C3%BA\.pdf$/);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["cache-control"]).toMatch(/no-store/);
      expect(res.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
    });

    it("la descarga exige sesión", async () => {
      const { body } = await upload(U.agent, graphId, makePng());
      expect((await t.raw().get(`/api/v1/files/${body.file.id}/content`)).status).toBe(401);
    });

    it("si el objeto desapareció del almacenamiento responde 404 claro y el archivo se puede eliminar de la lista", async () => {
      const { body } = await upload(U.agent, graphId, makePng());
      const row = await t.prisma.exportFile.findFirstOrThrow({ where: { id: body.file.id } });
      rmSync(join(t.storageDir, ...row.storageKey.split("/")));
      const res = await U.agent.get(`/api/v1/files/${body.file.id}/content`);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("FILE_UNAVAILABLE");
      expect((await U.agent.delete(`/api/v1/files/${body.file.id}`)).status).toBe(204);
      expect(await t.prisma.exportFile.count()).toBe(0);
    });

    it("registra la descarga en la auditoría", async () => {
      const { body } = await upload(U.agent, graphId, makePng());
      await U.agent.get(`/api/v1/files/${body.file.id}/content`).buffer(false).parse((r, cb) => {
        r.on("data", () => undefined);
        r.on("end", () => cb(null, null));
      });
      expect(await t.prisma.auditLog.count({ where: { action: "export.downloaded", resourceId: body.file.id } })).toBe(1);
    });
  });

  describe("listar, renombrar, mover y eliminar", () => {
    it("lista con filtros, orden (más reciente primero) y paginación estable", async () => {
      const g2 = await mkGraph(U.agent, "Otro grafo");
      const a = (await upload(U.agent, graphId, makePng(), { name: "alfa" })).body.file;
      await new Promise((r) => setTimeout(r, 15));
      const b = (await upload(U.agent, graphId, makePdf(), { mime: MIME.pdf, name: "beta" })).body.file;
      await new Promise((r) => setTimeout(r, 15));
      const c = (await upload(U.agent, g2, makeJpeg(), { mime: MIME.jpeg, name: "gamma" })).body.file;

      const all = await U.agent.get("/api/v1/files");
      expect(all.status).toBe(200);
      expect(all.body.items.map((f: { id: string }) => f.id)).toEqual([c.id, b.id, a.id]);
      expect(all.body.total).toBe(3);

      expect((await U.agent.get(`/api/v1/files?graphId=${graphId}`)).body.items.map((f: { name: string }) => f.name)).toEqual(["beta", "alfa"]);
      expect((await U.agent.get("/api/v1/files?format=jpeg")).body.items.map((f: { name: string }) => f.name)).toEqual(["gamma"]);
      expect((await U.agent.get("/api/v1/files?search=alf")).body.items.map((f: { name: string }) => f.name)).toEqual(["alfa"]);
      expect((await U.agent.get("/api/v1/files?pageSize=2&page=2")).body.items.map((f: { name: string }) => f.name)).toEqual(["alfa"]);
      expect((await U.agent.get(`/api/v1/graphs/${graphId}/exports`)).body.total).toBe(2);
      expect((await U.agent.get("/api/v1/files?format=exe")).status).toBe(400);
      expect((await U.agent.get("/api/v1/files?pageSize=1000")).status).toBe(400);
    });

    it("renombra (con saneado) y mueve a una carpeta propia o a la raíz", async () => {
      const folder = await mkFolder(U.agent, "Informes");
      const { file } = (await upload(U.agent, graphId, makePng(), { name: "viejo" })).body;
      const renamed = await U.agent.patch(`/api/v1/files/${file.id}`).send({ name: "  nuevo.png  " });
      expect(renamed.status).toBe(200);
      expect(renamed.body.file.name).toBe("nuevo");
      const moved = await U.agent.patch(`/api/v1/files/${file.id}`).send({ folderId: folder });
      expect(moved.body.file).toMatchObject({ name: "nuevo", folderId: folder });
      expect((await U.agent.patch(`/api/v1/files/${file.id}`).send({ folderId: null })).body.file.folderId).toBeNull();
      expect((await U.agent.get(`/api/v1/files?folderId=${folder}`)).body.total).toBe(0);
      // El nombre de descarga sigue la extensión REAL del contenido, no el nombre que se le ponga.
      const dl = await U.agent.get(`/api/v1/files/${file.id}/content`).buffer(false).parse((r, cb) => {
        r.on("data", () => undefined);
        r.on("end", () => cb(null, null));
      });
      expect(dl.headers["content-disposition"]).toContain('filename="nuevo.png"');
    });

    it("valida los cambios: nombre vacío o con caracteres de control, campos desconocidos y carpeta inexistente", async () => {
      const { file } = (await upload(U.agent, graphId, makePng())).body;
      expect((await U.agent.patch(`/api/v1/files/${file.id}`).send({ name: "" })).status).toBe(400);
      expect((await U.agent.patch(`/api/v1/files/${file.id}`).send({ name: "a\u0000b" })).status).toBe(400);
      expect((await U.agent.patch(`/api/v1/files/${file.id}`).send({ storageKey: "exports/x/y" })).status).toBe(400);
      expect((await U.agent.patch(`/api/v1/files/${file.id}`).send({ ownerId: randomUUID() })).status).toBe(400);
      expect((await U.agent.patch(`/api/v1/files/${file.id}`).send({ folderId: randomUUID() })).status).toBe(404);
    });

    it("eliminar borra el objeto y la fila; un segundo intento y la descarga posterior dan 404", async () => {
      const { file } = (await upload(U.agent, graphId, makePng())).body;
      expect(storedObjects(t)).toHaveLength(1);
      expect((await U.agent.delete(`/api/v1/files/${file.id}`)).status).toBe(204);
      expect(storedObjects(t)).toEqual([]);
      expect((await U.agent.delete(`/api/v1/files/${file.id}`)).status).toBe(404);
      expect((await U.agent.get(`/api/v1/files/${file.id}/content`)).status).toBe(404);
      expect((await U.agent.get(`/api/v1/files/${file.id}`)).status).toBe(404);
    });

    it("el borrado definitivo del grafo purga también los OBJETOS del almacenamiento, no solo las filas", async () => {
      const other = await mkGraph(U.agent, "Se queda");
      await upload(U.agent, graphId, makePng());
      await upload(U.agent, graphId, makePdf(), { mime: MIME.pdf });
      const kept = (await upload(U.agent, other, makePng())).body.file;
      expect(storedObjects(t)).toHaveLength(3);

      await U.agent.delete(`/api/v1/graphs/${graphId}`);
      // En la papelera los archivos siguen ahí (el grafo se puede restaurar) y se marcan.
      expect((await U.agent.get(`/api/v1/files?graphId=${graphId}`)).body.items.every((f: { graphTrashed: boolean }) => f.graphTrashed)).toBe(true);
      expect(storedObjects(t)).toHaveLength(3);

      expect((await U.agent.delete(`/api/v1/graphs/${graphId}/permanent`)).status).toBe(204);
      expect(storedObjects(t)).toHaveLength(1);
      expect(await t.prisma.exportFile.count()).toBe(1);
      expect((await U.agent.get(`/api/v1/files/${kept.id}`)).status).toBe(200);
    });

    it("al borrar una carpeta con archivos guardados, estos no se pierden (pasan a la carpeta superior)", async () => {
      const parent = await mkFolder(U.agent, "Padre");
      const child = await mkFolder(U.agent, "Hijo", parent);
      const { file } = (await upload(U.agent, graphId, makePng(), { query: `?folderId=${child}` })).body;
      expect((await U.agent.delete(`/api/v1/folders/${child}?contents=move_to_parent`)).status).toBe(204);
      expect((await U.agent.get(`/api/v1/files/${file.id}`)).body.file.folderId).toBe(parent);
      expect((await U.agent.get(`/api/v1/files/${file.id}/content`).buffer(false).parse((r, cb) => { r.on("data", () => undefined); r.on("end", () => cb(null, null)); })).status).toBe(200);
    });

    it("el panel cuenta las exportaciones guardadas", async () => {
      await upload(U.agent, graphId, makePng());
      await upload(U.agent, graphId, makePng());
      expect((await U.agent.get("/api/v1/dashboard")).body.counts.exports).toBe(2);
    });
  });

  describe("límites", () => {
    it("rechaza al llegar al máximo de exportaciones por usuario y no escribe el objeto", async () => {
      await t.prisma.exportFile.createMany({
        data: Array.from({ length: MAX_EXPORTS_PER_USER }, (_, i) => ({
          ownerId: U.userId,
          graphId,
          name: `n${i}`,
          format: "PNG" as const,
          storageKey: `exports/${U.userId}/${randomUUID()}`,
          fileSize: 1,
          sha256: "a".repeat(64),
        })),
      });
      const res = await upload(U.agent, graphId, makePng());
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("EXPORT_LIMIT_REACHED");
      expect(storedObjects(t)).toEqual([]);
    });
  });
});

describe.skipIf(!hasDb)("exportaciones: tamaño máximo y cuota de espacio (límites reducidos a 1 MB)", () => {
  let t: TestApp;
  let U: Awaited<ReturnType<typeof register>>;
  let graphId: string;

  beforeAll(async () => {
    t = await createTestApp({ MAX_EXPORT_FILE_MB: "1", EXPORT_QUOTA_MB_PER_USER: "1" });
  });
  afterAll(async () => {
    await resetDatabase(t);
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    clearStorage(t);
    U = await register(t);
    graphId = await mkGraph(U.agent, "Caso");
  });

  it("un archivo por encima del máximo da 413, sin guardar nada", async () => {
    const res = await upload(U.agent, graphId, bigPng(1024 * 1024 + 10));
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("PAYLOAD_TOO_LARGE");
    expect(storedObjects(t)).toEqual([]);
    expect(await t.prisma.exportFile.count()).toBe(0);
  });

  it("sin sesión (o con cookie falsa) no se llega a leer un cuerpo grande: 401, no 413", async () => {
    await t.app.listen(0, "127.0.0.1");
    const { port } = t.app.getHttpServer().address() as AddressInfo;
    const body = bigPng(2 * 1024 * 1024); // el doble del máximo permitido
    const post = (cookie?: string) =>
      new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          {
            host: "127.0.0.1",
            port,
            path: `/api/v1/graphs/${graphId}/exports`,
            method: "POST",
            headers: {
              "content-type": MIME.png,
              "content-length": body.length,
              origin: "http://localhost:5173",
              ...(cookie ? { cookie } : {}),
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on("error", (err) =>
          (err as NodeJS.ErrnoException).code === "ECONNRESET" || (err as NodeJS.ErrnoException).code === "EPIPE" ? undefined : reject(err),
        );
        req.end(body);
      });
    expect(await post()).toBe(401);
    expect(await post(`${t.config.sessionCookieName}=${"a".repeat(43)}`)).toBe(401);
  });

  it("la cuota de espacio se respeta y liberar un archivo devuelve el espacio", async () => {
    const a = await upload(U.agent, graphId, bigPng(400 * 1024), { name: "a" });
    const b = await upload(U.agent, graphId, bigPng(400 * 1024), { name: "b" });
    expect([a.status, b.status]).toEqual([201, 201]);
    const c = await upload(U.agent, graphId, bigPng(400 * 1024), { name: "c" });
    expect(c.status).toBe(409);
    expect(c.body.code).toBe("EXPORT_QUOTA_EXCEEDED");
    expect(storedObjects(t)).toHaveLength(2);

    await U.agent.delete(`/api/v1/files/${a.body.file.id}`);
    expect((await upload(U.agent, graphId, bigPng(400 * 1024), { name: "d" })).status).toBe(201);
    expect(storedObjects(t)).toHaveLength(2);
  });

  it("la cuota es por usuario: llenar la de A no afecta a B", async () => {
    await upload(U.agent, graphId, bigPng(400 * 1024));
    await upload(U.agent, graphId, bigPng(400 * 1024));
    const B = await register(t);
    const gB = await mkGraph(B.agent, "De B");
    expect((await upload(B.agent, gB, bigPng(400 * 1024))).status).toBe(201);
  });

  it("subidas simultáneas no pueden saltarse la cuota ni dejar objetos huérfanos", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => upload(U.agent, graphId, bigPng(400 * 1024), { name: `p${i}` })));
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(2); // 1 MB de cuota / 400 KB
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    expect(await t.prisma.exportFile.count()).toBe(2);
    expect(storedObjects(t)).toHaveLength(2);
    const total = statSync(t.storageDir).isDirectory() ? storedObjects(t).length : 0;
    expect(total).toBe(2);
  });
});

describe.skipIf(!hasDb)("exportaciones: aislamiento entre usuarios (A frente a recursos de B conociendo sus UUID)", () => {
  let t: TestApp;
  let A: Awaited<ReturnType<typeof register>>;
  let B: Awaited<ReturnType<typeof register>>;
  let graphB: string;
  let fileB: { id: string; sha256: string };
  let dataB: Buffer;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await resetDatabase(t);
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    clearStorage(t);
    A = await register(t);
    B = await register(t);
    graphB = await mkGraph(B.agent, "Grafo de B");
    dataB = makePng("solo-de-b");
    fileB = (await upload(B.agent, graphB, dataB, { name: "Privado de B" })).body.file;
  });

  const nothing = randomUUID();

  it("A no puede ver, descargar, renombrar, mover ni borrar el archivo de B: siempre el mismo 404 que un UUID inexistente", async () => {
    const attempts: Array<[string, (id: string) => Promise<{ status: number; body: Record<string, unknown> }>]> = [
      ["metadatos", (id) => A.agent.get(`/api/v1/files/${id}`)],
      ["contenido", (id) => A.agent.get(`/api/v1/files/${id}/content`)],
      ["renombrar", (id) => A.agent.patch(`/api/v1/files/${id}`).send({ name: "robado" })],
      ["mover", (id) => A.agent.patch(`/api/v1/files/${id}`).send({ folderId: null })],
      ["borrar", (id) => A.agent.delete(`/api/v1/files/${id}`)],
    ];
    for (const [name, run] of attempts) {
      const foreign = await run(fileB.id);
      const missing = await run(nothing);
      expect(foreign.status, name).toBe(404);
      expect(errorShape(foreign.body), name).toEqual(errorShape(missing.body));
      expect(JSON.stringify(foreign.body), name).not.toContain("Privado de B");
    }
  });

  it("tras todos los intentos, el archivo de B sigue intacto (fila, objeto y contenido)", async () => {
    await A.agent.patch(`/api/v1/files/${fileB.id}`).send({ name: "robado" });
    await A.agent.delete(`/api/v1/files/${fileB.id}`);
    expect(storedObjects(t)).toHaveLength(1);
    const meta = await B.agent.get(`/api/v1/files/${fileB.id}`);
    expect(meta.body.file.name).toBe("Privado de B");
    const dl = await B.agent.get(`/api/v1/files/${fileB.id}/content`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect((dl.body as Buffer).equals(dataB)).toBe(true);
  });

  it("A no ve archivos de B en sus listados, ni siquiera filtrando por el grafo o el formato de B", async () => {
    const all = await A.agent.get("/api/v1/files");
    expect(all.body).toMatchObject({ items: [], total: 0 });
    expect((await A.agent.get(`/api/v1/files?graphId=${graphB}`)).body.total).toBe(0);
    expect((await A.agent.get("/api/v1/files?search=Privado")).body.total).toBe(0);
    expect((await A.agent.get("/api/v1/dashboard")).body.counts.exports).toBe(0);
  });

  it("A no puede listar ni subir exportaciones al grafo de B, y recibe el mismo 404 que con un grafo inexistente", async () => {
    const list = await A.agent.get(`/api/v1/graphs/${graphB}/exports`);
    const listMissing = await A.agent.get(`/api/v1/graphs/${nothing}/exports`);
    expect(list.status).toBe(404);
    expect(errorShape(list.body)).toEqual(errorShape(listMissing.body));

    const up = await upload(A.agent, graphB, makePng());
    const upMissing = await upload(A.agent, nothing, makePng());
    expect(up.status).toBe(404);
    expect(errorShape(up.body)).toEqual(errorShape(upMissing.body));
    expect(storedObjects(t)).toHaveLength(1); // solo el de B
    expect(await t.prisma.exportFile.count({ where: { graphId: graphB } })).toBe(1);
  });

  it("A no puede colocar su archivo en una carpeta de B (ni al subir ni al mover)", async () => {
    const folderB = await mkFolder(B.agent, "Carpeta de B");
    const graphA = await mkGraph(A.agent, "De A");
    const fileA = (await upload(A.agent, graphA, makePng())).body.file;
    expect((await upload(A.agent, graphA, makePng(), { query: `?folderId=${folderB}` })).status).toBe(404);
    expect((await A.agent.patch(`/api/v1/files/${fileA.id}`).send({ folderId: folderB })).status).toBe(404);
    expect((await A.agent.get(`/api/v1/files/${fileA.id}`)).body.file.folderId).toBeNull();
    expect(await t.prisma.exportFile.count({ where: { folderId: folderB } })).toBe(0);
  });

  it("A no puede borrar el grafo de B ni purgar sus archivos", async () => {
    await B.agent.delete(`/api/v1/graphs/${graphB}`);
    expect((await A.agent.delete(`/api/v1/graphs/${graphB}/permanent`)).status).toBe(404);
    expect(storedObjects(t)).toHaveLength(1);
    expect(await t.prisma.exportFile.count({ where: { id: fileB.id } })).toBe(1);
  });

  it("el cliente no puede dictar propietario ni clave: se ignoran o se rechazan", async () => {
    const graphA = await mkGraph(A.agent, "De A");
    const res = await A.agent.post(`/api/v1/graphs/${graphA}/exports?ownerId=${B.userId}`).set("Content-Type", MIME.png).send(makePng());
    expect(res.status).toBe(400); // parámetro desconocido (forbidNonWhitelisted)
    const ok = await upload(A.agent, graphA, makePng()).then((r) => r.body.file.id as string);
    const row = await t.prisma.exportFile.findFirstOrThrow({ where: { id: ok } });
    expect(row.ownerId).toBe(A.userId);
    expect(row.storageKey.startsWith(`exports/${A.userId}/`)).toBe(true);
  });

  it("una sesión cerrada ya no puede descargar", async () => {
    await B.agent.post("/api/v1/auth/logout");
    expect((await B.agent.get(`/api/v1/files/${fileB.id}/content`)).status).toBe(401);
  });
});
