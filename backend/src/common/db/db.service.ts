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

  /**
   * Corre `fn` detrás de un savepoint de la transacción activa: si `fn` falla, vuelve al punto
   * de antes (todo lo que `fn` escribió y bloqueó se deshace) y relanza el MISMO error; la
   * transacción de afuera sigue viva y quien llama decide qué hacer. Sin esto, una sentencia que
   * falla dentro de una transacción de Postgres la deja abortada (`25P02`) y nada más se puede
   * escribir.
   *
   * Exige una transacción activa: un savepoint fuera de una no existe. `nombre` es una
   * constante del llamador, nunca un valor de entrada: se interpola en el SQL (`SAVEPOINT` no
   * admite parámetros), por eso se valida.
   */
  async conSavepoint<T>(nombre: string, fn: () => Promise<T>): Promise<T> {
    if (!/^[a-z_]+$/.test(nombre))
      throw new Error(
        `conSavepoint: nombre de savepoint inválido (${JSON.stringify(nombre)}); solo minúsculas y guion bajo`,
      );
    const manager = this.tx.managerActivo();
    if (!manager)
      throw new Error(
        'conSavepoint corre dentro de db.transaccion: fuera de una transacción activa no hay savepoint al que volver',
      );
    await manager.query(`SAVEPOINT ${nombre}`);
    let resultado: T;
    try {
      resultado = await fn();
    } catch (error) {
      await manager.query(`ROLLBACK TO SAVEPOINT ${nombre}`);
      throw error;
    }
    await manager.query(`RELEASE SAVEPOINT ${nombre}`);
    return resultado;
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
   * (auditoría que debe sobrevivir al rollback, etc.). Primer uso real:
   * `CajaService.conRastroDeRechazo` (2026-08-23) — el rastro de un intento
   * rechazado se escribe acá para que no se vaya con el rollback. Ojo: si el
   * llamador ya está dentro de una transacción, esto toma una SEGUNDA conexión
   * del pool mientras la primera sigue retenida (ver `docs/patterns/backend.md` §9).
   */
  sinTransaccion<T>(fn: () => Promise<T>): Promise<T> {
    return this.tx.correrFuera(fn);
  }
}
