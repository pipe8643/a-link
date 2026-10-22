# Plan de implementación

Estado: `[ ]` pendiente · `[~]` en curso · `[x]` hecho **y verificado** (se indica cómo).
Una funcionalidad con sólo interfaz no cuenta como hecha.

## Prerrequisitos de entorno (Fase 0)

- [x] Node 24.21.0 y npm 11.19.0 disponibles.
- [x] **MySQL 8.4** (decisión del usuario; sustituye a PostgreSQL). Servicio `MySQL84` en marcha.
      Bases `a_link` y `a_link_test`, usuario `alink` y `.env` configurados.
      *Verificado:* migraciones aplicadas y pruebas de integración en verde (ver Fase 2).
- [x] Docker Desktop (instalado en la Fase 8; se usó para verificar el criterio 16).
- [ ] Cuenta de ZoomCharts con prueba de 30 días y clave de licencia en `.env` (decisión del usuario).
- [ ] Repositorio git inicializado (la carpeta aún no lo es).

## Fase 1 — Inspección, verificación de ZoomCharts y arquitectura

- [x] Repositorio inspeccionado: vacío, nada que conservar.
- [x] SDK, licencias, exportación y formas revisados → `01-verificacion-zoomcharts.md`.
- [x] Versiones estables comprobadas → `02-arquitectura.md` §3.
- [x] Arquitectura y plan documentados.

## Fase 2 — Estructura, base de datos, autenticación y aislamiento

- [x] Monorepo npm workspaces, TypeScript estricto, `.env.example`, `.gitignore`.
      *Verificado:* `npm run typecheck` en `shared` y `api`.
- [ ] ESLint/Prettier (pendiente; se añadirá junto con el esqueleto de NestJS).
- [x] `packages/shared`: catálogo de entidades + esquemas Zod.
      *Verificado:* 14 pruebas Vitest en verde, typecheck y build.
- [x] `schema.prisma` completo. *Verificado:* `prisma validate` y `prisma generate` (Prisma 7.10.1).
- [x] Migraciones versionadas para MySQL: `20261019000000_init` (generada con `prisma migrate diff`)
      y `20261019000100_constraints` (CHECKs a mano).
      *Verificado en un MySQL 8.4.9 temporal (ya eliminado):* `prisma migrate deploy` desde cero sin
      errores; `migrate diff` sin deriva; 12 pruebas de integridad (FK compuesta entre grafos, CHECKs,
      Restrict/Cascade, concurrencia por `revision`) y 8 de la URL de conexión, incluyendo login con
      contraseña `caching_sha2_password`. *Aplicadas también en la instancia real del usuario* (`a_link` y `a_link_test`, MySQL 8.4 en
      `localhost:3306`): `migrate deploy` sin errores, sin deriva, y las 12 pruebas de integridad pasan
      contra `a_link_test`.
- [x] NestJS 12: configuración validada con Zod (falla al arrancar sin mostrar valores), `ValidationPipe`
      (whitelist + forbidNonWhitelisted), filtro de errores uniforme, `helmet`, CORS restringido,
      comprobación Origin/Referer (CSRF), throttler en dos niveles, registro de accesos sin query/cabeceras/cuerpo.
      *Verificado:* arranque real de la compilación `tsc` (`npm run build` + `node dist/main.js`),
      petición real a `/api/v1/health`, registro → `/users/me` → logout → 401, cabeceras de seguridad
      comprobadas, y el registro de accesos no contiene correos ni cookies.
- [x] Auth: registro, login/logout, sesiones revocables y listables, cambio y recuperación de
      contraseña (token de un solo uso, solo el último enlace es válido), perfil.
      *Verificado con pruebas de integración contra MySQL real* (`auth.e2e`, 32 pruebas): Argon2id en BD,
      token de sesión solo como HMAC, cookie HttpOnly/SameSite=Lax, mensajes de error idénticos con
      cuenta existente o no, revocación en servidor y replay de cookie robada, reset concurrente (solo 1 de 4
      tiene éxito), CSRF por Origin/Referer, CORS, 413/400 controlados, auditoría sin datos sensibles.
- [x] `AuthGuard` global (deny by default). La capa de acceso a datos con filtro de propietario se
      construye con el primer recurso de dominio (Fase 3: carpetas/grafos).
- [x] Aislamiento A/B de lo existente (`isolation.e2e`, 10 pruebas): sesiones y perfil; 404 idéntico para
      recurso ajeno e inexistente; UUID validado; sin `/users/:id`; `id`/`email`/`ownerId` del cliente rechazados.
      Hardening (`hardening.e2e`, 6 pruebas): bloqueo por intentos con `Retry-After`, throttler, modo producción
      (cookie `__Host-` + Secure, HSTS, sin Swagger, origen http rechazado), `REGISTRATION_ENABLED=false`.
      *Las pruebas se validaron por mutación:* quitar el `userId` del filtro de revocación, abrir el guard y
      hacer reutilizable el token de reset hacen fallar 2, 19 y 1 pruebas respectivamente.
      A/B de carpetas, grafos y panel: hecho en la Fase 3 (`domain-isolation.e2e`). Pendiente: nodos/aristas
      (Fase 5) y exportaciones (Fases 6-7).
- **Limitaciones conocidas de esta fase** (se mantienen en la lista final):
  - El limitador de login es **en memoria**: válido con una sola instancia de API (con varias hay que moverlo a Redis/BD).
  - El registro revela si un correo ya existe (409). Es el compromiso habitual de usabilidad; se mitiga
    con el limitador por IP y puede cerrarse con `REGISTRATION_ENABLED=false`.
  - No hay adaptador SMTP todavía: en producción el correo está `disabled` (no se puede recuperar la contraseña
    hasta configurarlo); en desarrollo el enlace se escribe en `storage/dev-mail`.
  - Swagger no muestra los esquemas de los DTO (sin plugin de OpenAPI).
  - ESLint/Prettier siguen sin configurar.
  - Docker/Nginx no se pueden verificar en esta máquina (sin Docker).
- **Salida:** registro/login/logout funcionando contra MySQL real; tests verdes.

## Fase 3 — Dashboard, carpetas y gestión de grafos

