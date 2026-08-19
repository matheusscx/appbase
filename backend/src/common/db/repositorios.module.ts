import { Module, type DynamicModule } from '@nestjs/common';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { type EntityClassOrSchema } from '@nestjs/typeorm/dist/interfaces/entity-class-or-schema.type';
import { TxContext } from './tx-context';

/**
 * Reemplazo drop-in de `TypeOrmModule.forFeature`: provee bajo el MISMO token
 * de `@InjectRepository` un proxy que resuelve el repo del manager en contexto
 * (TxContext) si hay transacción en curso, o el repo del pool si no. Así los
 * services no enhebran el manager: la conexión correcta se resuelve sola, y
 * tomar una segunda conexión dentro de una transacción **por un repo inyectado**
 * deja de ser posible por olvido. Alcance explícito: la garantía cubre el
 * acceso vía repositorio y `Db.query`/`Db.transaccion` — no `dataSource.query`
 * directo, que sigue siendo posible si alguien lo inyecta (por eso existe
 * además la regla de lint sobre `DataSource`, ver ADR-020).
 *
 * ⚠️ PRECONDICIÓN de todo lo anterior, no un detalle: la garantía existe SOLO
 * si el módulo feature registra sus entities con `RepositoriosModule.forFeature`
 * (esta clase), nunca con `TypeOrmModule.forFeature`. Un módulo que use ese
 * último recibe repos atados al `DataSource` del pool sin pasar por este
 * proxy — mismo deadlock si se usan dentro de `db.transaccion`, y sin que la
 * regla de lint sobre `DataSource` lo vea (acá no hay `DataSource` inyectado
 * en ningún constructor; el registro pasa por el `Module` decorator). Por eso
 * `eslint.config.mjs` prohíbe además `TypeOrmModule.forFeature` en `src/**`
 * fuera de este módulo, el seeder y los specs.
 *
 * Límites conocidos (verificados con grep el 2026-08-18, cero consumidores
 * hoy — documentados en detalle en ADR-020 § Consequences): no cubre
 * `getTreeRepository` (entidades `@Tree`), no alimenta `EntitiesMetadataStorage`
 * (así que `autoLoadEntities` no vería estas entidades), no pasa
 * `targetEntitySchema` (el workaround de Nest para nombres de clase
 * duplicados) y `forFeature` no acepta un segundo parámetro `dataSource`
 * (conexiones con nombre).
 *
 * Acoplamiento a tener en cuenta si este módulo se toca: `crearRepoProxy` se
 * inyecta con `dataSource: DataSource` y `tx: TxContext`, y depende de que
 * ambos los resuelva Nest desde módulos `@Global` (hoy `TypeOrmCoreModule` +
 * `CommonModule`) — `RepositoriosModule.forFeature` es un dynamic module sin
 * `imports` propios. Si `TxContext` alguna vez pasara a depender de algo que
 * no sea `@Global`, la resolución se rompe al arrancar la app, no en un test.
 */
function crearRepoProxy(
  entidad: EntityClassOrSchema,
  dataSource: DataSource,
  tx: TxContext,
): unknown {
  const base = dataSource.getRepository(entidad);
  return new Proxy(base, {
    get(target, prop) {
      const manager: EntityManager | undefined = tx.managerActivo();
      const repo = manager ? manager.getRepository(entidad) : target;
      const valor: unknown = Reflect.get(repo as object, prop, repo);
      if (typeof valor === 'function') {
        return (valor as (...args: unknown[]) => unknown).bind(repo) as unknown;
      }
      return valor;
    },
  });
}

@Module({})
export class RepositoriosModule {
  static forFeature(entidades: EntityClassOrSchema[]): DynamicModule {
    const providers = entidades.map((entidad) => ({
      provide: getRepositoryToken(entidad),
      useFactory: (dataSource: DataSource, tx: TxContext) =>
        crearRepoProxy(entidad, dataSource, tx),
      inject: [getDataSourceToken(), TxContext],
    }));
    return {
      module: RepositoriosModule,
      providers,
      exports: providers.map((p) => p.provide),
    };
  }
}
