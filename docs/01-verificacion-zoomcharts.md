# Verificación de ZoomCharts Net Chart (Fase 1)

Fecha de verificación: 2026-10-19. Fuente: paquete npm `@dvsl/zoomcharts@1.21.21` descargado y
revisado (`zoomcharts.d.ts`, `license.txt`, ejemplos), `@dvsl/react-zoomcharts@1.0.7` (código fuente
de `dist/index.js`) y las páginas oficiales enumeradas al final.

Convención: **[V]** = verificado en tipos/código/documentación. **[P]** = pendiente de verificación
empírica (se comprueba en una fase concreta con una prueba automatizada o un spike visual). Nada
marcado **[P]** se debe asumir como cierto.

## 1. Versiones y paquetes

| Elemento | Resultado | Estado |
|---|---|---|
| `@dvsl/zoomcharts` | `1.21.21` es `latest` y coincide con la documentación oficial ("Version: 1.21.21 (2026-10-01)"). La versión 2.0 está marcada como BETA en la documentación y se descarta. | [V] |
| `@dvsl/react-zoomcharts` | `1.0.7`, depende de `@dvsl/zoomcharts@^1.21.7`, `peerDependencies: react >=16.3.0`. | [V] |
| Licencia npm | `SEE LICENSE IN <license.txt>` (propietaria, no OSS). | [V] |
| Distribución | CDN, ZIP descargable y npm. En producción se autoalojan los ficheros (no CDN) para fijar versión y no depender de terceros. | [V] |

### Decisión: no usar `@dvsl/react-zoomcharts`

Se leyó el código de `dist/index.js` del wrapper. Motivos para encapsular `@dvsl/zoomcharts` en un
componente propio:

1. Muta el objeto recibido: `delete settings.container` sobre el `settings` del llamador.
2. Parchea con monkey-patch una función interna global del SDK
   (`ZoomCharts.Internal.Base.Graphics.setDummyFont`).
3. Importa siempre Leaflet y `moment-timezone` aunque solo se use NetChart (peso innecesario).
4. Ejecuta `updateSettings(settings)` en cada render en que cambie la identidad del objeto, lo que
   obliga a memoizar todo y puede provocar actualizaciones redundantes.
5. Asigna la instancia al `ref` dentro de un `useEffect`, sin callback de "listo"; el efecto de
   `type` usa `setTimeout` (condición de carrera potencial).

El componente propio (`NetChartCanvas`) crea una única instancia en `useEffect`, la destruye con
`chart.remove()` en el cleanup, registra eventos una sola vez y separa los datos del grafo del estado de
presentación. **[V]** `BaseApi.remove()` (línea 139 del `.d.ts`) está documentado así: "should
always be called when the chart HTML element is removed as otherwise there might be additional
resources such as event handlers remaining". **[P]** la ausencia de fugas se demostrará con una
prueba de montaje/desmontaje repetido en Fase 4.

## 2. Formas de nodo (NetChart)

`ItemsChartSettingsNodeStyle.display` (línea 2881 del `.d.ts`) documenta como valores válidos:
`circle` (por defecto), `text`, `rectText`, `verticalRectText`, `roundtext`, `droplet`, `rectangle`,
`rhombus`, `diamond`, `customShape`. También existen `aspectRatio` (solo `rectangle`),
`borderRadius` (solo `rectText`/`verticalRectText`), `image`, `imageCropping`, `items` (iconos y
elementos sobre el nodo) y `customShape` con `distanceToEdge`, `hitTest` y `onUpdate`. [V]

Los `shape: "triangle" | "circle" | "square" | "rhombus" | "triangle2"` que aparecen en el `.d.ts`
pertenecen a otros gráficos (leyendas/series), **no** a los nodos de NetChart.

