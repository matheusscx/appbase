import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { Tenant } from './entities/tenant.entity';
import { UsuarioTenant } from './entities/usuario-tenant.entity';
import { TenantModulo } from './entities/tenant-modulo.entity';
import { TenantFormulaPrecio } from './entities/tenant-formula-precio.entity';
import { Caja } from '../caja/entities/caja.entity';
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
  calculoRecargos: 'base',
  escalaCalculo: 6,
  modoRedondeo: 'HALF_UP',
  montoTolerancia: '0',
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
  let tenantFormulaPrecioRepo: {
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
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
    tenantFormulaPrecioRepo = {
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
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
          useValue: tenantFormulaPrecioRepo,
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

    it('lanza ConflictException si el correo ya está en uso', async () => {
      tenantRepo.findOne.mockResolvedValue({ ...mockTenant });
      tenantRepo.save.mockRejectedValue({ code: '23505' });
      await expect(
        service.updateMine('tenant-uuid', { correo: 'otro@tenant.cl' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  const mockRazonSocial: RazonSocial = {
    id: 'rs-uuid',
    tenantId: 'tenant-uuid',
    nombre: 'Paris SPA',
    rut: '76.123.456-7',
    direccion: 'Av. Kennedy 9001',
    telefono: null,
    habilitado: false,
    preferida: false,
    creadoEl: new Date(),
    actualizadoEl: new Date(),
    eliminadoEl: null,
  };

  describe('findRazonesSociales', () => {
    it('retorna las razones sociales del tenant', async () => {
      razonSocialRepo.find.mockResolvedValue([mockRazonSocial]);
      const result = await service.findRazonesSociales('tenant-uuid');
      expect(result).toEqual([mockRazonSocial]);
      expect(razonSocialRepo.find).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-uuid' },
        order: { nombre: 'ASC' },
      });
    });
  });

  describe('createRazonSocial', () => {
    it('crea y retorna la razon social', async () => {
      razonSocialRepo.create.mockReturnValue(mockRazonSocial);
      razonSocialRepo.save.mockResolvedValue(mockRazonSocial);
      const dto = { nombre: 'Paris SPA', rut: '76.123.456-7' };
      const result = await service.createRazonSocial('tenant-uuid', dto);
      expect(result).toEqual(mockRazonSocial);
      expect(razonSocialRepo.create).toHaveBeenCalledWith({
        tenantId: 'tenant-uuid',
        nombre: 'Paris SPA',
        rut: '76.123.456-7',
      });
    });
  });

  describe('updateRazonSocial', () => {
    it('actualiza la razon social', async () => {
      razonSocialRepo.findOne.mockResolvedValue({ ...mockRazonSocial });
      razonSocialRepo.save.mockResolvedValue({
        ...mockRazonSocial,
        nombre: 'Paris SA',
      });
      const result = await service.updateRazonSocial('tenant-uuid', 'rs-uuid', {
        nombre: 'Paris SA',
      });
      expect(result.nombre).toBe('Paris SA');
    });

    it('lanza NotFoundException si no pertenece al tenant', async () => {
      razonSocialRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateRazonSocial('tenant-uuid', 'otro-id', { nombre: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeRazonSocial', () => {
    it('hace soft delete de la razon social', async () => {
      razonSocialRepo.findOne.mockResolvedValue(mockRazonSocial);
      razonSocialRepo.softDelete.mockResolvedValue({ affected: 1 });
      await service.removeRazonSocial('tenant-uuid', 'rs-uuid');
      expect(razonSocialRepo.softDelete).toHaveBeenCalledWith({
        id: 'rs-uuid',
        tenantId: 'tenant-uuid',
      });
    });

    it('lanza NotFoundException si no pertenece al tenant', async () => {
      razonSocialRepo.findOne.mockResolvedValue(null);
      await expect(
        service.removeRazonSocial('tenant-uuid', 'no-existe'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('setPreferida', () => {
    it('limpia la preferida anterior y marca la nueva', async () => {
      const mockManager = {
        findOne: jest
          .fn()
          .mockResolvedValue({ ...mockRazonSocial, habilitado: true }),
        query: jest.fn().mockResolvedValue(undefined),
      };
      dataSource.transaction.mockImplementation(
        (cb: (m: typeof mockManager) => Promise<unknown>) => cb(mockManager),
      );

      const result = await service.setPreferida('tenant-uuid', 'rs-uuid');

      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('SET preferida = false'),
        ['tenant-uuid'],
      );
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('SET preferida = true'),
        ['rs-uuid'],
      );
      expect(result.preferida).toBe(true);
    });

    it('lanza NotFoundException si la razón social no existe en el tenant', async () => {
      const mockManager = {
        findOne: jest.fn().mockResolvedValue(null),
        query: jest.fn(),
      };
      dataSource.transaction.mockImplementation(
        (cb: (m: typeof mockManager) => Promise<unknown>) => cb(mockManager),
      );

      await expect(
        service.setPreferida('tenant-uuid', 'no-existe'),
      ).rejects.toThrow(NotFoundException);
      expect(mockManager.query).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si la razón social está deshabilitada', async () => {
      const mockManager = {
        findOne: jest
          .fn()
          .mockResolvedValue({ ...mockRazonSocial, habilitado: false }),
        query: jest.fn(),
      };
      dataSource.transaction.mockImplementation(
        (cb: (m: typeof mockManager) => Promise<unknown>) => cb(mockManager),
      );

      await expect(
        service.setPreferida('tenant-uuid', 'rs-uuid'),
      ).rejects.toThrow(BadRequestException);
      expect(mockManager.query).not.toHaveBeenCalled();
    });
  });

  describe('updateRazonSocial — guard preferida', () => {
    it('lanza BadRequestException al intentar deshabilitar la razón social preferida', async () => {
      razonSocialRepo.findOne.mockResolvedValue({
        ...mockRazonSocial,
        habilitado: true,
        preferida: true,
      });
      await expect(
        service.updateRazonSocial('tenant-uuid', 'rs-uuid', {
          habilitado: false,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(razonSocialRepo.save).not.toHaveBeenCalled();
    });

    it('permite deshabilitar una razón social no preferida', async () => {
      razonSocialRepo.findOne.mockResolvedValue({
        ...mockRazonSocial,
        habilitado: true,
        preferida: false,
      });
      razonSocialRepo.save.mockResolvedValue({
        ...mockRazonSocial,
        habilitado: false,
        preferida: false,
      });
      const result = await service.updateRazonSocial('tenant-uuid', 'rs-uuid', {
        habilitado: false,
      });
      expect(result.habilitado).toBe(false);
    });
  });

  describe('getPreferenciasFinancieras', () => {
    it('retorna modos y fórmula ordenada', async () => {
      tenantRepo.findOne.mockResolvedValue({ ...mockTenant });
      tenantFormulaPrecioRepo.find.mockResolvedValue([
        { tenantId: 'tenant-uuid', paso: 1, tipo: 'descuentos' },
        { tenantId: 'tenant-uuid', paso: 2, tipo: 'recargos' },
        { tenantId: 'tenant-uuid', paso: 3, tipo: 'impuestos' },
      ]);

      const result = await service.getPreferenciasFinancieras('tenant-uuid');

      expect(tenantFormulaPrecioRepo.find).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-uuid' },
        order: { paso: 'ASC' },
      });
      expect(result.calculoDescuentos).toBe('base');
      expect(result.calculoRecargos).toBe('base');
      expect(result.formula).toEqual(['descuentos', 'recargos', 'impuestos']);
      expect(result.escalaCalculo).toBe(6);
      expect(result.modoRedondeo).toBe('HALF_UP');
      expect(result.montoTolerancia).toBe('0');
    });

    it('lanza NotFoundException si el tenant no existe', async () => {
      tenantRepo.findOne.mockResolvedValue(null);
      await expect(
        service.getPreferenciasFinancieras('no-existe'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updatePreferenciasFinancieras', () => {
    it('persiste modos y reescribe la fórmula con pasos correctos', async () => {
      const mockManager = { query: jest.fn().mockResolvedValue(undefined) };
      dataSource.transaction.mockImplementation(
        (cb: (m: typeof mockManager) => Promise<unknown>) => cb(mockManager),
      );
      tenantFormulaPrecioRepo.find.mockResolvedValue([
        { tenantId: 'tenant-uuid', paso: 1, tipo: 'recargos' },
        { tenantId: 'tenant-uuid', paso: 2, tipo: 'descuentos' },
        { tenantId: 'tenant-uuid', paso: 3, tipo: 'impuestos' },
      ]);

      const dto = {
        calculoDescuentos: 'compuesto',
        calculoRecargos: 'base',
        formula: ['recargos', 'descuentos', 'impuestos'],
        escalaCalculo: 4,
        modoRedondeo: 'HALF_EVEN',
        montoTolerancia: '1.5',
      };

      const result = await service.updatePreferenciasFinancieras(
        'tenant-uuid',
        dto,
      );

      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE tenants'),
        ['compuesto', 'base', 4, 'HALF_EVEN', '1.5', 'tenant-uuid'],
      );
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM tenant_formula_precio'),
        ['tenant-uuid'],
      );
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tenant_formula_precio'),
        ['tenant-uuid', 1, 'recargos'],
      );
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tenant_formula_precio'),
        ['tenant-uuid', 2, 'descuentos'],
      );
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tenant_formula_precio'),
        ['tenant-uuid', 3, 'impuestos'],
      );
      expect(result.formula).toEqual(['recargos', 'descuentos', 'impuestos']);
      expect(result.calculoDescuentos).toBe('compuesto');
      expect(result.escalaCalculo).toBe(4);
      expect(result.modoRedondeo).toBe('HALF_EVEN');
      expect(result.montoTolerancia).toBe('1.5');
    });

    it('lanza BadRequestException si la fórmula tiene tipos duplicados', async () => {
      const dto = {
        calculoDescuentos: 'base',
        calculoRecargos: 'base',
        formula: ['descuentos', 'descuentos', 'impuestos'],
        escalaCalculo: 6,
        modoRedondeo: 'HALF_UP',
        montoTolerancia: '0',
      };
      await expect(
        service.updatePreferenciasFinancieras('tenant-uuid', dto),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si la fórmula tiene solo 2 tipos distintos', async () => {
      const dto = {
        calculoDescuentos: 'base',
        calculoRecargos: 'base',
        formula: ['descuentos', 'recargos', 'descuentos'],
        escalaCalculo: 6,
        modoRedondeo: 'HALF_UP',
        montoTolerancia: '0',
      };
      await expect(
        service.updatePreferenciasFinancieras('tenant-uuid', dto),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });
});
