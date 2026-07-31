# ADR-018: El IVA se deriva de `clasificacion_tributaria`, nunca se materializa en `item_impuestos`

**Status**: Accepted

**Date**: 2026-07-31

## Context

ADR-011 separó `impuestos.tipo` en `'iva'` | `'otro'` y agregó
`items.clasificacion_tributaria` (`'afecto'` | `'exento'`) como estado fiscal explícito,
pero las dos cosas quedaron **independientes**: la clasificación no obligaba nada sobre
qué filas tenía asociadas un ítem en `item_impuestos`. El default de la clasificación es
`'afecto'` y el selector de impuestos del formulario arranca vacío, así que el camino por
default creaba un ítem declarado afecto que se vendía sin IVA — exactamente el estado
inverso al que ADR-010/ADR-011 ya se habían cuidado de impedir ("exento" nunca es
ausencia de impuesto). Además, el motor aceptaba que la línea de venta pisara los
impuestos del ítem con `impuestoIds: []`, así que aunque el ítem tuviera el IVA asociado
correctamente, un `POST /ventas` podía seguir vendiéndolo sin IVA.

## Decision

El IVA **no se guarda** en `item_impuestos`. Se deriva en `resolverLinea`
(`calculo-precios.service.ts`), sobre la lista de impuestos ya resuelta de la línea —venga
del ítem o pisada por el payload—: si `item.clasificacionTributaria === 'afecto'`, se
agrega la fila `tipo='iva'` del país del tenant; si es `'exento'` o `null`, no. La
condición es **positiva** (`=== 'afecto'`), no la negación del filtro que ya existía
(`!== 'exento'`): con la columna nullable, un `!==` dejaría pasar un `NULL` y le cobraría
IVA a un ítem sin tratamiento fiscal (un `tipo='ingrediente'`).

`item_impuestos` cambia de significado: pasa a contener **solo los impuestos
adicionales** (`tipo='otro'`) que el usuario asoció; el IVA nunca vive ahí. El motor
además saca cualquier `tipo='iva'` que venga en la lista resuelta, del ítem o pisado por
la línea — es defensa contra datos viejos, no el contrato: el contrato es el 400 de la
API (`items.service.ts` → `validarImpuestos`, y su gemelo en `ventas`/simulador de
precios) cuando el cliente manda un `tipo='iva'` explícito. Los dos mecanismos conviven a
propósito: uno cierra la entrada, el otro cubre lo que ya está en la base.

`items.clasificacion_tributaria` pasa a **nullable** —un `tipo='ingrediente'` se guarda
con `NULL` porque no se vende y no tiene tratamiento fiscal— **pero conserva
`DEFAULT 'afecto'`**. Las dos cosas resuelven problemas distintos y son complementarias,
no alternativas:

- La condición **positiva** de lectura (`=== 'afecto'`) protege la **lectura**: un `NULL`
  ya existente en la base nunca deriva IVA por accidente.
- El `DEFAULT 'afecto'` protege la **escritura**: sin él, omitir la columna en un `INSERT`
  produciría un `NULL`, y ese ítem se vendería sin IVA en silencio — el mismo agujero que
  esta decisión cierra, reabierto por otro camino. Sacar el default invierte el modo de
  fallar: en vez de que el olvido esté en la lectura (visible, no toca la plata), vuelve a
  estar en la escritura (plata mal cobrada, en silencio).

### Por qué derivar y no materializar

La alternativa era auto-asociar la fila de IVA en `item_impuestos` al crear/editar el
ítem. Se descartó por el modo de fallar, no por elegancia: materializando, el olvido en
un camino de escritura nuevo (presente o futuro) produce un ítem que se vende sin IVA, en
silencio. Derivando, el olvido queda en un solo lugar —el motor— y cualquier lectura vieja
de `item_impuestos` que asuma "acá está todo lo que se cobra" muestra de menos, visible,
sin mover la plata mal.

### Por qué no puede haber ambigüedad sobre "cuál es el IVA"

`impuestos.tipo` tiene default `'otro'` y **no se expone en `CreateImpuestoDto` ni en
`UpdateImpuestoDto`**: un tenant no puede crear un impuesto `tipo='iva'` por la API. La
única fila `'iva'` la siembra el seeder, una por país. Por eso no puede existir más de una
fila `'iva'` visible por tenant, y el motor no necesita desambiguar entre varias.

**Esta decisión se apoya en esa invariante emergente. Si `impuestos.tipo` se expone
alguna vez en la API de escritura de impuestos, este ADR se revisa primero** — la
derivación deja de tener un único candidato sin ambigüedad.

## Consequences

### Positive

- Una sola fuente de verdad: la clasificación decide el IVA, no dos estructuras que
  sincronizar en cada camino de escritura presente y futuro.
- Cierra las dos puertas del agujero original: el ítem sin IVA asociado por default, y la
  línea de venta que pisa los impuestos del ítem con una lista vacía.
- No cuesta una query nueva: `impuestoMap` ya se arma con el catálogo completo del tenant
  (`ImpuestosService.findAll`), IVA del sistema incluido.

### Negative

- `item_impuestos` cambia de significado respecto de lo que decía ADR-011 y la doc previa
  de la feature: un lector nuevo que asuma que ahí está *todo* lo que se le cobra al ítem
  muestra de menos. Mitigado en `docs/features/impuestos.md` y en el comentario de la
  tabla.
- Un tenant puede seguir nombrando "IVA" a un impuesto propio (`tipo='otro'`, porque
  `tipo` no se expone) con el mismo porcentaje que el oficial, y quedaría sumado al IVA
  derivado (doble tributación). Lo evita el seeder con soft delete de esos duplicados por
  nombre+porcentaje (`remapImpuestosOficialesDuplicados`) — solo cubre los que matchean
  ese heurístico, no un "I.V.A. 19" con otra grafía.
  **No se bloquea por código y es deliberado** (owner, 2026-07-31): el tenant es dueño de
  su catálogo de impuestos, y una heurística de nombre en `ImpuestosService.create` le
  prohibiría nombrar como quiera con falsos positivos garantizados. La defensa es que
  sepa que el IVA ya se aplica solo: los placeholders del formulario dejaron de sugerir
  `"IVA"`/`"0.19"`, y hay un `AppInfoButton` en el campo Nombre de
  `configuracion/impuestos.vue` —donde se comete el error— y otro en Clasificación
  tributaria de `configuracion/items.vue`. Explicar, no bloquear.

### Neutral

- `remapImpuestosOficialesDuplicados` cambió de propósito: ya no reapunta la asociación
  del duplicado hacia el IVA oficial (eso era inofensivo —esa fila es `tipo='iva'` y el
  motor la descarta antes de derivar— pero quedó sin sentido, porque el IVA ya no se
  asocia). Lo que evita la doble tributación es el **soft delete del duplicado**, que sí
  sigue haciendo falta porque el duplicado es `tipo='otro'` y el motor no lo filtra.

## Related

- [ADR-010](./010-preparacion-sii-datos-fiscales.md) — "exento" como estado fiscal
  explícito, nunca ausencia de dato.
- [ADR-011](./011-catalogo-impuestos-sistema.md) — catálogo de impuestos del sistema y
  separación `tipo='iva'` / `tipo='otro'`; esta decisión no la reemplaza, decide algo
  distinto encima.
- [`docs/features/impuestos.md`](../features/impuestos.md) — detalle operativo del motor
  y las tablas.
