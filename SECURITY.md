# Seguridad

Si encuentras una vulnerabilidad, **no** abras un issue público ni adjuntes secretos, volcados de base de datos o tokens.

Usa [el aviso privado de GitHub](https://docs.github.com/es/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) en este repositorio (Security → Report a vulnerability).

Incluye: versión o commit, pasos para reproducir, impacto y si hay datos personales involucrados. No envíes contraseñas reales; basta con describir el vector.

## Controles que hay que conservar

- Secretos solo en el entorno (nunca en el código ni en las imágenes).
- Autorización en el servidor: el `ownerId` no lo envía el cliente.
- Tokens de sesión y de compartir: en claro solo en cookie/fragmento; en base de datos, HMAC.
- Enlaces de recuperación y de compartir: token en el **fragmento** `#`, no en la query.
- Respuestas de error sin trazas, sin SQL y sin valores de usuario.
- Prisma parametrizado: no usar `$queryRawUnsafe` ni concatenar SQL.
- Textos de usuario como texto (React + CSP); URLs de metadatos solo `http`/`https`.
- `npm run scan:secrets`, `npm run scan:unsafe` y `npm run audit:prod` en CI y antes de publicar.

El mapeo OWASP Top 10 2025 / ISO 27001 (controles técnicos) está en `docs/11-seguridad.md`.