- [x] **Backend** — CRUD de carpetas y de metadatos de grafos: mover, duplicar (copia nodos y aristas con
      IDs nuevos, atómico), papelera (enviar/restaurar/borrado definitivo solo desde la papelera) y política
      explícita de borrado de carpetas (`contents=move_to_parent|trash`; 409 si no está vacía y no se indica).
      Búsqueda, orden, paginación estable y `GET /dashboard` (recuentos, nodos por tipo, recientes).
      Capa de acceso `OwnershipService`: toda consulta por ID filtra por `ownerId` de la sesión; recurso ajeno
      = mismo 404 que uno inexistente. Las operaciones estructurales se serializan por usuario con
      `SELECT … FOR UPDATE` (sin ciclos de carpetas ni saltos de límites por concurrencia).
      Límites: 8 niveles de carpetas, 1000 carpetas y 2000 grafos por usuario.
      *Verificado contra MySQL real:* `folders.e2e` (18), `graphs.e2e` (24), `domain-isolation.e2e` (11):
      132 pruebas en total en el backend; typecheck y `npm run build` limpios; humo con la compilación `tsc`.
      *Validado por mutación (9 cambios deliberados, todos detectados):* quitar el filtro de propietario en
      carpetas, grafos, papelera, restaurar, borrado definitivo, listado y dashboard; desactivar la
      detección de ciclos; quitar el `FOR UPDATE` (la prueba de movimientos simultáneos lo exige).
- [ ] Búsqueda/orden en carpetas (solo existe en grafos) y papelera con purga automática por antigüedad.
- [x] **Frontend** (`apps/web`: React 19 + Vite + Tailwind 4 + componentes estilo shadcn sobre Radix, React Router,
      TanStack Query, React Hook Form + Zod). Login, registro, recuperación y restablecimiento de contraseña;
      layout con navegación lateral (Sheet en móvil), panel con recuentos reales, biblioteca con árbol de
      carpetas, vistas tarjeta/lista, búsqueda con *debounce*, orden y paginación (estado en la URL),
      diálogos (crear/editar/mover/eliminar carpeta con política, grafo), notificaciones con «Deshacer»,
      papelera (restaurar / borrado definitivo con confirmación), ajustes (perfil, contraseña, sesiones,
      tema claro/oscuro). Solo mismo origen (`/api/v1`), sin tokens en JS, sin fuentes ni recursos externos.
      *La ficha del grafo (`/graphs/:id`) muestra los datos reales y, desde la Fase 4, enlaza al editor.*
- [x] **Pruebas del frontend** (todas ejecutadas):
      - Vitest + Testing Library: **68** (cliente HTTP y normalización de errores, `safeRedirectPath`,
        helpers del árbol de carpetas, esquemas Zod, páginas de autenticación, guardas de ruta, caducidad de sesión).
      - Playwright (Edge, contra API + MySQL de **pruebas** reales): **14** pruebas, 28/28 con `--repeat-each=2`.
        Cubren registro/login/logout y retorno a la ruta pedida, cookie HttpOnly sin tokens en el almacenamiento
        web, recuperación de contraseña de un solo uso (token fuera de la URL, sesiones antiguas revocadas),
        carpetas y grafos de extremo a extremo (crear, buscar, editar, duplicar, papelera, deshacer, restaurar,
        borrar), paginación y vista persistentes, **aislamiento A/B desde la interfaz y la red** (404 idéntico
        ante ajeno e inexistente), sesión caducada, móvil 390 px sin desbordamiento, tema oscuro, teclado/foco,
        y **ninguna petición a terceros** durante un recorrido completo.
      - Ejecutar: `npm run test:web` (unitarias) y `npm run test:e2e` (requiere `TEST_DATABASE_URL` y la API
        compilada; **no ejecutar a la vez que los tests de la API**: esos vacían las tablas de la base de pruebas).
      *Fallos reales que encontró el E2E y que ya están corregidos (con test de regresión):*
      1. El correo de recuperación apuntaba a `/restablecer-contrasena`, ruta que la SPA no tiene
         (la recuperación de contraseña **no funcionaba** de punta a punta). Test de regresión en la API.
      2. Al caducar o revocarse la sesión la pantalla seguía mostrando datos privados en lugar de ir al login
         (`queryClient.clear()` desvincula a los observadores activos). Nuevo `setSession()` + test de regresión.
      3. Efecto secundario de (2): `PublicOnly` mandaba siempre a «/» tras el login en vez de a la ruta pedida.
         Corregido y cubierto por test (validado por mutación).
      4. El panel desbordaba horizontalmente en móvil con nombres largos (`grid` sin `grid-cols-1`).
      *Validado por mutación:* permitir `//host` en la redirección post-login, dejar el token en la URL de
      restablecimiento y volver a `PublicOnly → «/»` hacen fallar las pruebas.
- [ ] Búsqueda/orden en carpetas (solo existe en grafos) y papelera con purga automática por antigüedad.
- [ ] Mejoras de frontend conocidas: partición del *bundle* por ruta (~1 MB sin comprimir), ESLint/Prettier,
      auditoría de accesibilidad automatizada (axe) y prueba visual en Safari/Firefox (E2E solo en Edge/Chromium).
- **Decisiones de versión:** `@hookform/resolvers` 5.9.2 (la 6.0.0 provoca ERESOLVE con RHF 7.90) y
  `react-router` 7.18.4 (existe la 8.x; no se adopta hasta revisarla).
- **Notas de diseño:** las carpetas permiten nombres repetidos en el mismo nivel (no hay restricción de
  unicidad); al crear un grafo la aplicación abre su ficha.

## Fase 4 — Editor interactivo y catálogo de entidades

**Estado: implementado y verificado, incluido el lienzo real con licencia Developer (ver «Pendiente de verificar»).**
Ruta: `/graphs/:graphId/editor` (pantalla completa, cabecera propia, carga diferida).

- [x] **Modelo del grafo compartido** (`packages/shared/src/graph-model.ts`): esquemas Zod estrictos de entidad,
      relación e instantánea (límites 5 000/20 000, textos y etiquetas sin caracteres de control,
      metadatos por tipo con claves desconocidas rechazadas, URL solo http/https, auto-relaciones rechazadas,
      integridad de ids y extremos). Es la **misma validación** que usará la API en la Fase 5. 18 pruebas.
