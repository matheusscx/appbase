# Feature: Dashboard de inicio

**Status**: In Development (Task 2 de 2 — falta el frontend)
**Owner**: Cesar Matheus
**Last Updated**: 2026-09-18

---

## Overview

### What is it?

Un endpoint, `GET /api/resumen-negocio/hoy`, que devuelve de un vistazo cómo le fue
al negocio HOY: vendido, cobrado, cantidad de ventas, ticket promedio (cada uno con el
valor de hoy, el del mismo día de la semana pasada y la variación), vendido por canal
(físico/online), lo que hay por cobrar de cualquier fecha, las pérdidas del día
(anulaciones y mermas, cada una por su lado) y lo más vendido de hoy. Es la plata del
dashboard de inicio (spec `2026-09-18-dashboard-inicio-design.md` § 3.2) — el turno en
vivo y el frontend quedan para una tarea posterior.

### Why does it exist?

El dueño, al final del día, quiere saber cómo le fue sin entrar a ningún reporte. Un
dashboard es para mirar de un vistazo, no para analizar: pocos números del día, sin
filtros — el detalle sigue viviendo en `/ventas`.

### Scope

- Incluido en Task 1: el módulo `resumen-negocio`, su permiso propio, y el bloque
  de ventas (vendido/cobrado/cantidad/ticket promedio/por canal) + por cobrar.
- Incluido en Task 2: `perdidas` (anulaciones, reusando `AnulacionesReporteService.resumen`,
  y mermas, con `MermasService.resumen` nuevo) y `masVendidos` (hasta 5 ítems).
- NO incluido (fuera de alcance de la spec): la hora de corte configurable, restar las
  notas de crédito del vendido (pregunta fiscal, `pendientes.md` § 4), plata de cuentas
  abiertas, un total de pérdidas (spec § 4.4 — ver más abajo), un reporte de mermas
  completo (`pendientes.md` § 3), y el frontend (llega en una tarea posterior).

---

## Las reglas de plata (spec § 4)

- **Vendido:** `Σ ventas.total_final` de hoy, **sin las canceladas y sin las notas de
  crédito** — por `tipos_documento_tributario.es_nota_credito`, no por comparar contra
  un id fijo de país. Una venta `pendiente` o `pagada_parcial` SÍ cuenta: solo se
  excluyen `cancelada` y las notas de crédito. La pantalla lo va a rotular "antes de
  notas de crédito" (frontend, tarea posterior).
- **Cobrado:** `Σ pago_aplicaciones.monto` con `tipo = 'venta'` de los PAGOS
  registrados hoy (por `pagos.creado_el`), sean de ventas de hoy o de antes. Dejar el
  vuelto afuera es la misma cuenta que usa `GET /ventas/resumen` para el saldo
  pendiente.
  **Medido antes de escribir (Step 1, 2026-09-18):** ni una nota de crédito
  (`VentasService.crearNotaCreditoEnTransaccion`) ni una venta cancelada
  (`VentasService.cancelarUnaVez` rechaza la anulación con 400 si la venta tiene algún
  pago) pueden escribir en `pagos`/`pago_aplicaciones` por el camino de la app — así
  que el cobrado no necesita excluirlas con un `JOIN` a `ventas`.
- **Por cobrar:** ventas `pendiente` o `pagada_parcial`, de **cualquier fecha** — es lo
  que se debe ahora, no lo que se vendió hoy. Misma fórmula que `saldo_pendiente` de
  `VentasService.resumen`.
- **Ticket promedio:** vendido / cantidad, proyectado a 4 decimales (`ESCALA_COSTO`) —
  nadie paga este número, así que no se cuantiza con la configuración del tenant.
  `null` con cantidad 0.
- **Variación:** `(hoy − semanaPasada) / semanaPasada`, `toFixed(4)`, calculada por el
  backend con Decimal. `null` si la semana pasada vale 0.
