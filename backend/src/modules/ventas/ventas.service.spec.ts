import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { Test, type TestingModule } from '@nestjs/testing';
import { Db } from '../../common/db/db.service';
import { VentasService } from './ventas.service';
import { CalculoPreciosService } from '../calculo-precios/calculo-precios.service';
import type { ConfigCalculo } from '../calculo-precios/calculo-precios.engine';
import { CajaService } from '../caja/caja.service';
import { InventarioService } from '../inventario/inventario.service';
import { ItemsService } from '../items/items.service';
import { PagosService } from '../pagos/pagos.service';
import { VentaPropinaService } from '../propinas/venta-propina.service';
import { CatalogService } from '../catalog/catalog.service';
import { GarzonesService } from '../garzones/garzones.service';
import { EstadoVenta, Venta } from './entities/venta.entity';
import { VentaDetalle } from './entities/venta-detalle.entity';
import { VentaDescuento } from './entities/venta-descuento.entity';
import { VentaRecargo } from './entities/venta-recargo.entity';
import { VentaImpuesto } from './entities/venta-impuesto.entity';
import { TIPO_DOCUMENTO_NC_ID } from './entities/tipo-documento-tributario.entity';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const USUARIO_ID = '550e8400-e29b-41d4-a716-446655440056';
const CAJA_ID = 'caja-uuid-001';
const MONEDA_OFICIAL_ID = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const ITEM_ID = '550e8400-e29b-41d4-a716-446655440116';

const mockCajaActiva = {
  id: CAJA_ID,
  tenantId: TENANT_ID,
  tipo: 'fisica',
  estado: 'abierta',
};

const CAJA_VIRTUAL_ID = 'caja-uuid-virtual-001';
const mockCajaVirtual = {
  id: CAJA_VIRTUAL_ID,
  tenantId: TENANT_ID,
  tipo: 'virtual',
  estado: 'abierta',
};

const mockItem = {
  id: ITEM_ID,
  nombre: 'Smartphone',
  tipo: 'producto',
  precioBase: '100.0000',
  precioIncluyeImpuesto: false,
  monedaId: MONEDA_OFICIAL_ID,
  modoInventario: 'cantidad',
  unidadMedida: 'kg',
  impuestosIds: [],
  descuentosIds: [],
  recargosIds: [],
  clasificacionTributaria: 'afecto',
};

const UNIDADES_CATALOGO = [
  { codigo: 'g', magnitud: 'masa', factorBase: '1' },
  { codigo: 'kg', magnitud: 'masa', factorBase: '1000' },
  { codigo: 'unidad', magnitud: 'conteo', factorBase: '1' },
];

/**
 * La config del tenant. Una sola fixture porque la venta la usa dos veces —para
 * convertir a moneda oficial y para calcular— y si las dos copias derivaran, el
 * test estaría probando un escenario que no existe.
 */
const mockConfigCalculo: ConfigCalculo = {
  formula: ['descuentos', 'recargos', 'impuestos'],
  calculoDescuentos: 'base',
  calculoRecargos: 'base',
  escalaCalculo: 4,
  modoRedondeo: 'HALF_UP',
  nivelRedondeo: 'linea',
  // 4 = el máximo que admite el sistema (UF); el motor todavía no cuantiza
  // con este valor (Task 5).
  decimalesMoneda: 4,
};

const mockResultadoVenta = {
  lineas: [
    {
      itemId: ITEM_ID,
      cantidad: '1',
      precioUnitario: '100.0000',
      subtotalNeto: '100.0000',
      descuentoAplicado: '0.0000',
      recargoAplicado: '0.0000',
      ajusteVenta: '0',
      impuestoAplicado: '0.0000',
      totalLinea: '100.0000',
      trazas: { descuentos: [], recargos: [], impuestos: [] },
      advertencias: [],
    },
  ],
  totales: {
    subtotalNeto: '100.0000',
    totalDescuentos: '0.0000',
    totalRecargos: '0.0000',
    totalImpuestos: '0.0000',
    totalFinal: '100.0000',
  },
  trazasVenta: { descuentos: [], recargos: [] },
  advertencias: [],
  advertenciasVenta: [],
  config: mockConfigCalculo,
};

const MONEDA_ROWS = [
  // Una moneda NO oficial primero, a propósito: el service tiene que elegir por
  // `es_oficial` y no por posición ni por "la primera habilitada". Con una sola
  // fila el fixture no distinguía entre elegir bien y elegir cualquiera.
  {
    moneda_id: 'moneda-extranjera',
    valor_del_dia: '950.000000',
    es_oficial: false,
    decimales: 2,
  },
  {
    moneda_id: MONEDA_OFICIAL_ID,
    valor_del_dia: '1.000000',
    es_oficial: true,
    // 4 = el máximo que admite el sistema (UF); el motor todavía no cuantiza
    // con este valor (Task 5).
    decimales: 4,
  },
];

function buildManagerMock() {
  const venta = { id: 'venta-uuid-001' };
  // Cada detalle recibe un id DISTINTO por posición: con un id compartido, un
  // bug que atribuyera todas las reglas a la misma línea sería invisible.
  const idDetalle = (i: number) => `detalle-uuid-00${i + 1}`;
  return {
    create: jest
      .fn()
      .mockImplementation(
        (_entity: unknown, data: Record<string, unknown>) => ({ ...data }),
      ),
    // `save` acepta una fila o un array (detalles y reglas se escriben en
    // batch): devuelve lo mismo que recibió, para que el llamador pueda cruzar
    // `detalles[i]` con su línea.
    save: jest
      .fn()
      .mockImplementation(
        (
          _entity: unknown,
          data: Record<string, unknown> | Record<string, unknown>[],
        ): Promise<unknown> => {
          const guardar = (fila: Record<string, unknown>, i: number) => {
            if (fila['totalFinal'] !== undefined) return { ...venta, ...fila };
            if (fila['ventaId'] !== undefined && fila['cantidad'] !== undefined)
              return { id: idDetalle(i), ...fila };
            return { ...fila };
          };
          return Promise.resolve(
            Array.isArray(data) ? data.map(guardar) : guardar(data, 0),
          );
        },
      ),
    query: jest.fn().mockResolvedValue([]),
    // Sin config de propinas -> ambos canales habilitados por default (?? true).
    findOne: jest.fn().mockResolvedValue(null),
  };
}

/**
 * `ItemsService.cargarBasePorIds` devuelve un Map id→item. Este helper conserva
 * la intención de los tests que antes mockeaban `findOne`: cualquier id pedido
 * resuelve al mismo ítem.
 */
function mapaDe(item: unknown) {
  // `as never` a propósito: los tests pasan ítems parciales, y un Map<string,
  // never> es asignable al Map tipado que declara `cargarBasePorIds`.
  return (_tenantId: string, ids: string[]) =>
    Promise.resolve(new Map(ids.map((id) => [id, item as never])));
}

