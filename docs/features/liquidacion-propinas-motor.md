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
  manual por persona — se envían como `ajustes` en el mismo body de
  `preview`/`liquidar`, sin tocar el borrador hasta confirmar. El monto manual
  está pensado para grupos `MANUAL`, pero **funciona en cualquier criterio**
  siempre que lo repartido siga cuadrando con el monto del grupo (regla 2 abajo).
- **Botón "Liquidar período"**: llama a `POST /propinas/liquidaciones/liquidar`,
  que crea, aplica los ajustes y confirma en una sola transacción atómica.
- **Impresión**: página `/propinas/liquidaciones/:id/imprimir?tipo=persona|resumen|grupo`
  (un solo componente, 3 vistas por query param), pensada para `window.print()`
  a A4 con saltos de página por grupo/persona (`usePropinaImpresion.ts` arma los
  grupos imprimibles a partir del `LiquidacionDetalle`).

La configuración de grupos, criterios y porcentajes de distribución
(`liquidacion-propinas-config.md`) **no cambió** — este flujo solo simplifica
cómo se dispara/ajusta/liquida un período y cómo se imprime el resultado.

### Reglas del reparto que no se pueden romper

Las tres salieron de la auditoría del 2026-07-27 y cada una tiene tests que las
fijan. Antes, las tres se violaban en silencio o reventaban la liquidación entera.

**1. El pool se reparte siempre entero.** Un grupo del que **nadie puede cobrar**
—porque no trabajó nadie de ese tipo, o porque todos los presentes tienen peso 0
con el criterio configurado (un bartender que abrió turno y no cerró ninguna
cuenta, con `VENTAS_NETAS`)— **no reserva su porcentaje**: su parte se
redistribuye entre los grupos que sí pueden, en proporción a los porcentajes de
ellos. Los participantes de ese grupo quedan en 0 y siguen apareciendo, para que
se vea que estuvieron. Decisión de owner: el porcentaje es una regla para
repartir entre quienes están, no una reserva.
`MANUAL`+`MONTOS` es la excepción a "poder cobrar": ahí el monto no sale de un
peso, así que alcanza con que el grupo tenga participantes.

Si **ningún** grupo puede recibir y hay pool, la liquidación corta con un `400`
que dice qué revisar (turnos del período y criterio de cada grupo). Un período
**sin propinas** no es un error: todos quedan en cero.

**2. Lo repartido en cada grupo tiene que dar su `montoGrupo`.** Se verifica al
**confirmar**, sobre todos los criterios y no solo `MANUAL`+`MONTOS`. Un monto
manual pisa el monto de una persona sin recalcular a las demás, así que sin esta
verificación se podía repartir más plata de la que había en el pool y confirmarlo.
La regla **no prohíbe el ajuste manual**: exige que la plata cuadre, así que un
ajuste compensado entre dos personas del mismo grupo pasa sin problema.

**2b. Una persona no puede cobrar en dos grupos de la misma liquidación.** La pertenencia
sale del `tipo_garzon` **congelado en el tip**, y `garzones.tipo` es editable: quien se
reclasifica a mitad de período genera propinas con dos roles y aparecería en dos grupos,
contra el índice único `(liquidacion_id, garzon_id)`. Antes eso reventaba con un error de
Postgres sin traducir **a mitad de la transacción**, y bloqueaba la liquidación de todo el
período. Ahora corta con un `400` que nombra a la persona, sus dos grupos y **la fecha de
corte sugerida** —el primer tip del rol que arrancó después—: liquidando hasta ahí, cada
rol cae en su propia liquidación sin tocar la configuración.

Corre en los **cuatro** puntos de entrada. En `crear`, `liquidar` y el **preview** corta
antes de escribir nada, así que se ve antes de intentar liquidar. En `actualizarConfig`
corre después de rehacer el snapshot (dos `softDelete` y un `save`), todo dentro de la
misma transacción: revierte igual, pero ahí no es literalmente "antes de escribir".

⚠️ **La fecha sugerida sale solo de los tips, no de las sesiones.** Si la persona tiene una
sesión del primer rol abierta —o que termina después de ese corte—, esa sesión sigue
solapando el segundo tramo (`buscarSesionesPeriodo` filtra por solapamiento de rango) y el
conflicto vuelve a aparecer en el segundo intento. No genera datos incorrectos: vuelve a
cortar con el mismo 400. Pero en ese caso un solo corte no alcanza, y hay que acotar
también los turnos.
Que la persona **sí** cobre en los dos grupos es la otra salida posible y es un cambio de
modelo (el índice más los ajustes, que hoy se identifican solo por `garzonId`): queda
anotado en `docs/agent/pendientes.md` con su costo, para encararlo si el caso aparece.

**3. La propina de una venta anulada no se reparte.** `buscarTipsElegibles`
excluye las ventas `cancelada`: esa plata nunca se cobró. Ver en
`docs/agent/pendientes.md` el caso todavía abierto —la venta se anula **después**
de que la propina ya se liquidó y se pagó—, que el owner decidió resolver con un
saldo en contra descontado de la próxima liquidación y necesita spec propia.

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

#### Qué se acepta como fecha de período

Fecha pura (`2026-07-17`) o timestamp completo: el SQL no hace `::date`, así que
una hora es un límite de período legítimo. Lo que se rechaza con `400`, en los
tres endpoints que reciben un período (`POST`, `preview` y `liquidar`):

- **Fechas que no existen en el calendario** — `2026-02-31`, `2026-04-31`,
  `2026-02-29`. Son ISO bien formadas, así que solo las ve `@IsISO8601` con
  `strict: true`. Sin él, `new Date` las **rueda** al mes siguiente sin avisar y
  la liquidación quedaba persistida sobre un período que nadie pidió. (Un 29 de
  febrero de año bisiesto real, `2028-02-29`, sí se acepta.)
- **Fechas ISO que `new Date` no sabe leer** — `2026-W32-1` (semana ISO),
  `20260807` (básico sin guiones). Estas **pasan `strict`**, porque son ISO 8601
  válidas, y producen `Invalid Date`. La guarda de orden no las detiene:
  `NaN <= NaN` es `false`. Llegaban hasta Postgres, que cortaba con un `500`.

Las corta `rangoLiquidacionDesde` (`propinas/utils/rango-liquidacion.ts`), que
también aplica la guarda `fechaHasta > fechaDesde`.

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
pool.

Un segundo bloque muta la config de distribución por la API real
(`PUT /propinas/distribucion`, versionada) y la restaura en `afterAll`: cubre
`VENTAS_NETAS` (reparto proporcional a la base de ventas de cada garzón, no
parejo) y dos grupos (`Garzones` 70% + `Cocina` 30%, el pool se parte por
porcentaje y cada persona recibe solo de su grupo — la pertenencia sale del
`tipo_garzon` del tip, no de `garzon.tipo`). Cada caso parte de pool 0 (liquida
el remanente) y siembra sus propios tips, así es determinista sin importar el
orden. `HORAS_TRABAJADAS`/`MANUAL` siguen cubiertos por los unit tests.

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
