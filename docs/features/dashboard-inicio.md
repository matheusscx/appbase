# Feature: Dashboard de inicio

**Status**: In Development (Task 1 de 2 — falta pérdidas, más vendidos y el frontend)
**Owner**: Cesar Matheus
**Last Updated**: 2026-09-18

---

## Overview

### What is it?

Un endpoint, `GET /api/resumen-negocio/hoy`, que devuelve de un vistazo cómo le fue
al negocio HOY: vendido, cobrado, cantidad de ventas, ticket promedio (cada uno con el
valor de hoy, el del mismo día de la semana pasada y la variación), vendido por canal
(físico/online), y lo que hay por cobrar de cualquier fecha. Es la mitad de plata del
dashboard de inicio (spec `2026-09-18-dashboard-inicio-design.md` § 3.2) — pérdidas y
más vendidos los agrega la Task 2, al mismo tipo `ResumenNegocioHoy`.

### Why does it exist?

El dueño, al final del día, quiere saber cómo le fue sin entrar a ningún reporte. Un
dashboard es para mirar de un vistazo, no para analizar: pocos números del día, sin
filtros — el detalle sigue viviendo en `/ventas`.

### Scope

- Incluido en esta tarea: el módulo `resumen-negocio`, su permiso propio, y el bloque
  de ventas (vendido/cobrado/cantidad/ticket promedio/por canal) + por cobrar.
- NO incluido (Task 2): pérdidas (anulaciones + mermas) y lo más vendido.
- NO incluido (fuera de alcance de la spec): la hora de corte configurable, restar las
  notas de crédito del vendido (pregunta fiscal, `pendientes.md` § 4), plata de cuentas
  abiertas, y el frontend (llega en una tarea posterior).

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
  "porCobrar": { "cantidad": 2, "saldo": "64500.0000" }
}
```

`403` sin el permiso (incluye el admin de un tenant que no contrató el módulo — el
backend trata el módulo contratado como borde duro también para `es_fijo`).

---

## Backend

- **Module**: `backend/src/modules/resumen-negocio/resumen-negocio.module.ts` — sin
  entidad propia, `Db` inyectado directo (como `cuenta-asignaciones.service.ts`); lee
  con SQL raw sobre tablas de otros módulos (`ventas`, `pagos`, `pago_aplicaciones`,
  `tipos_documento_tributario`).
- **Controller**: `resumen-negocio.controller.ts` — valida el guard y delega.
- **Service**: `resumen-negocio.service.ts` — `ResumenNegocioService.hoy(tenantId)`.
- **Seed**: módulo "Resumen del negocio" (`seedModulosApp`), permiso `Leer`
  (`seedModuloAppPermisos`), contratado para Paris junto a Ventas
  (`seedTenantModulo`). El segundo tenant del seed NO lo contrata — es el caso de 403
  del e2e.

---

## Testing

### Unit (`resumen-negocio.service.spec.ts`)

`Db.query` mockeado por orden de llamada (zona, ventas, cobrado, por cobrar). Cubre:
variación con semana pasada en 0 → `null`; ticket con división no exacta; las cláusulas
SQL que excluyen canceladas y notas de crédito (afirmando sobre la cláusula, no con un
`toContain` suelto); que el cobrado lee `pago_aplicaciones.monto` con `tipo = 'venta'`
y no `pagos.monto`; y la zona — con `zonaHorariaTenant` mockeada a `America/Santiago`
y el reloj fijado a las ~22:00 de Chile, `fecha` sale `2026-09-18` aunque el UTC ya
esté en el `19`, y la semana pasada sale `2026-09-11`.

### E2E (`resumen-negocio.e2e-spec.ts`)

200 con el admin; 403 con un usuario propio que tiene `Ventas:Leer` pero no `Resumen
del negocio` (armado por API, rol propio — `vendedor.paris@paris.cl` es estado
compartido por ~20 specs y no se toca); 403 con el admin del segundo tenant, que no
contrató el módulo; el delta de crear una venta A pagada entera + una venta B
pendiente con abono parcial (usando un ítem propio de precio no redondo, y leyendo
`totalFinal` de la respuesta del servidor, nunca fijado en el test); que anular una
venta no mueve el vendido; y que `?tenantId=<otro>` no cambia la respuesta.

```bash
cd backend && npm test -- resumen-negocio.service.spec.ts
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
