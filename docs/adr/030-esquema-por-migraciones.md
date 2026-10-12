# ADR-030: El esquema lo arman las migraciones, en todos los entornos

**Status**: Accepted

**Date**: 2026-10-12

## Context

Hasta este ADR el esquema lo creaba `synchronize` de TypeORM al arrancar, en todo entorno con
`NODE_ENV !== 'production'`: dev, e2e, CI y **el demo de Railway**, donde `NODE_ENV` no es
`production` (medido el 2026-10-12: el backend de Railway loguea `Running dev seed...` en cada
arranque, y el seeder retorna antes de esa línea con `production`). `synchronize` compara las
entities con la base y aplica la diferencia sin mostrarla: un cambio de tipo o un renombre es
`DROP COLUMN` + `ADD COLUMN`, y sobre una base con datos eso los borra. Con datos de un local de
verdad, un deploy podía perder ventas.

Había además una parte del esquema que no salía de las entities: 14 índices únicos sobre una
expresión (`lower(nombre)` en 13 catálogos y la serie normalizada de `item_unidad`), que TypeORM
no sabe declarar en `@Index` y que creaba el **seeder** con SQL cruda. El seeder no corre con
`NODE_ENV=production`, así que en una base de producción esos 14 índices no habrían existido.

## Decision

**Las migraciones de `backend/src/database/migrations/` son la única fuente del esquema, y corren
al arrancar en todos los entornos** (`migrationsRun: true`, `synchronize: false`). Lo que prueba el
CI es exactamente lo que arranca en Railway.

- **Línea base** (`*-LineaBase.ts`): generada con `migration:generate` contra una base vacía, desde
  las entities —no desde `startup-pos.sql`, que es documentación y diverge—, más la extensión
  `uuid-ossp` y los 14 índices de expresión que antes creaba el seeder. Medido el 2026-10-12: el
  `pg_dump --schema-only` de una base armada por la línea base + seeder es idéntico al de una armada
  por `synchronize` + seeder, salvo la tabla `migrations` (con su secuencia, default y PK) y el
  token `\restrict` que pg_dump 18 sortea en cada volcado. Los datos sembrados también coinciden
  (difieren solo los UUID aleatorios y las credenciales cifradas con IV aleatorio). Sin seeder
  (`NODE_ENV=production`), el esquema que dejan las migraciones es el mismo.
- **El seeder ya no hace DDL**: solo siembra filas. Los `DROP` condicionales que arreglaban formas
  viejas de algunos índices se fueron con él; ninguna base nace de esas formas.
- **Una sola lista de entities** (`ENTIDADES`, `src/database/typeorm.config.ts`) para la app y para
  la CLI (`src/database/data-source.ts`).
- **El CI frena una entity cambiada sin su migración**: `npm run migration:run && npm run
  migration:check` antes del e2e, contra la base virgen del job. `migration:check` es
  `migration:generate --check` de typeorm 1.1: sale con 1 e imprime la migración que falta. El
  último test de `esquema.e2e-spec.ts` hace la misma comparación para quien corre el e2e en local.
- **Railway corre las migraciones al arrancar el backend**, no en un `preDeployCommand`. Los dos
  dejan al deployment anterior sirviendo si la migración falla (la migración va en una
  transacción y no deja nada a medias; el nuevo no pasa el healthcheck). Se eligió el arranque
  porque es el mismo camino que corren dev, el e2e y el CI, y el que se midió con
  `Dockerfile.prod`; un `preDeployCommand` agrega un camino —la CLI sobre el `dist/` de la imagen—
  que nada más ejerce. El costo: una migración que falla tarda el plazo del healthcheck (300 s) en
  dar `FAILED`, en vez de fallar enseguida. **Si el backend pasa a más de una réplica, se muda al
  `preDeployCommand`**: dos arranques simultáneos correrían la misma migración a la vez.

### La regla para las sesiones

**Cambié una entity → genero la migración, la leo y la commiteo con el cambio.**

```bash
cd backend
npm run migration:generate -- NombreDelCambio
```

`docs/patterns/backend.md` § 22 dice qué mirar al leerla (cambios de tipo que borran datos,
`NOT NULL` sin default, enums compartidos, índices de expresión, el `where` que TypeORM no ve) y
§ 17 cómo va un índice que lleva una función. Una migración que ya está en `main` no se edita:
corrió en el demo y en las bases de todos.

### Procedencia

Decidido por el owner el 2026-10-12, por AskUserQuestion de la orquestadora, con el costo de cada
opción: **"Desde ya, en el demo"**. Se arma todo, el demo de Railway pasa a usar migraciones ahora
y el CI frena cualquier cambio de esquema que no traiga su migración. Costo aceptado: cada sesión
que cambie el esquema tarda unos minutos más. Descartadas: "se arma ahora y se prende al salir a
prod" y "más adelante".

## Consequences

- Un cambio de esquema se ve en el diff, se revisa y se puede revertir (`migration:revert`). Deja
  de existir el DDL que nadie leyó.
- Los 14 índices de expresión existen en cualquier base, con o sin seeder.
- **Cuesta minutos por cambio de esquema**: generar, leer y a veces corregir la migración. Es el
  costo que el owner aceptó.
- **Las bases que armó `synchronize` no arrancan con este código**: la línea base intenta crear
  tablas que ya existen (`relation "usuarios" already exists`) y la app sale con error, sin tocar
  nada salvo una tabla `migrations` vacía. Se recrean una vez: `./scripts/reset-db.sh` o
  `./scripts/entorno.sh db` en local; el demo se recreó el 2026-10-12, vaciando el esquema
  mientras Railway construía la imagen (cómo y lo medido: [`resueltos.md`](../agent/resueltos.md)).
- TypeORM compara índices por nombre, unicidad y columnas, **no por `where`**: cambiar el `where`
  de un `@Index` no genera migración y hay que escribirla a mano.
- `startup-pos.sql` sigue siendo documentación de referencia; no lo ejecuta nadie.