- [x] **Estado del editor** (`editor-state.ts`): reductor puro con deshacer/rehacer (100 pasos), invariantes
      (ids únicos, relación solo entre entidades existentes y distintas, borrar entidad borra sus relaciones,
      límites) y contador `version` para el autoguardado. 12 pruebas.
- [x] **Formas**: las 10 formas del catálogo se dibujan con `customShape` (triángulo, hexágono, rombo, cuadrado y
      rectángulo redondeados, escudo bancario, documento, marcador, círculo discontinuo para «Otro») con glifo,
      etiqueta con halo, aro de selección grueso, `hitTest` y `distanceToEdge` exactos (geometría pura probada).
      La paleta y las listas usan el **mismo contorno y glifo** (`ShapeIcon`). Los glifos se generan desde `lucide`
      (`node apps/web/scripts/generate-glyphs.mjs`) para que lienzo y UI no puedan divergir.
- [x] **`NetChartCanvas`** + `toZoomData()`: carga diferida y cancelable (el SDK de 1,6 MB solo se descarga al abrir
      un editor), sincronización **incremental** (solo diferencias), `remove()` al desmontar, `ResizeObserver`,
      selección bidireccional sin bucles ni carreras (solo se acepta selección nacida de un gesto del usuario),
      tema claro/oscuro. **Todas las llamadas al SDK están protegidas**: si el lienzo falla (p. ej. licencia
      rechazada de forma asíncrona) pasa a estado `error` con «Reintentar» y el resto del editor sigue operativo.
- [x] **Paneles**: izquierdo (paleta de 10 tipos, listas de entidades/relaciones, búsqueda y filtro por tipo),
      central (deshacer, rehacer, zoom, ajustar, reorganizar, modo conectar, nueva relación, eliminar) y derecho
      (formulario generado desde el catálogo, resumen de relación, relaciones de la entidad). En móvil los tres
      paneles se alternan con pestañas. Atajos: Ctrl+Z, Ctrl+Y/Ctrl+Shift+Z, Supr, Esc (no actúan al escribir).
- [x] **CRUD con validación por tipo** (`editor-commands.ts`): errores atribuidos al campo concreto, nunca
      incluyen el valor escrito. La naturaleza de una relación es **«Hipótesis» por defecto** y se distingue en el
      trazo (continuo = registrada, discontinuo = hipótesis, punteado = observación), no solo por color.
      Toda operación se puede hacer **sin el lienzo** (listas, formularios y diálogo): alternativa accesible.
- [x] **Pruebas ejecutadas**:
      - Compartidas **32**; web unitarias **131** (de ellas 63 nuevas del editor: geometría y catálogo↔glifos,
        `toZoomData`, comandos/formularios, reductor y **componente del lienzo con un ZoomCharts simulado** que
        reproduce el fallo real: montajes repetidos sin fugas, desmontaje durante la carga, destrucción
        asíncrona del objeto, sincronización incremental, selección y arrastre); API **133** (sin cambios).
      - Playwright **27 pasan** (24 sin licencia + 3 del lienzo real, que exigen `ZOOMCHARTS_LICENSE*`): creación/edición/relación/eliminación/
        deshacer desde los paneles, validación por tipo, atajos, filtros, aviso de cambios sin guardar, móvil 390 px,
        editor ajeno o inexistente → mismo «no encontrado», sin sesión → login, grafo en papelera no editable.
      - *Validado por mutación:* quitar la protección `safe()` de la sincronización del lienzo hace fallar la prueba
        del componente (la prueba E2E equivalente **no** lo detectaba y se complementó con la unitaria).
- **Fallos reales que encontró la verificación y ya están corregidos:**
      1. Sin licencia válida ZoomCharts no lanza excepción: crea el `<canvas>` y luego destruye su objeto interno;
         la siguiente llamada lanzaba `TypeError … requestPaint` y **la pantalla de error de React Router tapaba
         toda la aplicación**. Ahora todo pasa por `safe()` y el lienzo solo se da por listo con `<canvas>` real.
      2. El evento de selección del SDK (a veces asíncrono) podía **borrar la selección de React** al llegar con
         un estado vacío; ahora solo se aceptan cambios durante un gesto del usuario y se reaplica la selección
         cuando el objeto ya existe.
      3. `className` en los datos hacía que el SDK buscara clases de estilo inexistentes (errores en consola).
      4. El SDK no localiza su ruta de assets al estar empaquetado → `assetsUrlBase` explícito a nuestro origen.
      5. Un `<div>` interno del SDK medía 1 px más que la ventana en móvil → contenido con `overflow-hidden`.
      6. Dos campos «Nombre» en «Persona» (nombre del nodo y `fullName`) → el primero es «Nombre en el grafo».
- **Verificado con la licencia Developer real** (en `.env`; Playwright **27 pasan, 0 omitidas**):
      - [x] Render de las 10 formas, relaciones (continuo/discontinuo/punteado, flechas) y aro de selección
            (captura `apps/web/test-results/formas-del-lienzo.png`, la genera la prueba).
      - [x] Red: solo se contacta con `api.zoomcharts-cloud.com` (comprobación de licencia) y **ningún dato del grafo**
            sale del navegador; no hay peticiones a `js.zoomcharts.com`.
      - [x] Montajes y desmontajes repetidos con el SDK real no acumulan lienzos ni listeners.
      - [x] **Hallazgo del SDK 1.21.21:** `paint` y `paintSelection` reciben ancho/2 y alto/2 **intercambiados**
            respecto a su `.d.ts` (medido en navegador; `this.renderHwidth` sí es correcto). Las formas no
            cuadradas («Organización», «Documento», «Ubicación») salían giradas; corregido en `shapes.ts`.
