# Despliegue con Docker

Estado: **verificado en Docker Desktop (Windows)** desde una instalación limpia (volúmenes nuevos): migraciones,
servicios, TLS, cabeceras, CSP, licencia en tiempo de ejecución, persistencia tras reinicio y seed. Lo que NO está
verificado se lista en «Límites» al final.

## 1. Piezas

| Servicio | Imagen | Función | Puertos |
|---|---|---|---|
| `db` | `mysql:8.4` | Base de datos (volumen `db-data`) | ninguno publicado |
| `migrate` | `apps/api/Dockerfile` (stage `migrate`) | Trabajo de un solo uso: `prisma migrate deploy`; `api` espera a que termine bien | — |
| `api` | `apps/api/Dockerfile` (stage `api`) | NestJS en Node, usuario no root, sistema de ficheros de solo lectura | ninguno publicado |
| `web` | `apps/web/Dockerfile` | Nginx sin privilegios: estáticos + proxy `/api/` → `api`, TLS | **8443** (único publicado) |
| `seed` | la imagen de `api` | Datos de demostración (perfil `seed`, opcional) | — |

Redes: `edge` (la del puerto publicado) e `internal` (`internal: true`, sin salida a Internet) donde viven `db`, `migrate`
y `api`. `db` y `api` no son alcanzables desde el anfitrión: la única entrada es Nginx.

Endurecimiento: `no-new-privileges`, `cap_drop: ALL` (la base de datos añade solo lo mínimo), `read_only` + `tmpfs` en
`api` y `web`, contraseñas solo por variables de entorno, `.dockerignore` que excluye `.env*`, claves, `node_modules` y
datos locales.

## 2. Primera puesta en marcha

```powershell
Copy-Item .env.docker.example .env.docker      # edita: contraseñas, SESSION_SECRET, PUBLIC_ORIGIN y, si la tienes, la licencia
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps         # db y api «healthy»; migrate «exited (0)»
```

Abre `https://localhost:8443`. Sin certificado propio, Nginx genera al arrancar uno **autofirmado** (válido 30 días,
solo para pruebas): el navegador pedirá confiar en él. Para un certificado real, descomenta en `docker-compose.yml`
el volumen `./certs:/etc/nginx/certs:ro` y coloca `tls.crt` y `tls.key` en `./certs/` (carpeta y certificados ignorados por git; nunca se versionan).

Genera cada secreto con `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
`.env.docker` **nunca** se versiona (`.gitignore`) ni entra en la imagen (`.dockerignore`).

### Por qué solo HTTPS
En producción la API exige orígenes `https` y emite la cookie de sesión con el prefijo `__Host-` (requiere `Secure`).
Por eso no hay puerto HTTP. HSTS (`max-age=31536000; includeSubDomains`) se envía en todas las respuestas del
frontend: **no uses `localhost` con otro servicio HTTP en el mismo navegador** después de abrir esto, porque el navegador
recordará HSTS para `localhost`.

### Licencia de ZoomCharts
`ZOOMCHARTS_LICENSE` y `ZOOMCHARTS_LICENSE_KEY` se leen al arrancar el contenedor `web`, que escribe `config.js` en un
`tmpfs` (`/tmp/alink`). **No se compilan en el bundle ni quedan en la imagen** (comprobado con `npm run scan:secrets:images`).
El script de arranque rechaza valores con caracteres no imprimibles, comillas dobles o barras invertidas.

## 3. Datos de demostración

```powershell
# en .env.docker: DEMO_USER_PASSWORD (≥ 12 caracteres, sin la parte local del correo) y, si quieres, DEMO_USER_EMAIL
docker compose --env-file .env.docker --profile seed run --rm seed
```

Crea (o reutiliza) el usuario de demostración con una carpeta y un grafo sintético (14 entidades, 17 relaciones con
las tres clases de evidencia). Es **idempotente**, funciona aunque `REGISTRATION_ENABLED=false` y la contraseña solo se
toma del entorno (nunca está en el repositorio). Todos los datos son inventados.

## 4. Nginx: lo que impone el borde

- **Cabeceras y CSP** solo en las respuestas del frontend (la API pone las suyas con `helmet`: no hay duplicados):
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:;
  connect-src 'self' https://api.zoomcharts-cloud.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self';
  form-action 'self'; frame-ancestors 'none'` en toda la aplicación **excepto** `/s` (visor de un grafo compartido), que
  usa `frame-ancestors *` y **no** envía `X-Frame-Options`, para poder incrustarlo en PowerPoint (complemento Web Viewer).
  Quien tiene el token ya podía abrir `/s` en una pestaña. Login, editor y API siguen sin poder incrustarse. La única
  conexión a terceros es la comprobación de licencia de ZoomCharts.
