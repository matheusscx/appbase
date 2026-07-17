# Diseño: Liquidación de Propinas (subproyecto E)

**Status**: Approved — **E2 Done** (2026-07-17)
**Owner**: Cesar Matheus
**Date**: 2026-07-17

**Plan E1:** `docs/superpowers/plans/2026-07-17-liquidacion-propinas-e1.md` ✅
**Plan E2:** `docs/superpowers/plans/2026-07-17-liquidacion-propinas-e2.md` ✅
**Plan E3:** `docs/superpowers/plans/2026-07-17-liquidacion-propinas-e3.md` (In Progress)

---

## Contexto

Con **D** operativo, cada cierre de cuenta de mesa congela el hecho de propina en
`venta_propina` (cuánto se pagó, con qué % se sugirió, quién era el responsable)
y el split del dinero en `pago_aplicaciones`. Falta el paso siguiente: **repartir
ese dinero entre el personal** según reglas de negocio configurables.

Este diseño cubre el subproyecto **E** del requerimiento de gestión de garzones,
turnos y propinas. **F** (reportes agregados) queda fuera.

### Regla de negocio (distribución en dos niveles)

1. **Distribución por grupo:** el administrador define qué % del pool va a cada
   grupo de trabajo (Garzones, Cocina, Barra, …). La suma **siempre = 100%**.

   | Destino | % |
   |---|---|
   | Garzones | 80% |
   | Cocina | 20% |

2. **Reparto dentro del grupo:** cada grupo define su propio criterio (partes
   iguales, ventas, horas, cuentas, manual). Ej.: Garzones por ventas, Cocina en
   partes iguales.

## Alcance

Se entrega en **3 fases** incrementales, cada una con su propio plan de
implementación:

- **E1 — Modelo base:** tipo de garzón (CHECK); enriquecer `venta_propina` con
  `sesion_garzon_id` + `turno_id` + `tipo_garzon` + `liquidacion_id`; congelar
  `tipo_garzon` en sesiones; congelar dos bases de venta en `ventas`; FK
  compuesta sesión/turno; backfill.
- **E2 — Configuración de distribución:** raíz versionada + grupos por tipo
  (% + criterio + base + pesos MANUAL), CRUD y validación 100%.
- **E3 — Motor + UI de liquidación:** `liquidacion_propinas` con snapshot
  versionado, fuentes de tip, borrador editable, cálculo por criterio (incl.
  MANUAL pesos vs montos), confirmar (inmutable) y anular con concurrencia segura.

Incluido en E (global):

- Liquidación **por período** (rango obligatorio + turnos opcionales), no por turno fijo.
- Snapshot de configuración al crear; "actualizar desde config vigente" con diff en borrador.
- Participantes sugeridos automáticamente y editables en borrador; auditoría de cambios.
- Horas por **intersección** sesión ∩ período (una sesión puede aportar a varias
  liquidaciones de períodos distintos, solo con su intersección).
- Cada propina pertenece a **una sola** liquidación confirmada
  (`venta_propina.liquidacion_id`).
- Tras confirmar: snapshot, participantes y montos **inmutables**; solo anulación
  libera tips para una nueva liquidación.

Fuera de alcance:

- Reportes agregados (F).
- Sucursales / multi-bodega (no existen en el modelo).
- Pago/egreso real del dinero al empleado (la liquidación calcula; no mueve caja ni banca).
- Integración con nómina / remuneraciones.
- Propina en POS genérico u online (E reparte solo lo registrado en cierre de mesa).
- Nota de crédito / anulación de venta con tip ya liquidado (se aborda si aparece el caso).
- Catálogo configurable de tipos por tenant (v1: set fijo con CHECK; ampliar después).

## Decisiones

