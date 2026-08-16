# ADR-019: Declarar `type: 'timestamptz'` explícito en toda columna de fecha

**Status**: Accepted  
**Date**: 2026-08-06

## Context

Hermano directo de [ADR-004](./004-uuid-column-types.md), con la misma causa raíz: en dev
`synchronize: true` genera el esquema desde las entidades, y cuando el decorador no declara
`type`, TypeORM elige por vos. Para fechas elige `timestamp` **sin zona**.

El resultado fue un esquema partido por accidente. Medido con `information_schema.columns`
sobre Postgres real el 2026-08-06, antes de corregirlo:

| Columna | Sin zona | Con zona |
|---|---|---|
| `eliminado_el` | 65 | 22 |
| `creado_el` | 66 | 22 |
| `actualizado_el` | 64 | 22 |

Las 22 de cada fila son las entidades que sí fijaban `type` — no había ninguna decisión
detrás del corte, sólo si quien escribió esa entity se acordó.

**Por qué importa.** Comparar una columna con zona contra una sin zona no da error: Postgres
castea la que no tiene zona usando el **`TimeZone` de la sesión que corre la comparación**,
que no tiene por qué ser el que estaba activo cuando se escribió el valor (otra conexión del
pool, otro deploy, un `SET TimeZone` de otra feature). Verificado con `SET TimeZone` en
sesiones separadas de escritura y lectura: **matchea 1 de 3 combinaciones**, y las 2 que
fallan lo hacen en silencio — afectan 0 filas, sin excepción y sin test rojo.

Ya había costado una ronda de revisión en `items.restaurar()`, donde el par
`items` ↔ `receta_extras_permitidos` mezclaba los dos tipos. El parche de entonces fue
anclar los dos lados a UTC a mano con `AT TIME ZONE 'UTC'`.

## Decision

Toda columna que almacene un instante **debe** declarar `type: 'timestamptz'`
explícitamente, sin excepción. Aplica a los tres decoradores de auditoría y también a
cualquier fecha declarada con `@Column`.

```typescript
@CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
@UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
@DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })

// Y las que no son de auditoría, que es donde se escapan:
@Column({ name: 'expires_at', type: 'timestamptz' })
```

Corolario, que es la mitad menos obvia: **un cast de zona horaria es una respuesta al TIPO
de la columna, no una verdad permanente.** Si el tipo cambia, el cast se relee.

## Consequences

**A favor**

- Una comparación entre dos columnas de fecha no depende de ninguna sesión.
- Se puede escribir `NOW()` a secas: no hace falta anclar a UTC a mano en cada sitio.
- El esquema quedó con **cero** columnas sin zona, así que la regla se enforca completa en
  vez de con una lista de excepciones.

**En contra / a tener en cuenta**

- Un filtro de rango contra una fecha pura (`WHERE creado_el >= '2026-08-01'`) pasaba a
  interpretarse en el `TimeZone` de sesión — una dependencia que antes no existía, y que
  nadie fijaba explícitamente (ni el compose ni la config del pool).
  ✅ **Cerrado el 2026-08-16** (ver [`resueltos.md`](../agent/resueltos.md)): los tres
  filtros afectados —`mermas`, `inventario` y `pasarela/cobros`— normalizan en el service con
  `src/common/utils/rango-fecha.util.ts`. La fecha pura se expande a la medianoche de la zona
  **del tenant**; el timestamp pasa tal cual, sin `::date` que le descarte la hora. Ya no
  dependen del `TimeZone` de sesión.
- Migrar el esquema es cambiar entidades y resetear: el proyecto no tiene datos productivos
  y no hay migraciones TypeORM. En producción `synchronize` está en `false`, así que el día
  que haya datos reales esto necesita un `ALTER COLUMN` escrito a mano.

## Enforcement

La regla no vive en este documento: vive en dos tests, igual que ADR-004.

- `backend/src/common/invariants/timestamptz-columns.invariant.spec.ts` — mira la **metadata
  de TypeORM**, no el texto del fuente. La distinción no es cosmética: 5 entidades declaran
  estas columnas con `@Column` a secas, y un grep de `@DeleteDateColumn` no las ve.
- `backend/test/esquema.e2e-spec.ts` — mira `information_schema` sobre la base real, y va
  sobre **todas** las columnas, no sólo las que el unit reconoce como de auditoría. Existe
  por un caso concreto: `refresh_tokens.expires_at` quedó sin zona, ninguna red la miraba
  porque no se llama como una columna de auditoría, y decide si un token sigue vivo.

Si alguna vez hay una columna que legítimamente deba ir sin zona —una fecha de negocio sin
instante— va con su justificación en una allowlist en el test, como `NON_UUID_ID_ALLOWLIST`
en el de ADR-004. Hoy no hay ninguna.
