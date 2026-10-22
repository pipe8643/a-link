-- Preparación de MySQL (>= 8.0.16; probado con 8.4) para A-Link. Se ejecuta UNA vez como administrador:
--
--   "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe" -u root -p < apps\api\prisma\setup-mysql.sql
--
-- ANTES de ejecutarlo, sustituye CAMBIAR_CONTRASENA por una contraseña larga y aleatoria
-- (la misma que pondrás en tu .env). No subas ese valor al repositorio.

-- Bases de datos (utf8mb4 completo: admite emojis y todos los alfabetos).
CREATE DATABASE IF NOT EXISTS `a_link`        CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS `a_link_test`   CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- Base auxiliar que usa `prisma migrate dev` para comparar migraciones (se vacía sola).
CREATE DATABASE IF NOT EXISTS `a_link_shadow` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Usuario de la aplicación: sin privilegios globales, solo sobre sus bases. Solo accesible desde esta máquina.
CREATE USER IF NOT EXISTS 'alink'@'localhost' IDENTIFIED BY 'CAMBIAR_CONTRASENA';
CREATE USER IF NOT EXISTS 'alink'@'127.0.0.1' IDENTIFIED BY 'CAMBIAR_CONTRASENA';

GRANT ALL PRIVILEGES ON `a_link`.*        TO 'alink'@'localhost';
GRANT ALL PRIVILEGES ON `a_link_test`.*   TO 'alink'@'localhost';
GRANT ALL PRIVILEGES ON `a_link_shadow`.* TO 'alink'@'localhost';
GRANT ALL PRIVILEGES ON `a_link`.*        TO 'alink'@'127.0.0.1';
GRANT ALL PRIVILEGES ON `a_link_test`.*   TO 'alink'@'127.0.0.1';
GRANT ALL PRIVILEGES ON `a_link_shadow`.* TO 'alink'@'127.0.0.1';

FLUSH PRIVILEGES;
