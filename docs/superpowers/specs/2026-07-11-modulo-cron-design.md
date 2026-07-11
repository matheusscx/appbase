# Diseño: Módulo de cron (tareas programadas internas)

**Status**: Approved
**Date**: 2026-07-11
**Owner**: Cesar Matheus

## Contexto

El backend no tiene hoy ningún mecanismo de tareas programadas (`@nestjs/schedule`
no está instalado y no hay timers). Sin embargo ya existe lógica dependiente del
tiempo que solo se evalúa de forma perezosa al consultar:

- **Órdenes de pasarela**: cada orden nace con `fecha_expiracion = creación + 2 h`
  (`EXPIRACION_ORDEN_MS` en `cobros.service.ts` y `pagos-redirect.service.ts`). La
  expiración ocurre solo cuando alguien consulta la orden ("expiración perezosa
  (sin job en v1)", `cobros.service.ts:481`). Una orden que nadie consulta queda
  `en_proceso` para siempre.
- Candidatos futuros: cobro recurrente de suscripciones (`proximo_cobro`),
  vencimiento de suscripciones canceladas (`activa_hasta`), refresco de tasas.

Este módulo monta la **infraestructura de jobs internos del sistema** y la valida
con un primer job real: expirar órdenes de pasarela vencidas.

## Decisiones (brainstorming 2026-07-11)

1. **Alcance**: jobs internos definidos en código. Sin UI, sin endpoints HTTP y
   sin configuración por tenant en esta fase.
2. **Motor**: `@nestjs/schedule` (enfoque A). In-process, sin dependencias nuevas
   de infraestructura (no Redis, no contenedor extra). Encaja con el despliegue
   Docker de instancia única.
3. **Trazabilidad**: cada ejecución queda registrada en la tabla
   `cron_ejecuciones` (base para una futura pantalla de admin).
4. **Umbral de expiración**: el job **respeta la `fecha_expiracion` de cada
   orden** (hoy 2 h). No se introduce un umbral propio ni se modifica
   `EXPIRACION_ORDEN_MS` — una sola fuente de verdad, coherente con la
   expiración perezosa existente.

## Alcance

- Módulo nuevo `backend/src/modules/cron/` con `ScheduleModule.forRoot()`.
- Entidad + tabla `cron_ejecuciones`.
- `CronRunnerService`: envoltorio común de ejecución (registro, errores,
  anti-solapamiento).
- Primer job: `ExpirarOrdenesJob` (cada 10 minutos).

## Fuera de alcance

- Cobro recurrente de suscripciones y vencimiento por `activa_hasta`.
- UI de administración / endpoints HTTP del módulo.
- Locking distribuido (múltiples réplicas del backend).
- Intervalos configurables en BD o por tenant.
- Reintentos automáticos de jobs fallidos (el siguiente tick reintenta de facto).

## Diseño

### Entidad `CronEjecucion` → tabla `cron_ejecuciones`

| Columna | Tipo | Notas |
|---|---|---|
| `ejecucion_id` | uuid PK | `@PrimaryGeneratedColumn('uuid')` |
| `job` | varchar | nombre estable del job, ej. `expirar-ordenes` |
| `iniciado_el` | timestamptz | |
| `finalizado_el` | timestamptz nullable | null mientras corre |
| `estado` | varchar | `'en_curso'` (inicial) \| `'ok'` \| `'error'` |
| `detalle` | text nullable | resumen del resultado, ej. `"3 órdenes expiradas"` |
| `error` | text nullable | mensaje si falló |
| `creado_el` / `actualizado_el` / `eliminado_el` | timestamptz | convención del proyecto |

Sin `tenant_id`: los jobs son del sistema y recorren todos los tenants. Columnas
uuid con `type: 'uuid'` explícito (ADR-004).

### `CronRunnerService`

`ejecutar(nombreJob: string, fn: () => Promise<string>)`:

1. Si `nombreJob` está en el set en memoria de jobs en curso → skip silencioso
   (log `debug`), sin registro en BD.
2. Inserta `cron_ejecuciones` con `estado = 'en_curso'`.
3. Ejecuta `fn()`; el string devuelto se guarda como `detalle`.
4. Éxito → `estado = 'ok'`, `finalizado_el = now()`. Excepción → `estado =
   'error'`, `error = message`, y se loguea con el logger de NestJS. Nunca
   propaga la excepción (un job roto no debe tumbar el scheduler).
5. `finally`: quita el nombre del set de jobs en curso.

### `ExpirarOrdenesJob`

- `@Cron(CronExpression.EVERY_10_MINUTES)` → `runner.ejecutar('expirar-ordenes', ...)`.
- Selección: órdenes con `estado IN ('creada', 'en_proceso')`,
  `fecha_expiracion < now()`, `eliminado_el IS NULL`, **excluyendo** órdenes con
  alguna transacción `AUTHORIZATION` en estado `'error'` (pudieron pagarse en el
  proveedor; se cierran solo vía `/verificar` — misma regla que la expiración
  perezosa de `cobros.service.ts`).
- Acción: `UPDATE` a `estado = 'expirada'` (mismo efecto que la vía perezosa).
- Devuelve `"N órdenes expiradas"`.
- La expiración perezosa existente **se mantiene** (cubre la ventana entre ticks
  y es idempotente con el job).
- Además del intervalo, corre un tick inicial en `onApplicationBootstrap`
  (limpia el backlog tras un reinicio; decisión tomada al escribir el plan).

### Registro en `app.module.ts`

`ScheduleModule.forRoot()` + `CronModule`. La entidad se agrega al array de
entities de TypeORM según el patrón del proyecto.

## Verificación

- Unit tests `CronRunnerService`: registra ok con detalle; registra error sin
  propagar; skip por solapamiento (segunda llamada con el job aún en curso).
- Unit tests `ExpirarOrdenesJob`: expira la orden vencida en `en_proceso`;
  respeta la exclusión por `AUTHORIZATION` en error; no toca órdenes vigentes ni
  en estados terminales.
- Manual: sembrar/forzar una orden `en_proceso` con `fecha_expiracion` pasada,
  esperar el tick (o disparar el método del job directamente) y verificar
  `estado = 'expirada'` + fila en `cron_ejecuciones`.

## Decisiones abiertas

Ninguna.
