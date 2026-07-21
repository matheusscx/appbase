# Feature: Grupos de modificadores reutilizables

**Status**: Complete
**Owner**: SDD Team
**Last Updated**: 2026-07-20

---

## Overview

### What is it?

Un **grupo de modificadores** (`grupos_modificadores`) es un conjunto reutilizable
de opciones — a nivel tenant, no por item — que se asocia a N combos o recetas
distintos (ej. el grupo "Bebida" puede vivir tanto en "Combo Clásico" como en
"Combo Familiar"). Cada opción del grupo es un item existente del catálogo
(`producto`, `receta`, `servicio` o `ingrediente`) con una **cantidad** y un
**recargo** (`precioExtra`) propios de esa opción dentro del grupo. Al asociar
un grupo a un item (combo o receta) se declara cuántas unidades totales debe
elegir el customer: `min`/`max` en **unidades**, no en cantidad de opciones
distintas.

Ejemplos del seed demo:
- **Proteína** (familia ingrediente): carne / pollo (+$0), chuleta (+$1.500),
  150 g cada una. Asociado a la receta **Hamburguesa Especial** (`min:1,
  max:1` — obligatorio, una sola proteína, y a diferencia de "Hamburguesa
  Clásica" no la lleva como `receta_ingrediente` fijo).
- **Bebida** (familia vendible): Coca-Cola (+$0), Bebida premium (+$800).
  Asociado al **Combo Clásico** existente (`min:1, max:1` — obligatorio).

### Why does it exist?

Combos (`docs/features/combos.md`, Ticket A) solo cubría **componentes
fijos** — sin elección del customer. Food-service necesita "elige tu bebida" /
"elige tu proteína" sin duplicar el mismo catálogo de opciones en cada combo o
receta que lo requiera (ej. si 5 combos distintos ofrecen la misma elección de
bebida, se define **una vez** el grupo "Bebida" y se asocia a los 5). Recetas
ya tenía `receta_extras_permitidos` (extras opcionales, sin límite de
elección) — los grupos añaden el caso de **elección obligatoria/acotada entre
alternativas homogéneas**, que `receta_extras_permitidos` no modela.

### Scope

**Included:**
- Módulo `GruposModificadoresModule`: CRUD de grupos + sus opciones
  (`grupos_modificadores`, `grupo_modificador_opciones`).
- **Familia derivada, no persistida**: `ingrediente` (todas las opciones
  `tipo='ingrediente'`) o `vendible` (todas `producto | receta | servicio`).
  Se recalcula en cada lectura a partir del `tipo` de la primera opción viva —
  ningún campo `familia` existe en la tabla.
- **Homogeneidad verificada al guardar**: todas las opciones de un grupo deben
  resolver a la misma familia; si no, `400`.
- Validación por tipo de opción: `ingrediente` requiere `modo_inventario =
  'cantidad'` y `unidadCodigo` convertible contra la unidad base del
  ingrediente (mismo `CatalogService.convertirUnidad` que usan recetas);
  `vendible` nunca admite `combo` ni `suscripcion` como opción (sin combos ni
  suscripciones anidadas dentro de un grupo).
- Asociación item↔grupo (`item_grupos_modificadores`, `min`/`max`/`orden`) —
  un combo o una receta puede tener 0..N grupos asociados.
- **Combos**: la validación "≥1 componente" se relaja a "≥1 componente fijo o
  ≥1 grupo" — un combo puede existir compuesto **solo** por grupos (sin
  componentes fijos), en cuyo caso `item_combo.costo_actual = '0'` (el costo
  real se realiza al vender, vía el movimiento de inventario de la opción
  elegida — ver `docs/adr/013-grupos-modificadores-reutilizables.md`).
- `GET /items/:id` (combo o receta) devuelve `grupos[]` con sus opciones y
  stock; `GET /items?tipo=combo` marca `disponibleCondicional: true` si el
  combo tiene ≥1 grupo asociado (la disponibilidad real depende de qué opción
  elige el customer, no es un número fijo).
