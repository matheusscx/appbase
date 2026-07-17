# Diseño: Reportes Agregados de Propinas (F)

**Status**: Approved  
**Owner**: Cesar Matheus  
**Date**: 2026-07-17

---

## Contexto

Los subproyectos D y E ya registran el hecho de propina, congelan su contexto
operativo y permiten distribuirla mediante liquidaciones auditables. Falta una
vista agregada que permita responder dos preguntas distintas:

1. ¿Cuánto se cobró y en qué estado está ese dinero?
2. ¿Quién originó propinas y cuánto recibió finalmente en liquidaciones
   confirmadas?

Este diseño cubre **F — reportes agregados de propinas**. Los reportes son
lecturas en vivo sobre los hechos y snapshots existentes; no crean saldos,
movimientos de caja ni nuevas fuentes de verdad.

## Alcance

Incluido:

- Página operativa `/propinas/reportes` con tabs **Resumen** y
  **Por trabajador**.
- Filtros compartidos por período obligatorio, turnos opcionales y tipo de
  trabajador opcional.
- KPIs del ciclo completo: cobrada, sin propina, pendiente libre, incluida en
  borradores, liquidada confirmada y liberada históricamente por anulación.
- Tendencia diaria y desgloses por turno y tipo de trabajador responsable.
- Agregados por trabajador que distinguen propina **originada** de monto
  **asignado**.
- Lecturas aisladas por `tenant_id`, con soft delete en cada tabla.
- Montos y porcentajes como strings decimales; cálculos monetarios con
  Decimal.js.
- Permiso real de backend `Propinas:Leer`.

Fuera de alcance:

- Exportar CSV, Excel o PDF.
- Enviar reportes por correo o programarlos.
- Pago/egreso real al trabajador, nómina o integración bancaria.
- Persistir agregados diarios, materialized views o jobs de reconstrucción.
- Propinas de POS genérico u online, porque todavía no generan
  `venta_propina`.
- Comparación automática contra un período anterior.

Las exportaciones y el pago efectivo quedan como mejoras futuras independientes,
sin letra o plan asignado.

## Principios y semántica

### Dos hechos diferentes

El reporte no mezcla cobranza con distribución:

- **Origen/cobranza** se obtiene de `venta_propina` y se fecha por
  `venta_propina.creado_el`.
- **Asignación** se obtiene del snapshot de participantes de liquidaciones
  confirmadas y se fecha por el período de negocio de la liquidación
  (`fecha_desde` / `fecha_hasta`).

No existe asignación por cada propina fuente: el snapshot guarda el monto total
por participante. Por eso F no intenta prorratear una liquidación entre días,
turnos o propinas individuales; hacerlo sería una estimación no auditable.

### Definiciones

- **Cierres:** todas las filas activas de `venta_propina` en el período.
- **Con propina:** `monto_pagado > 0`.
- **Sin propina:** `monto_pagado = 0`.
- **Monto cobrado:** suma de `monto_pagado`.
- **Sugerencia aceptada:** fila con propina positiva y
  `monto_pagado = monto_sugerido`.
- **Tasa con propina:** cierres con propina / cierres totales.
- **Tasa de sugerencia aceptada:** sugerencias aceptadas / cierres con propina.
- **Promedio por venta con propina:** monto cobrado / cierres con propina.
- **Pendiente libre:** propina positiva con `liquidacion_id IS NULL` y que no
  aparece como fuente activa de un borrador.
- **En borrador:** propina positiva presente como fuente activa de al menos una
  liquidación en estado `borrador`. Sigue sin estar confirmada.
- **Liquidada:** propina vinculada actualmente a una liquidación confirmada.
- **Liberada por anulación:** monto histórico de fuentes de liquidaciones
  anuladas cuyo período de negocio está contenido en el rango consultado. Es
  una métrica histórica separada: una propina liberada puede haber sido incluida
  después en otra liquidación confirmada.
- **Originada por trabajador:** suma de propinas de ventas donde ese trabajador
  era el responsable congelado (`venta_propina.garzon_id`).
- **Asignada a trabajador:** suma de `participante.monto` para participantes
  incluidos en liquidaciones confirmadas.

Las categorías de estado actual de cobranza
`pendiente libre + en borrador + liquidada` son mutuamente excluyentes. La
métrica histórica de anulaciones no se suma a ellas.

