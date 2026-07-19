# Catálogo de impuestos del sistema y clasificación tributaria — Diseño

- **Status:** Approved
- **Date:** 2026-07-19
- **Owner:** Cesar Matheus

## Contexto

Hoy los impuestos son un CRUD por tenant (`impuestos.tenant_id NOT NULL`) y cada
tenant chileno crea su propio "IVA 19%": duplicación de impuestos oficiales y cero
estandarización por país (el seeder mismo siembra un IVA por tenant). Además no
existe clasificación tributaria explícita en los items: "exento" hoy sería la
ausencia de impuestos, lo que ADR-010 prohíbe ("Exento es un estado explícito").

Este diseño introduce: (1) un catálogo de impuestos del sistema por país,
compartido por todos los tenants de ese país; (2) la coexistencia con impuestos
personalizados por tenant; (3) la clasificación tributaria `afecto | exento` en
items, congelada por línea al vender.

### Semántica de "exento" (verificada en normativa chilena)

En el DL 825 las exenciones (arts. 12 y 13) son exenciones **del IVA**; los
impuestos adicionales (Título III: ILA, analcohólicos, suntuarios) son tributos
distintos. El formato DTE del SII lo refleja estructuralmente: `IndExe` marca la
línea como exenta de IVA, mientras los impuestos adicionales van por línea con
`CodImpAdic` y se totalizan en `ImptoReten`. Una línea puede ser exenta de IVA y
llevar impuesto adicional.

**Regla adoptada:** `exento` suprime únicamente los impuestos `tipo = 'iva'` de la
línea; los `tipo = 'otro'` se aplican siempre.

## Decisiones tomadas (con el usuario)

1. **Alcance de la clasificación:** todos los tipos de item (producto, servicio,
   suscripción, receta) — columna en la tabla base `items`.
2. **Administración del catálogo del sistema:** solo seeder (sin CRUD superadmin,
   YAGNI). Incorporar un país = agregar su catálogo al seed.
3. **Exento y motor de precios:** exento suprime los impuestos tipo `iva` de la
   línea; los demás aplican normal.
4. **Compatibilidad:** remapeo automático e idempotente en el seeder de los IVA
   duplicados por tenant hacia el impuesto del sistema.
5. **Modelado BD:** enfoque "misma tabla": `impuestos.tenant_id` nullable +
   `pais_id` nullable con CHECK de exclusividad (vs. tabla separada con doble FK,
   o copia-por-referencia que perpetúa duplicados).

## Modelo de datos

### `impuestos`

| Cambio | Detalle |
|---|---|
| `tenant_id` | pasa a **nullable** (`type: 'uuid'`) |
| `pais_id` | **nueva**, `UUID` nullable, FK a `pais` (`type: 'uuid'`) |
| `tipo` | **nueva**, `TEXT NOT NULL DEFAULT 'otro'`, valores `'iva' \| 'otro'` |
| CHECK | exactamente uno de `tenant_id` / `pais_id` es no-nulo |

- **Sistema:** `(tenant_id NULL, pais_id set)` — p.ej. IVA Chile `tipo 'iva'`, `0.19`.
- **Personalizado:** `(tenant_id set, pais_id NULL)`.
- Inmutabilidad para tenants: todas las mutaciones del service filtran
  `WHERE tenant_id = :tenantId`; las filas del sistema (`tenant_id NULL`) nunca
  matchean. No se necesita guard adicional.

### `items`

- `clasificacion_tributaria TEXT NOT NULL DEFAULT 'afecto'`, valores
  `'afecto' | 'exento'`, en la tabla **base** (todos los tipos de item).
- Items existentes quedan `afecto` por el default.

### `venta_detalles`

- `clasificacion_tributaria TEXT NOT NULL DEFAULT 'afecto'` — snapshot congelado
  al crear la venta (equivalente conceptual del `IndExe` por línea del DTE).
- Ventas históricas quedan `afecto` (fiel a lo que se les calculó).

Sin cambios en `item_impuestos` ni `ventas_impuestos` (FKs intactas).
`startup-pos.sql` se actualiza como referencia del esquema.

## Backend

### `ImpuestosService`

- `findAll(tenantId)`: resuelve el país del tenant
  (`tenants.provincia_id → provincia.pais_id`) y devuelve
  `WHERE (tenant_id = :t OR pais_id = :pais) AND eliminado_el IS NULL`, cada fila
  con `origen: 'sistema' | 'personalizado'` derivado, más `tipo`.
