# El kardex deja de llamar "costo perdido" a la cortesía y a la comida del personal

**Fecha:** 2026-10-04 · **Tipo:** spec de diseño
**Entrada:** [`docs/agent/pendientes.md`](../../agent/pendientes.md) § 3, *"El kardex llama 'costo
perdido' a la cortesía y a la comida del personal"*. Sale del cierre de
[`2026-10-04-comida-del-personal-design.md`](2026-10-04-comida-del-personal-design.md) § 4.

---

## 1. El problema

Toda baja escribe `motivo = 'merma'` en `movimientos_inventario`; lo único que separa la merma de la
cortesía y de la comida del personal es `motivo_baja.tipo`. El kardex (`GET /inventario/movimientos`)
no lee ese tipo: `InventarioService.mapMovimientoRow` calcula `costoPerdido` con `r.motivo ===
'merma'`, y la pantalla de Inventario lo pinta en rojo bajo *"Costo perdido"*. Un plato anulado como
cortesía aparece como *"Merma · Cortesía de la casa"* con su costo como pérdida. Mermas, el Inicio y
varianza ya filtran por tipo; el kardex es lo que queda.

## 2. Quién lee `costoPerdido` del kardex (medido antes de diseñar)

| Consumidor | Qué lee |
|---|---|
| `InventarioService.mapMovimientoRow` (+ `inventario.service.spec.ts`) | lo produce |
| `frontend/app/pages/inventario/index.vue` | columna *"Costo perdido"* y el badge `Merma · {motivoBajaNombre}` |
| `frontend/app/pages/configuracion/items.vue` (historial del ítem) | mismo endpoint, **no** lee `costoPerdido` ni `motivoBajaNombre` |

Los `costoPerdido` de `mermas.service.ts`, `mermas.vue` y `resumen-negocio.e2e-spec.ts` son **otro
campo** (el de `GET/POST /mermas`), que ya distingue la vista de personal. Quedan como están.

## 3. Diseño

### 3.1 Lectura (backend)

- `findMovimientos` agrega `mb.tipo AS motivo_baja_tipo` al `SELECT`. Es el `LEFT JOIN motivo_baja`
  que la consulta ya tenía: no hay consulta nueva ni una por fila.
- **El `JOIN` deja de filtrar `mb.eliminado_el`**, y el porqué queda escrito en la consulta: el tipo
  es un hecho del movimiento ya aplicado. Un motivo en uso no se puede borrar
  (`MotivosBajaService.remove`), salvo por la carrera sin lock que ya documenta
  `salones.service.ts` (remove contra una baja concurrente). En ese caso, con el filtro, la fila
  perdería su tipo y su nombre sin decirlo. Mismo criterio que `items` y `ubicaciones` en esta misma
  consulta, y que el `JOIN` de varianza. El `COUNT` no tiene ese `JOIN`, así que el total no cambia.
- `MovimientoListItem` gana `motivoBajaTipo: TipoMotivoBaja | null` (`null` fuera de las bajas).
- `costoPerdido` pasa a llamarse **`costoBaja`**: el mismo número (`cantidad × costo_unitario`
  congelado, escala 4, `null` sin costo), para toda fila `motivo = 'merma'`. El número es el valor de
  lo que se dio de baja; si es pérdida o no lo dice el tipo, y lo nombra la pantalla.
- **No se toca cómo se escribe el kardex.** Nada escribe en `movimientos_inventario`.

### 3.2 Pantalla (Inventario › kardex)

- La columna *"Costo perdido"* pasa a *"Costo de la baja"*. El monto va en el color normal para
  `cortesia` y `consumo_personal`; **todo lo demás sigue en rojo** (`text-error`), incluido un
  `motivoBajaTipo` `null`. La regla va invertida a propósito: si un día aparece una baja sin tipo,
  queda como hoy (pérdida) en vez de neutralizarse en silencio. Hoy toda fila `motivo = 'merma'`
  lleva motivo (lo garantizan los caminos que la escriben), pero ningún `CHECK` de la base lo
  asegura. `no_elaborado` no escribe movimiento, así que no aparece.
- El badge del motivo deja de decir *"Merma"* para lo que no lo es: `${tipoMotivoBajaLabel(tipo)} ·
  ${nombre}` → *"Merma · Vencimiento"*, *"Cortesía · Cumpleaños"*, *"Comida del personal ·
  Almuerzo"*. El texto sale de `tipoMotivoBajaLabel` (`useSalones.ts`), el mismo que ya usan Inicio,
  Mermas y el modal de anulación; nada de strings nuevos. Sin tipo, sigue diciendo *"Merma · X"*,
  como hoy.

### 3.3 Procedencia

Contrato, color y badge: **decidido por la Sesión de esfuerzo máximo (2026-10-04), derivado de dos
decisiones del owner** — la comida del personal no es pérdida (owner, 2026-10-04) y la cortesía no
es pérdida real (spec del reporte de anulaciones, 2026-09-18, aprobada por el owner: Mermas muestra
toda pérdida real y deja de mostrar cortesías). Descartadas: un campo aparte para el costo de
cortesía y personal (el mismo número en dos campos) y esconder ese costo del kardex (eso sí sería
del owner: oculta un dato que hoy se ve).

## 4. Fuera de alcance (con su lugar)

- La opción *"Merma"* del filtro de motivo del kardex sigue trayendo todas las bajas (cortesía y
  personal incluidas): filtra por `mv.motivo`. Entrada nueva en `pendientes.md`. Desde este cambio
  ese filtro devuelve filas con el badge *"Cortesía · X"*: la contradicción en la misma pantalla es
  lo que la hace visible.
- El campo `costoPerdido` de Mermas para la vista de personal: ya lo nombra *"Costo"* la pantalla.

## 5. Qué lo fija

- **Unit** (`inventario.service.spec.ts`, control débil): `mapMovimientoRow` expone
  `motivoBajaTipo` y `costoBaja` para merma, cortesía y personal; `null` fuera de las bajas; el SQL
  trae `mb.tipo` y su `JOIN` no filtra el borrado.
- **E2E contra Postgres** (control fuerte, `mermas.e2e-spec.ts`, en el describe que ya anula
  platos como cortesía): una merma y una cortesía del mismo plato; el kardex del plato devuelve cada
  fila con su tipo y su `costoBaja`. Y la comida del personal por `POST /mermas`.
- **Front** (`inventario/index.nuxt.spec.ts`): encabezado *"Costo de la baja"*; la merma y la baja
  sin tipo en rojo, la cortesía y la comida del personal no; badges por tipo.
- **Mutantes:** volver a filtrar `mb.eliminado_el` en el `JOIN`; pintar en rojo sin mirar el tipo;
  neutralizar la baja sin tipo; la etiqueta *"Merma"* para toda baja.
- **Playwright** sobre la pantalla del kardex.