- **Pendiente de verificar con el SDK real:**
      - [x] `hitTest`/coordenadas: clic y arrastre verificados sobre las 10 formas (Fase 5). Pendiente solo el recuadro
            de selección múltiple.
      - [ ] `addData` actualiza nodos existentes (renombrado) y `removeData` de un nodo retira sus relaciones; si
            no, usar `replaceData` o borrar y recrear.
      - [ ] El logo «LICENSED FOR DEV & QA» se dibuja abajo a la derecha aunque `credits.enabled=false`. La licencia
            Developer **no sirve para producción**: hará falta una licencia de producción (Fase 8) y revisar sus
            términos de créditos.
      - [ ] Etiquetas largas se truncan con «…» en el lienzo («Organización o empre…»); el nombre completo sigue
            visible en los paneles. Valorar ajustar el ancho máximo de etiqueta.
- **Fuera de alcance de esta fase (por decisión, anotado):** el guardado llegó en la Fase 5 (ver abajo); el filtro por tipo/búsqueda actúa sobre las listas, no oculta
  nodos en el lienzo; sin multiselección con recuadro verificada; sin navegación por teclado dentro del lienzo
  (la alternativa accesible son las listas y el panel de detalles).

## Fase 5 — Persistencia, autoguardado y concurrencia

**Estado: implementado y verificado de extremo a extremo (API real + MySQL + navegador), salvo lo listado en «Pendiente».**

**Decisión de diseño.** En lugar de un lote de operaciones (`POST /changes`, previsto en `02-arquitectura.md`) se
guarda la **instantánea completa** con `PUT /graphs/:id/content` y el servidor calcula las diferencias. Motivo: el
editor tiene deshacer/rehacer sobre el documento entero, y una instantánea es idempotente y no puede dejar el grafo
a medias si se pierde una operación. Coste: el cuerpo puede llegar a unos MB en un grafo en el máximo; por eso esa
única ruta admite hasta `MAX_GRAPH_CONTENT_MB` (16) y solo con **sesión válida** (no basta el nombre de la cookie); el resto sigue en 2 MB.

- [x] **API** (`graph-content.service.ts`):
      - `GET /graphs/:id/content` → `{ revision, graphDataVersion, nodes, edges }` leído en una transacción
        coherente (`REPEATABLE READ`).
      - `PUT /graphs/:id/content` `{ expectedRevision, nodes, edges }` → `{ revision, nodeCount, edgeCount, changes }`.
      - **Validación con el mismo esquema compartido que el editor** (`parseGraphContentSave`): ids únicos, extremos
        existentes, sin auto-relaciones, metadatos por tipo, límites 5 000/20 000, cualquier campo extra
        (`ownerId`, `graphId`, `revision`…) rechazado. Los errores nombran campo y regla, **nunca el valor**.
      - **Concurrencia optimista**: `UPDATE … WHERE id AND ownerId AND deletedAt IS NULL AND revision = ?` es la
        primera sentencia de la transacción; bloquea la fila hasta el final, así que dos guardados simultáneos no
        pueden mezclarse (6 en paralelo → 1×200 y 5×409). El 409 incluye `details.currentRevision`.
      - **Solo diferencias**: se compara de forma canónica (MySQL reordena las claves de los JSON) y no se tocan
        las filas sin cambios (se comprueba con `updatedAt`). Todo es **atómico**: un fallo a mitad deshace todo.
      - **Aislamiento**: grafo resuelto siempre con el `ownerId` de la sesión; ajeno e inexistente dan el **mismo
        404** (incluso con revisión equivocada, para no filtrar existencia); un id que ya pertenece a otro grafo se
        rechaza con un error genérico (doble barrera: comprobación previa + clave primaria).
      - Papelera → 409 `GRAPH_IN_TRASH`. Origen obligatorio (CSRF). Sin sesión → 401.
- [x] **Cliente**: `useAutosave` — guarda 1,5 s tras la última edición (máximo 10 s aunque se siga editando), nunca dos
      guardados a la vez, encadena lo editado durante un guardado, **reintenta con espera creciente** (3→6→12→30 s) ante
      fallos de red/5xx/429, **no reintenta** errores de validación (muestra el mensaje y «Reintentar») y **se detiene
      ante un 409**. Guarda al volver atrás (desmontaje) y al ocultar la pestaña. Indicador accesible
      (`role=status`: Guardado · Cambios sin guardar · Guardando… · Sin conexión, reintentando… · No se pudo guardar ·
      Conflicto) y `beforeunload` mientras haya algo sin guardar. Se retiró el aviso de «no se guarda».
- [x] **Conflicto entre ventanas**: diálogo con tres salidas — *Cargar la del servidor* (descarta lo local),
      *Sobrescribir con mi versión* (decisión explícita) o *Seguir sin guardar* (no se envía nada hasta resolver).
- [x] **Carga**: el contenido se valida con el esquema compartido antes de abrir el editor (si no es válido se muestra
      un aviso y no se modifica nada); sin refresco automático ni caché del contenido (`gcTime: 0`).
- [x] **Posiciones**: las que el usuario arrastra se guardan (comprobado con el SDK real en las 10 formas).
- [x] **Pruebas ejecutadas**:
      - API **156** (23 nuevas: ida y vuelta, diferencias, canónico, 409, 6 guardados simultáneos, 20 cuerpos inválidos
        sin eco de valores, A/B, ids ajenos, relaciones entre grafos, CSRF, papelera, límites 2/16 MB, grafo máximo
        5 000 + 20 000 guardado, releído y vuelto a guardar sin cambios, duplicado).
      - Web unitarias **148** (17 del autoguardado con tiempo simulado); compartidas **32**.
      - Playwright **36 pasan** (9 nuevas sin licencia: persistir y recargar, no enviar nada sin cambios, guardar al
        salir, caída de red con reintentos, error del servidor + «Reintentar», conflicto → cargar / sobrescribir, y
        aviso de la otra ventana; +1 con licencia: clic y arrastre sobre las 10 formas).
      - *Validado por mutación:* sin comprobar la revisión fallan 3 pruebas de API; sin `ownerId` falla la de
        aislamiento; en el cliente, sin flush al desmontar, sin guardia de concurrencia, sin guardia de conflicto,
        revisión base fija y sin reintento de red fallan sus pruebas; un `hitTest` roto hace fallar la E2E con
        licencia. (Quitar solo la comprobación previa de ids ajenos no cambia el resultado porque la clave primaria
        de MySQL lo rechaza igual: es una doble barrera deliberada.)
