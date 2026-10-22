# Licencias y exportaciones

Este documento recoge **qué se exporta, cómo, qué sale del navegador (nada con datos del grafo) y qué condiciona la
licencia de ZoomCharts**. Complementa `01-verificacion-zoomcharts.md` (§3 y §5).

## 1. Qué se puede exportar

Botón **Exportar…** de la barra del editor (deshabilitado con el grafo vacío). Por defecto se exporta **el grafo
completo**, con la disposición que muestra el lienzo en ese momento. Desde la Fase 6b, si hay filtros o enfoque activos,
el diálogo ofrece «Qué exportar»: **lo visible** (opción por defecto, con la nota «Vista filtrada: X de Y entidades» en
PDF y PowerPoint) o **todo**. Los **halos** son opcionales en imagen, PDF y PowerPoint con imagen; el **PowerPoint
editable no lleva halos**. Todo sigue generándose en el navegador.

| Formato | Contenido | Opciones |
|---|---|---|
| PNG | Imagen | proporción (ajustada al grafo, 16:9, 4:3, 1:1, A4 apaisado/vertical), resolución 1×/2×/3×, fondo blanco / oscuro / **transparente (solo PNG)**, etiquetas de relaciones |
| JPEG | Imagen | igual que PNG, sin transparencia |
| PDF | 1 página: título, fecha, imagen, leyenda y pie «Generado con A-Link» | tamaño (A4, A3, Carta), orientación (automática según el grafo, horizontal, vertical), resolución, fondo, título/fecha/leyenda, etiquetas |
| PowerPoint con imagen | 1 diapositiva 16:9 con la imagen del grafo | resolución, fondo, título/fecha/leyenda, etiquetas. **La imagen no es editable nodo a nodo.** |
| PowerPoint editable | 1 diapositiva con **formas y líneas nativas** (una forma por entidad con su color y nombre; una línea por relación con su trazo y flechas) | título/fecha/leyenda, etiquetas |
| PowerPoint interactivo | 2 diapositivas: vista previa + hipervínculo a `/s#token` e instrucciones para el complemento **Web Viewer** | crea un enlace de solo lectura de 7 días. **No contiene ZoomCharts ejecutable.** |

Nombre de archivo: se propone el del grafo y siempre se sanea (sin separadores de ruta, caracteres de control ni
nombres reservados de Windows, máximo 80 caracteres; nunca queda vacío).

### Límites (por decisión, con aviso al usuario)

- **Imagen:** lado máximo 8192 px y 40 Mpx. Si la resolución pedida los supera se **baja sola** y se avisa
  («Se redujo la resolución a …»).
- **PowerPoint editable:** máximo 400 entidades y 1500 relaciones (más formas harían inmanejable la diapositiva); por
  encima, el botón se desactiva y se propone PowerPoint con imagen o PDF.
- **PowerPoint interactivo:** el `.pptx` no dibuja ZoomCharts por sí solo. Hay que incrustar el visor `/s` con Web Viewer
  (Insertar → Complementos). Hace falta que A-Link sea alcanzable por HTTPS con un certificado de confianza: el
  autofirmado de `localhost` suele fallar en Office. Si se revoca o caduca el enlace, la diapositiva deja de cargar.
  El token va en el fragmento de la URL (y por tanto en el fichero); no se puede volver a consultar en la API.

## 2. Cómo se genera (todo en el navegador)

```
editor (documento + posiciones del lienzo)
   │  resolvePositions: lienzo > documento > cuadrícula determinista
   ▼
runExport ──► PNG/JPEG : instancia de NetChart FUERA DE PANTALLA, tamaño exacto, entidades fijas,
   │                      zoom("overview"), exportAsString (nunca export), proxy anulado
   ├──────► PDF        : imagen anterior + pdf-lib (Helvetica estándar), se calcula el hueco ANTES de pintar
   ├──────► PPTX imagen: imagen anterior + PptxGenJS
   ├──────► PPTX editable: sin SDK; formas/líneas de PptxGenJS a partir de las posiciones
   └──────► PPTX interactivo: crea un enlace de solo lectura (API) + vista previa + URL e instrucciones
            El visor vivo es `/s#token` (solo lectura). No es el flujo de ZoomCharts + Power BI.
                          │
                          ▼
                   Blob + URL de objeto → descarga local
