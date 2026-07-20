# Diseño: Items tipo combo + grupos de modificadores reutilizables

**Status**: Approved
**Date**: 2026-07-19
**Owner**: SDD Team

---

## Context

El cluster food-service ya tiene items `tipo='receta'` (composición que descuenta stock de
ingredientes) y personalización de recetas antes del carrito (omitir, extras con cargo,
comentario). Faltan dos piezas que el cliente pide:

1. **Combos** — un item vendible que agrupa otros items vendibles (1 hamburguesa +
   1 refresco + 1 postre). No tiene stock propio: al venderse descuenta el stock de sus
   componentes, igual que una receta descuenta ingredientes.
2. **Grupos de modificadores reutilizables** — "Proteína" (carne / pollo / chuleta, cada una
   con su recargo) definido una vez a nivel tenant y reusado en hamburguesas, arepas y
   combos. Evita crear un item por variante ("Hamburguesa Especial de Pollo",
   "…de Carne", "…de Chuleta").

Los grupos aplican tanto a **combos** ("elige tu bebida") como a **recetas**
("elige tu proteína"), por eso se diseñan como mecanismo compartido desde el inicio.

## Scope

**Incluido**
- `items.tipo = 'combo'` + extensión `item_combo` + `combo_componentes`.
- Catálogo de grupos de modificadores a nivel tenant, con opciones y recargo por opción.
- Asociación de grupos a items (combo y receta) con `obligatorio` y `cantidad_a_elegir`.
- Elección en el drawer de personalización (POS y Salones), snapshot congelado en la línea.
- Consumo de inventario de componentes y de opciones elegidas al vender.
- `disponible` del combo en el listado del catálogo.
- CRUD de grupos en Configuración; editor de combo y de grupos asociados en Items.
- Seed demo, tests unit + E2E, documentación viva.

**No incluido (futuro)**
- Combos anidados; recetas como opción de un grupo de ingredientes.
- Override de precio de una opción por item (aditivo a futuro, no requiere migración).
- Canal **online** (tienda): requiere definir la política de stock agotado post-pago.
- Recargos negativos ("opción económica −$500").
- Precio del combo calculado como suma de componentes con descuento.

---

## Decisiones tomadas

| # | Decisión | Alternativa descartada | Razón |
|---|---|---|---|
| 1 | Componentes de un combo: `producto`, `receta`, `servicio` (mezclables) | solo producto/receta; o permitir anidar combos | cubre "combo con delivery"; anidar repite el problema ya descartado en recetas anidadas |
| 2 | El combo tiene **precio propio fijo** | suma de componentes − descuento | consistente con receta; cambiar el precio de un componente no mueve silenciosamente el del combo |
| 3 | Componentes fijos con flag `bloqueante`, **más** grupos de elección | solo obligatorios; solo elegibles | reusa la semántica probada de ingredientes de receta |
| 4 | Grupos con `cantidad_a_elegir` + `obligatorio`, **permitiendo repetir** la misma opción | sin repetir; o siempre 1 | "2× Coca-Cola" es un pedido real; el stepper ya existe en el drawer |
| 5 | Precio de opción = **recargo ≥ 0** sobre el precio base | precio absoluto por opción; recargos negativos | entra intacto al motor de precios existente; evita un camino de precio paralelo |
| 6 | Grupos **reutilizables a nivel tenant**, con el precio definido en el grupo | grupos inline por item; override de precio por item | resuelve el problema real (editar el precio del pollo una vez); el override es aditivo a futuro |
| 7 | Grupo tipado: `ingrediente` (→ recetas) o `item` (→ combos) | un tipo único polimórfico | las opciones consumen inventario de forma distinta; un grupo no puede servir para ambos |
| 8 | Una sola línea de venta por combo, con snapshot en `personalizacion` | línea + sublíneas; explotar en N líneas | idéntico a receta; mantiene reportes, notas de crédito y motor de precios coherentes |
| 9 | `disponible` del combo = mínimo entre **componentes fijos bloqueantes** | considerar el mejor caso de cada grupo | el badge no promete disponibilidad que una elección concreta puede no cumplir |
| 10 | Canales: POS + Salones | incluir tienda online | online crea la venta **después** de cobrar; stock agotado post-pago es una regla de negocio aparte |

---

## Modelo de datos

### `grupos_modificadores`

| Columna | Tipo | Notas |
|---|---|---|
| `grupo_modificador_id` | UUID PK | |
| `tenant_id` | UUID | del token |
| `nombre` | TEXT | único vivo por tenant |
| `tipo_opcion` | TEXT | `'ingrediente'` \| `'item'` — inmutable tras crear |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | soft delete |

