import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { type EntityManager } from 'typeorm';

/**
 * Ata el EntityManager de la transacción en curso a la operación en vuelo
 * (request, venta, job) vía AsyncLocalStorage. Es el "singleton que sabe de
 * quién es cada conexión": el estado no vive en un campo —diez requests
 * concurrentes lo pisarían entre sí— sino en el árbol async de cada operación.
 *
 * Por qué existe: 21 sitios tomaban una conexión NUEVA del pool desde adentro
 * de una transacción abierta (2 conexiones por operación → deadlock permanente
 * con N = tamaño del pool operaciones simultáneas, medido 2026-08-11). Ver
 * spec 2026-08-18-contexto-transaccional-als-design.md y el ADR.
 */
@Injectable()
export class TxContext {
  private readonly als = new AsyncLocalStorage<EntityManager>();

  managerActivo(): EntityManager | undefined {
    return this.als.getStore();
  }

  correrCon<T>(manager: EntityManager, fn: () => Promise<T>): Promise<T> {
    return this.als.run(manager, fn);
  }

  /** Corre fn FUERA de cualquier contexto transaccional (conexión del pool). */
  correrFuera<T>(fn: () => Promise<T>): Promise<T> {
    return this.als.exit(fn);
  }
}