```

- La instancia auxiliar **no toca el lienzo del usuario** (zoom, selección y posiciones no cambian) y se destruye
  siempre (también al fallar o cancelar). Cancelar mientras se genera aborta la operación y no descarga nada.
- El tema de las etiquetas (texto claro u oscuro) se aplica a la exportación y se **restaura** después.
- Si el lienzo no ha dado posiciones a alguna entidad se usa una cuadrícula determinista (por tipo y nombre): así
  **PowerPoint editable funciona incluso sin licencia ni lienzo**.
- Las librerías de PDF y PowerPoint se cargan **bajo demanda** (no pesan en la carga inicial del editor).
- El PowerPoint con imagen y el PDF reservan el hueco de la imagen antes de generarla, de modo que la imagen sale con
  la proporción exacta y **no se deforma**.

## 3. Privacidad de la exportación

- Ninguna ruta usa `export()` del SDK (descarga con proxy). Se usa `exportAsString()` y la descarga es local.
- `advanced.exportProxyURL = "about:blank"` en el lienzo de edición y en el auxiliar: aunque algún camino llegase al
  proxy, no habría destino. **No se contacta con `echo.zoomcharts-cloud.com`.**
- **Prueba E2E con SDK real** (`e2e/export.spec.ts`): durante PNG, JPEG, PDF, PowerPoint con imagen y PowerPoint
  editable de un grafo con un nombre de entidad y de grafo «secretos», las únicas peticiones fuera del propio origen
  son al servicio de licencias (`api.zoomcharts-cloud.com`); ninguna lleva en URL o cuerpo el nombre del grafo ni de
  las entidades; ninguna va al proxy de exportación.
- Metadatos de los ficheros: el PDF lleva «A-Link» como productor y creador **sin autor**; el PowerPoint, «A-Link»
  como autor y empresa. **No se incluye usuario, correo ni nombre del propietario.** El título es el nombre del grafo (el usuario puede quitarlo de la página, no de los
  metadatos).
- Por defecto los ficheros **no se guardan en el servidor**. Desde la Fase 7 el diálogo ofrece, desactivada por
  defecto, la casilla «Guardar una copia en mi cuenta (Exportaciones)»: solo entonces el navegador sube el mismo
  fichero ya generado a **tu** almacenamiento privado (`POST /graphs/:id/exports`, mismo origen, con la cookie de
  sesión). El servidor valida la firma binaria y el tamaño, aplica cuotas y solo permite al propietario verlo,
  descargarlo, renombrarlo o eliminarlo (página «Exportaciones»). El nombre del archivo viaja en una cabecera, no en
  la URL, y la auditoría no guarda nombres. Si la copia falla, la descarga local ya se hizo. Sigue sin enviarse nada a
  terceros. Límites: sin cifrado en reposo propio (cifrar el disco/bucket), y el adaptador S3 no se ha probado con un
  S3/MinIO real.

## 4. Licencia de ZoomCharts: lo que condiciona

- La licencia de **desarrollo** (la actual) dibuja el logotipo rojo «**LICENSED FOR DEV & QA**» en la esquina inferior
  derecha **del lienzo y de todas las imágenes exportadas** (PNG, JPEG, PDF y PowerPoint con imagen). No aparece en
  PowerPoint editable (no usa el SDK). Hace falta una licencia de producción para exportar sin él; **la validación
  de las pruebas ignora esa esquina** (`e2e/export.spec.ts`).
- Observación en este entorno: con el servicio de licencias bloqueado en la red, la exportación con la licencia de
  desarrollo **siguió funcionando**. No se asume que lo mismo ocurra con otra licencia: si el SDK no crea el lienzo,
  la exportación falla en ≤ 8 s con un mensaje claro y deja limpia la página (cubierto con pruebas unitarias).
- Los proyectos gubernamentales requieren plan de pago (ver `01-verificacion-zoomcharts.md` §5). La decisión de
  licenciamiento es del titular del proyecto.
- La clave no está en el repositorio: llega por `/config.js` (runtime) y por `.env` local en desarrollo.
- Para producción: CSP con `connect-src 'self' https://api.zoomcharts-cloud.com` (única conexión externa del SDK
  observada). **Verificado en la Fase 8** (Nginx del stack Docker): el lienzo real y las cuatro exportaciones (PNG, JPEG, PDF,
  PowerPoint con imagen y editable) funcionan bajo `script-src 'self'` y `worker-src 'self' blob:` sin ninguna violación.
  Hallazgo: Zod 4 sondea `new Function` y eso provoca una violación `script-src eval`; se evita con `z.config({ jitless: true })`,
  importado el primero en `main.tsx` (`apps/web/src/lib/zod-config.ts`, con prueba). La licencia se inyecta al arrancar el
  contenedor (`config.js` en `tmpfs`); no está en el bundle ni en las imágenes (`npm run scan:secrets:images`).

