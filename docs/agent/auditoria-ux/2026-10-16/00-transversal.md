# 00 · Hallazgos transversales

Son los hallazgos que no pertenecen a una sola pantalla. Salieron al aplicar la identidad de Venka
(2026-10-15/16) y de las revisiones independientes de ese frente. Su confianza es "medido" o
"código", según se indica en cada uno.

## Alcance

- **Qué se revisó:** el tema global, los componentes compartidos, el texto de toda la app y la
  configuración del frontend.
- **Cómo:** con la app corriendo (stack del checkout principal) y leyendo código.
- **Capas aplicadas:** capa 1 (lenguaje del local), capa 2 (consistencia) y capa 3 (textos).
  Este documento no tiene flujo ni matriz porque no cubre una pantalla: cada grupo los trae en el
  suyo.

## Hallazgos

| # | Severidad | Confianza | Dónde | Qué pasa (escena concreta) | Propuesta | Decide |
|---|---|---|---|---|---|---|
| 00.1 | P2 | medido | `frontend/app.config.ts` (raíz) | Nuxt 4 lee el app.config de `app/`, así que el de la raíz no se carga. Sus alias de texto y fondo, y sus ajustes de `UCard`, `UModal` y `UFormField` (`px-6 py-4`, `rounded-lg`, `divide-y`), no se aplican hace tiempo. Las tarjetas y los modales usan los rellenos por defecto de Nuxt UI, aunque `DESIGN-SYSTEM.md` § Espaciado dice que usan `px-6 py-4`. Quien edite ese archivo no va a ver ningún cambio. | Elegir una de dos: **(a)** moverlo a `app/app.config.ts` y revisar las pantallas una por una (cambia el relleno de todas las tarjetas y modales), o **(b)** borrarlo y dejar los valores por defecto, actualizando § Espaciado. Recomiendo **(b)**: hoy la app se ve con los valores por defecto y nadie lo notó. | owner |
| 00.2 | P3 | código | `DESIGN-SYSTEM.md` § Semantic Color Tokens; usos de `text-highlighted` en la app | La guía dice que los links usan `text-highlighted` como "acento" (color de marca). En Nuxt UI v4, `text-highlighted` es el gris más oscuro: el alias que lo convertía en `primary-600` estaba en el archivo de la raíz, que no se carga (00.1). Por eso los links de la app se ven en negro con peso medio, no en petróleo. La maqueta del ingreso los muestra en petróleo. | Decidir el color de los links. Si van en petróleo: `text-primary` en los links y corregir la guía. | owner |
| 00.3 | P3 | código | Al menos 81 líneas en 49 archivos con la lista de verbos de abajo; los grupos que lo contaron con otras listas encontraron más (07.28: 41 líneas en 23 archivos solo en configuración; también 03.19, 06.24, 08.17, 09.18) | Hay textos en voseo ("Podés", "tenés", "Intentá", "Elegí", "Revisá"…) mezclados con tuteo en la misma app. Por ejemplo, "Recuperar contraseña" dice "Ponés tu correo y te mandamos…" y "Mandame el link". El tono de la marca es tuteo chileno (`IDENTIDAD.md`). Los más concentrados: `configuracion/grupos-modificadores.vue` (8), `tienda/suscripciones.vue` (6), `salones/index.vue` (6). | Pasar todo a tuteo en un solo lote mecánico, archivo por archivo, sin cambiar el sentido. Actualizar los e2e que buscan esos textos (la lista sale del mismo grep). | agente |
| 00.4 | P3 | código | `backend/src/main.ts:23`; `.env.example:48`; `docker-compose.yml:133`; `docs/ARCHITECTURE.md` | "Prueba Técnica" sigue en el título del Swagger del backend ("Prueba Técnica API") y en la variable `VITE_APP_NAME`, que no lee nadie: el título real sale de `nuxt.config.ts`. La fila de `ARCHITECTURE.md` que la describe como "Título de la app" es falsa. | Cambiar el Swagger a "Venka API", y quitar `VITE_APP_NAME` del compose, del ejemplo y de la doc. | agente |
| 00.5 | P3 | medido | `layouts/dashboard.vue` (menú lateral) | Cuando una pantalla hija está activa (Ventas › Punto de venta), el grupo padre y la hija llevan los dos el fondo resaltado. A 1280 px, con el lateral al 15 %, "Punto de venta" se corta como "Punto de ven…". | Resaltar solo la hija, dejando el padre abierto sin fondo, y revisar el ancho por defecto del lateral para que entren las hijas más largas. | agente |
| 00.6 | P3 | código | `layouts/dashboard.vue` (`#item-leading`) | El ícono de los ítems del menú se dibuja con una plantilla propia que no muestra `avatar`, `chip` ni el estado `disabled`. Hoy ningún ítem los usa. Si mañana se agrega un contador con `chip`, no aparecería y no habría error. | Dejar un comentario en la plantilla. Si se agrega un contador, usar `badge` (va a la derecha y sí se dibuja). | agente |
| 00.7 | P2 | medido | `frontend/public/fonts/dm-sans.woff2`; 42 usos de `tabular-nums` en `frontend/app` | **Regresión del frente de identidad.** DM Sans no trae cifras tabulares: el archivo original (`DMSans[opsz,wght].ttf`) no tiene la función `tnum` y sus dígitos miden distinto (el "1" mide 342 unidades y el "0", 656). Por eso `tabular-nums` no hace nada y, en una columna de montos alineados a la derecha, las cifras no quedan una bajo otra; un total que se actualiza "baila". Antes de la identidad la app usaba la letra del sistema, que sí las trae. Bricolage sí tiene `tnum`. | **(a)** Recomendada: derivar del mismo archivo una DM Sans con los diez dígitos al mismo ancho. La licencia OFL lo permite y DM Sans no declara nombre reservado; tarea del agente, con su propia medición. **(b)** Cifras en Bricolage, que tiene `tnum`: cambia la cara de los números. **(c)** Otra letra con `tnum` solo para cifras: es una decisión de identidad. | owner |
| 00.8 | P2 | medido | Colores `success`, `warning` y `error` de Nuxt UI (por defecto, sin tocar) | Las insignias "Pagada" y "Caja abierta", los botones verdes ("Confirmar recepción") y las cifras positivas y negativas usan los tonos 500 por defecto de Nuxt UI. Sobre blanco miden **verde 2,22:1, ámbar 1,91:1 y rojo 3,81:1**, debajo del mínimo de 4,5:1 para texto. Salió en ocho grupos: 01.17, 02.17, 02.18, 03.8, 03.9, 03.10, 04.5, 04.6, 04.21, 05.17, 06.27, 07.16, 08.10. Los de Caja (03.8) usan `green-600` explícito, que mide 3,22:1: también por debajo. Pasa en toda la app y es anterior a la identidad: la identidad cambió `primary`, no estos. | Asignar escalas propias más oscuras a `success`, `warning` y `error` en `app/app.config.ts` (`ui.colors`), igual que `primary`, y medir cada combinación. Es una decisión de paleta: los colores financieros de Caja son excepción aprobada, pero su contraste no lo es. Se arregla una vez y cierra todos los hallazgos citados. | owner (tonos) / agente (medir y aplicar) |
| 00.9 | P2 | código | `components/crud/CrudTable.vue:10-13` (41 pantallas lo usan) | `tableSlots` se calcula una sola vez con `useSlots()`. Una columna cuyo slot aparece después, por ejemplo cuando cargan los permisos, nunca se dibuja. Compras lo midió: la columna "Pago" sale vacía al recargar (06.26). Es la causa común de cualquier columna que "a veces no aparece" en las pantallas de configuración y de listas. | Que `CrudTable` pase todos sus slots sin filtrarlos en un `computed`, o que cada pantalla deje de declarar slots con `v-if`. Revisar las 41 con un spec. En el mismo componente, la tabla no se adapta al ancho y deja la columna de acciones fuera de la tarjeta (07.1: 15 de 23 pantallas a 768, y Roles a 1280). | agente |
| 00.10 | P1 | medido | `inventario/traslados.vue:187` (`lineasValidas`); `compras/[id].vue:364` (`lineasCargadas`) | **El mismo patrón en dos pantallas:** una línea con producto pero sin cantidad (o sin serie, o sin lote) se filtra antes de enviar y se guarda el resto con un toast de éxito. Se reprodujo en las dos (05.2 y 06.1). Quien cargó cinco productos y se olvidó una cantidad cree que guardó cinco. | Una sola regla para los formularios de líneas: una línea empezada e incompleta **bloquea** el envío y se marca en rojo junto al campo, con "Completa la cantidad o quita la línea". Aplicarla en las dos pantallas y buscar el patrón (`filter(l => l.itemId && l.cantidad)`) en el resto. | agente |
| 00.11 | P1 | medido | `frontend/app/utils/api-error.ts` (`apiErrorMsg`) y los mensajes de `class-validator` del backend | Cuando el servidor rechaza un formulario, el toast muestra el mensaje del validador tal cual: en inglés, con nombres internos y sin marcar el campo ("nombre should not be empty, tipoReglaId must be a UUID", "lineas.0.cantidad debe ser mayor a cero"). Se midió en seis pantallas de configuración (07.2), en compras (06.2) y en el ingreso (08.2). | Dos capas: **(a)** la pantalla valida antes de enviar y marca el campo (con `UForm` y un esquema, que ya usa el patrón del repo); **(b)** `apiErrorMsg` nunca muestra un mensaje de validador crudo: cae a "Revisa los datos marcados" y deja el detalle en la consola. Los mensajes del backend en español que ya existen se conservan. | agente |
| 00.12 | P2 | medido | Ver el inventario debajo de la tabla | **Varias pantallas no se ven de Venka** (lo vio el owner en "Ventas › Historial"). Hay tres causas, y ninguna es un color de marca mal puesto: **(a)** tarjetas de resumen pintadas de verde o ámbar para datos que no son un estado ("Total facturado" en verde, "Saldo pendiente" en ámbar aunque sea $0); **(b)** montos en letra monoespaciada (`font-mono`), que se ve como de terminal al lado de DM Sans; **(c)** rótulos en MAYÚSCULAS con espaciado. 00.8 arregla el contraste, pero no la falta de coherencia. | **(a)** Tarjetas de resumen neutras (`bg-elevated`), con la cifra en `text-highlighted` y el color reservado para un estado real: saldo pendiente mayor que $0 en ámbar, nunca $0. **(b)** Montos en DM Sans con cifras de ancho fijo. Depende de **00.7**: si se saca `font-mono` sin eso, las columnas de montos se desalinean. **(c)** Rótulos con mayúscula solo inicial. Se aplica por grupo de pantallas, junto al lote de cada uno. | agente (después de 00.7 y 00.8) |

