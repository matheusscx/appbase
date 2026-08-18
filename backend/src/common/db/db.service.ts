import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { TxContext } from './tx-context';

/**
 * La única puerta al acceso a datos fuera de los repos. El acceso directo al
 * `DataSource` ignora el contexto transaccional y reabre el deadlock del
 * pool; una regla de lint lo prohíbe en los services (ver ADR-020).
 */
@Injectable()
export class Db {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tx: TxContext,
  ) {}

  /**
   * Abre una transacción y la registra en el contexto. Si YA hay una en
   * contexto la REUSA (sin savepoint) — misma semántica que el enhebrado
   * manual de `manager` que este mecanismo reemplaza. El callback recibe el
   * manager por compatibilidad con los callbacks preexistentes; el código
   * nuevo no necesita usarlo: repos y db.query lo resuelven solos.
   */
  transaccion<T>(fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    const activo = this.tx.managerActivo();
    if (activo) return fn(activo);
    return this.dataSource.transaction((manager) =>
      this.tx.correrCon(manager, () => fn(manager)),
    );
  }

  /** Manager del contexto si hay transacción en curso; pool si no. */
  query<T = any>(sql: string, params?: unknown[]): Promise<T> {
    const manager = this.tx.managerActivo();
    return manager
      ? manager.query(sql, params)
      : this.dataSource.query(sql, params);
  }

  /**
   * Salida EXPLÍCITA: corre fn con conexión propia del pool aunque haya una
   * transacción en contexto. Para semántica deliberada de fuera-de-transacción
   * (auditoría que debe sobrevivir al rollback, etc.). Auditado 2026-08-18:
   * ningún sitio actual lo necesita — documentado para el que lo necesite.
   */
  sinTransaccion<T>(fn: () => Promise<T>): Promise<T> {
    return this.tx.correrFuera(fn);
  }
}
