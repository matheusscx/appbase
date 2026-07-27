# ADR-016: Costeo por promedio ponderado móvil (CPP), método fijo, de gestión

**Status**: Accepted

**Date**: 2026-07-26

## Context

`item_producto.costo_actual` era el **último costo**: lo pisaba cualquier entrada con
`motivo='compra'` que trajera `costoUnitario`, sin promediar contra el stock que ya
existía a otro precio. Eso no es un método de valorización — es un dato de referencia
(*last cost*) que ningún POS maduro usa como base de margen o COGS (Lightspeed, Odoo,
Square usan promedio ponderado o capas FIFO). Una compra puntual a precio atípico
corrompía el margen de todo el stock remanente, ensuciando tres features ya construidas:
food-cost de recetas, valorización de mermas y el simulador de impacto de costos.

Además existía una puerta trasera: `PATCH /items/:id` aceptaba `dto.costo` y lo escribía
directo en `costo_actual` sin generar movimiento de inventario — sin rastro de quién lo
cambió ni por qué. Arreglar el método de cálculo sin cerrar esa puerta no serviría: el
promedio recién calculado se pisaría igual.

La investigación de mercado (`docs/agent/investigaciones/2026-07-26-inventario.md` §1)
cruzó el hueco contra Lightspeed, Odoo, Square y la normativa chilena, y dejó abierta una
pregunta de negocio que no se podía auto-resolver: si el costo es de gestión (margen,
food-cost, mermas) o si el sistema pretende ser la fuente de la valorización tributaria
de existencias que el tenant declara — son diseños distintos. El owner cerró esa
pregunta el 2026-07-26 (spec de diseño,
`docs/superpowers/specs/2026-07-26-costeo-cpp-design.md` §2.3).

## Decision

Se implementa **costo promedio ponderado móvil (CPP)**, como **método único y fijo**
(no elegible por tenant), y se declara explícitamente que **el costo es de gestión, no
el número tributario final**.

### 1. CPP, no FIFO

FIFO exige capas de costo con consumo registrado (cada recepción es una capa, la salida
consume la más antigua). En modo `cantidad` — donde cae la mayoría de los productos del
catálogo — no hay capas naturales: `item_producto.stock` es un escalar. Construir capas
solo para ese modo es una estructura nueva sin datos productivos que la justifiquen.

Además, FIFO rompe el supuesto de "un costo por producto" del que ya dependen
`item_receta.costo_actual`, `item_combo.costo_actual` (ambos suman/derivan un único
costo escalar de sus componentes) y el simulador de impacto de costos. CPP es
exactamente eso: un escalar que se recalcula, y encaja sin cambios en la columna
`NUMERIC(18,4)` que ya existe.

### 2. Método fijo, no elegible por tenant

En Chile la elección del método (FIFO o CPP, art. 30 LIR) es del contribuyente y debe
mantenerse por 5 años una vez elegida (jurisprudencia SII Ord. N° 3190/2015) — el mismo
patrón de inmutabilidad que ya aplicamos a `modo_inventario` (ADR-007). Pero sin tenants
productivos operando hoy, agregar esa elección ahora es costo de diseño sin beneficio
verificable: no hay dato real que proteja la inmutabilidad. Si más adelante hace falta
FIFO, se agrega la columna y el branch de cálculo sin tener que migrar a nadie — es la
misma lógica de YAGNI que ya aplica ADR-010 a la infraestructura DTE.

### 3. El costo es de gestión, deliberadamente compatible con lo tributario

El costo existe para calcular margen, food-cost y valorizar mermas — no para ser la
declaración de existencias que el tenant presenta al SII. Eso lo decide y produce el
contador, no este sistema. La razón de fondo, no solo la preferencia del owner: el
**art. 41 N°3 de la Ley de la Renta** obliga a corregir las existencias a **costo de
reposición** al cierre del balance. Un reporte de existencias valorizadas construido acá
**no sería el número tributario final de todos modos** — sería, en el mejor de los
casos, un insumo del contador. Construirlo como si fuera la respuesta sería falsa
precisión.