| Tipo de entidad | Forma pedida | Mecanismo propuesto | Estado |
|---|---|---|---|
| Persona | círculo | `display: "circle"` (nativo) | [V] |
| Bien inmueble | cuadrado | `display: "rectangle"` con `aspectRatio: 1` | [P] confirmar render y radio |
| Vehículo | triángulo | `display: "customShape"` (no hay triángulo nativo para nodos) | [P] spike Fase 4 |
| Teléfono | hexágono | `display: "customShape"` (no hay hexágono nativo para nodos) | [P] spike Fase 4 |
| Red social | rombo | `display: "rhombus"` o `"diamond"` (la diferencia entre ambos no está documentada) | [P] elegir tras ver el render |
| Organización | rectángulo redondeado | `display: "rectText"` + `borderRadius` | [P] |
| Cuenta bancaria, Documento, Ubicación | icono o forma diferenciada | `image` (SVG como data-URI) dentro de una forma nativa, o `items` | [P] |
| Otro | configurable | forma/color tomados de la configuración del tipo | [P] |

Regla: si el spike demuestra que `customShape` no mantiene selección, `hitTest` o rendimiento
aceptables, se usará la alternativa documentada (forma nativa más próxima + icono SVG) y se
anotará en este documento. No se afirmará que existe una opción nativa que no esté documentada.

La forma nunca es el único indicador: cada tipo añade color, etiqueta e icono, y la leyenda es un
componente React propio (reutilizable en PDF/PPTX). No se ha verificado que NetChart ofrezca una
leyenda de tipos de nodo; no se asume.

## 3. Exportación

`BaseApi.export()` y `BaseApi.exportAsString()` (líneas 32-70 del `.d.ts`): [V]

- Formatos: `"png" | "jpg" | "pdf" | "csv" | "xlsx"`. **No existe PPTX**.
- `export(type, dimensions?, transparent?, fileName?)` lanza la descarga.
- `exportAsString(type, callback(dataUri, mimeType, extension), dimensions?, transparent?)` devuelve
  un data-URI sin descarga.
- `BaseExportDimensions`: `width`, `height`, `unit: "mm" | "px"`, `dpi`, `scaling`. Si la relación
  de aspecto de `width/height` difiere de la del gráfico, la imagen se alinea arriba a la izquierda.
- `transparent` solo es válido para `png` y se ignora si `area.style.fillColor` está definido.
- `advanced.exportPdfSize: [ancho, alto]` en mm (A4 `[210, 297]` por defecto) y
  `advanced.defaultExportFileName`.
- `advanced.exportProxyURL`: URL del proxy de exportación. Por defecto es el servicio alojado por
  ZoomCharts (`https://echo.zoomcharts-cloud.com/`), documentado para Safari y para descargas de
  Chrome de más de 2 MB. El `.d.ts` avisa: "in some browsers calling this method will send the data
  to a proxy".

### Implicaciones de privacidad y decisiones

1. **Nunca se llamará a `export()` para descargar.** Se usará `exportAsString()` y la descarga se
   hará en cliente con `Blob`/`URL.createObjectURL`, sin pasar por el proxy.
2. Como defensa adicional se fija `advanced.exportProxyURL` a `"about:blank"` (nunca el de ZoomCharts; decisión
   final de la Fase 4/6, sin endpoint propio), de modo que, aunque algún camino de código llegue al proxy, los datos no
   salgan hacia terceros. Los proxys oficiales solo existen en PHP y .NET; **no se implementará un
   proxy compatible inventando su protocolo**.
3. Prueba obligatoria en Fase 6 (Playwright): interceptar red durante PNG/JPEG/PDF y fallar si hay
   cualquier petición a `*.zoomcharts-cloud.com` con datos del grafo. **[V] Hecha** (`e2e/export.spec.ts`, los 5
   formatos): solo se contacta con `api.zoomcharts-cloud.com` (licencia), sin datos del grafo y nunca con
   `echo.zoomcharts-cloud.com`.
4. PDF nativo (`type: "pdf"`) no documenta título, fecha, leyenda ni márgenes. Para cumplir esos
   requisitos se generará el PDF con `pdf-lib` incrustando el PNG de `exportAsString`. El PDF
   nativo queda como alternativa. [P] comprobar si el PDF nativo cubre algún caso.
5. PPTX: `pptxgenjs@4.0.1` (PNG insertado como imagen) y un modo "editable" con formas/conectores
   de PptxGenJS. Una imagen insertada **no** es editable nodo a nodo; la interfaz lo indicará.

### Exportar el grafo completo, no solo el viewport