- **"Hoy" y "la semana pasada"** salen de `fechaLocalTenant`/`bordeFechaSql`/
  `bordeHastaSql` (`rango-fecha.util.ts`), con la zona de la PROVINCIA del tenant — el
  mismo corte a medianoche local que usan reportes y mermas. La zona se resuelve UNA
  sola consulta por request (`zonaHorariaTenant`); `fecha` y `fechaSemanaPasada` se
  derivan de ahí sin volver a consultarla.
- **Tres consultas fijas** por request (zona, ventas+cantidad+porCanal en una con
  `FILTER`, cobrado, por cobrar), sin importar cuántas ventas haya.

---

## Pérdidas y lo más vendido (Task 2, spec § 4.4)

- **Anulaciones:** `perdidas.anulaciones` es el `porTipo` tal cual lo devuelve
  `AnulacionesReporteService.resumen(tenantId, { desde: fecha, hasta: fecha })` —sin
  reescribir su SQL—, con `fecha` = el día local de hoy en las dos puntas (`hasta` es
  inclusivo). Ese servicio resuelve su propia zona horaria, aparte de la que ya resolvió
  `ResumenNegocioService.hoy`: mismo costo que paga cualquier otro llamador de ese
  método.
- **Mermas:** `perdidas.mermas` sale de `MermasService.resumen(tenantId, desde, hasta)`,
  método nuevo de este módulo. UNA consulta agregada por `items.moneda_id` (mismo
  criterio que `AnulacionesReporteService.cargarCostosPorAnulacion`): cada fila aporta a
  `cantidad`; si tiene costo (`ROUND(cantidad * costo_unitario, 4)`, el mismo número que
  `costoPerdido`) suma a `costo` por moneda; si no, suma a `sinValorizar` y **no** a
  `costo` — regla 6 de la spec del costo sin tipear (`docs/agent/pendientes.md` § 3): un
  `SUM` que ignorara esas filas informaría menos pérdida que la real sin decirlo. Reusa
  **el mismo filtro de tipo** que excluye las cortesías del listado de Mermas (desde
  `2e1fad74`): un motivo en `motivo_baja` puede ser `merma`, `cortesia` o
  `no_elaborado`, y solo el primero es plata perdida de bodega. Esta entrada de
  `pendientes.md` NO se cierra con esto: sigue faltando un reporte de mermas completo
  (listado agregable, filtros propios) — esto es solo el bloque que el dashboard
  necesita.
- **No hay "total de pérdidas".** Un plato quemado en la mesa es a la vez una anulación
  de tipo `merma` y una merma de cocina (así lo define el reporte de anulaciones):
  sumar los dos bloques lo contaría dos veces. Los costos además vienen en más de una
  moneda. `PerdidasHoy` (el tipo TS) documenta esto mismo en su docblock para que nadie
  lo agregue por accidente.
- **Lo más vendido:** `masVendidos` agrupa `venta_detalles` por `item_id`, con los
  **mismos filtros de venta que "vendido"** (arriba): sin canceladas, sin nota de
  crédito, rango de hoy — y además `venta_detalles.eliminado_el IS NULL`. `monto` es
  `Σ total_linea`; `cantidad` es `Σ cantidad` (la columna ya está en unidad base —
  `venta_detalles.unidad_codigo_base` describe en qué unidad quedó congelada, no hace
  falta convertir nada). `ORDER BY` va sobre la expresión `SUM` numérica, no sobre el
  alias de texto: alfabéticamente "500" queda antes que "9990000". Hasta 5 filas. El
  nombre del ítem (`items.nombre`) sale **sin filtro de borrado**, a propósito: se
  vendió hoy, y darlo de baja después no lo saca de lo más vendido.
- Ambos bloques agregan un número **fijo** de consultas (dos para anulaciones, una para
  mermas, una para más vendidos), sin importar cuántas filas haya en el rango.

---

## Por qué el permiso propio, y no `Ventas:Leer`

