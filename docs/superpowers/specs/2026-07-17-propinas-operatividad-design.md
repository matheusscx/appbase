# Diseño — Operatividad de propinas (rediseño práctico)

- **Status:** Draft
- **Date:** 2026-07-17
- **Owner:** Cesar Matheus

## Context

El módulo de propinas (`backend/src/modules/propinas/`, `frontend/app/pages/propinas/`)
tiene un **motor de liquidación sólido** (calcula el pool, toma snapshot de la config,
reparte por grupo según criterio, confirma bloqueando las propinas, anula) y una
**configuración que el usuario quiere conservar** (`/configuracion/propinas-distribucion`:
porcentaje sugerido + grupos por `tipoGarzon` con porcentaje del pool y criterio de reparto).

El problema es la **operatividad/UX**, no la lógica:

- Flujo de dos tabs (`Liquidaciones` + `Reportes`) con demasiados pasos.
- Gestión explícita de **borradores** (crear → listar → abrir → editar → confirmar).
- Pantalla de detalle técnica (versión de config, fuentes, log de eventos).
- Tab de **reportes pesado** (cobranza, tendencia, por turno, vista trabajadores) que
  agrega ruido.
- **No hay impresión** del reparto ni comprobantes por persona.

Objetivo: una operatividad **práctica** — ver el fondo y su reparto entre los grupos,
liquidar, e imprimir el detalle de cada uno — con reporting mínimo.

## Scope

**Dentro:**
- Rediseño de `/propinas` a una sola pantalla operativa (reparto en vivo → liquidar).
- Historial simple de liquidaciones cerradas (reimprimir / anular).
- Resumen mínimo (2 métricas) en el encabezado.
- Impresión vía navegador (PDF/A4): comprobante por persona, resumen, detalle por grupo.
- Endpoint de **preview** que calcula el reparto sin persistir.
- Extender la creación para **crear + confirmar atómicamente** con ajustes aplicados.

**Fuera (YAGNI):**
- No se toca la **configuración** de distribución (backend ni frontend).
- No se toca la **lógica de cálculo** del reparto (criterios, redondeo mayores-restos,
  snapshot de grupos).
- No se toca el sistema de auth/tokens ni el motor de precios.
- Impresión térmica (QZ Tray): descartada, solo navegador.
- Agregar un participante manual nuevo (que no viene del cálculo): fuera de alcance por
  ahora; sí se conserva excluir/incluir y editar monto de los detectados.
- El log de **eventos** se conserva en backend pero se saca de la UI.

## Flujo de usuario (objetivo)

1. Entrás a `/propinas`. Ves el resumen mínimo: **Pendiente por liquidar** y
   **Cobrado en el período**.
2. Elegís **período (desde/hasta) + turno(s)** → se muestra al instante el **reparto en vivo**:
   - **Fondo total** destacado.
   - Una tarjeta por **grupo** (nombre, % del pool, monto del grupo).
   - Dentro de cada grupo, las **personas** con su monto.
3. Ajustás si hace falta:
   - **Excluir / incluir** una persona → el sistema recalcula el reparto del resto.
   - **Editar monto** manualmente (cuando el criterio lo permite).
4. Apretás **"Liquidar período"** → se crea y confirma la liquidación (bloquea las
   propinas para que no se liquiden dos veces).
5. **Imprimís** el detalle: comprobante por persona, resumen o detalle por grupo.
6. La liquidación cerrada queda en el **historial** para reimprimir o anular.

No hay borradores que el usuario administre: la "vista en vivo" es un cálculo efímero
(preview) que no persiste hasta liquidar.

## Backend

### Reutilizado sin cambios
- Cálculo de pool, snapshot de grupos, distribución por criterio, redondeo mayores-restos.
- `POST /propinas/liquidaciones/:id/confirmar` (bloqueo de propinas), `.../anular`.
- `GET /propinas/liquidaciones`, `GET /propinas/liquidaciones/:id`.
- Servicio de configuración de distribución.

### Cambios
1. **Refactor:** extraer el cálculo del reparto (hoy embebido en `crear` +
   `crearParticipantes`) a un método puro reutilizable
   `computarReparto(tenantId, periodo, turnoIds, ajustes)` que devuelve
   `{ poolTotal, grupos, participantes }` **sin persistir**. Usa `EntityManager` opcional
   para poder correr dentro o fuera de transacción.
2. **Nuevo endpoint `POST /propinas/liquidaciones/preview`**
   - Body: `{ fechaDesde, fechaHasta, turnoIds?, ajustes? }`.
   - `ajustes`: `{ exclusiones: string[] /* garzonId */, montosManuales: { garzonId, monto }[] }`.
   - Respuesta: mismo shape que el detalle pero **sin ids persistidos** (participantes
     identificados por `garzonId` dentro de su grupo por `tipoGarzon`).
   - Guard: mismo permiso de lectura/liquidar que el resto del módulo.