- Bloqueo de borrado: un item que es opción viva de un grupo no puede
  eliminarse (`400`); un grupo asociado a items vivos no puede eliminarse.
- **Snapshot congelado en la venta**: `resolverGruposDeItem` valida que cada
  opción elegida pertenezca al grupo asociado y que `min ≤ Σunidades ≤ max`,
  calcula el recargo (`Σ precioExtra × unidades`) y persiste todo
  (`grupoId`, `grupoNombre`, opciones con `cantidad`/`unidadCodigo`/
  `precioExtra`/`unidades`) en `personalizacion` (`cuenta_lineas` /
  `venta_detalles`) — el backend nunca confía en el precio que mande el
  frontend, siempre revalida contra el catálogo vivo al momento de vender.
- **Descuento de inventario por opción elegida** (`venderOpcionesGrupos`):
  efecto según el `tipo` de la opción — `receta` expande a sus ingredientes
  (`venderIngredientesReceta`), `producto`/`ingrediente` genera una salida
  directa (con conversión de unidad si aplica), `servicio` no genera
  movimiento. **Siempre bloqueante** — a diferencia de los ingredientes fijos
  de receta (que pueden ser no bloqueantes), una opción de grupo elegida por
  el customer sin stock **aborta la venta** (regla fija, no configurable — es
  lo que el customer explícitamente pidió).
- CRUD de grupos en Configuración → Grupos de modificadores
  (`pages/configuracion/grupos-modificadores.vue`); sección de grupos
  compartida en el editor de Items (combo + receta, `pages/configuracion/items.vue`).
- Drawer de personalización unificado y renombrado
  (`components/ventas/ItemPersonalizacionDrawer.vue`, antes específico de
  recetas) — ahora también renderiza grupos para combos y recetas, exige
  min/max antes de habilitar "Agregar", y hace merge de líneas en Salones por
  la misma personalización congelada (grupos incluidos en la clave de merge).
- Seed demo: grupos "Proteína" y "Bebida" (ver sección Seed demo).

