# ADR-012: Combos con precio propio fijo, una línea de venta, sin conocimiento de inventario

**Status**: Accepted

**Date**: 2026-07-20

## Context

El catálogo food-service necesitaba paquetes de venta (ej. "Combo Clásico" =
Hamburguesa Clásica + Papas) vendidos a un precio propio distinto de la suma de
sus piezas sueltas. El sistema ya modela dos formas de item compuesto que
descuentan stock ajeno en vez de tener stock propio: `producto` (stock propio),
`receta` (descuenta ingredientes, ver ADR implícito en `docs/features/recetas.md`).
Un combo necesitaba una tercera variante: un contenedor de componentes fijos
(producto, receta o servicio) que se cobra como una unidad, no como la suma de
sus partes.

Tres decisiones de diseño quedaban abiertas:

1. ¿El precio del combo se deriva de sus componentes o es un campo propio?
2. ¿Vender un combo genera una línea de venta por combo, o se explota en una
   línea por componente?
3. ¿Dónde vive la lógica de "qué le pasa al inventario cuando se vende un
   componente de tipo X" — en el módulo de combos, o en el motor de venta?

## Decision

### (a) Precio propio fijo, `costo_actual` es la única suma derivada

`items.precio_base` del combo se fija manualmente por el tenant al crear o
editar el combo, exactamente igual que cualquier otro item — el sistema **no**
lo calcula a partir del precio de los componentes. Solo `item_combo.costo_actual`
(cacheado, igual patrón que `item_receta.costo_actual`) es la suma —
`Σ(costo_actual del componente × cantidad)` — y esa suma alimenta únicamente
métricas de margen, nunca el precio de venta.

**Alternativa descartada:** calcular `precio_base` como suma de precios de
componentes con un descuento configurable. Se descarta porque el precio de un
combo en food-service casi nunca es aritmético (es una decisión comercial:
"$4.200 el combo" no tiene por qué relacionarse linealmente con vender pan,
carne y papas por separado), y porque introduciría un acoplamiento innecesario
entre el precio de un item compuesto y los precios — que cambian con
frecuencia — de sus piezas sueltas.

### (b) Una línea de venta por combo, no N líneas por componente

Un combo vendido genera **una sola línea** en `venta_detalles`, al precio del
combo. El efecto sobre el inventario de cada componente ocurre **por debajo**,
como movimientos de `movimientos_inventario`, dentro de la misma transacción,
pero no como líneas de venta adicionales. El total cobrado y el desglose visible
al customer reflejan el combo como una unidad — igual que una receta ya se
vende como una línea, no como líneas por ingrediente.

**Alternativa descartada:** explotar el combo en una línea por componente al
vender (ej. una línea "Hamburguesa" + una línea "Papas", ambas con precio 0 y
una línea "Combo" con el precio total). Se descarta: multiplica el número de
líneas por venta sin necesidad real hoy (ni boleta, ni reportes, ni comanda
requieren el desglose como líneas independientes — la comanda de cocina ya
imprime el nombre del combo como una línea normal, igual que una receta imprime
su nombre y no sus ingredientes), y complica cualquier código que asuma "una
línea = un item vendido a su precio".

### (c) El combo no conoce reglas de inventario — el motor de venta decide

`ItemsService.venderComponentesCombo` (llamado desde `VentasService`, no al
revés) itera los componentes y aplica el efecto según el `tipo` de cada uno:
`producto` → un movimiento de salida directo; `receta` → delega en
`venderIngredientesReceta` (reutilizado, no reimplementado); `servicio` → sin
efecto. El módulo de combos (`combo_componentes`, `item_combo`) solo persiste
"qué componentes, en qué cantidad, con qué criticidad" — no contiene lógica de
qué significa "descontar stock" para cada tipo; esa lógica vive donde ya vivía
antes de que existieran los combos (`InventarioService`, la receta).

**Alternativa descartada:** que `item_combo`/`combo_componentes` tuvieran su
propia lógica de descuento de stock, duplicando lo que `producto` y `receta` ya
resuelven. Se descarta por duplicación directa: un combo con un componente
receta necesitaría reimplementar la expansión a ingredientes, conversión de
unidades y la semántica bloqueante/no-bloqueante que `recetas` ya tiene
probada.

### (d) `disponible` conservador: solo componentes fijos bloqueantes

Igual que en recetas, `disponible` en el listado es el mínimo entre
`floor(stock_o_disponible_del_componente / cantidad)` de los componentes
**bloqueantes**; un componente `servicio` se ignora (no tiene stock);
`null` si no hay componentes bloqueantes. No pondera componentes no
bloqueantes — mostrar disponibilidad limitada por un componente que la propia
venta va a ignorar si falta stock sería engañoso en sentido contrario (más
restrictivo de lo real, no menos).

## Consequences

### Positive

- El precio de un combo es una decisión comercial explícita, sin dependencia
  frágil de los precios de sus componentes (cambiar el precio de "Papas" no
  cambia el precio del "Combo Clásico" por accidente).
- Cero duplicación de lógica de inventario: un combo con componente receta
  reutiliza `venderIngredientesReceta` tal cual, incluyendo su semántica
  bloqueante/no-bloqueante y la conversión de unidades.
- Reportes, boleta y comanda no requieren cambios: un combo es una línea normal
  con su propio nombre y precio, como cualquier item.
- `disponible` sigue el mismo contrato que recetas (`number | null`,
  conservador), sin una nueva forma de dato que el frontend deba aprender.

### Negative

- `item_combo.costo_actual` es una foto cacheada: si cambia el costo de un
  componente (ej. sube el costo de la Hamburguesa), el costo del combo no se
  actualiza solo — requiere editar el combo. Mismo trade-off aceptado ya en
  recetas (`docs/features/simulador-impacto-costos.md` cubre el caso de
  recetas, no el de combos todavía).
- Sin desglose por línea del combo en boleta/comanda, un reporte que necesite
  saber "cuántas Papas se vendieron sueltas vs. dentro de un combo" no puede
  responderse solo con `venta_detalles` — requeriría cruzar
  `movimientos_inventario` (que sí registra el movimiento por componente con
  `venta_id`).

### Neutral

- Grupos de modificadores (combos con elección) quedan fuera de este ADR y de
  esta implementación — es un modelo de datos distinto (grupos, opciones,
  selección del customer) que se evaluará en un ticket separado ("Ticket B").
  Este ADR y su implementación cubren exclusivamente combos de componentes
  fijos.
- No se permiten combos anidados (un combo como componente de otro combo) —
  restricción de validación simple (`tipo` del componente debe ser
  `producto | receta | servicio`), no un problema de modelo de datos que
  requiera una decisión aparte.