Índice único parcial: `(tenant_id, nombre) WHERE eliminado_el IS NULL`.

### `grupo_modificador_opciones`

| Columna | Tipo | Notas |
|---|---|---|
| `grupo_opcion_id` | UUID PK | |
| `tenant_id` | UUID | |
| `grupo_modificador_id` | UUID | |
| `item_id` | UUID | ingrediente o item vendible según `tipo_opcion` |
| `cantidad` | NUMERIC(18,4) | > 0, por unidad elegida |
| `unidad_codigo` | TEXT FK → unidades_medida, NULL | solo grupos de ingrediente |
| `precio_extra` | NUMERIC(18,4) | ≥ 0, default 0 |
| `orden` | INT | orden en el drawer |
| timestamps + `eliminado_el` | TIMESTAMPTZ | soft delete al reemplazar lista |

Índice único parcial: `(grupo_modificador_id, item_id) WHERE eliminado_el IS NULL`.

### `item_grupos_modificadores`

| Columna | Tipo | Notas |
|---|---|---|
| `item_grupo_id` | UUID PK | |
| `tenant_id` / `item_id` / `grupo_modificador_id` | UUID | |
| `obligatorio` | BOOLEAN | default `true` |
| `cantidad_a_elegir` | INT | default 1, ≥ 1 |
| `orden` | INT | |
| timestamps + `eliminado_el` | TIMESTAMPTZ | |

Índice único parcial: `(item_id, grupo_modificador_id) WHERE eliminado_el IS NULL`.

### `item_combo` (1:1 con `items` tipo combo)

| Columna | Tipo | Notas |
|---|---|---|
| `item_id` | UUID PK/FK → items | |
| `costo_actual` | NUMERIC(18,4) | Σ (costo del componente × cantidad); cacheado, no se recalcula solo |

### `combo_componentes`

| Columna | Tipo | Notas |
|---|---|---|
| `combo_componente_id` | UUID PK | |
| `tenant_id` / `combo_item_id` | UUID | |
| `componente_item_id` | UUID | `producto` \| `receta` \| `servicio` |
| `cantidad` | NUMERIC(18,4) | > 0 |
| `bloqueante` | BOOLEAN | default `true` |
| timestamps + `eliminado_el` | TIMESTAMPTZ | |

Índice único parcial: `(combo_item_id, componente_item_id) WHERE eliminado_el IS NULL`.

Todas las columnas PK/FK UUID declaran `type: 'uuid'` explícito (ADR-004).

### Snapshot en la línea

Se extiende el JSONB `personalizacion` existente (`cuenta_lineas.personalizacion`,
`venta_detalles.personalizacion`) con una clave nueva. `omitidos`, `extras` y
`comentario` quedan intactos.

```ts
grupos?: {
  grupoId: string
  grupoNombre: string          // congelado
  opciones: {
    itemId: string
    nombre: string             // congelado
    cantidad: string
    unidadCodigo?: string      // solo grupos de ingrediente
    precioExtra: string        // congelado al confirmar
    unidades: string           // ≥ 1
  }[]
}[]
```

### Reglas de integridad

- Grupo `tipo_opcion='ingrediente'` → solo se asocia a items `tipo='receta'`.
- Grupo `tipo_opcion='item'` → solo se asocia a items `tipo='combo'`.
- Opción de grupo ingrediente: item `tipo='ingrediente'`, `modo_inventario='cantidad'`,
  unidad de la misma magnitud que su unidad base.
- Opción de grupo item: `producto` \| `receta` \| `servicio`; nunca `combo` ni `suscripcion`.
- Un combo requiere al menos un componente fijo **o** un grupo asociado.
- Soft delete bloqueado con `400` + nombres afectados cuando: el item es componente de un
  combo vivo, el item es opción de un grupo vivo, o el grupo está asociado a items vivos.

---

## Backend

### Módulo nuevo `GruposModificadoresModule`

`src/modules/grupos-modificadores/` (controller, service, entidades, DTOs), registrado en
`app.module.ts`.

| Endpoint | Comportamiento |
|---|---|
| `GET /grupos-modificadores?tipoOpcion=` | lista con opciones (item, cantidad, unidad, `precioExtra`, orden) |
| `GET /grupos-modificadores/:id` | detalle |
| `POST /grupos-modificadores` | nombre + `tipoOpcion` + opciones; valida tipo, `modo_inventario` y unidad de cada opción |
| `PATCH /grupos-modificadores/:id` | reemplazo total de opciones (soft-delete + insert); `tipoOpcion` inmutable |
| `DELETE /grupos-modificadores/:id` | `400` si hay items vivos asociados, listando sus nombres |

