# A-Link

Plataforma web para grafos de relaciones (ZoomCharts Net Chart): editor, biblioteca, exportaciones y enlaces de solo lectura.

## Antes de clonar o publicar

Este repositorio **no debe contener secretos**. Quedan fuera de git (`.gitignore`) y de las imágenes Docker (`.dockerignore`):

- `.env`, `.env.docker`, `.env.docker.test` y cualquier `.env.*` que no sea `*.example`
- certificados (`certs/`, `*.pem`, `*.key`, `*.crt`, `*.p12`…)
- `storage/`, informes de pruebas, `node_modules/`, `dist/`

Copia las plantillas y genera valores **aleatorios** en tu máquina:

```powershell
Copy-Item .env.example .env
Copy-Item .env.docker.example .env.docker
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Nunca pegues contraseñas, `SESSION_SECRET`, URLs de base de datos ni licencias de ZoomCharts en issues, commits ni documentación.

Antes de un commit: `npm run scan:secrets`, `npm run scan:unsafe` y `npm run audit:prod`.

## Arranque local (Docker)

Ver `docs/10-despliegue.md`. Resumen:

```powershell
docker compose --env-file .env.docker up -d --build
```

La aplicación queda en `https://localhost:8443` (certificado autofirmado de pruebas).

## Arranque local (Node)

Requisitos: Node ≥ 22.12, MySQL 8.4. Crea las bases con `apps/api/prisma/setup-mysql.sql`, rellena `.env` y:

```powershell
npm ci
npm run prisma:generate -w @a-link/api
npm run build
```

## Documentación

| Documento | Contenido |
|---|---|
| `docs/02-arquitectura.md` | Componentes, API, privacidad |
| `docs/03-plan-implementacion.md` | Fases y criterios de aceptación |
| `docs/09-licencias-y-exportaciones.md` | ZoomCharts y formatos de exportación |
| `docs/10-despliegue.md` | Docker, TLS, cabeceras, operación |
| `docs/11-seguridad.md` | OWASP Top 10 2025, ISO 27001 (técnico), SQLi y XSS |
| `SECURITY.md` | Cómo reportar un problema de seguridad |
