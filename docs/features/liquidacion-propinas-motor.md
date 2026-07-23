# Feature: Liquidación de Propinas — Motor y UI

**Status**: Complete  
**Owner**: Cesar Matheus  
**Last Updated**: 2026-07-17 (operatividad simplificada)

---

## Overview

### What is it?

Permite crear una liquidación de propinas por período, congelar las propinas
elegibles en un snapshot, calcular el reparto por grupo y participante, editar
el borrador, confirmar la asignación y anular una liquidación confirmada si fue
necesario.

### Why does it exist?

Después de registrar propinas separadas de la venta, el negocio necesita repartir
ese pool al personal de forma auditable y reproducible, usando la configuración
versionada vigente al momento de crear el borrador.

### Scope

- Incluido: motor con criterios `PARTES_IGUALES`, `VENTAS_NETAS`,
  `HORAS_TRABAJADAS`, `CANTIDAD_CUENTAS` y `MANUAL` (`PESOS`/`MONTOS`).
- Incluido: snapshot de grupos, fuentes, participantes y eventos.
- Incluido: confirmar con bloqueo de propinas y anular liberando solo las tips de
  la liquidación.
- Incluido: UI para listar, crear, revisar, editar, confirmar y anular.
- Incluido: suite E2E QA `scripts/qa/liquidacion-propinas-e2e.sh` (fixtures SQL +
  Chrome DevTools).
- No incluido: reportes agregados, egreso de caja o nómina.

---

## Operatividad (flujo simplificado)

El panel de reportes pesado del front (`PropinaReportesPanel.vue` +
`usePropinaReportes.ts` + página `/propinas/reportes`) se retiró: la operación
diaria vive completa en una **pantalla única `/propinas`**.

- **Métricas**: "pendiente por liquidar" y "cobrado del mes" (`usePropinaResumen`,
  sigue consumiendo `GET /propinas/reportes/resumen` del backend de reportes,
  que se mantiene sin cambios).
- **Selector período + turnos**: rango de fechas y turnos opcionales; cada
  cambio recalcula el reparto en vivo llamando a `preview` (no persiste nada).
- **Reparto en vivo**: muestra grupos y participantes con los montos que
  resultarían de liquidar ahora mismo, según la config de distribución vigente.
- **Ajustes en memoria**: excluir/incluir personas del reparto y fijar un monto
  manual por persona en grupos `MANUAL` — se envían como `ajustes` en el mismo
  body de `preview`/`liquidar`, sin tocar el borrador hasta confirmar.
- **Botón "Liquidar período"**: llama a `POST /propinas/liquidaciones/liquidar`,
  que crea, aplica los ajustes y confirma en una sola transacción atómica.
- **Impresión**: página `/propinas/liquidaciones/:id/imprimir?tipo=persona|resumen|grupo`
  (un solo componente, 3 vistas por query param), pensada para `window.print()`
  a A4 con saltos de página por grupo/persona (`usePropinaImpresion.ts` arma los
  grupos imprimibles a partir del `LiquidacionDetalle`).

La configuración de grupos, criterios y porcentajes de distribución
(`liquidacion-propinas-config.md`) **no cambió** — este flujo solo simplifica
cómo se dispara/ajusta/liquida un período y cómo se imprime el resultado.

---

## API Endpoints

Todos requieren JWT, tenant activo y permisos reales en backend:

- `GET /propinas/liquidaciones` — `Propinas:Leer`
- `GET /propinas/liquidaciones/:id` — `Propinas:Leer`
- `POST /propinas/liquidaciones` — `Propinas:Liquidar`
- `POST /propinas/liquidaciones/preview` — `Propinas:Leer`
- `POST /propinas/liquidaciones/liquidar` — `Propinas:Liquidar`
- `PATCH /propinas/liquidaciones/:id` — `Propinas:Liquidar`
- `POST /propinas/liquidaciones/:id/actualizar-config` — `Propinas:Liquidar`
- `POST /propinas/liquidaciones/:id/confirmar` — `Propinas:Liquidar`
- `POST /propinas/liquidaciones/:id/anular` — `Propinas:Liquidar`

### Crear Borrador

```http
POST /propinas/liquidaciones
Authorization: Bearer <token>
```

```json
{
  "fechaDesde": "2026-07-17T00:00:00.000Z",
  "fechaHasta": "2026-07-18T00:00:00.000Z",
  "turnoIds": ["uuid-turno"]
}
```

Respuesta: `LiquidacionDetalle` con cabecera, grupos, participantes, fuentes,
eventos y advertencias.

### Preview del reparto (sin persistir)

```http
POST /propinas/liquidaciones/preview
Authorization: Bearer <token>
```

```json
{
  "fechaDesde": "2026-07-17T00:00:00.000Z",
  "fechaHasta": "2026-07-18T00:00:00.000Z",
  "turnoIds": ["uuid-turno"],
  "ajustes": {
    "exclusiones": ["uuid-garzon"],
    "montosManuales": [{ "garzonId": "uuid-garzon", "monto": "15000" }]
  }
}
```

Calcula el reparto por grupo/participante con la config vigente **sin escribir
en base de datos** — usado por la pantalla operativa para el reparto en vivo
mientras el usuario ajusta período, turnos, exclusiones y montos manuales.
Solo requiere `Propinas:Leer`.

### Liquidar (atómico)

```http
POST /propinas/liquidaciones/liquidar
Authorization: Bearer <token>
```