**Inventario de 00.12** (en `frontend/app`, 2026-10-16):

- **(a) Tarjetas de color de estado como fondo:** `pages/ventas/index.vue`, `pages/pagos/index.vue`, `components/caja/CajaTurnoResumen.vue`.
- **(b) `font-mono` (90 usos en 32 archivos):** ventas (`ventas/index.vue`, `CarritoPanel`, `VentaDetalleDrawer`, `NotaCreditoModal`, `PrecioItem`, `MonedaTasasInfo`, `UnidadesSerieModal`), caja (`CajaMovimientosTable`, `CajaHistorial`, `CajaTendencia`, `CajaPendientesRevision`, `CajaIntentosRechazados`), pagos (`pagos/index.vue`, `PagoDetalleDrawer`, `AbonoModal`), órdenes (`ordenes.vue`, `OrdenDetalleDrawer`, `GenerarNotaModal`, `ReembolsoModal`), salones (`salones/index.vue`, `AnularLineaModal`), inventario (`inventario/index.vue`, `traslados.vue`), tienda (`CarritoOnline`, `tienda/retorno.vue`), configuración (`items.vue`, `pasarelas.vue`, `preferencias-financieras.vue`), y además `InicioCierres`, `DesfasesPanel`, `PromocionesAplicadas` y la impresión de liquidaciones de propinas.
- **(c) `uppercase`:** `ventas/index.vue`, `pagos/index.vue`, `reportes/varianza.vue`, `salones/anulaciones.vue`, `CajaCierreDrawer`, `CajaTurnoResumen` y la impresión de liquidaciones.