**NOT included (future):**
- **Impresión térmica de las opciones elegidas de un grupo** — diferida
  explícitamente a un ticket aparte (decisión confirmada por el usuario,
  2026-07-20). Hoy la comanda/boleta imprime el item (combo o receta) por su
  nombre, sin desglosar qué opción de grupo se eligió (ej. "Hamburguesa
  Especial" sin indicar "con chuleta"). **No es un olvido**: el snapshot
  `personalizacion.grupos` ya congela todo lo necesario (nombre de grupo,
  opción elegida, unidades) para implementarlo después **sin migración** — el
  trabajo pendiente es puramente de plantilla de impresión
  (`docs/features/impresion-termica.md`), no de modelo de datos.
- Override de `precioExtra` por item — el precio de una opción es del grupo,
  compartido por todos los items que lo usan; si dos combos necesitan precios
  distintos para "Bebida premium" hoy se requiere **dos grupos** (ver ADR-013,
  trade-off asumido).
- Grupos anidados (una opción de grupo que a su vez tenga grupos propios).
- Evaluación de condiciones para habilitar/deshabilitar opciones (fase futura,
  igual que descuentos/recargos condicionales).

---

## Modelo de datos

### `grupos_modificadores`

| Column | Type | Notes |
|--------|------|-------|
| `grupo_modificador_id` | UUID PK | |
| `tenant_id` | UUID | Del token |
| `nombre` | TEXT | Único por tenant entre grupos vivos (case-insensitive) |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | Soft delete |

Sin columna `familia` ni `tipo` — se deriva en cada lectura del `tipo` de la
primera opción viva (`ingrediente` → familia `ingrediente`; cualquier otro
tipo permitido → familia `vendible`).

### `grupo_modificador_opciones`

| Column | Type | Notes |
|--------|------|-------|
| `grupo_opcion_id` | UUID PK | |
| `tenant_id` | UUID | |
| `grupo_modificador_id` | UUID FK | |
| `item_id` | UUID FK → items | `producto \| receta \| servicio \| ingrediente` |
| `cantidad` | NUMERIC(18,4) | Por 1 unidad elegida |
| `unidad_codigo` | TEXT, nullable | Solo familia `ingrediente`; `NULL` en `vendible` |
| `precio_extra` | NUMERIC(18,4) | Recargo ≥ 0, por unidad elegida |
| `orden` | INT | Orden de presentación |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | Soft delete al reemplazar lista (mismo patrón que `combo_componentes`) |

Índice único parcial: `(grupo_modificador_id, item_id) WHERE eliminado_el IS NULL`
— un item no puede aparecer dos veces como opción del mismo grupo vivo.

### `item_grupos_modificadores`

| Column | Type | Notes |
|--------|------|-------|
| `item_grupo_id` | UUID PK | |
| `tenant_id` | UUID | |
| `item_id` | UUID FK → items | Combo o receta |
| `grupo_modificador_id` | UUID FK | |
| `min` | INT | Default 1. Unidades mínimas totales a elegir |
| `max` | INT | Unidades máximas totales a elegir |
| `orden` | INT | |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | Soft delete |

Índice único parcial: `(item_id, grupo_modificador_id) WHERE eliminado_el IS NULL`
— un item no puede asociar el mismo grupo dos veces mientras esté vivo.

**`min`/`max` son unidades totales del grupo, no cantidad de opciones
distintas.** Ej. "Proteína" con `min:1, max:1` significa "elegí 1 unidad entre
todas las opciones" (una sola proteína, cualquiera sea); un grupo con `min:1,
max:2` permitiría elegir 2 unidades de la misma opción o 1+1 de dos distintas
— la suma de `unidades` por opción elegida es lo que se valida contra
`min`/`max`, nunca la cantidad de opciones distintas elegidas.

---

## API

### CRUD de grupos (`/grupos-modificadores`)

```
POST /api/grupos-modificadores
Authorization: Bearer <token>  (requiere TenantAdminGuard)

Request:
{
  "nombre": "Proteína",
  "opciones": [
    { "itemId": "<carne>", "cantidad": "150", "unidadCodigo": "g", "precioExtra": "0" },
    { "itemId": "<pollo>", "cantidad": "150", "unidadCodigo": "g", "precioExtra": "0" },
    { "itemId": "<chuleta>", "cantidad": "150", "unidadCodigo": "g", "precioExtra": "1500" }
  ]
}

Response (201):
{
  "grupoModificadorId": "<uuid>",
  "nombre": "Proteína",
  "familia": "ingrediente",
  "opciones": [ ... ]
}
```

- `GET /grupos-modificadores` — lista grupos vivos del tenant, con familia
  derivada, opciones vivas y `itemsUsandoCount` (cuántos items vivos lo usan).
- `GET /grupos-modificadores/:id` — detalle (mismo shape que un elemento de la
  lista).
- `PATCH /grupos-modificadores/:id` — `nombre` y/o `opciones` (reemplazo
  total: soft-delete de las vivas + insert de las nuevas). Reusa la misma
  validación de homogeneidad que `create`.
- `DELETE /grupos-modificadores/:id` — `400` si el grupo está asociado a algún
  item vivo (`item_grupos_modificadores`).

### Asociación item↔grupo (extensión de `/items`)

`POST /items` y `PATCH /items/:id` (tipo `combo` o `receta`) aceptan
`gruposModificadores: { grupoModificadorId, min, max, orden? }[]`. Para combos,
`componentes` y `gruposModificadores` son independientes: se requiere al
menos uno de los dos (nunca ambos vacíos).

`GET /items/:id` de un combo o receta agrega:

```
"grupos": [
  {
    "grupoModificadorId": "<uuid>",
    "nombre": "Proteína",
    "min": 1,
    "max": 1,
    "orden": 0,
    "opciones": [
      { "grupoOpcionId": "...", "itemId": "...", "itemNombre": "Chuleta de cerdo",
        "tipo": "ingrediente", "cantidad": "150.0000", "unidadCodigo": "g",
        "precioExtra": "1500.0000", "orden": 2, "stock": "6.0000" }
    ]
  }
],
"disponibleCondicional": true   // solo combos: true si tiene ≥1 grupo asociado
```

`GET /items?tipo=combo` incluye `disponibleCondicional` en cada fila (una sola
query extra para todos los combos, no N+1).

### Personalización al vender (extensión de `/ventas`, cuentas de mesa)

El body de venta/línea de cuenta acepta `personalizacion.grupos: {
grupoId, opciones: { itemId, unidades }[] }[]`. El backend
(`ItemsService.resolverGruposDeItem`) revalida contra el catálogo vivo —
ignora cualquier precio que mande el frontend — y congela el snapshot en
`cuenta_lineas.personalizacion` / `venta_detalles.personalizacion`.

---

## Backend

### Módulo & Servicios

- **Módulo**: `GruposModificadoresModule`
  (`src/modules/grupos-modificadores/grupos-modificadores.module.ts`)
- **Controller**: `grupos-modificadores.controller.ts`
- **Service**: `grupos-modificadores.service.ts`
- **Entidades**: `entities/grupo-modificador.entity.ts`,
  `entities/grupo-modificador-opcion.entity.ts` (ambas en el módulo de
  grupos); `item-grupos-modificadores` vive como
  `src/modules/items/entities/item-grupo-modificador.entity.ts` (asociación,
  no se registra `TypeOrmModule.forFeature` para ella — el acceso es siempre
  vía SQL raw, mismo patrón que `combo_componentes`/`receta_ingredientes`).

### Key methods

- `GruposModificadoresService.validarYResolverOpciones` (privado) —
  homogeneidad de familia + validación por tipo; reusado por `create`/`update`.
- `GruposModificadoresService.familiaDeTipo` (privado) — deriva
  `'ingrediente' | 'vendible'` del `tipo` del item.
- `ItemsService.resolverGruposDeItem` — valida elección contra `min`/`max`,
  congela snapshot, calcula recargo. Reusado por recetas (`resolverIngredientesYExtras`)
  y por `resolverPersonalizacionCombo` (combos solo admiten grupos, no
  ingredientes/extras — esos son propios de receta).
- `ItemsService.venderOpcionesGrupos` (privado) — efecto de inventario por
  tipo de opción al vender, siempre bloqueante.

---

## Frontend

- `pages/configuracion/grupos-modificadores.vue` — CRUD de grupos (nombre +
  tabla de opciones con selector de item, cantidad, unidad si ingrediente,
  precio extra).
- `pages/configuracion/items.vue` — sección "Grupos de modificadores"
  compartida entre combo y receta (selector de grupo + `min`/`max`/`orden`).
- `components/ventas/ItemPersonalizacionDrawer.vue` — drawer unificado
  (renombrado desde el drawer específico de recetas): renderiza ingredientes
  omitibles + extras (receta) y/o grupos (combo y receta) según lo que el
  item tenga; exige `min ≤ Σunidades ≤ max` por grupo antes de habilitar
  "Agregar"; combos con ≥1 grupo asociado ahora abren el drawer (antes, sin
  grupos, se agregaban con un click).
- `composables/useRecetaPersonalizacion.ts` — resolución de grupos en el
  frontend (espejo de `resolverGruposDeItem`, para UX inmediata; el backend
  revalida igual).
- Catálogo POS/Salones: `Disponible*` en vez de un número fijo para combos con
  `disponibleCondicional: true` (la disponibilidad depende de la opción
  elegida).
- Merge de líneas en Salones: la clave de merge incluye los grupos elegidos
  (dos líneas del mismo combo con distinta proteína/bebida no se mergean).

---

## Seed demo

`seedGruposModificadores()` en `backend/src/modules/seeder/seeder.service.ts`,
invocado tras `seedCombos()` (idempotente, guarda por la existencia del grupo
"Proteína"). IDs `550e8400-e29b-41d4-a716-446655440XXX`:

| Entidad | ID | Notas |
|---|---|---|
| Ingrediente "Pechuga de pollo" | `…440286` | Nuevo, 8 kg stock, costo 6000/kg |
| Ingrediente "Chuleta de cerdo" | `…440288` | Nuevo, 6 kg stock, costo 9000/kg |
| Grupo "Proteína" | `…440290` | Familia `ingrediente` |
| Opción carne (reutiliza `…440257`) | `…440291` | 150 g, +$0 |
| Opción pollo | `…440292` | 150 g, +$0 |
| Opción chuleta | `…440293` | 150 g, +$1.500 |
| Item "Hamburguesa Especial" (receta) | `…440294` | Pan + queso fijos, SIN proteína fija; `min:1, max:1` con "Proteína" |
| Item "Coca-Cola" (producto) | `…440298` | Nuevo, 100 unidad stock, costo 500 |
| Item "Bebida premium" (producto) | `…440300` | Nuevo, 40 unidad stock, costo 1200 |
| Grupo "Bebida" | `…440302` | Familia `vendible` |
| Opción Coca-Cola | `…440303` | +$0 |
| Opción Bebida premium | `…440304` | +$800 |
| Asociación "Bebida" ↔ Combo Clásico (`…440283`) | `…440305` | `min:1, max:1` |

Verificado tras `docker-compose up` / restart del backend: log `Seed
complete.` sin errores; `GET /grupos-modificadores` devuelve ambos grupos;
`GET /items?tipo=combo` muestra "Combo Clásico" con `disponibleCondicional:
true`.

---

## Testing

```bash
cd backend && npm test -- grupos-modificadores.service.spec.ts items.service.spec.ts ventas.service.spec.ts
cd backend && npm run test:e2e -- grupos-modificadores.e2e-spec.ts combos.e2e-spec.ts
```

---

## Acceptance Criteria

- [x] CRUD de grupos + opciones, homogeneidad verificada
- [x] Asociación item↔grupo (`min`/`max`/`orden`); combo relaja "≥1
      componente" a "≥1 componente o grupo"
- [x] `GET /items/:id` con `grupos[]`; `disponibleCondicional` en combo
- [x] Bloqueo de borrado (opción de grupo vivo / grupo asociado a items vivos)
- [x] Snapshot congelado en personalización; revalidación server-side
- [x] Descuento de inventario por opción elegida (siempre bloqueante)
- [x] CRUD de grupos en Configuración + sección compartida en Items
- [x] Drawer de personalización unificado con grupos
- [x] Seed demo (Proteína + Bebida) + Docs (este archivo) + ESTADO + PRODUCTO
      + ADR

---

## Related Features

- [combos.md](./combos.md) — combos de componentes fijos; los grupos son la
  pieza de "combo con elección" que ese ticket dejó fuera de alcance
- [recetas.md](./recetas.md) — recetas base; los grupos son una segunda forma
  de personalización además de omitir ingredientes/extras
- [personalizacion-recetas.md](./personalizacion-recetas.md) — drawer de
  personalización, ahora compartido con grupos
- [inventario-kardex.md](./inventario-kardex.md) — movimientos de salida por
  opción elegida
- [impresion-termica.md](./impresion-termica.md) — pendiente: imprimir la
  opción elegida de un grupo en comanda/boleta (diferido, ver Scope)
- ADR: [013](../adr/013-grupos-modificadores-reutilizables.md) — grupos
  reutilizables sin tipo declarado, precio en el grupo sin override, `min`/`max`
  en unidades, opción siempre bloqueante

## Notes

**Impresión térmica (diferida, no un olvido):** confirmado con el usuario el
2026-07-20 que la impresión de la opción elegida de un grupo en
comanda/precuenta/boleta queda para un ticket aparte. El snapshot
`personalizacion.grupos` ya persiste `grupoNombre` + `itemNombre` + `unidades`
de cada opción elegida — implementar la impresión después es un cambio de
plantilla, no requiere migración ni cambio de modelo de datos.
