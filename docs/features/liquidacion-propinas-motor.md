# Feature: Liquidación de Propinas — Motor y UI

**Status**: Complete  
**Owner**: Cesar Matheus  
**Last Updated**: 2026-07-17

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
- No incluido: reportes agregados, egreso de caja o nómina.

---

## API Endpoints

Todos requieren JWT, tenant activo y permisos reales en backend:

- `GET /propinas/liquidaciones` — `Propinas:Leer`
- `GET /propinas/liquidaciones/:id` — `Propinas:Leer`
- `POST /propinas/liquidaciones` — `Propinas:Liquidar`
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

- `frontend/app/pages/propinas/liquidaciones/index.vue` — listado y creación de
  borradores.
- `frontend/app/pages/propinas/liquidaciones/[id].vue` — detalle, ajustes y
  acciones.

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
