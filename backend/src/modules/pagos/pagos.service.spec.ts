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

// Segundo método con vuelto, para ejercer el reparto del excedente entre varios.
// Su id ordena DESPUÉS de EFECTIVO_ID, que es el criterio determinista del reparto.
const VALE_ID = '550e8400-e29b-41d4-a716-446655440109';
const METODO_VALE_ROWS = [
  { metodo_pago_id: VALE_ID, nombre: 'Vale vista', permite_vuelto: true },
];

// Método SIN vuelto cuyo id ordena ANTES que EFECTIVO_ID. Existe para que el
// test del vuelto no pueda pasar por coincidencia: si el método con vuelto
// fuera también el primero del array y el primero por id, "elegir por permiso",
// "elegir el primero" y "elegir por orden de id" darían todos el mismo
// resultado y el test no distinguiría entre las tres.
const CHEQUE_ID = '550e8400-e29b-41d4-a716-446655440100';
const METODO_CHEQUE_ROWS = [
  { metodo_pago_id: CHEQUE_ID, nombre: 'Cheque', permite_vuelto: false },
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
            bloquearCajaAbierta: jest.fn().mockResolvedValue(undefined),
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
      expect(result).toEqual({ pagos: [], montoAplicadoVenta: '0.0000' });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('rechaza un metodoPagoId que el tenant no tiene contratado', async () => {
      // METODO_EFECTIVO_ROWS es lo que devuelve la query filtrada por tenant:
      // TARJETA_ID existe en el catálogo global pero no para este tenant.
      const manager = buildManagerMock(METODO_EFECTIVO_ROWS);

      const module: TestingModule = await setupModule(manager);
      const svc = module.get<PagosService>(PagosService);
      const cajaSvc = module.get<jest.Mocked<CajaService>>(CajaService);

      await expect(
        svc.registrar(manager as unknown as EntityManager, {
          tenantId: TENANT_ID,
          ventaId: VENTA_ID,
          pagos: [{ metodoPagoId: TARJETA_ID, monto: '100.0000' }],
          cajaId: CAJA_ID,
          monedaOficialId: MONEDA_ID,
          target: '100.0000',
        }),
      ).rejects.toThrow('Método de pago no habilitado para este tenant');

      // El gate corre ANTES de escribir: ni pago ni movimiento de caja.
      expect(manager.save).not.toHaveBeenCalled();
      expect(cajaSvc.registrarMovimientoEnTransaccion).not.toHaveBeenCalled();
    });

    it('rechaza el pago no habilitado aunque venga mezclado con uno válido', async () => {
      const manager = buildManagerMock(METODO_EFECTIVO_ROWS);

      const module: TestingModule = await setupModule(manager);
      const svc = module.get<PagosService>(PagosService);

      await expect(
        svc.registrar(manager as unknown as EntityManager, {
          tenantId: TENANT_ID,
          ventaId: VENTA_ID,
          pagos: [
            { metodoPagoId: EFECTIVO_ID, monto: '50.0000' },
            { metodoPagoId: TARJETA_ID, monto: '50.0000' },
          ],
          cajaId: CAJA_ID,
          monedaOficialId: MONEDA_ID,
          target: '100.0000',
        }),
      ).rejects.toThrow(BadRequestException);

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

      expect(result.pagos).toHaveLength(1);
      expect(result.montoAplicadoVenta).toBe('100.0000');

      expect(cajaSvc.registrarMovimientoEnTransaccion).toHaveBeenCalledTimes(1);
    });

    it('persiste aplicación venta y propina con cobro mixto (orden-independiente)', async () => {
      const manager = buildManagerMock([
        ...METODO_EFECTIVO_ROWS,
        ...METODO_TARJETA_ROWS,
      ]);
      // Cada save de Pago necesita id distinto
      let pagoSeq = 0;
      manager.save.mockImplementation(
        (_entity: unknown, data: Record<string, unknown>): Promise<unknown> => {
          if (data['metodoPagoId'] !== undefined) {
            pagoSeq += 1;
            return Promise.resolve({
              id: `pago-${pagoSeq}`,
              ...data,
              vuelto: (data['vuelto'] as string | undefined) ?? '0.0000',
            });
          }
          return Promise.resolve({ id: 'app-1', ...data });
        },
      );

      const module: TestingModule = await setupModule(manager);
      const svc = module.get<PagosService>(PagosService);

      const result = await svc.registrar(manager as unknown as EntityManager, {
        tenantId: TENANT_ID,
        ventaId: VENTA_ID,
        pagos: [
          { metodoPagoId: EFECTIVO_ID, monto: '30000' },
          { metodoPagoId: TARJETA_ID, monto: '25000' },
        ],
        cajaId: CAJA_ID,
        monedaOficialId: MONEDA_ID,
        target: '55000',
        propinaMonto: '5000',
        ventaPropinaId: 'vp-uuid',
      });

      expect(result.montoAplicadoVenta).toBe('50000.0000');
      const appSaves = (
        manager.save.mock.calls as [unknown, Record<string, unknown>][]
      ).filter((c) => c[1]?.['tipo'] !== undefined);
      const tipos = appSaves.map((c) => ({
        tipo: c[1]['tipo'],
        monto: c[1]['monto'],
        pagoId: c[1]['pagoId'],
      }));
      expect(tipos).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            tipo: 'venta',
            monto: '30000.0000',
            pagoId: 'pago-1',
          }),
          expect.objectContaining({
            tipo: 'venta',
            monto: '20000.0000',
            pagoId: 'pago-2',
          }),
          expect.objectContaining({
            tipo: 'propina',
            monto: '5000.0000',
            pagoId: 'pago-2',
          }),
        ]),
      );
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

    it('con métodos mixtos, el vuelto va al que lo permite y a ningún otro', async () => {
      // El único test de excedente usaba UN solo método, así que el índice 0 era
      // siempre "el correcto" pasara lo que pasara.
      //
      // Hacen falta TRES pagos, no dos: con dos, el que permite vuelto es a la
      // vez "el último del array", "el de id mayor" y "el de monto mayor", así
      // que el test pasaría igual con cualquiera de esas heurísticas erróneas.
      // Acá el efectivo queda en el medio en las cuatro dimensiones:
      //   posición  → cheque(0)   efectivo(1)   tarjeta(2)
      //   id        → cheque…0100 efectivo…0105 tarjeta…0200
      //   monto     → cheque 30   efectivo 50   tarjeta 70
      // Ninguna heurística de posición, id o monto acierta: solo mirar
      // `permite_vuelto` da el resultado aseverado.
      const manager = buildManagerMock([
        ...METODO_CHEQUE_ROWS,
        ...METODO_EFECTIVO_ROWS,
        ...METODO_TARJETA_ROWS,
      ]);

      const module: TestingModule = await setupModule(manager);
      const svc = module.get<PagosService>(PagosService);
      const cajaSvc = module.get<jest.Mocked<CajaService>>(CajaService);

      // suma 150, target 120 → excedente 30, cubierto por el efectivo (50).
      await svc.registrar(manager as unknown as EntityManager, {
        tenantId: TENANT_ID,
        ventaId: VENTA_ID,
        pagos: [
          { metodoPagoId: CHEQUE_ID, monto: '30.0000' },
          { metodoPagoId: EFECTIVO_ID, monto: '50.0000' },
          { metodoPagoId: TARJETA_ID, monto: '70.0000' },
        ],
        cajaId: CAJA_ID,
        monedaOficialId: MONEDA_ID,
        target: '120.0000',
      });

      const vueltos = (manager.save.mock.calls as unknown[][])
        .map((c) => c[1] as Record<string, unknown>)
        .filter((d) => d && d['vuelto'] !== undefined)
        .map((d) => ({ metodo: d['metodoPagoId'], vuelto: d['vuelto'] }));
      expect(vueltos).toEqual([
        { metodo: CHEQUE_ID, vuelto: '0.0000' },
        { metodo: EFECTIVO_ID, vuelto: '30.0000' },
        { metodo: TARJETA_ID, vuelto: '0.0000' },
      ]);

      // Netos: 30, 50−30 y 70. Ninguno negativo y suman el target.
      const montos = cajaSvc.registrarMovimientoEnTransaccion.mock.calls.map(
        (c) => (c[1] as { monto: string }).monto,
      );
      expect(montos).toEqual(['30.0000', '20.0000', '70.0000']);
    });

    it('rechaza el excedente que no se puede devolver: los métodos sin vuelto superan el target', async () => {
      // El bug: el excedente (60) se asignaba entero al único pago con vuelto,
      // que solo aportó 10 → su neto quedaba en -50 y se persistía un movimiento
      // de caja `entrada` con monto negativo.
      const manager = buildManagerMock([
        ...METODO_EFECTIVO_ROWS,
        ...METODO_TARJETA_ROWS,
      ]);

      const module: TestingModule = await setupModule(manager);
      const svc = module.get<PagosService>(PagosService);
      const cajaSvc = module.get<jest.Mocked<CajaService>>(CajaService);

      await expect(
        svc.registrar(manager as unknown as EntityManager, {
          tenantId: TENANT_ID,
          ventaId: VENTA_ID,
          pagos: [
            { metodoPagoId: TARJETA_ID, monto: '150.0000' },
            { metodoPagoId: EFECTIVO_ID, monto: '10.0000' },
          ],
          cajaId: CAJA_ID,
          monedaOficialId: MONEDA_ID,
          target: '100.0000',
        }),
      ).rejects.toThrow('El excedente supera lo devolvible');

      expect(manager.save).not.toHaveBeenCalled();
      expect(cajaSvc.registrarMovimientoEnTransaccion).not.toHaveBeenCalled();
    });

    it('reparte el vuelto entre los métodos que lo permiten, acotado al monto de cada pago', async () => {
      const manager = buildManagerMock([
        ...METODO_EFECTIVO_ROWS,
        ...METODO_VALE_ROWS,
      ]);

      const module: TestingModule = await setupModule(manager);
      const svc = module.get<PagosService>(PagosService);
      const cajaSvc = module.get<jest.Mocked<CajaService>>(CajaService);

      // suma 110, target 50 → excedente 60, mayor que el primer pago con vuelto.
      await svc.registrar(manager as unknown as EntityManager, {
        tenantId: TENANT_ID,
        ventaId: VENTA_ID,
        pagos: [
          { metodoPagoId: EFECTIVO_ID, monto: '10.0000' },
          { metodoPagoId: VALE_ID, monto: '100.0000' },
        ],
        cajaId: CAJA_ID,
        monedaOficialId: MONEDA_ID,
        target: '50.0000',
      });

      const vueltos = (manager.save.mock.calls as unknown[][])
        .map((c) => c[1] as Record<string, unknown>)
        .filter((d) => d && d['vuelto'] !== undefined)
        .map((d) => d['vuelto']);
      // Orden determinista por metodoPagoId: efectivo (…105) antes que vale (…109).
      expect(vueltos).toEqual(['10.0000', '50.0000']);

      // La invariante que el bug rompía: ningún movimiento de caja negativo.
      const montos = cajaSvc.registrarMovimientoEnTransaccion.mock.calls.map(
        (c) => (c[1] as { monto: string }).monto,
      );
      expect(montos).toEqual(['0.0000', '50.0000']);
      for (const m of montos) {
        expect(new Decimal(m).isNegative()).toBe(false);
      }
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

    it('rechaza el abono si la caja existe pero está en conciliación', async () => {
      // Gemela del test de VentasService: `!caja` ya tenía cobertura, pero la
      // caja presente-pero-no-abierta no la ejercía nada. Borrar el `if` de
      // `pagos.service.ts` no rompía ningún test.
      const manager = buildAbonableManager('pendiente');
      const module: TestingModule = await setupModule(manager, {
        ...mockCajaActiva,
        estado: 'en_conciliacion',
      });
      const svc = module.get<PagosService>(PagosService);
      const cajaSvc = module.get<jest.Mocked<CajaService>>(CajaService);

      await expect(
        svc.registrarAbono(TENANT_ID, USUARIO_ID, {
          ventaId: VENTA_ID,
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '50.0000' }],
        }),
      ).rejects.toThrow('La caja está en conciliación y no admite pagos');

      expect(cajaSvc.bloquearCajaAbierta).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
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

    it('toma el lock de la caja dentro de la transacción antes de escribir', async () => {
      // `findActiva` lee por repositorio, fuera de la transacción: sin este lock
      // un cierre concurrente puede commitear antes del movimiento de caja.
      const manager = buildAbonableManager('pendiente', '100.0000', '0');
      manager.query.mockResolvedValueOnce(METODO_EFECTIVO_ROWS);
      manager.query.mockResolvedValueOnce([]);

      const module: TestingModule = await setupModule(manager);
      const svc = module.get<PagosService>(PagosService);
      const cajaSvc = module.get<jest.Mocked<CajaService>>(CajaService);

      await svc.registrarAbono(TENANT_ID, USUARIO_ID, {
        ventaId: VENTA_ID,
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '50.0000' }],
      });

      expect(cajaSvc.bloquearCajaAbierta).toHaveBeenCalledWith(
        manager,
        CAJA_ID,
        TENANT_ID,
      );
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

  // ────────────────────────────────────────────────────────────────────
  //  listar() / resumen()
  // ────────────────────────────────────────────────────────────────────

  describe('resumen()', () => {
    it('retorna KPIs globales del tenant', async () => {
      dataSourceMock.query.mockResolvedValueOnce([
        {
          total_pagos: 10,
          monto_cobrado: '1500.0000',
          pagos_hoy: 2,
          monto_hoy: '300.0000',
        },
      ]);

      const result = await service.resumen(TENANT_ID);

      expect(result).toEqual({
        totalPagos: 10,
        montoCobrado: '1500.0000',
        pagosHoy: 2,
        montoHoy: '300.0000',
      });
    });
  });

  describe('listar()', () => {
    const PAGO_ROW = {
      pago_id: 'pago-uuid-001',
      venta_id: VENTA_ID,
      monto: '100.0000',
      vuelto: '0.0000',
      fecha: new Date('2026-06-30'),
      caja_id: CAJA_ID,
      referencia: null,
      metodo_nombre: 'Efectivo',
      venta_estado: 'pagada',
      total_final: '100.0000',
      customer_nombre: 'Cliente Test',
    };

    it('retorna respuesta paginada con meta', async () => {
      dataSourceMock.query
        .mockResolvedValueOnce([{ total: 25 }])
        .mockResolvedValueOnce([PAGO_ROW]);

      const result = await service.listar(TENANT_ID, { page: 2, pageSize: 15 });

      expect(result.meta).toEqual({
        page: 2,
        pageSize: 15,
        total: 25,
        totalPages: 2,
      });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('pago-uuid-001');
      expect(result.data[0].metodoNombre).toBe('Efectivo');
    });

    it('aplica filtro ventaEstado en count y listado', async () => {
      dataSourceMock.query
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([PAGO_ROW]);

      await service.listar(TENANT_ID, { ventaEstado: EstadoVenta.PAGADA });

      const countSql = dataSourceMock.query.mock.calls[0][0] as string;
      expect(countSql).toContain('v.estado');
      expect(dataSourceMock.query.mock.calls[0][1]).toContain(
        EstadoVenta.PAGADA,
      );
    });
  });
});
