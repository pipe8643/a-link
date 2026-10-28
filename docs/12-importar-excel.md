# Importar un grafo desde Excel

En el editor: **Importar Excel**. Puedes descargar la plantilla (`plantilla-grafo-a-link.xlsx`) y rellenarla.

El fichero debe ser **.xlsx** (Excel 2007 o posterior), sin macros ni fórmulas, máximo 2 MB. La lectura es en el
navegador: el Excel no se sube al servidor.

## Hojas

| Hoja | Obligatorio | Contenido |
|---|---|---|
| `Entidades` | sí | Una fila por nodo |
| `Relaciones` | no | Una fila por arista |
| `Instrucciones` | no | La plantilla la incluye; se ignora al importar |

## Entidades

| Columna | Obligatorio | Qué es |
|---|---|---|
| `ref` | sí | Clave tuya (`ana`, `tel1`…). Única en el fichero. Las relaciones apuntan a ella. |
| `tipo` | sí | Nombre en español (`Persona`) o identificador (`person`) |
| `nombre` | sí | Texto que se ve en el grafo |
| `descripcion` | no | |
| `notas` | no | |
| `etiquetas` | no | Separadas por coma o punto y coma |
| claves de metadatos | no | `fullName`, `number`, `plate`, `profileUrl`… (lista completa en la hoja Instrucciones) |

Tipos: Persona (`person`), Bien inmueble (`property`), Vehículo (`vehicle`), Teléfono (`phone`), Red social (`social`),
Organización o empresa (`organization`), Cuenta bancaria (`bank_account`), Documento (`document`), Ubicación (`location`),
Otro (`other`).

## Relaciones

| Columna | Obligatorio | Qué es |
|---|---|---|
| `origen` | sí | `ref` de la entidad origen |
| `destino` | sí | `ref` de la entidad destino |
| `tipo` | sí | p. ej. `Contacto` o `contact` |
| `etiqueta` | no | Texto sobre la arista |
| `naturaleza` | no | `Hipótesis` (por defecto), `Dato registrado`, `Observación` |
| `direccion` | no | `origen→destino` (por defecto), `sin dirección`, `ambos` |
| `inicio` / `fin` | no | `AAAA-MM-DD` |
| `fuente` | no | |
| `confianza` | no | Entero 0–100 |
| `descripcion` | no | |

Tipos de relación: Propiedad, Titularidad, Familiar, Asociación, Contacto, Uso de dispositivo, Vinculación digital,
Ubicación, Relación comercial, Personalizada.

## Ejemplo mínimo

**Entidades**

| ref | tipo | nombre |
|---|---|---|
| ana | Persona | Ana Pérez |
| tel1 | Teléfono | +34 600 000 000 |

**Relaciones**

| origen | destino | tipo |
|---|---|---|
| ana | tel1 | Contacto |

Tras importar, ZoomCharts reorganiza el lienzo. El autoguardado persiste el resultado como cualquier otra edición.
Si el grafo ya tenía contenido, las filas se **añaden** (no se borra lo anterior).
