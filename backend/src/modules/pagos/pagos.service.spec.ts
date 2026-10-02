import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { Db } from '../../common/db/db.service';
import { assertSinHuecos } from '../../common/db/db.spec-helper';
import { PagosService } from './pagos.service';
import { IdempotenciaService } from '../idempotencia/idempotencia.service';

const CLAVE = '2f1c8a3e-6a1b-4d8e-9a55-0c7b1f7d2e10';
import { CajaService } from '../caja/caja.service';
import { EstadoVenta } from '../ventas/entities/venta.entity';
import { VentaDocumentosService } from '../venta-documentos/venta-documentos.service';

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
  {
    metodo_pago_id: EFECTIVO_ID,
    nombre: 'Efectivo',
    permite_vuelto: true,
    emisor: 'sistema',
    es_efectivo: true,
  },
];

const METODO_TARJETA_ROWS = [
  {
    metodo_pago_id: TARJETA_ID,
    nombre: 'Tarjeta',
    permite_vuelto: false,
    emisor: 'maquina',
    es_efectivo: false,
  },
];

// Segundo método con vuelto, para ejercer el reparto del excedente entre varios.
// Su id ordena DESPUÉS de EFECTIVO_ID, que es el criterio determinista del reparto.
const VALE_ID = '550e8400-e29b-41d4-a716-446655440109';
const METODO_VALE_ROWS = [
  {
    metodo_pago_id: VALE_ID,
    nombre: 'Vale vista',
    permite_vuelto: true,
    emisor: 'nadie',
    es_efectivo: false,
  },
];