Comandos: `grep -rlE "bg-(success|warning|error|info)/10|bg-(green|emerald|amber|yellow|orange|red|blue|sky|indigo|purple)-(50|100)"`, `grep -rcE "font-mono"` y `grep -rlE "uppercase"`, sobre `--include='*.vue'`.

Comando del conteo de 00.3, ejecutado en `frontend/app/` con una lista acotada de verbos, así que el
número es un piso:

```bash
LC_ALL=en_US.UTF-8 grep -rEn --include='*.vue' --include='*.ts' '(^|[^[:alpha:]])(Abrí|Ponés|Mandame|Confirmá|[Ee]legí|cambiás|[Vv]olvé|Tocá|Escribí|Revisá|Probá|Ingresá|Seleccioná|Agregá|Cerrá|Hacé|[Pp]odés|[Tt]enés|[Qq]uerés|Fijate|Mirá|Usá|Andá|Pedí|Esperá|Contactá|Recargá|Intentá|Cargá|Completá|Asigná|Indicá|Definí|Creá|Guardá|Buscá|Activá|Desactivá|Dejá|Apretá|Presioná)([^[:alpha:]]|$)' . | grep -v node_modules | grep -v '\.nuxt' | grep -v '\.spec\.ts' | grep -vE ':[0-9]+:\s*(//|\*|/\*|<!--)'
```

No cuenta el voseo que llega en mensajes del backend (ver 08.17).

## Lo que está bien

- Las tipografías y la paleta cargan desde la app y no dependen de Google.
- La pestaña dice "Venka" y el favicon es el de la marca.
- Ninguna pantalla desborda a 1280 ni a 768 en las rutas que vigila `e2e/layout/desborde.spec.ts`.
- El texto sobre petróleo mide 6 a 9,5:1, por encima del mínimo de 4,5:1.

## Orden sugerido

1. **00.10**, porque guarda menos de lo que la persona cargó y cree.
2. **00.11**, porque hoy un error común deja a la persona con un mensaje en inglés.
3. **00.8** y **00.9**, porque cierran de una vez hallazgos de varios grupos.
4. **00.1**, porque cambia la base que miran todas las demás tarjetas. Decidirlo antes de arreglar
   el espaciado de cualquier pantalla.
5. **00.3** y **00.4** en un solo lote mecánico de textos.
6. **00.2** y **00.7**, decisiones de color y de letra, junto con los links que aparezcan en los grupos.