La exportación dibuja la vista actual del gráfico. Existen `zoom("overview")` ("shows the whole
network"), `scrollIntoView(nodes, margins)` y `interaction.zooming.zoomExtent`/`autoZoomExtent`.
**[V] Verificado en la Fase 6** (detalle en `09-licencias-y-exportaciones.md`):

- Se crea una instancia **fuera de pantalla** con las dimensiones exactas de salida, todos los datos precargados,
  entidades fijas en su posición, `navigation.mode: "showall"`, `zoom("overview", false)`, espera a `onChartUpdate`
  y `exportAsString`. No se altera la vista del usuario.
- Con un grafo de 24 entidades en una elipse muy ancha (3200×1400) el PNG sale con el tamaño exacto, todo el grafo
  dentro (margen en los 4 lados, analizado por píxeles sin contar el logotipo de licencia) y ocupando el espacio.
  También con grafos sin posiciones guardadas (se usan las del lienzo).
- Hallazgos del spike: con relaciones visibles, el SDK dibuja las etiquetas de relación en la exportación (con el
  zoom de encuadre mayor) aunque el lienzo en pantalla las oculte; se añadió la opción de quitarlas. La licencia de
  desarrollo estampa su logotipo en todas las imágenes.

## 4. Datos y modo de navegación

- `data.preloaded: { nodes: [{id, ...style}], links: [{id, from, to}] }` y
  `navigation.mode: "manual" | "showall" | "focusnodes"` (línea 4926). Para un editor se usa
  `manual`/`showall` con datos precargados desde nuestra API (el SDK no persiste nada). [V] que
  existen; [P] cuál da mejor comportamiento con selección múltiple y edición.
- Mutación incremental: `addData`, `replaceData`, `removeData` (por ID), `updateStyle`,
  `updateSettings`. Selección: `selection()` y evento `selectionChange`. Otros eventos: `click`,
  `doubleClick`, `rightClick`, `hoverChange`, `dataUpdated`, `positionChange`, `error`. [V]
- Posiciones: `lockNode(id, x, y)`, `unlockNode`, `exportData(visibleOnly, exportCoordinates)`
  (devuelve `NetChartDataObject` con coordenadas), `freezeLayout`. Base para persistir
  `positionX/positionY`. [V] firmas; [P] formato de coordenadas devuelto.
- Selección múltiple: la API `selection()` acepta arrays y la barra de herramientas incluye
  "lasso" (assets `lasso.svg`). [V] existencia; [P] comportamiento exacto.

## 5. Licencia y producción

- Licencia en tiempo de ejecución: `window.ZoomChartsLicense` y `window.ZoomChartsLicenseKey`
  (declaradas en el `.d.ts`, líneas 7073-7075). [V]
- Planes (página de precios): prueba gratuita de 30 días sin marca de agua; plan Free con marca de
  agua y límites de dispositivos activos mensuales; los planes de pago eliminan la marca de agua.
  **Los proyectos gubernamentales requieren plan de pago.** Precios y límites de cada nivel se
  cargan dinámicamente en la web (no verificables aquí). [V] parcial
- EULA (`license.txt`): distingue licencias de desarrollo (prohibido uso en producción), proyecto
  de producción y OEM; algunas modalidades realizan **validación de licencia en línea** y otras
  validan una fecha de caducidad contra el reloj del dispositivo. [V]
- Consecuencias para este proyecto:
  - Desarrollo y pruebas: prueba de 30 días (decisión del usuario). Al expirar, el SDK mostrará
    una marca de agua/aviso (comportamiento no probado todavía).
  - La clave **no** se versiona: se inyecta en despliegue mediante `/config.js` generado desde
    variables de entorno por Nginx/entrypoint. Una clave de ZoomCharts es forzosamente visible para
    el navegador (es una licencia del lado cliente); lo que se garantiza es que no esté en el
    repositorio ni en imágenes públicas.
  - Hay que **comprobar con captura de red** qué contacta el SDK al arrancar (validación de
    licencia) y confirmar que no envía contenido del grafo. **[V] Fase 6:** solo `api.zoomcharts-cloud.com`; sin
    contenido del grafo (ver `09-licencias-y-exportaciones.md` §3).
  - El uso previsto (análisis de relaciones entre personas, posiblemente por instituciones) puede
    requerir plan de pago según el caso de uso; la decisión legal corresponde al titular del
    proyecto. Ver `docs/09-licencias-y-exportaciones.md`.

## 5 bis. Resultados verificados en navegador (Fase 4)

Ejecutado en Edge real (Playwright) con `@dvsl/zoomcharts` 1.21.21 empaquetado por Vite 8 y la clave de
licencia **vacía** (aún no disponible en `.env`). Lo que sigue es lo observado, no lo supuesto.

| Hallazgo | Estado |
|---|---|
| `import("@dvsl/zoomcharts")` funciona bajo Vite: el módulo expone `NetChart` (directo o vía `default`; el cargador admite ambos) y `new NetChart(settings)` se ejecuta. | [V] |
| Sin licencia el SDK escribe en consola «license key was not found» y «license … does not allow use of NetChart», **no lanza excepción** y **no dibuja ningún `<canvas>`**. | [V] |
| La validación de licencia es **asíncrona** (petición de red): el SDK puede crear el `<canvas>` y destruir su objeto interno después; cualquier llamada posterior lanza `TypeError: Cannot read properties of null (reading 'requestPaint')`. El lienzo lo trata como fallo recuperable (`safe()` + estado `error` + «Reintentar»). | [V] (reproducido y con prueba de regresión) |
| Al arrancar se envía `POST https://api.zoomcharts-cloud.com/lc/v1/` (también con la clave vacía). | [V] observado; [P] contenido exacto con licencia real |
| Sin licencia, además se pidieron `GET https://js.zoomcharts.com/zoomcharts-js-logo-d.png` y `…/link-icon.svg` (recursos estáticos de terceros, sin datos del grafo). Se mitiga con `credits.enabled=false`. | [V] observado; [P] confirmar que desaparecen con licencia |
| El SDK no localiza su ruta de assets cuando el script está empaquetado («Cannot locate the ZoomCharts script path based on file name 'zoomcharts.js'»): hay que fijar `assetsUrlBase`. El paquete npm no contiene carpeta de assets, así que no hay nada que servir. | [V] |
| Dar `className` a nodos/relaciones sin definir `style.nodeClasses` produce un error por elemento («class … undefined»). No se usa. | [V] |
| Aviso «getTextHeight called before CSS loaded» con `zc.css` suprimido (`.DVSL-suppress-default-styles{color:#abc}`). | [V] observado sin licencia; [P] ¿persiste con licencia? |
| Todas las formas se dibujan con `customShape` (también círculo y cuadrado: una sola vía de código). Su geometría (`hitTest`, `distanceToEdge`, contornos) está probada con pruebas unitarias. | [V] geometría; **[P] render real** |
| Contrato de `customShape` (coordenadas de `hitTest`, `paint` en px, etiquetas propias) tomado de la lectura del SDK. | [P] confirmar con licencia |
| `addData` actualiza nodos existentes por id; `removeData` de un nodo retira sus relaciones. | [P] confirmar con licencia |

La tabla de la sección 2 queda **sustituida** por esta decisión: no se usan las formas nativas (`rectangle`,
`rhombus`, `rectText`…), porque con `customShape` el contorno, el área de clic, el punto de apoyo de las flechas
y el icono salen de una única definición (`apps/web/src/features/editor/shapes.ts`) que también usa la paleta.

## 6. Fuentes consultadas

- https://js.zoomcharts.com/charts/net-chart
- https://js.zoomcharts.com/learn/quickstart/install
- https://zoomcharts.com/developers/en/overview/export.html
- https://js.zoomcharts.com/pricing
- https://zoomcharts.com/developers/en/net-chart/api-reference/api.html (no se descargó como
  página: la referencia equivalente se verificó directamente contra `zoomcharts.d.ts` 1.21.21, que
  es la fuente más fiable para firmas y valores permitidos)
- Paquetes npm `@dvsl/zoomcharts@1.21.21` y `@dvsl/react-zoomcharts@1.0.7`

Nota sobre una discrepancia: la página `js.zoomcharts.com/charts/net-chart` muestra
`npm install @aspect/zoomcharts`, un nombre de paquete que **no** coincide con la guía de
instalación oficial (`@dvsl/zoomcharts`). Se usa `@dvsl/zoomcharts`, que es el que existe en npm.