// Método SIN vuelto cuyo id ordena ANTES que EFECTIVO_ID. Existe para que el
// test del vuelto no pueda pasar por coincidencia: si el método con vuelto
// fuera también el primero del array y el primero por id, "elegir por permiso",
// "elegir el primero" y "elegir por orden de id" darían todos el mismo
// resultado y el test no distinguiría entre las tres.
const CHEQUE_ID = '550e8400-e29b-41d4-a716-446655440100';
const METODO_CHEQUE_ROWS = [
  {
    metodo_pago_id: CHEQUE_ID,
    nombre: 'Cheque',
    permite_vuelto: false,
    emisor: 'sistema',
    es_efectivo: false,
  },
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
    const dbMock = {
      transaccion: dataSourceMock.transaction,
      query: dataSourceMock.query,
      sinTransaccion: (fn: () => unknown) => fn(),
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
          provide: Db,
          useValue: dbMock,
        },
        // El duplicado de E1b se prueba en `venta-documentos.service.spec.ts`; acá
        // solo que `registrarAbono` lo llama con lo que corresponde.
        {
          provide: VentaDocumentosService,
          useValue: {
            registrarDuplicadoDeAbono: jest.fn().mockResolvedValue([]),
            // El enlace de cada pago a su documento también se prueba allá: acá, que
            // `registrarAbono` lo llama con lo que corresponde.
            enlazarPagosDeAbono: jest.fn().mockResolvedValue(undefined),
          },
        },
        // Pasa derecho a la operación: el reclamo y la reproducción se prueban
        // en `idempotencia.service.spec.ts` y contra Postgres en el e2e.
        {
          provide: IdempotenciaService,
          useValue: {
            ejecutar: (_s: unknown, operar: () => Promise<unknown>) => operar(),
          },
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
      expect(result).toEqual({
        pagos: [],
        montoAplicadoVenta: '0.0000',
        porPago: [],
      });
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

    describe('porPago: lo que cada pago aplicó a la venta y quién emite su medio', () => {
      // Los pagos van en un orden y las filas del medio vuelven en OTRO: el
      // resultado tiene que salir en el orden de la entrada, que es lo que
      // permite cruzar cada pago con el número que tipeó el cajero.
      function managerConIds(rows: typeof METODO_EFECTIVO_ROWS) {
        const manager = buildManagerMock(rows);
        let pagoSeq = 0;
        manager.save.mockImplementation(
          (
            _entity: unknown,
            data: Record<string, unknown>,
          ): Promise<unknown> => {
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
        return manager;
      }

      it('sale en el orden de la entrada, con emisor, esEfectivo y lo aplicado de ESE pago', async () => {
        const manager = managerConIds([
          ...METODO_TARJETA_ROWS,
          ...METODO_EFECTIVO_ROWS,
        ]);
        const module = await setupModule(manager);
        const svc = module.get<PagosService>(PagosService);

        const result = await svc.registrar(
          manager as unknown as EntityManager,
          {
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
          },
        );

        expect(result.porPago).toEqual([
          {
            pagoId: 'pago-1',
            metodoPagoId: EFECTIVO_ID,
            emisor: 'sistema',
            esEfectivo: true,
            aplicadoVenta: '30000.0000',
          },
          {
            pagoId: 'pago-2',
            metodoPagoId: TARJETA_ID,
            emisor: 'maquina',
            esEfectivo: false,
            // 25.000 menos 5.000 de propina.
            aplicadoVenta: '20000.0000',
          },
        ]);
        expect(
          result.porPago
            .reduce((a, p) => a.plus(p.aplicadoVenta), new Decimal(0))
            .toFixed(4),
        ).toBe(result.montoAplicadoVenta);
      });

      it('un pago que fue todo propina sale con aplicadoVenta 0', async () => {
        const manager = managerConIds([
          ...METODO_EFECTIVO_ROWS,
          ...METODO_TARJETA_ROWS,
        ]);
        const module = await setupModule(manager);
        const svc = module.get<PagosService>(PagosService);

        const result = await svc.registrar(
          manager as unknown as EntityManager,
          {
            tenantId: TENANT_ID,
            ventaId: VENTA_ID,
            pagos: [
              { metodoPagoId: EFECTIVO_ID, monto: '30000' },
              { metodoPagoId: TARJETA_ID, monto: '5000' },
            ],
            cajaId: CAJA_ID,
            monedaOficialId: MONEDA_ID,
            target: '35000',
            propinaMonto: '5000',
            ventaPropinaId: 'vp-uuid',
          },
        );

        expect(result.porPago.map((p) => p.aplicadoVenta)).toEqual([
          '30000.0000',
          '0.0000',
        ]);
      });
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
    function makeVentaRows(estado: string) {
      return [{ venta_id: VENTA_ID, estado, moneda_id: MONEDA_ID }];
    }

    // El saldo lo calcula la expresión ÚNICA de `saldo-venta.ts` (total − aplicado −
    // rebajado "sin plata"), que es SQL: un mock no la ve y la cubre el e2e. Acá solo
    // se afirma que el abono cobra CONTRA lo que esa consulta devolvió.
    function makeSaldoRows(saldo = '100.0000') {
      return [{ saldo }];
    }

    /** Lo que devuelve la regla única del estado tras el abono (también SQL). */
    function makeRecalculo(estado: string, saldo: string) {
      return [{ estado, saldo }];
    }

    function buildAbonableManager(estado: string, saldo = '100.0000') {
      // manager.query: 1ª llamada = venta (con lock), 2ª llamada = saldo
      const manager = buildManagerMock(METODO_EFECTIVO_ROWS);
      manager.query
        .mockResolvedValueOnce(makeVentaRows(estado))
        .mockResolvedValueOnce(makeSaldoRows(saldo));
      return manager;
    }

    it('lanza NotFoundException si la venta no existe', async () => {
      const manager = buildManagerMock();
      manager.query
        .mockResolvedValueOnce([]) // venta not found
        .mockResolvedValueOnce(makeSaldoRows());

      const module: TestingModule = await setupModule(manager);
      const svc = module.get<PagosService>(PagosService);

      await expect(
        svc.registrarAbono(
          TENANT_ID,
          USUARIO_ID,
          {
            ventaId: VENTA_ID,
            pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '50.0000' }],
          },
          CLAVE,
          true,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    // La forma de la consulta: el 404 de una venta ajena lo fija el e2e
    // (`visibilidad-ventas-pagos`), que es el que corre el SQL.
    it.each([
      [false, [VENTA_ID, TENANT_ID, USUARIO_ID], true],
      [true, [VENTA_ID, TENANT_ID], false],
    ])(
      'con verTodas=%p, el FOR UPDATE de la venta lleva el alcance de caja solo si hace falta',
      async (verTodas, binds, filtra) => {
        const manager = buildManagerMock();
        manager.query.mockResolvedValueOnce([]);
        const module: TestingModule = await setupModule(manager);
        const svc = module.get<PagosService>(PagosService);

        await expect(
          svc.registrarAbono(
            TENANT_ID,
            USUARIO_ID,
            {
              ventaId: VENTA_ID,
              pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '50.0000' }],
            },
            CLAVE,
            verTodas,
          ),
        ).rejects.toThrow(NotFoundException);
        const [sql, params] = manager.query.mock.calls[0] as [
          string,
          unknown[],
        ];
        expect(sql).toContain('FOR UPDATE');
        expect(sql.includes('c.usuario_id = $3')).toBe(filtra);
        expect(params).toEqual(binds);
      },
    );

    it('lanza BadRequestException si venta está en estado pagada', async () => {
      const manager = buildAbonableManager('pagada');
      const module: TestingModule = await setupModule(manager);
      const svc = module.get<PagosService>(PagosService);

      await expect(
        svc.registrarAbono(
          TENANT_ID,
          USUARIO_ID,
          {
            ventaId: VENTA_ID,
            pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '50.0000' }],
          },
          CLAVE,
          true,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si venta está en estado cancelada', async () => {
      const manager = buildAbonableManager('cancelada');
      const module: TestingModule = await setupModule(manager);
      const svc = module.get<PagosService>(PagosService);

      await expect(
        svc.registrarAbono(
          TENANT_ID,
          USUARIO_ID,
          {
            ventaId: VENTA_ID,
            pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '50.0000' }],
          },
          CLAVE,
          true,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si no hay caja abierta', async () => {
      const manager = buildAbonableManager('pendiente');
      const module: TestingModule = await setupModule(manager, null);
      const svc = module.get<PagosService>(PagosService);

      await expect(
        svc.registrarAbono(
          TENANT_ID,
          USUARIO_ID,
          {
            ventaId: VENTA_ID,
            pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '50.0000' }],
          },
          CLAVE,
          true,
        ),
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
        svc.registrarAbono(
          TENANT_ID,
          USUARIO_ID,
          {
            ventaId: VENTA_ID,
            pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '50.0000' }],
          },
          CLAVE,
          true,
        ),
      ).rejects.toThrow('La caja está en conciliación y no admite pagos');

      expect(cajaSvc.bloquearCajaAbierta).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('retorna estado=pagada_parcial y saldo reducido con abono parcial', async () => {
      const manager = buildAbonableManager('pendiente', '100.0000');
      // 3ª llamada de manager.query = metodos-pago (dentro de registrar)
      manager.query.mockResolvedValueOnce(METODO_EFECTIVO_ROWS);
      // 4ª llamada = el recálculo del estado (la regla única, SQL)
      manager.query.mockResolvedValueOnce(
        makeRecalculo('pagada_parcial', '50.0000'),
      );

      const module: TestingModule = await setupModule(manager);
      const svc = module.get<PagosService>(PagosService);

      const result = await svc.registrarAbono(
        TENANT_ID,
        USUARIO_ID,
        {
          ventaId: VENTA_ID,
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '50.0000' }],
        },
        CLAVE,
        true,
      );

      expect(result.venta).toEqual({
        id: VENTA_ID,
        estado: EstadoVenta.PAGADA_PARCIAL,
        saldo: '50.0000',
        puedeAbonar: true,
      });
    });

    it('toma el lock de la caja dentro de la transacción antes de escribir', async () => {
      // `findActiva` lee por repositorio, fuera de la transacción: sin este lock
      // un cierre concurrente puede commitear antes del movimiento de caja.
      const manager = buildAbonableManager('pendiente', '100.0000');
      manager.query.mockResolvedValueOnce(METODO_EFECTIVO_ROWS);
      manager.query.mockResolvedValueOnce(
        makeRecalculo('pagada_parcial', '50.0000'),
      );

      const module: TestingModule = await setupModule(manager);
      const svc = module.get<PagosService>(PagosService);
      const cajaSvc = module.get<jest.Mocked<CajaService>>(CajaService);

      await svc.registrarAbono(
        TENANT_ID,
        USUARIO_ID,
        {
          ventaId: VENTA_ID,
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '50.0000' }],
        },
        CLAVE,
        true,
      );

      expect(cajaSvc.bloquearCajaAbierta).toHaveBeenCalledWith(
        manager,
        CAJA_ID,
        TENANT_ID,
      );
    });

    describe('el abono no documenta, salvo el duplicado de la máquina (E1, E1b)', () => {
      const METODO_EFECTIVO_Y_TARJETA_ROWS = [
        ...METODO_EFECTIVO_ROWS,
        ...METODO_TARJETA_ROWS,
      ];

      async function abonar(
        pagos: {
          metodoPagoId: string;
          monto: string;
          numeroDocumento?: string;
          claseDocumento?: 'voucher' | 'boleta';
        }[],
        metodoRows: typeof METODO_EFECTIVO_Y_TARJETA_ROWS,
      ) {
        const manager = buildAbonableManager('pendiente', '100000.0000');
        manager.query.mockResolvedValueOnce(metodoRows); // métodos (en registrar)
        manager.query.mockResolvedValueOnce(
          makeRecalculo('pagada_parcial', '42500.0000'),
        ); // el recálculo del estado
        const module: TestingModule = await setupModule(manager);
        const svc = module.get<PagosService>(PagosService);
        const documentos = module.get<{
          registrarDuplicadoDeAbono: jest.Mock;
          enlazarPagosDeAbono: jest.Mock;
        }>(VentaDocumentosService);
        const result = await svc.registrarAbono(
          TENANT_ID,
          USUARIO_ID,
          { ventaId: VENTA_ID, pagos },
          CLAVE,
          true,
        );
        return { manager, documentos, result };
      }

      it('le pasa a los documentos lo aplicado de cada pago, su medio y el número y la clase que tipeó el cajero, en el orden de la entrada', async () => {
        const { manager, documentos, result } = await abonar(
          [
            {
              metodoPagoId: EFECTIVO_ID,
              monto: '20000',
              numeroDocumento: 'NO-APLICA',
            },
            {
              metodoPagoId: TARJETA_ID,
              monto: '37500',
              numeroDocumento: '778899',
              claseDocumento: 'voucher',
            },
          ],
          METODO_EFECTIVO_Y_TARJETA_ROWS,
        );

        expect(documentos.registrarDuplicadoDeAbono).toHaveBeenCalledTimes(1);
        const [mgr, params] = documentos.registrarDuplicadoDeAbono.mock
          .calls[0] as [unknown, Record<string, unknown>];
        // La misma transacción: el lock de la venta ya está tomado.
        expect(mgr).toBe(manager);
        expect(params).toMatchObject({
          tenantId: TENANT_ID,
          ventaId: VENTA_ID,
        });
        expect(params.pagos).toEqual([
          {
            pagoId: 'pago-uuid-001',
            metodoPagoId: EFECTIVO_ID,
            emisor: 'sistema',
            aplicadoVenta: '20000.0000',
            numeroDocumento: 'NO-APLICA',
            claseDocumento: undefined,
          },
          {
            pagoId: 'pago-uuid-001',
            metodoPagoId: TARJETA_ID,
            emisor: 'maquina',
            aplicadoVenta: '37500.0000',
            numeroDocumento: '778899',
            claseDocumento: 'voucher',
          },
        ]);
        // El cobro pasa igual.
        expect(result.venta.estado).toBe(EstadoVenta.PAGADA_PARCIAL);
      });

      it('enlaza TODOS los pagos del abono al documento de la deuda en una sola llamada, dentro de la misma transacción', async () => {
        const { manager, documentos } = await abonar(
          [
            { metodoPagoId: EFECTIVO_ID, monto: '20000' },
            { metodoPagoId: TARJETA_ID, monto: '37500' },
          ],
          METODO_EFECTIVO_Y_TARJETA_ROWS,
        );

        expect(documentos.enlazarPagosDeAbono).toHaveBeenCalledTimes(1);
        const [mgr, params] = documentos.enlazarPagosDeAbono.mock.calls[0] as [
          unknown,
          Record<string, unknown>,
        ];
        expect(mgr).toBe(manager);
        expect(params).toEqual({
          tenantId: TENANT_ID,
          ventaId: VENTA_ID,
          // Los dos, también el de la máquina: el duplicado no es el documento del pago.
          pagoIds: ['pago-uuid-001', 'pago-uuid-001'],
        });
      });

      it('el abono no crea documentos por su cuenta: solo delega en el duplicado', async () => {
        const { manager } = await abonar(
          [{ metodoPagoId: EFECTIVO_ID, monto: '20000' }],
          METODO_EFECTIVO_Y_TARJETA_ROWS,
        );
        const guardados = manager.save.mock.calls.map(
          (c: unknown[]) => (c[0] as { name?: string }).name,
        );
        expect(guardados).not.toContain('VentaDocumento');
      });
    });

    it('retorna estado=pagada y saldo=0 cuando abono completa el pago', async () => {
      const manager = buildAbonableManager('pendiente', '100.0000');
      manager.query.mockResolvedValueOnce(METODO_EFECTIVO_ROWS);
      manager.query.mockResolvedValueOnce(makeRecalculo('pagada', '0.0000'));

      const module: TestingModule = await setupModule(manager);
      const svc = module.get<PagosService>(PagosService);

      const result = await svc.registrarAbono(
        TENANT_ID,
        USUARIO_ID,
        {
          ventaId: VENTA_ID,
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '100.0000' }],
        },
        CLAVE,
        true,
      );

      expect(result.venta.estado).toBe(EstadoVenta.PAGADA);
      expect(result.venta.saldo).toBe('0.0000');
      // Sin saldo no hay "Registrar pago": lo dice el backend, no la pantalla.
      expect(result.venta.puedeAbonar).toBe(false);
    });

    describe('cobra solo lo que de verdad se debe (la expresión única del saldo)', () => {
      it('lee el saldo bajo el lock de la venta, con la expresión única y por el tenant del token', async () => {
        const manager = buildAbonableManager('pagada_parcial', '35000.0000');
        manager.query.mockResolvedValueOnce(METODO_EFECTIVO_ROWS);
        manager.query.mockResolvedValueOnce(makeRecalculo('pagada', '0.0000'));
        const module: TestingModule = await setupModule(manager);
        const svc = module.get<PagosService>(PagosService);

        await svc.registrarAbono(
          TENANT_ID,
          USUARIO_ID,
          {
            ventaId: VENTA_ID,
            pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '35000.0000' }],
          },
          CLAVE,
          true,
        );

        const [lock, lectura, , recalculo] = manager.query.mock.calls as [
          string,
          unknown[],
        ][];
        expect(lock[0]).toContain('FOR UPDATE');
        // El saldo cuenta lo rebajado "sin plata": no es `total − aplicado`.
        expect(lectura[0]).toContain('sv_c.venta_referencia_id');
        expect(lectura[1]).toEqual([VENTA_ID, TENANT_ID]);
        expect(recalculo[1]).toEqual([VENTA_ID, TENANT_ID]);
      });

      it('con el saldo en cero no hay nada que cobrar: 400 y no escribe ningún pago', async () => {
        // Estado leído `pendiente` pero deuda rebajada por completo: el estado y el
        // saldo son dos lecturas, y manda el saldo.
        const manager = buildAbonableManager('pendiente', '0.0000');
        const module: TestingModule = await setupModule(manager);
        const svc = module.get<PagosService>(PagosService);

        await expect(
          svc.registrarAbono(
            TENANT_ID,
            USUARIO_ID,
            {
              ventaId: VENTA_ID,
              pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '400.0000' }],
            },
            CLAVE,
            true,
          ),
        ).rejects.toThrow('La venta no tiene saldo pendiente');
        expect(manager.save).not.toHaveBeenCalled();
      });

      it('un medio sin vuelto no cobra más que ese saldo: 35.001 contra 35.000 es 400', async () => {
        const manager = buildAbonableManager('pagada_parcial', '35000.0000');
        manager.query.mockResolvedValueOnce(METODO_TARJETA_ROWS);
        const module: TestingModule = await setupModule(manager);
        const svc = module.get<PagosService>(PagosService);

        await expect(
          svc.registrarAbono(
            TENANT_ID,
            USUARIO_ID,
            {
              ventaId: VENTA_ID,
              pagos: [{ metodoPagoId: TARJETA_ID, monto: '35001.0000' }],
            },
            CLAVE,
            true,
          ),
        ).rejects.toThrow(BadRequestException);
        expect(manager.save).not.toHaveBeenCalled();
      });
    });
  });

  // ────────────────────────────────────────────────────────────────────
  //  listar() / resumen()
  // ────────────────────────────────────────────────────────────────────

  describe('resumen()', () => {
    it('retorna KPIs globales del tenant', async () => {
      dataSourceMock.query.mockResolvedValueOnce([
        { zona_horaria: 'America/Santiago', hora_corte: 5 },
      ]);
      dataSourceMock.query.mockResolvedValueOnce([
        {
          total_pagos: 10,
          monto_cobrado: '1500.0000',
          pagos_hoy: 2,
          monto_hoy: '300.0000',
        },
      ]);

      const result = await service.resumen(TENANT_ID, USUARIO_ID, true);

      expect(result).toEqual({
        totalPagos: 10,
        montoCobrado: '1500.0000',
        pagosHoy: 2,
        montoHoy: '300.0000',
      });
    });

    // Regresión del mismo 42P18 que cerró resumen-negocio.service.ts (Task 2
    // de `hora-de-corte`, medido 2026-09-19): un `$n` en el SQL sin bind, o un
    // bind sin `$n` que lo referencie, revienta en Postgres real aunque el
    // mock de `Db.query` de este test no lo vea — reconstruye la MISMA regla
    // desde el string y el array que el service le mandó a `db.query`.
    it('cada $n del SQL de "hoy" tiene bind, y cada bind está referenciado (evita 42P18)', async () => {
      dataSourceMock.query.mockResolvedValueOnce([
        { zona_horaria: 'America/Santiago', hora_corte: 5 },
      ]);
      dataSourceMock.query.mockResolvedValueOnce([{}]);

      await service.resumen(TENANT_ID, USUARIO_ID, true);

      const [sql, params] = dataSourceMock.query.mock.calls[1] as [
        string,
        unknown[],
      ];
      assertSinHuecos(sql, params);
    });

    // Ítem 3 de `2026-09-19-residuos-hora-de-corte/brief.md`: la misma
    // afirmación de arriba, pero en la rama `verTodas = false` — la que
    // agrega `usuarioId` a `params` y el `filtroDeMisCajas` al SQL, así que
    // es la más fácil de correr un índice y dejar un `$n` de más o de menos
    // (medido: el bug real que cerró `resumen-negocio.service.ts` fue
    // exactamente eso). El test de arriba nunca la ejercitó: `verTodas` iba
    // fijo en `true`.
    it('rama verTodas = false: cada $n del SQL tiene bind, y cada bind está referenciado (evita 42P18)', async () => {
      dataSourceMock.query.mockResolvedValueOnce([
        { zona_horaria: 'America/Santiago', hora_corte: 5 },
      ]);
      dataSourceMock.query.mockResolvedValueOnce([{}]);

      await service.resumen(TENANT_ID, USUARIO_ID, false);

      const [sql, params] = dataSourceMock.query.mock.calls[1] as [
        string,
        unknown[],
      ];
      assertSinHuecos(sql, params);
    });
  });

  describe('el eje "lo mío / todo"', () => {
    /**
     * Ni `pagos` ni `ventas` guardan quién los hizo: solo `caja_id`. Así que
     * "lo mío" se deriva por la caja, y el filtro tiene que ser un `EXISTS`
     * contra `cajas` — no un `p.usuario_id`, que no existe.
     */
    const sqlDe = (llamada: number): string =>
      (dataSourceMock.query.mock.calls[llamada][0] as string).replace(
        /\s+/g,
        ' ',
      );

    it('sin alcance completo, listar acota a las cajas del usuario', async () => {
      dataSourceMock.query
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([]);

      await service.listar(TENANT_ID, {}, USUARIO_ID, false);

      const sql = sqlDe(0);
      expect(sql).toContain('EXISTS');
      expect(sql).toContain('FROM cajas c');
      expect(sql).toContain('c.caja_id = p.caja_id');
      expect(sql).toContain('c.usuario_id =');
      expect(sql).toContain('c.eliminado_el IS NULL');
      // El id del usuario viaja como parámetro, nunca interpolado.
      expect(dataSourceMock.query.mock.calls[0][1]).toContain(USUARIO_ID);
    });

    it('el MISMO filtro va en la query del COUNT y en la de las filas', async () => {
      // Si el count no lo lleva, la paginación miente: `total` cuenta pagos que
      // el usuario no puede ver, y la última página vuelve vacía.
      dataSourceMock.query
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([]);

      await service.listar(TENANT_ID, {}, USUARIO_ID, false);

      expect(sqlDe(0)).toContain('c.usuario_id =');
      expect(sqlDe(1)).toContain('c.usuario_id =');
    });

    it('con alcance completo no acota nada', async () => {
      dataSourceMock.query
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([]);

      await service.listar(TENANT_ID, {}, USUARIO_ID, true);

      expect(sqlDe(0)).not.toContain('c.usuario_id =');
    });

    it('un pago SIN caja no es de nadie: el filtro no lo perdona', async () => {
      // `caja_id` es nullable. Hoy ningún camino lo deja en NULL, pero la
      // columna lo permite: el filtro es un EXISTS, que con NULL da falso, y
      // NO lleva un `OR p.caja_id IS NULL` que lo metería en "lo mío".
      dataSourceMock.query
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([]);

      await service.listar(TENANT_ID, {}, USUARIO_ID, false);

      expect(sqlDe(0)).not.toContain('caja_id IS NULL');
    });

    it('los pagos de una venta ONLINE quedan visibles, igual que en ventas', async () => {
      // Sin esta rama, `ventas` y `pagos` tratan distinto a la MISMA fila: el
      // cajero ve la venta online y sus pagos por GET /ventas/:id pero no en
      // /pagos, así que la exclusión no compra seguridad y descuadra los KPI.
      dataSourceMock.query
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([]);

      await service.listar(TENANT_ID, {}, USUARIO_ID, false);

      expect(sqlDe(0)).toContain("vo.canal = 'online'");
    });

    // La llamada 0 del resumen resuelve la zona del tenant; los KPI son la 1.
    it('resumen acota igual que listar', async () => {
      dataSourceMock.query
        .mockResolvedValueOnce([
          { zona_horaria: 'America/Santiago', hora_corte: 5 },
        ])
        .mockResolvedValueOnce([{}]);

      await service.resumen(TENANT_ID, USUARIO_ID, false);

      expect(sqlDe(1)).toContain('c.usuario_id =');
      expect(dataSourceMock.query.mock.calls[1][1]).toContain(USUARIO_ID);
    });

    it('resumen con alcance completo sigue siendo del tenant', async () => {
      dataSourceMock.query
        .mockResolvedValueOnce([
          { zona_horaria: 'America/Santiago', hora_corte: 5 },
        ])
        .mockResolvedValueOnce([{}]);

      await service.resumen(TENANT_ID, USUARIO_ID, true);

      expect(sqlDe(1)).not.toContain('c.usuario_id =');
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

      const result = await service.listar(
        TENANT_ID,
        { page: 2, pageSize: 15 },
        USUARIO_ID,
        true,
      );

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

      await service.listar(
        TENANT_ID,
        { ventaEstado: EstadoVenta.PAGADA },
        USUARIO_ID,
        true,
      );

      const countSql = dataSourceMock.query.mock.calls[0][0] as string;
      expect(countSql).toContain('v.estado');
      expect(dataSourceMock.query.mock.calls[0][1]).toContain(
        EstadoVenta.PAGADA,
      );
    });
  });
});