`tenant_id` siempre del token, nunca del body.

### Extensiones a `ItemsModule`

Entidades nuevas: `ItemCombo`, `ComboComponente`, `ItemGrupoModificador`.

- `POST /items` con `tipo: 'combo'` → `componentes: [{ componenteItemId, cantidad, bloqueante }]`
  y `gruposModificadores: [{ grupoModificadorId, obligatorio, cantidadAElegir, orden }]`.
  Calcula `item_combo.costo_actual` con Decimal.js, 4 decimales.
- `POST/PATCH /items` con `tipo: 'receta'` acepta `gruposModificadores` (solo grupos
  `tipo_opcion='ingrediente'`).
- `PATCH /items/:id` — reemplazo total de componentes y de asociaciones de grupo.
- `GET /items?tipo=combo` — incluye `disponible`: mínimo entre componentes fijos
  **bloqueantes** (`producto` → `floor(stock/cantidad)`; `receta` →
  `floor(disponibleReceta/cantidad)`; `servicio` ignorado). `null` si no hay bloqueantes.
- `GET /items/:id` — combo devuelve `componentes[]`; combo y receta devuelven `grupos[]`
  con opciones resueltas y stock actual (alimenta el drawer).
- `DELETE /items/:id` — bloqueo según las reglas de integridad.

### Venta

`VentasService.crearEnTransaccion` delega en `ItemsService`, sin dependencias nuevas en
Ventas (mismo patrón que `venderIngredientesReceta`):

- `venderComponentesCombo(comboItemId, cantidadVendida, snapshot, manager)` — por componente
  fijo: `producto` → `registrarMovimiento` salida; `receta` → `venderIngredientesReceta`;
  `servicio` → nada. Luego, por cada opción de `snapshot.grupos`, lo mismo × `unidades`.
- `venderOpcionesGrupoReceta(...)` — grupos de ingrediente en recetas: salida del
  ingrediente con conversión de unidad (`CatalogService.convertirUnidad`),
  × `unidades` × cantidad vendida.

Semántica de fallo:

- Componente **bloqueante** sin stock → aborta la transacción.
- Componente **no bloqueante** sin stock → se omite, se agrega a `advertenciasReceta`
  (se reusa el mismo campo de respuesta).
- **Opción elegida de un grupo → siempre bloqueante.** El cliente eligió chuleta; entregar
  el combo sin chuleta no es una opción.

### Precio

Línea = `precioBase + Σ (precioExtra × unidades)`, con `precioExtra` congelado en el
snapshot. El backend **revalida** ese cálculo contra el catálogo al vender (no confía en el
precio del cliente) y el resultado entra intacto al motor de precios existente:
`precioNeto → descuentos → recargos → impuestos`. Todo con Decimal.js.

### Validación del snapshot al vender

Cada grupo `obligatorio` del item debe traer exactamente `cantidad_a_elegir` unidades
elegidas (sumando `unidades` de sus opciones); si no, `400`. Un grupo no obligatorio puede
venir vacío o ausente.

---

## Frontend

### Configuración → `pages/configuracion/grupos-modificadores.vue` (nueva)

CRUD del catálogo: tabla (nombre, tipo, N° de opciones, N° de items que lo usan) y drawer de
edición con filas de opciones. Según `tipoOpcion`, el selector consulta
`GET /items?tipo=ingrediente` (con cantidad + unidad filtrada por magnitud) o
`GET /items?tipo=producto|receta|servicio`. Cada fila lleva su `precioExtra`. El tipo se
elige al crear y queda bloqueado.

### Configuración → Items (`pages/configuracion/items.vue`)

- Tipo **Combo** en el selector, con editor de componentes (item vendible + cantidad +
  `bloqueante`), reusando el componente visual del editor de ingredientes de receta.
- Sección **"Grupos de modificadores"** compartida por Combo y Receta: se agregan grupos del
  catálogo (filtrados por `tipoOpcion` según el tipo del item) y por cada uno se configura
  `obligatorio`, `cantidad a elegir` y orden. Las opciones del grupo se muestran en solo
  lectura, con link a su página de edición.
- Costo del combo en solo lectura al editar.

### POS y Salones

- `RecetaPersonalizacionDrawer.vue` → `ItemPersonalizacionDrawer.vue`: mantiene
  omitidos / extras / comentario para recetas y suma una sección de **grupos** arriba. Cada
  grupo muestra su encabezado ("Bebida — elige 1"), sus opciones con recargo (`+$1.500`),
  stock, y stepper cuando `cantidadAElegir > 1`. Opciones agotadas deshabilitadas; grupo
  obligatorio sin ninguna opción con stock ⇒ no se puede confirmar, con mensaje explícito.
  El botón de confirmar muestra el precio final ya sumado.