- **Límites de cuerpo**: autenticación 64 KB, `/api/` 2 MB, contenido de grafos y exportaciones 100 MB (la API aplica
  después sus propios límites configurables).
- **`limit_req`** por IP en autenticación y en la API general (responde 429 antes de llegar a la API).
- `X-Forwarded-For` se **sobrescribe** con la IP real del cliente (no se acepta el que envía el cliente).
- **Registro de acceso sin cadena de consulta ni cabeceras** (`X-Export-Name` lleva nombres de archivo).
- Ficheros ocultos (`/.env`, `/.git`…) → 404; `/assets/` con caché inmutable; el resto con `no-cache`.

## 5. Verificación realizada

| Comprobación | Cómo |
|---|---|
| Migraciones desde cero | `docker compose down -v` + `up`: `migrate` termina con código 0 y `api` arranca |
| Solo Nginx publicado | prueba E2E del stack (`docker port` de `db`/`api` vacío; `web` solo 8443) |
| Cabeceras/CSP/HSTS/cookies/CSRF/límites en el borde | `apps/web/e2e-stack/01-edge-security.spec.ts` |
| La aplicación completa bajo la CSP (lienzo real, 4 formatos de exportación, copia guardada) sin violaciones | `02-app-under-csp.spec.ts` |
| Los datos y los archivos sobreviven a `docker compose restart db api` | `02-app-under-csp.spec.ts` |
| Seed idempotente y aislado por usuario | `03-seed-demo.spec.ts` |
| Limitación de ritmo en Nginx | `99-nginx-rate-limit.spec.ts` |
| Sin secretos en el repositorio ni en las imágenes | `npm run scan:secrets` y `npm run scan:secrets:images` |

Para repetir las pruebas del stack se levanta con límites relajados (`.env.docker.test`, **no versionado**; solo para esto):

```powershell
docker compose --env-file .env.docker --env-file .env.docker.test up -d --build
npm run e2e:stack -w @a-link/web
```

## 6. Publicar el código (GitHub)

El repositorio es privado por defecto. **Nunca** subas `.env`, `.env.docker`, certificados ni `storage/`. El CI ejecuta
`npm run scan:secrets`, typecheck y las pruebas unitarias del frontend. Activa **Secret scanning** y **Push protection**
en el repositorio (Settings → Code security) para que GitHub rechace un push con claves o tokens conocidos.

Los enlaces de recuperación de contraseña usan el fragmento (`/reset-password#token`), igual que los de solo lectura
(`/s#token`): el servidor de correo y los registros de acceso no reciben el secreto.

## 7. Operación

- **Copias de seguridad:** volúmenes `a-link_db-data` (MySQL) y `a-link_api-storage` (exportaciones guardadas). Sin cifrado en
  reposo: cifra el disco o usa un bucket cifrado.
- **Actualizar:** `git pull` + `docker compose --env-file .env.docker up -d --build`; `migrate` aplica las migraciones nuevas.
- **Parar sin perder datos:** `docker compose down`. **`down -v` borra los volúmenes** (base de datos y archivos).
- **Varias instancias de la API:** el limitador de intentos de inicio de sesión vive en memoria de cada proceso; con más de
  una réplica habría que moverlo a un almacén compartido.

## 8. Límites

- El certificado por defecto es autofirmado; para producción hay que montar uno real y gestionar su renovación.
- Verificado solo con Docker Desktop en Windows (contenedores Linux); no se ha probado en un servidor Linux ni con un orquestador.
- S3/MinIO real sin probar (el adaptador solo se verificó contra un S3 simulado).
- El correo de recuperación de contraseña está **desactivado** en producción (`MAIL_DRIVER` deshabilitado): sin SMTP configurado
  no se envían enlaces. Falta implementar y probar el envío real.
- No hay endpoint de borrado de cuenta ni purga programada de la papelera.
- La licencia de ZoomCharts usada en las pruebas es de desarrollo; una instalación real necesita la licencia de producción.
