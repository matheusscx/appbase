import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { Tenant } from './entities/tenant.entity';
import { UsuarioTenant } from './entities/usuario-tenant.entity';
import { TenantModulo } from './entities/tenant-modulo.entity';
import { TenantFormulaPrecio } from './entities/tenant-formula-precio.entity';
import { Caja } from './entities/caja.entity';
import { RazonSocial } from './entities/razon-social.entity';
import type { UpdateMyTenantDto } from './dto/update-my-tenant.dto';

const mockTenant: Tenant = {
  id: 'tenant-uuid',
  provinciaId: 'prov-uuid',
  nombre: 'Paris',
  correo: 'contacto@paris.cl',
  telefono: '+56226005000',
  direccion: 'Av. Kennedy 9001',
  calculoDescuentos: 'base',
  creadoEl: new Date(),
  actualizadoEl: new Date(),
  eliminadoEl: null,
};

describe('TenantsService', () => {
  let service: TenantsService;
  let tenantRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    softDelete: jest.Mock;
    create: jest.Mock;
  };
  let razonSocialRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock; query: jest.Mock };

  beforeEach(async () => {
    tenantRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      softDelete: jest.fn(),
      create: jest.fn(),
    };
    razonSocialRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      softDelete: jest.fn(),
    };
    dataSource = {
      transaction: jest.fn(),
      query: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsService,
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
        {
          provide: getRepositoryToken(UsuarioTenant),
          useValue: {
            findOne: jest.fn(),
            save: jest.fn(),
            create: jest.fn(),
            softDelete: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(TenantModulo),
          useValue: { find: jest.fn(), create: jest.fn(), save: jest.fn() },
        },
        {
          provide: getRepositoryToken(TenantFormulaPrecio),
          useValue: { find: jest.fn(), create: jest.fn(), save: jest.fn() },
        },
        {
          provide: getRepositoryToken(Caja),
          useValue: { create: jest.fn(), save: jest.fn() },
        },
        { provide: getRepositoryToken(RazonSocial), useValue: razonSocialRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get<TenantsService>(TenantsService);
  });

  describe('updateMine', () => {
    it('actualiza los campos del tenant', async () => {
      const dto: UpdateMyTenantDto = { nombre: 'Paris Updated' };
      tenantRepo.findOne.mockResolvedValue({ ...mockTenant });
      tenantRepo.save.mockResolvedValue({
        ...mockTenant,
        nombre: 'Paris Updated',
      });

      const result = await service.updateMine('tenant-uuid', dto);

      expect(result.nombre).toBe('Paris Updated');
      expect(tenantRepo.save).toHaveBeenCalled();
    });

    it('lanza NotFoundException si el tenant no existe', async () => {
      tenantRepo.findOne.mockResolvedValue(null);
      await expect(service.updateMine('no-existe', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
