import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  DataSource,
  Entity,
  PrimaryGeneratedColumn,
  type EntityManager,
} from 'typeorm';
import { TxContext } from './tx-context';
import { Db } from './db.service';
import { RepositoriosModule } from './repositorios.module';

@Entity()
class EntidadDePrueba {
  @PrimaryGeneratedColumn('uuid')
  id: string;
}

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

  it('si fn rechaza, propaga el error Y libera el contexto', async () => {
    // Propiedad de la que dependen todos los `catch` que corren después de una
    // transacción fallida (el rastro de auditoría del timeout de reembolso, por
    // ejemplo): si el store del ALS sobreviviera al rechazo, esas escrituras se
    // irían contra un manager ya abortado. `dataSource.transaction` propaga el
    // rechazo, así que `als.run` termina y el store se destruye con él.
    await expect(
      db.transaccion(async () => {
        expect(tx.managerActivo()).toBe(managerTx);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(tx.managerActivo()).toBeUndefined();
    await expect(db.query('SELECT 1')).resolves.toEqual(['desde-pool']);
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

describe('RepositoriosModule.forFeature (proxy context-aware)', () => {
  const managerDelPool = { query: jest.fn() } as unknown as EntityManager;
  const repoBase = {
    find: jest.fn().mockResolvedValue('base'),
    metadata: { name: 'EntidadDePrueba' },
    manager: managerDelPool,
  };
  const repoDeTx: { find: jest.Mock; manager: EntityManager } = {
    find: jest.fn().mockResolvedValue('tx'),
    manager: undefined as unknown as EntityManager,
  };
  const managerTx = {
    getRepository: jest.fn().mockReturnValue(repoDeTx),
  } as unknown as EntityManager;
  // Como en TypeORM real: el repo que devuelve un manager apunta a ese manager.
  repoDeTx.manager = managerTx;
  const dataSource = {
    getRepository: jest.fn().mockReturnValue(repoBase),
  } as unknown as DataSource;

  let tx: TxContext;
  let repo: {
    find: () => Promise<string>;
    metadata: { name: string };
    manager: EntityManager;
  };

  // `RepositoriosModule.forFeature` es un dynamic module sin `imports` propios,
  // así que sus providers solo ven lo que venga de un módulo `@Global`. En
  // producción eso se cumple solo: `TypeOrmCoreModule` (token `DataSource`) y
  // `CommonModule` (`TxContext`) son los dos globales. El test lo espeja en vez
  // de inyectar los dos como providers sueltos del módulo raíz, que quedarían
  // invisibles adentro del dynamic module (`UnknownDependenciesException`).
  @Global()
  @Module({
    providers: [TxContext, { provide: DataSource, useValue: dataSource }],
    exports: [TxContext, DataSource],
  })
  class ContextoGlobalDePrueba {}

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      imports: [
        ContextoGlobalDePrueba,
        RepositoriosModule.forFeature([EntidadDePrueba]),
      ],
    }).compile();
    tx = module.get(TxContext);
    repo = module.get(getRepositoryToken(EntidadDePrueba));
  });

  it('sin contexto, delega en el repo del pool', async () => {
    await expect(repo.find()).resolves.toBe('base');
  });

  it('con transacción en contexto, delega en el repo del manager — sin editar al llamador', async () => {
    await tx.correrCon(managerTx, async () => {
      await expect(repo.find()).resolves.toBe('tx');
    });
    expect(managerTx.getRepository).toHaveBeenCalledWith(EntidadDePrueba);
  });

  it('reenvía propiedades no-método (metadata)', () => {
    expect(repo.metadata.name).toBe('EntidadDePrueba');
  });

  it('`repo.manager` bajo contexto es el manager de la transacción', () => {
    // No es teórico: `garzones.service.ts` usa `garzonRepo.manager.query(...)`
    // en producción. Si el proxy devolviera el `manager` del repo del pool,
    // ese `query` saldría por una SEGUNDA conexión desde adentro de la
    // transacción — el deadlock exacto que este mecanismo cierra.
    expect(repo.manager).toBe(managerDelPool);
    return tx.correrCon(managerTx, async () => {
      expect(repo.manager).toBe(managerTx);
    });
  });
});