### Reglas del período

- `desde` es inclusivo y `hasta` exclusivo.
- Ambos son fechas calendario `YYYY-MM-DD`. El backend convierte cada límite a
  medianoche en la zona horaria del país del tenant; así un administrador remoto
  obtiene el mismo período que el local.
- Rango máximo: 366 días para proteger consultas agregadas.
- KPIs de cobranza, tendencia, turno y origen por trabajador filtran
  `venta_propina.creado_el >= desde AND < hasta`.
- Métricas de asignación incluyen únicamente liquidaciones confirmadas
  completamente contenidas en el rango:
  `fecha_desde >= desde AND fecha_hasta <= hasta`.
- Liquidaciones que cruzan un límite del reporte no se prorratean ni se incluyen
  en asignación. La API devuelve su cantidad en
  `liquidacionesParcialmenteSolapadas` y la UI muestra una advertencia.

### Filtros por turno y tipo

- `turnoIds` aplica de forma exacta a cobranza mediante
  `venta_propina.turno_id`.
- En asignaciones, un filtro por turno solo incluye liquidaciones cuyo
  `turno_ids` explícito es no vacío y está contenido en los turnos elegidos.
  Las liquidaciones creadas para “todos los turnos” no se atribuyen a un turno
  particular y se excluyen cuando existe ese filtro.
- `tipoGarzon` aplica al tipo congelado en `venta_propina` para origen y al tipo
  congelado en `liquidacion_propinas_participante` para asignación.
- Los nombres actuales de garzón y turno se usan solo como etiquetas. Los IDs y
  tipos congelados gobiernan los cálculos.

## Arquitectura

### Backend

Agregar dentro de `PropinasModule`:

- `PropinaReportesController`
- `PropinaReportesService`
- `QueryPropinaReporteDto`
- tests unitarios del service

No se crean entidades ni tablas.

El service ejecuta consultas agregadas SQL parametrizadas. Cada consulta:

- recibe `tenantId` desde el JWT, nunca desde query/body;
- filtra `eliminado_el IS NULL` en todas las tablas participantes;
- usa `COALESCE` para retornar `"0"` y no `null`;
- mapea `snake_case` a contratos `camelCase`;
- devuelve strings para montos, horas, ventas base, cuentas y tasas;
- no convierte montos con `Number`.

Los dos endpoints son independientes para que cada tab cargue solo lo que usa:

```http
GET /propinas/reportes/resumen
GET /propinas/reportes/trabajadores
```

Ambos usan `JwtAuthGuard`, `TenantGuard`, `PermisosGuard` y
`@RequiresPermiso('Propinas', 'Leer')`.

### DTO de filtros

Query común:

```text
desde       YYYY-MM-DD requerido, inclusivo
hasta       YYYY-MM-DD requerido, exclusivo
turnoIds    UUID separados por coma, opcional
tipoGarzon  garzon | cocina | barra, opcional
```

El DTO transforma `turnoIds` a `string[]`, valida cada UUID, elimina duplicados
y limita la lista a 50. Un rango inválido devuelve `400 Bad Request` con mensaje
en español.

## Contratos API

### Resumen

`GET /propinas/reportes/resumen` devuelve:

```json
{
  "periodo": {
    "desde": "2026-07-01",
    "hasta": "2026-08-01"
  },
  "cobranza": {
    "cierres": 120,
    "conPropina": 96,
    "sinPropina": 24,
    "sugerenciaAceptada": 78,
    "montoCobrado": "840000.0000",
    "montoSugerido": "900000.0000",
    "promedioConPropina": "8750.0000",
    "tasaConPropina": "0.800000",
    "tasaSugerenciaAceptada": "0.812500"
  },
  "estadoActual": {
    "pendienteLibreCantidad": 10,
    "pendienteLibreMonto": "80000.0000",
    "enBorradorCantidad": 6,
    "enBorradorMonto": "50000.0000",
    "liquidadaCantidad": 80,
    "liquidadaMonto": "710000.0000"
  },
  "anulaciones": {
    "liquidaciones": 1,
    "montoLiberadoHistorico": "40000.0000"
  },
  "tendencia": [
    {
      "fecha": "2026-07-01",
      "cierres": 8,
      "conPropina": 6,
      "montoCobrado": "51000.0000"
    }
  ],
  "porTurno": [
    {
      "turnoId": "uuid",
      "turnoNombre": "Cena",
      "cierres": 60,
      "conPropina": 50,
      "montoCobrado": "430000.0000"
    }
  ],
  "porTipo": [
    {
      "tipoGarzon": "garzon",
      "cierres": 120,
      "conPropina": 96,
      "montoCobrado": "840000.0000"
    }
  ],
  "advertencias": {
    "liquidacionesParcialmenteSolapadas": 0
  }
}
```

