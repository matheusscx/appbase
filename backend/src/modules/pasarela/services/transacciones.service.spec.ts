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
});