| Tema | Decisión |
|---|---|
| Miembros de grupos | Un solo catálogo `garzones` con `tipo`; el grupo sale del tipo |
| Valores de `tipo` | Enum TS + `CHECK` en BD (`garzon` \| `cocina` \| `barra`); **no** ENUM nativo PG |
| Membresía de grupo | Grupo = tipo del garzón (no grupos libres) |
| Congelar tipo | En `sesiones_garzon` al iniciar; en `venta_propina` al tip; en participante al snapshot |
| Unidad de liquidación | Período configurable (rango obligatorio + turnos opcionales) |
| Qué entra al pool | Tips del período/turno con `liquidacion_id IS NULL`; tip $0 no suma |
| Turno del tip | Congelar `sesion_garzon_id` + `turno_id`; integridad vía FK compuesta |
| Base criterio VENTAS | Ventas netas del período; **no** propina aportada |
| Bases de venta | Congelar ambas en `ventas`; grupo elige; default `TOTAL_FINAL` |
| Criterios | `VENTAS_NETAS`, `HORAS_TRABAJADAS`, `PARTES_IGUALES`, `CANTIDAD_CUENTAS`, `MANUAL` |
| Criterio MANUAL | Modo `PESOS` **o** `MONTOS` (excluyentes); no mezclar |
| Participantes | Sugerencia auto + lista editable; `motivo_ajuste` obligatorio en cambios manuales |
| Config vs liquidación | Raíz versionada; snapshot + `configuracion_version` en liquidación |
| Horas al cruzar límite | Intersección sesión ∩ período; abiertas advierten, no bloquean |
| Sesión multi-liquidación | Permitido: misma sesión aporta horas a N liquidaciones vía intersección |
| Ciclo de vida | `borrador → confirmada → (anulada)`; confirmada es inmutable |
| Concurrencia | TX con `FOR UPDATE` al confirmar/anular; tip solo a una liquidación |
| Fuentes en borrador | Tabla `liquidacion_propinas_fuente` congela qué tips entran al pool |
| Aritmética | Decimal.js; % decimal; reparto en unidades mínimas de la moneda oficial (`moneda.decimales`) vía **mayores restos** |
| Errores operativos | `400 Bad Request` |

---

## E1 — Modelo base

Objetivo: dejar los datos congelados para liquidar sin construir el motor.

### Tipos de trabajador

```ts
enum TipoGarzon {
  GARZON = 'garzon',
  COCINA = 'cocina',
  BARRA = 'barra',
}
```

En BD: columna `text` + `CHECK (tipo IN ('garzon', 'cocina', 'barra'))`.
**No** usar `CREATE TYPE` ENUM de PostgreSQL (migraciones de valores más
costosas). Si en el futuro los tipos son configurables por tenant → catálogo
propio; hasta entonces el CHECK basta.

### `garzones` (extensión)

| Columna | Tipo | Notas |
|---|---|---|
| `tipo` | text NOT NULL DEFAULT `'garzon'` | CHECK valores de `TipoGarzon` |

- El `tipo` vigente determina el grupo de config (E2) y la sugerencia de
  participantes.
- Backfill: todos los existentes → `'garzon'`.

### `sesiones_garzon` (extensión)

| Columna | Tipo | Notas |
|---|---|---|
| `tipo_garzon` | text NOT NULL | snapshot del `garzones.tipo` al **iniciar** la sesión |

- Congelar al `iniciar`: un cambio posterior de rol (Garzón → Cocina) **no**
  reclasifica horas históricas.
- Índice único de soporte para FK compuesta (ver abajo):
  `UNIQUE (tenant_id, sesion_garzon_id, turno_id)` (o equivalente con PK ya
  existente + columnas denormalizadas garantizadas).

### `venta_propina` (extensión)

| Columna | Tipo | Notas |
|---|---|---|
| `sesion_garzon_id` | UUID nullable | FK → `sesiones_garzon` |
| `turno_id` | UUID nullable | denormalizado desde la sesión |
| `tipo_garzon` | text nullable | snapshot del tipo del responsable al tip |
| `liquidacion_id` | UUID nullable | FK → `liquidacion_propinas`; NULL = no liquidada |

