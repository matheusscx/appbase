# Feature: Reportes agregados de propinas (F)

**Status**: Complete  
**Owner**: Cesar Matheus  
**Last Updated**: 2026-07-17

---

## Overview

### What is it?

Vista operativa en `/propinas?tab=reportes` (tab dentro de Propinas) con dos vistas:

- **Resumen:** cobranza, estado actual, anulaciones históricas, tendencia diaria
  y desgloses por turno/tipo.
- **Por trabajador:** propina originada y asignación confirmada, con las bases
  congeladas usadas en la liquidación.

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

- Página: `frontend/app/pages/propinas/index.vue` (tab Reportes) + `PropinaReportesPanel.vue`
- Redirect compat: `/propinas/reportes` → `/propinas?tab=reportes`
- Composable: `frontend/app/composables/usePropinaReportes.ts`
- Navegación: grupo Propinas en `frontend/app/layouts/dashboard.vue`

Cada tab solicita solo su endpoint y cachea por tenant + combinación de
filtros. Aplicar filtros invalida ambas caches. Los montos se muestran con
`useFormatters`; solo la proporción visual de las barras convierte a `number`.

## Testing

```bash
cd backend
npm test -- query-propina-reporte.dto.spec.ts propina-reportes.service.spec.ts --runInBand
npm run build

cd ../frontend
npm test -- --run app/composables/usePropinaReportes.spec.ts
npm run build
```

Verificación manual:

1. Consultar sugeridas, manuales y cierres sin propina.
2. Comparar pendiente libre, fuentes en borrador y confirmadas.
3. Anular y reliquidar; comprobar que anulación queda como histórico separado.
4. Cambiar tabs y comprobar cache; Aplicar debe consultar solo el tab activo.
5. Filtrar por turno/tipo y revisar advertencias.
6. Probar usuario con y sin `Propinas:Leer`.

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