describe('VentasService', () => {
  let service: VentasService;
  let cajaService: jest.Mocked<CajaService>;
  let calculoPreciosService: jest.Mocked<CalculoPreciosService>;
  let inventarioService: jest.Mocked<InventarioService>;
  let itemsService: jest.Mocked<ItemsService>;
  let pagosServiceMock: { registrar: jest.Mock };
  let ventaPropinaServiceMock: { crearEnTransaccion: jest.Mock };
  let garzonesServiceMock: {
    asegurarMostrador: jest.Mock;
    obtenerActivoPorId: jest.Mock;
  };
  let catalogService: jest.Mocked<CatalogService>;
  let dataSourceMock: { transaction: jest.Mock; query: jest.Mock };

  beforeEach(async () => {
    const manager = buildManagerMock();
    pagosServiceMock = {
      registrar: jest
        .fn()
        .mockResolvedValue({ pagos: [], montoAplicadoVenta: '0.0000' }),
    };
    ventaPropinaServiceMock = {
      crearEnTransaccion: jest.fn().mockResolvedValue({
        id: 'venta-propina-1',
      }),
    };
    garzonesServiceMock = {
      asegurarMostrador: jest.fn().mockResolvedValue({ id: 'mostrador-1' }),
      obtenerActivoPorId: jest.fn().mockResolvedValue({ id: 'garzon-1' }),
    };
    dataSourceMock = {
      transaction: jest
        .fn()
        .mockImplementation((cb: (m: typeof manager) => unknown) =>
          cb(manager),
        ),
      // `db.query` para las filas de moneda. Ojo: el nombre `dataSourceMock`
      // es histórico — el service inyecta `Db`, y `db.query` resuelve el
      // manager de la transacción si hay una en contexto (ADR-020).
      query: jest.fn().mockResolvedValue(MONEDA_ROWS),
    };
    const dbMock = {
      transaccion: dataSourceMock.transaction,
      query: dataSourceMock.query,
      sinTransaccion: (fn: () => unknown) => fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VentasService,
        {
          provide: CalculoPreciosService,
          useValue: {
            calcular: jest.fn().mockResolvedValue(mockResultadoVenta),
            cargarConfig: jest.fn().mockResolvedValue(mockConfigCalculo),
            // Hace la multiplicación de verdad —no devuelve un fijo— porque
            // varios tests de acá afirman sobre precios convertidos y un stub los
            // dejaría pasar con cualquier número. Ignora el modo a propósito: el
            // efecto del modo sobre el número está probado en el spec del propio
            // `CalculoPreciosService`; lo que le toca probar a ventas es que se lo
            // **pasa**, y eso se afirma sobre la llamada, no sobre el resultado.
            convertirAMonedaOficial: jest.fn(
              (
                precio: string,
                monedaId: string,
                tasaMap: Map<string, string>,
              ) =>
                new Decimal(precio)
                  .times(new Decimal(tasaMap.get(monedaId) ?? '1'))
                  .toFixed(4),
            ),
          },
        },
        {
          provide: CajaService,
          useValue: {
            findActiva: jest.fn().mockResolvedValue(mockCajaActiva),
            findVirtual: jest.fn().mockResolvedValue(mockCajaVirtual),
            calcularEsperadoEfectivo: jest.fn().mockResolvedValue('50000.0000'),
            bloquearCajaAbierta: jest.fn().mockResolvedValue(undefined),
            registrarMovimientoEnTransaccion: jest
              .fn()
              .mockResolvedValue({ id: 'mov-caja-nc-1' }),
          },
        },
        {
          provide: InventarioService,
          useValue: {
            registrarMovimiento: jest.fn().mockResolvedValue({
              movimientoId: 'mov-1',
              stockAnterior: '10',
              stockResultante: '9',
            }),
          },
        },
        {
          provide: ItemsService,
          useValue: {
            findOne: jest.fn().mockResolvedValue(mockItem),
            cargarBasePorIds: jest.fn().mockImplementation(mapaDe(mockItem)),
            resolverPersonalizacionReceta: jest.fn(),
            resolverPersonalizacionCombo: jest.fn(),
            venderIngredientesReceta: jest.fn().mockResolvedValue([]),
            venderComponentesCombo: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: PagosService,
          useValue: pagosServiceMock,
        },
        {
          provide: VentaPropinaService,
          useValue: ventaPropinaServiceMock,
        },
        {
          provide: CatalogService,
          useValue: {
            findAllUnidadesMedida: jest
              .fn()
              .mockResolvedValue(UNIDADES_CATALOGO),
            // Conversor con el catálogo ya cargado, compartido por las líneas
            // del carrito. La venta no lo invoca: solo lo crea y lo baja a
            // items.service, que es quien convierte.
            crearConversor: jest.fn().mockResolvedValue(jest.fn()),
          },
        },
        {
          provide: GarzonesService,
          useValue: garzonesServiceMock,
        },
        {
          provide: Db,
          useValue: dbMock,
        },
      ],
    }).compile();

    service = module.get<VentasService>(VentasService);
    cajaService = module.get(CajaService);
    calculoPreciosService = module.get(CalculoPreciosService);
    inventarioService = module.get(InventarioService);
    itemsService = module.get(ItemsService);
    catalogService = module.get(CatalogService);
  });

  const basePago = { metodoPagoId: EFECTIVO_ID, monto: '100.0000' };
  const baseDto = {
    lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
    pagos: [basePago],
  };

  describe('crear()', () => {
    // El modo de redondeo del tenant tiene que llegar hasta el precio que se
    // PERSISTE, no solo hasta el que se previsualiza. Hasta el 2026-08-11 esta
    // conversión era un `.toFixed(4)` propio de ventas —HALF_UP fijo—, así que un
    // tenant en 'FLOOR' veía un precio en el POS y la venta guardaba otro.
    it('convierte el precio que persiste con el modo de redondeo del tenant', async () => {
      calculoPreciosService.cargarConfig.mockResolvedValueOnce({
        ...mockConfigCalculo,
        modoRedondeo: 'FLOOR',
      });

      await service.crear(TENANT_ID, USUARIO_ID, baseDto);

      expect(
        calculoPreciosService.convertirAMonedaOficial,
      ).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(Map),
        'FLOOR',
      );
    });

    it('lanza BadRequestException si no hay caja abierta', async () => {
      cajaService.findActiva.mockResolvedValueOnce(null);
      await expect(
        service.crear(TENANT_ID, USUARIO_ID, baseDto as any),
      ).rejects.toThrow(new BadRequestException('No tienes una caja abierta'));
    });

    it('crea venta en estado pagada cuando monto cubre el total', async () => {
      pagosServiceMock.registrar.mockResolvedValueOnce({
        pagos: [{ id: 'pago-uuid-001', monto: '100.0000', vuelto: '0.0000' }],
        montoAplicadoVenta: '100.0000',
      });
      const result = await service.crear(TENANT_ID, USUARIO_ID, baseDto);
      expect(result).toBeDefined();

      expect(calculoPreciosService.calcular).toHaveBeenCalled();
      expect(dataSourceMock.transaction).toHaveBeenCalled();
      expect(result.estado).toBe(EstadoVenta.PAGADA);
    });

    it('rechaza la venta si la caja existe pero está en conciliación', async () => {
      // `!caja` y `caja.estado !== 'abierta'` son dos condiciones distintas con
      // mensajes distintos, y solo la primera tenía cobertura: los mocks de caja
      // nacían siempre 'abierta'. Borrar el segundo `if` no rompía ningún test.
      cajaService.findActiva.mockResolvedValueOnce({
        ...mockCajaActiva,
        estado: 'en_conciliacion',
      } as never);

      await expect(
        service.crear(TENANT_ID, USUARIO_ID, baseDto),
      ).rejects.toThrow('La caja está en conciliación y no admite ventas');

      // Corta antes de tocar nada: ni lock, ni ítems, ni transacción de escritura.
      expect(cajaService.bloquearCajaAbierta).not.toHaveBeenCalled();
      expect(itemsService.cargarBasePorIds).not.toHaveBeenCalled();
    });

    it('resuelve TODO el carrito en una sola llamada, no una por línea', async () => {
      // Guarda contra la regresión al N+1: `findOne` por línea disparaba 4+
      // queries por ítem para construir colecciones que la venta ni lee.
      const dtoTresLineas = {
        ...baseDto,
        lineas: [
          { itemId: 'item-a', cantidad: '1' },
          { itemId: 'item-b', cantidad: '2' },
          { itemId: 'item-c', cantidad: '1' },
        ],
      };
      calculoPreciosService.calcular.mockResolvedValueOnce({
        ...mockResultadoVenta,
        lineas: dtoTresLineas.lineas.map((l) => ({
          ...mockResultadoVenta.lineas[0],
          itemId: l.itemId,
        })),
      });

      await service.crear(TENANT_ID, USUARIO_ID, dtoTresLineas);

      expect(itemsService.cargarBasePorIds).toHaveBeenCalledTimes(1);
      expect(itemsService.cargarBasePorIds).toHaveBeenCalledWith(TENANT_ID, [
        'item-a',
        'item-b',
        'item-c',
      ]);
      expect(itemsService.findOne).not.toHaveBeenCalled();
    });

    it('bloquea las líneas por itemId ascendente, no en el orden del carrito', async () => {
      // El fix hermano del reintento de deadlock, puesto el 2026-07-23 y que
      // hasta hoy no tenía NINGÚN test: `registrarMovimiento` toma FOR UPDATE
      // por línea, así que sin el orden fijo lo decide el cliente y dos ventas
      // con los mismos productos en orden inverso se bloquean en cruz.
      const dtoInvertido = {
        ...baseDto,
        lineas: [
          { itemId: 'zzz-item', cantidad: '1' },
          { itemId: 'aaa-item', cantidad: '1' },
        ],
      };
      itemsService.cargarBasePorIds.mockImplementationOnce(
        (_tenantId: string, ids: string[]) =>
          Promise.resolve(
            new Map(ids.map((id) => [id, { ...mockItem, id } as never])),
          ),
      );
      calculoPreciosService.calcular.mockResolvedValueOnce({
        ...mockResultadoVenta,
        lineas: dtoInvertido.lineas.map((l) => ({
          ...mockResultadoVenta.lineas[0],
          itemId: l.itemId,
        })),
      });

      await service.crear(TENANT_ID, USUARIO_ID, dtoInvertido);

      expect(
        inventarioService.registrarMovimiento.mock.calls.map(
          (c) => (c[1] as { itemId: string }).itemId,
        ),
      ).toEqual(['aaa-item', 'zzz-item']);
    });

    describe('reintento ante deadlock (40P01)', () => {
      // Los FOR UPDATE de inventario se toman en un orden que depende de la
      // expansión de cada línea, y el orden global de una venta no es
      // ascendente aunque cada expansión ordene por id. Postgres aborta una de
      // las dos ventas cruzadas; reintentar es seguro porque el deadlock
      // revierte la transacción ENTERA (no queda venta, ni movimientos, ni
      // pagos a medio hacer).
      const deadlock = Object.assign(new Error('deadlock detected'), {
        code: '40P01',
      });

      it('reintenta y devuelve el resultado del segundo intento', async () => {
        dataSourceMock.transaction
          .mockRejectedValueOnce(deadlock)
          .mockImplementationOnce((cb: (m: unknown) => unknown) =>
            cb(buildManagerMock()),
          );

        const result = await service.crear(TENANT_ID, USUARIO_ID, baseDto);

        expect(result).toBeDefined();
        expect(dataSourceMock.transaction).toHaveBeenCalledTimes(2);
      });

      it('el error del driver también llega envuelto en `driverError`', async () => {
        // TypeORM envuelve en QueryFailedError: según dónde se lance, el code
        // viene arriba o adentro. Mirar solo una de las dos formas es no
        // reintentar nunca, y el bug sería invisible (la venta falla igual que
        // antes del fix).
        dataSourceMock.transaction
          .mockRejectedValueOnce({ driverError: { code: '40P01' } })
          .mockImplementationOnce((cb: (m: unknown) => unknown) =>
            cb(buildManagerMock()),
          );

        await expect(
          service.crear(TENANT_ID, USUARIO_ID, baseDto),
        ).resolves.toBeDefined();
        expect(dataSourceMock.transaction).toHaveBeenCalledTimes(2);
      });

      it('NO reintenta un error que no es deadlock', async () => {
        // Reintentar un fallo de negocio lo convertiría en tres intentos
        // silenciosos: triple descuento de stock si alguno llegara a commitear.
        dataSourceMock.transaction.mockRejectedValueOnce(
          new BadRequestException('Stock insuficiente para la salida'),
        );

        await expect(
          service.crear(TENANT_ID, USUARIO_ID, baseDto),
        ).rejects.toThrow('Stock insuficiente para la salida');
        expect(dataSourceMock.transaction).toHaveBeenCalledTimes(1);
      });

      it('se rinde tras los reintentos y propaga el deadlock', async () => {
        dataSourceMock.transaction.mockRejectedValue(deadlock);

        await expect(
          service.crear(TENANT_ID, USUARIO_ID, baseDto),
        ).rejects.toThrow('deadlock detected');
        // 1 intento + 2 reintentos: el cajero recibe el error, no un cuelgue.
        expect(dataSourceMock.transaction).toHaveBeenCalledTimes(3);
      });
    });

    it('carga el catálogo de unidades UNA vez para todo el carrito, no una por línea', async () => {
      // Adentro de una línea el catálogo ya se leía una sola vez (el conversor
      // baja por el árbol de expansión); lo que faltaba era compartirlo ENTRE
      // líneas. Un pedido de dos platos distintos lo leía dos veces.
      const dtoDosRecetas = {
        ...baseDto,
        lineas: [
          { itemId: 'receta-a', cantidad: '1' },
          { itemId: 'receta-b', cantidad: '1' },
        ],
      };
      itemsService.cargarBasePorIds.mockImplementationOnce(
        mapaDe({ ...mockItem, tipo: 'receta' }),
      );
      calculoPreciosService.calcular.mockResolvedValueOnce({
        ...mockResultadoVenta,
        lineas: dtoDosRecetas.lineas.map((l) => ({
          ...mockResultadoVenta.lineas[0],
          itemId: l.itemId,
        })),
      });

      await service.crear(TENANT_ID, USUARIO_ID, dtoDosRecetas);

      expect(catalogService.crearConversor).toHaveBeenCalledTimes(1);
      // Y es el MISMO conversor el que reciben las dos líneas: contar las
      // cargas sin esto dejaría pasar un segundo conversor creado en otro lado.
      const conversor =
        await catalogService.crearConversor.mock.results[0].value;
      const recibidos = (
        itemsService.venderIngredientesReceta as jest.Mock
      ).mock.calls.map((c) => (c[1] as { convertir: unknown }).convertir);
      expect(recibidos).toEqual([conversor, conversor]);
    });

    it('carrito mixto: la receta y el combo comparten el mismo conversor', async () => {
      // Las dos ramas del `if/else` leen la misma variable, así que compartir
      // entre tipos distintos sale gratis — pero eso es una propiedad del
      // código, no algo que los otros dos tests (dos líneas del MISMO tipo)
      // ejerzan. Acá se afirma.
      const dtoMixto = {
        ...baseDto,
        lineas: [
          { itemId: 'receta-a', cantidad: '1' },
          { itemId: 'combo-b', cantidad: '1' },
        ],
      };
      itemsService.cargarBasePorIds.mockImplementationOnce(
        (_tenantId: string, ids: string[]) =>
          Promise.resolve(
            new Map(
              ids.map((id) => [
                id,
                {
                  ...mockItem,
                  id,
                  tipo: id.startsWith('receta') ? 'receta' : 'combo',
                } as never,
              ]),
            ),
          ),
      );
      calculoPreciosService.calcular.mockResolvedValueOnce({
        ...mockResultadoVenta,
        lineas: dtoMixto.lineas.map((l) => ({
          ...mockResultadoVenta.lineas[0],
          itemId: l.itemId,
        })),
      });

      await service.crear(TENANT_ID, USUARIO_ID, dtoMixto);

      expect(catalogService.crearConversor).toHaveBeenCalledTimes(1);
      const conversor =
        await catalogService.crearConversor.mock.results[0].value;
      const recetaArgs = (itemsService.venderIngredientesReceta as jest.Mock)
        .mock.calls[0][1] as { convertir: unknown };
      const comboArgs = (itemsService.venderComponentesCombo as jest.Mock).mock
        .calls[0][1] as { convertir: unknown };
      expect(recetaArgs.convertir).toBe(conversor);
      expect(comboArgs.convertir).toBe(conversor);
    });

    it('un carrito de puros productos no carga el catálogo de unidades', async () => {
      // La carga es perezosa: la paga la primera línea que expanda una receta o
      // un combo. Sin esto, la venta más común del POS pagaría una query que no
      // usa — es el intercambio que este batch tenía que evitar.
      await service.crear(TENANT_ID, USUARIO_ID, baseDto);

      expect(catalogService.crearConversor).not.toHaveBeenCalled();
    });

    it('bloquea la caja física dentro de la transacción antes de escribir', async () => {
      // `findActiva` lee por repositorio, fuera del manager transaccional: sin el
      // lock, un cierre concurrente puede commitear mientras se procesa la venta
      // y el movimiento de caja del final cae en una caja ya cerrada.
      pagosServiceMock.registrar.mockResolvedValueOnce({
        pagos: [{ id: 'pago-uuid-001', monto: '100.0000', vuelto: '0.0000' }],
        montoAplicadoVenta: '100.0000',
      });
      await service.crear(TENANT_ID, USUARIO_ID, baseDto);

      expect(cajaService.bloquearCajaAbierta).toHaveBeenCalledWith(
        expect.anything(),
        CAJA_ID,
        TENANT_ID,
      );
    });

    it('congela bases de venta al crear', async () => {
      calculoPreciosService.calcular.mockResolvedValueOnce({
        ...mockResultadoVenta,
        totales: {
          subtotalNeto: '10000.0000',
          totalDescuentos: '0.0000',
          totalRecargos: '0.0000',
          totalImpuestos: '1900.0000',
          totalFinal: '11900.0000',
        },
      });
      const manager = buildManagerMock();
      dataSourceMock.transaction.mockImplementationOnce(
        (cb: (m: typeof manager) => unknown) => cb(manager),
      );

      await service.crear(TENANT_ID, USUARIO_ID, baseDto);

      const ventaCreate = manager.create.mock.calls.find(
        (call) => call[0] === Venta,
      );
      expect(ventaCreate?.[1]).toEqual(
        expect.objectContaining({
          totalFinal: '11900.0000',
          baseVentasTotalFinal: '11900.0000',
          baseVentasSinImpuestos: '10000.0000',
        }),
      );
    });

    it('persiste los recargos aplicados: el de línea y el de venta, cada uno con su aplicadoEn', async () => {
      // Los fixtures de esta suite traen `trazas.recargos: []` y
      // `trazasVenta.recargos: []`, así que los dos loops de persistencia de
      // recargos (7c y 7d) no los ejercía ningún unit: borrarlos enteros no
      // rompía nada acá. El e2e sí los cubre de punta a punta.
      calculoPreciosService.calcular.mockResolvedValueOnce({
        ...mockResultadoVenta,
        lineas: [
          {
            ...mockResultadoVenta.lineas[0],
            recargoAplicado: '5.0000',
            ajusteVenta: '0',
            totalLinea: '105.0000',
            trazas: {
              descuentos: [],
              recargos: [
                {
                  id: 'recargo-linea-001',
                  nombre: 'Servicio',
                  monto: '5.0000',
                  modo: 'monto_fijo' as const,
                  valorEfectivo: '5',
                  valorSolicitado: '5.0000',
                },
              ],
              impuestos: [],
            },
          },
        ],
        totales: {
          subtotalNeto: '100.0000',
          totalDescuentos: '0.0000',
          totalRecargos: '8.0000',
          totalImpuestos: '0.0000',
          totalFinal: '108.0000',
        },
        trazasVenta: {
          descuentos: [],
          recargos: [
            {
              id: 'recargo-venta-001',
              nombre: 'Delivery',
              monto: '3.0000',
              modo: 'monto_fijo' as const,
              valorEfectivo: '3',
              valorSolicitado: '3.0000',
            },
          ],
        },
      });
      const manager = buildManagerMock();
      dataSourceMock.transaction.mockImplementationOnce(
        (cb: (m: typeof manager) => unknown) => cb(manager),
      );

      await service.crear(TENANT_ID, USUARIO_ID, baseDto);

      const recargos = manager.create.mock.calls
        .filter((call) => call[0] === VentaRecargo)
        .map((call) => call[1]);
      expect(recargos).toEqual([
        expect.objectContaining({
          ventaId: 'venta-uuid-001',
          recargoId: 'recargo-linea-001',
          valorAplicado: '5.0000',
          aplicadoEn: 'detalle',
        }),
        expect.objectContaining({
          ventaId: 'venta-uuid-001',
          recargoId: 'recargo-venta-001',
          valorAplicado: '3.0000',
          aplicadoEn: 'venta',
        }),
      ]);
    });

    it('escribe las reglas en un batch por familia sin perder ni mover ninguna fila', async () => {
      // Antes eran N `save` en serie, uno por traza. Este test fija las filas
      // resultantes —cuántas, con qué monto y atribuidas a qué— para que
      // batchearlas no pueda tragarse una en silencio.
      const traza = (id: string, monto: string) => ({
        id,
        nombre: id,
        monto,
        modo: 'monto_fijo' as const,
        valorEfectivo: monto,
        valorSolicitado: monto,
      });
      const lineaCon = (sufijo: string) => ({
        ...mockResultadoVenta.lineas[0],
        trazas: {
          descuentos: [traza(`desc-${sufijo}`, '1.0000')],
          recargos: [traza(`rec-${sufijo}`, '2.0000')],
          impuestos: [{ ...traza(`imp-${sufijo}`, '3.0000'), tasa: '0.19' }],
        },
      });
      calculoPreciosService.calcular.mockResolvedValueOnce({
        ...mockResultadoVenta,
        lineas: [lineaCon('a'), lineaCon('b')],
        trazasVenta: {
          descuentos: [traza('desc-venta', '9.0000')],
          recargos: [traza('rec-venta', '8.0000')],
        },
      });
      const manager = buildManagerMock();
      dataSourceMock.transaction.mockImplementationOnce(
        (cb: (m: typeof manager) => unknown) => cb(manager),
      );

      await service.crear(TENANT_ID, USUARIO_ID, {
        ...baseDto,
        lineas: [
          { itemId: ITEM_ID, cantidad: '1' },
          { itemId: ITEM_ID, cantidad: '1' },
        ],
      });

      const savesDe = (entidad: unknown) =>
        manager.save.mock.calls.filter((call) => call[0] === entidad);

      // Un solo round-trip por familia, con TODAS sus filas adentro.
      for (const entidad of [VentaDescuento, VentaRecargo, VentaImpuesto]) {
        expect(savesDe(entidad)).toHaveLength(1);
      }
      expect(savesDe(VentaDetalle)).toHaveLength(1);

      // Las filas: las de las dos líneas y después las de venta.
      expect(savesDe(VentaDescuento)[0][1]).toEqual([
        expect.objectContaining({
          descuentoId: 'desc-a',
          valorAplicado: '1.0000',
          aplicadoEn: 'detalle',
        }),
        expect.objectContaining({
          descuentoId: 'desc-b',
          valorAplicado: '1.0000',
          aplicadoEn: 'detalle',
        }),
        expect.objectContaining({
          descuentoId: 'desc-venta',
          valorAplicado: '9.0000',
          aplicadoEn: 'venta',
        }),
      ]);
      expect(savesDe(VentaRecargo)[0][1]).toEqual([
        expect.objectContaining({ recargoId: 'rec-a', aplicadoEn: 'detalle' }),
        expect.objectContaining({ recargoId: 'rec-b', aplicadoEn: 'detalle' }),
        expect.objectContaining({
          recargoId: 'rec-venta',
          valorAplicado: '8.0000',
          aplicadoEn: 'venta',
        }),
      ]);
      // Los impuestos no tienen nivel venta: solo las dos filas de línea.
      expect(savesDe(VentaImpuesto)[0][1]).toEqual([
        expect.objectContaining({
          impuestoId: 'imp-a',
          porcentajeAplicado: '0.19',
        }),
        expect.objectContaining({
          impuestoId: 'imp-b',
          porcentajeAplicado: '0.19',
        }),
      ]);
    });

    it('congela la regla y la atribuye a SU línea, no a la primera', async () => {
      // La misma regla en dos líneas producía dos filas indistinguibles.
      const traza = (over: Record<string, unknown> = {}) => ({
        id: 'desc-001',
        nombre: 'Promo socio',
        monto: '10.0000',
        modo: 'porcentaje' as const,
        valorEfectivo: '0.10',
        valorSolicitado: '10.0000',
        ...over,
      });
      calculoPreciosService.calcular.mockResolvedValueOnce({
        ...mockResultadoVenta,
        lineas: [
          {
            ...mockResultadoVenta.lineas[0],
            trazas: {
              descuentos: [traza()],
              recargos: [],
              impuestos: [],
            },
          },
          {
            ...mockResultadoVenta.lineas[0],
            trazas: {
              // Monto fijo: `porcentaje_aplicado` tiene que quedar null, no 0.
              descuentos: [
                traza({
                  modo: 'monto_fijo',
                  valorEfectivo: '3',
                  monto: '3.0000',
                  valorSolicitado: '3.0000',
                }),
              ],
              recargos: [],
              impuestos: [],
            },
          },
        ],
      });
      const manager = buildManagerMock();
      dataSourceMock.transaction.mockImplementationOnce(
        (cb: (m: typeof manager) => unknown) => cb(manager),
      );

      await service.crear(TENANT_ID, USUARIO_ID, {
        ...baseDto,
        lineas: [
          { itemId: ITEM_ID, cantidad: '1' },
          { itemId: ITEM_ID, cantidad: '1' },
        ],
      });

      const filas = manager.save.mock.calls.find(
        (call) => call[0] === VentaDescuento,
      )?.[1] as Record<string, unknown>[];

      expect(filas).toEqual([
        expect.objectContaining({
          detalleId: 'detalle-uuid-001',
          nombreRegla: 'Promo socio',
          modo: 'porcentaje',
          porcentajeAplicado: '0.10',
          valorSolicitado: '10.0000',
        }),
        expect.objectContaining({
          // La segunda línea, no la primera: es el bug que este test caza.
          detalleId: 'detalle-uuid-002',
          modo: 'monto_fijo',
          // Null explícito: un 0 se leería después como "valía 0%".
          porcentajeAplicado: null,
        }),
      ]);
    });

    it('congela lo que la regla pedía cuando el piso en cero la recortó', async () => {
      calculoPreciosService.calcular.mockResolvedValueOnce({
        ...mockResultadoVenta,
        lineas: [
          {
            ...mockResultadoVenta.lineas[0],
            trazas: {
              descuentos: [
                {
                  id: 'desc-fijo',
                  nombre: 'Cupón 5000',
                  modo: 'monto_fijo' as const,
                  valorEfectivo: '5000',
                  // Pedía 5000 sobre una línea de 1500: se topeó.
                  monto: '1500.0000',
                  valorSolicitado: '5000.0000',
                },
              ],
              recargos: [],
              impuestos: [],
            },
          },
        ],
      });
      const manager = buildManagerMock();
      dataSourceMock.transaction.mockImplementationOnce(
        (cb: (m: typeof manager) => unknown) => cb(manager),
      );

      await service.crear(TENANT_ID, USUARIO_ID, baseDto);

      const filas = manager.save.mock.calls.find(
        (call) => call[0] === VentaDescuento,
      )?.[1] as Record<string, unknown>[];
      expect(filas[0]).toEqual(
        expect.objectContaining({
          valorAplicado: '1500.0000',
          valorSolicitado: '5000.0000',
        }),
      );
    });

    it('congela la config del cálculo en la cabecera de la venta', async () => {
      const manager = buildManagerMock();
      dataSourceMock.transaction.mockImplementationOnce(
        (cb: (m: typeof manager) => unknown) => cb(manager),
      );

      await service.crear(TENANT_ID, USUARIO_ID, baseDto);

      const ventaCreate = manager.create.mock.calls.find(
        (call) => call[0] === Venta,
      );
      // Sin esto el congelado de las reglas no es interpretable: el mismo 10%
      // da distinto según el orden de la fórmula y según base|cascada.
      expect(ventaCreate?.[1]).toEqual(
        expect.objectContaining({
          configCalculo: expect.objectContaining({
            formula: ['descuentos', 'recargos', 'impuestos'],
            calculoDescuentos: 'base',
            modoRedondeo: 'HALF_UP',
          }),
        }),
      );
    });

    it('no gasta un round-trip por familia cuando la venta no tiene reglas', async () => {
      const manager = buildManagerMock();
      dataSourceMock.transaction.mockImplementationOnce(
        (cb: (m: typeof manager) => unknown) => cb(manager),
      );

      await service.crear(TENANT_ID, USUARIO_ID, baseDto);

      const entidadesGuardadas = manager.save.mock.calls.map((call) => call[0]);
      expect(entidadesGuardadas).not.toContain(VentaDescuento);
      expect(entidadesGuardadas).not.toContain(VentaRecargo);
      expect(entidadesGuardadas).not.toContain(VentaImpuesto);
    });

    it('congela la clasificación tributaria del item en el detalle', async () => {
      itemsService.cargarBasePorIds.mockImplementationOnce(
        mapaDe({
          ...mockItem,
          clasificacionTributaria: 'exento',
        }),
      );
      const manager = buildManagerMock();
      dataSourceMock.transaction.mockImplementationOnce(
        (cb: (m: typeof manager) => unknown) => cb(manager),
      );

      await service.crear(TENANT_ID, USUARIO_ID, baseDto);

      const detalleCreate = manager.create.mock.calls.find(
        (call) => call[0] === VentaDetalle,
      );
      expect(detalleCreate?.[1]).toEqual(
        expect.objectContaining({ clasificacionTributaria: 'exento' }),
      );
    });

    it('llama registrarMovimiento del inventario para items tipo producto', async () => {
      await service.crear(TENANT_ID, USUARIO_ID, baseDto);

      expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tipo: 'salida',
          motivo: 'venta',
          itemId: ITEM_ID,
        }),
      );
    });

    it('persiste presentación y usa canónica para precio/stock', async () => {
      const manager = buildManagerMock();
      dataSourceMock.transaction.mockImplementationOnce(
        (cb: (m: typeof manager) => unknown) => cb(manager),
      );

      calculoPreciosService.calcular.mockImplementationOnce(
        async (_tenantId, calcDto) => ({
          ...mockResultadoVenta,
          lineas: [
            {
              ...mockResultadoVenta.lineas[0],
              cantidad: calcDto.lineas[0].cantidad,
            },
          ],
        }),
      );

      const dtoPresentacion = {
        lineas: [
          {
            itemId: ITEM_ID,
            cantidad: '999',
            cantidadPresentacion: '500',
            unidadCodigoPresentacion: 'g',
          },
        ],
        pagos: [basePago],
      };

      const result = await service.crear(
        TENANT_ID,
        USUARIO_ID,
        dtoPresentacion,
      );

      expect(catalogService.findAllUnidadesMedida).toHaveBeenCalled();
      expect(calculoPreciosService.calcular).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          lineas: [expect.objectContaining({ cantidad: '0.5' })],
        }),
        // Tercer argumento: la config YA cargada. Que viaje es lo que evita que
        // la venta consulte las preferencias del tenant dos veces por venta.
        mockConfigCalculo,
      );
      expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ cantidad: '0.5' }),
      );
      expect(result.detalles[0]).toMatchObject({
        cantidad: '0.5',
        cantidadPresentacion: '500',
        unidadCodigoPresentacion: 'g',
      });
    });

    it('no llama registrarMovimiento del inventario para items tipo servicio', async () => {
      itemsService.cargarBasePorIds.mockImplementationOnce(
        mapaDe({
          ...mockItem,
          tipo: 'servicio',
        }),
      );
      await service.crear(TENANT_ID, USUARIO_ID, baseDto);

      expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
    });

    it('rechaza línea con item tipo ingrediente', async () => {
      itemsService.cargarBasePorIds.mockImplementationOnce(
        mapaDe({
          ...mockItem,
          tipo: 'ingrediente',
        }),
      );
      await expect(
        service.crear(TENANT_ID, USUARIO_ID, baseDto as any),
      ).rejects.toThrow(
        new BadRequestException(
          'Los ingredientes no se pueden vender directamente',
        ),
      );
    });

    // Hoy inalcanzable por API: el único tipo con `clasificacion_tributaria`
    // nullable es 'ingrediente', y el guard de arriba lo rechaza antes. El test
    // fija la conducta para cuando deje de serlo (otro tipo no vendible, o el
    // guard relajado): `venta_detalles.clasificacion_tributaria` es NOT NULL, y
    // rellenarlo con 'afecto' guardaría una línea que dice "afecto" mientras el
    // motor —condición positiva `=== 'afecto'`— ya cobró IVA cero por el NULL.
    it('rechaza línea con item sin clasificación tributaria, en vez de rellenar el snapshot fiscal', async () => {
      itemsService.cargarBasePorIds.mockImplementationOnce(
        mapaDe({
          ...mockItem,
          clasificacionTributaria: null,
        }),
      );

      await expect(
        service.crear(TENANT_ID, USUARIO_ID, baseDto),
      ).rejects.toThrow(
        new BadRequestException(
          'El ítem "Smartphone" no tiene clasificación tributaria: no se puede vender',
        ),
      );
      // Falla antes de calcular y de escribir: el rechazo no debe depender del
      // rollback de la transacción.
      expect(calculoPreciosService.calcular).not.toHaveBeenCalled();
    });

    it('llama a pagosService.registrar con los params correctos cuando hay pagos', async () => {
      // pago de 150 cuando total es 100 → PagosService calcula el vuelto internamente
      const dtoConExcedente = {
        ...baseDto,
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '150.0000' }],
      };
      pagosServiceMock.registrar.mockResolvedValueOnce({
        pagos: [{ id: 'pago-uuid-001', monto: '150.0000', vuelto: '50.0000' }],
        montoAplicadoVenta: '100.0000',
      });
      const result = await service.crear(
        TENANT_ID,
        USUARIO_ID,
        dtoConExcedente,
      );
      expect(pagosServiceMock.registrar).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ target: '100.0000' }),
      );
      expect(result.estado).toBe(EstadoVenta.PAGADA);
    });

    it('con propinaCierreMesa eleva target y crea venta_propina', async () => {
      const dtoConPropina = {
        ...baseDto,
        propinaCierreMesa: {
          montoPagado: '10.0000',
          montoSugerido: '10.0000',
          porcentajeSugerido: '0.10',
          garzonId: '550e8400-e29b-41d4-a716-446655440200',
        },
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '110.0000' }],
      };
      pagosServiceMock.registrar.mockResolvedValueOnce({
        pagos: [{ id: 'pago-uuid-tip', monto: '110.0000', vuelto: '0.0000' }],
        montoAplicadoVenta: '100.0000',
      });

      await service.crear(TENANT_ID, USUARIO_ID, dtoConPropina);

      expect(ventaPropinaServiceMock.crearEnTransaccion).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          montoPagado: '10.0000',
          garzonId: '550e8400-e29b-41d4-a716-446655440200',
          sesionGarzonId: null,
          turnoId: null,
          tipoGarzon: null,
        }),
      );
      expect(pagosServiceMock.registrar).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          target: '110.0000',
          propinaMonto: '10.0000',
          ventaPropinaId: 'venta-propina-1',
        }),
      );
    });

    it('valida que el garzón de propinaCierreMesa sea del tenant antes de persistir', async () => {
      // `garzonId` viene del body: sin validar, la propina se acredita a un
      // garzón de otro tenant y este la cobra en su liquidación.
      garzonesServiceMock.obtenerActivoPorId.mockRejectedValueOnce(
        new BadRequestException('Garzón no encontrado o inactivo'),
      );

      const dtoGarzonAjeno = {
        ...baseDto,
        propinaCierreMesa: {
          montoPagado: '10.0000',
          garzonId: '550e8400-e29b-41d4-a716-446655440332',
        },
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '110.0000' }],
      };

      await expect(
        service.crear(TENANT_ID, USUARIO_ID, dtoGarzonAjeno as any),
      ).rejects.toThrow('Garzón no encontrado o inactivo');

      expect(garzonesServiceMock.obtenerActivoPorId).toHaveBeenCalledWith(
        TENANT_ID,
        '550e8400-e29b-41d4-a716-446655440332',
      );
      expect(ventaPropinaServiceMock.crearEnTransaccion).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException cuando excedente > 0 y ningún método permite vuelto', async () => {
      const dtoConExcedente = {
        ...baseDto,
        pagos: [{ metodoPagoId: 'tarjeta-id', monto: '150.0000' }],
      };
      // PagosService.registrar lanza BadRequestException cuando no hay método con vuelto
      pagosServiceMock.registrar.mockRejectedValueOnce(
        new BadRequestException(
          'El pago supera el total pero ningún método de pago permite vuelto',
        ),
      );
      await expect(
        service.crear(TENANT_ID, USUARIO_ID, dtoConExcedente as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('estampa la moneda del PAÍS en la venta, y su escala en el cálculo', async () => {
      // Elegir por posición, por "la primera habilitada" o por cualquier otro
      // criterio que no sea `es_oficial` pasaba en verde hasta este test: nada
      // afirmaba QUÉ moneda queda escrita. Es lo que dejó vivir durante meses la
      // segunda noción de "oficial" (`tenant_moneda.es_default`, eliminada el
      // 2026-08-21) en el camino de persistencia de la venta.
      const manager = buildManagerMock();
      dataSourceMock.transaction.mockImplementationOnce(
        (cb: (m: typeof manager) => unknown) => cb(manager),
      );

      await service.crear(TENANT_ID, USUARIO_ID, baseDto);

      const ventas = manager.save.mock.calls.filter(
        (call) => call[0] === Venta,
      );
      expect(ventas.length).toBeGreaterThan(0);
      const guardada = ventas[0]![1] as { monedaId: string };
      expect(guardada.monedaId).toBe(MONEDA_OFICIAL_ID);

      // Y la escala del motor sale de esa misma moneda, no de otra fila.
      expect(calculoPreciosService.cargarConfig).toHaveBeenCalledWith(
        TENANT_ID,
        4,
      );
    });
  });

  describe('crear() — recetas', () => {
    const mockReceta = {
      id: 'receta-uuid',
      nombre: 'Hamburguesa',
      tipo: 'receta',
      precioBase: '3500.0000',
      precioIncluyeImpuesto: false,
      monedaId: MONEDA_OFICIAL_ID,
      impuestosIds: [],
      descuentosIds: [],
      recargosIds: [],
    };
    const dtoReceta = {
      lineas: [{ itemId: 'receta-uuid', cantidad: '2' }],
      pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '7000.0000' }],
    };

    it('delega en itemsService.venderIngredientesReceta y no llama registrarMovimiento directo', async () => {
      itemsService.cargarBasePorIds.mockImplementationOnce(mapaDe(mockReceta));
      await service.crear(TENANT_ID, USUARIO_ID, dtoReceta);

      expect(itemsService.venderIngredientesReceta).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tenantId: TENANT_ID,
          recetaItemId: 'receta-uuid',
          recetaNombre: 'Hamburguesa',
          cantidadVendida: '2',
        }),
      );

      expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
    });

    it('agrega advertencias a la respuesta cuando hay advertencias', async () => {
      itemsService.cargarBasePorIds.mockImplementationOnce(mapaDe(mockReceta));
      (
        itemsService.venderIngredientesReceta as jest.Mock
      ).mockResolvedValueOnce([
        'Hamburguesa: no había stock suficiente de Queso, se vendió sin ese insumo',
      ]);

      const result = await service.crear(TENANT_ID, USUARIO_ID, dtoReceta);

      expect(result.advertencias).toEqual([
        'Hamburguesa: no había stock suficiente de Queso, se vendió sin ese insumo',
      ]);
    });

    it('recalcula precio con extras, persiste personalizacion y pasa snapshot al stock', async () => {
      const QUESO_ID = 'queso-extra-uuid';
      const snapshot = {
        omitidos: [],
        extras: [
          {
            ingredienteItemId: QUESO_ID,
            cantidad: '30',
            unidadCodigo: 'g',
            precioExtra: '500.0000',
          },
        ],
      };
      const dtoPersonalizada = {
        lineas: [
          {
            itemId: 'receta-uuid',
            cantidad: '1',
            precioUnitario: '9999.0000',
            personalizacion: {
              extras: [{ ingredienteItemId: QUESO_ID }],
            },
          },
        ],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '4000.0000' }],
      };

      itemsService.cargarBasePorIds.mockImplementationOnce(mapaDe(mockReceta));
      (
        itemsService.resolverPersonalizacionReceta as jest.Mock
      ).mockResolvedValueOnce({
        snapshot,
        precioExtraTotal: '500.0000',
      });
      calculoPreciosService.calcular.mockResolvedValueOnce({
        ...mockResultadoVenta,
        lineas: [
          {
            ...mockResultadoVenta.lineas[0],
            itemId: 'receta-uuid',
            precioUnitario: '4000.0000',
            subtotalNeto: '4000.0000',
            totalLinea: '4000.0000',
          },
        ],
        totales: {
          ...mockResultadoVenta.totales,
          subtotalNeto: '4000.0000',
          totalFinal: '4000.0000',
        },
      });
      pagosServiceMock.registrar.mockResolvedValueOnce({
        pagos: [{ id: 'pago-uuid-001', monto: '4000.0000', vuelto: '0.0000' }],
        montoAplicadoVenta: '4000.0000',
      });

      const result = await service.crear(
        TENANT_ID,
        USUARIO_ID,
        dtoPersonalizada,
      );

      expect(itemsService.resolverPersonalizacionReceta).toHaveBeenCalledWith(
        expect.anything(),
        TENANT_ID,
        'receta-uuid',
        dtoPersonalizada.lineas[0].personalizacion,
      );
      expect(calculoPreciosService.calcular).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          lineas: [
            expect.objectContaining({
              itemId: 'receta-uuid',
              precioUnitario: '4000.0000',
            }),
          ],
        }),
        mockConfigCalculo,
      );
      expect(result.detalles[0].precioUnitarioOrigen).toBe('4000.0000');
      expect(result.detalles[0].personalizacion).toEqual(snapshot);
      expect(itemsService.venderIngredientesReceta).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ snapshot }),
      );
    });
  });

  describe('crear() — grupos de modificadores obligatorios sin personalizacion', () => {
    // Regresión: el gate en crearEnTransaccion antes exigía
    // `linea.personalizacion` truthy para llamar a resolverPersonalizacionReceta
    // /resolverPersonalizacionCombo. Si el cliente omitía por completo el campo
    // `personalizacion`, resolverGruposDeItem nunca se ejecutaba y la validación
    // "min >= 1 => grupo obligatorio" se saltaba silenciosamente. El resolver
    // debe llamarse SIEMPRE (con dto undefined si corresponde) para que la
    // validación de grupos obligatorios se aplique también en ese caso.
    const mockReceta = {
      id: 'receta-uuid',
      nombre: 'Hamburguesa',
      tipo: 'receta',
      precioBase: '3500.0000',
      precioIncluyeImpuesto: false,
      monedaId: MONEDA_OFICIAL_ID,
      impuestosIds: [],
      descuentosIds: [],
      recargosIds: [],
    };
    const mockCombo = {
      id: 'combo-uuid',
      nombre: 'Combo Familiar',
      tipo: 'combo',
      precioBase: '9000.0000',
      precioIncluyeImpuesto: false,
      monedaId: MONEDA_OFICIAL_ID,
      impuestosIds: [],
      descuentosIds: [],
      recargosIds: [],
    };

    it('rechaza la venta de una receta con grupo obligatorio (min:1,max:1) cuando la linea omite personalizacion', async () => {
      const dtoSinPersonalizacion = {
        lineas: [{ itemId: 'receta-uuid', cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '3500.0000' }],
      };

      itemsService.cargarBasePorIds.mockImplementationOnce(mapaDe(mockReceta));
      // Simula el comportamiento real de resolverGruposDeItem: con
      // gruposDto=undefined evalúa cada grupo asociado contra cero unidades
      // elegidas y lanza si algún grupo tiene min >= 1.
      (
        itemsService.resolverPersonalizacionReceta as jest.Mock
      ).mockRejectedValueOnce(
        new BadRequestException(
          'El grupo "Tamaño" requiere elegir entre 1 y 1 unidades',
        ),
      );

      await expect(
        service.crear(TENANT_ID, USUARIO_ID, dtoSinPersonalizacion),
      ).rejects.toThrow(BadRequestException);

      expect(itemsService.resolverPersonalizacionReceta).toHaveBeenCalledWith(
        expect.anything(),
        TENANT_ID,
        'receta-uuid',
        undefined,
      );
    });

    it('rechaza la venta de un combo con grupo obligatorio (min:1,max:1) cuando la linea omite personalizacion', async () => {
      const dtoSinPersonalizacion = {
        lineas: [{ itemId: 'combo-uuid', cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '9000.0000' }],
      };

      itemsService.cargarBasePorIds.mockImplementationOnce(mapaDe(mockCombo));
      (
        itemsService.resolverPersonalizacionCombo as jest.Mock
      ).mockRejectedValueOnce(
        new BadRequestException(
          'El grupo "Bebida" requiere elegir entre 1 y 1 unidades',
        ),
      );

      await expect(
        service.crear(TENANT_ID, USUARIO_ID, dtoSinPersonalizacion),
      ).rejects.toThrow(BadRequestException);

      expect(itemsService.resolverPersonalizacionCombo).toHaveBeenCalledWith(
        expect.anything(),
        TENANT_ID,
        'combo-uuid',
        undefined,
      );
    });
  });

  describe('crear() — canal online', () => {
    const dtoOnline = {
      ...baseDto,
      canal: 'online' as const,
    };

    it('usa la caja virtual del tenant en vez de la caja física del usuario', async () => {
      pagosServiceMock.registrar.mockResolvedValueOnce({
        pagos: [{ id: 'pago-uuid-001', monto: '100.0000', vuelto: '0.0000' }],
        montoAplicadoVenta: '100.0000',
      });
      const result = await service.crear(TENANT_ID, USUARIO_ID, dtoOnline);

      expect(cajaService.findVirtual).toHaveBeenCalledWith(TENANT_ID);

      expect(cajaService.findActiva).not.toHaveBeenCalled();
      expect(result.cajaId).toBe(CAJA_VIRTUAL_ID);
      expect(result.canal).toBe('online');
    });

    it('NO bloquea la caja virtual: nunca se cierra y el lock serializaría todas las ventas online', async () => {
      pagosServiceMock.registrar.mockResolvedValueOnce({
        pagos: [{ id: 'pago-uuid-001', monto: '100.0000', vuelto: '0.0000' }],
        montoAplicadoVenta: '100.0000',
      });
      await service.crear(TENANT_ID, USUARIO_ID, dtoOnline);

      expect(cajaService.bloquearCajaAbierta).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si el tenant no tiene caja virtual', async () => {
      cajaService.findVirtual.mockResolvedValueOnce(null);
      await expect(
        service.crear(TENANT_ID, USUARIO_ID, dtoOnline),
      ).rejects.toThrow(
        new BadRequestException(
          'El tenant no tiene una caja virtual configurada',
        ),
      );
    });

    it('lanza BadRequestException si el pago no cubre el total', async () => {
      const dtoIncompleto = {
        ...dtoOnline,
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '50.0000' }],
      };
      await expect(
        service.crear(TENANT_ID, USUARIO_ID, dtoIncompleto as any),
      ).rejects.toThrow(
        new BadRequestException('Las ventas online requieren el pago completo'),
      );
    });

    it('lanza BadRequestException si no hay pagos', async () => {
      const dtoSinPago = { ...dtoOnline, pagos: undefined };
      await expect(
        service.crear(TENANT_ID, USUARIO_ID, dtoSinPago as any),
      ).rejects.toThrow(
        new BadRequestException('Las ventas online requieren el pago completo'),
      );
    });
  });

  describe('crearNotaCredito() / registrarDevolucionesPorReembolso()', () => {
    const VENTA_ORIG_ID = 'venta-orig-uuid-001';
    const ITEM_SERIE_ID = 'item-serie-uuid-001';
    const SERVICIO_ID = 'item-servicio-uuid-001';

    const ventaOriginalRow = {
      venta_id: VENTA_ORIG_ID,
      caja_id: CAJA_VIRTUAL_ID,
      moneda_id: MONEDA_OFICIAL_ID,
      canal: 'online',
      total_final: '11305.0000',
      estado: 'pagada',
      tipo_documento_id: 'tipo-doc-boleta-uuid',
      config_calculo: {
        formula: ['descuentos', 'recargos', 'impuestos'],
        calculoDescuentos: 'base',
        calculoRecargos: 'base',
        escalaCalculo: 4,
        modoRedondeo: 'HALF_UP',
        nivelRedondeo: 'linea',
        decimalesMoneda: 4,
      },
    };
    const detallesRows = [
      {
        item_id: ITEM_ID,
        cantidad: '3',
        precio_unitario: '100.0000',
        precio_unitario_origen: '100.0000',
        tasa_cambio: '1.000000',
        moneda_id_origen: MONEDA_OFICIAL_ID,
        descripcion: 'Smartphone',
        clasificacion_tributaria: 'exento',
        modo_inventario: 'cantidad',
      },
      {
        item_id: ITEM_SERIE_ID,
        cantidad: '1',
        precio_unitario: '500.0000',
        precio_unitario_origen: '500.0000',
        tasa_cambio: '1.000000',
        moneda_id_origen: MONEDA_OFICIAL_ID,
        descripcion: 'Notebook serializado',
        modo_inventario: 'serie',
      },
      {
        item_id: SERVICIO_ID,
        cantidad: '1',
        precio_unitario: '50.0000',
        precio_unitario_origen: '50.0000',
        tasa_cambio: '1.000000',
        moneda_id_origen: MONEDA_OFICIAL_ID,
        descripcion: 'Instalación',
        modo_inventario: null,
      },
    ];

    let ncManager: ReturnType<typeof buildManagerMock>;
    // Resultados configurables por test para las queries dentro de la tx
    let ventaRows: unknown[];
    let ncPreviasTotal: string;
    let devueltosRows: { item_id: string; devuelto: string }[];
    // Tope de la devolución en efectivo: por defecto la venta se cobró entera en
    // efectivo, así que no restringe y los tests preexistentes no cambian.
    let efectivoCobrado: string;
    let efectivoDevuelto: string;
    // Costo congelado de las salidas de la venta original, por ítem.
    let costosCongelados: { item_id: string; costo_unitario: string | null }[];

    beforeEach(() => {
      ncManager = buildManagerMock();
      ventaRows = [ventaOriginalRow];
      ncPreviasTotal = '0';
      devueltosRows = [];
      efectivoCobrado = '1100.0000';
      efectivoDevuelto = '0';
      costosCongelados = [{ item_id: ITEM_ID, costo_unitario: '50.0000' }];
      ncManager.query.mockImplementation((sql: string) => {
        if (sql.includes('FOR UPDATE')) return Promise.resolve(ventaRows);
        if (sql.includes('SUM(total_final)'))
          return Promise.resolve([{ total: ncPreviasTotal }]);
        if (sql.includes('FROM venta_detalles'))
          return Promise.resolve(detallesRows);
        if (sql.includes('costo_unitario'))
          return Promise.resolve(costosCongelados);
        if (sql.includes('FROM movimientos_inventario'))
          return Promise.resolve(devueltosRows);
        if (sql.includes('es_efectivo'))
          return Promise.resolve([
            { cobrado: efectivoCobrado, devuelto: efectivoDevuelto },
          ]);
        return Promise.resolve([]);
      });
      dataSourceMock.transaction.mockImplementation(
        (cb: (m: typeof ncManager) => unknown) => cb(ncManager),
      );
    });

    const baseParams = {
      tenantId: TENANT_ID,
      usuarioId: USUARIO_ID,
      ventaOriginalId: VENTA_ORIG_ID,
      monto: '1100.0000',
      comentario: 'NC por reembolso orden O-1',
    };

    it('NC sin líneas: totales copiados del monto, estado pagada, referencia y caja/canal/moneda de la original; sin detalles ni movimientos', async () => {
      const res = await service.crearNotaCredito(baseParams);
      expect(res.id).toBeDefined();
      expect(res.totalFinal).toBe('1100.0000');
      expect(ncManager.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tenantId: TENANT_ID,
          tipoDocumentoId: TIPO_DOCUMENTO_NC_ID,
          ventaReferenciaId: VENTA_ORIG_ID,
          estado: EstadoVenta.PAGADA,
          cajaId: CAJA_VIRTUAL_ID,
          monedaId: MONEDA_OFICIAL_ID,
          canal: 'online',
          totalBruto: '1100.0000',
          totalFinal: '1100.0000',
          totalDescuentos: '0',
          totalRecargos: '0',
          totalImpuestos: '0',
          comentario: 'NC por reembolso orden O-1',
        }),
      );
      // una sola persistencia: la cabecera (sin líneas)
      expect(ncManager.save).toHaveBeenCalledTimes(1);

      expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
    });

    it('NC con devoluciones: crea la línea copiada y registra entrada/devolucion ligada a la NC', async () => {
      const res = await service.crearNotaCredito({
        ...baseParams,
        devoluciones: [{ itemId: ITEM_ID, cantidad: '2' }],
      });
      expect(ncManager.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          itemId: ITEM_ID,
          cantidad: '2',
          precioUnitario: '100.0000',
          monedaIdOrigen: MONEDA_OFICIAL_ID,
          totalLinea: '200.0000',
          clasificacionTributaria: 'exento',
        }),
      );

      expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
        ncManager,
        expect.objectContaining({
          tenantId: TENANT_ID,
          itemId: ITEM_ID,
          tipo: 'entrada',
          motivo: 'devolucion',
          cantidad: '2',
          usuarioId: USUARIO_ID,
          ventaId: res.id,
        }),
      );
    });

    it('la devolución de la NC reingresa al costo con el que la unidad salió', async () => {
      // Misma decisión que la anulación (owner, 2026-08-15): el costo lo dice
      // el kardex de la venta original, no el CPP del momento de devolver.
      const res = await service.crearNotaCredito({
        ...baseParams,
        devoluciones: [{ itemId: ITEM_ID, cantidad: '2' }],
      });

      expect(res.id).toBeDefined();
      expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
        ncManager,
        expect.objectContaining({
          motivo: 'devolucion',
          costoUnitario: '50.0000',
        }),
      );
    });

    it('una devolución PARCIAL toma el costo de la salida, no un prorrateo', async () => {
      // De 2 unidades vendidas vuelve 1: el costo unitario congelado es el
      // mismo, porque dentro de una venta todas las salidas de un ítem se
      // congelan contra el mismo `costo_actual`.
      await service.crearNotaCredito({
        ...baseParams,
        devoluciones: [{ itemId: ITEM_ID, cantidad: '1' }],
      });

      expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
        ncManager,
        expect.objectContaining({ cantidad: '1', costoUnitario: '50.0000' }),
      );
    });

    it('el reembolso sin NC también reingresa al costo de la salida', async () => {
      await service.registrarDevolucionesPorReembolso({
        tenantId: TENANT_ID,
        usuarioId: USUARIO_ID,
        ventaOriginalId: VENTA_ORIG_ID,
        devoluciones: [{ itemId: ITEM_ID, cantidad: '1' }],
      });

      expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
        ncManager,
        expect.objectContaining({
          motivo: 'devolucion',
          costoUnitario: '50.0000',
        }),
      );
    });

    it('sin costo congelado, la devolución no inventa uno', async () => {
      costosCongelados = [];

      await service.crearNotaCredito({
        ...baseParams,
        devoluciones: [{ itemId: ITEM_ID, cantidad: '2' }],
      });

      expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
        ncManager,
        expect.objectContaining({ costoUnitario: null }),
      );
    });

    it('rechaza cuando Σ(NCs previas) + monto excede el total de la venta', async () => {
      ncPreviasTotal = '10500.0000';
      await expect(service.crearNotaCredito(baseParams)).rejects.toThrow(
        BadRequestException,
      );
      expect(ncManager.save).not.toHaveBeenCalled();
    });

    it('rechaza monto <= 0 sin abrir transacción', async () => {
      await expect(
        service.crearNotaCredito({ ...baseParams, monto: '0' }),
      ).rejects.toThrow(BadRequestException);
      expect(dataSourceMock.transaction).not.toHaveBeenCalled();
    });

    it('rechaza cantidad devuelta mayor a vendida menos ya devuelta', async () => {
      devueltosRows = [{ item_id: ITEM_ID, devuelto: '2' }];
      await expect(
        service.crearNotaCredito({
          ...baseParams,
          devoluciones: [{ itemId: ITEM_ID, cantidad: '2' }],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
    });

    it('rechaza un ítem que no pertenece a la venta', async () => {
      await expect(
        service.crearNotaCredito({
          ...baseParams,
          devoluciones: [{ itemId: 'item-ajeno', cantidad: '1' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza ítems modo serie/lote antes de tocar inventario', async () => {
      await expect(
        service.crearNotaCredito({
          ...baseParams,
          devoluciones: [{ itemId: ITEM_SERIE_ID, cantidad: '1' }],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
    });

    it('rechaza ítems sin stock (servicios) con mensaje propio', async () => {
      await expect(
        service.crearNotaCredito({
          ...baseParams,
          devoluciones: [{ itemId: SERVICIO_ID, cantidad: '1' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza NotFoundException si la venta no existe o es de otro tenant', async () => {
      ventaRows = [];
      await expect(service.crearNotaCredito(baseParams)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('no modifica la venta original (ni save ni UPDATE sobre ella)', async () => {
      await service.crearNotaCredito(baseParams);
      const saves = ncManager.save.mock.calls.map(
        (c: unknown[]) => c[1] as Record<string, unknown>,
      );
      expect(saves.some((d) => d['id'] === VENTA_ORIG_ID)).toBe(false);
      const updates = ncManager.query.mock.calls.filter((c: unknown[]) =>
        String(c[0]).trim().toUpperCase().startsWith('UPDATE VENTAS'),
      );
      expect(updates).toHaveLength(0);
    });

    it('findOne marca esNotaCredito por el ID del tipo de documento, no por su código', async () => {
      // El frontend lo reconstruía con `codigo === '61'`. `codigo` es nullable y
      // varía por país: acá el documento ES una NC con OTRO código, así que
      // comparar por código daría false y el drawer ofrecería emitir una NC
      // sobre una NC. Solo mirar el id acierta.
      dataSourceMock.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM ventas'))
          return Promise.resolve([
            {
              venta_id: VENTA_ORIG_ID,
              caja_id: CAJA_VIRTUAL_ID,
              moneda_id: MONEDA_OFICIAL_ID,
              tipo_documento_id: TIPO_DOCUMENTO_NC_ID,
              canal: 'fisico',
              estado: 'pagada',
              total_bruto: '100.0000',
              total_descuentos: '0',
              total_recargos: '0',
              total_impuestos: '0',
              total_final: '100.0000',
              comentario: null,
              fecha: new Date('2026-07-10'),
              creado_el: new Date('2026-07-10'),
              venta_referencia_id: 'venta-madre',
              tipo_documento_codigo: '9999',
              tipo_documento_nombre: 'Nota de crédito (otro país)',
            },
          ]);
        return Promise.resolve([]);
      });

      const res = await service.findOne(TENANT_ID, VENTA_ORIG_ID);
      expect(res.tipoDocumento?.codigo).toBe('9999');
      expect(res.esNotaCredito).toBe(true);
    });

    it('findOne expone referencia, tipo documento, modo/devuelto por detalle, reembolsos y NCs hijas', async () => {
      dataSourceMock.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM movimientos_inventario'))
          return Promise.resolve([{ item_id: ITEM_ID, devuelto: '1' }]);
        if (sql.includes('pasarela_transacciones'))
          return Promise.resolve([
            {
              transaccion_id: 'tx-refund-1',
              monto: '1100.0000',
              estado: 'aprobada',
              fecha_transaccion: new Date('2026-07-10'),
              orden_id: 'orden-1',
              codigo_orden: 'O-1',
            },
          ]);
        if (sql.includes('FROM venta_detalles'))
          return Promise.resolve([
            {
              detalle_id: 'det-1',
              item_id: ITEM_ID,
              descripcion: 'Smartphone',
              cantidad: '3',
              precio_unitario: '100.0000',
              precio_unitario_origen: '100.0000',
              tasa_cambio: '1.000000',
              moneda_id_origen: MONEDA_OFICIAL_ID,
              subtotal: '300.0000',
              descuento_aplicado: '0',
              recargo_aplicado: '0',
              impuesto_aplicado: '0',
              total_linea: '300.0000',
              modo_inventario: 'cantidad',
            },
          ]);
        if (sql.includes('WHERE venta_referencia_id'))
          return Promise.resolve([
            {
              venta_id: 'nc-1',
              total_final: '1100.0000',
              fecha: new Date('2026-07-10'),
              comentario: 'NC por reembolso orden O-1',
            },
          ]);
        if (sql.includes('FROM venta_propina'))
          return Promise.resolve([
            {
              venta_propina_id: 'vp-1',
              porcentaje_sugerido: '0.100000',
              monto_sugerido: '1131.0000',
              monto_pagado: '1000.0000',
              tipo: 'manual',
              estado: 'pagada',
              garzon_id: 'garzon-1',
              garzon_nombre: 'Ana',
            },
          ]);
        if (sql.includes('FROM pagos '))
          return Promise.resolve([
            {
              pago_id: 'pago-1',
              metodo_pago_id: EFECTIVO_ID,
              moneda_oficial_id: MONEDA_OFICIAL_ID,
              caja_id: CAJA_VIRTUAL_ID,
              monto: '12305.0000',
              vuelto: '0.0000',
              fecha: new Date('2026-07-10'),
              referencia: null,
            },
          ]);
        if (sql.includes('FROM pago_aplicaciones'))
          return Promise.resolve([
            {
              pago_aplicacion_id: 'pa-1',
              pago_id: 'pago-1',
              tipo: 'venta',
              referencia_id: VENTA_ORIG_ID,
              monto: '11305.0000',
            },
            {
              pago_aplicacion_id: 'pa-2',
              pago_id: 'pago-1',
              tipo: 'propina',
              referencia_id: 'vp-1',
              monto: '1000.0000',
            },
          ]);
        if (sql.includes('FROM ventas'))
          return Promise.resolve([
            {
              venta_id: VENTA_ORIG_ID,
              caja_id: CAJA_VIRTUAL_ID,
              moneda_id: MONEDA_OFICIAL_ID,
              tipo_documento_id: 'doc-boleta',
              canal: 'online',
              estado: 'pagada',
              total_bruto: '11305.0000',
              total_descuentos: '0',
              total_recargos: '0',
              total_impuestos: '0',
              total_final: '11305.0000',
              comentario: null,
              fecha: new Date('2026-07-10'),
              creado_el: new Date('2026-07-10'),
              venta_referencia_id: null,
              tipo_documento_codigo: '39',
              tipo_documento_nombre: 'Boleta de Venta',
            },
          ]);
        return Promise.resolve([]);
      });

      const res = await service.findOne(TENANT_ID, VENTA_ORIG_ID);
      expect(res.ventaReferenciaId).toBeNull();
      expect(res.tipoDocumento).toEqual({
        id: 'doc-boleta',
        codigo: '39',
        nombre: 'Boleta de Venta',
      });
      expect(res.esNotaCredito).toBe(false);
      expect(res.detalles[0]).toEqual(
        expect.objectContaining({
          itemId: ITEM_ID,
          modoInventario: 'cantidad',
          cantidadDevuelta: '1',
        }),
      );
      expect(res.reembolsos).toEqual([
        expect.objectContaining({
          id: 'tx-refund-1',
          monto: '1100.0000',
          estado: 'aprobada',
          ordenId: 'orden-1',
          codigoOrden: 'O-1',
        }),
      ]);
      expect(res.notasCredito).toEqual([
        expect.objectContaining({
          id: 'nc-1',
          totalFinal: '1100.0000',
          comentario: 'NC por reembolso orden O-1',
        }),
      ]);
      expect(res.propina).toEqual({
        id: 'vp-1',
        porcentajeSugerido: '0.100000',
        montoSugerido: '1131.0000',
        montoPagado: '1000.0000',
        tipo: 'manual',
        estado: 'pagada',
        garzonId: 'garzon-1',
        garzonNombre: 'Ana',
      });
      expect(res.pagos[0]).toEqual(
        expect.objectContaining({
          id: 'pago-1',
          montoAplicadoVenta: '11305.0000',
          montoAplicadoPropina: '1000.0000',
          aplicaciones: [
            {
              tipo: 'venta',
              monto: '11305.0000',
              referenciaId: VENTA_ORIG_ID,
            },
            {
              tipo: 'propina',
              monto: '1000.0000',
              referenciaId: 'vp-1',
            },
          ],
        }),
      );
    });

    it('listar mapea totalReembolsado y esNotaCredito', async () => {
      dataSourceMock.query.mockImplementation((sql: string) => {
        if (sql.includes('COUNT(*)')) return Promise.resolve([{ total: 2 }]);
        return Promise.resolve([
          {
            venta_id: 'v-1',
            canal: 'online',
            estado: 'pagada',
            total_final: '11305.0000',
            fecha: new Date('2026-07-10'),
            creado_el: new Date('2026-07-10'),
            monto_pagado: '11305.0000',
            total_reembolsado: '1100.0000',
            tipo_documento_id: 'doc-boleta',
          },
          {
            venta_id: 'nc-1',
            canal: 'online',
            estado: 'pagada',
            total_final: '1100.0000',
            fecha: new Date('2026-07-10'),
            creado_el: new Date('2026-07-10'),
            monto_pagado: '0',
            total_reembolsado: '0',
            tipo_documento_id: TIPO_DOCUMENTO_NC_ID,
          },
        ]);
      });

      const res = await service.listar(TENANT_ID, {});
      const listSql = dataSourceMock.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('FROM ventas v') &&
          c[0].includes('LIMIT'),
      )?.[0] as string;
      expect(listSql).toContain("pa.tipo = 'venta'");
      expect(listSql).toContain('pago_aplicaciones');
      expect(res.data[0]).toEqual(
        expect.objectContaining({
          totalReembolsado: '1100.0000',
          esNotaCredito: false,
        }),
      );
      expect(res.data[1]).toEqual(
        expect.objectContaining({
          totalReembolsado: '0.0000',
          esNotaCredito: true,
        }),
      );
    });

    it('resumen excluye las notas de crédito de los KPIs', async () => {
      dataSourceMock.query.mockResolvedValueOnce([
        { total_ventas: 5, total_facturado: '100', saldo_pendiente: '0' },
      ]);
      await service.resumen(TENANT_ID);
      const [sql, params] = dataSourceMock.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('IS DISTINCT FROM');
      expect(sql).toContain("pa.tipo = 'venta'");
      expect(sql).toContain('pago_aplicaciones');
      expect(params).toContain(TIPO_DOCUMENTO_NC_ID);
    });

    it('registrarDevolucionesPorReembolso liga los movimientos a la venta original y no crea cabecera', async () => {
      await service.registrarDevolucionesPorReembolso({
        tenantId: TENANT_ID,
        usuarioId: USUARIO_ID,
        ventaOriginalId: VENTA_ORIG_ID,
        devoluciones: [{ itemId: ITEM_ID, cantidad: '1' }],
        comentario: 'Devolución por reembolso orden O-1',
      });
      expect(ncManager.save).not.toHaveBeenCalled();

      expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
        ncManager,
        expect.objectContaining({
          tipo: 'entrada',
          motivo: 'devolucion',
          itemId: ITEM_ID,
          cantidad: '1',
          ventaId: VENTA_ORIG_ID,
        }),
      );
    });

    describe('cancelar()', () => {
      const cancelarParams = {
        tenantId: TENANT_ID,
        usuarioId: USUARIO_ID,
        ventaId: VENTA_ORIG_ID,
        motivo: 'Cliente se arrepintió antes de pagar',
        reponerStock: true,
      };
      // Venta anulable: pendiente, sin documento. Los pagos se controlan con
      // `conPagos` porque son otra query.
      const ventaAnulable = {
        ...ventaOriginalRow,
        estado: 'pendiente',
        tipo_documento_id: null,
      };
      let conPagos: unknown[];
      // Lo que el kardex dice que SALIÓ por esta venta. Es la fuente de la
      // reposición desde el 2026-08-22: las líneas de `venta_detalles` no
      // sirven porque una receta o un combo no tienen fila en `item_producto`.
      let salidasKardex: unknown[];
      // Las líneas de la venta, que la reposición ya NO mira. Se deja
      // devolviendo algo distinto a propósito: si el código volviera a
      // armar la lista desde acá, los tests de abajo lo cazan.
      let detallesVenta: unknown[];

      beforeEach(() => {
        conPagos = [];
        salidasKardex = [
          {
            item_id: ITEM_ID,
            cantidad: '2.0000',
            descripcion: 'Smartphone',
            modo_inventario: 'cantidad',
            costo_unitario: '50.0000',
          },
        ];
        detallesVenta = [];
        ventaRows = [ventaAnulable];
        ncManager.query.mockImplementation((sql: string) => {
          if (sql.includes('FOR UPDATE')) return Promise.resolve(ventaRows);
          if (sql.includes('FROM pagos')) return Promise.resolve(conPagos);
          if (sql.includes('movimientos_inventario'))
            return Promise.resolve(salidasKardex);
          if (sql.includes('venta_detalles'))
            return Promise.resolve(detallesVenta);
          return Promise.resolve([]);
        });
      });

      it('anula, repone el stock y deja el rastro de quién y por qué', async () => {
        const res = await service.cancelar(cancelarParams);

        expect(res.estado).toBe(EstadoVenta.CANCELADA);
        expect(res.stockRepuesto).toBe(true);
        expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
          ncManager,
          expect.objectContaining({
            itemId: ITEM_ID,
            tipo: 'entrada',
            motivo: 'anulacion',
            cantidad: '2.0000',
          }),
        );
        const update = ncManager.query.mock.calls.find((c) =>
          String(c[0]).includes('UPDATE ventas'),
        );
        expect(update?.[1]).toEqual([
          EstadoVenta.CANCELADA,
          USUARIO_ID,
          cancelarParams.motivo,
          VENTA_ORIG_ID,
        ]);
      });

      it('con reponerStock=false no toca el inventario', async () => {
        const res = await service.cancelar({
          ...cancelarParams,
          reponerStock: false,
        });

        expect(res.stockRepuesto).toBe(false);
        expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
      });

      it.each([
        ['pagada', /Solo se anula una venta pendiente/],
        ['pagada_parcial', /Solo se anula una venta pendiente/],
        ['cancelada', /Solo se anula una venta pendiente/],
      ])('rechaza una venta en estado %s', async (estado, mensaje) => {
        ventaRows = [{ ...ventaAnulable, estado }];
        await expect(service.cancelar(cancelarParams)).rejects.toThrow(mensaje);
        expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
      });

      it('rechaza una venta que ya tiene documento tributario', async () => {
        ventaRows = [{ ...ventaAnulable, tipo_documento_id: 'doc-uuid' }];
        await expect(service.cancelar(cancelarParams)).rejects.toThrow(
          /documento tributario: se revierte con nota de crédito/,
        );
      });

      it('rechaza una venta con pagos registrados', async () => {
        conPagos = [{ '1': 1 }];
        await expect(service.cancelar(cancelarParams)).rejects.toThrow(
          /pagos registrados: se revierte con nota de crédito/,
        );
        expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
      });

      it('rechaza reponer stock de un ítem serializado, antes de mover nada', async () => {
        salidasKardex = [
          {
            item_id: ITEM_ID,
            cantidad: '1.0000',
            descripcion: 'Notebook',
            modo_inventario: 'serie',
          },
          {
            item_id: 'otro',
            cantidad: '1.0000',
            descripcion: 'Mouse',
            modo_inventario: 'cantidad',
          },
        ];
        await expect(service.cancelar(cancelarParams)).rejects.toThrow(
          /usa inventario por serie/,
        );
        // Valida TODAS las líneas antes de mover: no deja media reposición hecha.
        expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
      });

      it('repone los ingredientes de una receta, que no son líneas de la venta', async () => {
        // El bug: `venta_detalles JOIN item_producto` es INNER, y la línea de
        // una receta no tiene fila en `item_producto` —la tienen sus
        // ingredientes—, así que desaparecía del SELECT sin error y la
        // anulación no reponía nada. La venta sigue teniendo UNA línea (la
        // receta); lo que salió del inventario son DOS ingredientes.
        detallesVenta = [
          { item_id: 'receta-1', cantidad: '2', descripcion: 'Hamburguesa' },
        ];
        salidasKardex = [
          {
            item_id: 'ing-carne',
            cantidad: '0.3000',
            descripcion: 'Carne',
            modo_inventario: 'cantidad',
          },
          {
            item_id: 'ing-pan',
            cantidad: '2.0000',
            descripcion: 'Pan',
            modo_inventario: 'cantidad',
          },
        ];

        const res = await service.cancelar(cancelarParams);

        expect(res.stockRepuesto).toBe(true);
        expect(inventarioService.registrarMovimiento).toHaveBeenCalledTimes(2);
        expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
          ncManager,
          expect.objectContaining({
            itemId: 'ing-carne',
            tipo: 'entrada',
            motivo: 'anulacion',
            cantidad: '0.3000',
          }),
        );
      });

      it('reingresa al costo con el que la unidad salió, no al vigente', async () => {
        // El costo real de la salida ya estaba en el kardex ligado a la venta
        // y no se leía: el reingreso caía en el CPP del momento de anular, y
        // el inventario se valorizaba con unidades que nadie compró.
        await service.cancelar(cancelarParams);

        expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
          ncManager,
          expect.objectContaining({ costoUnitario: '50.0000' }),
        );
      });

      it('sin costo congelado en el kardex no inventa uno', async () => {
        salidasKardex = [
          {
            item_id: ITEM_ID,
            cantidad: '2.0000',
            descripcion: 'Smartphone',
            modo_inventario: 'cantidad',
            costo_unitario: null,
          },
        ];

        await service.cancelar(cancelarParams);

        expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
          ncManager,
          expect.objectContaining({ costoUnitario: null }),
        );
      });

      it('bloquea por itemId ascendente, no en el orden que devuelva la query', async () => {
        // Mismo criterio que `crear()`, y con el MISMO comparador: si los dos
        // caminos ordenaran distinto, una venta y una anulación simultáneas
        // sobre los mismos ítems seguirían cruzándose.
        salidasKardex = [
          {
            item_id: 'zzz-item',
            cantidad: '1.0000',
            descripcion: 'Z',
            modo_inventario: 'cantidad',
          },
          {
            item_id: 'aaa-item',
            cantidad: '1.0000',
            descripcion: 'A',
            modo_inventario: 'cantidad',
          },
        ];

        await service.cancelar(cancelarParams);

        expect(
          inventarioService.registrarMovimiento.mock.calls.map(
            (c) => (c[1] as { itemId: string }).itemId,
          ),
        ).toEqual(['aaa-item', 'zzz-item']);
      });

      it('no dice que repuso cuando la venta no movió stock', async () => {
        // Una venta de puros servicios no tiene nada que devolver. Responder
        // `stockRepuesto: true` hace que la pantalla diga "stock repuesto"
        // sobre un inventario que nadie tocó.
        salidasKardex = [];

        const res = await service.cancelar(cancelarParams);

        expect(res.estado).toBe(EstadoVenta.CANCELADA);
        expect(res.stockRepuesto).toBe(false);
        expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
      });

      it('reintenta ante un deadlock igual que crear()', async () => {
        // `cancelar` toma un FOR UPDATE por ítem, así que puede cruzarse con
        // una venta concurrente. Sin reintento, el cajero recibe un error
        // opaco por algo que el segundo intento resuelve.
        const deadlock = Object.assign(new Error('deadlock detected'), {
          code: '40P01',
        });
        dataSourceMock.transaction
          .mockRejectedValueOnce(deadlock)
          .mockImplementationOnce((cb: (m: unknown) => unknown) =>
            cb(ncManager),
          );

        const res = await service.cancelar(cancelarParams);

        expect(res.estado).toBe(EstadoVenta.CANCELADA);
        expect(dataSourceMock.transaction).toHaveBeenCalledTimes(2);
      });

      it('NO reintenta un error de negocio', async () => {
        dataSourceMock.transaction.mockRejectedValueOnce(
          new BadRequestException('Stock insuficiente para la salida'),
        );

        await expect(service.cancelar(cancelarParams)).rejects.toThrow(
          'Stock insuficiente para la salida',
        );
        expect(dataSourceMock.transaction).toHaveBeenCalledTimes(1);
      });
    });

    describe('crearNotaCreditoDesdeVenta()', () => {
      it('feliz sin dinero: delega en crearNotaCredito y devuelve movimientoCajaId null', async () => {
        const res = await service.crearNotaCreditoDesdeVenta(baseParams);
        expect(res.totalFinal).toBe('1100.0000');
        expect(res.movimientoCajaId).toBeNull();
        // prettier-ignore

        expect(cajaService.registrarMovimientoEnTransaccion).not.toHaveBeenCalled();
      });

      it('acepta una venta pagada_parcial (no solo pagada)', async () => {
        // `pagada_parcial` está en la whitelist de estados elegibles, pero el
        // spec solo lo cubría por ausencia de la lista de rechazo: el camino
        // feliz usaba siempre 'pagada'. Sacarlo de la whitelist en
        // `ventas.service.ts` no rompía ningún test.
        ventaRows = [{ ...ventaOriginalRow, estado: 'pagada_parcial' }];

        const res = await service.crearNotaCreditoDesdeVenta(baseParams);

        expect(res.totalFinal).toBe('1100.0000');
      });

      it.each(['pendiente', 'cancelada'])(
        'rechaza ventas en estado %s',
        async (estado) => {
          ventaRows = [{ ...ventaOriginalRow, estado }];
          await expect(
            service.crearNotaCreditoDesdeVenta(baseParams),
          ).rejects.toThrow(
            'Solo se puede emitir nota de crédito de ventas pagadas o pagadas parcialmente',
          );
        },
      );

      it('rechaza devolver en efectivo más de lo que la venta cobró en efectivo', async () => {
        // Venta de 1100 pagada con 200 en efectivo y el resto con tarjeta: el
        // saldo GLOBAL de la caja alcanza (viene de otras ventas), pero esta
        // venta solo ingresó 200 en billetes.
        efectivoCobrado = '200.0000';

        await expect(
          service.crearNotaCreditoDesdeVenta({
            ...baseParams,
            devolverDinero: true,
          }),
        ).rejects.toThrow(
          /más de lo que esta venta cobró en efectivo \(disponible: 200\.0000\)/,
        );

        expect(
          cajaService.registrarMovimientoEnTransaccion,
        ).not.toHaveBeenCalled();
      });

      it('el tope acota el DINERO, no el documento: la NC sin devolución pasa igual', async () => {
        // Distinción central: anular una venta cobrada a medias es legítimo
        // (borra la cuenta por cobrar); devolver efectivo que nunca entró, no.
        efectivoCobrado = '0.0000';

        const res = await service.crearNotaCreditoDesdeVenta(baseParams);

        expect(res.totalFinal).toBe('1100.0000');
        expect(res.movimientoCajaId).toBeNull();
      });

      it('descuenta lo ya devuelto en efectivo por NCs anteriores', async () => {
        efectivoCobrado = '1100.0000';
        efectivoDevuelto = '900.0000'; // disponible: 200

        await expect(
          service.crearNotaCreditoDesdeVenta({
            ...baseParams,
            devolverDinero: true,
          }),
        ).rejects.toThrow(/disponible: 200\.0000/);
      });

      it('rechaza NC sobre otra NC', async () => {
        ventaRows = [
          { ...ventaOriginalRow, tipo_documento_id: TIPO_DOCUMENTO_NC_ID },
        ];
        await expect(
          service.crearNotaCreditoDesdeVenta(baseParams),
        ).rejects.toThrow(
          'No se puede emitir una nota de crédito sobre otra nota de crédito',
        );
      });

      it('devolverDinero: registra salida en la caja activa ligada a la NC', async () => {
        const res = await service.crearNotaCreditoDesdeVenta({
          ...baseParams,
          devolverDinero: true,
        });
        expect(res.movimientoCajaId).toBe('mov-caja-nc-1');

        expect(cajaService.findActiva).toHaveBeenCalledWith(
          TENANT_ID,
          USUARIO_ID,
        );
        // prettier-ignore

        expect(cajaService.registrarMovimientoEnTransaccion).toHaveBeenCalledWith(
          ncManager,
          expect.objectContaining({
            cajaId: CAJA_ID,
            tipo: 'salida',
            concepto: 'Devolución · Nota de crédito',
            monto: '1100.0000',
            ventaId: res.id,
          }),
        );
      });

      it('devolverDinero sin caja física abierta → 422', async () => {
        cajaService.findActiva.mockResolvedValueOnce(null);
        await expect(
          service.crearNotaCreditoDesdeVenta({
            ...baseParams,
            devolverDinero: true,
          }),
        ).rejects.toThrow(UnprocessableEntityException);
      });

      it('devolverDinero con saldo insuficiente → 422 y no registra movimiento', async () => {
        cajaService.calcularEsperadoEfectivo.mockResolvedValueOnce('1000.0000');
        await expect(
          service.crearNotaCreditoDesdeVenta({
            ...baseParams,
            devolverDinero: true,
          }),
        ).rejects.toThrow('Saldo insuficiente en caja');
        // prettier-ignore

        expect(cajaService.registrarMovimientoEnTransaccion).not.toHaveBeenCalled();
      });

      it('regresión: crearNotaCredito directo (flujo pasarela) no valida estado ni toca caja', async () => {
        ventaRows = [{ ...ventaOriginalRow, estado: 'pendiente' }];
        const res = await service.crearNotaCredito(baseParams);
        expect(res.movimientoCajaId).toBeNull();
        // prettier-ignore

        expect(cajaService.registrarMovimientoEnTransaccion).not.toHaveBeenCalled();
      });
    });
  });
});
