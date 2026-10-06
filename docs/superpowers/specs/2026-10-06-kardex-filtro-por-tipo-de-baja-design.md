# El filtro "Merma" del kardex separa la merma de la cortesía y de la comida del personal

**Status**: Approved (decisiones de forma tomadas por la sesión del frente siguiendo lo que ya
existe; enviadas a la Sesión de esfuerzo máximo, 2026-10-06)
**Date**: 2026-10-06
**Sale de**: [`pendientes.md`](../../agent/pendientes.md) § 3, *"El filtro 'Merma' del kardex trae
también la cortesía y la comida del personal"*.

## 1. El problema

La merma, la cortesía y la comida del personal escriben las tres `motivo = 'merma'` en
`movimientos_inventario`; solo `motivo_baja.tipo` las separa. El desplegable de motivo de
`/inventario` ofrece *"Merma"* y manda `motivo=merma`, y `buildMovimientosFilters` filtra por
`mv.motivo`. Desde el 2026-10-04 cada fila dice su tipo, así que con *"Merma"* puesto se ven filas
*"Cortesía · …"* y *"Comida del personal · …"*: la pantalla se contradice.

Las decisiones de fondo ya están: la cortesía y la comida del personal no son pérdida (owner,
2026-09-18 y 2026-10-04). Falta la forma del filtro y que el `COUNT` y la página filtren igual.

## 2. Quiénes usan `motivo` del kardex (medido antes de diseñar)

| Consumidor | Qué hace con `motivo` |
|---|---|
| `FindMovimientosDto` (`@IsIn(MOTIVOS)`) | whitelist |
| `InventarioService.buildMovimientosFilters` | `AND mv.motivo = $n`, compartido por `COUNT` y página |
| `pages/inventario/index.vue` (`motivoOpts`) | selector del filtro y mapa de etiquetas del badge |
| `pages/configuracion/items.vue` (historial del ítem) | pega al endpoint **sin** `motivo` |
| e2e de API: `mermas`, `costeo-cpp`, `recuentos`, `traslados`, `ventas` | leen con `motivo=` |
| Playwright: `nota-credito-recupera-o-pierde`, `kardex-costo-de-baja` | leen el endpoint |
| Reportes / exports | **ninguno**: varianza, Mermas e Inicio tienen consultas propias; no hay export del kardex |

## 3. La forma

### 3.1 Un parámetro aparte, como Mermas y Anulaciones

Lo que ya existe para separar bajas por tipo es un parámetro propio: `GET /mermas?tipo=`
(`@IsIn(TIPOS_DE_MERMAS)`) y `GET /reportes/anulaciones?tipo=` (`@IsEnum(TipoMotivoBaja)`). El
kardex gana **`motivoBajaTipo`**, no `tipo`: en el kardex `tipo` ya es entrada/salida, y
`motivoBajaTipo` es el nombre del campo que la respuesta ya trae.

- **`motivo` no cambia de significado.** `motivo=merma` sigue trayendo las tres bajas; nadie que
  hoy lo lea cambia de conducta (el e2e de `mermas` que lo afirma sigue valiendo).
- **Whitelist**: los tipos que escriben en el kardex — `merma`, `cortesia`, `consumo_personal` —,
  derivados de `tipoMotivoBajaDescuenta` (su `switch` es exhaustivo: un tipo nuevo obliga a decidir
  ahí si descuenta, y con eso si se filtra). `no_elaborado` es **400**: no descuenta, nunca deja
  fila en el kardex y el filtro siempre traería vacío.
- **Combinado con `motivo`** es un `AND`: `motivo=compra&motivoBajaTipo=cortesia` da vacío, no 400.
  Es la semántica de los demás filtros del listado.

### 3.2 El SQL

Un `EXISTS` sobre `motivo_baja` agregado en `buildMovimientosFilters`, que es lo que comparten las
dos consultas: el `COUNT` y la página aplican el mismo filtro por construcción. Es la forma de
`MermasService.filtroTipo`. No se usa el `LEFT JOIN mb` de la página porque el `COUNT` no lo tiene,
y agregárselo solo para esto sería otra forma de que las dos consultas diverjan.

**Sin `eliminado_el IS NULL` sobre `motivo_baja`, con el porqué en la consulta**, igual que el
`JOIN` de la lectura: el tipo es un hecho del movimiento ya aplicado; un motivo en uso no se puede
borrar salvo por la carrera sin lock que documenta `salones.service.ts`, y en ese caso el filtro
escondería la fila sin decirlo.

### 3.3 La pantalla

La opción *"Merma"* del desplegable pasa a ser cuatro:

- **Bajas (todas)** manda solo `motivo=merma`: la conducta de hoy, con el nombre que dice la verdad.
- **Merma**, **Cortesía** y **Comida del personal** (las palabras de `tipoMotivoBajaLabel`) mandan
  `motivo=merma&motivoBajaTipo=<tipo>`.

**Por qué existe "Bajas (todas)"** (decidido por la Sesión de esfuerzo máximo, 2026-10-06): la
opción vieja ya mostraba las tres juntas y lo único malo era el nombre. Partirla sin esa opción
sacaba una vista que funcionaba —todo lo que salió del inventario sin venderse— solo porque su
nombre mentía. "Baja" ya es palabra de la app (Configuración → *Motivos de baja*). Sale de la
decisión del 2026-10-04 de no llamar pérdida a la cortesía ni a la comida del personal.

## 4. Fuera de alcance

- Cómo se **escribe** el kardex: nada escribe en `movimientos_inventario`.
- `motivoOpts` como mapa del badge: el badge de una baja ya sale de `tipoMotivoBajaLabel`.

## 5. Qué lo fija

- **e2e de API (control fuerte)**: con las tres bajas de un ítem propio, `motivoBajaTipo=<x>` trae
  solo la suya y `meta.total = 1` (con `pageSize=1` y sin el filtro, `total = 3`: discrimina un
  `COUNT` que no filtre). El pipe: `no_elaborado`, un valor inventado y vacío → 400 con el nombre
  del campo; los tres válidos → 200.
- **unit** (`inventario.service.spec.ts`): el `EXISTS` va en las dos consultas con el `$n` correcto;
  control débil, sobre el texto, de que no filtra el borrado de `motivo_baja` (el estado solo se
  alcanza por una carrera, así que no hay e2e que lo monte).
- **unit de página** (`index.nuxt.spec.ts`) y **Playwright** contra el backend real.