## 5. Limitaciones conocidas

1. **PowerPoint editable:** las líneas **no están pegadas** a las formas (PptxGenJS no crea conectores): al mover una
   forma en PowerPoint, su línea no la sigue. Las formas son geométricas (círculo, cuadrado, triángulo, hexágono,
   rombo, rectángulo redondeado, casa, hoja, gota, círculo discontinuo): **no llevan el icono interior** que sí se ve
   en el lienzo. La leyenda identifica cada tipo por su color.
2. **PDF y leyenda:** se usa Helvetica estándar (codificación WinAnsi): cubre el español, pero los caracteres que no
   puede representar (emojis, alfabetos no latinos) en el **título o la leyenda** salen como «?». La imagen del grafo
   no tiene esa limitación (la dibuja el lienzo).
3. **Etiquetas de relaciones:** el lienzo en pantalla las oculta al alejar el zoom; en la exportación se dibujan (con
   zoom de encuadre mayor). En grafos densos pueden tapar nombres: la casilla «Etiquetas de las relaciones» las
   quita.
4. Los tamaños de forma y de etiqueta dependen del zoom de encuadre del SDK: una forma ancha (p. ej. organización)
   puede verse algo mayor en la exportación que en pantalla. No es un error de datos.
5. La posición exportada es la que muestra el lienzo; las posiciones automáticas del diseño siguen sin guardarse en
   la base de datos (pendiente de la Fase 5).
6. Una sola diapositiva/página: grafos enormes se exportan enteros en una imagen y pueden resultar ilegibles al
   imprimir; la resolución 3× y A3 ayudan.

## 6. Verificación realizada

- Unitarias (51 en `features/export`): nombre seguro, esquema estricto de opciones, normalización de fondo, límites de
  tamaño (por lado **y por área**), posiciones y cuadrícula determinista, leyenda, **PDF válido** abierto con
  `pdf-lib` (página, metadatos, sin autor, «?» en caracteres no representables), **PPTX válido** descomprimido con
  JSZip (formas por entidad, líneas, texto escapado, relaciones opuestas separadas, etiquetas), orquestación del
  lienzo auxiliar con SDK simulado (proxy, tamaño, transparencia, limpieza, cancelación, errores) y diálogo.
- E2E con SDK real (8 pruebas): PNG de tamaño exacto con **todo el grafo dentro** y aprovechando el espacio (se
  analizan los píxeles en el navegador, sin el logotipo de licencia), PNG transparente (esquina con alfa 0) y fondo
  oscuro, JPEG/PDF/PowerPoint imagen válidos (firma, página única, imagen incrustada), grafo sin posiciones guardadas,
  PowerPoint editable sin SDK, y la prueba de red del §3.
- **Comprobación manual con aplicaciones reales:** el `.pptx` editable y el de imagen se abrieron con **Microsoft
  PowerPoint** (1 diapositiva, 16:9) y se exportó la diapositiva a imagen para revisarla; el PDF se revisó en Edge.
  Esto destapó dos fallos que ninguna prueba automática vio (relaciones opuestas solapadas y leyenda cortada a 6 de 10
  tipos), ya corregidos y cubiertos con prueba.
- Validado por mutación (7 mutantes): sin proxy anulado, sin quitar etiquetas, sin normalizar transparencia, sin
  sustituir caracteres del PDF, sin rechazar grafo vacío, sin separar paralelas y sin límite de área hacen fallar
  pruebas (dos mutantes sobrevivieron al principio por pruebas débiles y se corrigieron).
- Advertencia observada en consola: «getTextHeight called before CSS loaded» (SDK, al no cargar su CSS por
  `assets: []`). Sin efecto visible en las exportaciones revisadas.
