import { Test } from '@nestjs/testing';
import { DataSource, type EntityManager } from 'typeorm';
import { TxContext } from './tx-context';
import { Db } from './db.service';

describe('TxContext + Db', () => {
  let tx: TxContext;
  let db: Db;
  // Managers falsos distinguibles por identidad; query espía a dónde fue cada llamada
  const managerTx = {
    query: jest.fn().mockResolvedValue(['desde-manager']),
  } as unknown as EntityManager;
  const dataSource = {
    query: jest.fn().mockResolvedValue(['desde-pool']),
    transaction: jest.fn((cb: (m: EntityManager) => Promise<unknown>) =>
      cb(managerTx),
    ),
  } as unknown as DataSource;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [TxContext, Db, { provide: DataSource, useValue: dataSource }],
    }).compile();
    tx = module.get(TxContext);
    db = module.get(Db);
  });

  it('sin transacción en contexto, query va al pool', async () => {
    await expect(db.query('SELECT 1')).resolves.toEqual(['desde-pool']);
    expect(dataSource.query).toHaveBeenCalledWith('SELECT 1', undefined);
  });

  it('dentro de transaccion(), query resuelve el manager del contexto', async () => {
    await db.transaccion(async () => {
      await expect(db.query('SELECT 1')).resolves.toEqual(['desde-manager']);
    });
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('transaccion() anidada REUSA el manager: no abre una segunda transacción', async () => {
    // El vector de la reincidencia de auth.service.ts (2026-08-15): envolver
    // código viejo en una transacción nueva. Con esto es un no-op seguro.
    await db.transaccion(async () => {
      await db.transaccion(async (m) => {
        expect(m).toBe(managerTx);
      });
    });
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('el callback de transaccion() recibe el manager (compatibilidad con los callbacks existentes)', async () => {
    await db.transaccion(async (m) => {
      expect(m).toBe(managerTx);
    });
  });

  it('sinTransaccion() escapa del contexto: query vuelve al pool', async () => {
    await db.transaccion(async () => {
      await db.sinTransaccion(async () => {
        await expect(db.query('SELECT 1')).resolves.toEqual(['desde-pool']);
      });
    });
  });

  it('el contexto NO se filtra entre operaciones concurrentes', async () => {
    // Dos "requests" en paralelo: una transaccional, la otra no. La segunda
    // jamás debe ver el manager de la primera — es la razón por la que esto
    // es un ALS y no un campo del singleton.
    await Promise.all([
      db.transaccion(async () => {
        await new Promise((r) => setTimeout(r, 20));
        expect(tx.managerActivo()).toBe(managerTx);
      }),
      (async () => {
        await new Promise((r) => setTimeout(r, 10));
        expect(tx.managerActivo()).toBeUndefined();
      })(),
    ]);
  });
});