Mismo body que `preview`. Ejecuta en una sola transacción: crea el borrador,
aplica los `ajustes` (exclusiones/montos manuales) y confirma — equivalente a
encadenar `crear` → `actualizar` → `confirmar`, pero sin dejar borradores
intermedios si algo falla. Requiere `Propinas:Liquidar`. Respuesta:
`LiquidacionDetalle` ya confirmado.

---

## Backend

### Module & Services

- **Module**: `backend/src/modules/propinas/propinas.module.ts`
- **Controller**: `backend/src/modules/propinas/liquidacion-propinas.controller.ts`
- **Service**: `backend/src/modules/propinas/liquidacion-propinas.service.ts`

### Entity & Database

Tablas principales:

- `liquidacion_propinas`
- `liquidacion_propinas_grupo`
- `liquidacion_propinas_participante`
- `liquidacion_propinas_fuente`
- `liquidacion_propinas_evento`

`venta_propina.liquidacion_id` referencia la liquidación confirmada. Durante la
creación del borrador, las fuentes quedan congeladas en
`liquidacion_propinas_fuente`; al confirmar se bloquean las filas de
`venta_propina` con `FOR UPDATE` y se asigna `liquidacion_id`.

### DTOs

- `CreateLiquidacionDto` — rango y turnos opcionales.
- `UpdateLiquidacionDto` — ajustes de participantes y recálculo.
- `AnularLiquidacionDto` — motivo obligatorio.

### Key Methods

- `crear()` — arma borrador, snapshot y cálculo inicial.
- `actualizar()` — modifica participantes de una liquidación en borrador.
- `actualizarConfig()` — reemplaza snapshot por la configuración vigente.
- `confirmar()` — valida manual/montos y reserva tips con concurrencia segura.
- `anular()` — libera tips de esa liquidación y registra motivo/evento.

---

## Frontend

### Pages

- `frontend/app/pages/propinas/index.vue` + `PropinaLiquidacionesPanel.vue` —
  listado y creación de borradores (tab Liquidaciones).
- `frontend/app/pages/propinas/liquidaciones/[id].vue` — detalle, ajustes y
  acciones.
- Selectores "Desde"/"Hasta": `AppDateInput` (solo fecha, sin hora — el
  calendario nunca permitió elegir hora; el input con hora era engañoso).
  El backend usa límite superior **exclusivo**; `inicioDiaIso`/
  `finDiaExclusivoIso` (`~/utils/date-value.ts`) convierten evitando el bug de
  `new Date('YYYY-MM-DD')` (parsea como medianoche UTC, corriendo la fecha un
  día en timezones negativas como Chile) y suman 1 día a "Hasta" para que el
  día elegido en el calendario quede incluido en el rango.

### Composable

- `frontend/app/composables/usePropinaLiquidaciones.ts` centraliza el contrato
  del API.

### Navigation

El layout dashboard muestra `Propinas` cuando el usuario es admin o tiene
`Propinas:Leer`.

---

## Testing

### Unit Tests

```bash
cd backend && npx jest src/modules/propinas --no-cache
```

Incluye tests de:

- `repartirMayoresRestos`
- `horasInterseccionHoras`
- creación, edición, actualización de config, confirmación y anulación de
  liquidaciones.

### API E2E del reparto (Jest + supertest — corre en el gate/CI)

```bash
cd backend && npm run test:e2e   # test/liquidacion-propinas.e2e-spec.ts
```

Cubre el reparto end-to-end contra la Postgres real: siembra receptores
(garzones con tip propio), reparto `PARTES_IGUALES` con reconciliación
(suma de incluidos == pool), la propina del POS entrando al pool sin que el
"Mostrador" reciba nunca, el ajuste de exclusión (redistribuye sin perder
dinero) y `liquidar` (asigna `liquidacion_id` y saca las propinas de futuros
repartos). Idempotente entre corridas: los tips liquidados quedan fuera del
pool. Los criterios `VENTAS_NETAS`/`HORAS_TRABAJADAS`/`MANUAL` no se ejercitan
acá (requieren config de grupo que el seed no trae) — los cubren los unit tests.

### QA E2E date/time inputs (Chrome DevTools)

Cubre pickers Nuxt UI (`AppDate*` / `AppTimeInput`) con smoke + mutaciones
(turno, liquidación, descuento promocional, filtros):

```bash
chrome-devtools start --headless=false
./scripts/qa/date-time-inputs-e2e.sh --all
# o: --case turno-crear | liquidacion-crear | descuento-promocional | …
```

### QA E2E liquidación propinas (Chrome DevTools)

```bash
chrome-devtools start --headless=false
./scripts/qa/liquidacion-propinas-e2e.sh --all
```

Crea tips/ventas/sesión en runtime (seed no trae `venta_propina`), luego
ejercita UI: crear → excluir → confirmar → 2ª liquidación vacía → anular.

### Builds

```bash
cd backend && npm run build
cd frontend && npm run build
```

---

## Operational Notes

- Una liquidación confirmada es inmutable; se debe anular para revertir.
- Las propinas con `monto_pagado <= 0` no forman parte del pool.
- Las sesiones abiertas se prorratean hasta el momento del cálculo y se devuelven
  como advertencia.
- En `MANUAL/MONTOS`, la suma de participantes incluidos debe coincidir con el
  monto del grupo antes de confirmar.
