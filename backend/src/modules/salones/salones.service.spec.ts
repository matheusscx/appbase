import { Test, type TestingModule } from '@nestjs/testing';
import Decimal from 'decimal.js';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { SalonesService } from './salones.service';
import { CuentaAsignacionesService } from './cuenta-asignaciones.service';
import { Salon } from './entities/salon.entity';
import { Mesa } from './entities/mesa.entity';
import { Cuenta, EstadoCuenta } from './entities/cuenta.entity';
import { CuentaLinea } from './entities/cuenta-linea.entity';
import { VentasService } from '../ventas/ventas.service';
import { GarzonesService } from '../garzones/garzones.service';
import { ItemsService } from '../items/items.service';
import { CatalogService } from '../catalog/catalog.service';
import { SesionesGarzonService } from '../turnos/sesiones-garzon.service';
import { MonedasService } from '../monedas/monedas.service';
import { CalculoPreciosService } from '../calculo-precios/calculo-precios.service';
import { TipoGarzon } from '../garzones/enums/tipo-garzon.enum';

const UNIDADES_CATALOGO = [
  { codigo: 'g', magnitud: 'masa', factorBase: '1' },
  { codigo: 'kg', magnitud: 'masa', factorBase: '1000' },
  { codigo: 'unidad', magnitud: 'conteo', factorBase: '1' },
];

const TENANT = 'tenant-uuid';
const USUARIO = 'usuario-uuid';
const MESA = 'mesa-uuid';
const CUENTA = 'cuenta-uuid';
const ITEM = 'item-uuid';
const ITEM_2 = 'item-2-uuid';
const RECETA = 'receta-uuid';
const COMBO = 'combo-uuid';
const GRUPO = 'grupo-uuid';
const OPCION_ITEM = 'opcion-item-uuid';
const ING = 'ing-uuid';
/** Usuario logueado que ejecuta la acción (JWT). */
const USUARIO_ACTOR = 'usuario-actor';
const GARZON = 'garzon-uuid';
const PIN = '111111';
const SESION_RESPONSABLE = 'sesion-responsable';
const TURNO = 'turno-uuid';
const GARZON_RESPONSABLE = 'garzon-responsable';

const SNAPSHOT = {
  omitidos: [ING],
  extras: [],
  comentario: 'sin cebolla',
};

const SNAPSHOT_COMBO = {
  omitidos: [],
  extras: [],
  grupos: [
    {
      grupoId: GRUPO,
      grupoNombre: 'Bebida',
      opciones: [
        {
          itemId: OPCION_ITEM,
          nombre: 'Coca-Cola',
          cantidad: '1',
          precioExtra: '1500',
          unidades: '1',
        },
      ],
    },
  ],
};

const SNAPSHOT_EXTRA = {
  omitidos: [],
  extras: [
    {
      ingredienteItemId: ING,
      cantidad: '1',
      unidadCodigo: 'unidad',
      precioExtra: '500',
      unidades: '3',
    },
  ],
};

type Repo = {
  find: jest.Mock;
  findOne: jest.Mock;
  findOneOrFail: jest.Mock;
  count: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  softDelete: jest.Mock;
  update: jest.Mock;
  createQueryBuilder: jest.Mock;
};

function makeRepo(): Repo {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    count: jest.fn(),
    create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
    save: jest.fn((row: unknown) => Promise.resolve(row)),
    softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
    update: jest.fn(() => Promise.resolve({ affected: 1 })),
    createQueryBuilder: jest.fn(),
  };
}