La compatibilidad con lo tributario se logra sin asumir ese rol: usando un método que el
SII admite (CPP, art. 30 LIR) para que el kardex le sirva de punto de partida al
contador si lo necesita. Es la misma forma que **ADR-010**: congelar el hecho en la
transacción (acá, el costo de cada movimiento), diferir lo que solo formatea o
transmite (acá, la corrección monetaria y el reporte de existencias valorizadas — fuera
de alcance).

### 4. Consecuencia de diseño: una sola puerta de escritura

`item_producto.costo_actual` **solo cambia como consecuencia de un movimiento en
`movimientos_inventario`**, registrado por `InventarioService.registrarMovimiento`. Tres
productores, ninguno más:

| Productor | Recalcula vía |
|---|---|
| Creación del item con costo de apertura | INSERT + movimiento `inventario_inicial` (congela, no promedia) |
| Compra con `costoUnitario` | fórmula CPP: `(stock_anterior × costo_actual + cantidad × costo_compra) / (stock_anterior + cantidad)` |
| Ajuste de costo (`motivo='ajuste_costo'`, `tipo='ajuste'`) | override directo, auditado con `costo_anterior` y comentario obligatorio |

La puerta trasera de `PATCH /items/:id` se cierra: el campo `costo` del DTO de edición
ahora rechaza siempre con un mensaje explícito en vez de aceptarse en silencio (ver
`docs/agent/anti-patterns.md`, "campo que escribe estado derivado sin pasar por su
choke point"). El test de invariante
`backend/src/common/invariants/costo-stock-choke-point.invariant.spec.ts` corre en el
gate y en CI: falla si cualquier archivo fuera de `inventario.service.ts` (o el seeder)
contiene un `UPDATE` de `item_producto` que asigna `costo_actual` (el mismo archivo
también vigila `stock`, cerrado por el mismo patrón — ver
`docs/agent/anti-patterns.md`).

## Consequences

### Positive

- El margen, el food-cost de recetas y la valorización de mermas dejan de corromperse
  por una compra puntual a precio atípico: el costo refleja el promedio real del stock,
  no la última transacción.
- Existe una vía legítima y auditada para corregir un costo mal cargado
  (`ajuste_costo`), sin obligar a inventar una compra falsa que ensuciaría stock y costo
  a la vez — mismo criterio que ya se usó con las mermas (de ajuste anónimo a operación
  con motivo explícito).
- El kardex queda compatible con un método que el SII admite, sin construir
  infraestructura de valorización tributaria especulativa antes de que exista la
  necesidad real (ningún tenant productivo hoy).
- La regla es verificable en CI, no solo documentada: la puerta trasera no puede volver
  sin que el test de invariante la detecte.

### Negative

- Si en el futuro un tenant necesita FIFO o elegir método, hace falta una columna nueva,
  un branch de cálculo adicional y una migración de datos existentes — hoy se evita ese
  costo, pero no desaparece, se difiere.
- El sistema no puede ofrecer un reporte de existencias valorizadas como número
  tributario final por sí mismo; quien lo necesite depende de que el contador aplique la
  corrección del art. 41 N°3 LIR por fuera.

### Neutral

- `item_producto.costo_actual` no cambia de tipo ni de nombre de columna — cambia su
  semántica (de "último costo" a "promedio ponderado móvil"). Documentado en el
  comentario del esquema (`startup-pos.sql`) y en `docs/features/inventario-kardex.md`.
- El recuento de inventario (eje 4 de la investigación) y el *landed cost* (eje 3) quedan
  fuera de alcance de este ADR; `ajuste_costo` reserva `tipo='ajuste'` para que el futuro
  `motivo='recuento'` entre por la misma puerta en vez de inventar un eje nuevo.

## Referencias

- Investigación de mercado: [`docs/agent/investigaciones/2026-07-26-inventario.md`](../agent/investigaciones/2026-07-26-inventario.md) §1, §6.1
- Spec de diseño: [`docs/superpowers/specs/2026-07-26-costeo-cpp-design.md`](../superpowers/specs/2026-07-26-costeo-cpp-design.md)
- Feature doc: [`docs/features/inventario-kardex.md`](../features/inventario-kardex.md)
- [ADR-007](./007-inventario-serie-lote.md) — precedente de inmutabilidad de un eje de configuración (`modo_inventario`)
- [ADR-010](./010-preparacion-sii-datos-fiscales.md) — misma forma de congelar el hecho y diferir lo que solo formatea/transmite