- **Pendiente / límites conocidos de esta fase:**
      - [ ] `viewState` (zoom y encuadre) no se guarda; la columna existe pero no se usa.
      - [ ] Las posiciones **automáticas** del diseño no se guardan, solo las arrastradas: al recargar, las entidades
            que nadie movió se recolocan solas. Guardar el diseño asentado exigiría decidir cómo convive con
            deshacer.
      - [ ] Cambio de nombre/borrado sobre el lienzo real (`addData` actualiza, `removeData` arrastra relaciones):
            la ruta de datos está probada con un SDK simulado, no con el real.
      - [ ] «Guardar mi versión como copia» al resolver un conflicto (hoy: cargar o sobrescribir).
      - [ ] Guardado de grafos enormes envía la instantánea entera (hasta 16 MB); si hiciera falta, pasar a lotes de
            operaciones sin cambiar el contrato de revisión.
      - [ ] Guardados no auditados a propósito (ruido; solo se auditan altas, borrados y movimientos del grafo).
      - [ ] Las suites de API y E2E comparten la base de pruebas: **no ejecutarlas a la vez** (una ejecución lanzada
            justo tras la de la API dio 9 fallos por sesiones desaparecidas y no se repitió; dos ejecuciones
            posteriores dieron 36/36).

## Fase 6 — Exportación PNG, JPEG, PDF, PowerPoint

**Estado: implementado y verificado con el SDK real, ficheros abiertos en PowerPoint y Edge; ver «Pendiente».**
Detalle técnico, privacidad, límites y verificación en `docs/09-licencias-y-exportaciones.md`.

- [x] **Spike de exportación completa**: instancia de NetChart fuera de pantalla con el tamaño exacto, entidades fijas,
      `zoom("overview")` y `exportAsString`. Medido con el SDK real: todo el grafo dentro de la imagen (también con
      una elipse de 3200×1400 y con grafos sin posiciones guardadas).
- [x] **PNG y JPEG** configurables (proporción, resolución 1×–3× con tope por lado y por área que baja solo y avisa,
      fondo blanco/oscuro/transparente solo PNG, etiquetas de relaciones).
- [x] **PDF** (`pdf-lib`): título, fecha, imagen sin deformar, leyenda (tipos y naturaleza de las relaciones, en filas),
      pie; tamaño A4/A3/Carta, orientación automática o forzada.
- [x] **PowerPoint con imagen** y **PowerPoint editable** (formas y líneas nativas, trazo por naturaleza del dato,
      flechas, relaciones paralelas separadas, etiquetas, leyenda). Máximo 400 entidades / 1500 relaciones.
- [x] **Diálogo de exportación** accesible (opciones según formato, nombre de archivo saneado, error comprensible,
      «Cancelar» mientras genera) y botón «Exportar…» en el editor.
- [x] **Prueba de red** (E2E, SDK real, los 5 formatos): solo `api.zoomcharts-cloud.com`, sin nombres de grafo ni de
      entidades en URL/cuerpos, nunca `echo.zoomcharts-cloud.com`.
- [x] **Validación de ficheros**: firma PNG/JPEG, `%PDF` y 1 página (lector `pdf-lib`), PPTX descomprimido (formas,
      líneas, texto escapado) y **abierto con Microsoft PowerPoint real**; PDF revisado en Edge.
- [x] `docs/09-licencias-y-exportaciones.md` y `01-verificacion-zoomcharts.md` §3 y §5 actualizados.
- [x] **Pruebas ejecutadas** (todas en verde, ejecutadas por separado): compartidas **32**, web **199** (51 nuevas de
      exportación), API **156**, Playwright **44** (8 nuevas: 3 sin SDK y 5 con licencia). *Mutación:* 7 mutantes
      detectados (2 sobrevivieron al principio por pruebas débiles y se reforzaron).
- **Hallazgos corregidos durante la fase** (los vio la revisión visual, no las pruebas automáticas): relaciones
  opuestas A→B / B→A dibujadas una sobre otra en PowerPoint editable; leyenda de PowerPoint cortada a 6 de 10 tipos;
  etiquetas de relaciones sin rotular el tipo en el editable.
- **Pendiente / límites conocidos de esta fase:**
  - [ ] Licencia de **producción**: hoy todas las imágenes exportadas llevan «LICENSED FOR DEV & QA» (no el PowerPoint
        editable).
  - [ ] PowerPoint editable: líneas no pegadas a las formas y sin icono interior (ver doc 09 §5).
  - [ ] PDF/leyenda con Helvetica estándar: caracteres fuera de WinAnsi salen como «?».
  - [ ] Una sola página/diapositiva; no hay exportación por selección ni por vista parcial.
  - [ ] No se comprobó PowerPoint editable con 400 entidades / 1500 relaciones en una máquina lenta, ni grafos de
        miles de entidades en imagen (sí los límites de píxeles).
  - [ ] La exportación no se audita (no sale nada del navegador; la copia opcional en el almacenamiento privado y su
        auditoría son la Fase 7).
  - [ ] Posiciones automáticas del diseño no persistidas (Fase 5): lo exportado coincide con el lienzo, pero no con
        lo guardado en base de datos.
  - [ ] El SDK escribe en consola «getTextHeight called before CSS loaded» (sin efecto visible comprobado).
## Fase 6b — Exploración del grafo (inspirada en el demo «Panama Papers» de ZoomCharts)

**Estado: implementado y verificado salvo el doble clic real sobre el lienzo (ver «Pendiente»).**
Solo se tomaron ideas de interacción del demo; no se copió código ni datos (todos los datos son sintéticos).
La vista es **solo presentación**: el autoguardado, el historial y las exportaciones «Todo» siguen usando el documento
completo (comprobado por E2E: filtrar y editar no pierde datos al guardar).

- [x] **Modelo de vista** (`view-filter.ts`): ocultar por tipo, por naturaleza del dato y por rango de fechas
      (inclusivo, intervalos abiertos; «incluir relaciones sin fecha»), y **enfoque** (entidad raíz + vecinos, con
      expansión/contracción). La selección siempre queda visible.
- [x] **Panel «Vista y filtros»** (facetas con recuento) y resumen superpuesto «Filtrado|Enfocado: X de Y entidades ·
      A de B relaciones» con «Mostrar todo»; las entidades ocultas aparecen atenuadas en la lista.