**Consistencia sesión ↔ turno (obligatoria):**

No basta un CHECK local: se necesita FK compuesta para que, si existe sesión,
el `turno_id` sea exactamente el de esa sesión (y del mismo tenant):

```
sesiones_garzon: UNIQUE (tenant_id, sesion_garzon_id, turno_id)

venta_propina: FK (tenant_id, sesion_garzon_id, turno_id)
  → sesiones_garzon (tenant_id, sesion_garzon_id, turno_id)
```

Reglas de escritura:

- Si hay sesión activa al cerrar: setear los tres
  (`sesion_garzon_id`, `turno_id`, `tipo_garzon` desde snapshot de sesión o
  garzón vigente al tip).
- Si `sesion_garzon_id` es NULL (solo backfill legacy): `turno_id` y
  `tipo_garzon` también NULL.
- Prohibido: sesión presente y turno distinto al de la sesión.

Al cerrar mesa (flujo normal D): buscar sesión activa del responsable y
congelar. Backfill: resolver por `garzon_id` + intersección con fecha de
cierre; si no resuelve → NULL (no filtrable por turno; documentado).

Índices: (`tenant_id`, `liquidacion_id`); (`tenant_id`, `turno_id`, `creado_el`).

### `ventas` (extensión) — bases congeladas

| Columna | Tipo | Notas |
|---|---|---|
| `base_ventas_total_final` | numeric(18,4) | = `total_final` (sin propina, con impuestos) |
| `base_ventas_sin_impuestos` | numeric(18,4) | neto comercial antes de IVA |

- Se calculan y persisten al cerrar la venta (una vez).
- `base_ventas_sin_impuestos = total_bruto − total_descuentos + total_recargos`
  (equivale a `total_final − total_impuestos`).
- Backfill: `base_ventas_total_final = total_final`;
  `base_ventas_sin_impuestos = total_final − total_impuestos`.

---

## E2 — Configuración de distribución

Configuración vigente por tenant, **versionada**. La liquidación (E3) copia un
snapshot y guarda el número de versión de origen.

### `propina_configuracion` (nueva — raíz)

| Columna | Tipo | Notas |
|---|---|---|
| `propina_configuracion_id` | UUID PK | |
| `tenant_id` | UUID UNIQUE | una raíz vigente por tenant |
| `version` | int NOT NULL DEFAULT 1 | se incrementa en cada `PUT` exitoso |
| `actualizado_por` / `actualizado_el` | | |
| `creado_el` / `eliminado_el` | timestamptz | soft delete |

### `propina_grupo_distribucion` (nueva)

| Columna | Tipo | Notas |
|---|---|---|
| `propina_grupo_distribucion_id` | UUID PK | |
| `tenant_id` | UUID | del JWT |
| `configuracion_id` | UUID | FK → `propina_configuracion` |
| `tipo_garzon` | text | CHECK `TipoGarzon`; único activo por tenant |
| `nombre` | text | etiqueta UI, ej. "Garzones" |
| `porcentaje` | numeric(10,6) | decimal; `0.80` = 80% |
| `criterio` | text | CHECK: criterios listados abajo |
| `base_ventas` | text | `TOTAL_FINAL` \| `BASE_SIN_IMPUESTOS`; default `TOTAL_FINAL`; solo si `VENTAS_NETAS` |
| `manual_modo` | text nullable | `PESOS` \| `MONTOS`; obligatorio si `criterio = MANUAL` |
| `activo` | boolean | default true |
| `orden` | int | orden de presentación |
| `creado_el` / `actualizado_el` / `eliminado_el` | timestamptz | soft delete |

### `propina_grupo_peso_manual` (nueva)

