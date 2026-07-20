# Diseño — Ticket B: Grupos de modificadores reutilizables

**Status**: Draft
**Date**: 2026-07-20
**Owner**: SDD Team
**Depende de**: [Ticket A — Combos](2026-07-20-combos-design.md) (ejecutar A primero)
**Reemplaza (junto con [combos](2026-07-20-combos-design.md))**: [2026-07-19-combos-grupos-modificadores-design.md](2026-07-19-combos-grupos-modificadores-design.md)

---

## Context

Con los combos de componentes fijos ya en producción (Ticket A) y las recetas con
personalización (omitir / extras / comentario), falta la pieza transversal que el cliente pide:
**grupos de modificadores reutilizables**. "Proteína" (carne / pollo / chuleta, cada una con su
recargo) o "Bebida" (Coca-Cola / bebida premium) definidos una vez a nivel tenant y reusados en
hamburguesas, arepas y combos. Evita crear un item por variante ("Hamburguesa de Pollo",
"…de Carne", "…de Chuleta").

Los grupos son **transversales**: el mismo grupo puede colgar de una **receta** ("elige tu
proteína") o de un **combo** ("elige tu bebida"). El **efecto** de cada opción sobre el sistema
(vender un producto, consumir un ingrediente) **se deriva del item de la opción**, no de un tipo
declarado en el grupo. Esto elimina la duplicidad de lógica que tendría un grupo tipado.

## Scope

**Incluido**
- Módulo `GruposModificadoresModule`: grupos a nivel tenant, con opciones y `precio_extra` por opción.
- Asociación de grupos a items (combo y receta) con `min` / `max` / `orden`.
- **Homogeneidad verificada**: las opciones de un grupo son todas de la misma familia de efecto
  (`ingrediente` | `vendible`), validado al guardar; no se persiste ningún tipo en el grupo.
- Elección en el drawer de personalización (POS y Salones), snapshot congelado en la línea.
- Consumo de inventario de las opciones elegidas al vender (efecto derivado del item).
- Regla fija de opciones agotadas; badge `Disponible*` en combos con grupos.
- CRUD de grupos en Configuración; sección "Grupos de modificadores" compartida por combo y receta en Items.
- Seed demo, tests unit + E2E, documentación viva.

**No incluido (futuro)**
- Recetas como opción de un grupo; combos anidados.
- Override de precio de una opción por item (aditivo a futuro, no requiere migración).
- Recargos negativos ("opción económica −$500"); descuentos por opción.
- Reglas de exclusión mutua, dependencias condicionales, modificadores anidados.
- `max` por opción individual (`max` es a nivel de grupo, en unidades totales).
- Canal **online** (tienda).

---

## Decisiones tomadas

| # | Decisión | Alternativa descartada | Razón |
|---|---|---|---|
| B1 | Grupo **sin tipo declarado**; el efecto se deriva del item de cada opción | grupo tipado `ingrediente`/`item` | el item ya conoce su tipo; tiparlo en el grupo es info duplicada que hay que mantener consistente |
| B2 | **Homogeneidad verificada** al guardar: todas las opciones de una misma familia (`ingrediente` \| `vendible`) | permitir mezclar; o declarar el tipo | reuso total en la asociación (mismo grupo va a combo o receta) sin el drawer mixto ambiguo |
| B3 | Grupos **reutilizables a nivel tenant**, con el precio en el grupo | grupos inline por item; override por item | resuelve editar el precio del pollo una vez; el override es aditivo a futuro |
| B4 | `min` / `max` por asociación item↔grupo, en **unidades totales** del grupo | `obligatorio` + `cantidad_a_elegir` | expresa estrictamente más ("hasta 3", "entre 2 y 5"); `obligatorio` = `min ≥ 1` |
| B5 | **Permitir repetir** la misma opción (2× Coca-Cola cuenta 2 unidades hacia `max`) | sin repetir; siempre 1 | pedido real; el stepper ya existe en el drawer |
| B6 | Precio de opción = **recargo ≥ 0** sobre el precio base | precio absoluto; recargos negativos | entra intacto al motor de precios; evita un camino de precio paralelo |
| B7 | Opción elegida de un grupo → **siempre bloqueante** al vender | reusar el flag `bloqueante` del componente | el cliente eligió chuleta; entregar el combo sin chuleta no es una opción |
| B8 | **Regla fija** de opciones agotadas (sin campo de config): `min ≥ 1` + cero stock ⇒ bloquea; `min = 0` ⇒ se salta | 3 modos configurables por grupo | no hay evidencia de necesitar los otros modos (YAGNI) |
| B9 | `orden` reusado para la comanda; secciones en orden fijo (elegidos → extras → omitidos) | `orden_impresion` separado | no hay evidencia de que la cocina necesite un orden distinto al de display |
| B10 | Una sola línea de venta por item, snapshot en `personalizacion` | línea + sublíneas | idéntico a receta/combo; mantiene reportes y notas de crédito coherentes |

---

## Modelo de datos

### `grupos_modificadores`

| Columna | Tipo | Notas |
|---|---|---|
| `grupo_modificador_id` | UUID PK | |
| `tenant_id` | UUID | del token |
| `nombre` | TEXT | único vivo por tenant |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | soft delete |

Índice único parcial: `(tenant_id, nombre) WHERE eliminado_el IS NULL`.
**Sin columna de tipo** — la familia de efecto se deriva de las opciones (ver §Homogeneidad).

### `grupo_modificador_opciones`

| Columna | Tipo | Notas |
|---|---|---|
| `grupo_opcion_id` | UUID PK | |
| `tenant_id` / `grupo_modificador_id` | UUID | |
| `item_id` | UUID | ingrediente o item vendible; su tipo define el efecto |
| `cantidad` | NUMERIC(18,4) | > 0, por unidad elegida |
| `unidad_codigo` | TEXT FK → unidades_medida, NULL | solo opciones de familia `ingrediente` |
| `precio_extra` | NUMERIC(18,4) | ≥ 0, default 0 |
| `orden` | INT | orden en el drawer y en la comanda |
| timestamps + `eliminado_el` | TIMESTAMPTZ | soft delete al reemplazar lista |

Índice único parcial: `(grupo_modificador_id, item_id) WHERE eliminado_el IS NULL`.

### `item_grupos_modificadores`

| Columna | Tipo | Notas |
|---|---|---|
| `item_grupo_id` | UUID PK | |
| `tenant_id` / `item_id` / `grupo_modificador_id` | UUID | |
| `min` | INT | default 1, ≥ 0. `min ≥ 1` ⇒ grupo obligatorio |
| `max` | INT | ≥ `max(min, 1)`; tope de **unidades totales** elegidas en el grupo |
| `orden` | INT | orden del grupo dentro del item (drawer y comanda) |
| timestamps + `eliminado_el` | TIMESTAMPTZ | |

Índice único parcial: `(item_id, grupo_modificador_id) WHERE eliminado_el IS NULL`.

Todas las columnas PK/FK UUID declaran `type: 'uuid'` explícito (ADR-004).

### Familia de efecto y homogeneidad

Cada item tiene una **familia de efecto** derivada de su `tipo`:
- **`ingrediente`** → item `tipo='ingrediente'` (consume inventario con conversión de unidad).
- **`vendible`** → item `tipo` ∈ `{producto, receta, servicio}` (unidad vendible entera).

Al guardar las opciones de un grupo, el backend verifica que **todas** sean de la misma familia.
No se almacena la familia en ninguna tabla: se deriva de los items y se **verifica**, no se declara.

### Snapshot en la línea

Se extiende el JSONB `personalizacion` existente (`cuenta_lineas.personalizacion`,
`venta_detalles.personalizacion`) con una clave nueva. `omitidos`, `extras` y `comentario`
quedan intactos.

```ts
grupos?: {
  grupoId: string
  grupoNombre: string          // congelado
  opciones: {
    itemId: string
    nombre: string             // congelado
    cantidad: string
    unidadCodigo?: string      // solo opciones de familia ingrediente
    precioExtra: string        // congelado al confirmar
    unidades: string           // ≥ 1
  }[]
}[]
```

### Reglas de integridad

- Grupo homogéneo: todas las opciones de la misma familia de efecto (verificado al guardar).
- Opción `ingrediente`: item `tipo='ingrediente'`, `modo_inventario='cantidad'`,
  `unidad_codigo` de la misma magnitud que su unidad base; `cantidad > 0`.
- Opción `vendible`: item `tipo` ∈ `{producto, receta, servicio}`; nunca `combo` ni `suscripcion`.
- Un grupo se asocia a items `tipo` ∈ `{combo, receta}` (no hay restricción por familia; el efecto
  se resuelve por item al vender).
- Un combo requiere al menos un componente fijo **o** un grupo asociado (relaja la regla del Ticket A).
- Soft delete bloqueado con `400` + nombres afectados cuando: el item es opción de un grupo vivo,
  o el grupo está asociado a items vivos.

---

## Backend

### Módulo nuevo `GruposModificadoresModule`

`src/modules/grupos-modificadores/` (controller, service, entidades, DTOs), registrado en
`app.module.ts`.

| Endpoint | Comportamiento |
|---|---|
| `GET /grupos-modificadores` | lista con opciones (item, cantidad, unidad, `precioExtra`, orden) y la familia derivada |
| `GET /grupos-modificadores/:id` | detalle |
| `POST /grupos-modificadores` | nombre + opciones; verifica homogeneidad, `modo_inventario` y unidad de cada opción |
| `PATCH /grupos-modificadores/:id` | reemplazo total de opciones (soft-delete + insert); mantiene la homogeneidad |
| `DELETE /grupos-modificadores/:id` | `400` si hay items vivos asociados, listando sus nombres |

`tenant_id` siempre del token, nunca del body.

### Extensiones a `ItemsModule`

Entidad nueva: `ItemGrupoModificador`.

- `POST/PATCH /items` con `tipo: 'combo'` o `tipo: 'receta'` acepta
  `gruposModificadores: [{ grupoModificadorId, min, max, orden }]`. Reemplazo total de asociaciones.
- `GET /items/:id` — combo y receta devuelven `grupos[]` con opciones resueltas y stock actual
  (alimenta el drawer).
- `GET /items?tipo=combo` — `disponible` sigue siendo el mínimo entre componentes fijos bloqueantes
  (Ticket A). Se agrega `disponibleCondicional: true` cuando el combo tiene grupos → el front
  muestra `Disponible*`.
- `DELETE /items/:id` — bloqueo según las reglas de integridad.

### Venta

`VentasService.crearEnTransaccion` delega en `ItemsService`, sin dependencias nuevas en Ventas:

- `venderComponentesCombo(...)` (del Ticket A) suma, por cada opción de `snapshot.grupos`, el mismo
  efecto que un componente × `unidades`: `producto` → `registrarMovimiento`; `receta` →
  `venderIngredientesReceta`; `ingrediente` → salida con conversión de unidad; `servicio` → nada.
- `venderOpcionesGrupoReceta(...)` — grupos en recetas: por cada opción, efecto derivado del item
  × `unidades` × cantidad vendida (para familia `ingrediente`, con `CatalogService.convertirUnidad`).

Semántica de fallo:

- **Opción elegida de un grupo → siempre bloqueante.** Sin stock ⇒ aborta la transacción.

### Validación del snapshot al vender

Por cada grupo asociado al item, sumando `unidades` de sus opciones elegidas:
- debe cumplirse `min ≤ Σ unidades ≤ max`; si no, `400`.
- `min = 0` ⇒ el grupo puede venir vacío o ausente.
- Opciones agotadas: si un grupo con `min ≥ 1` no tiene ninguna opción con stock, el item no es
  vendible (regla fija B8); el backend revalida stock al vender (no confía en el cliente).

### Precio

Línea = `precioBase + Σ (precioExtra × unidades)`, con `precioExtra` congelado en el snapshot. El
backend **revalida** ese cálculo contra el catálogo al vender y el resultado entra intacto al motor:
`precioNeto → descuentos → recargos → impuestos`. Todo con Decimal.js.

---

## Frontend

### Configuración → `pages/configuracion/grupos-modificadores.vue` (nueva)

CRUD del catálogo: tabla (nombre, familia derivada, N° de opciones, N° de items que lo usan) y
drawer de edición con filas de opciones. El selector de item **filtra por la familia de las
opciones ya agregadas**: con el grupo vacío se puede elegir cualquier item vendible o ingrediente;
tras la primera opción, el picker queda restringido a esa familia (homogeneidad guiada en la UI,
verificada en backend). Cada fila lleva su `precioExtra`; las de familia `ingrediente` piden
`cantidad` + `unidad` filtrada por magnitud.

### Configuración → Items (`pages/configuracion/items.vue`)

- Sección **"Grupos de modificadores"** compartida por Combo y Receta: se agregan grupos del catálogo
  y por cada uno se configura `min`, `max` y `orden`. Las opciones del grupo se muestran en solo
  lectura, con link a su página de edición.

### POS y Salones

- `RecetaPersonalizacionDrawer.vue` → `ItemPersonalizacionDrawer.vue`: mantiene omitidos / extras /
  comentario para recetas y suma una sección de **grupos** arriba. Cada grupo muestra su encabezado
  ("Bebida — elige 1" / "Toppings — 1 a 5"), sus opciones con recargo (`+$1.500`), stock, y stepper
  cuando `max > 1`. Opciones agotadas deshabilitadas; grupo con `min ≥ 1` sin ninguna opción con
  stock ⇒ no se puede confirmar, con mensaje explícito. El botón de confirmar muestra el precio final
  ya sumado y respeta `min`/`max` (no confirma fuera de rango).
- El drawer se abre para **cualquier item con grupos** (receta o combo). Un combo sin grupos y un
  producto se agregan con un click, como en el Ticket A.
- `CatalogoGrid.vue`: los combos con grupos muestran `Disponible*` con nota "La disponibilidad final
  depende de la opción elegida"; nunca bloquea el click.
- `useVenta.ts` y las líneas de cuenta extienden el snapshot con `grupos`. El merge de líneas en
  Salones ya compara la personalización completa, así que dos combos con distinta bebida no se
  fusionan — sin cambios.
- Formatos vía `useFormatters`; tokens semánticos de Nuxt UI, sin Tailwind hardcodeado.
- Sin `cargar()` post-mutación: el backend devuelve la entidad o patch mergeable.

### Impresión térmica

El texto derivado del snapshot suma las opciones elegidas, en el `orden` configurado, con secciones
en orden fijo (elegidos → extras → omitidos):
`Combo Familiar — Bebida: Coca-Cola ×2 / Postre: Brownie`.

---

## Verification

### Tests

- **Unit `grupos-modificadores.service.spec.ts`** — homogeneidad (rechaza mezclar ingrediente +
  vendible), unidad convertible, `precioExtra ≥ 0`, reemplazo total en PATCH, bloqueo de DELETE con
  items asociados.
- **Unit `items.service.spec.ts`** — asociación de grupos a combo y receta, `min`/`max` válidos,
  `disponibleCondicional` en combos con grupos, bloqueo de borrado de un item usado como opción.
- **Unit `ventas.service.spec.ts`** — combo con opción de grupo (efecto por item: producto/receta/
  ingrediente); opción elegida sin stock → aborta; snapshot fuera de `[min, max]` → 400; grupo
  `min ≥ 1` con todas las opciones agotadas → item no vendible; precio enviado por el cliente distinto
  al recalculado → prevalece el del backend.
- **E2E `grupos-modificadores.e2e-spec.ts`** — crear grupo → asociarlo obligatorio a un combo →
  vender eligiendo opción → verificar movimientos de inventario de cada componente y de la opción, y
  el total cobrado.

### Seed

`seeder.service.ts`, IDs con el patrón `550e8400-e29b-41d4-a716-446655440XXX` (siguiente número libre,
continuando desde el Ticket A):

- Grupo `Proteína` (familia `ingrediente`): carne +$0, pollo +$0, chuleta +$1.500, asociado a una
  receta "Hamburguesa Especial" que **no** lleva proteína fija (`min: 1, max: 1`).
- Grupo `Bebida` (familia `vendible`): Coca-Cola +$0, bebida premium +$800.
- Al "Combo Clásico" del Ticket A se le asocia el grupo `Bebida` obligatorio (`min: 1, max: 1`).

### Documentación (mismo commit que el código)

- `docs/features/grupos-modificadores.md` desde `TEMPLATE.md`, con link en `docs/README.md`.
- Fila en `docs/ESTADO.md`; reglas de negocio en `docs/PRODUCTO.md`.
- Nota en `docs/features/combos.md`, `docs/features/recetas.md` y
  `docs/features/personalizacion-recetas.md` apuntando a los grupos.
- **ADR nuevo**: grupos de modificadores reutilizables a nivel tenant, sin tipo declarado (efecto
  derivado del item, homogeneidad verificada), precio en el grupo sin override por item, `min`/`max`
  en unidades totales — con el trade-off aceptado y la nota de que el override es aditivo a futuro.

---

## Riesgos asumidos

- **Precio compartido entre items**: si el recargo de "carne" difiere entre hamburguesa y arepa, hay
  que crear dos grupos. Aceptado a cambio de no construir la tabla de overrides.
- **Cambiar el precio de una opción** no afecta ventas emitidas (snapshot congelado) ni líneas ya en
  el carrito; sí afecta las que se agreguen después.
- **`disponible` conservador** en combos con grupos: el badge `Disponible*` refleja solo los
  componentes fijos; el detalle fino se resuelve en el drawer.

---

## Related

- [Ticket A — Combos](2026-07-20-combos-design.md) — item combo y componentes fijos (dependencia)
- [recetas.md](../../features/recetas.md) — item compuesto que descuenta ingredientes
- [personalizacion-recetas.md](../../features/personalizacion-recetas.md) — drawer y snapshot que se extienden
- [conversion-unidades.md](../../features/conversion-unidades.md) — conversión en el consumo de opciones ingrediente
- [inventario-kardex.md](../../features/inventario-kardex.md) — movimientos de salida
- [motor-calculo-precios.md](../../features/motor-calculo-precios.md) — dónde entra el recargo
