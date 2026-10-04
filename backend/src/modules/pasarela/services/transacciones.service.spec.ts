import { IsNull, type EntityManager } from 'typeorm';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TransaccionesService } from './transacciones.service';
import { PasarelaTransaccion } from '../entities/pasarela-transaccion.entity';

describe('TransaccionesService', () => {
  let service: TransaccionesService;
  const repo = {
    create: jest.fn((x: Partial<PasarelaTransaccion>) => x),
    save: jest.fn((x: Partial<PasarelaTransaccion>) =>
      Promise.resolve({ transaccionId: 'tx-1', ...x }),
    ),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        TransaccionesService,
        { provide: getRepositoryToken(PasarelaTransaccion), useValue: repo },
      ],
    }).compile();
    service = module.get(TransaccionesService);
  });

  it('redactar: enmascara claves sensibles en cualquier nivel', () => {
    const sucio = {
      headers: {
        'Tbk-Api-Key-Secret': 'S3CR3T',
        'Content-Type': 'application/json',
      },
      body: {
        tbk_user: 'tbk-abc',
        username: 'insc-1',
        amount: 5000,
        nested: { token: 'tok' },
      },
    };
    const limpio = service.redactar(sucio);
    expect(JSON.stringify(limpio)).not.toContain('S3CR3T');
    expect(JSON.stringify(limpio)).not.toContain('tbk-abc');
    expect(JSON.stringify(limpio)).not.toContain('"tok"');
    expect((limpio.body as Record<string, unknown>).amount).toBe(5000);
  });

  it('registrar: redacta request/response y setea fechaTransaccion', async () => {
    await service.registrar({
      tenantId: 't-1',
      tenantPasarelaId: 'tp-1',
      tipo: 'AUTHORIZATION',
      estado: 'aprobada',
      request: { body: { tbk_user: 'secreto' } },
      response: { ok: true },
    });
    const guardado = repo.save.mock.calls[0][0];
    expect(JSON.stringify(guardado.request)).not.toContain('secreto');
    expect(guardado.fechaTransaccion).toBeInstanceOf(Date);
  });

  it('vincularCorreccion: escribe solo ese vínculo en la fila de ese tenant, una vez y sin tocar su estado', async () => {
    const ligado = await service.vincularCorreccion(
      't-1',
      'tx-refund',
      'venta-nc',
    );

    expect(ligado).toBe(true);
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledWith(
      {
        transaccionId: 'tx-refund',
        tenantId: 't-1',
        eliminadoEl: IsNull(),
        correccionVentaId: IsNull(),
      },
      { correccionVentaId: 'venta-nc' },
    );
  });

  it('vincularCorreccion: con un manager escribe con ESE (la transacción de la corrección), no con el repo del servicio', async () => {
    const repoDeLaTx = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const manager = {
      getRepository: jest.fn().mockReturnValue(repoDeLaTx),
    } as unknown as EntityManager;

    await service.vincularCorreccion('t-1', 'tx-refund', 'venta-nc', manager);

    expect(manager.getRepository).toHaveBeenCalledWith(PasarelaTransaccion);
    expect(repoDeLaTx.update).toHaveBeenCalledWith(
      expect.objectContaining({ transaccionId: 'tx-refund', tenantId: 't-1' }),
      { correccionVentaId: 'venta-nc' },
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('vincularCorreccion: avisa con false si no ligó ninguna fila (otro tenant, ya ligada o borrada)', async () => {
    repo.update.mockResolvedValueOnce({ affected: 0 });

    await expect(
      service.vincularCorreccion('t-1', 'tx-refund', 'venta-nc'),
    ).resolves.toBe(false);
  });

  /**
   * El CAS de ADR-029: la sentencia que cierra un REFUND sin confirmar exige
   * el estado de origen en su propio WHERE. Un escritor tardío —venga de tx1,
   * del aclarado o de la marca manual— no encuentra fila y no pisa el final.
   */
  describe('resolverReembolso', () => {
    const qb = (affected: number) => {
      const cadena = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected }),
      };
      repo.createQueryBuilder.mockReturnValue(cadena);
      return cadena;
    };
    const resolver = () =>
      service.resolverReembolso('t-1', 'tx-1', {
        estado: 'aprobada',
        resolucion: 'saldo',
        resueltaPor: 'u-1',
        metadata: { motivo: 'x' },
      });

    it('una sola sentencia, acotada a tenant, REFUND, sin borrar y SOLO desde iniciada/error', async () => {
      const cadena = qb(1);

      await expect(resolver()).resolves.toBe(true);

      const condiciones = [
        ...cadena.where.mock.calls,
        ...cadena.andWhere.mock.calls,
      ].map((c) => c[0] as string);
      expect(condiciones).toEqual(
        expect.arrayContaining([
          'tenant_id = :tenantId',
          "tipo = 'REFUND'",
          "estado IN ('iniciada', 'error')",
          'eliminado_el IS NULL',
        ]),
      );
      expect(cadena.execute).toHaveBeenCalledTimes(1);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('si otro ya la cerró (0 filas), devuelve false: el llamador relee', async () => {
      qb(0);
      await expect(resolver()).resolves.toBe(false);
    });
  });
});