3. **Extender `POST /propinas/liquidaciones`** (o crear `.../liquidar`) para aceptar
   `{ fechaDesde, fechaHasta, turnoIds?, ajustes?, confirmar?: boolean }` y, cuando
   `confirmar === true`, **crear + aplicar ajustes + confirmar en una sola transacción**,
   reutilizando `computarReparto` y la lógica de bloqueo existente.

**Identidad de participante en preview:** como no hay filas, los ajustes referencian
`garzonId` (cada garzón pertenece a un solo grupo por `tipoGarzon`). Al liquidar, el
backend recompone los participantes con el mismo `computarReparto` y aplica los mismos
ajustes, garantizando que lo que se ve en preview es lo que se guarda.

## Frontend

### Pantalla operativa `/propinas` (reescribe `pages/propinas/index.vue`)
- Elimina los tabs y el `PropinaReportesPanel`.
- **Encabezado:** 2 métricas (pendiente por liquidar, cobrado en período) desde un
  endpoint/resumen mínimo (reusar lo mínimo del reporte de resumen ya existente).
- **Selector de período + turnos** (reusa `AppDateTimeInput` + `USelectMenu` de turnos).
- **Reparto en vivo:** llama a `preview` on-change; muestra fondo, grupos y personas.
  Ajustes (excluir/incluir, editar monto) actualizan un estado local de `ajustes` y
  re-llaman `preview` para recalcular.
- **"Liquidar período":** llama al endpoint crear+confirmar con los ajustes; al volver,
  redirige a la vista imprimible o muestra confirmación con accesos a imprimir.
- **Historial** de liquidaciones cerradas (tabla simple: período, fondo, estado) con
  acciones reimprimir / anular.

### Composables
- Extender `usePropinaLiquidaciones` con `preview(body)` y `liquidar(body)`.
- Podar `usePropinaReportes` a lo mínimo (solo el resumen que alimenta las 2 métricas), o
  reemplazarlo por un fetch puntual.

### Impresión — ruta dedicada
- `pages/propinas/liquidaciones/[id]/imprimir.vue` con
  `?tipo=persona|resumen|grupo`, **sin layout dashboard**, estilos `@media print`.
- `persona`: un comprobante por trabajador (nombre, período, monto, línea de firma),
  salto de página entre personas.
- `resumen`: fondo + todos los grupos y personas en una hoja.
- `grupo`: una hoja por grupo.
- Botón "Imprimir" dispara `window.print()`.

### Eliminado
- `PropinaReportesPanel.vue` y el grueso de `usePropinaReportes.ts`.
- Tabla técnica de liquidaciones (columnas Config/versión) y el bloque de eventos en la
  vista de detalle (el detalle editable actual `[id].vue` se reemplaza por el historial +
  vista imprimible; su edición ya no hace falta porque los ajustes ocurren en preview).

## Data flow

```
Selector período ──▶ POST /preview (ajustes) ──▶ { fondo, grupos, personas }
      ▲                                                   │
      └──── ajuste (excluir / editar monto) ◀─────────────┘  (re-preview)

"Liquidar" ──▶ POST /liquidaciones {confirmar:true, ajustes} ──▶ liquidación cerrada
                                                                      │
                                                            ▶ /liquidaciones/[id]/imprimir
```

## Error handling
- Preview con período inválido (hasta ≤ desde) → 400, se muestra inline.
- Preview sin propinas en el período → fondo $0, mensaje "sin propinas para liquidar",
  botón Liquidar deshabilitado.
- Liquidar cuando alguna propina ya fue liquidada por otra corrida → 400 (ya existe la
  validación de carrera en `confirmar`), toast de error.
- Editar monto manual que no cuadra con el monto del grupo (modo MONTOS) → 400 existente.

## Testing
- **Backend:** unit de `computarReparto` (mismos resultados que el `crear` actual para un
  caso conocido); spec del endpoint preview (con y sin ajustes); spec de crear+confirmar
  atómico (bloquea propinas, aplica exclusiones/montos). Reusar fixtures de
  `liquidacion-propinas.service.spec.ts`.
- **Frontend:** que preview refleje exclusiones; que Liquidar navegue a imprimir; que las
  3 vistas imprimibles rendericen los montos correctos.
- **E2E (opcional):** período → excluir persona → liquidar → imprimir.

## Decisions
- **Vista en vivo = preview sin guardar** (no borradores en BD). Elegido sobre "borrador
  oculto" para no dejar filas abandonadas y mantener el modelo mental "no gestiono borradores".
- **Impresión por navegador (PDF/A4)**, no térmica: más simple, sin dependencia de QZ Tray.
- **Reportes reducidos a 2 métricas**, no eliminados del todo.
- **Config intacta**: el rediseño es solo de operatividad.
- Ajustes soportados: excluir/incluir + editar monto. Agregar participante nuevo: diferido.
```
