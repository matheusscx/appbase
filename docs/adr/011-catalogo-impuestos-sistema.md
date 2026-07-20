# ADR-011: Catálogo de impuestos del sistema por país + semántica de "exento" (solo IVA)

**Status**: Accepted

**Date**: 2026-07-19

## Context

Los impuestos eran un CRUD 100% por tenant (`impuestos.tenant_id NOT NULL`): cada
tenant chileno creaba su propio "IVA 19%", incluido el seeder (que sembraba un IVA
distinto por tenant). Sin estandarización por país, esto significa: N filas
idénticas de IVA en la BD, sin garantía de que coincidan en porcentaje, y ningún
lugar único que represente "el IVA de Chile".

Además, "exento" no existía como estado explícito en los items: hoy sería
equivalente a "no tiene fila en `item_impuestos`", lo cual es ambiguo entre
"exento por ley" y "afecto pero a alguien se le olvidó asignar el impuesto".
ADR-010 ya fija la regla transversal de que un hecho fiscal debe capturarse y
congelarse explícitamente en el momento de la transacción, nunca inferirse de una
ausencia de datos.

Se necesitaba: (1) un catálogo de impuestos oficiales por país, compartido por
todos los tenants de ese país, conviviendo con impuestos personalizados por
tenant; (2) una clasificación tributaria explícita en los items (`afecto` |
`exento`); (3) una regla de motor clara sobre qué suprime "exento".

## Decision

### (a) Modelado: misma tabla `impuestos`, con `tenant_id`/`pais_id` excluyentes

`impuestos.tenant_id` pasa a **nullable** y se agrega `pais_id` (UUID, nullable,
FK a `pais`), con un `CHECK` que obliga a que exactamente uno de los dos sea
no-nulo:

```sql
CHECK (("tenant_id" IS NULL) <> ("pais_id" IS NULL))
```

- **Sistema:** `(tenant_id NULL, pais_id set)` — ej. IVA Chile, `tipo = 'iva'`,
  `porcentaje = 0.19`, id fijo `550e8400-e29b-41d4-a716-446655440280`.
- **Personalizado:** `(tenant_id set, pais_id NULL)`.
- `ImpuestosService.findAll(tenantId)` resuelve el país del tenant
  (`tenants.provincia_id → provincia.pais_id`) y devuelve la unión
  `WHERE tenant_id = :t OR pais_id = :pais`, con `origen: 'sistema' | 'personalizado'`
  derivado de si `tenantId` es `null`.
- Las mutaciones (`create`/`update`/`remove`) del service **siempre** filtran por
  `tenant_id = :tenantId` en el `WHERE`. Las filas del sistema tienen `tenant_id
  NULL` y por lo tanto **nunca matchean** ese filtro — no hace falta un guard
  adicional para protegerlas de edición/borrado por un tenant.

**Alternativas descartadas:**

1. **Tabla separada `impuestos_sistema` + doble FK.** `item_impuestos` (y
   cualquier otra tabla que referencia un impuesto) tendría que aceptar un FK a
   una tabla *u otra*, ya sea con dos columnas FK nullable-excluyentes o con una
   tabla de unión polimórfica. Esto duplica el problema de exclusividad que el
   CHECK resuelve en una sola tabla, pero propagado a **todas** las tablas que
   referencian impuestos, no solo a `impuestos` misma. Más JOINs, más lugares
   donde el bug de "olvidé filtrar la unión" puede aparecer.
2. **Copia-por-referencia** (cada tenant recibe una copia del impuesto oficial al
   sembrarse, sin FK compartido). Es exactamente el problema que **ya existía** y
   que se quiere resolver: N filas idénticas sin una fuente única de verdad. Si
   Chile decide subir el IVA, habría que actualizar N filas por tenant en vez de
   una sola fila del sistema. Se descarta porque perpetúa la duplicación en vez
   de eliminarla.

La tabla única con CHECK de exclusividad mantiene un solo punto de referencia por
impuesto (ID estable, un solo `item_impuestos.impuesto_id` posible), sin tocar el
esquema de ninguna tabla que ya lo referencia.

### (b) "Exento" suprime solo IVA (`tipo = 'iva'`), no todos los impuestos

Verificado en la normativa chilena: en el **DL 825**, las exenciones (arts. 12 y
13) son exenciones **del IVA** específicamente. Los impuestos adicionales
(Título III: impuesto a bebidas alcohólicas y analcohólicas, artículos suntuarios,
ILA) son tributos distintos y no forman parte de esas exenciones — una línea
puede estar exenta de IVA y llevar igualmente un impuesto adicional.

