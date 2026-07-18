# Feature: Reportes agregados de propinas (F)

**Status**: Complete  
**Owner**: Cesar Matheus  
**Last Updated**: 2026-07-17

---

## Overview

### What is it?

Dos endpoints de backend con reportes agregados de propinas:

- **Resumen:** cobranza, estado actual, anulaciones históricas, tendencia diaria
  y desgloses por turno/tipo.
- **Por trabajador:** propina originada y asignación confirmada, con las bases
  congeladas usadas en la liquidación.

> **2026-07-17 — front de reportes retirado.** El panel pesado con tabs
> (`PropinaReportesPanel.vue`, `usePropinaReportes.ts`, página
> `/propinas/reportes`) se eliminó al simplificar la operatividad del módulo
> (ver [`liquidacion-propinas-motor.md`](./liquidacion-propinas-motor.md)).
> Ambos endpoints **se mantienen intactos**; hoy solo `resumen` se consume,
> desde la pantalla `/propinas` (`usePropinaResumen`), para 2 métricas
> ("pendiente por liquidar" y "cobrado del mes"). `trabajadores` queda
> disponible sin consumidor en el front.

### Why does it exist?

Permite conocer cuánto se cobró, qué sigue pendiente y cómo se distribuyó, sin
confundir el hecho de venta con el snapshot auditable de liquidación.

### Scope

- Incluido: filtros por fechas, turnos y tipo; cache por tab; permiso
  `Propinas:Leer`; montos como strings decimales.
- No incluido: CSV/PDF, envío programado, pago real al trabajador, agregados
  persistidos ni prorrateos estimados.

## Semántica

- La cobranza se filtra por `venta_propina.creado_el`.
- La asignación usa liquidaciones confirmadas completamente contenidas en el
  período consultado.
- Las fechas de query son calendario `YYYY-MM-DD`; el backend convierte los
  límites a medianoche usando la zona horaria del país del tenant.
- Pendiente libre, en borrador y liquidada son estados actuales excluyentes.
- El monto liberado por anulación es histórico y no se suma al estado actual.
- Una liquidación parcialmente solapada se excluye y genera una advertencia; no
  se prorratea.
- Con filtro de turno, una liquidación configurada para todos los turnos no se
  atribuye a uno particular.

## API Endpoints

### `GET /propinas/reportes/resumen`

Auth: JWT + tenant. Permiso: `Propinas:Leer`.

Query:

```text
desde=2026-07-01
hasta=2026-08-01
turnoIds=uuid,uuid       # opcional
tipoGarzon=garzon        # opcional: garzon | cocina | barra
```

`desde` es inclusivo, `hasta` exclusivo y el rango máximo es 366 días.

Respuesta: `periodo`, `cobranza`, `estadoActual`, `anulaciones`, `tendencia`,
`porTurno`, `porTipo` y `advertencias`.

### `GET /propinas/reportes/trabajadores`

Auth: JWT + tenant. Permiso: `Propinas:Leer`.

Usa la misma query. Retorna `data[]`, `totales` y `advertencias`. Cada fila
distingue `origen` de `asignacionConfirmada`.

## Backend

- `backend/src/modules/propinas/propina-reportes.controller.ts`
- `backend/src/modules/propinas/propina-reportes.service.ts`
- `backend/src/modules/propinas/propina-reportes.types.ts`
- `backend/src/modules/propinas/dto/query-propina-reporte.dto.ts`

Las queries son `SELECT` parametrizados, aíslan por `tenant_id` y filtran soft
delete en hechos, fuentes, liquidaciones y participantes. Las etiquetas de
garzones permiten recuperar el último nombre de una fila soft-deleted, sin
exponer su PIN.

## Frontend

- Página: `frontend/app/pages/propinas/index.vue` — solo consume `resumen` vía
  `frontend/app/composables/usePropinaResumen.ts` para las 2 métricas de
  cabecera (pendiente por liquidar, cobrado del mes).
- Navegación: grupo Propinas en `frontend/app/layouts/dashboard.vue`.
- El panel con tabs, sus filtros propios y el cache dual descritos antes del
  2026-07-17 ya no existen; `trabajadores` no tiene consumidor en el front.

## Testing

```bash
cd backend
npm test -- query-propina-reporte.dto.spec.ts propina-reportes.service.spec.ts --runInBand
npm run build

cd ../frontend
npm run build
```

Verificación manual:

1. Consultar sugeridas, manuales y cierres sin propina.
2. Comparar pendiente libre, fuentes en borrador y confirmadas.
3. Anular y reliquidar; comprobar que anulación queda como histórico separado.
4. Filtrar por turno/tipo y revisar advertencias (vía backend/API directa; el
   front ya no expone filtros de reportes).
5. Probar usuario con y sin `Propinas:Leer`.

## Acceptance Criteria

- [x] Ambos endpoints implementados con RBAC y aislamiento tenant.
- [x] Períodos y filtros validados.
- [x] Resumen y trabajadores disponibles en una pantalla con tabs.
- [x] Sin aritmética financiera con `number`.
- [x] Unit tests y builds pasan.
- [x] Documentación viva actualizada.

## Related Features

- [Registro de propinas](./salones-mesas.md)
- [Configuración de distribución](./liquidacion-propinas-config.md)
- [Motor de liquidación](./liquidacion-propinas-motor.md)
- [Spec de F](../superpowers/specs/2026-07-17-reportes-propinas-f-design.md)