- [x] **Panel de detalle**: «Enfocar aquí», «Expandir vecinos (n)», «Contraer vecinos»; relaciones ocultas marcadas.
- [x] **Halos** (auras de ZoomCharts) por tipo o por primera etiqueta, con leyenda.
- [x] **Doble clic** en una entidad (solo con enfoque activo): expande o contrae sus vecinos y avisa con un aviso.
- [x] **Exportación de lo visible**: el diálogo ofrece «Visible / Todo» (por defecto lo visible si hay filtro), nota
      «Vista filtrada: X de Y entidades» en PDF y PowerPoint, y halos opcionales en imagen/PDF/PowerPoint con imagen.
      El **PowerPoint editable no lleva halos**.
- [x] **Hallazgos de ZoomCharts 1.21.21** (cubiertos con pruebas): `auras: { enabled: false }` en la configuración inicial
      desplaza la zona de detección del ratón respecto de lo dibujado → solo se pasa `auras` si hay halos y los cambios
      posteriores van con `updateSettings`; `scrollIntoView` deja los nodos en el borde → «Ajustar a la vista» usa
      `zoom("overview")`.
- [x] **Pruebas** (ejecutadas por separado, en verde): compartidas **32**, web **267**, API **156** (sin cambios de API),
      Playwright **56** pasan + **1** `fixme` (la API no cambió). Nuevas: 9 de vista/halos/enfoque en
      `e2e/exploration.spec.ts` sin licencia y 3 con licencia (el puntero no desplaza el grafo, los halos cambian el
      dibujo, ocultar y mostrar deja el grafo donde estaba).
- **Pendiente / límites conocidos de esta fase:**
  - [ ] **Doble clic real sobre el lienzo sin verificar en E2E** (`test.fixme`): bajo Playwright, ZoomCharts reencuadra
        la vista tras el primer clic sobre una entidad en un grafo de varias entidades y entrega `onDoubleClick` sin
        `clickNode`. La lógica sí está probada con un lienzo falso y desde el panel (E2E). **Hay que comprobarlo a mano
        con un ratón real** (clic sobre una entidad de un grafo con varias entidades: ¿se desplaza la vista?). Se
        desconoce si ocurre fuera de Playwright o si es anterior a esta fase.
  - [ ] El estado de la vista (filtros, enfoque, halos) no se guarda en el servidor; se pierde al recargar.
  - [ ] Pruebas de mutación de `view-filter`, del ámbito de exportación y de `auras` condicional: no ejecutadas.
  - [ ] Las entidades filtradas no se descargan del servidor de forma parcial: el filtrado es en el cliente.

## Fase 7 — Almacenamiento privado de exportaciones

**Estado: implementado y verificado con disco local y con un S3 simulado; NO verificado contra MinIO/S3 reales.**
La copia en la cuenta es **opcional** (casilla desactivada por defecto en el diálogo de exportar): el archivo se
genera y se descarga siempre en el navegador; solo si el usuario lo pide se sube también una copia privada.

- [x] **`StorageService`** (`put/get/delete/exists`) con dos implementaciones: `LocalDiskStorage` (escritura atómica
      tmp+rename, modo 0600) y `S3Storage` (`@aws-sdk/client-s3`, `forcePathStyle` si hay endpoint). Las claves las
      genera el servidor (`exports/<ownerId>/<uuid>`) y se validan con una expresión estricta (sin path traversal).
- [x] **Subida validada**: cuerpo binario crudo en `POST /graphs/:id/exports` (nombre en la cabecera `X-Export-Name`,
      `?folderId` opcional). El formato se detecta por la **firma binaria real** (PNG con IHDR, JPEG, `%PDF-`, PPTX =
      ZIP con `[Content_Types].xml` y `ppt/presentation.xml`) y debe coincidir con el `Content-Type` declarado; límite
      de tamaño (413) y cuotas por usuario (500 archivos y `EXPORT_QUOTA_MB_PER_USER`, 409).
- [x] **Listar / ver / renombrar / eliminar / descargar** (`/graphs/:id/exports`, `/files`, `/files/:id`,
      `/files/:id/content`). Todas las consultas filtran por `{id, ownerId}`: un archivo ajeno y uno inexistente dan
      el mismo 404. La respuesta nunca incluye `ownerId` ni la clave de almacenamiento. La descarga va como
      `attachment` con `nosniff`, `Cache-Control: private, no-store` y CSP restrictiva.
- [x] **Consistencia**: se sube el objeto antes de la fila y, si la fila no se puede crear (grafo en papelera, cuota,
      carpeta ajena), se borra el objeto. Al eliminar un archivo se borra primero el objeto y después la fila. El
      borrado definitivo de un grafo purga sus objetos.
- [x] **Auditoría** `export.*` sin nombres ni contenido.
- [x] **Interfaz**: página «Exportaciones» (buscar, filtrar por formato, paginar, descargar, renombrar, eliminar con
      confirmación), casilla en el diálogo de exportar, contador en el panel. Si la copia falla, la descarga local ya
      se hizo y se avisa con el motivo.
- [x] **Pruebas A/B**: usuario B frente a archivos de A (listar, ver, descargar, renombrar, eliminar, subir a un grafo
      de A) → mismo 404 que ante un UUID inexistente; sin sesión → 401. En API (`exports.e2e.test.ts`, 38 pruebas),
      en almacenamiento (`storage.test.ts`, `file-signature.test.ts`), en web (`exports-page`, `queries`,
      `export-dialog`) y de extremo a extremo (`e2e/exports.spec.ts`: la copia guardada es idéntica byte a byte a la
      descargada).
- [x] **Pruebas** (ejecutadas por separado, en verde): compartidas **32**, web **289**, API **233**, Playwright
      **61** pasan + **1** `fixme` (el doble clic de la Fase 6b). `tsc` limpio en API y web.
