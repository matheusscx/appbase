import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { PagosService, calcularEstadoVenta } from './pagos.service';
import { CajaService } from '../caja/caja.service';
import { EstadoVenta } from '../ventas/entities/venta.entity';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const USUARIO_ID = '550e8400-e29b-41d4-a716-446655440056';
const CAJA_ID = 'caja-uuid-001';
const MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const VENTA_ID = 'venta-uuid-001';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const TARJETA_ID = '550e8400-e29b-41d4-a716-446655440200';

const mockCajaActiva = {
  id: CAJA_ID,
  tenantId: TENANT_ID,
  tipo: 'fisica',
  estado: 'abierta',
};

const METODO_EFECTIVO_ROWS = [
  { metodo_pago_id: EFECTIVO_ID, nombre: 'Efectivo', permite_vuelto: true },
];

const METODO_TARJETA_ROWS = [
  { metodo_pago_id: TARJETA_ID, nombre: 'Tarjeta', permite_vuelto: false },
];

function buildManagerMock(metodoRows = METODO_EFECTIVO_ROWS) {
  const pago = { id: 'pago-uuid-001' };
  return {
    create: jest
      .fn()
      .mockImplementation(
        (_entity: unknown, data: Record<string, unknown>) => ({ ...data }),
      ),
    save: jest
      .fn()
      .mockImplementation(
        (_entity: unknown, data: Record<string, unknown>): Promise<unknown> => {
          if (data['monto'] !== undefined)
            return Promise.resolve({
              ...pago,
              ...data,
              vuelto: (data['vuelto'] as string | undefined) ?? '0.0000',
            });
          return Promise.resolve({ ...data });
        },
      ),
    query: jest.fn().mockResolvedValue(metodoRows),
  };
}

describe('calcularEstadoVenta (helper puro)', () => {
  it('retorna PENDIENTE cuando monto aplicado es 0', () => {
    expect(calcularEstadoVenta('100.0000', '0')).toBe(EstadoVenta.PENDIENTE);
  });

  it('retorna PAGADA_PARCIAL cuando monto aplicado > 0 y < total', () => {
    expect(calcularEstadoVenta('100.0000', '50.0000')).toBe(
      EstadoVenta.PAGADA_PARCIAL,
    );
  });

  it('retorna PAGADA cuando monto aplicado es igual al total', () => {
    expect(calcularEstadoVenta('100.0000', '100.0000')).toBe(
      EstadoVenta.PAGADA,
    );
  });

  it('retorna PAGADA cuando monto aplicado supera el total', () => {
    expect(calcularEstadoVenta('100.0000', '150.0000')).toBe(
      EstadoVenta.PAGADA,
    );
  });
});

