import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MonedasService } from './monedas.service';
import { TenantMoneda } from './entities/tenant-moneda.entity';

const OFICIAL = 'moneda-clp';
const USD = 'moneda-usd';
const TENANT = 'tenant-uuid';

describe('MonedasService', () => {
  let service: MonedasService;
  let tenantMonedaRepo: { save: jest.Mock };
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
    tenantMonedaRepo = { save: jest.fn((row) => Promise.resolve(row)) };
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
        MonedasService,
        {
          provide: getRepositoryToken(TenantMoneda),
          useValue: tenantMonedaRepo,
        },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get<MonedasService>(MonedasService);
  });

  describe('findMonedas', () => {
    it('fuerza habilitada=true y tasa=1 para la moneda oficial', async () => {
      dataSource.query.mockResolvedValue([
        {
          moneda_id: OFICIAL,
          nombre: 'Peso Chileno',
          codigo_iso: 'CLP',
          simbolo: '$',
          decimales: 0,
          es_oficial: true,
          es_default: true,
          habilitada: false,
          valor_del_dia: null,
        },
        {
          moneda_id: USD,
          nombre: 'Dólar',
          codigo_iso: 'USD',
          simbolo: '$',
          decimales: 2,
          es_oficial: false,
          es_default: false,
          habilitada: true,
          valor_del_dia: '950.000000',
        },
      ]);

      const result = await service.findMonedas(TENANT);

      expect(result[0]).toMatchObject({
        monedaId: OFICIAL,
        esOficial: true,
        habilitada: true,
        valorDelDia: '1',
      });
      expect(result[1]).toMatchObject({
        monedaId: USD,
        esOficial: false,
        habilitada: true,
        valorDelDia: '950.000000',
      });
    });
  });

  describe('updateMoneda', () => {
    it('rechaza deshabilitar la moneda oficial', async () => {
      managerMock.query.mockResolvedValue([
        { moneda_oficial_id: OFICIAL, en_pais: true },
      ]);
      await expect(
        service.updateMoneda(TENANT, OFICIAL, { habilitada: false }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza cambiar la tasa de la moneda oficial', async () => {
      managerMock.query.mockResolvedValue([
        { moneda_oficial_id: OFICIAL, en_pais: true },
      ]);
      await expect(
        service.updateMoneda(TENANT, OFICIAL, { valorDelDia: '2' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza NotFound si la moneda no pertenece al país del tenant', async () => {
      managerMock.query.mockResolvedValue([
        { moneda_oficial_id: OFICIAL, en_pais: false },
      ]);
      await expect(
        service.updateMoneda(TENANT, 'otra', { habilitada: true }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza deshabilitar la moneda predeterminada', async () => {
      managerMock.query.mockResolvedValue([
        { moneda_oficial_id: OFICIAL, en_pais: true },
      ]);
      managerMock.findOne.mockResolvedValue({
        tenantId: TENANT,
        monedaId: USD,
        habilitada: true,
        esDefault: true,
        valorDelDia: '950',
        eliminadoEl: null,
      });
      await expect(
        service.updateMoneda(TENANT, USD, { habilitada: false }),
      ).rejects.toThrow(BadRequestException);
    });

    it('habilita una moneda creando la fila si no existe (upsert)', async () => {
      managerMock.query.mockResolvedValue([
        { moneda_oficial_id: OFICIAL, en_pais: true },
      ]);
      managerMock.findOne.mockResolvedValue(null);

      const result = await service.updateMoneda(TENANT, USD, {
        habilitada: true,
        valorDelDia: '900',
      });

      expect(managerMock.create).toHaveBeenCalled();
      expect(result.habilitada).toBe(true);
      expect(result.valorDelDia).toBe('900');
      expect(tenantMonedaRepo.save).toHaveBeenCalled();
    });
  });

  describe('setDefault', () => {
    it('limpia el default anterior y marca el nuevo', async () => {
      managerMock.query.mockResolvedValue([
        { moneda_oficial_id: OFICIAL, en_pais: true },
      ]);
      managerMock.findOne.mockResolvedValue({
        tenantId: TENANT,
        monedaId: USD,
        habilitada: true,
        esDefault: false,
        valorDelDia: '950',
        eliminadoEl: null,
      });

      const result = await service.setDefault(TENANT, USD);

      expect(managerMock.query).toHaveBeenCalledWith(
        expect.stringContaining('SET es_default = false'),
        [TENANT],
      );
      expect(result.esDefault).toBe(true);
    });

    it('rechaza marcar como default una moneda deshabilitada', async () => {
      managerMock.query.mockResolvedValue([
        { moneda_oficial_id: OFICIAL, en_pais: true },
      ]);
      managerMock.findOne.mockResolvedValue({
        tenantId: TENANT,
        monedaId: USD,
        habilitada: false,
        esDefault: false,
        valorDelDia: null,
        eliminadoEl: null,
      });

      await expect(service.setDefault(TENANT, USD)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('permite default a la oficial aunque no tenga fila previa', async () => {
      managerMock.query.mockResolvedValue([
        { moneda_oficial_id: OFICIAL, en_pais: true },
      ]);
      managerMock.findOne.mockResolvedValue(null);

      const result = await service.setDefault(TENANT, OFICIAL);

      expect(result.esDefault).toBe(true);
      expect(result.habilitada).toBe(true);
      expect(result.valorDelDia).toBe('1');
    });
  });
});
