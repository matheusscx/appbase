import { Test } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { TenantPasarelaService } from './tenant-pasarela.service';
import { CredencialesService } from './credenciales.service';
import { TenantPasarela } from '../entities/tenant-pasarela.entity';
import { Pasarela } from '../entities/pasarela.entity';

describe('TenantPasarelaService', () => {
  let service: TenantPasarelaService;
  const tpRepo = {
    create: jest.fn((x: Partial<TenantPasarela>) => x),
    save: jest.fn((x: Partial<TenantPasarela>) =>
      Promise.resolve({ tenantPasarelaId: 'tp-1', ...x }),
    ),
    findOne: jest.fn(),
    softRemove: jest.fn(),
  };
  const pasarelaRepo = { findOne: jest.fn() };
  const dataSource = { query: jest.fn().mockResolvedValue([]) };
  const credenciales = {
    cifrarJson: jest.fn().mockReturnValue('v1:blob'),
    resolver: jest.fn().mockReturnValue({ baseUrl: 'x' }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        TenantPasarelaService,
        { provide: getRepositoryToken(TenantPasarela), useValue: tpRepo },
        { provide: getRepositoryToken(Pasarela), useValue: pasarelaRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: CredencialesService, useValue: credenciales },
      ],
    }).compile();
    service = module.get(TenantPasarelaService);
  });

  it('crear: cifra la configuración y no la devuelve', async () => {
    pasarelaRepo.findOne.mockResolvedValue({
      pasarelaId: 'p-1',
      activo: true,
      soportaMall: true,
    });
    const res = await service.crear('t-1', {
      pasarelaId: 'p-1',
      ambiente: 'pruebas',
      modoIntegracion: 'mall',
      configuracion: { commerceCodeHijo: '5970...' },
    });
    expect(credenciales.cifrarJson).toHaveBeenCalledWith({
      commerceCodeHijo: '5970...',
    });
    expect(JSON.stringify(res)).not.toContain('5970...');
  });

  it('crear: rechaza pasarela global inexistente o inactiva', async () => {
    pasarelaRepo.findOne.mockResolvedValue(null);
    await expect(
      service.crear('t-1', {
        pasarelaId: 'nope',
        ambiente: 'pruebas',
        modoIntegracion: 'mall',
      }),
    ).rejects.toThrow('Pasarela no disponible');
  });

  it('actualizar: NO toca configuracion si el dto no la trae (write-only)', async () => {
    tpRepo.findOne.mockResolvedValue({
      tenantPasarelaId: 'tp-1',
      tenantId: 't-1',
      configuracion: 'v1:anterior',
      activo: true,
    });
    await service.actualizar('t-1', 'tp-1', { activo: false });
    const guardado = tpRepo.save.mock.calls[0][0];
    expect(guardado.configuracion).toBe('v1:anterior');
    expect(guardado.activo).toBe(false);
  });

  it('actualizar: configuracion null explícito limpia credenciales sin cifrar "null"', async () => {
    tpRepo.findOne.mockResolvedValue({
      tenantPasarelaId: 'tp-1',
      tenantId: 't-1',
      configuracion: 'v1:anterior',
      activo: true,
    });
    await service.actualizar('t-1', 'tp-1', {
      configuracion: null,
    } as unknown as Parameters<typeof service.actualizar>[2]);
    const guardado = tpRepo.save.mock.calls[0][0];
    expect(guardado.configuracion).toBeNull();
    expect(credenciales.cifrarJson).not.toHaveBeenCalled();
  });

  it('resolverConfiguracionActiva: rechaza si el tenant no tiene la pasarela activa', async () => {
    tpRepo.findOne.mockResolvedValue(null);
    dataSource.query.mockResolvedValue([]);
    await expect(
      service.resolverConfiguracionActiva('t-1', 'oneclick'),
    ).rejects.toThrow('no tiene configurada');
  });
});