| Columna | Tipo | Notas |
|---|---|---|
| `propina_grupo_peso_manual_id` | UUID PK | |
| `tenant_id` | UUID | |
| `grupo_id` | UUID | FK → `propina_grupo_distribucion` |
| `garzon_id` | UUID | FK → `garzones` |
| `peso` | numeric(18,4) | relativo (ej. 2 / 1); solo aplica si `manual_modo = PESOS` |
| `creado_el` / `actualizado_el` / `eliminado_el` | timestamptz | soft delete |

### Reglas

- Σ `porcentaje` de grupos activos del tenant = **`1.0000`** (validación al guardar).
- Un `tipo_garzon` en, como máximo, un grupo activo.
- Cada `PUT /propinas/distribucion` exitoso: `version = version + 1`.
- Seed default: raíz v1 + un grupo `garzon` al 100%, criterio `PARTES_IGUALES`.
- % siempre en decimal (`0.20`, nunca `20`).

### Criterio MANUAL (documentación explícita)

Dos modos **excluyentes** por grupo:

| Modo | Comportamiento |
|---|---|
| `PESOS` | Cada participante tiene un peso relativo (config o override en borrador). El motor reparte `monto_grupo` proporcional a los pesos. |
| `MONTOS` | El admin ingresa montos absolutos por participante. **Los pesos no se aplican.** Validación: Σ montos de incluidos = `monto_grupo` exacto (en escala de la moneda). |

No se permite mezclar pesos y montos en el mismo grupo/liquidación. Cambiar de
modo en borrador invalida el otro conjunto de valores y fuerza recalcular /
re-capturar.

### API (borrador)

- `GET /propinas/distribucion` — config vigente (versión + grupos + pesos).
- `PUT /propinas/distribucion` — reemplazo transaccional; valida 100%; incrementa `version`.
- Permiso: `Propinas:Configurar`.

---

## E3 — Motor y UI de liquidación

### `liquidacion_propinas` (nueva)

| Columna | Tipo | Notas |
|---|---|---|
| `liquidacion_propinas_id` | UUID PK | |
| `tenant_id` | UUID | |
| `fecha_desde` / `fecha_hasta` | timestamptz | obligatorios |
| `turno_ids` | uuid[] | opcional; vacío = todos |
| `estado` | text | `borrador` \| `confirmada` \| `anulada` |
| `pool_total` | numeric(18,4) | Σ `monto_pagado` de tips en fuentes |
| `configuracion_version` | int | versión de config al crear / última actualización de snapshot |
| `moneda_id` | UUID | moneda oficial del tenant al crear (para `decimales`) |
| `decimales_moneda` | smallint | snapshot de `moneda.decimales` |
| `creado_por` / `creado_el` | | |
| `confirmado_por` / `confirmado_el` | nullable | |
| `anulado_por` / `anulado_el` / `motivo_anulacion` | nullable | |
| `actualizado_el` / `eliminado_el` | timestamptz | soft delete |

### `liquidacion_propinas_grupo` (nueva — snapshot de config)

| Columna | Tipo | Notas |
|---|---|---|
| `liquidacion_propinas_grupo_id` | UUID PK | |
| `liquidacion_id` | UUID | FK |
| `tipo_garzon` / `nombre` / `porcentaje` / `criterio` / `base_ventas` / `manual_modo` | | copia congelada |
| `monto_grupo` | numeric(18,4) | `pool_total × porcentaje` (luego ajustado a escala moneda) |

### `liquidacion_propinas_participante` (nueva)

| Columna | Tipo | Notas |
|---|---|---|
| `liquidacion_propinas_participante_id` | UUID PK | |
| `liquidacion_id` / `grupo_id` | UUID | FK |
| `garzon_id` | UUID | FK |
| `tipo_garzon` | text | snapshot al crear/incluir (no leer rol vigente) |
| `incluido` | boolean | admin puede excluir |
| `origen` | text | `sugerido` \| `agregado_manual` |
| `motivo_ajuste` | text nullable | **obligatorio** si `origen = agregado_manual` o si se excluye un sugerido |
| `horas` / `ventas_base` / `cuentas` | numeric | métricas usadas (0 si no aplica) |
| `peso_manual` | numeric nullable | solo si MANUAL + `PESOS` |
| `monto` | numeric(18,4) | resultado (o capturado si MANUAL + `MONTOS`) |
| `ajuste_motivo_monto` | text nullable | si override de monto en modo MONTOS / ajuste puntual |