La cajera tiene `Ventas:Leer` para buscar una boleta y reimprimirla. Si el bloque de
plata del dashboard colgara de ese mismo permiso, la cajera vería también cuánto
factura el local — y no habría forma de darle una cosa sin la otra. Por eso el módulo
es propio, `Resumen del negocio`, con una sola acción (`Leer`, la que ya existe en el
catálogo). Se vende junto con `Ventas` (regla comercial, el código no lo obliga — mismo
patrón que `MiCaja` + `Cajas`). Detalle: [`roles-permisos.md`](./roles-permisos.md).

---

## API

### `GET /api/resumen-negocio/hoy`

Auth: JWT + tenant. Permiso: `Resumen del negocio:Leer`. Sin parámetros — `tenantId`
sale del token; un `?tenantId=<otro>` en la query se ignora.

```
Response (200):
{
  "fecha": "2026-09-18",
  "ventas": {
    "vendido":        { "hoy": "184500.0000", "semanaPasada": "150000.0000", "variacion": "0.2300" },
    "cobrado":        { "hoy": "120000.0000", "semanaPasada": "150000.0000", "variacion": "-0.2000" },
    "cantidad":       { "hoy": 3, "semanaPasada": 3, "variacion": "0.0000" },
    "ticketPromedio": { "hoy": "61500.0000", "semanaPasada": "50000.0000", "variacion": "0.2300" },
    "porCanal":       { "fisico": "184500.0000", "online": "0" }
  },
  "porCobrar": { "cantidad": 2, "saldo": "64500.0000" },
  "perdidas": {
    "anulaciones": [
      {
        "tipo": "cortesia",
        "platos": "2.0000",
        "precioCarta": "5000.0000",
        "costo": [{ "monedaId": "…", "monto": "1200.0000" }],
        "sinValorizar": 0
      }
    ],
    "mermas": {
      "cantidad": 4,
      "costo": [{ "monedaId": "…", "monto": "900.0000" }],
      "sinValorizar": 1
    }
  },
  "masVendidos": [
    { "itemId": "…", "itemNombre": "Lomo a lo pobre", "cantidad": "3.0000", "monto": "29997000.0000" }
  ]
}
```

No hay una clave de "total de pérdidas" — ver el porqué más arriba.

`403` sin el permiso (incluye el admin de un tenant que no contrató el módulo — el
backend trata el módulo contratado como borde duro también para `es_fijo`).

---

## Backend

- **Module**: `backend/src/modules/resumen-negocio/resumen-negocio.module.ts` — sin
  entidad propia, `Db` inyectado directo (como `cuenta-asignaciones.service.ts`); lee
  con SQL raw sobre tablas de otros módulos (`ventas`, `pagos`, `pago_aplicaciones`,
  `tipos_documento_tributario`, `venta_detalles`, `items`). Importa `SalonesModule` (para
  `AnulacionesReporteService`, ahora exportado) y `MermasModule` (para `MermasService`) —
  ninguno de los dos importa `ResumenNegocioModule`, así que no hay ciclo.
- **Controller**: `resumen-negocio.controller.ts` — valida el guard y delega.
- **Service**: `resumen-negocio.service.ts` — `ResumenNegocioService.hoy(tenantId)`,
  que además de sus 4 consultas propias llama a `AnulacionesReporteService.resumen` y a
  `MermasService.resumen` (Task 2).
- **`MermasService.resumen(tenantId, desde, hasta): Promise<ResumenMermas>`**, método
  nuevo en `mermas.service.ts`: la condición que excluye las cortesías
  (`filtroTipoMerma()`) se extrajo a un método privado, reusado por `findAll` (Task 4,
  ya existente) y por `resumen` — no se copió.
- **Seed**: módulo "Resumen del negocio" (`seedModulosApp`), permiso `Leer`
  (`seedModuloAppPermisos`), contratado para Paris junto a Ventas
  (`seedTenantModulo`). El segundo tenant del seed NO lo contrata — es el caso de 403
  del e2e. Sin cambios en Task 2: no agrega seed nuevo.

---

## Testing

### Unit (`resumen-negocio.service.spec.ts`)

