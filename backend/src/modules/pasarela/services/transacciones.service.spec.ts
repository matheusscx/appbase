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
});