### `liquidacion_propinas_fuente` (nueva — tips del pool)

Congela qué propinas entran al borrador (evita que dos borradores “compitan”
sin trazabilidad y permite recalcular el pool de forma estable):

| Columna | Tipo | Notas |
|---|---|---|
| `liquidacion_propinas_fuente_id` | UUID PK | |
| `liquidacion_id` | UUID | FK |
| `venta_propina_id` | UUID | FK |
| `monto_pagado` | numeric(18,4) | snapshot del tip al incluirlo |
| UNIQUE (`liquidacion_id`, `venta_propina_id`) | | |

Nota: la **reserva exclusiva** del tip ocurre al **confirmar**
(`venta_propina.liquidacion_id`). Dos borradores pueden listar el mismo tip;
solo uno podrá confirmarlo.

### `liquidacion_propinas_evento` (nueva — auditoría)

| Columna | Tipo | Notas |
|---|---|---|
| `liquidacion_propinas_evento_id` | UUID PK | |
| `liquidacion_id` | UUID | FK |
| `tipo` | text | `creada` \| `participante_agregado` \| `participante_excluido` \| `recalculada` \| `config_actualizada` \| `confirmada` \| `anulada` |
| `payload` | jsonb | antes/después + motivos |
| `usuario_id` / `creado_el` | | |

### Flujo

1. **Crear borrador:** filtros (rango + turnos) → tips elegibles
   (`liquidacion_id IS NULL` ∧ período ∧ turno ∧ `monto_pagado > 0`) → filas en
   `fuente` → `pool_total` → snapshot de config + `configuracion_version` →
   sugerir participantes (por `tipo_garzon` congelado en sesión/participante) →
   calcular montos.
2. **Editar en borrador:** agregar/excluir (con `motivo_ajuste`), override
   MANUAL según modo, recalcular, "actualizar desde config vigente" (mostrar
   diff de %, criterios, modo, pesos; al aplicar: nuevo snapshot +
   `configuracion_version` actual). Cada cambio → evento.
3. **Confirmar** (TX, ver concurrencia): asigna `venta_propina.liquidacion_id`,
   estado `confirmada`. A partir de aquí: **inmutable** (sin UPDATE de grupos,
   participantes, montos, fuentes ni snapshot; sin soft-delete de detalle).
4. **Anular** (solo `confirmada`, TX): libera tips
   `WHERE liquidacion_id = :estaLiquidacion`, estado `anulada` + motivo;
   no borra filas. Las propinas quedan libres para una **nueva** liquidación.

### Inmutabilidad post-confirmación (explícita)

Tras `confirmada`:

- Config snapshot, participantes, métricas, montos y fuentes **no se modifican**.
- No hay “reabrir”, “editar” ni “recalcular”.
- Única transición: `confirmada → anulada`.
- Anular **no** reescribe el histórico de la liquidación anulada; solo libera
  tips y deja rastro (`anulado_*`, evento). Para corregir: nueva liquidación
  sobre el mismo (o distinto) período.

### Concurrencia (confirmar / anular)

**Confirmar** (todo en una TX):

1. `SELECT … FOR UPDATE` de la liquidación; exigir `estado = borrador`.
2. `SELECT … FOR UPDATE` de las `venta_propina` referenciadas en `fuente`.
3. `UPDATE venta_propina SET liquidacion_id = :id
    WHERE venta_propina_id = ANY(:ids) AND liquidacion_id IS NULL`.
4. Si `rowCount ≠ |fuentes|` → rollback + `400` (“una o más propinas ya fueron
   liquidadas por otra corrida”).
5. Marcar `confirmada` + `confirmado_*` + evento.

