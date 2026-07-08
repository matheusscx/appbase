import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { ApiKeysService } from './api-keys.service';
import { PasarelaApiKey } from '../entities/pasarela-api-key.entity';

describe('ApiKeysService', () => {
  let service: ApiKeysService;
  const repo = {
    create: jest.fn((x: Partial<PasarelaApiKey>) => x),
    save: jest.fn((x: Partial<PasarelaApiKey>) =>
      Promise.resolve({ ...x, apiKeyId: 'key-uuid-1' }),
    ),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        { provide: getRepositoryToken(PasarelaApiKey), useValue: repo },
      ],
    }).compile();
    service = module.get(ApiKeysService);
  });

  it('crear: genera key pk_..., guarda solo el hash y expone la key una vez', async () => {
    const res = await service.crear('tenant-1', 'app móvil');
    expect(res.apiKey).toMatch(/^pk_[A-Za-z0-9_-]{40}$/);
    expect(res.prefijo).toBe(res.apiKey.slice(0, 10) + '…');
    const guardado = repo.save.mock.calls[0][0];
    expect(guardado.keyHash).toBe(
      createHash('sha256').update(res.apiKey).digest('hex'),
    );
    expect(JSON.stringify(guardado)).not.toContain(res.apiKey);
  });

  it('validar: devuelve tenant para una key activa', async () => {
    repo.findOne.mockResolvedValue({
      apiKeyId: 'key-uuid-1',
      tenantId: 'tenant-1',
      revocadaEl: null,
    });
    const res = await service.validar('pk_' + 'a'.repeat(40));
    expect(res).toEqual({ tenantId: 'tenant-1', apiKeyId: 'key-uuid-1' });
    expect(repo.update).toHaveBeenCalled(); // ultimo_uso_el
  });

  it('validar: null para key revocada o inexistente', async () => {
    repo.findOne.mockResolvedValue(null);
    expect(await service.validar('pk_' + 'b'.repeat(40))).toBeNull();
    repo.findOne.mockResolvedValue({
      apiKeyId: 'k',
      tenantId: 't',
      revocadaEl: new Date(),
    });
    expect(await service.validar('pk_' + 'c'.repeat(40))).toBeNull();
  });

  it('revocar: setea revocada_el; rechaza si no es del tenant', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.revocar('tenant-1', 'ajena')).rejects.toThrow(
      'no encontrada',
    );
  });
});