describe('PagosService', () => {
  let service: PagosService;
  let dataSourceMock: {
    transaction: jest.Mock;
    query: jest.Mock;
  };

  function setupModule(
    managerOverride?: ReturnType<typeof buildManagerMock>,
    cajaActiva: unknown = mockCajaActiva,
  ) {
    const manager = managerOverride ?? buildManagerMock();
    dataSourceMock = {
      transaction: jest
        .fn()
        .mockImplementation((cb: (m: typeof manager) => unknown) =>
          cb(manager),
        ),
      query: jest.fn().mockResolvedValue([]),
    };

    return Test.createTestingModule({
      providers: [
        PagosService,
        {
          provide: CajaService,
          useValue: {
            findActiva: jest.fn().mockResolvedValue(cajaActiva),
            registrarMovimientoEnTransaccion: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: getDataSourceToken(),
          useValue: dataSourceMock,
        },
      ],
    }).compile();
  }

  beforeEach(async () => {
    const module: TestingModule = await setupModule();
    service = module.get<PagosService>(PagosService);
  });

  // ────────────────────────────────────────────────────────────────────
  //  registrar()
  // ────────────────────────────────────────────────────────────────────

  describe('registrar()', () => {
    it('retorna [] cuando pagos es array vacío (venta a crédito)', async () => {
      const manager = buildManagerMock();
      const result = await service.registrar(
        manager as unknown as EntityManager,
        {
          tenantId: TENANT_ID,
          ventaId: VENTA_ID,
          pagos: [],
          cajaId: CAJA_ID,
          monedaOficialId: MONEDA_ID,
          target: '100.0000',
        },
      );
      expect(result).toEqual([]);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('guarda un Pago y llama registrarMovimientoEnTransaccion para un pago sin excedente', async () => {
      const manager = buildManagerMock(METODO_EFECTIVO_ROWS);

      const module: TestingModule = await setupModule(manager);
      const svc = module.get<PagosService>(PagosService);
      const cajaSvc = module.get<jest.Mocked<CajaService>>(CajaService);

      const result = await svc.registrar(manager as unknown as EntityManager, {
        tenantId: TENANT_ID,
        ventaId: VENTA_ID,
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '100.0000' }],
        cajaId: CAJA_ID,
        monedaOficialId: MONEDA_ID,
        target: '100.0000',
      });

      expect(result).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(cajaSvc.registrarMovimientoEnTransaccion).toHaveBeenCalledTimes(1);
    });

    it('asigna vuelto al pago con permite_vuelto cuando suma supera el target', async () => {
      const manager = buildManagerMock(METODO_EFECTIVO_ROWS);

      const module: TestingModule = await setupModule(manager);
      const svc = module.get<PagosService>(PagosService);

      await svc.registrar(manager as unknown as EntityManager, {
        tenantId: TENANT_ID,
        ventaId: VENTA_ID,
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '150.0000' }],
        cajaId: CAJA_ID,
        monedaOficialId: MONEDA_ID,
        target: '100.0000',
      });

      // manager.save should have been called with vuelto = '50.0000'
      const saveCalls = manager.save.mock.calls as unknown[][];
      const pagoCalls = saveCalls.filter((c) => {
        const d = c[1] as Record<string, unknown>;
        return d && d['vuelto'] !== undefined;
      });
      expect(pagoCalls.length).toBeGreaterThan(0);
      const pagoData = pagoCalls[0][1] as Record<string, unknown>;
      expect(pagoData['vuelto']).toBe('50.0000');
    });

    it('lanza BadRequestException cuando excedente > 0 y ningún método permite vuelto', async () => {
      const manager = buildManagerMock(METODO_TARJETA_ROWS);

      const module: TestingModule = await setupModule(manager);
      const svc = module.get<PagosService>(PagosService);

      await expect(
        svc.registrar(manager as unknown as EntityManager, {
          tenantId: TENANT_ID,
          ventaId: VENTA_ID,
          pagos: [{ metodoPagoId: TARJETA_ID, monto: '150.0000' }],
          cajaId: CAJA_ID,
          monedaOficialId: MONEDA_ID,
          target: '100.0000',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  //  registrarAbono()
  // ────────────────────────────────────────────────────────────────────

  describe('registrarAbono()', () => {
    function makeVentaRows(estado: string, totalFinal = '100.0000') {
      return [
        {
          venta_id: VENTA_ID,
          total_final: totalFinal,
          estado,
          moneda_id: MONEDA_ID,
        },
      ];
    }

    function makePagosAplicadosRows(montoAplicado = '0') {
      return [{ monto_aplicado: montoAplicado }];
    }

    function buildAbonableManager(
      estado: string,
      totalFinal = '100.0000',
      montoAplicado = '0',
    ) {
      // manager.query: 1ª llamada = venta, 2ª llamada = pagos aplicados
      const manager = buildManagerMock(METODO_EFECTIVO_ROWS);
      manager.query
        .mockResolvedValueOnce(makeVentaRows(estado, totalFinal))
        .mockResolvedValueOnce(makePagosAplicadosRows(montoAplicado));
      return manager;
    }

    it('lanza NotFoundException si la venta no existe', async () => {
      const manager = buildManagerMock();
      manager.query
        .mockResolvedValueOnce([]) // venta not found
        .mockResolvedValueOnce([{ monto_aplicado: '0' }]);

      const module: TestingModule = await setupModule(manager);
      const svc = module.get<PagosService>(PagosService);

      await expect(
        svc.registrarAbono(TENANT_ID, USUARIO_ID, {
          ventaId: VENTA_ID,
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '50.0000' }],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('lanza BadRequestException si venta está en estado pagada', async () => {
      const manager = buildAbonableManager('pagada');
      const module: TestingModule = await setupModule(manager);
      const svc = module.get<PagosService>(PagosService);

      await expect(
        svc.registrarAbono(TENANT_ID, USUARIO_ID, {
          ventaId: VENTA_ID,
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '50.0000' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si venta está en estado cancelada', async () => {
      const manager = buildAbonableManager('cancelada');
      const module: TestingModule = await setupModule(manager);
      const svc = module.get<PagosService>(PagosService);

      await expect(
        svc.registrarAbono(TENANT_ID, USUARIO_ID, {
          ventaId: VENTA_ID,
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '50.0000' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si no hay caja abierta', async () => {
      const manager = buildAbonableManager('pendiente');
      const module: TestingModule = await setupModule(manager, null);
      const svc = module.get<PagosService>(PagosService);

      await expect(
        svc.registrarAbono(TENANT_ID, USUARIO_ID, {
          ventaId: VENTA_ID,
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '50.0000' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('retorna estado=pagada_parcial y saldo reducido con abono parcial', async () => {
      const manager = buildAbonableManager('pendiente', '100.0000', '0');
      // 3ª llamada de manager.query = metodos-pago (dentro de registrar)
      manager.query.mockResolvedValueOnce(METODO_EFECTIVO_ROWS);
      // 4ª llamada = UPDATE ventas
      manager.query.mockResolvedValueOnce([]);

      const module: TestingModule = await setupModule(manager);
      const svc = module.get<PagosService>(PagosService);

      const result = await svc.registrarAbono(TENANT_ID, USUARIO_ID, {
        ventaId: VENTA_ID,
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '50.0000' }],
      });

      expect(result.venta.estado).toBe(EstadoVenta.PAGADA_PARCIAL);
      expect(new Decimal(result.venta.saldo).toNumber()).toBeLessThan(100);
    });

    it('retorna estado=pagada y saldo=0 cuando abono completa el pago', async () => {
      const manager = buildAbonableManager('pendiente', '100.0000', '0');
      manager.query.mockResolvedValueOnce(METODO_EFECTIVO_ROWS);
      manager.query.mockResolvedValueOnce([]);

      const module: TestingModule = await setupModule(manager);
      const svc = module.get<PagosService>(PagosService);

      const result = await svc.registrarAbono(TENANT_ID, USUARIO_ID, {
        ventaId: VENTA_ID,
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '100.0000' }],
      });

      expect(result.venta.estado).toBe(EstadoVenta.PAGADA);
      expect(result.venta.saldo).toBe('0.0000');
    });
  });
});