- **Pendiente / límites conocidos de esta fase:**
  - [ ] **S3/MinIO real sin probar**: `S3Storage` solo se verificó contra un servidor S3 simulado en memoria.
  - [ ] Sin cifrado en reposo de los archivos (el disco o el bucket deben cifrarse a nivel de infraestructura).
  - [ ] Sin reconciliación de objetos huérfanos si el proceso cae entre `put` y la creación de la fila.
  - [ ] Sin purga programada de la papelera ni endpoint de borrado de cuenta (al borrar una cuenta habría que purgar
        sus objetos).
  - [ ] En E2E solo se cubre PowerPoint editable (sin licencia); PNG/JPEG/PDF se guardan con el mismo flujo pero el
        E2E de esos formatos con lienzo real depende de la licencia.
  - [ ] El proxy (Nginx, Fase 8) no debe registrar cabeceras (`X-Export-Name` lleva el nombre del archivo).

## Fase 8 — Seguridad, E2E y despliegue

**Estado: implementado y verificado en Docker Desktop (Windows), Edge, Firefox y WebKit. Quedan límites conocidos (ver abajo).**

- [x] **Batería de seguridad de la API** (`apps/api/test/security.e2e.test.ts`, 17 pruebas): inventario real de rutas
      (`/api/v1/*`) con lista blanca de públicas y «denegar por defecto» (una ruta nueva sin guardia hace fallar la prueba);
      matriz A/B sobre las 18 rutas con identificador (mismo 404 que ante un UUID inexistente, B intacto, con una guarda
      de completitud); referencias en cuerpo/consulta; fugas por búsqueda; CSRF en **toda** ruta no segura (sin `Origin`,
      ajeno, `null`, parecidos, `Referer`); cabeceras de seguridad también en 401/404/400/403; `X-Request-Id` generado en
      el servidor; claves prohibidas en respuestas (`passwordHash`, `tokenHash`, `ownerId`, claves de almacenamiento…);
      fuzzing hostil (>500 peticiones sin 5xx ni contaminación de prototipos); JSON mal formado, tipos de contenido y
      cuerpos enormes; logs sin secretos (**verificada por mutación**: registrar la URL con su consulta hace fallar la prueba).
- [x] **Contenedores** (`apps/api/Dockerfile`, `apps/web/Dockerfile`, `docker-compose.yml`, `apps/web/nginx/*`): ver
      `10-despliegue.md`. Solo Nginx publica puerto (8443/TLS); `db` y `api` en red interna; usuarios sin privilegios,
      `cap_drop: ALL`, `read_only`, `no-new-privileges`; `migrate` como trabajo previo; la licencia entra en tiempo de ejecución.
- [x] **Cabeceras/CSP/límites en el borde**, verificados contra el stack real (`apps/web/e2e-stack`, 18 pruebas): cabeceras
      sin duplicados, CSP estricta, HSTS, cookie `__Host-`, CSRF a través del proxy, 413 por tamaño, 429 por `limit_req`,
      ficheros ocultos 404, caché de estáticos, sin detalles internos en errores.
- [x] **La aplicación completa bajo la CSP**: lienzo real de ZoomCharts, PNG/JPEG/PDF/PowerPoint (imagen y editable), copia
      guardada y descarga **sin ninguna violación**. Hallazgo corregido: Zod 4 sondea `new Function` → `z.config({ jitless: true })`.
- [x] **Criterio 16 (contenedores y migraciones limpias)**: `docker compose down -v` + `up --build` desde cero: `migrate` aplica
      las 2 migraciones y sale con 0, `api`, `db` y `web` quedan «healthy»; persistencia comprobada tras `restart db api`.
- [x] **Seed de demostración** (`docker compose --profile seed run --rm seed`): idempotente, contraseña solo desde el entorno,
      datos sintéticos (1 carpeta, 1 grafo, 14 entidades, 17 relaciones con las tres clases de evidencia).
- [x] **Criterio 18 (secretos)**: `npm run scan:secrets` (233+ ficheros versionables; reglas de claves conocidas, URLs con
      contraseña, credenciales literales, ficheros `.env`/claves/certificados que no deben versionarse y, sobre todo, los
      **valores reales** de tu `.env`, `.env.docker` y `.env.docker.test` buscados en todo el árbol sin imprimirlos) y
      `npm run scan:secrets:images` (las imágenes `a-link-api|web|migrate:local` no contienen `.env`, claves ni esos valores).
      Sin hallazgos. El rastreo tiene 18 pruebas propias (`scripts/secret-scan.test.mjs`, `npm run test:scripts`).
      Hallazgo corregido: `.gitignore` y `.dockerignore` ignoraban cualquier carpeta llamada `storage/`, **incluido el código
      `apps/api/src/storage`**; ahora solo se ignoran los datos (`/storage/`, `/apps/*/storage/`).
- [x] **Criterios 1–15 de extremo a extremo**: ver «Trazabilidad» más abajo. Se añadió `e2e/journey.spec.ts` (alta → editar →
      guardar → cerrar sesión → volver a entrar → refrescar, criterios 7–8).
- [x] **Criterio 15 (multinavegador)**: la misma batería (62 pruebas + 1 `fixme`) en Edge, Firefox y WebKit
      (`npm run e2e`, `e2e:firefox`, `e2e:webkit`; instalar con `npx playwright install firefox webkit`).
- [x] **Pruebas** (ejecutadas por separado, en verde): compartidas **32**, web **291**, API **250**, scripts **18**;
      Playwright de desarrollo: Edge + Firefox **124** pasan + 2 `fixme` (uno por navegador); WebKit **61** pasan + 1 `fixme`
      y **1 intermitente** (ver abajo); Playwright del stack Docker **18**. `tsc` limpio en API y web.
- **Qué se corrigió gracias al multinavegador** (eran supuestos de Chromium en las pruebas, no fallos del producto):
  la espera inicial del lienzo era una pausa fija (ahora espera a que dos capturas seguidas coincidan); `SameSite` se
  lee de `Set-Cookie` porque la lista de cookies de WebKit lo informa mal (`None`); en Safari/WebKit `Tab` no recorre los
  enlaces (se da el foco al enlace de salto directamente); avisos «Grafo creado» apilados; carreras entre estado «guardado»
  y el manejador de `beforeunload`, y entre el nombre y el guardado en el conflicto de ventanas.
