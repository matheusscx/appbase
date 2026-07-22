# Diseño: grupos de modificadores anidados en combos (un nivel)

**Fecha:** 2026-07-22
**Estado:** Diseño aprobado — listo para plan de implementación
**Feature relacionada:** [combos.md](../../features/combos.md), [grupos-modificadores.md](../../features/grupos-modificadores.md)

---

## Problema

Un combo con un componente **receta** que a su vez tiene su propio grupo de
modificadores **no expone ese grupo al vender**. Ejemplo real que lo disparó:

- "Combo Clásico" = Hamburguesa Clásica (receta) + Bebida (grupo del combo).
- La "Hamburguesa Clásica" tiene su propio grupo "Proteína".
- Al agregar el combo al carrito aparece la elección de Bebida (grupo del
  combo ✓) pero **no** la de Proteína (grupo del componente ✗) — no se puede
  elegir la proteína.

### Causa raíz (no es un bug, es capacidad no construida)

`GET /items/:id` (combo) arma `grupos[]` solo con los grupos asociados
**directamente al combo** (`item_grupos_modificadores WHERE item_id = <combo>`).
Los `componentes[]` se cargan aparte y nunca traen sus propios grupos. El camino
de venta (`resolverPersonalizacionCombo`) hace lo mismo. No hay recursión: el
combo nunca mira dentro de sus componentes. Los "grupos anidados" estaban
explícitamente fuera de alcance en ambos feature-docs.

## Alcance (decisiones del owner, cerradas)

- **Automático (estilo Square):** cualquier componente receta que tenga grupos
  los expone al vender el combo, sin configuración extra.
- **Por unidad:** un componente con `cantidad = N` pregunta N veces; las
  elecciones son independientes (2 hamburguesas → una proteína por cada una,
  pueden ser distintas). El snapshot y el stock trackean por unidad.
- **Solo recetas:** hoy solo recetas (y combos) pueden tener grupos; un
  `producto` puro no. "Topping del helado" funciona si el helado es receta.
  Habilitar grupos en productos queda **fuera de alcance** (se evalúa después).
- **Un nivel de profundidad:** combo → componente receta → sus grupos. No más
  hondo (coincide con el tope de Toast/Square; ver Investigación).

## Investigación de mercado (insumo, no verdad — cruzado contra el código)

