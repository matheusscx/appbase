# Feature: Módulo de cron (jobs internos)

**Status**: Complete
**Owner**: Cesar Matheus
**Last Updated**: 2026-07-11

---

## Overview

### What is it?

Infraestructura de tareas programadas internas del backend. Los jobs se
declaran en código con `@Cron(...)` (`@nestjs/schedule`) y corren in-process.
Cada ejecución queda registrada en la tabla `cron_ejecuciones` (inicio/fin,
estado, detalle del resultado, error). No hay UI ni endpoints en esta fase.

Primer job real: **expirar-ordenes** — cada 10 minutos (y al arrancar el
backend) marca como `expirada` toda orden de pasarela `creada`/`en_proceso`
cuya `fecha_expiracion` ya pasó, excluyendo órdenes con un intento de
autorización en error (pudieron pagarse en el proveedor; se cierran solo vía
`/verificar`). Replica la regla de la expiración perezosa de
`cobros.service.ts`, que se mantiene; ambas vías son idempotentes.

### Why does it exist?

Había lógica dependiente del tiempo que solo se evaluaba al consultar
(expiración perezosa): una orden que nadie consulta quedaba `en_proceso` para
siempre. La infraestructura además deja la base para jobs futuros (cobro
recurrente de suscripciones, vencimiento por `activa_hasta`, tasas).

### Scope

- Incluido: `CronRunnerService`, tabla `cron_ejecuciones`, job `expirar-ordenes`.
- NO incluido (futuro): cobro de suscripciones, UI de administración,
  locking distribuido, intervalos configurables en BD, reintentos.

---

## Backend

### Module & Services

- **Module**: `src/modules/cron/cron.module.ts`
- **Runner**: `src/modules/cron/cron-runner.service.ts` —
  `ejecutar(job, fn)`: registra la ejecución, captura errores sin propagar,
  evita solapamiento por job (set en memoria; instancia única).
- **Job**: `src/modules/cron/jobs/expirar-ordenes.job.ts` —
  `@Cron(EVERY_10_MINUTES)` + tick inicial en `onApplicationBootstrap`.

### Entity & Database

**Table**: `cron_ejecuciones` (sin `tenant_id` — jobs del sistema)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `ejecucion_id` | UUID | PK | |
| `job` | VARCHAR | NOT NULL, índice | nombre estable, ej. `expirar-ordenes` |
| `iniciado_el` | TIMESTAMPTZ | NOT NULL | |
| `finalizado_el` | TIMESTAMPTZ | | null mientras corre |
| `estado` | VARCHAR | NOT NULL | `en_curso` \| `ok` \| `error` |
| `detalle` | TEXT | | ej. `"3 órdenes expiradas"` |
| `error` | TEXT | | mensaje si falló |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | | convención |

---

## Testing

```bash
cd backend
npm test -- cron-runner.service.spec
npm test -- expirar-ordenes.job.spec
```

Manual: forzar `fecha_expiracion` pasada en una orden `en_proceso`, reiniciar
el backend (tick inicial) y verificar `estado = 'expirada'` + fila `ok` en
`cron_ejecuciones`.

---

## Related Features

- `docs/features/` — pasarela de pagos (órdenes y transacciones)

## Notes

- Spec: `docs/superpowers/specs/2026-07-11-modulo-cron-design.md`
- El umbral de expiración vive en la orden (`fecha_expiracion`, hoy creación
  + 2 h vía `EXPIRACION_ORDEN_MS`); el job no define umbral propio.

## Follow-ups

- **Locking distribuido (BLOQUEANTE antes de escalar a múltiples réplicas del
  backend o de implementar el job de cobro de suscripciones).** El scheduler es
  in-process y el anti-solapamiento es un `Set` en memoria: con N instancias,
  cada job corre N veces por tick. `expirar-ordenes` lo tolera (UPDATE
  idempotente; solo genera filas `"0 órdenes expiradas"` extra en
  `cron_ejecuciones`), pero un job de cobro duplicaría cobros. Enfoque
  decidido (2026-07-11): advisory lock de Postgres en
  `CronRunnerService.ejecutar` — `SELECT pg_try_advisory_lock(hashtext(job))`
  antes de correr, skip si otra instancia lo tiene, release al terminar. Un
  solo cambio en el runner cubre todos los jobs; sin infraestructura nueva.
- Ventana de ms en la compensación del retorno de pago
  (`'procesando'→'en_proceso'` antes de insertar la transacción de error):
  cerrable agregando `AND o.actualizado_el < now() - interval '5 minutes'` al
  WHERE del job cuando se vuelva a tocar. No reordenar los statements de la
  compensación (dejaría órdenes trabadas en `'procesando'`).
- Backlog pasarela (preexistente): `/verificar` no despacha el callback al
  rescatar una orden a `'pagada'` — una orden rescatada no materializa su
  venta.
- Gotcha dev: tras agregar dependencias al backend, recrear el contenedor
  (`docker-compose up --build` o `--force-recreate`) — el volumen de
  `node_modules` no se refresca solo.
