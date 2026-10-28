# Importar un grafo desde Excel

En el editor: **Importar Excel**. Descarga la plantilla (`plantilla-grafo-a-link.xlsx`) y rellénala.

El fichero debe ser **.xlsx** (Excel 2007 o posterior), sin macros ni fórmulas, máximo 2 MB. Se lee en el navegador: no se sube al servidor.

## Una sola hoja: `Grafo`

Cada fila es una entidad. Si esa entidad se une a otra, la misma fila lleva el enlace. La primera fila es una ayuda breve (Excel la ignora al importar). Las columnas **tipo**, **tipo_enlace**, **naturaleza** y **direccion** tienen lista desplegable.

| Columna | Obligatorio | Qué poner |
|---|---|---|
| `ref` | sí | Clave corta tuya (`ana`, `tel1`). Si dejas la celda vacía, se reutiliza la de la fila de arriba. |
| `tipo` | sí (en la primera fila de esa ref) | Elige de la lista (Persona, Teléfono…) |
| `nombre` | sí (en la primera fila de esa ref) | Texto que se ve en el grafo |
| `descripcion` | no | |
| `etiquetas` | no | Separadas por coma |
| `enlace_con` | si hay enlace | `ref` de la otra entidad |
| `tipo_enlace` | si hay `enlace_con` | Elige de la lista (Contacto, Familiar…) |
| `etiqueta_enlace` | no | Texto sobre la flecha (`socia`…) |
| `naturaleza` | no | Hipótesis (por defecto), Dato registrado u Observación |
| `direccion` | no | origen→destino (por defecto), sin dirección o ambos |

Varios enlaces de la misma entidad: **repite la ref** en la fila siguiente (o déjala vacía) y cambia solo `enlace_con` y `tipo_enlace`. No hace falta volver a escribir tipo ni nombre.

Hay una hoja oculta `Listas` que alimenta los desplegables; no la edites.

## Ejemplo

| ref | tipo | nombre | enlace_con | tipo_enlace |
|---|---|---|---|---|
| ana | Persona | Ana Pérez | tel1 | Contacto |
| ana | | | acme | Relación comercial |
| tel1 | Teléfono | +34 600 000 000 | | |
| acme | Organización o empresa | Acme SL | | |

Resultado: 3 entidades y 2 enlaces (Ana→teléfono y Ana↔empresa).

Tras importar, el lienzo se reorganiza. Si el grafo ya tenía contenido, las filas se **añaden**. Datos extra de cada tipo (matrícula, URL…) se editan después en el panel de la aplicación.
