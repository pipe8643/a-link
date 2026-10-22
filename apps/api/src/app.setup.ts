import { Logger } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { json, raw } from "express";
import { IMAGE_LIMITS } from "@a-link/shared";
import helmet from "helmet";
import type { NextFunction, Request, Response } from "express";
import { SessionService } from "./auth/session.service.js";
import { type AppConfig, cookieNameFor } from "./config/app-config.js";
import { AllExceptionsFilter } from "./common/error-filter.js";
import {
  accessLogMiddleware,
  noStoreMiddleware,
  originCheckMiddleware,
  requestIdMiddleware,
} from "./common/middleware.js";
import { sessionTokenFromCookies } from "./common/session-cookie.js";
import { createValidationPipe } from "./common/validation.js";

export const API_PREFIX = "api/v1";

/** `PUT /api/v1/graphs/:id/content` (el parser solo se aplica a ese método y ruta exactos). */
const GRAPH_CONTENT_PATH = /^\/api\/v1\/graphs\/[^/]+\/content\/?$/;
/** `POST /api/v1/graphs/:id/exports`: cuerpo binario (el fichero exportado). */
const EXPORT_UPLOAD_PATH = /^\/api\/v1\/graphs\/[^/]+\/exports\/?$/;
/** `POST /api/v1/graphs/:id/images`: cuerpo binario (la imagen ya recortada; límite pequeño). */
const IMAGE_UPLOAD_PATH = /^\/api\/v1\/graphs\/[^/]+\/images\/?$/;

/**
 * Configuración común de la aplicación. Se usa tanto en `main.ts` como en las pruebas, de modo que las
 * pruebas ejercitan exactamente las mismas protecciones que producción.
 *
 * La app debe crearse con `{ bodyParser: false }`: el parser JSON se instala aquí con límite de tamaño.
 */
export function configureApp(app: NestExpressApplication, config: AppConfig, options: { accessLog?: boolean } = {}): void {
  app.set("trust proxy", config.trustProxyHops);
  app.disable("x-powered-by");

  app.use(requestIdMiddleware);

  // Cabeceras de seguridad. Swagger UI (solo fuera de producción) necesita scripts/estilos en línea.
  const strict = helmet({
    hsts: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    crossOriginResourcePolicy: { policy: "same-site" },
    referrerPolicy: { policy: "no-referrer" },
  });
  const docs = helmet({
    hsts: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
      },
    },
  });
  app.use((req: Request, res: Response, next: NextFunction) =>
    config.swaggerEnabled && req.path.startsWith("/api/docs") ? docs(req, res, next) : strict(req, res, next),
  );

  if (options.accessLog) app.use(accessLogMiddleware(new Logger("HTTP")));
  app.use(noStoreMiddleware);

  // CORS restrictivo: solo los orígenes configurados (nunca comodín, porque se usan cookies).
  app.enableCors({
    origin: config.appOrigins,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "X-Requested-With", "X-Export-Name", "X-Share-Token"],
    exposedHeaders: ["X-Request-Id", "Retry-After", "Content-Disposition"],
    maxAge: 600,
  });

  app.use(originCheckMiddleware(config.appOrigins)); // CSRF para peticiones que modifican estado
  app.use(cookieParser());

  // Cuerpos grandes solo DESPUÉS de comprobar que la sesión existe. Una cookie con el nombre correcto
  // (o un `Cookie` que solo contiene esa cadena) no basta: eso permitiría a un anónimo forzar el parseo
  // de 16–50 MB. Si la validación falla, se aplica el límite estricto. Fail-closed: un error → parser pequeño.
  const cookieName = cookieNameFor(config);
  const sessionOf = (req: Request) => {
    const token = sessionTokenFromCookies(req.cookies as Record<string, unknown>, cookieName);
    if (!token) return Promise.resolve(null);
    try {
      return app.get(SessionService).validate(token).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  };
  const largeBodyIfSession =
    (parser: (req: Request, res: Response, next: NextFunction) => void, method: string) =>
    (req: Request, res: Response, next: NextFunction) => {
      if (req.method !== method) return next();
      void sessionOf(req).then((principal) => (principal ? parser(req, res, next) : next()));
    };

  const bigJson = json({ limit: config.maxGraphContentBytes });
  app.use(GRAPH_CONTENT_PATH, largeBodyIfSession(bigJson, "PUT"));
  const fileBody = raw({ limit: config.maxExportFileBytes, type: () => true });
  app.use(EXPORT_UPLOAD_PATH, largeBodyIfSession(fileBody, "POST"));
  const imageBody = raw({ limit: IMAGE_LIMITS.maxBytes + 1024, type: () => true });
  app.use(IMAGE_UPLOAD_PATH, largeBodyIfSession(imageBody, "POST"));
  app.useBodyParser("json", { limit: config.maxRequestBodyBytes });

  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());

  if (config.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("A-Link API").setDescription("API REST versionada de A-Link").setVersion("0.1.0").build(),
    );
    SwaggerModule.setup("api/docs", app, document);
  }
}
