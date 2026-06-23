import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { MetodosPagoService } from './metodos-pago.service';
import { TenantMetodoPago } from './entities/tenant-metodo-pago.entity';

const EFECTIVO = 'metodo-efectivo';
const TARJETA = 'metodo-tarjeta';
const TENANT = 'tenant-uuid';

describe('MetodosPagoService', () => {
  let service: MetodosPagoService;
  let tenantMetodoPagoRepo: { save: jest.Mock };
  let managerMock: {
    query: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let dataSource: {
    query: jest.Mock;
    transaction: jest.Mock;
    manager: typeof managerMock;
  };

  beforeEach(async () => {
    tenantMetodoPagoRepo = { save: jest.fn((row) => Promise.resolve(row)) };
    managerMock = {
      query: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({
        ...data,
      })),
      save: jest.fn((_entity: unknown, row: unknown) => Promise.resolve(row)),
    };
    dataSource = {
      query: jest.fn(),
      transaction: jest.fn((cb: (m: typeof managerMock) => Promise<unknown>) =>
        cb(managerMock),
      ),
      manager: managerMock,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetodosPagoService,
        {
          provide: getRepositoryToken(TenantMetodoPago),
          useValue: tenantMetodoPagoRepo,
        },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get<MetodosPagoService>(MetodosPagoService);
  });

  describe('findMetodosPago', () => {
    it('mapea snake_case → camelCase y aplica COALESCE de habilitada/permiteVuelto', async () => {
      dataSource.query.mockResolvedValue([
        {
          metodo_pago_id: EFECTIVO,
          nombre: 'Efectivo',
          abreviatura: 'EFE',
          habilitada: true,
          permite_vuelto: true,
        },
        {
          metodo_pago_id: TARJETA,
          nombre: 'Tarjeta',
          abreviatura: null,
          habilitada: false,
          permite_vuelto: false,
        },
      ]);

      const result = await service.findMetodosPago(TENANT);

      expect(result[0]).toEqual({
        metodoPagoId: EFECTIVO,
        nombre: 'Efectivo',
        abreviatura: 'EFE',
        habilitada: true,
        permiteVuelto: true,
      });
      expect(result[1]).toEqual({
        metodoPagoId: TARJETA,
        nombre: 'Tarjeta',
        abreviatura: null,
        habilitada: false,
        permiteVuelto: false,
      });
    });
  });

  describe('updateMetodoPago', () => {
    it('lanza NotFound si el método no está disponible para el país del tenant', async () => {
      managerMock.query.mockResolvedValue([{ en_pais: false }]);
      await expect(
        service.updateMetodoPago(TENANT, 'otro', { habilitada: true }),
      ).rejects.toThrow(NotFoundException);
    });

    it('habilita un método creando la fila si no existe (upsert)', async () => {
      managerMock.query.mockResolvedValue([{ en_pais: true }]);
      managerMock.findOne.mockResolvedValue(null);

      const result = await service.updateMetodoPago(TENANT, TARJETA, {
        habilitada: true,
        permiteVuelto: true,
      });

      expect(managerMock.create).toHaveBeenCalled();
      expect(result.habilitada).toBe(true);
      expect(result.permiteVuelto).toBe(true);
      expect(managerMock.save).toHaveBeenCalled();
    });

    it('restaura una fila soft-deleted y aplica los cambios', async () => {
      managerMock.query.mockResolvedValue([{ en_pais: true }]);
      managerMock.findOne.mockResolvedValue({
        tenantId: TENANT,
        metodoPagoId: TARJETA,
        habilitada: false,
        permiteVuelto: false,
        eliminadoEl: new Date(),
      });

      const result = await service.updateMetodoPago(TENANT, TARJETA, {
        habilitada: true,
      });

      expect(managerMock.findOne).toHaveBeenCalledWith(
        TenantMetodoPago,
        expect.objectContaining({ withDeleted: true }),
      );
      expect(managerMock.create).not.toHaveBeenCalled();
      expect(result.eliminadoEl).toBeNull();
      expect(result.habilitada).toBe(true);
      expect(result.permiteVuelto).toBe(false);
    });
  });
});