- El drawer se abre para **cualquier item con grupos** (receta o combo). Un combo sin grupos
  y un producto se agregan con un click, como hoy.
- `CatalogoGrid.vue` suma `tipo=combo` al fetch paralelo, con el mismo tratamiento de
  `disponible` (badge "Disponibles: N", atenuado en 0, nunca bloquea el click).
- `useVenta.ts` y las líneas de cuenta extienden el snapshot con `grupos`. El merge de
  líneas en Salones ya compara la personalización completa, así que dos combos con distinta
  bebida no se fusionan — sin cambios.
- Formatos vía `useFormatters`; tokens semánticos de Nuxt UI, sin Tailwind hardcodeado.
- Sin `cargar()` post-mutación: el backend devuelve la entidad o patch mergeable.

### Impresión térmica

El texto derivado del snapshot suma las opciones elegidas:
`Combo Familiar — Bebida: Coca-Cola ×2 / Postre: Brownie`.

---

## Verification

### Tests

- **Unit `grupos-modificadores.service.spec.ts`** — tipo de opción vs tipo de item, unidad
  convertible, `precioExtra ≥ 0`, reemplazo total en PATCH, bloqueo de DELETE con items
  asociados.
- **Unit `items.service.spec.ts`** — alta/edición de combo, cálculo de `costo_actual`,
  `disponible` con componentes producto + receta + servicio, bloqueo de borrado de un item
  usado como componente u opción.
- **Unit `ventas.service.spec.ts`** — combo con componente receta (expansión a ingredientes);
  componente no bloqueante sin stock → advertencia; bloqueante sin stock → aborta; opción
  elegida sin stock → aborta; snapshot que no cumple `cantidad_a_elegir` → 400; precio
  enviado por el cliente distinto al recalculado → prevalece el del backend.
- **E2E `combos.e2e-spec.ts`** — crear grupo → crear combo con grupo obligatorio → vender
  eligiendo opción → verificar movimientos de inventario de cada componente y de la opción,
  y el total cobrado.

### Seed

`seeder.service.ts`, IDs desde `550e8400-e29b-41d4-a716-446655440281`:

- Grupo `Proteína` (`tipo_opcion='ingrediente'`): carne +$0, pollo +$0, chuleta +$1.500,
  asociado a una receta "Hamburguesa Especial" que **no** lleva proteína fija.
- Grupo `Bebida` (`tipo_opcion='item'`): Coca-Cola +$0, bebida premium +$800.
- Combo demo "Combo Clásico": Hamburguesa Clásica ×1 (receta) + Papas ×1 (producto) +
  grupo Bebida obligatorio.

### Documentación (mismo commit que el código)

- `docs/features/grupos-modificadores.md` y `docs/features/combos.md` desde `TEMPLATE.md`,
  con links en `docs/README.md`.
- Filas en `docs/ESTADO.md`; reglas de negocio en `docs/PRODUCTO.md`.
- Nota en `docs/features/recetas.md` y `docs/features/personalizacion-recetas.md`
  apuntando a los grupos.
- **ADR nuevo**: grupos de modificadores reutilizables a nivel tenant, precio definido en el
  grupo, sin override por item — con el trade-off aceptado y la nota de que el override es
  aditivo a futuro.

---

## Riesgos asumidos

- **Precio compartido entre items**: si el recargo de "carne" difiere entre hamburguesa y
  arepa, hay que crear dos grupos. Aceptado a cambio de no construir la tabla de overrides.
- **Cambiar el precio de una opción** no afecta ventas emitidas (snapshot congelado) ni
  líneas ya agregadas al carrito; sí afecta las que se agreguen después.
- **`disponible` conservador** en combos con grupos: el número refleja solo los componentes
  fijos; el detalle fino se resuelve en el drawer.

---

## Related

- [recetas.md](../../features/recetas.md) — item compuesto que descuenta ingredientes
- [personalizacion-recetas.md](../../features/personalizacion-recetas.md) — drawer y snapshot que se extienden
- [conversion-unidades.md](../../features/conversion-unidades.md) — conversión en el consumo
- [inventario-kardex.md](../../features/inventario-kardex.md) — movimientos de salida
- [ventas.md](../../features/ventas.md) — flujo de cobro POS
- [motor-calculo-precios.md](../../features/motor-calculo-precios.md) — dónde entra el recargo