La tendencia incluye todos los días del rango, incluso días sin actividad, con
valores cero. La fecha se agrupa en la zona horaria del país/tenant, no en UTC.

### Por trabajador

`GET /propinas/reportes/trabajadores` devuelve:

```json
{
  "data": [
    {
      "garzonId": "uuid",
      "nombre": "Camila",
      "tipoGarzon": "garzon",
      "origen": {
        "cierres": 30,
        "conPropina": 25,
        "monto": "220000.0000"
      },
      "asignacionConfirmada": {
        "monto": "180000.0000",
        "horas": "80.0000",
        "ventasBase": "2200000.0000",
        "cuentas": "34.0000",
        "liquidaciones": 3,
        "ultimaLiquidacionEl": "2026-07-31T18:30:00.000Z"
      }
    }
  ],
  "totales": {
    "trabajadores": 8,
    "montoOriginado": "840000.0000",
    "montoAsignado": "840000.0000",
    "horas": "520.0000",
    "ventasBase": "7100000.0000",
    "cuentas": "120.0000"
  },
  "advertencias": {
    "liquidacionesParcialmenteSolapadas": 0,
    "liquidacionesTodosLosTurnosExcluidas": 0
  }
}
```

La lista incluye la unión de trabajadores que originaron propina o fueron
participantes incluidos. El join de etiqueta permite leer `garzones` con
soft-delete para conservar el último nombre almacenado; el nombre no está
congelado históricamente en los snapshots. Si no hay nombre resoluble, se
muestra `"Trabajador eliminado"`.

Orden por defecto: `asignacionConfirmada.monto DESC`, luego `nombre ASC`.
No se pagina en F v1 porque el catálogo de trabajadores por tenant es acotado.

## Frontend

### Navegación y página

- Nuevo item **Reportes de propinas** bajo el módulo Propinas en el sidebar.
- Visible para admin o `Propinas:Leer`.
- Ruta suelta `/propinas/reportes` con `UDashboardPanel` y
  `AppNavbar title="Reportes de propinas"`.
- `usePropinaReportes` centraliza contratos y llamadas con `useApiFetch`.

### Filtros

Una barra compartida sobre los tabs:

- Desde y hasta con `AppDateInput`.
- Turnos con `USelectMenu multiple`.
- Tipo con `USelect`.
- Botón **Aplicar**; no consulta en cada tecla/cambio.
- Preset inicial: últimos 30 días, `hasta` exclusivo al inicio del día siguiente.
- Los filtros se reflejan en query params para recargar o compartir la vista.

Cambiar de tab conserva filtros. Cada tab cachea su última respuesta por la
combinación de filtros durante la sesión de la página; **Aplicar** invalida ambas
y carga solo el tab activo.

### Tab Resumen

- Fila de KPIs con monto cobrado, pendiente total
  (`pendiente libre + en borrador`), liquidado y tasa con propina.
- Segundo bloque con aceptación sugerida, promedio y anulaciones históricas.
- Tendencia diaria con barras CSS simples y accesibles; no se agrega una librería
  de gráficos.
- Dos tablas compactas: por turno y por tipo.
- Tooltips/copy explican que anulaciones son históricas y no se suman al estado
  actual.

### Tab Por trabajador

- `CrudTable`/`UTable` con trabajador, tipo, originado, asignado, horas, ventas
  base, cuentas, liquidaciones y última confirmación.
- Cabecera de la tabla muestra totales.
- Montos con `formatMonto`, fechas con `formatFecha`, porcentajes con
  `formatPorcentaje`.
- En móvil, las métricas secundarias se agrupan en el subtítulo del trabajador
  y se priorizan originado/asignado.

### Estados de UI