El formato **DTE del SII** refleja esta separación estructuralmente: `IndExe`
marca la línea como exenta de IVA, mientras los impuestos adicionales se declaran
por línea con `CodImpAdic` y se totalizan aparte en `ImptoReten`. Son dos
mecanismos distintos del mismo documento porque son dos hechos fiscales distintos.

**Regla adoptada:** el campo `items.clasificacion_tributaria` (`'afecto'` |
`'exento'`, default `'afecto'`) y su congelamiento en `venta_detalles` representan
el equivalente conceptual de `IndExe` por línea. Cuando una línea es `'exento'`,
el motor de precios (`CalculoPreciosService`) filtra únicamente los impuestos con
`tipo === 'iva'` de esa línea antes del paso de impuestos; los `tipo === 'otro'`
se aplican siempre, exento o no.

Esto es consistente con **ADR-010**: "exento" es un estado explícito capturado en
el momento de la transacción (columna en `items`, congelada por línea en
`venta_detalles`), nunca la ausencia de una fila en `item_impuestos`. El
bucketizado neto/exento/IVA/adicionales que ADR-010 previó para el futuro DTE
queda alimentado directamente por esta clasificación.

### (c) Administración del catálogo del sistema: solo seeder, sin CRUD superadmin

El catálogo de impuestos del sistema se administra **exclusivamente** vía
`seeder.service.ts` (siembra al arrancar el backend). No existe una pantalla de
superadmin para crear/editar impuestos del sistema — se decidió YAGNI: incorporar
un país nuevo = agregar su catálogo al seed, no construir un CRUD que hoy no
tiene un segundo caso de uso.

El seeder también corre `remapImpuestosOficialesDuplicados()` en cada arranque,
de forma **idempotente**: detecta impuestos personalizados por tenant cuyo
`porcentaje` coincide con el IVA oficial del país del tenant y cuyo `nombre`
contiene "IVA" (case-insensitive), remapea sus referencias en `item_impuestos`
hacia el impuesto del sistema, y soft-deletea la fila duplicada. Esto migra
instalaciones existentes (BDs ya sembradas con IVA por-tenant) sin intervención
manual y sin tocar `ventas_impuestos` histórico — un snapshot de venta ya congeló
porcentaje y valor, y la fila del impuesto sigue existiendo (soft delete, no
borrado físico).

## Consequences

### Positive

- Un solo punto de verdad por impuesto oficial: actualizar el IVA de un país es
  una fila, no N filas por tenant.
- `item_impuestos` y `ventas_impuestos` no cambian de forma — cero migración de
  esquema en las tablas que referencian impuestos.
- "Exento" queda modelado de forma inequívoca y consistente con ADR-010: un
  estado explícito, congelado por línea, listo para alimentar el futuro DTE sin
  reconstrucción de datos históricos.
- Un tenant en un país sin catálogo sembrado puede seguir marcando su propio IVA
  como impuesto personalizado (`tipo: 'iva'` opcional en el DTO) — no bloquea
  operar mientras se agrega el país al seed.
- El remapeo idempotente permite evolucionar instalaciones existentes sin
  downtime ni script de migración manual separado.

### Negative

- El CHECK de exclusividad y el filtro `tenant_id`/`pais_id` en `findAll` son una
  regla implícita que cualquier query nueva sobre `impuestos` debe respetar
  (olvidar el `OR pais_id = :pais` en un query ad-hoc futuro haría "desaparecer"
  los impuestos del sistema para ese query).
- El matching del remapeo de duplicados (`porcentaje` + `nombre` contiene "IVA")
  es una heurística, no una relación explícita — un tenant que haya nombrado su
  IVA personalizado de otra forma (ej. "Impuesto ventas 19%") no se remapea
  automáticamente y queda como duplicado personalizado.

### Neutral

- No hay CRUD superadmin para el catálogo del sistema; agregar un país nuevo
  requiere un cambio de código (seeder), no una acción de UI. Aceptado
  explícitamente como YAGNI mientras solo existe un país sembrado (Chile).
- Impuestos adicionales chilenos concretos (ILA, etc.) no se siembran todavía; el
  modelo ya los soporta (`tipo = 'otro'` en el catálogo del sistema) sin cambios
  futuros de esquema.
