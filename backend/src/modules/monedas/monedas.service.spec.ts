import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Db } from '../../common/db/db.service';
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
    const dbMock = {
      transaccion: dataSource.transaction,
      query: dataSource.query,
      sinTransaccion: (fn: () => unknown) => fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonedasService,
        {
          provide: getRepositoryToken(TenantMoneda),
          useValue: tenantMonedaRepo,
        },
        // `dataSource` sigue provisto para armar `dbMock` (que reenvía a
        // `dataSource.transaction`/`.query`) — `MonedasService` ya no lo
        // inyecta directo, solo usa `Db`.
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: Db, useValue: dbMock },
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
          separador_decimal: ',',
          separador_miles: '.',
          locale: 'es-CL',
          es_oficial: true,
          habilitada: false,
          valor_del_dia: null,
        },
        {
          moneda_id: USD,
          nombre: 'Dólar',
          codigo_iso: 'USD',
          simbolo: '$',
          decimales: 2,
          separador_decimal: '.',
          separador_miles: ',',
          locale: 'en-US',
          es_oficial: false,
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
        separadorDecimal: ',',
        separadorMiles: '.',
        locale: 'es-CL',
      });
      expect(result[1]).toMatchObject({
        monedaId: USD,
        esOficial: false,
        habilitada: true,
        valorDelDia: '950.000000',
        separadorDecimal: '.',
        separadorMiles: ',',
        locale: 'en-US',
      });
    });
  });

  describe('decimalesOficiales', () => {
    it('resuelve por la moneda del PAÍS, no por la default del tenant', async () => {
      // La escala de la plata sale de `pais.moneda_oficial_id` (ADR-005).
      // `tenant_moneda.es_default` es preferencia de pantalla: cuál moneda
      // aparece primero en los selectores, y no decide ninguna cuenta.
      dataSource.query.mockResolvedValue([{ decimales: 0 }]);

      const result = await service.decimalesOficiales(TENANT);

      expect(result).toBe(0);
      const [sql, params] = dataSource.query.mock.calls[0] as [string, unknown];
      expect(sql).toContain('p.moneda_oficial_id');
      // La negativa es la que caza el revert: sin ella, una consulta que
      // volviera a filtrar por la preferencia de pantalla pasaría en verde
      // mientras siguiera nombrando la tabla `pais`.
      expect(sql).not.toContain('es_default');
      expect(params).toEqual([TENANT]);
    });

    it('lanza BadRequestException si el tenant no tiene moneda oficial configurada', async () => {
      dataSource.query.mockResolvedValue([]);

      await expect(service.decimalesOficiales(TENANT)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('decimalesDeLaVenta', () => {
    const VENTA = 'venta-uuid';

    it('devuelve los decimales de la moneda y el modoRedondeo congelado, parametrizado por tenant', async () => {
      dataSource.query.mockResolvedValue([
        { decimales: 0, config_calculo: { modoRedondeo: 'FLOOR' } },
      ]);

      const result = await service.decimalesDeLaVenta(VENTA, TENANT);

      expect(result).toEqual({ decimales: 0, modoRedondeo: 'FLOOR' });
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('eliminado_el IS NULL'),
        [VENTA, TENANT],
      );
    });

    it('devuelve modoRedondeo null si la venta no tiene config_calculo (p.ej. toda nota de crédito hoy)', async () => {
      dataSource.query.mockResolvedValue([
        { decimales: 0, config_calculo: null },
      ]);

      const result = await service.decimalesDeLaVenta(VENTA, TENANT);

      expect(result).toEqual({ decimales: 0, modoRedondeo: null });
    });

    it('lanza NotFound si la venta no existe, está borrada o no pertenece al tenant', async () => {
      dataSource.query.mockResolvedValue([]);

      await expect(service.decimalesDeLaVenta(VENTA, TENANT)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateMoneda', () => {
    it('rechaza deshabilitar la moneda oficial', async () => {
      dataSource.query.mockResolvedValue([
        { moneda_oficial_id: OFICIAL, en_pais: true },
      ]);
      await expect(
        service.updateMoneda(TENANT, OFICIAL, { habilitada: false }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza cambiar la tasa de la moneda oficial', async () => {
      dataSource.query.mockResolvedValue([
        { moneda_oficial_id: OFICIAL, en_pais: true },
      ]);
      await expect(
        service.updateMoneda(TENANT, OFICIAL, { valorDelDia: '2' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza NotFound si la moneda no pertenece al país del tenant', async () => {
      dataSource.query.mockResolvedValue([
        { moneda_oficial_id: OFICIAL, en_pais: false },
      ]);
      await expect(
        service.updateMoneda(TENANT, 'otra', { habilitada: true }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza deshabilitar la moneda OFICIAL, que es la única protegida', async () => {
      // El guard de "no se puede deshabilitar la predeterminada" se eliminó
      // junto con `es_default` el 2026-08-21: no protegía nada que este guard
      // no protegiera ya, y sostenía una segunda noción de "oficial".
      dataSource.query.mockResolvedValue([
        { moneda_oficial_id: OFICIAL, en_pais: true },
      ]);
      await expect(
        service.updateMoneda(TENANT, OFICIAL, { habilitada: false }),
      ).rejects.toThrow(BadRequestException);
    });

    it('habilita una moneda creando la fila si no existe (upsert)', async () => {
      dataSource.query.mockResolvedValue([
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
});
