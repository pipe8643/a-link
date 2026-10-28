# Seguridad: OWASP Top 10 2025, ISO 27001 e inyecciones

Controles **técnicos** que implementa A-Link. No sustituye un Sistema de Gestión de Seguridad de la Información
(SGSI) ni una certificación ISO 27001: esos cubren organización, procesos y evidencia. Aquí se documenta qué hace
el código respecto al Top 10 de OWASP 2025, al anexo A de ISO/IEC 27001:2022 y a SQL injection / XSS.

## OWASP Top 10 2025

| ID | Riesgo | Cómo se cubre en A-Link |
|---|---|---|
| A01 | Broken Access Control (incluye SSRF) | Autorización por sesión en el servidor; `ownerId` nunca viene del cliente (`OwnershipService`). Rutas públicas inventariadas en `security.e2e.test.ts`. La API no pide URLs remotas (no hay fetch de perfil ni webhooks). |
| A02 | Security Misconfiguration | Helmet + Nginx (TLS 1.2/1.3, HSTS, CSP, `nosniff`, `frame-ancestors`, `server_tokens off`). Swagger solo fuera de producción. Cookies `__Host-` + `HttpOnly` + `Secure` + `SameSite=Lax`. |
| A03 | Software Supply Chain Failures | Dependabot, `npm audit --omit=dev --audit-level=high` en CI, `overrides` para parches transitivos, `scan:secrets`. |
| A04 | Cryptographic Failures | Argon2id para contraseñas; tokens de sesión y de compartir hasheados; TLS en el borde; `SESSION_SECRET` solo en entorno. |
| A05 | Injection | Prisma (consultas parametrizadas). `$queryRaw` solo en plantillas etiquetadas. `scan:unsafe` prohíbe `$queryRawUnsafe`. Zod + ValidationPipe (`forbidNonWhitelisted`). |
| A06 | Insecure Design | Privacidad por diseño, IDOR con 404 único, límites de tamaño, imágenes inspeccionadas por firma (no se decodifica EXIF). |
| A07 | Authentication Failures | Rate limit de login, bloqueo por IP+correo, registro opcional, tokens de recuperación en el fragmento `#`. |
| A08 | Software or Data Integrity Failures | Cuerpos con esquemas estrictos; exportaciones e imágenes por firma mágica, no por extensión; lockfile versionado. |
| A09 | Security Logging and Alerting Failures | Access log sin query string ni cookies; errores 5xx sin SQL ni valores de usuario; `X-Request-Id`. |
| A10 | Mishandling of Exceptional Conditions | `AllExceptionsFilter` unifica respuestas; fallos de parseo/cuerpo grande → 400/413; health no filtra detalles internos. |

## ISO/IEC 27001:2022 (anexo A, controles técnicos aplicables)

| Control | Qué cubre aquí |
|---|---|
| A.5.15 / A.8.3 Acceso a la información | Autorización por propietario; visor compartido solo con token de un solo uso lógico (hash en BD). |
| A.8.5 Autenticación segura | Argon2, cookies de sesión, rate limiting, recuperación sin token en la query. |
| A.8.8 Gestión de vulnerabilidades técnicas | Dependabot semanal, `npm run audit:prod`, overrides de `image-size` / `multer` / `body-parser` / `fast-uri`. |
| A.8.9 Gestión de la configuración | Imágenes Docker sin secretos, `.env` fuera de git, cabeceras fijas en Nginx. |
| A.8.12 Prevención de fuga de datos | Logs sin consulta ni `X-Export-Name`; respuestas sin hashes, `ownerId` ni secretos (`FORBIDDEN_KEYS`). |
| A.8.15 / A.8.16 Registro y supervisión | Access log mínimo + `requestId`; errores 5xx tipificados, no el SQL. |
| A.8.24 Criptografía | TLS, HSTS, hashes de tokens, Argon2. |
| A.8.25 / A.8.26 / A.8.28 Desarrollo seguro | CI: typecheck, pruebas, `scan:secrets`, `scan:unsafe`. Validación en cliente y servidor con el mismo Zod. |

## SQL injection

- El acceso a MySQL es Prisma. Los `where` usan objetos, no cadenas interpoladas.
- Las dos consultas `$queryRaw` (`SELECT 1` y `SELECT id FROM users WHERE id = ${ownerId} FOR UPDATE`) son **plantillas etiquetadas**: el valor viaja como parámetro.
- No existe `$queryRawUnsafe` / `$executeRawUnsafe`. CI lo comprueba (`npm run scan:unsafe`).
- Las etiquetas con `' OR 1=1 --` se guardan como texto (pruebas de modelo y de API).

## XSS

- React escapa texto e atributos. No hay `dangerouslySetInnerHTML` ni `eval` en el código de aplicación (`scan:unsafe`).
- CSP del frontend: `script-src 'self' 'wasm-unsafe-eval'` (solo WebAssembly de MediaPipe; no `eval` ni scripts en línea). `object-src`, `frame-src` y `media-src` en `'none'`.
- Campos URL del catálogo: solo `http`/`https` sin credenciales (`isSafeHttpUrl`); bloquea `javascript:`, `data:`, `file:`.
- Imágenes servidas con `X-Content-Type-Options: nosniff` y CSP `default-src 'none'; sandbox`.
- Un payload `<script>` o `<img onerror>` en el nombre se muestra como texto (prueba de `RightPanel`).

## Cómo comprobarlo

```powershell
npm run scan:secrets
npm run scan:unsafe
npm run audit:prod
npm run test:scripts
npm run test -w @a-link/shared
npm run test:web
```