**Anular:**

1. `FOR UPDATE` liquidación; exigir `confirmada`.
2. `UPDATE venta_propina SET liquidacion_id = NULL
    WHERE liquidacion_id = :id` (nunca liberar tips de otra liquidación).
3. Marcar `anulada` + motivo + evento.

### Horas y sesiones multi-liquidación

- Horas = Σ **intersección** `[inicio_sesión, fin_sesión_o_ahora]` ∩
  `[fecha_desde, fecha_hasta]` de la liquidación.
- Una sesión que cruza medianoche (o el límite del período) **se prorratea**.
- La **misma sesión puede aportar horas a varias liquidaciones** si los períodos
  son distintos (ej. liquidación día 17 y día 18); en cada una solo cuenta la
  intersección correspondiente. **No** hay doble conteo dentro de una misma
  liquidación.
- Sesiones abiertas: no bloquean; advertencia visible al admin.

### Cálculo por grupo

1. `monto_grupo = pool_total × porcentaje` (luego expresado en escala de
   `decimales_moneda`).
2. Participantes `incluido = true` del grupo (clasificados por
   `participante.tipo_garzon` del snapshot).
3. Pesos / montos según criterio:
   - `PARTES_IGUALES`: peso 1 c/u.
   - `VENTAS_NETAS`: suma de `base_ventas_*` elegida de ventas donde fue
     responsable en el período (y turno si aplica).
   - `HORAS_TRABAJADAS`: horas por intersección (arriba).
   - `CANTIDAD_CUENTAS`: # cuentas cerradas como responsable.
   - `MANUAL` + `PESOS`: `peso_manual`.
   - `MANUAL` + `MONTOS`: montos capturados; **no** se usan pesos; validar
     Σ = `monto_grupo`.
4. Reparto (excepto `MONTOS` ya fijados): algoritmo de **mayores restos** (ver
   sección siguiente).
5. Tips `monto_pagado = 0`: no entran a `fuente` / pool.

### Estrategia de redondeo (mayores restos)

No fijar “0 decimales” en código: usar `decimales_moneda` congelados en la
liquidación (Chile CLP → 0; otras monedas → N). Trabajar en **unidades mínimas**
(enteros):

```
factor = 10 ^ decimales_moneda
montoGrupoUnidades = round_half_up(monto_grupo × factor)   // entero
```

Para cada participante i con peso `w_i` (Σw > 0):

```
cuotaExacta_i = montoGrupoUnidades × (w_i / Σw)
base_i        = floor(cuotaExacta_i)
resto_i       = cuotaExacta_i − base_i
```

Asignar `R = montoGrupoUnidades − Σ base_i` unidades sobrantes a los R
participantes con mayor `resto_i` (desempate estable: `garzon_id` ASC).

```
monto_i = (base_i + extra_i) / factor
```

**Invariante:** `Σ monto_i = monto_grupo` (en la escala de la moneda).

Ejemplo (CLP, `decimales = 0`): grupo $100.001; pesos Pedro 1, Juan 1, María 1.

| Persona | Cuota exacta | Floor | Resto | Extra | Final |
|---|---|---|---|---|---|
| Juan | 33333.666… | 33333 | 0.666… | +1 | 33334 |
| María | 33333.666… | 33333 | 0.666… | +1 | 33334 |
| Pedro | 33333.666… | 33333 | 0.666… | 0 | 33333 |

(Desempate por `garzon_id`: aquí Juan y María reciben el +1; Σ = 100.001.)

Si se usara “half-up + residuo al mayor peso”, el último podría absorber un
sesgo sistemático o un residuo negativo; mayores restos evita ambos.

### API (borrador)

- `POST /propinas/liquidaciones` — crea borrador con filtros.
- `GET /propinas/liquidaciones` / `GET /:id` — listar / detalle.
- `PATCH /propinas/liquidaciones/:id` — editar participantes / pesos / montos /
  recalcular (solo `borrador`).
