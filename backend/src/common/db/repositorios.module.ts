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
 * tomar una segunda conexión dentro de una transacción dejó de ser posible
 * por olvido.
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