- Loading independiente por tab.
- Error persistente con `UAlert` y acción **Reintentar**.
- Empty state del resumen: “No hay cierres con propina en este período”.
- Empty state por trabajador: “No hay actividad de trabajadores para estos
  filtros”.
- Advertencia `warning` si se excluyeron liquidaciones parcialmente solapadas o
  liquidaciones de todos los turnos al aplicar un filtro de turno.

## Flujo de datos

1. La página inicializa los últimos 30 días y carga turnos.
2. El usuario aplica filtros.
3. El composable serializa fechas calendario, turnos y tipo.
4. Se consulta únicamente el endpoint del tab activo.
5. El backend valida período y filtros, ejecuta agregados por tenant y retorna
   contratos ya normalizados.
6. El frontend formatea sin recalcular dinero ni reinterpretar estados.
7. Al cambiar de tab se usa caché si coincide la clave de filtros; si no, se
   consulta su endpoint.

## Rendimiento e índices

F v1 consulta en vivo. Se reutilizan índices existentes y se agregan solo si
`EXPLAIN` demuestra necesidad. Candidatos:

- `venta_propina (tenant_id, creado_el)` parcial por `eliminado_el IS NULL`.
- `liquidacion_propinas (tenant_id, estado, fecha_desde, fecha_hasta)` parcial.
- `liquidacion_propinas_participante (tenant_id, liquidacion_id, garzon_id)`
  parcial.
- `liquidacion_propinas_fuente (tenant_id, liquidacion_id, venta_propina_id)`
  parcial.

No se crean índices por adelantado sin capturar el plan de consulta en tests/QA.

## Errores y seguridad

- Sin tenant/JWT: reglas globales de auth.
- Sin `Propinas:Leer`: `403`.
- Fechas inválidas, rango invertido, rango mayor a 366 días, UUID/tipo inválido:
  `400` con mensaje accionable.
- Toda lectura incluye `tenant_id` del JWT y soft-delete.
- Los endpoints no aceptan `tenantId`.
- Ningún endpoint modifica datos.

## Testing

### Backend

- DTO acepta rango válido y rechaza faltantes, invertido o mayor a 366 días.
- Resumen distingue sin propina, pendiente libre, borrador y liquidada sin doble
  conteo.
- Anulación histórica no altera los totales del estado actual.
- Tasa de sugerencia usa como denominador solo cierres con propina.
- Tendencia rellena días sin actividad y respeta zona horaria.
- Filtros de turno y tipo.
- Asignación solo con liquidaciones confirmadas completamente contenidas.
- Participantes excluidos no suman.
- Filtro de turno excluye liquidaciones “todos los turnos” y reporta advertencia.
- Aislamiento tenant y soft delete en todas las consultas.
- Montos retornan strings, incluso ceros.

### Frontend

- Serialización de filtros y presets de fecha.
- Cache por tab + combinación de filtros.
- Aplicar invalida ambas caches y consulta solo tab activo.
- Render de KPIs, advertencias y empty/error states.
- Formateo de montos/fechas mediante `useFormatters`.

### Manual / E2E

1. Crear propinas sugeridas, manuales y sin propina en varios días/turnos.
2. Crear borrador con algunas fuentes; verificar pendiente libre vs borrador.
3. Confirmar otra liquidación; verificar liquidada y asignaciones.
4. Anular y luego reliquidar; verificar histórico de anulación separado.
5. Aplicar filtros por turno/tipo y revisar advertencias.
6. Confirmar que otro tenant no altera resultados.

## Documentación viva

Al implementar:

- Crear `docs/features/reportes-propinas.md`.
- Añadir enlace en `docs/README.md`.
- Marcar F en `docs/ESTADO.md`.
- Actualizar `docs/ARCHITECTURE.md` con service/controller/composable/página.
- Cambiar esta spec a `Status: Done`.

## Decisiones

- F incluye reportes de resumen y por trabajador en una sola página con tabs.
- Se reporta todo el ciclo, diferenciando estado actual de histórico anulado.
- Consultas en vivo y endpoints separados por tab.
- Sin nuevas tablas ni jobs.
- No se prorratean snapshots de liquidación.
- El período de cobranza usa fecha de tip; asignación usa liquidaciones
  completamente contenidas.
- Sin paginación de trabajadores en v1.
- Sin dependencias de gráficos en v1.
- Exportaciones y pago real quedan fuera de F.