- `create`/`update`: aceptan `tipo` opcional (`'iva' | 'otro'`, default `'otro'`)
  en los DTOs — un tenant de un país sin catálogo sembrado puede marcar su propio
  IVA. Validación con `class-validator` (`@IsIn`).
- `remove`/`update`: sin cambios de lógica (el filtro por tenant ya protege las
  filas del sistema; devuelven 404 si se intenta).

### Motor de precios (`CalculoPreciosService`)

- El mapa de impuestos incluye los del sistema automáticamente vía `findAll`.
- Cada línea lleva la `clasificacion_tributaria` del item; si es `'exento'`, se
  filtran los impuestos `tipo === 'iva'` de esa línea antes del paso de impuestos.
  Los `tipo === 'otro'` se aplican siempre. Aritmética con Decimal.js como hoy.

### `VentasService`

- Al persistir el detalle, copia `clasificacion_tributaria` del item al
  `venta_detalle` (congelamiento). `ventas_impuestos` no cambia de forma.

### Seeder (`seeder.service.ts`)

1. **Catálogo del sistema:** sembrar `IVA` de Chile con ID fijo nuevo del patrón
   `550e8400-e29b-41d4-a716-446655440XXX` (siguiente libre), `pais_id` Chile,
   `tipo 'iva'`, `porcentaje '0.19'`.
2. **Remapeo idempotente de duplicados:** impuestos con `tenant_id` cuyo
   `porcentaje` coincide con el IVA oficial del país del tenant y cuyo `nombre`
   contiene "IVA" (case-insensitive) →
   remapear `item_impuestos.impuesto_id` al del sistema (`ON CONFLICT DO NOTHING`
   + borrar la fila vieja del join) y soft-deletear el impuesto duplicado.
   Correr el seed dos veces no produce cambios nuevos.
3. **Seed actual:** eliminar los "IVA 19%" por tenant (`…440112`, `…440113`) del
   seed; sus referencias (item_impuestos del seed y cualquier otra) pasan al ID
   del sistema. En BDs ya sembradas, el paso 2 los remapea.
4. **Ventas históricas:** `ventas_impuestos.impuesto_id` apuntando a un impuesto
   soft-deleteado **no se toca** — el snapshot ya congeló porcentaje y valor, y la
   fila sigue existiendo (soft delete).

## Frontend

### `configuracion/impuestos.vue`

- Lista = unión con badge de origen: **Sistema** / **Personalizado**.
- Filas del sistema: solo lectura (sin editar, eliminar ni toggle de activo).
- Form de personalizado: nuevo campo `tipo` (select "IVA" / "Otro", default
  "Otro") con ayuda contextual: los impuestos tipo IVA no se aplican a items
  exentos.

### `configuracion/items.vue`

- Selector múltiple de impuestos: lista unificada, cada opción con etiqueta de
  origen.
- Nuevo campo **Clasificación tributaria**: `Afecto` (default) | `Exento`,
  visible para todos los tipos de item.

### POS / tienda / salones

- Sin cambios: el cálculo viene del backend. Mostrar "Exento" en boletas/recibos
  queda fuera de alcance (llegará con la emisión fiscal, ADR-010).

## Verificación

- `impuestos.service.spec`: `findAll` devuelve unión sistema+tenant con `origen`;
  mutaciones no alcanzan filas del sistema (404); `tipo` default `'otro'`.
- `calculo-precios.service.spec`: línea exenta omite impuestos `tipo 'iva'` y
  conserva `tipo 'otro'`; línea afecta sin cambios de comportamiento.
- `ventas.service.spec`: `clasificacion_tributaria` congelada en el detalle.
- Manual: `docker-compose down -v && docker-compose up` (seed limpio) y arranque
  sobre BD existente (verificar remapeo idempotente: dos arranques seguidos).

## Documentación (mismo commit que el código)

- Nuevo ADR: catálogo de impuestos del sistema + semántica exento/IVA
  (+ índice `docs/adr/README.md`).
- `docs/ESTADO.md`, `docs/PRODUCTO.md` (regla exento), `startup-pos.sql`,
  feature doc de impuestos en `docs/features/`.

## Fuera de alcance

- CRUD superadmin del catálogo del sistema.
- Impuestos adicionales chilenos concretos (ILA, etc.) en el seed — el modelo los
  soporta (`tipo 'otro'` en catálogo del sistema) pero no se siembran ahora.
- Indicador "Exento" en recibos/boletas impresas y emisión DTE (ADR-010: diferido).
- Nuevas clasificaciones tributarias más allá de afecto/exento (el campo TEXT las
  admite a futuro sin migración).