- **Pendiente / límites conocidos (honestos):**
  - [ ] **WebKit de Playwright en Windows no es Safari**: con el lienzo de ZoomCharts cierra o deja en blanco la página de
        forma intermitente (el mismo test, «el lienzo se monta…», falla 1–2 veces y pasa al reintentar). El proyecto `webkit`
        tiene `retries: 2` y se ejecuta con 1 trabajador; un reintento que salva la prueba se informa como «flaky».
        **Hay que comprobar el lienzo en un Safari real (macOS/iOS) a mano.** Además se vio una vez en consola un
        `TypeError` interno de ZoomCharts (`this.chart.events.notifySceneChanges`) al desmontar; sin efecto visible comprobado.
  - [ ] **Doble clic real sobre el lienzo** (`test.fixme`, Fase 6b): sigue sin verificarse; comprobarlo a mano.
  - [ ] Chrome/Edge/Firefox/WebKit de escritorio **solo**: no se probó móvil real ni Safari real; Chromium puro (sin Edge) no se ejecutó.
  - [ ] **No hay endpoint de borrado de cuenta ni purga programada de la papelera**; sin cifrado en reposo; sin
        reconciliación de objetos huérfanos.
  - [ ] **S3/MinIO real sin probar** (ahora que hay Docker se podría probar con MinIO).
  - [ ] **Correo de recuperación de contraseña desactivado en producción** (sin SMTP implementado).
  - [ ] **Licencia de ZoomCharts de producción** pendiente; la actual es de desarrollo/prueba (de 30 días).
  - [ ] Certificado TLS autofirmado por defecto; el real, su renovación y un servidor Linux real están sin probar.
  - [ ] Limitador de inicio de sesión **en memoria** (válido para una sola instancia de la API).
  - [ ] Sin ESLint/Prettier; el estado de la vista (filtros, enfoque, halos) no se guarda en el servidor.
  - [ ] Pruebas de mutación solo en el control de logs; no ejecutadas en `view-filter`, ámbito de exportación ni `auras`.
  - [ ] Límites de PowerPoint editable y PDF (WinAnsi) descritos en `09-licencias-y-exportaciones.md`.

## Fase 9 — Compartir y PowerPoint interactivo

**Estado: implementado.** Las fotos de las entidades (recorte a la forma y detección de rostro en el navegador) ya
estaban; esta fase añade el flujo usable de «gráfico vivo» en PowerPoint. El método de ZoomCharts + Power BI Service
**no aplica** (A-Link no es un visual de Power BI).

- [x] **Compartir** (botón en el editor): enlace de solo lectura 1/7/30 días, URL con el token en el fragmento
      (`/s#token`) mostrada **una sola vez**, lista y revocar. La vista pública no incluye notas ni campos sensibles.
- [x] **PowerPoint interactivo** (`pptx-live`): crea un enlace de 7 días y un `.pptx` con vista previa, hipervínculo e
      instrucciones para el complemento Web Viewer. El archivo no ejecuta ZoomCharts.
- [x] **CSP:** solo `/s` admite `frame-ancestors *` (sin `X-Frame-Options`); el resto sigue `none` + `DENY`.
- [x] CORS admite `X-Share-Token` (preflight si el visor se sirve en otro origen; en el mismo origen no hace falta).
- **Límites:** hace falta HTTPS alcanzable y un certificado de confianza (el autofirmado de localhost suele fallar en
  Office). Si se revoca el enlace, la diapositiva incrustada deja de cargar. No hay gráfico ZoomCharts embebido en el XML
  de PowerPoint.

## Trazabilidad de criterios de aceptación

Verificación final (Fase 8). «E2E» = Playwright en Edge, Firefox y WebKit (`apps/web/e2e`) salvo que se indique otra cosa.

| # | Criterio | Fase | Verificación (dónde) | Estado |
|---|---|---|---|---|
| 1 | Registro e inicio de sesión | 2 | `auth.spec.ts` (alta, login, credenciales erróneas, recuperación), API `auth.e2e.test.ts` | Verificado |
| 2–3 | Crear carpeta y grafo | 3 | `library.spec.ts` (carpetas, grafos, papelera), API `folders`/`graphs` | Verificado |
| 4–5 | Crear entidades y su representación | 4 | `editor.spec.ts` (paneles; lienzo: 10 formas, selección, arrastre), unitarias | Verificado (lienzo con licencia de prueba) |
| 6 | Conectar y editar relación | 4 | `editor.spec.ts` («crear, editar, relacionar, deshacer y eliminar»), API | Verificado |
| 7–8 | Guardar, cerrar sesión, recuperar, refrescar | 5 | `journey.spec.ts`, `editor.spec.ts` (autoguardado, recarga, conflicto), `auth.spec.ts`; stack: persistencia tras reinicio | Verificado |
| 9–11 | Exportar PNG, PDF, PPTX válidos | 6 | `export.spec.ts` (firma y estructura de los ficheros), stack `02-app-under-csp` bajo CSP | Verificado |
| 12 | Guardar y descargar exportaciones | 7 | `exports.spec.ts` (copia idéntica byte a byte), API `exports.e2e.test.ts` | Verificado |
| 13 | Aislamiento entre usuarios | 2–8 | API `security.e2e.test.ts` (matriz A/B de todas las rutas), `*.e2e.test.ts` por recurso, E2E `library`/`exports`/`editor` (vista de B) | Verificado |
| 14 | Errores de red/guardado notificados | 5 | `editor.spec.ts` («sin conexión: avisa, reintenta y guarda», «un error del servidor se muestra…», conflicto) | Verificado |
| 15 | Navegadores de escritorio | 8 | Misma batería en Edge, Firefox y WebKit | Verificado con **reserva**: el lienzo en el WebKit de Playwright/Windows es intermitente; falta Safari real |
| 16 | Contenedores y migraciones limpias | 8 | `down -v` + `up --build`, `migrate` sale con 0; `apps/web/e2e-stack` (18) | Verificado en Docker Desktop (Windows) |
| 17 | Pruebas automatizadas pasan | todas | shared 32, web 291, API 250, scripts 18, E2E dev (124 + 61), stack 18 | Verificado (el único intermitente está descrito arriba) |
| 18 | Sin secretos en el repositorio | 8 | `npm run scan:secrets` y `scan:secrets:images` (+18 pruebas del rastreo) | Verificado |