- `POST /:id/actualizar-config` — trae snapshot vigente (con diff + nueva `version`).
- `POST /:id/confirmar` — confirma (inmutable).
- `POST /:id/anular` — anula (libera tips de esta liquidación).
- Permisos: `Propinas:Leer`, `Propinas:Liquidar`.

### RBAC

Nuevo módulo `Propinas` con acciones `Leer`, `Liquidar`, `Configurar`. Guard por
ruta (enforcement backend real), como el resto del sistema.

### UI

- Lista de liquidaciones + crear (rango/turnos).
- Detalle borrador: pool, versión de config, grupos, participantes, advertencias
  (sesiones abiertas), acciones (recalcular, actualizar config, confirmar).
- Confirmada: solo lectura + anular.
- Configuración de distribución (E2): grupos, %, criterio, base, modo MANUAL,
  pesos.

---

## Testing

### Backend

- CHECK / validación de `TipoGarzon`.
- FK compuesta: rechazo de `turno_id` ≠ sesión.
- Snapshot de `tipo_garzon` en sesión / tip / participante; cambio de rol no
  reclasifica histórico.
- Validación Σ% = 100; incremento de `configuracion.version`.
- Snapshot: cambiar config no altera liquidación confirmada.
- Elegibilidad de tips + tabla `fuente`.
- Cálculo por cada criterio; MANUAL `PESOS` vs `MONTOS` (no mezclar; Σ montos).
- Mayores restos: Σ montos = `monto_grupo`; ejemplo CLP y moneda con decimales > 0.
- Confirmar concurrente: segunda TX falla si tips ya tomados.
- Anular solo libera `liquidacion_id = :esta`.
- Intersección sesión ∩ período; misma sesión en dos liquidaciones de períodos
  distintos sin doble conteo interno.
- Post-confirmación: mutaciones de detalle → 400.

### Frontend

- Crear borrador, editar participantes con motivo, recalcular.
- Diff "actualizar desde config" mostrando versión.
- Advertencia de sesiones abiertas.
- UI MANUAL: modo pesos vs montos.

### Manual

1. Config 80/20 (garzones ventas, cocina partes iguales); liquidar día.
2. Liquidación semanal con turnos filtrados.
3. Sesión que cruza medianoche → prorrateo; dos liquidaciones diarias consecutivas.
4. Confirmar y luego anular; verificar tips liberados y liquidación inmutable.
5. Dos borradores con tips solapados; confirmar uno → el otro falla al confirmar.

## Compatibilidad y migración

- `startup-pos.sql`:
  - ALTER `garzones` (+`tipo` + CHECK)
  - ALTER `sesiones_garzon` (+`tipo_garzon` + UNIQUE soporte FK)
  - ALTER `venta_propina` (+`sesion_garzon_id`, `turno_id`, `tipo_garzon`,
    `liquidacion_id` + FK compuesta)
  - ALTER `ventas` (+bases)
  - CREATE `propina_configuracion`, `propina_grupo_distribucion`,
    `propina_grupo_peso_manual`, `liquidacion_propinas`,
    `liquidacion_propinas_grupo`, `liquidacion_propinas_participante`,
    `liquidacion_propinas_fuente`, `liquidacion_propinas_evento`
  - backfills
- Entities TypeORM con `type: 'uuid'` en PKs/FKs (ADR-004).
- Soft delete en tablas nuevas (detalle de liquidación confirmada: soft delete
  operativo deshabilitado por regla de negocio / servicio).
- Seed: `propina_configuracion` v1 + grupo default `garzon` 100% `PARTES_IGUALES`
  por tenant.

## Relación con F

E confirma **cuánto** recibió cada persona por período (participantes + montos
congelados + versión de config). F agregará consultas de reporte (por garzón,
grupo, turno, período, medio de pago) leyendo `liquidacion_propinas_*` +
`venta_propina`, sin migrar columnas de pagos.