- **Square:** "si los ítems dentro de un combo tienen modificadores, esos
  modificadores se siguen mostrando y aplicando"; el combo es **una línea**,
  upcharge por opción. Es exactamente el comportamiento pedido.
  ([fuente](https://squareup.com/help/us/en/article/8558-create-and-sell-combos))
- **Toast:** modela "modificar un modificador" hasta **un nivel**; avisa que
  "si un modificador tiene selecciones anidadas, elegir varios del de arriba no
  está soportado" (complejidad).
  ([fuente](https://doc.toasttab.com/doc/platformguide/adminAddingModifierGroupsAndModifiers.html))
- **Convergencias que adoptamos:** (1) una sola línea de venta con las
  elecciones congeladas como snapshot; (2) precio = base + upcharge por opción;
  (3) profundidad un-nivel.
- **Lo que NO copiamos:** Square no cuesta modificadores para inventario;
  nosotros **sí** descontamos stock por opción (`venderOpcionesGrupos`, siempre
  bloqueante) y lo mantenemos.

## Enfoque elegido — reusar la maquinaria de grupos por componente-unidad

`resolverGruposDeItem(manager, tenantId, itemId, gruposDto)` **ya es agnóstico
del item**: resuelve los grupos de cualquier item por su propio
`item_grupos_modificadores` y devuelve `{ grupos, precioExtraTotal }`. Sirve tal
cual para un componente pasándole su `itemId`. El recargo viaja por
`precioExtraTotal`, que el motor de ventas ya suma a la línea → **el motor de
precios (`calculo-precios.engine.ts`) no se toca**. El descuento de stock por
opción ya existe (`venderOpcionesGrupos`).

**Cero tablas nuevas.** Los grupos del componente ya existen como la asociación
propia de esa receta. Solo se agrega: dimensión en el snapshot, lectura, loop de
venta, DTO y render del drawer.

Enfoques descartados: **aplanar** los grupos del componente como "grupos
virtuales del combo" con claves sintéticas (pierde atribución, ensucia merge e
impresión); **tabla de curaduría** con min/max propios del combo (contradice la
decisión "automático", YAGNI).

---

## Diseño por componente

### 1. Modelo de snapshot (`personalizacion-receta.dto.ts`)

Extensión **opcional y aditiva** a `PersonalizacionRecetaSnapshot` (cero
migración; snapshots viejos siguen válidos):

```ts
componentes?: {
  componenteItemId: string;
  componenteNombre: string;
  unidad: number;            // 1..cantidad del componente
  grupos: SnapshotGrupo[];   // MISMA forma ya existente, reusada
}[];
```

Una entrada por (componente, unidad) con elección. El DTO de entrada
(`PersonalizacionRecetaDto`) gana el espejo:
`componentes?: { componenteItemId, unidad, grupos: PersonalizacionGrupoInputDto[] }[]`.

### 2. Lectura — `GET /items/:id` (combo)

A cada componente **receta** se le adjunta `grupos` (misma forma que los grupos
del combo: opciones con `COALESCE(override, default)`, `stock`, `esPendiente`).
Carga **batched** para no disparar N+1:

- Query 1: `item_grupos_modificadores` con `item_id = ANY($componentRecetaIds)`.
- Query 2: opciones de esos `grupo_modificador_id` con el `LEFT JOIN` de override
  por `item_grupo_id`.

Toda query nueva filtra `eliminado_el IS NULL`. `disponibleCondicional` del combo
pasa a `true` si el combo tiene grupos **o** algún componente los tiene (ajustar
también el batch de `findAll` que hoy marca `disponibleCondicional`).

### 3. Venta — `resolverPersonalizacionCombo` + stock

`resolverPersonalizacionCombo`:
- Resuelve los grupos propios del combo (sin cambios).
- **Nuevo:** por cada `dto.componentes[]`, llama a
  `resolverGruposDeItem(manager, tenantId, componenteItemId, grupos)`.
- **Validaciones de seguridad/consistencia** (antes de resolver):
  - `componenteItemId` debe ser un componente **vivo** de ESTE combo (cargar
    `combo_componentes` del combo y verificar pertenencia — el front no puede
    inyectar grupos de items arbitrarios).
  - `unidad ∈ 1..cantidad` del componente; sin `unidad` duplicada por componente.
- Suma `precioExtraTotal` de combo + todos los componentes-unidad (Decimal.js) →
  canal de recargo existente → motor de precios intacto.
- Congela `snapshot.componentes` con la forma de arriba.

**Stock** (`venderComponentesCombo` / camino de venta del combo): además del
descuento actual por componente (producto→salida, receta→
`venderIngredientesReceta` de ingredientes fijos, servicio→nada), por cada
componente-unidad con grupos congelados se llama a `venderOpcionesGrupos`
(siempre bloqueante) → descuenta la opción elegida (la proteína) por unidad.

**Sin doble conteo:** la opción de grupo es un item aparte (ingrediente proteína),
no un ingrediente fijo de la receta — misma invariante que vender la receta
suelta. *Cuidado de datos:* si una receta lleva la proteína como ingrediente
fijo **y** como grupo, se descontaría dos veces; es responsabilidad de modelado
del tenant (igual que hoy con la receta standalone), no un caso que este diseño
introduzca.

### 4. Frontend — drawer + cambio de UX

`components/ventas/ItemPersonalizacionDrawer.vue`:
- Combo: grupos propios (bebida) + por cada componente receta con grupos, su
  bloque **repetido `cantidad` veces**, etiquetado por unidad
  ("Hamburguesa #1", "Hamburguesa #2").
- **Selector en vez de radio buttons** (requisito de UX — la vista con radios
  crece demasiado): `USelect`/`USelectMenu` de Nuxt UI, **simple** cuando
  `max === 1`, **múltiple** cuando `max > 1`. Exige `min ≤ Σunidades ≤ max` por
  grupo/unidad antes de habilitar "Agregar". Opciones *pendientes*
  (`esPendiente`) ocultas (como hoy).
- Merge en Salones: la clave de merge incluye componente/unidad/opción → dos
  combos con proteínas distintas no se mergean.
- `composables/useRecetaPersonalizacion.ts` (espejo de UX): resuelve grupos de
  componente por unidad; arma el payload `personalizacion.componentes`. El
  backend revalida igual (nunca confía en el precio del front).

> Al implementar el front: invocar el skill de Nuxt UI y correr `design:check`
> (tokens). El cambio radio→selector aplica también a los grupos ya existentes
> de recetas/combos, no solo a los anidados.

---

## Invariantes y zonas sensibles

- **Respetadas:** Decimal.js en toda suma de recargo; soft-delete filtrado en
  cada query nueva; sin N+1 (batch en lectura); `tenant_id` del token; stock por
  opción siempre bloqueante (regla ya existente).
- **No se toca:** motor de cálculo de precios, sistema de tokens JWT, modelo de
  datos (cero tablas nuevas — solo forma del JSON de `personalizacion`).
- **Stock:** el descuento por opción reusa `venderOpcionesGrupos` dentro de la
  misma transacción de venta (movimiento + saldo atómicos, como ya es).

## Documentación a actualizar (mismo commit que el código)

| Archivo | Cambio |
|---|---|
| `docs/features/grupos-modificadores.md` | Anidamiento un-nivel: combo expone grupos de componentes receta, automático, por unidad |
| `docs/features/combos.md` | Nota: la personalización del combo ahora incluye los grupos de sus componentes |
| `docs/PRODUCTO.md` | Regla de negocio: elección por unidad de componente al vender un combo |
| `docs/adr/` | ADR nuevo (o extensión de ADR-013): decisión automático + por unidad + un nivel + cero tablas |
| `docs/ESTADO.md` | Fila actualizada |
| `frontend/docs/DESIGN-SYSTEM.md` | Si el cambio radio→selector fija un patrón nuevo de elección |

## Testing

- **Unit** (`items.service.spec.ts`): resolución de grupos de componente por
  unidad; suma de recargo combo + componentes; min/max por unidad; rechazo de
  `componenteItemId` que no es componente vivo del combo; rechazo de `unidad`
  fuera de rango o duplicada.
- **E2E** (`combos.e2e-spec.ts`): vender un combo con componente receta que tiene
  grupo; elegir proteína distinta por unidad (cantidad ≥ 2); verificar stock
  descontado por unidad y upcharge sumado al total de la línea.

## Casos borde cubiertos

- Componente `cantidad = 1`: una sola pregunta por ese componente.
- Componente sin grupos: no aparece en `componentes[]`; se comporta como hoy.
- Combo solo con grupos propios (sin componentes con grupos): idéntico a hoy.
- Snapshot viejo sin `componentes`: válido, se lee como combo sin elección de
  componente (retrocompatibilidad).
- Opción *pendiente* (sin cantidad efectiva): oculta en el drawer, rechazada por
  `resolverGruposDeItem` si llega elegida (comportamiento ya existente reusado).

## Fuera de alcance (futuro)

- Grupos en `producto` puro (sin ser receta).
- Anidamiento de más de un nivel.
- Curaduría por combo (min/max propios del combo sobre el grupo del componente).
- Impresión térmica de la opción elegida por componente (el snapshot ya congela
  todo lo necesario; es cambio de plantilla, diferido igual que hoy).