`Db.query` mockeado por orden de llamada (zona, ventas, cobrado, por cobrar, más
vendidos — 5 llamadas desde Task 2). `AnulacionesReporteService`/`MermasService` se
mockean aparte (no son `Db.query`). Cubre: variación con semana pasada en 0 → `null`;
ticket con división no exacta; las cláusulas SQL que excluyen canceladas y notas de
crédito (afirmando sobre la cláusula, no con un `toContain` suelto); que el cobrado lee
`pago_aplicaciones.monto` con `tipo = 'venta'` y no `pagos.monto`; la zona — con
`zonaHorariaTenant` mockeada a `America/Santiago` y el reloj fijado a las ~22:00 de
Chile, `fecha` sale `2026-09-18` aunque el UTC ya esté en el `19`, y la semana pasada
sale `2026-09-11` —; y desde Task 2: que `hoy()` llama a
`AnulacionesReporteService.resumen(tenantId, { desde: fecha, hasta: fecha })` y devuelve
su `porTipo` tal cual; que llama a `MermasService.resumen(tenantId, fecha, fecha)` y
devuelve su resultado tal cual en `perdidas.mermas`; que `masVendidos` mapea
snake_case → camelCase; y que su SQL excluye canceladas/NC, filtra
`venta_detalles.eliminado_el` y ordena por el `SUM` numérico (no por el alias de texto).

### Unit (`mermas.service.spec.ts` → `describe('resumen')`, Task 2)

`Db.query` mockeado con DOS respuestas (zona, agregación). Cubre: tres mermas (dos CLP
—una valorizada, una sin costo— colapsadas por el `GROUP BY` en un solo grupo, y una
USD valorizada) → `cantidad` 3, `costo` con dos entradas, `sinValorizar` 1; un grupo
TODO sin valorizar no aporta a `costo` pero sí a `cantidad`/`sinValorizar`; sin mermas
en el rango, todo en cero; y que el SQL filtra `eliminado_el`, `motivo = 'merma'` y el
mismo `EXISTS` de tipo que `findAll`.

### E2E (`resumen-negocio.e2e-spec.ts`)

200 con el admin; 403 con un usuario propio que tiene `Ventas:Leer` pero no `Resumen
del negocio` (armado por API, rol propio — `vendedor.paris@paris.cl` es estado
compartido por ~20 specs y no se toca); 403 con el admin del segundo tenant, que no
contrató el módulo; el delta de crear una venta A pagada entera + una venta B
pendiente con abono parcial (usando un ítem propio de precio no redondo, y leyendo
`totalFinal` de la respuesta del servidor, nunca fijado en el test); que anular una
venta no mueve el vendido; que `?tenantId=<otro>` no cambia la respuesta; y, en
`describe('pérdidas y lo más vendido (delta)')` (Task 2, salón/mesa/garzón propios,
molde `salones-anular-linea.e2e-spec.ts`): anular un plato despachado como cortesía
mueve `perdidas.anulaciones` de tipo `cortesia`; registrar una merma sin costo cargado
(`POST /mermas`, molde `test/mermas.e2e-spec.ts`) sube `perdidas.mermas.sinValorizar`
en 1 sin mover `costo`; y una venta de un ítem propio con precio muy alto
(`'9990000'`) sale primera en `masVendidos`, con su `monto` igual al `totalFinal` de
la línea.

```bash
cd backend && npm test -- resumen-negocio.service.spec.ts mermas.service.spec.ts
npm run test:e2e -- resumen-negocio.e2e-spec.ts
```

---

## Related Features

- [`ventas.md`](./ventas.md) — de donde sale `total_final` y el criterio de nota de
  crédito.
- [`pagos.md`](./pagos.md) — `pago_aplicaciones` y el criterio de excluir el vuelto.
- [`roles-permisos.md`](./roles-permisos.md) — el permiso `Resumen del negocio:Leer`.
- `docs/superpowers/specs/2026-09-18-dashboard-inicio-design.md` — spec completa
  (zona "Ahora" del turno, pérdidas, más vendidos, frontend).