describe('SalonesService', () => {
  let service: SalonesService;
  let salonRepo: Repo;
  let mesaRepo: Repo;
  let cuentaRepo: Repo;
  let ventas: { crearEnTransaccion: jest.Mock };
  let garzones: { resolverGarzonActuante: jest.Mock };
  let sesiones: {
    assertSesionAbierta: jest.Mock;
    buscarSesionAbierta: jest.Mock;
  };
  let asignaciones: {
    registrarApertura: jest.Mock;
    cerrarTramoVigente: jest.Mock;
    transferirPorPin: jest.Mock;
    transferirAdmin: jest.Mock;
    listar: jest.Mock;
  };
  let items: {
    resolverPersonalizacionReceta: jest.Mock;
    resolverPersonalizacionCombo: jest.Mock;
    validarStockAlPedir: jest.Mock;
  };
  let catalog: { findAllUnidadesMedida: jest.Mock };
  let monedas: { findMonedas: jest.Mock };
  let calculoPrecios: {
    cargarConfig: jest.Mock;
    convertirAMonedaOficial: jest.Mock;
    congelarReglasDeItem: jest.Mock;
  };
  let manager: {
    query: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    softDelete: jest.Mock;
    update: jest.Mock;
  };
  let dataSource: {
    query: jest.Mock;
    transaction: jest.Mock;
    manager: { query: jest.Mock };
  };
  let db: {
    query: jest.Mock;
    transaccion: jest.Mock;
    sinTransaccion: (fn: () => unknown) => unknown;
  };

  beforeEach(async () => {
    salonRepo = makeRepo();
    mesaRepo = makeRepo();
    cuentaRepo = makeRepo();
    ventas = { crearEnTransaccion: jest.fn() };
    garzones = {
      resolverGarzonActuante: jest.fn().mockResolvedValue({
        id: GARZON,
        nombre: 'Ana Torres',
      }),
    };
    sesiones = {
      assertSesionAbierta: jest.fn().mockResolvedValue(undefined),
      buscarSesionAbierta: jest.fn().mockResolvedValue({
        id: SESION_RESPONSABLE,
        turnoId: TURNO,
        tipoGarzon: TipoGarzon.GARZON,
      }),
    };
    asignaciones = {
      registrarApertura: jest.fn().mockResolvedValue(undefined),
      cerrarTramoVigente: jest.fn().mockResolvedValue(undefined),
      transferirPorPin: jest.fn(),
      transferirAdmin: jest.fn(),
      listar: jest.fn(),
    };
    items = {
      resolverPersonalizacionReceta: jest.fn().mockResolvedValue({
        snapshot: SNAPSHOT,
        precioExtraTotal: '0.0000',
      }),
      resolverPersonalizacionCombo: jest.fn().mockResolvedValue({
        snapshot: SNAPSHOT_COMBO,
        precioExtraTotal: '1500.0000',
      }),
      // El tope de stock al pedir tiene su conducta cubierta por el e2e
      // (`test/reserva-stock-mesa.e2e-spec.ts`), que es donde hay stock de
      // verdad. Acá solo deja pasar, para que estos specs sigan hablando del
      // merge y de la presentación.
      validarStockAlPedir: jest.fn().mockResolvedValue(undefined),
    };

    catalog = {
      findAllUnidadesMedida: jest.fn().mockResolvedValue(UNIDADES_CATALOGO),
    };

    // El detalle priceado de la personalización se devuelve convertido a moneda
    // oficial. El mock CONVIERTE de verdad (no devuelve la entrada tal cual):
    // un mock identidad dejaría pasar el bug que la conversión arregla, y estos
    // specs afirman sobre el detalle de la cuenta.
    monedas = {
      findMonedas: jest.fn().mockResolvedValue([
        {
          monedaId: 'moneda-1',
          decimales: 0,
          esOficial: true,
          valorDelDia: '1',
        },
        { monedaId: 'clp', decimales: 0, esOficial: false, valorDelDia: '1' },
        { monedaId: 'usd', decimales: 2, esOficial: false, valorDelDia: '950' },
      ]),
    };
    calculoPrecios = {
      cargarConfig: jest.fn().mockResolvedValue({ modoRedondeo: 'HALF_UP' }),
      convertirAMonedaOficial: jest.fn(
        (precio: string, monedaId: string, tasaMap: Map<string, string>) =>
          new Decimal(precio).times(tasaMap.get(monedaId) ?? '1').toFixed(4),
      ),
      // Lista vacía, no `undefined`: el merge hashea lo que venga y un
      // `undefined` haría pasar tests que con reglas reales fallarían.
      congelarReglasDeItem: jest
        .fn()
        .mockResolvedValue({ descuentos: [], recargos: [] }),
    };

    manager = {
      query: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn((_e: unknown, row: unknown) => Promise.resolve(row)),
      create: jest.fn((_e: unknown, data: Record<string, unknown>) => ({
        ...data,
      })),
      softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
    };
    dataSource = {
      query: jest.fn().mockResolvedValue([]),
      transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
      manager: { query: jest.fn().mockResolvedValue([]) },
    };
    db = {
      transaccion: dataSource.transaction,
      query: dataSource.query,
      sinTransaccion: (fn: () => unknown) => fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalonesService,
        { provide: getRepositoryToken(Salon), useValue: salonRepo },
        { provide: getRepositoryToken(Mesa), useValue: mesaRepo },
        { provide: getRepositoryToken(Cuenta), useValue: cuentaRepo },
        { provide: Db, useValue: db },
        { provide: VentasService, useValue: ventas },
        { provide: GarzonesService, useValue: garzones },
        { provide: SesionesGarzonService, useValue: sesiones },
        { provide: CuentaAsignacionesService, useValue: asignaciones },
        { provide: ItemsService, useValue: items },
        { provide: CatalogService, useValue: catalog },
        { provide: MonedasService, useValue: monedas },
        { provide: CalculoPreciosService, useValue: calculoPrecios },
      ],
    }).compile();

    service = module.get<SalonesService>(SalonesService);
  });

  describe('abrirCuenta', () => {
    it('asigna el número correlativo entre las cuentas abiertas de la mesa', async () => {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      manager.query
        .mockResolvedValueOnce([{ mesa_id: MESA }]) // FOR UPDATE mesa
        .mockResolvedValueOnce([{ next: '3' }]);

      const result = await service.abrirCuenta(TENANT, USUARIO_ACTOR, MESA, {
        garzonId: GARZON,
        pin: PIN,
      });

      expect(manager.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('FOR UPDATE'),
        [MESA, TENANT],
      );
      expect(manager.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('mesa_id = $2 AND estado = $3'),
        [TENANT, MESA, EstadoCuenta.ABIERTA],
      );
      expect(result.numero).toBe(3);
      expect(manager.create).toHaveBeenCalledWith(
        Cuenta,
        expect.objectContaining({
          numero: 3,
          mesaId: MESA,
          tenantId: TENANT,
          garzonAperturaId: GARZON,
        }),
      );
      expect(sesiones.assertSesionAbierta).toHaveBeenCalledWith(TENANT, GARZON);
    });

    it('abrirCuenta rechaza si el garzón no tiene sesión abierta', async () => {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      sesiones.assertSesionAbierta.mockRejectedValue(
        new BadRequestException(
          'El garzón no tiene una sesión de trabajo abierta',
        ),
      );
      await expect(
        service.abrirCuenta(TENANT, USUARIO_ACTOR, MESA, {
          garzonId: GARZON,
          pin: PIN,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(manager.create).not.toHaveBeenCalled();
    });

    it('rechaza abrir la cuenta si el PIN del garzón es inválido', async () => {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      garzones.resolverGarzonActuante.mockRejectedValue(
        new BadRequestException('PIN inválido'),
      );

      await expect(
        service.abrirCuenta(TENANT, USUARIO_ACTOR, MESA, {
          garzonId: GARZON,
          pin: '000000',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(manager.create).not.toHaveBeenCalled();
    });

    it('reinicia en 1 cuando la mesa no tiene cuentas abiertas (quedó libre)', async () => {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      manager.query
        .mockResolvedValueOnce([{ mesa_id: MESA }])
        .mockResolvedValueOnce([{ next: '1' }]);

      const result = await service.abrirCuenta(TENANT, USUARIO_ACTOR, MESA, {
        garzonId: GARZON,
        pin: PIN,
      });

      expect(result.numero).toBe(1);
    });

    it('lanza NotFound si la mesa no pertenece al tenant', async () => {
      mesaRepo.findOne.mockResolvedValue(null);
      await expect(
        service.abrirCuenta(TENANT, USUARIO_ACTOR, MESA, {
          garzonId: GARZON,
          pin: PIN,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('asigna responsable = apertura y registra tramo APERTURA', async () => {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      manager.query
        .mockResolvedValueOnce([{ mesa_id: MESA }])
        .mockResolvedValueOnce([{ next: '1' }]);
      manager.save.mockImplementation(
        (_e: unknown, row: Record<string, unknown>) =>
          Promise.resolve({ ...row, id: CUENTA }),
      );

      await service.abrirCuenta(TENANT, USUARIO_ACTOR, MESA, {
        garzonId: GARZON,
        pin: PIN,
      });

      expect(manager.create).toHaveBeenCalledWith(
        Cuenta,
        expect.objectContaining({
          garzonAperturaId: GARZON,
          garzonResponsableId: GARZON,
        }),
      );
      expect(asignaciones.registrarApertura).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({ id: CUENTA }),
        GARZON,
      );
    });
  });

  describe('fusionarCuentas', () => {
    const CUENTA_A = 'cuenta-a';
    const CUENTA_B = 'cuenta-b';

    /**
     * El servicio lee las líneas de los orígenes con `In([...])` y las del
     * destino con el id pelado. El stub entiende las dos formas para no atarse
     * a cuál usa cada consulta.
     */
    function idsDe(filtro: unknown): string[] {
      if (filtro && typeof filtro === 'object' && '_value' in filtro) {
        const v = filtro._value;
        return Array.isArray(v) ? (v as string[]) : [v as string];
      }
      return filtro === undefined ? [] : [filtro as string];
    }

    it('mueve las líneas de las cuentas de origen a la de menor número y las cancela', async () => {
      const cuentaA = {
        id: CUENTA_A,
        tenantId: TENANT,
        mesaId: MESA,
        numero: 1,
        estado: EstadoCuenta.ABIERTA,
        garzonResponsableId: 'garzon-destino',
      };
      const cuentaB = {
        id: CUENTA_B,
        tenantId: TENANT,
        mesaId: MESA,
        numero: 3,
        estado: EstadoCuenta.ABIERTA,
        garzonResponsableId: 'garzon-origen',
        cerradaEl: null as Date | null,
      };
      const lineaExistenteDestino = {
        id: 'linea-a1',
        tenantId: TENANT,
        cuentaId: CUENTA_A,
        itemId: 'item-1',
        cantidad: '1',
        precioUnitario: '1000.0000',
        cantidadEnviada: '1',
      };
      const lineaOrigenMismoItem = {
        id: 'linea-b1',
        tenantId: TENANT,
        cuentaId: CUENTA_B,
        itemId: 'item-1',
        cantidad: '2',
        precioUnitario: '1000.0000',
        cantidadEnviada: '2',
      };
      const lineaOrigenOtroItem = {
        id: 'linea-b2',
        tenantId: TENANT,
        cuentaId: CUENTA_B,
        itemId: 'item-2',
        cantidad: '1',
        precioUnitario: '1000.0000',
        cantidadEnviada: '0',
      };

      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      manager.findOne.mockImplementation(
        (
          _entity: unknown,
          opts: { where: { itemId?: string; cuentaId?: string } },
        ) => {
          if (
            opts.where.itemId === 'item-1' &&
            opts.where.cuentaId === CUENTA_A
          )
            return Promise.resolve(lineaExistenteDestino);
          return Promise.resolve(null);
        },
      );
      manager.find.mockImplementation(
        (entity: unknown, opts?: { where?: { cuentaId?: unknown } }) => {
          if (entity === Cuenta) return Promise.resolve([cuentaB, cuentaA]);
          if (entity === CuentaLinea) {
            const ids = idsDe(opts?.where?.cuentaId);
            return Promise.resolve(
              [
                lineaExistenteDestino,
                lineaOrigenMismoItem,
                lineaOrigenOtroItem,
              ].filter((l) => ids.includes(l.cuentaId)),
            );
          }
          return Promise.resolve([]);
        },
      );
      manager.query.mockResolvedValue([]);

      const result = await service.fusionarCuentas(TENANT, MESA, {
        cuentaIds: [CUENTA_A, CUENTA_B],
      });

      expect(lineaExistenteDestino.cantidad).toBe('3');
      // cantidadEnviada también se suma para no reenviar lo ya impreso
      expect(lineaExistenteDestino.cantidadEnviada).toBe('3');
      expect(manager.save).toHaveBeenCalledWith(
        CuentaLinea,
        lineaExistenteDestino,
      );
      expect(manager.softDelete).toHaveBeenCalledWith(CuentaLinea, {
        id: 'linea-b1',
        tenantId: TENANT,
      });
      expect(lineaOrigenOtroItem.cuentaId).toBe(CUENTA_A);
      expect(manager.save).toHaveBeenCalledWith(
        CuentaLinea,
        lineaOrigenOtroItem,
      );
      expect(cuentaB.estado).toBe(EstadoCuenta.CANCELADA);
      expect(cuentaB.cerradaEl).toBeInstanceOf(Date);
      expect(manager.save).toHaveBeenCalledWith(Cuenta, cuentaB);
      expect(asignaciones.cerrarTramoVigente).toHaveBeenCalledWith(
        manager,
        TENANT,
        CUENTA_B,
        cuentaB.cerradaEl,
      );
      expect(cuentaA.garzonResponsableId).toBe('garzon-destino');
      expect(result.id).toBe(CUENTA_A);
      expect(manager.find).toHaveBeenCalledWith(
        Cuenta,
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT,
            mesaId: MESA,
            estado: EstadoCuenta.ABIERTA,
          }),
          lock: { mode: 'pessimistic_write' },
        }),
      );
    });

    it('mantiene dos líneas si mismo itemId pero distinta personalización', async () => {
      const cuentaA = {
        id: CUENTA_A,
        tenantId: TENANT,
        mesaId: MESA,
        numero: 1,
        estado: EstadoCuenta.ABIERTA,
      };
      const cuentaB = {
        id: CUENTA_B,
        tenantId: TENANT,
        mesaId: MESA,
        numero: 2,
        estado: EstadoCuenta.ABIERTA,
      };
      const lineaDestinoSinPerso = {
        id: 'linea-a1',
        tenantId: TENANT,
        cuentaId: CUENTA_A,
        itemId: 'item-1',
        cantidad: '1',
        precioUnitario: '1000.0000',
        cantidadEnviada: '0',
        personalizacion: null,
      };
      const lineaOrigenConPerso = {
        id: 'linea-b1',
        tenantId: TENANT,
        cuentaId: CUENTA_B,
        itemId: 'item-1',
        cantidad: '2',
        precioUnitario: '1000.0000',
        cantidadEnviada: '0',
        personalizacion: SNAPSHOT,
      };

      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      manager.find.mockImplementation(
        (entity: unknown, opts?: { where?: { cuentaId?: unknown } }) => {
          if (entity === Cuenta) return Promise.resolve([cuentaA, cuentaB]);
          if (entity === CuentaLinea) {
            const ids = idsDe(opts?.where?.cuentaId);
            return Promise.resolve(
              [lineaDestinoSinPerso, lineaOrigenConPerso].filter((l) =>
                ids.includes(l.cuentaId),
              ),
            );
          }
          return Promise.resolve([]);
        },
      );
      manager.query.mockResolvedValue([]);

      await service.fusionarCuentas(TENANT, MESA, {
        cuentaIds: [CUENTA_A, CUENTA_B],
      });

      expect(lineaDestinoSinPerso.cantidad).toBe('1');
      expect(lineaOrigenConPerso.cuentaId).toBe(CUENTA_A);
      expect(manager.softDelete).not.toHaveBeenCalledWith(
        CuentaLinea,
        expect.objectContaining({ id: 'linea-b1' }),
      );
    });

    // Mismo bug que el merge de `agregarLinea`, por la otra puerta: fusionar
    // dos cuentas sumaba la canónica y dejaba la presentación de la línea de
    // destino como estaba.
    it('al fusionar, la presentación de la línea de destino se reescribe', async () => {
      const cuentaA = {
        id: CUENTA_A,
        numero: 1,
        tenantId: TENANT,
        mesaId: MESA,
        estado: EstadoCuenta.ABIERTA,
      };
      const cuentaB = {
        id: CUENTA_B,
        numero: 2,
        tenantId: TENANT,
        mesaId: MESA,
        estado: EstadoCuenta.ABIERTA,
      };
      // DOS ítems distintos mergeando, y no uno: con uno solo, una query por
      // línea también daría 1 y la aserción anti-N+1 no distinguiría nada.
      const lineaDestino = {
        id: 'linea-a1',
        tenantId: TENANT,
        cuentaId: CUENTA_A,
        itemId: ITEM,
        cantidad: '200',
        precioUnitario: '1000.0000',
        cantidadEnviada: '0',
        cantidadPresentacion: '200',
        unidadCodigoPresentacion: 'g',
        personalizacion: null,
      };
      const lineaDestino2 = {
        id: 'linea-a2',
        tenantId: TENANT,
        cuentaId: CUENTA_A,
        itemId: ITEM_2,
        cantidad: '100',
        precioUnitario: '1000.0000',
        cantidadEnviada: '0',
        cantidadPresentacion: '100',
        unidadCodigoPresentacion: 'g',
        personalizacion: null,
      };
      const lineaOrigen = {
        id: 'linea-b1',
        tenantId: TENANT,
        cuentaId: CUENTA_B,
        itemId: ITEM,
        cantidad: '300',
        precioUnitario: '1000.0000',
        cantidadEnviada: '0',
        cantidadPresentacion: '0.3',
        unidadCodigoPresentacion: 'kg',
        personalizacion: null,
      };
      const lineaOrigen2 = {
        id: 'linea-b2',
        tenantId: TENANT,
        cuentaId: CUENTA_B,
        itemId: ITEM_2,
        cantidad: '400',
        precioUnitario: '1000.0000',
        cantidadEnviada: '0',
        cantidadPresentacion: '0.4',
        unidadCodigoPresentacion: 'kg',
        personalizacion: null,
      };

      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      manager.find.mockImplementation(
        (entity: unknown, opts?: { where?: { cuentaId?: unknown } }) => {
          if (entity === Cuenta) return Promise.resolve([cuentaA, cuentaB]);
          if (entity === CuentaLinea) {
            const ids = idsDe(opts?.where?.cuentaId);
            return Promise.resolve(
              [lineaDestino, lineaDestino2, lineaOrigen, lineaOrigen2].filter(
                (l) => ids.includes(l.cuentaId),
              ),
            );
          }
          return Promise.resolve([]);
        },
      );
      // La resolución de ítems va por `manager.query` DENTRO del lock: UNA
      // query que trae los dos item_id distintos, no una por línea.
      manager.query.mockImplementation((sql: string) =>
        typeof sql === 'string' && sql.includes('FROM items i')
          ? Promise.resolve([
              {
                item_id: ITEM,
                tipo: 'producto',
                unidad_medida: 'g',
                precio_base: '1000',
                moneda_id: 'clp',
              },
              {
                item_id: ITEM_2,
                tipo: 'producto',
                unidad_medida: 'g',
                precio_base: '1000',
                moneda_id: 'clp',
              },
            ])
          : Promise.resolve([]),
      );

      await service.fusionarCuentas(TENANT, MESA, {
        cuentaIds: [CUENTA_A, CUENTA_B],
      });

      expect(lineaDestino.cantidad).toBe('500');
      expect(lineaDestino.cantidadPresentacion).toBe('500');
      expect(lineaDestino.unidadCodigoPresentacion).toBe('g');
      expect(lineaDestino2.cantidadPresentacion).toBe('500');
      // UNA sola query de items para los DOS ítems: el N+1 no vuelve por la
      // puerta de atrás, y encima adentro del lock pesimista. Con dos ítems
      // distintos, resolver por línea daría 2 y esto falla.
      const queriesDeItems = manager.query.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].includes('FROM items i'),
      );
      expect(queriesDeItems).toHaveLength(1);
    });

    it('lanza BadRequest si alguna cuenta no está abierta o no pertenece a la mesa', async () => {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      manager.find.mockResolvedValue([{ id: CUENTA_A, numero: 1 }]);

      await expect(
        service.fusionarCuentas(TENANT, MESA, {
          cuentaIds: [CUENTA_A, CUENTA_B],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequest si no hay al menos dos cuentas distintas', async () => {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });

      await expect(
        service.fusionarCuentas(TENANT, MESA, {
          cuentaIds: [CUENTA_A, CUENTA_A],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * Monta N cuentas de origen con L líneas cada una, todas de ítems distintos,
     * y devuelve el contador de lecturas de `CuentaLinea`. La fusión corre
     * DENTRO del lock pesimista: cada lectura de más alarga el tiempo que nadie
     * puede agregar líneas ni cerrar en esa mesa.
     */
    function montarFusion(origenes: number, lineasPorOrigen: number) {
      const cuentas = [
        {
          id: 'destino',
          tenantId: TENANT,
          mesaId: MESA,
          numero: 1,
          estado: EstadoCuenta.ABIERTA,
        },
        ...Array.from({ length: origenes }, (_, i) => ({
          id: `origen-${i}`,
          tenantId: TENANT,
          mesaId: MESA,
          numero: i + 2,
          estado: EstadoCuenta.ABIERTA,
          cerradaEl: null as Date | null,
        })),
      ];
      const lineas = cuentas.slice(1).flatMap((c, i) =>
        Array.from({ length: lineasPorOrigen }, (_, j) => ({
          id: `l-${i}-${j}`,
          tenantId: TENANT,
          cuentaId: c.id,
          itemId: `item-${i}-${j}`,
          cantidad: '1',
          precioUnitario: '1000.0000',
          cantidadEnviada: '0',
          personalizacion: null,
        })),
      );
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      manager.find.mockImplementation(
        (entity: unknown, opts?: { where?: { cuentaId?: unknown } }) => {
          if (entity === Cuenta) return Promise.resolve(cuentas);
          const ids = idsDe(opts?.where?.cuentaId);
          return Promise.resolve(
            lineas.filter((l) => ids.includes(l.cuentaId)),
          );
        },
      );
      manager.query.mockResolvedValue([]);
      return () =>
        manager.find.mock.calls.filter(([e]) => e === CuentaLinea).length;
    }

    /** Corre una fusión de N orígenes × L líneas y devuelve cuántas veces se
     *  leyó `CuentaLinea`. */
    async function lecturasDe(origenes: number, lineasPorOrigen: number) {
      jest.clearAllMocks();
      const contar = montarFusion(origenes, lineasPorOrigen);
      await service.fusionarCuentas(TENANT, MESA, {
        cuentaIds: [
          'destino',
          ...Array.from({ length: origenes }, (_, i) => `origen-${i}`),
        ],
      });
      return contar();
    }

    it('el costo en lecturas no crece ni con las líneas ni con los orígenes', async () => {
      // Las dos dimensiones del N+1: era una lectura por línea DENTRO de una
      // lectura por origen. Medir una sola deja viva a la otra.
      const base = await lecturasDe(2, 1);

      expect(await lecturasDe(2, 10)).toBe(base);
      expect(await lecturasDe(5, 1)).toBe(base);
      expect(await lecturasDe(5, 10)).toBe(base);
    });

    it('el mismo ítem en DOS orígenes se acumula en una sola línea del destino', async () => {
      // La línea del primer origen se mueve al destino; la del segundo tiene que
      // encontrarla YA movida y sumarse. Es lo que se pierde si el índice de
      // líneas del destino se arma una vez y no se mantiene al día.
      const destino = {
        id: 'destino',
        tenantId: TENANT,
        mesaId: MESA,
        numero: 1,
        estado: EstadoCuenta.ABIERTA,
      };
      const origenes = [1, 2].map((n) => ({
        id: `origen-${n}`,
        tenantId: TENANT,
        mesaId: MESA,
        numero: n + 1,
        estado: EstadoCuenta.ABIERTA,
        cerradaEl: null as Date | null,
      }));
      const lineas = [
        {
          id: 'l-1',
          tenantId: TENANT,
          cuentaId: 'origen-1',
          itemId: ITEM,
          cantidad: '2',
          precioUnitario: '1000.0000',
          cantidadEnviada: '0',
          personalizacion: null,
        },
        {
          id: 'l-2',
          tenantId: TENANT,
          cuentaId: 'origen-2',
          itemId: ITEM,
          cantidad: '3',
          precioUnitario: '1000.0000',
          cantidadEnviada: '1',
          personalizacion: null,
        },
      ];
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      manager.find.mockImplementation(
        (entity: unknown, opts?: { where?: { cuentaId?: unknown } }) => {
          if (entity === Cuenta) return Promise.resolve([destino, ...origenes]);
          const ids = idsDe(opts?.where?.cuentaId);
          return Promise.resolve(
            lineas.filter((l) => ids.includes(l.cuentaId)),
          );
        },
      );
      manager.query.mockResolvedValue([]);

      await service.fusionarCuentas(TENANT, MESA, {
        cuentaIds: ['destino', 'origen-1', 'origen-2'],
      });

      // La primera se mudó al destino, la segunda se sumó y se borró.
      expect(lineas[0].cuentaId).toBe('destino');
      expect(lineas[0].cantidad).toBe('5');
      expect(lineas[0].cantidadEnviada).toBe('1');
      expect(manager.softDelete).toHaveBeenCalledWith(CuentaLinea, {
        id: 'l-2',
        tenantId: TENANT,
      });
    });

    it('el mismo ítem con precios congelados distintos NO se acumula', async () => {
      // El control del test de arriba, y la mitad que el e2e no puede fijar
      // barato: la clave de fusión lleva el precio congelado desde el
      // 2026-08-31. Sin él, dos pedidos del mismo plato a precios distintos
      // colapsan sobre el precio de la línea de destino y la plata de la otra
      // desaparece — medido por API antes del arreglo: 3000 + 4000 quedaban
      // como 2 × 3000.
      const destino = {
        id: 'destino',
        tenantId: TENANT,
        mesaId: MESA,
        numero: 1,
        estado: EstadoCuenta.ABIERTA,
      };
      const origen = {
        id: 'origen-1',
        tenantId: TENANT,
        mesaId: MESA,
        numero: 2,
        estado: EstadoCuenta.ABIERTA,
        cerradaEl: null as Date | null,
      };
      const lineas = [
        {
          id: 'l-destino',
          tenantId: TENANT,
          cuentaId: 'destino',
          itemId: ITEM,
          cantidad: '1',
          precioUnitario: '3000.0000',
          cantidadEnviada: '0',
          personalizacion: null,
        },
        {
          id: 'l-origen',
          tenantId: TENANT,
          cuentaId: 'origen-1',
          itemId: ITEM,
          cantidad: '1',
          precioUnitario: '4000.0000',
          cantidadEnviada: '0',
          personalizacion: null,
        },
      ];
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      manager.find.mockImplementation(
        (entity: unknown, opts?: { where?: { cuentaId?: unknown } }) => {
          if (entity === Cuenta) return Promise.resolve([destino, origen]);
          const ids = idsDe(opts?.where?.cuentaId);
          return Promise.resolve(
            lineas.filter((l) => ids.includes(l.cuentaId)),
          );
        },
      );
      manager.query.mockResolvedValue([]);

      await service.fusionarCuentas(TENANT, MESA, {
        cuentaIds: ['destino', 'origen-1'],
      });

      // La de origen se MUDA con su precio intacto; no se suma ni se borra.
      expect(lineas[1].cuentaId).toBe('destino');
      expect(lineas[1].precioUnitario).toBe('4000.0000');
      expect(lineas[0].cantidad).toBe('1');
      expect(manager.softDelete).not.toHaveBeenCalled();
    });

    it('el mismo ítem al mismo precio pero con REGLAS distintas tampoco se acumula', async () => {
      // El tercer término, por la puerta de la fusión: el precio de lista no se
      // movió —las dos líneas valen 5000— y lo único que las separa es que una
      // se pidió antes del descuento y la otra después.
      const destino = {
        id: 'destino',
        tenantId: TENANT,
        mesaId: MESA,
        numero: 1,
        estado: EstadoCuenta.ABIERTA,
      };
      const origen = {
        id: 'origen-1',
        tenantId: TENANT,
        mesaId: MESA,
        numero: 2,
        estado: EstadoCuenta.ABIERTA,
        cerradaEl: null as Date | null,
      };
      const conDescuento = {
        descuentos: [
          {
            id: 'desc-1',
            modo: 'porcentaje',
            valorMonto: null,
            valorPorcentaje: '0.20',
            activo: true,
            vigente: true,
            tramos: [],
            metodoPagoIds: [],
          },
        ],
        recargos: [],
      };
      const lineas = [
        {
          id: 'l-destino',
          tenantId: TENANT,
          cuentaId: 'destino',
          itemId: ITEM,
          cantidad: '1',
          precioUnitario: '5000.0000',
          reglasCongeladas: { descuentos: [], recargos: [] },
          cantidadEnviada: '0',
          personalizacion: null,
        },
        {
          id: 'l-origen',
          tenantId: TENANT,
          cuentaId: 'origen-1',
          itemId: ITEM,
          cantidad: '1',
          precioUnitario: '5000.0000',
          reglasCongeladas: conDescuento,
          cantidadEnviada: '0',
          personalizacion: null,
        },
      ];
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      manager.find.mockImplementation(
        (entity: unknown, opts?: { where?: { cuentaId?: unknown } }) => {
          if (entity === Cuenta) return Promise.resolve([destino, origen]);
          const ids = idsDe(opts?.where?.cuentaId);
          return Promise.resolve(
            lineas.filter((l) => ids.includes(l.cuentaId)),
          );
        },
      );
      manager.query.mockResolvedValue([]);

      await service.fusionarCuentas(TENANT, MESA, {
        cuentaIds: ['destino', 'origen-1'],
      });

      expect(lineas[1].cuentaId).toBe('destino');
      expect(lineas[0].cantidad).toBe('1');
      expect(manager.softDelete).not.toHaveBeenCalled();
    });
  });

  describe('crear/actualizar de salón y mesa — no devuelven el interno', () => {
    // Los cuatro devolvían `repo.save(...)` crudo. No es fuga cross-tenant —el
    // usuario ya pertenece a ese tenant— pero era el único lugar del módulo que
    // exponía `tenantId`, timestamps y `eliminadoPor`.
    const CRUDO = {
      id: 'x-1',
      tenantId: TENANT,
      nombre: 'Terraza',
      posX: '0.5',
      posY: '0.5',
      forma: 'cuadrada',
      tamano: 'mediano',
      salonId: 'salon-1',
      creadoEl: new Date(),
      actualizadoEl: new Date(),
      eliminadoEl: null,
      eliminadoPor: 'alguien',
    };

    it('crearSalon devuelve solo id y nombre', async () => {
      salonRepo.save.mockResolvedValue(CRUDO);

      const salon = await service.crearSalon(TENANT, { nombre: 'Terraza' });

      expect(salon).toEqual({ id: 'x-1', nombre: 'Terraza' });
    });

    it('actualizarSalon tampoco', async () => {
      salonRepo.findOne.mockResolvedValue({ ...CRUDO });
      salonRepo.save.mockResolvedValue(CRUDO);

      const salon = await service.actualizarSalon(TENANT, 'x-1', {
        nombre: 'Terraza',
      });

      expect(salon).toEqual({ id: 'x-1', nombre: 'Terraza' });
    });

    it('crearMesa devuelve la forma que el frontend lee, sin el interno', async () => {
      salonRepo.findOne.mockResolvedValue({ id: 'salon-1', tenantId: TENANT });
      mesaRepo.save.mockResolvedValue(CRUDO);

      const mesa = await service.crearMesa(TENANT, 'salon-1', {
        nombre: 'Mesa 1',
      });

      expect(mesa).toEqual({
        id: 'x-1',
        nombre: 'Terraza',
        posX: '0.5',
        posY: '0.5',
        forma: 'cuadrada',
        tamano: 'mediano',
      });
    });

    it('actualizarMesa tampoco', async () => {
      mesaRepo.findOne.mockResolvedValue({ ...CRUDO });
      mesaRepo.save.mockResolvedValue(CRUDO);

      const mesa = await service.actualizarMesa(TENANT, 'x-1', {
        nombre: 'Mesa 1',
      });

      expect(mesa).not.toHaveProperty('tenantId');
      expect(mesa).not.toHaveProperty('eliminadoPor');
      expect(mesa).not.toHaveProperty('salonId');
    });
  });

  describe('guardarLayout', () => {
    it('mover una mesa que no es del salón corta con 404, no en silencio', async () => {
      // Sin el chequeo de `affected`, el drag&drop de una mesa ajena actualiza
      // CERO filas y la pantalla responde OK: la mesa vuelve sola a su lugar y
      // nadie se entera de por qué.
      salonRepo.findOne.mockResolvedValue({ id: 'salon-1', tenantId: TENANT });
      manager.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.guardarLayout(TENANT, 'salon-1', {
          mesas: [{ mesaId: 'mesa-ajena', posX: 10, posY: 20 }],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('acota el UPDATE por tenant y salón, no solo por el id de la mesa', async () => {
      salonRepo.findOne.mockResolvedValue({ id: 'salon-1', tenantId: TENANT });
      manager.update.mockResolvedValue({ affected: 1 });

      await service.guardarLayout(TENANT, 'salon-1', {
        mesas: [{ mesaId: MESA, posX: 10, posY: 20 }],
      });

      expect(manager.update).toHaveBeenCalledWith(
        Mesa,
        { id: MESA, tenantId: TENANT, salonId: 'salon-1' },
        { posX: '10', posY: '20' },
      );
    });
  });

  describe('agregarLinea', () => {
    beforeEach(() => {
      // La cuenta se lee por el manager de la transacción, no por el repo:
      // las tres mutadoras de línea la lockean para no colarse en una cuenta
      // que `cerrarCuenta` está cerrando.
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
      });
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT i.item_id'))
          return Promise.resolve([
            {
              item_id: ITEM,
              tipo: 'producto',
              unidad_medida: 'kg',
              precio_base: '1000',
              moneda_id: 'clp',
            },
          ]);
        return Promise.resolve([]);
      });
      manager.query.mockResolvedValue([]);
    });

    /**
     * El bucle de reintento que `agregarLinea` ganó el 2026-09-01, cuando pasó
     * a tomar `FOR UPDATE` sobre `item_producto` (`validarStockAlPedir`) y
     * entró a competir por el mismo lock que la venta. Ordenar por `item_id`
     * baja la frecuencia del ciclo pero no lo cierra —el orden global de la
     * venta no es ascendente—, así que el cierre real es reintentar, igual que
     * en `ventas.crear()`.
     */
    it('reintenta la transacción ante un deadlock 40P01 y devuelve el resultado del segundo intento', async () => {
      manager.find.mockResolvedValue([]);
      const real = dataSource.transaction.getMockImplementation()!;
      dataSource.transaction
        .mockRejectedValueOnce(
          Object.assign(new Error('deadlock detected'), { code: '40P01' }),
        )
        .mockImplementationOnce(real);

      await service.agregarLinea(TENANT, CUENTA, {
        itemId: ITEM,
        cantidad: '2',
      });

      // Dos intentos: el que murió y el que escribió.
      expect(dataSource.transaction).toHaveBeenCalledTimes(2);
      expect(manager.save).toHaveBeenCalled();
    });

    it('reconoce el 40P01 que llega envuelto en driverError, no solo el pelado', async () => {
      // TypeORM envuelve el error del driver en `QueryFailedError`: según dónde
      // se lance, el código llega en `code` o solo en `driverError.code`.
      // Mirar uno solo significa no reintentar nunca en la mitad de los casos.
      manager.find.mockResolvedValue([]);
      const real = dataSource.transaction.getMockImplementation()!;
      dataSource.transaction
        .mockRejectedValueOnce(
          Object.assign(new Error('QueryFailedError'), {
            driverError: { code: '40P01' },
          }),
        )
        .mockImplementationOnce(real);

      await service.agregarLinea(TENANT, CUENTA, {
        itemId: ITEM,
        cantidad: '2',
      });

      expect(dataSource.transaction).toHaveBeenCalledTimes(2);
    });

    it('NO reintenta un error de negocio: se propaga en el primer intento', async () => {
      // El control del test de arriba. Reintentar un 400 lo convertiría en tres
      // intentos silenciosos, que es justo lo que el `esDeadlock` evita.
      manager.find.mockResolvedValue([]);
      dataSource.transaction.mockRejectedValueOnce(
        new BadRequestException('Stock insuficiente de "Papas"'),
      );

      await expect(
        service.agregarLinea(TENANT, CUENTA, { itemId: ITEM, cantidad: '2' }),
      ).rejects.toThrow('Stock insuficiente de "Papas"');
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('deja de reintentar el deadlock y lo propaga: no reintenta para siempre', async () => {
      manager.find.mockResolvedValue([]);
      const deadlock = () =>
        Object.assign(new Error('deadlock detected'), { code: '40P01' });
      dataSource.transaction
        .mockRejectedValueOnce(deadlock())
        .mockRejectedValueOnce(deadlock())
        .mockRejectedValueOnce(deadlock());

      await expect(
        service.agregarLinea(TENANT, CUENTA, { itemId: ITEM, cantidad: '2' }),
      ).rejects.toThrow('deadlock detected');
      // Intento original + 2 reintentos (`MAX_REINTENTOS_DEADLOCK`), y para.
      expect(dataSource.transaction).toHaveBeenCalledTimes(3);
    });

    it('el tope de stock corre DENTRO de la transacción y después del lock de la cuenta', async () => {
      // Correrlo afuera —o antes del `findOne` con `pessimistic_write`— deja la
      // ventana que el frente vino a cerrar: entre verificar y escribir, otra
      // mesa mete su línea.
      manager.find.mockResolvedValue([]);
      const orden: string[] = [];
      manager.findOne.mockImplementation(() => {
        orden.push('lock-cuenta');
        return Promise.resolve({
          id: CUENTA,
          tenantId: TENANT,
          estado: EstadoCuenta.ABIERTA,
        });
      });
      items.validarStockAlPedir.mockImplementation(() => {
        orden.push('tope-stock');
        return Promise.resolve(undefined);
      });
      manager.save.mockImplementation(() => {
        orden.push('save');
        return Promise.resolve({});
      });

      await service.agregarLinea(TENANT, CUENTA, {
        itemId: ITEM,
        cantidad: '2',
      });

      expect(orden).toEqual(['lock-cuenta', 'tope-stock', 'save']);
      // Y con lo que la línea REALMENTE va a escribir: la cantidad canónica,
      // no la de presentación.
      expect(items.validarStockAlPedir).toHaveBeenCalledWith(TENANT, [
        { itemId: ITEM, cantidad: '2', personalizacion: null },
      ]);
    });

    it('lee la cuenta con FOR UPDATE dentro de la transacción', async () => {
      manager.find.mockResolvedValue([]);

      await service.agregarLinea(TENANT, CUENTA, {
        itemId: ITEM,
        cantidad: '2',
      });

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(manager.findOne).toHaveBeenCalledWith(
        Cuenta,
        expect.objectContaining({
          where: { id: CUENTA, tenantId: TENANT },
          lock: { mode: 'pessimistic_write' },
        }),
      );
    });

    // El caso de la entrada de backlog: agregar 200 g y después 0,3 kg dejaba
    // `cantidad` en 0.5 (correcto, y el motor cobraba sobre eso) pero
    // `cantidadPresentacion` congelada en "200 g". El ticket y la pantalla
    // mostraban 200 g de algo que se cobraba como 500 g: el monto estaba bien,
    // lo que mentía era lo que ve el cliente.
    it('al mergear, la presentación se reescribe en la unidad que la línea ya mostraba', async () => {
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT i.item_id'))
          return Promise.resolve([
            {
              item_id: ITEM,
              tipo: 'producto',
              unidad_medida: 'g',
              precio_base: '1000',
              moneda_id: 'clp',
            },
          ]);
        return Promise.resolve([]);
      });
      const existente = {
        id: 'linea-1',
        // Congelado al pedir: precio_base '1000' × tasa 1. Sin esto el merge
        // ni siquiera compara: `new Decimal(undefined)` tira `DecimalError`.
        precioUnitario: '1000.0000',
        cantidad: '200',
        cantidadPresentacion: '200',
        unidadCodigoPresentacion: 'g',
        personalizacion: null,
      };
      manager.find.mockResolvedValue([existente]);

      await service.agregarLinea(TENANT, CUENTA, {
        itemId: ITEM,
        cantidad: '0.3',
        cantidadPresentacion: '0.3',
        unidadCodigoPresentacion: 'kg',
      });

      // Canónica: 200 g + 0,3 kg = 500 g.
      expect(existente.cantidad).toBe('500');
      // Y la presentación acompaña, EN GRAMOS: la unidad de la línea manda
      // sobre la de lo que entra, así que no queda "0.5" ni "200".
      expect(existente.cantidadPresentacion).toBe('500');
      expect(existente.unidadCodigoPresentacion).toBe('g');
    });

    // La otra mitad: una línea sin presentación no la gana por mergear. Sin
    // esto, `sincronizarPresentacion` podría inventar una unidad para filas
    // que nunca la tuvieron.
    it('una línea sin presentación sigue sin presentación después del merge', async () => {
      const existente = {
        id: 'linea-1',
        // Congelado al pedir: precio_base '1000' × tasa 1. Sin esto el merge
        // ni siquiera compara: `new Decimal(undefined)` tira `DecimalError`.
        precioUnitario: '1000.0000',
        cantidad: '2',
        cantidadPresentacion: null,
        unidadCodigoPresentacion: null,
        personalizacion: null,
      };
      manager.find.mockResolvedValue([existente]);

      await service.agregarLinea(TENANT, CUENTA, {
        itemId: ITEM,
        cantidad: '3',
      });

      expect(existente.cantidad).toBe('5');
      expect(existente.cantidadPresentacion).toBeNull();
      expect(existente.unidadCodigoPresentacion).toBeNull();
    });

    it('crea una línea nueva cuando el ítem no está en la cuenta', async () => {
      manager.find.mockResolvedValue([]);

      await service.agregarLinea(TENANT, CUENTA, {
        itemId: ITEM,
        cantidad: '2',
      });

      expect(manager.create).toHaveBeenCalledWith(
        CuentaLinea,
        expect.objectContaining({
          itemId: ITEM,
          cantidad: '2',
          cuentaId: CUENTA,
        }),
      );
      expect(manager.save).toHaveBeenCalled();
    });

    it('500 g sobre item kg → cantidad BD 0.5; detalle expone presentación', async () => {
      manager.find.mockResolvedValue([]);
      manager.query.mockResolvedValueOnce([
        {
          cuenta_id: CUENTA,
          cuenta_linea_id: 'linea-pres',
          item_id: ITEM,
          cantidad: '0.5',
          cantidad_presentacion: '500',
          unidad_codigo_presentacion: 'g',
          nombre: 'Harina',
          precio_base: '1000',
          moneda_id: 'moneda-1',
          personalizacion: null,
        },
      ]);

      const detalle = await service.agregarLinea(TENANT, CUENTA, {
        itemId: ITEM,
        cantidad: '999',
        cantidadPresentacion: '500',
        unidadCodigoPresentacion: 'g',
      });

      expect(manager.create).toHaveBeenCalledWith(
        CuentaLinea,
        expect.objectContaining({
          cantidad: '0.5',
          cantidadPresentacion: '500',
          unidadCodigoPresentacion: 'g',
        }),
      );
      expect(detalle.lineas[0]).toMatchObject({
        cantidad: '0.5',
        cantidadPresentacion: '500',
        unidadCodigoPresentacion: 'g',
      });
    });

    it('NO suma si las reglas congeladas difieren, aunque el precio sea el mismo', async () => {
      // La puerta caliente del tercer término, y la que el e2e cubre pero el
      // unitario no cubría: el precio de lista no se mueve cuando sale un
      // descuento, así que este caso pasa por el `find` con los dos primeros
      // términos iguales y solo lo separa la huella de reglas.
      manager.find.mockResolvedValue([
        {
          id: 'linea-1',
          cantidad: '1',
          personalizacion: null,
          precioUnitario: '1000.0000',
          reglasCongeladas: { descuentos: [], recargos: [] },
        },
      ]);
      calculoPrecios.congelarReglasDeItem.mockResolvedValueOnce({
        descuentos: [
          {
            id: 'desc-1',
            modo: 'porcentaje',
            valorPorcentaje: '0.20',
            activo: true,
            vigente: true,
          },
        ],
        recargos: [],
      });

      await service.agregarLinea(TENANT, CUENTA, {
        itemId: ITEM,
        cantidad: '1',
      });

      // Línea nueva, no merge.
      expect(manager.create).toHaveBeenCalled();
    });

    it('suma la cantidad si el ítem ya está en la cuenta sin personalización', async () => {
      manager.find.mockResolvedValue([
        {
          id: 'linea-1',
          cantidad: '2',
          personalizacion: null,
          precioUnitario: '1000.0000',
        },
      ]);

      await service.agregarLinea(TENANT, CUENTA, {
        itemId: ITEM,
        cantidad: '3',
      });

      expect(manager.save).toHaveBeenCalledWith(
        CuentaLinea,
        expect.objectContaining({ cantidad: '5' }),
      );
    });

    it('guarda personalización JSONB en recetas', async () => {
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT i.item_id'))
          return Promise.resolve([
            {
              item_id: RECETA,
              tipo: 'receta',
              unidad_medida: null,
              precio_base: '1000',
              moneda_id: 'clp',
            },
          ]);
        return Promise.resolve([]);
      });
      manager.find.mockResolvedValue([]);

      await service.agregarLinea(TENANT, CUENTA, {
        itemId: RECETA,
        cantidad: '1',
        personalizacion: { omitidos: [ING], comentario: 'sin cebolla' },
      });

      // CON argumentos: el mock devuelve un snapshot fijo sin mirarlos, así que
      // un `toHaveBeenCalled()` pelado pasa igual aunque se ignore lo que el
      // mesero pidió y se mande `{}`.
      expect(items.resolverPersonalizacionReceta).toHaveBeenCalledWith(
        // `db`, no el manager de la transacción: resolver la personalización
        // no debe pedir una segunda conexión con un `FOR UPDATE` tomado —y
        // `db.query` resuelve el manager del contexto ALS si algún día
        // corriera anidado, sin depender de un `dataSource` crudo.
        db,
        TENANT,
        RECETA,
        { omitidos: [ING], comentario: 'sin cebolla' },
      );
      expect(manager.create).toHaveBeenCalledWith(
        CuentaLinea,
        expect.objectContaining({ personalizacion: SNAPSHOT }),
      );
    });

    it('guarda personalización de grupos en combos (resolverPersonalizacionCombo, no receta)', async () => {
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT i.item_id'))
          return Promise.resolve([
            {
              item_id: COMBO,
              tipo: 'combo',
              unidad_medida: null,
              precio_base: '1000',
              moneda_id: 'clp',
            },
          ]);
        return Promise.resolve([]);
      });
      manager.find.mockResolvedValue([]);

      await service.agregarLinea(TENANT, CUENTA, {
        itemId: COMBO,
        cantidad: '1',
        personalizacion: {
          grupos: [
            {
              grupoId: GRUPO,
              opciones: [{ itemId: OPCION_ITEM, unidades: 1 }],
            },
          ],
        },
      });

      expect(items.resolverPersonalizacionCombo).toHaveBeenCalledWith(
        db,
        TENANT,
        COMBO,
        {
          grupos: [
            {
              grupoId: GRUPO,
              opciones: [{ itemId: OPCION_ITEM, unidades: 1 }],
            },
          ],
        },
      );
      expect(items.resolverPersonalizacionReceta).not.toHaveBeenCalled();
      expect(manager.create).toHaveBeenCalledWith(
        CuentaLinea,
        expect.objectContaining({ personalizacion: SNAPSHOT_COMBO }),
      );
    });

    it('suma cantidad si misma personalización; crea línea nueva si difiere', async () => {
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT i.item_id'))
          return Promise.resolve([
            {
              item_id: RECETA,
              tipo: 'receta',
              unidad_medida: null,
              precio_base: '1000',
              moneda_id: 'clp',
            },
          ]);
        return Promise.resolve([]);
      });
      const lineaMisma = {
        id: 'linea-1',
        // Congelado al pedir: precio_base '1000' × tasa 1. Sin esto el merge
        // ni siquiera compara: `new Decimal(undefined)` tira `DecimalError`.
        precioUnitario: '1000.0000',
        cantidad: '1',
        personalizacion: SNAPSHOT,
      };
      manager.find.mockResolvedValue([lineaMisma]);

      await service.agregarLinea(TENANT, CUENTA, {
        itemId: RECETA,
        cantidad: '2',
        personalizacion: { omitidos: [ING], comentario: 'sin cebolla' },
      });

      expect(manager.save).toHaveBeenCalledWith(
        CuentaLinea,
        expect.objectContaining({ cantidad: '3' }),
      );
      expect(manager.create).not.toHaveBeenCalled();

      manager.find.mockResolvedValue([
        {
          id: 'linea-1',
          cantidad: '1',
          personalizacion: { omitidos: ['otro-ing'], extras: [] },
        },
      ]);
      manager.create.mockClear();

      await service.agregarLinea(TENANT, CUENTA, {
        itemId: RECETA,
        cantidad: '1',
        personalizacion: { omitidos: [ING], comentario: 'sin cebolla' },
      });

      expect(manager.create).toHaveBeenCalledWith(
        CuentaLinea,
        expect.objectContaining({ personalizacion: SNAPSHOT }),
      );
    });

    it('rechaza personalización en ítems que no son receta', async () => {
      await expect(
        service.agregarLinea(TENANT, CUENTA, {
          itemId: ITEM,
          cantidad: '1',
          personalizacion: { omitidos: [ING] },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza cantidad menor o igual a cero', async () => {
      manager.find.mockResolvedValue([]);
      await expect(
        service.agregarLinea(TENANT, CUENTA, { itemId: ITEM, cantidad: '0' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza operar sobre una cuenta no abierta', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.CERRADA,
      });
      await expect(
        service.agregarLinea(TENANT, CUENTA, { itemId: ITEM, cantidad: '1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('actualizarLinea', () => {
    beforeEach(() => {
      manager.findOne.mockImplementation((entidad: unknown) =>
        Promise.resolve(
          entidad === Cuenta
            ? { id: CUENTA, tenantId: TENANT, estado: EstadoCuenta.ABIERTA }
            : {
                id: 'linea-1',
                tenantId: TENANT,
                cuentaId: CUENTA,
                itemId: ITEM,
                // Nada despachado: el guard de "no bajar de lo enviado" no
                // aplica y estos tests siguen midiendo lo suyo.
                cantidadEnviada: '0',
              },
        ),
      );
      // El lookup del ítem va por el manager, no por la conexión global: pedir
      // una segunda conexión con el `FOR UPDATE` tomado es un doble checkout.
      manager.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT i.item_id'))
          return Promise.resolve([
            {
              item_id: ITEM,
              tipo: 'producto',
              unidad_medida: 'kg',
              precio_base: '1000',
              moneda_id: 'clp',
            },
          ]);
        if (sql.includes('cl.cuenta_linea_id'))
          return Promise.resolve([
            {
              cuenta_id: CUENTA,
              cuenta_linea_id: 'linea-1',
              item_id: ITEM,
              cantidad: '3',
              cantidad_presentacion: '3',
              unidad_codigo_presentacion: 'kg',
              nombre: 'Harina',
              precio_base: '1000',
              moneda_id: 'moneda-1',
              // Con personalización para que `armarDetalle` dispare también la
              // query de nombres de ingredientes: es la tercera lectura que se
              // escapaba por la conexión global.
              personalizacion: { omitidos: [ING], extras: [] },
            },
          ]);
        return Promise.resolve([]);
      });
    });

    it('el catálogo de unidades ya está cargado cuando arranca la transacción', async () => {
      // Es global: no depende de la cuenta ni de la línea. Cargarlo adentro pide
      // una segunda conexión del pool con el `FOR UPDATE` ya tomado —el doble
      // checkout que puede estancarse—, y nada lo delataba.
      const orden: string[] = [];
      catalog.findAllUnidadesMedida.mockImplementation(() => {
        orden.push('catalogo');
        return Promise.resolve(UNIDADES_CATALOGO);
      });
      dataSource.transaction.mockImplementation(
        (cb: (m: typeof manager) => unknown) => {
          orden.push('transaccion');
          return cb(manager);
        },
      );

      await service.actualizarLinea(TENANT, CUENTA, 'linea-1', {
        cantidad: '2',
      });

      expect(orden[0]).toBe('catalogo');
      expect(orden).toContain('transaccion');
    });

    it('ninguna lectura sale por la conexión global con el lock tomado', async () => {
      await service.actualizarLinea(TENANT, CUENTA, 'linea-1', {
        cantidad: '3',
      });

      // Sostiene el fix del doble checkout: pedir una segunda conexión del pool
      // mientras se sostiene el `FOR UPDATE` puede estancarse con el pool lleno.
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('lee la cuenta con FOR UPDATE dentro de la transacción', async () => {
      await service.actualizarLinea(TENANT, CUENTA, 'linea-1', {
        cantidad: '3',
      });

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(manager.findOne).toHaveBeenCalledWith(
        Cuenta,
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
      );
    });

    it('el detalle devuelto se arma dentro de la transacción', async () => {
      // `dataSource.query` está mockeado a `[]`: si `armarDetalle` se
      // llamara sin el manager, leería por fuera y `lineas` vendría vacío.
      const detalle = await service.actualizarLinea(TENANT, CUENTA, 'linea-1', {
        cantidad: '3',
      });

      expect(detalle.lineas).toHaveLength(1);
      expect(detalle.lineas[0]).toMatchObject({ cantidad: '3' });
    });

    it('sin presentación explícita sincroniza la presentación legado con la unidad base', async () => {
      await service.actualizarLinea(TENANT, CUENTA, 'linea-1', {
        cantidad: '3',
      });

      // Sin `syncPresentacionLegado: true` estos dos quedarían en null y la
      // línea editada perdería la presentación que sí muestra la pantalla.
      expect(manager.save).toHaveBeenCalledWith(
        CuentaLinea,
        expect.objectContaining({
          cantidad: '3',
          cantidadPresentacion: '3',
          unidadCodigoPresentacion: 'kg',
        }),
      );
    });

    it('convierte la presentación explícita a la unidad base', async () => {
      await service.actualizarLinea(TENANT, CUENTA, 'linea-1', {
        cantidad: '999',
        cantidadPresentacion: '500',
        unidadCodigoPresentacion: 'g',
      });

      expect(manager.save).toHaveBeenCalledWith(
        CuentaLinea,
        expect.objectContaining({
          cantidad: '0.5',
          cantidadPresentacion: '500',
          unidadCodigoPresentacion: 'g',
        }),
      );
    });

    it('rechaza cantidad menor o igual a cero', async () => {
      await expect(
        service.actualizarLinea(TENANT, CUENTA, 'linea-1', { cantidad: '0' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('404 si la línea no existe', async () => {
      manager.findOne.mockImplementation((entidad: unknown) =>
        Promise.resolve(
          entidad === Cuenta
            ? { id: CUENTA, tenantId: TENANT, estado: EstadoCuenta.ABIERTA }
            : null,
        ),
      );

      // Clase Y mensaje: afirmar solo una de las dos deja pasar el mutante que
      // cambia la otra (un 400 con el mismo texto, o un 404 de la cuenta).
      await expect(
        service.actualizarLinea(TENANT, CUENTA, 'linea-1', { cantidad: '1' }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.actualizarLinea(TENANT, CUENTA, 'linea-1', { cantidad: '1' }),
      ).rejects.toThrow(/Línea .* no encontrada/);
    });

    /**
     * El otro camino del mismo bug. `actualizarLinea` recibe un valor
     * ABSOLUTO, no un delta, así que bajar de 2 a 1 sobre una línea con 2
     * despachados regalaba un plato sin dejar rastro — y se veía igual que
     * cualquier corrección de tipeo.
     */
    it('no deja bajar la cantidad por debajo de lo ya despachado', async () => {
      manager.findOne.mockImplementation((entidad: unknown) =>
        Promise.resolve(
          entidad === Cuenta
            ? { id: CUENTA, tenantId: TENANT, estado: EstadoCuenta.ABIERTA }
            : {
                id: 'linea-1',
                tenantId: TENANT,
                cuentaId: CUENTA,
                itemId: ITEM,
                cantidadEnviada: '2',
              },
        ),
      );

      await expect(
        service.actualizarLinea(TENANT, CUENTA, 'linea-1', { cantidad: '1' }),
      ).rejects.toThrow(BadRequestException);
      expect(manager.save).not.toHaveBeenCalledWith(
        CuentaLinea,
        expect.anything(),
      );
    });

    it('SUBIR la cantidad sigue libre, y bajar hasta lo despachado también', async () => {
      // El contraste que hace falsable al de arriba: un guard escrito con `lte`
      // en vez de `lessThan` bloquearía dejarla en 2, que es legítimo —no se
      // regala nada— y este test lo caza.
      manager.findOne.mockImplementation((entidad: unknown) =>
        Promise.resolve(
          entidad === Cuenta
            ? { id: CUENTA, tenantId: TENANT, estado: EstadoCuenta.ABIERTA }
            : {
                id: 'linea-1',
                tenantId: TENANT,
                cuentaId: CUENTA,
                itemId: ITEM,
                cantidadEnviada: '2',
              },
        ),
      );

      await expect(
        service.actualizarLinea(TENANT, CUENTA, 'linea-1', { cantidad: '2' }),
      ).resolves.toBeDefined();
    });

    it('rechaza operar sobre una cuenta no abierta', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.CERRADA,
      });

      await expect(
        service.actualizarLinea(TENANT, CUENTA, 'linea-1', { cantidad: '1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('quitarLinea', () => {
    beforeEach(() => {
      manager.findOne.mockImplementation((entidad: unknown) =>
        Promise.resolve(
          entidad === Cuenta
            ? { id: CUENTA, tenantId: TENANT, estado: EstadoCuenta.ABIERTA }
            : {
                id: 'linea-1',
                tenantId: TENANT,
                cuentaId: CUENTA,
                cantidadEnviada: '0',
              },
        ),
      );
      manager.query.mockImplementation((sql: string) =>
        Promise.resolve(
          sql.includes('cl.cuenta_linea_id')
            ? [
                {
                  cuenta_id: CUENTA,
                  cuenta_linea_id: 'linea-2',
                  item_id: ITEM,
                  cantidad: '1',
                  cantidad_presentacion: null,
                  unidad_codigo_presentacion: null,
                  nombre: 'Harina',
                  precio_base: '1000',
                  moneda_id: 'moneda-1',
                  personalizacion: null,
                  cantidad_enviada: '0',
                },
              ]
            : [],
        ),
      );
    });

    it('lee la cuenta con FOR UPDATE y borra la línea en la misma transacción', async () => {
      await service.quitarLinea(TENANT, CUENTA, 'linea-1');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(manager.findOne).toHaveBeenCalledWith(
        Cuenta,
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
      );
      expect(manager.softDelete).toHaveBeenCalledWith(CuentaLinea, {
        id: 'linea-1',
        tenantId: TENANT,
        cuentaId: CUENTA,
      });
    });

    it('el detalle devuelto se arma dentro de la transacción', async () => {
      const detalle = await service.quitarLinea(TENANT, CUENTA, 'linea-1');

      expect(detalle.lineas).toHaveLength(1);
      expect(detalle.lineas[0]).toMatchObject({ id: 'linea-2' });
    });

    it('404 si la línea no pertenece a la cuenta', async () => {
      manager.softDelete.mockResolvedValue({ affected: 0 });

      // Clase Y mensaje. El mensaje, porque la implementación vieja también
      // tiraba 404 pero por "Cuenta no encontrada": afirmar solo la clase deja
      // pasar cualquier mutante que corte antes del softDelete. Y la clase,
      // porque `toThrow(regex)` NO la verifica: un 400 con el mismo texto
      // pasaría igual.
      await expect(
        service.quitarLinea(TENANT, CUENTA, 'linea-1'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.quitarLinea(TENANT, CUENTA, 'linea-1'),
      ).rejects.toThrow(/Línea .* no encontrada/);
    });

    /**
     * Decisión del owner (2026-08-08). La comida ya se hizo: quitar la línea
     * del sistema la regala **sin registro**. Hasta el 2026-08-16 `quitarLinea`
     * ni siquiera leía la fila —hacía `softDelete` por criterio— así que una
     * línea despachada se borraba en silencio.
     */
    it('una línea ya despachada a cocina NO se puede quitar', async () => {
      manager.findOne.mockImplementation((entidad: unknown) =>
        Promise.resolve(
          entidad === Cuenta
            ? { id: CUENTA, tenantId: TENANT, estado: EstadoCuenta.ABIERTA }
            : {
                id: 'linea-1',
                tenantId: TENANT,
                cuentaId: CUENTA,
                cantidadEnviada: '2',
              },
        ),
      );

      await expect(
        service.quitarLinea(TENANT, CUENTA, 'linea-1'),
      ).rejects.toThrow(BadRequestException);
      // Y no llega a borrar: el guard corre ANTES del `softDelete`, no
      // después. Sin esta aserción, moverlo abajo dejaría el test en verde con
      // la línea ya borrada.
      expect(manager.softDelete).not.toHaveBeenCalled();
    });

    it('sin nada despachado se quita como siempre: el guard no rompe el caso normal', async () => {
      await service.quitarLinea(TENANT, CUENTA, 'linea-1');

      expect(manager.softDelete).toHaveBeenCalled();
    });

    it('rechaza operar sobre una cuenta no abierta', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.CERRADA,
      });

      await expect(
        service.quitarLinea(TENANT, CUENTA, 'linea-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('cerrarCuenta', () => {
    it('rechaza con el nombre del ítem eliminado, sin llegar a crear la venta', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        mesaId: MESA,
        numero: 8,
        estado: EstadoCuenta.ABIERTA,
        ventaId: null,
        garzonResponsableId: GARZON_RESPONSABLE,
        cerradaEl: null as Date | null,
      });
      manager.find.mockResolvedValue([{ itemId: ITEM, cantidad: '1' }]);
      manager.query.mockImplementation((sql: string) =>
        Promise.resolve(
          sql.includes('eliminado_el IS NOT NULL')
            ? [{ nombre: 'Pastel de choclo' }]
            : [],
        ),
      );

      // Sin este chequeo, `crearEnTransaccion` explota con "Item no encontrado"
      // y el garzón no tiene cómo saber qué línea quitar.
      await expect(
        service.cerrarCuenta(TENANT, USUARIO, CUENTA, {
          garzonId: GARZON,
          pin: PIN,
          pagos: [{ metodoPagoId: 'mp-1', monto: '1000' }],
        }),
      ).rejects.toThrow(/No se puede cobrar: Pastel de choclo/);
      expect(ventas.crearEnTransaccion).not.toHaveBeenCalled();
    });

    it('genera la venta con crearEnTransaccion y cierra la cuenta', async () => {
      const cuenta = {
        id: CUENTA,
        tenantId: TENANT,
        mesaId: MESA,
        numero: 85,
        estado: EstadoCuenta.ABIERTA,
        ventaId: null,
        garzonResponsableId: GARZON_RESPONSABLE,
        cerradaEl: null as Date | null,
      };
      manager.findOne.mockResolvedValue(cuenta);
      manager.find.mockResolvedValue([
        { itemId: ITEM, cantidad: '2', personalizacion: SNAPSHOT },
      ]);
      manager.query.mockResolvedValue([]);
      ventas.crearEnTransaccion.mockResolvedValue({ id: 'venta-1' });

      const result = await service.cerrarCuenta(TENANT, USUARIO, CUENTA, {
        garzonId: GARZON,
        pin: PIN,
        pagos: [{ metodoPagoId: 'mp-1', monto: '1000' }],
      });

      expect(manager.findOne).toHaveBeenCalledWith(
        Cuenta,
        expect.objectContaining({
          where: { id: CUENTA, tenantId: TENANT },
          lock: { mode: 'pessimistic_write' },
        }),
      );
      // Desde el 2026-08-31 la personalización **no viaja en el DTO**: el body
      // solo lleva ítem y cantidad, y la foto de la línea —snapshot, precio
      // congelado, tasa y reglas— va por el sexto parámetro, que es interno.
      // Reconstruirla en el DTO era lo que dejaba que el motor la re-resolviera
      // contra el catálogo de hoy.
      const [, , , dtoEnviado, cuentaEnviada, congeladas] = ventas
        .crearEnTransaccion.mock.calls[0] as [
        unknown,
        unknown,
        unknown,
        { canal: string; lineas: Record<string, unknown>[] },
        string,
        { personalizacion: unknown }[],
      ];
      expect(dtoEnviado.canal).toBe('fisico');
      expect(dtoEnviado.lineas).toEqual([{ itemId: ITEM, cantidad: '2' }]);
      expect(cuentaEnviada).toBe(CUENTA);
      expect(congeladas[0].personalizacion).toEqual({
        omitidos: [ING],
        extras: [],
        comentario: 'sin cebolla',
      });
      expect(sesiones.buscarSesionAbierta).toHaveBeenCalledWith(
        TENANT,
        GARZON_RESPONSABLE,
      );
      expect(result.ventaId).toBe('venta-1');
      expect(cuenta.estado).toBe(EstadoCuenta.CERRADA);
      expect(cuenta.ventaId).toBe('venta-1');
      expect((cuenta as { garzonCierreId?: string }).garzonCierreId).toBe(
        GARZON,
      );
      expect(cuenta.garzonResponsableId).toBe(GARZON_RESPONSABLE);
      expect(asignaciones.cerrarTramoVigente).toHaveBeenCalledWith(
        manager,
        TENANT,
        CUENTA,
        cuenta.cerradaEl,
      );
      expect(sesiones.assertSesionAbierta).toHaveBeenCalledWith(TENANT, GARZON);
    });

    it('reenvía personalizacion.grupos a la venta cuando la línea tiene un combo con grupos', async () => {
      const cuenta = {
        id: CUENTA,
        tenantId: TENANT,
        mesaId: MESA,
        numero: 85,
        estado: EstadoCuenta.ABIERTA,
        ventaId: null,
        garzonResponsableId: GARZON_RESPONSABLE,
        cerradaEl: null as Date | null,
      };
      manager.findOne.mockResolvedValue(cuenta);
      manager.find.mockResolvedValue([
        { itemId: COMBO, cantidad: '1', personalizacion: SNAPSHOT_COMBO },
      ]);
      manager.query.mockResolvedValue([]);
      ventas.crearEnTransaccion.mockResolvedValue({ id: 'venta-1' });

      await service.cerrarCuenta(TENANT, USUARIO, CUENTA, {
        garzonId: GARZON,
        pin: PIN,
        pagos: [{ metodoPagoId: 'mp-1', monto: '1500' }],
      });

      // El snapshot del combo viaja VERBATIM por el canal interno: no se
      // desarma ni se vuelve a resolver.
      const congeladasCombo = ventas.crearEnTransaccion.mock.calls[0][5] as {
        personalizacion: { grupos: unknown[] };
      }[];
      // `toMatchObject` y no `toEqual`: el snapshot viaja ENTERO —con el nombre
      // del grupo, la cantidad de la opción, su precio—, que es justamente lo
      // que se perdía al reconstruirlo campo por campo.
      expect(congeladasCombo[0].personalizacion.grupos).toMatchObject([
        {
          grupoId: GRUPO,
          opciones: [{ itemId: OPCION_ITEM, unidades: '1' }],
        },
      ]);
    });

    it('preserva las unidades de un extra al reconstruir la venta al cerrar', async () => {
      const cuenta = {
        id: CUENTA,
        tenantId: TENANT,
        mesaId: MESA,
        numero: 85,
        estado: EstadoCuenta.ABIERTA,
        ventaId: null,
        garzonResponsableId: GARZON_RESPONSABLE,
        cerradaEl: null as Date | null,
      };
      manager.findOne.mockResolvedValue(cuenta);
      manager.find.mockResolvedValue([
        { itemId: ITEM, cantidad: '1', personalizacion: SNAPSHOT_EXTRA },
      ]);
      manager.query.mockResolvedValue([]);
      ventas.crearEnTransaccion.mockResolvedValue({ id: 'venta-1' });

      await service.cerrarCuenta(TENANT, USUARIO, CUENTA, {
        garzonId: GARZON,
        pin: PIN,
        pagos: [{ metodoPagoId: 'mp-1', monto: '500' }],
      });

      // Las unidades del extra sobreviven porque el snapshot viaja entero, no
      // reconstruido: antes se re-armaba campo por campo y perderlas era un
      // olvido de una línea.
      const congeladasExtra = ventas.crearEnTransaccion.mock.calls[0][5] as {
        personalizacion: { extras: { unidades: string }[] };
      }[];
      expect(congeladasExtra[0].personalizacion.extras[0]).toMatchObject({
        ingredienteItemId: ING,
        unidades: '3',
      });
    });

    it('pasa propinaCierreMesa con el monto y el garzón responsable', async () => {
      const cuenta = {
        id: CUENTA,
        tenantId: TENANT,
        mesaId: MESA,
        numero: 85,
        estado: EstadoCuenta.ABIERTA,
        ventaId: null,
        garzonResponsableId: GARZON_RESPONSABLE,
        cerradaEl: null as Date | null,
      };
      manager.findOne.mockResolvedValue(cuenta);
      manager.find.mockResolvedValue([{ itemId: ITEM, cantidad: '1' }]);
      manager.query.mockResolvedValue([]);
      ventas.crearEnTransaccion.mockResolvedValue({ id: 'venta-2' });

      await service.cerrarCuenta(TENANT, USUARIO, CUENTA, {
        garzonId: GARZON,
        pin: PIN,
        propinaMonto: '1500',
        propinaSugerida: '1200',
        propinaPorcentajeSugerido: '0.10',
        pagos: [{ metodoPagoId: 'mp-1', monto: '11500' }],
      });

      expect(ventas.crearEnTransaccion).toHaveBeenCalledWith(
        manager,
        TENANT,
        USUARIO,
        expect.objectContaining({
          propinaCierreMesa: expect.objectContaining({
            montoPagado: '1500',
            montoSugerido: '1200',
            porcentajeSugerido: '0.10',
            garzonId: GARZON_RESPONSABLE,
            sesionGarzonId: SESION_RESPONSABLE,
            turnoId: TURNO,
            tipoGarzon: TipoGarzon.GARZON,
            estrategia: 'no_vuelto',
          }),
        }),
        CUENTA,
        // El sexto: la foto de cada línea (canal interno, 2026-08-31).
        expect.any(Array),
      );
    });

    it('pasa sesion/turno/tipo del responsable al crear venta', async () => {
      const cuenta = {
        id: CUENTA,
        tenantId: TENANT,
        mesaId: MESA,
        numero: 85,
        estado: EstadoCuenta.ABIERTA,
        ventaId: null,
        garzonResponsableId: GARZON_RESPONSABLE,
        cerradaEl: null as Date | null,
      };
      manager.findOne.mockResolvedValue(cuenta);
      manager.find.mockResolvedValue([{ itemId: ITEM, cantidad: '1' }]);
      manager.query.mockResolvedValue([]);
      ventas.crearEnTransaccion.mockResolvedValue({ id: 'venta-3' });
      sesiones.buscarSesionAbierta.mockResolvedValueOnce({
        id: 's1',
        turnoId: 'tu1',
        tipoGarzon: TipoGarzon.COCINA,
      });

      await service.cerrarCuenta(TENANT, USUARIO, CUENTA, {
        garzonId: GARZON,
        pin: PIN,
        propinaMonto: '500',
        pagos: [{ metodoPagoId: 'mp-1', monto: '4000' }],
      });

      expect(ventas.crearEnTransaccion).toHaveBeenCalledWith(
        manager,
        TENANT,
        USUARIO,
        expect.objectContaining({
          propinaCierreMesa: expect.objectContaining({
            garzonId: GARZON_RESPONSABLE,
            sesionGarzonId: 's1',
            turnoId: 'tu1',
            tipoGarzon: TipoGarzon.COCINA,
          }),
        }),
        CUENTA,
        // El sexto: la foto de cada línea (canal interno, 2026-08-31).
        expect.any(Array),
      );
    });

    it('rechaza propina negativa', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
        garzonResponsableId: GARZON_RESPONSABLE,
      });
      manager.find.mockResolvedValue([{ itemId: ITEM, cantidad: '1' }]);

      await expect(
        service.cerrarCuenta(TENANT, USUARIO, CUENTA, {
          garzonId: GARZON,
          pin: PIN,
          propinaMonto: '-1',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(ventas.crearEnTransaccion).not.toHaveBeenCalled();
    });

    it.each([
      ['propinaSugerida', { propinaSugerida: '-1' }],
      ['propinaPorcentajeSugerido', { propinaPorcentajeSugerido: '-0.1' }],
    ])('rechaza %s negativa', async (_campo, extra) => {
      // `@IsNumberString()` acepta el signo menos, y estos dos no pasaban por
      // ninguna otra validación: se persistían en `venta_propina` y ensuciaban
      // los reportes con signos incoherentes. No cobran de más —`targetCobro`
      // usa solo `propinaMonto`— pero el punto de entrada sin validar es este.
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
        garzonResponsableId: GARZON_RESPONSABLE,
      });
      manager.find.mockResolvedValue([{ itemId: ITEM, cantidad: '1' }]);
      // El camino feliz tiene que poder completarse: si explota en un undefined
      // antes de llegar al final, el test muere por un TypeError y no por la
      // propiedad que enuncia. Local, no en el harness: como default global
      // apagaría los `if (!rows.length) throw` de todo el service.
      manager.query.mockResolvedValue([]);
      ventas.crearEnTransaccion.mockResolvedValue({ id: 'venta-1' });

      await expect(
        service.cerrarCuenta(TENANT, USUARIO, CUENTA, {
          garzonId: GARZON,
          pin: PIN,
          ...extra,
        }),
      ).rejects.toThrow('Propina inválida');
      expect(ventas.crearEnTransaccion).not.toHaveBeenCalled();
    });

    it('rechaza cerrar sin garzón responsable', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
        garzonResponsableId: null,
      });
      manager.find.mockResolvedValue([{ itemId: ITEM, cantidad: '1' }]);

      await expect(
        service.cerrarCuenta(TENANT, USUARIO, CUENTA, {
          garzonId: GARZON,
          pin: PIN,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(ventas.crearEnTransaccion).not.toHaveBeenCalled();
    });

    it('cerrarCuenta rechaza si el garzón no tiene sesión abierta', async () => {
      sesiones.assertSesionAbierta.mockRejectedValue(
        new BadRequestException(
          'El garzón no tiene una sesión de trabajo abierta',
        ),
      );
      await expect(
        service.cerrarCuenta(TENANT, USUARIO, CUENTA, {
          garzonId: GARZON,
          pin: PIN,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(ventas.crearEnTransaccion).not.toHaveBeenCalled();
    });

    // El cajero SÍ está en turno (`assertSesionAbierta` pasa); el que se fue es
    // el responsable de la mesa. El mensaje tiene que decir eso y NO contener
    // "sesión de trabajo": Salones lo usa como señal para abrir el modal de
    // entrar a turno, y mandaría al cajero a iniciar un turno que ya tiene.
    it('responsable fuera de turno → 400 que pide transferir, no "sesión de trabajo"', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
        garzonResponsableId: GARZON_RESPONSABLE,
      });
      manager.find.mockResolvedValue([{ itemId: ITEM, cantidad: '1' }]);
      sesiones.buscarSesionAbierta.mockResolvedValue(null);

      const err = (await service
        .cerrarCuenta(TENANT, USUARIO, CUENTA, { garzonId: GARZON, pin: PIN })
        .catch((e: unknown) => e)) as Error;

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('ya no está en turno');
      expect(err.message).toContain('Transferí la cuenta');
      expect(err.message).not.toContain('sesión de trabajo');
      expect(sesiones.assertSesionAbierta).toHaveBeenCalledWith(TENANT, GARZON);
      expect(ventas.crearEnTransaccion).not.toHaveBeenCalled();
    });

    it('rechaza cerrar una cuenta sin productos', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
      });
      manager.find.mockResolvedValue([]);

      await expect(
        service.cerrarCuenta(TENANT, USUARIO, CUENTA, {
          garzonId: GARZON,
          pin: PIN,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(ventas.crearEnTransaccion).not.toHaveBeenCalled();
    });

    it('rechaza cerrar una cuenta que no está abierta', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.CANCELADA,
      });

      await expect(
        service.cerrarCuenta(TENANT, USUARIO, CUENTA, {
          garzonId: GARZON,
          pin: PIN,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(ventas.crearEnTransaccion).not.toHaveBeenCalled();
    });
  });

  describe('cancelarCuenta', () => {
    it('marca la cuenta como cancelada sin generar venta', async () => {
      const cuenta = {
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
        cerradaEl: null as Date | null,
      };
      manager.findOne.mockResolvedValue(cuenta);
      manager.query.mockResolvedValue([]);

      const result = await service.cancelarCuenta(TENANT, CUENTA);

      expect(manager.findOne).toHaveBeenCalledWith(
        Cuenta,
        expect.objectContaining({
          where: { id: CUENTA, tenantId: TENANT },
          lock: { mode: 'pessimistic_write' },
        }),
      );
      expect(cuenta.estado).toBe(EstadoCuenta.CANCELADA);
      expect(cuenta.cerradaEl).toBeInstanceOf(Date);
      expect(result.estado).toBe(EstadoCuenta.CANCELADA);
      expect(manager.save).toHaveBeenCalledWith(Cuenta, cuenta);
      expect(asignaciones.cerrarTramoVigente).toHaveBeenCalledWith(
        manager,
        TENANT,
        CUENTA,
        cuenta.cerradaEl,
      );
      expect(cuentaRepo.save).not.toHaveBeenCalled();
      expect(ventas.crearEnTransaccion).not.toHaveBeenCalled();
    });
  });

  describe('listarCuentasDeMesa — costo en queries', () => {
    // El endpoint que el garzón golpea cada vez que abre una mesa. Con una
    // query por cuenta, una mesa con 4 cuentas cuesta 4 veces lo que una con 1.
    // Lo que se fija es que el costo NO crezca con la cantidad de cuentas.
    function cuentaAbierta(n: number) {
      return {
        id: `cuenta-${n}`,
        numero: n,
        nombre: null,
        estado: EstadoCuenta.ABIERTA,
        mesaId: MESA,
        ventaId: null,
        garzonAperturaId: `garzon-${n}`,
        garzonResponsableId: `garzon-${n}`,
        garzonCierreId: null,
      };
    }

    function contarQueries(cuentas: number) {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      cuentaRepo.find.mockResolvedValue(
        Array.from({ length: cuentas }, (_, i) => cuentaAbierta(i + 1)),
      );
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM cuenta_lineas')) {
          // Una línea por cuenta, cada una con personalización: es el caso que
          // dispara las tres consultas de `armarDetalle`.
          return Promise.resolve(
            Array.from({ length: cuentas }, (_, i) => ({
              cuenta_linea_id: `linea-${i + 1}`,
              cuenta_id: `cuenta-${i + 1}`,
              item_id: ITEM,
              cantidad: '1',
              cantidad_presentacion: null,
              unidad_codigo_presentacion: null,
              nombre: 'Papas',
              precio_base: '1000',
              moneda_id: 'clp',
              personalizacion: SNAPSHOT,
              item_eliminado: false,
            })),
          );
        }
        return Promise.resolve([]);
      });
      return dataSource.query;
    }

    it('el costo en queries no crece con la cantidad de cuentas de la mesa', async () => {
      const query = contarQueries(1);
      await service.listarCuentasDeMesa(TENANT, MESA);
      const conUna = query.mock.calls.length;

      jest.clearAllMocks();
      contarQueries(4);
      await service.listarCuentasDeMesa(TENANT, MESA);
      const conCuatro = query.mock.calls.length;

      expect(conCuatro).toBe(conUna);
    });

    it('cada cuenta recibe SOLO sus propias líneas', async () => {
      // El batch trae las líneas de todas las cuentas en una query: si el
      // agrupado por `cuenta_id` se cae, una mesa muestra los pedidos de otra.
      contarQueries(3);
      const detalles = await service.listarCuentasDeMesa(TENANT, MESA);

      expect(detalles).toHaveLength(3);
      expect(detalles.map((d) => d.lineas.map((l) => l.id))).toEqual([
        ['linea-1'],
        ['linea-2'],
        ['linea-3'],
      ]);
    });
  });

  describe('aislamiento por tenant en las queries crudas', () => {
    // Defensa en profundidad: las líneas ya vienen acotadas por `cl.tenant_id`,
    // así que sacar el filtro del JOIN no rompe nada HOY. Se fija igual porque
    // es la clase de filtro que se pierde en un refactor sin que nada avise, y
    // el día que una query cambie de raíz, lo que quedaba era el JOIN.
    it('el JOIN a items del detalle acota por tenant', async () => {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      cuentaRepo.find.mockResolvedValue([
        { id: CUENTA, numero: 1, estado: EstadoCuenta.ABIERTA, mesaId: MESA },
      ]);
      const sqls: string[] = [];
      dataSource.query.mockImplementation((sql: string) => {
        sqls.push(sql);
        return Promise.resolve([]);
      });

      await service.listarCuentasDeMesa(TENANT, MESA);

      const join = sqls.find((s) => s.includes('JOIN items i'));
      expect(join).toBeDefined();
      // Acotado a la cláusula del JOIN: un `toContain('tenant_id')` suelto
      // matchearía el `cl.tenant_id` del WHERE y pasaría sin el filtro.
      expect(join).toMatch(/JOIN items i ON[^\n]*i\.tenant_id = \$2/);
    });

    it('la query de ítems eliminados de cerrarCuenta acota por tenant', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        mesaId: MESA,
        numero: 8,
        estado: EstadoCuenta.ABIERTA,
        ventaId: null,
        garzonResponsableId: GARZON_RESPONSABLE,
        cerradaEl: null as Date | null,
      });
      manager.find.mockResolvedValue([{ itemId: ITEM, cantidad: '1' }]);
      const sqls: string[] = [];
      manager.query.mockImplementation((sql: string) => {
        sqls.push(sql);
        return Promise.resolve(
          sql.includes('eliminado_el IS NOT NULL')
            ? [{ nombre: 'Pastel de choclo' }]
            : [],
        );
      });

      await expect(
        service.cerrarCuenta(TENANT, USUARIO, CUENTA, {
          garzonId: GARZON,
          pin: PIN,
          pagos: [{ metodoPagoId: 'mp-1', monto: '1000' }],
        }),
      ).rejects.toThrow(BadRequestException);

      const sql = sqls.find((s) => s.includes('eliminado_el IS NOT NULL'));
      expect(sql).toMatch(/item_id = ANY\(\$1\) AND tenant_id = \$2/);
    });
  });

  describe('armarDetalle / responsable', () => {
    it('devuelve ID/nombre del responsable aunque el garzón esté soft-deleted', async () => {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      cuentaRepo.find.mockResolvedValue([
        {
          id: CUENTA,
          numero: 1,
          nombre: null,
          estado: EstadoCuenta.ABIERTA,
          mesaId: MESA,
          ventaId: null,
          garzonAperturaId: GARZON,
          garzonResponsableId: GARZON,
          garzonCierreId: null,
        },
      ]);
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM cuenta_lineas')) return Promise.resolve([]);
        if (sql.includes('FROM garzones')) {
          expect(sql).not.toMatch(/eliminado_el\s+IS\s+NULL/i);
          return Promise.resolve([{ garzon_id: GARZON, nombre: 'Ana Torres' }]);
        }
        return Promise.resolve([]);
      });

      const [detalle] = await service.listarCuentasDeMesa(TENANT, MESA);

      expect(detalle.garzonResponsableId).toBe(GARZON);
      expect(detalle.garzonResponsableNombre).toBe('Ana Torres');
    });

    it('la línea de un ítem eliminado se muestra marcada, no se esconde', async () => {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      cuentaRepo.find.mockResolvedValue([
        {
          id: CUENTA,
          numero: 1,
          nombre: null,
          estado: EstadoCuenta.ABIERTA,
          mesaId: MESA,
          ventaId: null,
          garzonAperturaId: null,
          garzonResponsableId: null,
          garzonCierreId: null,
        },
      ]);
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM cuenta_lineas')) {
          // El JOIN a `items` NO debe filtrar lo eliminado: filtrarlo hacía
          // desaparecer la línea de la pantalla mientras `cerrarCuenta`, que
          // lee las líneas crudas, seguía contándola.
          expect(sql).not.toMatch(/i\.eliminado_el\s+IS\s+NULL/i);
          return Promise.resolve([
            {
              cuenta_id: CUENTA,
              cuenta_linea_id: 'linea-1',
              item_id: ITEM,
              cantidad: '1',
              cantidad_presentacion: null,
              unidad_codigo_presentacion: null,
              nombre: 'Pastel de choclo',
              precio_base: '8000',
              moneda_id: 'moneda-1',
              personalizacion: null,
              item_eliminado: true,
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const [detalle] = await service.listarCuentasDeMesa(TENANT, MESA);

      expect(detalle.lineas).toHaveLength(1);
      expect(detalle.lineas[0]).toMatchObject({
        nombre: 'Pastel de choclo',
        itemEliminado: true,
      });
    });

    it('una línea normal no lleva la marca de eliminado', async () => {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      cuentaRepo.find.mockResolvedValue([
        {
          id: CUENTA,
          numero: 1,
          nombre: null,
          estado: EstadoCuenta.ABIERTA,
          mesaId: MESA,
          ventaId: null,
          garzonAperturaId: null,
          garzonResponsableId: null,
          garzonCierreId: null,
        },
      ]);
      dataSource.query.mockImplementation((sql: string) =>
        Promise.resolve(
          sql.includes('FROM cuenta_lineas')
            ? [
                {
                  cuenta_id: CUENTA,
                  cuenta_linea_id: 'linea-1',
                  item_id: ITEM,
                  cantidad: '1',
                  cantidad_presentacion: null,
                  unidad_codigo_presentacion: null,
                  nombre: 'Pizza',
                  precio_base: '8000',
                  moneda_id: 'moneda-1',
                  personalizacion: null,
                  item_eliminado: false,
                },
              ]
            : [],
        ),
      );

      const [detalle] = await service.listarCuentasDeMesa(TENANT, MESA);

      expect(detalle.lineas[0]).not.toHaveProperty('itemEliminado');
    });
  });

  describe('eliminarMesa', () => {
    it('lanza NotFound al eliminar una mesa de otro tenant', async () => {
      mesaRepo.findOne.mockResolvedValue(null);
      await expect(service.eliminarMesa(TENANT, USUARIO, MESA)).rejects.toThrow(
        NotFoundException,
      );
      expect(mesaRepo.update).not.toHaveBeenCalled();
    });

    it('no elimina una mesa con cuentas abiertas', async () => {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      cuentaRepo.count.mockResolvedValue(1);
      await expect(service.eliminarMesa(TENANT, USUARIO, MESA)).rejects.toThrow(
        BadRequestException,
      );
      expect(mesaRepo.update).not.toHaveBeenCalled();
    });

    it('registra quién borró y cuándo, en una sola escritura', async () => {
      mesaRepo.findOne.mockResolvedValue({ id: MESA, tenantId: TENANT });
      cuentaRepo.count.mockResolvedValue(0);

      await service.eliminarMesa(TENANT, USUARIO, MESA);

      expect(mesaRepo.update).toHaveBeenCalledWith(
        { id: MESA, tenantId: TENANT },
        { eliminadoEl: expect.any(Date), eliminadoPor: USUARIO },
      );
    });
  });

  describe('eliminarSalon', () => {
    const SALON = 'salon-uuid';

    beforeEach(() => {
      salonRepo.findOne.mockResolvedValue({ id: SALON, tenantId: TENANT });
      cuentaRepo.createQueryBuilder.mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
      });
    });

    it('lanza NotFound al eliminar un salón de otro tenant', async () => {
      salonRepo.findOne.mockResolvedValue(null);
      await expect(
        service.eliminarSalon(TENANT, USUARIO, SALON),
      ).rejects.toThrow(NotFoundException);
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('no elimina un salón con cuentas abiertas', async () => {
      cuentaRepo.createQueryBuilder.mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(1),
      });
      await expect(
        service.eliminarSalon(TENANT, USUARIO, SALON),
      ).rejects.toThrow(BadRequestException);
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('registra quién borró, con el MISMO eliminado_el que las mesas colaterales', async () => {
      await service.eliminarSalon(TENANT, USUARIO, SALON);

      // Las dos escrituras (mesas y salón) comparten el mismo objeto `Date`
      // de JS: si usaran `new Date()` cada una por separado, dos milisegundos
      // distintos entre las dos harían que `restaurarSalon` no pueda acotar
      // las mesas por el `eliminado_el` exacto del salón.
      const mesasCall = manager.update.mock.calls.find(
        (c) => c[0] === Mesa,
      ) as unknown[];
      const salonCall = manager.update.mock.calls.find(
        (c) => c[0] === Salon,
      ) as unknown[];
      expect(mesasCall).toBeDefined();
      expect(salonCall).toBeDefined();
      const eliminadoElMesas = (mesasCall[2] as { eliminadoEl: Date })
        .eliminadoEl;
      const eliminadoElSalon = (salonCall[2] as { eliminadoEl: Date })
        .eliminadoEl;
      expect(eliminadoElMesas).toBe(eliminadoElSalon);
      expect(mesasCall[2]).toMatchObject({ eliminadoPor: USUARIO });
      expect(salonCall[2]).toMatchObject({ eliminadoPor: USUARIO });
    });

    it('solo cascadea a las mesas que siguen vivas: filtra eliminadoEl IsNull', async () => {
      await service.eliminarSalon(TENANT, USUARIO, SALON);

      const mesasCall = manager.update.mock.calls.find(
        (c) => c[0] === Mesa,
      ) as unknown[];
      const criterio = mesasCall[1] as { eliminadoEl: unknown };
      // `IsNull()` de TypeORM es un `FindOperator` — no un valor plano — así
      // que si el criterio no filtrara nada, una mesa borrada por otro
      // motivo antes de este borrado perdería su timestamp original y
      // `restaurarSalon` la revivería por error.
      expect(criterio.eliminadoEl).toBeDefined();
    });
  });

  // `listarSalones` no tenía ningún test unitario, así que el filtro de la
  // papelera dependía enteramente del e2e (o sea, de levantar Postgres). Es
  // el único de los 16 recursos que aplica la regla en DOS lugares de la
  // misma query, y por eso el que más fácil se rompe a medias.
  describe('listarSalones con incluirEliminados', () => {
    /**
     * El tramo del SQL que va del `LEFT JOIN mesas` al siguiente `LEFT JOIN`
     * o al `WHERE`. Sin acotar así, un `toContain` sobre el SQL entero da por
     * bueno el filtro de mesas puesto en CUALQUIER otro lado —medido: movido
     * al `ON` del JOIN a `usuarios` deja de filtrar mesas y el test seguía
     * verde—, que es justo la posición que estos tests dicen fijar.
     */
    const tramoJoinMesas = (sql: string) =>
      /LEFT JOIN mesas m\b[\s\S]*?(?=LEFT JOIN|\bWHERE\b)/.exec(sql)?.[0] ?? '';

    it('sin el flag no trae columnas de borrado ni hace JOIN con usuarios', async () => {
      dataSource.query.mockResolvedValueOnce([]);

      await service.listarSalones(TENANT);

      const sql = dataSource.query.mock.calls[0][0] as string;
      expect(sql).not.toContain('LEFT JOIN usuarios');
      expect(sql).toContain('s.eliminado_el IS NULL');
      // La compañera, que es la que se olvida: el listado normal filtra el
      // borrado de la mesa en el JOIN, no solo el del salón. Sin esta
      // aserción, borrar ese filtro deja el test verde y el salón vuelve con
      // sus mesas borradas adentro (invariante 3: toda lectura filtra
      // `eliminado_el`, en CADA tabla del JOIN, no solo en la principal).
      expect(tramoJoinMesas(sql)).toContain('m.eliminado_el IS NULL');
    });

    it('con el flag aplica el filtro de borrado-del-sistema al salón Y a la mesa, por separado', async () => {
      dataSource.query.mockResolvedValueOnce([]);

      await service.listarSalones(TENANT, true);

      const sql = dataSource.query.mock.calls[0][0] as string;
      expect(sql).toContain('LEFT JOIN usuarios');
      // Las DOS cláusulas, con su alias. Un solo filtro no alcanza y no son
      // intercambiables: el del salón va en el `WHERE`, pero el de la mesa
      // tiene que ir en el `JOIN` — puesto en el `WHERE` haría desaparecer el
      // salón entero cuando alguna de sus mesas la borró el sistema, en vez
      // de esconder solo esa mesa. Por eso el de la mesa se busca dentro de
      // SU tramo del JOIN y no en el SQL entero.
      expect(sql).toContain(
        '(s.eliminado_el IS NULL OR s.eliminado_por IS NOT NULL)',
      );
      expect(tramoJoinMesas(sql)).toContain(
        '(m.eliminado_el IS NULL OR m.eliminado_por IS NOT NULL)',
      );
    });
  });

  describe('restaurarSalon', () => {
    const SALON = 'salon-uuid';

    it('salón que no está en la papelera → 404', async () => {
      dataSource.query.mockResolvedValueOnce([]); // CTE sin match

      await expect(service.restaurarSalon(TENANT, SALON)).rejects.toThrow(
        NotFoundException,
      );
      expect(dataSource.query).toHaveBeenCalledTimes(1);
    });

    it('restaura el salón y las mesas que ESE borrado se llevó, en un solo statement', async () => {
      dataSource.query.mockResolvedValueOnce([{ salon_id: SALON }]); // CTE
      salonRepo.findOneOrFail.mockResolvedValue({
        id: SALON,
        tenantId: TENANT,
        nombre: 'Salón restaurado',
      });

      const result = await service.restaurarSalon(TENANT, SALON);

      expect(result).toEqual({
        id: SALON,
        tenantId: TENANT,
        nombre: 'Salón restaurado',
      });
      // Una sola sentencia por `dataSource.query` (CTEs encadenadas), nunca
      // una transacción con dos `manager.query` sueltos pasando el
      // timestamp de por medio (ver items.service.ts → restaurar()): el e2e
      // real es el que cazó ese bug la primera vez, los unit tests mockeados
      // lo daban por bueno.
      expect(dataSource.query).toHaveBeenCalledTimes(1);
      const sql = dataSource.query.mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE salones');
      expect(sql).toContain('UPDATE mesas');
      // El mutante importante: acotar las mesas por
      // `eliminado_el IS NOT NULL` (o sin condición alguna) revive
      // CUALQUIER mesa borrada del salón, no solo la de este borrado. Acotar
      // por el valor exacto que dejó restaurado (vía subquery a la misma
      // CTE, nunca un parámetro que pasó por JS) es lo único que distingue
      // "la mesa 3, borrada el martes" de "las mesas de este borrado, el
      // viernes".
      expect(sql).toMatch(
        /mesas[\s\S]*eliminado_el\s*=\s*\(SELECT eliminado_el_previo FROM restaurado\)/,
      );
    });
  });

  describe('restaurarMesa', () => {
    const MESA_ID = 'mesa-restaurar-uuid';

    it('mesa que no está en la papelera → 404', async () => {
      dataSource.query.mockResolvedValueOnce([]);

      await expect(service.restaurarMesa(TENANT, MESA_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('restaura la mesa sin tocar el salón', async () => {
      dataSource.query.mockResolvedValueOnce([{ mesa_id: MESA_ID }]);
      mesaRepo.findOneOrFail.mockResolvedValue({
        id: MESA_ID,
        tenantId: TENANT,
        salonId: 'salon-huerfano',
      });

      await service.restaurarMesa(TENANT, MESA_ID);

      const sql = dataSource.query.mock.calls[0][0] as string;
      // Huérfano tolerado (decisión (c) de la spec): la sentencia toca SOLO
      // `mesas`, nunca `salones`.
      expect(sql).toContain('UPDATE mesas');
      expect(sql).not.toMatch(/UPDATE salones/i);
    });
  });

  describe('previewComanda', () => {
    it('la comanda no esconde el ítem eliminado del catálogo', async () => {
      cuentaRepo.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
      });
      let sqlLineas = '';
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT item_id, nombre FROM items'))
          return Promise.resolve([]);
        sqlLineas = sql;
        return Promise.resolve([
          {
            cuenta_linea_id: 'linea-1',
            cantidad: '1',
            cantidad_enviada: '0',
            nombre: 'Pastel de choclo',
            impresora_id: 'impresora-cocina',
            impresora_nombre: 'Cocina',
            personalizacion: null,
          },
        ]);
      });

      const res = await service.previewComanda(TENANT, CUENTA);

      // Un plato ya pedido hay que cocinarlo aunque el admin lo haya sacado de
      // la carta. Con el filtro puesto, la línea desaparecía del ticket sin
      // aviso: "Enviar a cocina" respondía OK y el plato no se cocinaba.
      expect(sqlLineas).not.toMatch(/i\.eliminado_el\s+IS\s+NULL/i);
      expect(sqlLineas).toMatch(/i\.tenant_id = \$2/);
      // La categoría corre la misma suerte: si un cleanup borra el ítem Y su
      // categoría, filtrarla dejaba `impresora_id` en null y el agrupado se
      // salteaba la línea en silencio, indistinguible de "sin impresora".
      expect(sqlLineas).not.toMatch(/c\.eliminado_el\s+IS\s+NULL/i);
      // La impresora SÍ se filtra: a una borrada o apagada no se imprime.
      expect(sqlLineas).toMatch(/imp\.eliminado_el\s+IS\s+NULL/i);
      expect(sqlLineas).toMatch(/imp\.activo = true/);
      expect(res.estaciones[0]?.items[0]?.nombre).toBe('Pastel de choclo');
    });

    it('agrupa por impresora solo los ítems con diferencia pendiente, SIN persistir', async () => {
      cuentaRepo.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
      });
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT item_id, nombre FROM items'))
          return Promise.resolve([{ item_id: ING, nombre: 'Cebolla' }]);
        return Promise.resolve([
          {
            cuenta_linea_id: 'linea-1',
            cantidad: '3',
            cantidad_enviada: '1',
            nombre: 'Lomo a lo pobre',
            impresora_id: 'impresora-cocina',
            impresora_nombre: 'Cocina',
            personalizacion: SNAPSHOT,
          },
          {
            cuenta_linea_id: 'linea-2',
            cantidad: '2',
            cantidad_enviada: '2',
            nombre: 'Agua mineral',
            impresora_id: 'impresora-barra',
            impresora_nombre: 'Barra',
            personalizacion: null,
          },
          {
            cuenta_linea_id: 'linea-3',
            cantidad: '1',
            cantidad_enviada: '0',
            nombre: 'Postre sin ruta',
            impresora_id: null,
            impresora_nombre: null,
            personalizacion: null,
          },
        ]);
      });

      const result = await service.previewComanda(TENANT, CUENTA);

      expect(result.estaciones).toEqual([
        {
          impresoraId: 'impresora-cocina',
          nombre: 'Cocina',
          items: [
            {
              cuentaLineaId: 'linea-1',
              nombre: 'Lomo a lo pobre',
              cantidad: '2',
              cantidadEnviada: '3',
              nota: 'Sin Cebolla · sin cebolla',
            },
          ],
        },
      ]);
      // preview NO persiste nada
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('lanza BadRequest si la cuenta no está abierta', async () => {
      cuentaRepo.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.CERRADA,
      });
      await expect(service.previewComanda(TENANT, CUENTA)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza NotFound si la cuenta no pertenece al tenant', async () => {
      cuentaRepo.findOne.mockResolvedValue(null);
      await expect(service.previewComanda(TENANT, CUENTA)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reclamarComanda', () => {
    it('resuelve los nombres de ingredientes por el manager, no por la conexión global', async () => {
      // Con el `FOR UPDATE` tomado, salir por `this.dataSource` pide una segunda
      // conexión del pool: el doble checkout que puede estancarse.
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
      });
      manager.query
        .mockResolvedValueOnce([
          {
            cuenta_linea_id: 'linea-1',
            cantidad: '2',
            cantidad_enviada: '0',
            nombre: 'Lomo',
            impresora_id: 'impresora-cocina',
            impresora_nombre: 'Cocina',
            // Con personalización: es lo que dispara la consulta de nombres.
            personalizacion: SNAPSHOT,
          },
        ])
        .mockResolvedValue([]);
      // Igual que arriba: sin esto el mutante muere en un `.map` de undefined
      // en vez de morir por la aserción de abajo.
      dataSource.query.mockResolvedValue([]);

      await service.reclamarComanda(TENANT, CUENTA);

      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('avanza cantidad_enviada y devuelve estaciones en un solo claim', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
      });
      manager.query
        .mockResolvedValueOnce([
          {
            cuenta_linea_id: 'linea-1',
            cantidad: '3',
            cantidad_enviada: '1',
            nombre: 'Lomo a lo pobre',
            impresora_id: 'impresora-cocina',
            impresora_nombre: 'Cocina',
          },
        ])
        .mockResolvedValueOnce(undefined); // UPDATE cantidad_enviada

      const result = await service.reclamarComanda(TENANT, CUENTA);

      expect(result.estaciones).toHaveLength(1);
      expect(result.estaciones[0].items[0].cantidad).toBe('2');
      expect(manager.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('FOR UPDATE OF cl'),
        [CUENTA, TENANT],
      );
      // El de `previewComanda` afirma sobre el string compartido; este afirma
      // sobre el sitio que REALMENTE reclama y avanza `cantidad_enviada`, que
      // concatena su propio SQL. Sin esta línea, inyectar el filtro solo acá
      // deja la suite entera en verde y el plato no llega a cocina.
      const sqlClaim = manager.query.mock.calls[0][0] as string;
      expect(sqlClaim).not.toMatch(/i\.eliminado_el\s+IS\s+NULL/i);
      expect(manager.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('SET cantidad_enviada'),
        ['3', 'linea-1', TENANT],
      );
    });

    it('segundo claim sobre la misma cuenta sin pendientes: estaciones vacías', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
      });
      manager.query.mockResolvedValueOnce([
        {
          cuenta_linea_id: 'linea-1',
          cantidad: '3',
          cantidad_enviada: '3',
          nombre: 'Lomo',
          impresora_id: 'impresora-cocina',
          impresora_nombre: 'Cocina',
        },
      ]);

      const result = await service.reclamarComanda(TENANT, CUENTA);

      expect(result.estaciones).toEqual([]);
      expect(manager.query).toHaveBeenCalledTimes(1); // solo SELECT, sin UPDATE
    });
  });

  describe('transferirCuentaPorPin', () => {
    it('delega en CuentaAsignacionesService y devuelve CuentaDetalle con responsable', async () => {
      const cuentaTransferida = {
        id: CUENTA,
        tenantId: TENANT,
        numero: 1,
        nombre: null,
        estado: EstadoCuenta.ABIERTA,
        mesaId: MESA,
        ventaId: null,
        garzonAperturaId: GARZON,
        garzonResponsableId: 'garzon-nuevo',
        garzonCierreId: null,
      };
      asignaciones.transferirPorPin.mockResolvedValue(cuentaTransferida);
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM cuenta_lineas')) return Promise.resolve([]);
        if (sql.includes('FROM garzones')) {
          return Promise.resolve([
            { garzon_id: GARZON, nombre: 'Ana Torres' },
            { garzon_id: 'garzon-nuevo', nombre: 'Pedro López' },
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await service.transferirCuentaPorPin(
        TENANT,
        USUARIO_ACTOR,
        CUENTA,
        { garzonId: GARZON, pin: PIN },
      );

      expect(asignaciones.transferirPorPin).toHaveBeenCalledWith(
        TENANT,
        USUARIO_ACTOR,
        CUENTA,
        expect.objectContaining({ garzonId: GARZON, pin: PIN }),
      );
      expect(result.garzonResponsableId).toBe('garzon-nuevo');
      expect(result.garzonResponsableNombre).toBe('Pedro López');
    });
  });

  describe('transferirCuentaAdmin', () => {
    it('delega en CuentaAsignacionesService y devuelve CuentaDetalle con responsable', async () => {
      const cuentaTransferida = {
        id: CUENTA,
        tenantId: TENANT,
        numero: 2,
        nombre: 'Mesa VIP',
        estado: EstadoCuenta.ABIERTA,
        mesaId: MESA,
        ventaId: null,
        garzonAperturaId: GARZON,
        garzonResponsableId: 'garzon-admin',
        garzonCierreId: null,
      };
      asignaciones.transferirAdmin.mockResolvedValue(cuentaTransferida);
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM cuenta_lineas')) return Promise.resolve([]);
        if (sql.includes('FROM garzones')) {
          return Promise.resolve([
            { garzon_id: GARZON, nombre: 'Ana Torres' },
            { garzon_id: 'garzon-admin', nombre: 'Carlos Ruiz' },
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await service.transferirCuentaAdmin(
        TENANT,
        USUARIO,
        CUENTA,
        'garzon-admin',
      );

      expect(asignaciones.transferirAdmin).toHaveBeenCalledWith(
        TENANT,
        USUARIO,
        CUENTA,
        'garzon-admin',
      );
      expect(result.garzonResponsableId).toBe('garzon-admin');
      expect(result.garzonResponsableNombre).toBe('Carlos Ruiz');
    });
  });

  describe('listarAsignacionesCuenta', () => {
    it('delega en CuentaAsignacionesService.listar', async () => {
      const historial = [
        {
          id: 'asig-1',
          garzonId: GARZON,
          garzonNombre: 'Ana Torres',
          desdeEl: new Date('2026-07-16T10:00:00Z'),
          hastaEl: null,
          motivo: 'apertura',
          origenGarzonId: null,
          origenGarzonNombre: null,
          actorUsuarioId: null,
          actorUsuarioNombre: null,
        },
      ];
      cuentaRepo.findOne.mockResolvedValue({ id: CUENTA, tenantId: TENANT });
      asignaciones.listar.mockResolvedValue(historial);

      const result = await service.listarAsignacionesCuenta(TENANT, CUENTA);

      expect(cuentaRepo.findOne).toHaveBeenCalledWith({
        where: { id: CUENTA, tenantId: TENANT },
      });
      expect(asignaciones.listar).toHaveBeenCalledWith(TENANT, CUENTA);
      expect(result).toEqual(historial);
    });

    it('lanza NotFound si la cuenta no existe o pertenece a otro tenant', async () => {
      cuentaRepo.findOne.mockResolvedValue(null);

      await expect(
        service.listarAsignacionesCuenta(TENANT, CUENTA),
      ).rejects.toThrow(NotFoundException);
      expect(asignaciones.listar).not.toHaveBeenCalled();
    });
  });

  describe('confirmarComanda', () => {
    it('marca cantidad_enviada solo para las líneas impresas', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
      });

      await service.confirmarComanda(TENANT, CUENTA, {
        lineas: [{ cuentaLineaId: 'linea-1', cantidadEnviada: '3' }],
      });

      expect(manager.update).toHaveBeenCalledWith(
        CuentaLinea,
        { id: 'linea-1', tenantId: TENANT },
        { cantidadEnviada: '3' },
      );
    });

    it('lanza BadRequest si la cuenta no está abierta', async () => {
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.CERRADA,
      });
      await expect(
        service.confirmarComanda(TENANT, CUENTA, { lineas: [] }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
