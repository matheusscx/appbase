import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import type { EntityManager } from 'typeorm';
import { Test, type TestingModule } from '@nestjs/testing';
import { Db } from '../../common/db/db.service';
import {
  MENSAJE_NOTA_CREDITO_OTROS_DATOS,
  VentasService,
} from './ventas.service';
import { CalculoPreciosService } from '../calculo-precios/calculo-precios.service';
import type { ConfigCalculo } from '../calculo-precios/calculo-precios.engine';
import { CajaService, IntentoRechazadoError } from '../caja/caja.service';
import { InventarioService } from '../inventario/inventario.service';
import { ItemsService } from '../items/items.service';
import { PagosService } from '../pagos/pagos.service';
import { VentaDocumentosService } from '../venta-documentos/venta-documentos.service';
import { VentaPropinaService } from '../propinas/venta-propina.service';
import { CatalogService } from '../catalog/catalog.service';
import { GarzonesService } from '../garzones/garzones.service';
import { UbicacionesService } from '../ubicaciones/ubicaciones.service';
import { EstadoVenta, Venta } from './entities/venta.entity';
import { VentaDetalle } from './entities/venta-detalle.entity';
import { VentaDescuento } from './entities/venta-descuento.entity';
import { VentaRecargo } from './entities/venta-recargo.entity';
import { VentaImpuesto } from './entities/venta-impuesto.entity';
import { VentaPromocion } from './entities/venta-promocion.entity';
import { VentaCustomer } from './entities/venta-customer.entity';
import { huellaDe } from '../idempotencia/huella';
import {
  IdempotenciaService,
  type SolicitudIdempotenteInput,
} from '../idempotencia/idempotencia.service';

/**
 * El tipo "nota de crédito" que el service resuelve por país. Antes era una
 * constante exportada por la entidad; desde el 2026-09-03 sale del catálogo
 * (`es_nota_credito` + país del tenant), así que acá es lo que devuelve el
 * mock de `db.query` — el valor sigue siendo el de la fila chilena, que es el
 * país del tenant de estos tests.
 */
const TIPO_DOCUMENTO_NC_ID = '550e8400-e29b-41d4-a716-446655440218';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const USUARIO_ID = '550e8400-e29b-41d4-a716-446655440056';
const CAJA_ID = 'caja-uuid-001';
const MONEDA_OFICIAL_ID = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const ITEM_ID = '550e8400-e29b-41d4-a716-446655440116';
const ITEM_AJUSTE_ID = '550e8400-e29b-41d4-a716-446655440381';
const UBICACION_LOCAL_ID = '550e8400-e29b-41d4-a716-446655440400';

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
  // 4 = el máximo que admite el sistema (UF): la escala más fina con la que el
  // motor puede cuantizar.
  decimalesMoneda: 4,
  promosAcumulanDescuentos: false,
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
      trazas: { descuentos: [], recargos: [], impuestos: [], promociones: [] },
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
    // Es del tenant y no de la moneda: sale repetido en cada fila.
    facturador: 'sistema',
  },
  {
    moneda_id: MONEDA_OFICIAL_ID,
    valor_del_dia: '1.000000',
    es_oficial: true,
    facturador: 'sistema',
    // 4 = el máximo que admite el sistema (UF): la escala más fina con la que
    // el motor puede cuantizar.
    decimales: 4,
  },
];

function buildManagerMock() {
  const venta = { id: 'venta-uuid-001' };
  // Lo que devuelve `recalcularEstadoDeLaVenta` (la regla única del estado, que es
  // SQL y un mock de `query` no la ve: la corre el e2e). Los casos que prueban otro
  // estado lo pisan.
  const recalculo = { estado: 'pagada', saldo: '0.0000' };
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
    // Tarea 4 (`docs/superpowers/specs/2026-09-17-boleta-desde-la-venta-design.md`):
    // `crear()` arma la boleta con ESTE mismo `manager` antes de retornar
    // (`armarBoleta(manager, …)`), así que su consulta de CABECERA
    // (`FROM ventas v`) necesita al menos una fila o tira 404 — y con eso
    // reventarían los ~40 tests de este archivo que llaman `service.crear()`
    // sin afirmar nada sobre `result.boleta`. El resto de las tablas de la
    // boleta (detalles, impuestos, pagos…) se queda en `[]`: nadie en este
    // describe mira `result.boleta.items`, eso lo cubre `armarBoleta()` en el
    // suyo, más abajo, con su propio dispatcher completo.
    recalculo,
    query: jest.fn().mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('WITH s AS'))
        return Promise.resolve([{ ...recalculo }]);
      if (typeof sql === 'string' && sql.includes('FROM ventas v')) {
        return Promise.resolve([
          {
            venta_id: venta.id,
            fecha: new Date(),
            canal: 'fisico',
            total_bruto: '0.0000',
            total_descuentos: '0.0000',
            total_recargos: '0.0000',
            total_impuestos: '0.0000',
            total_final: '0.0000',
            cuenta_numero: null,
            mesa_nombre: null,
            cajero_nombre: null,
            cajero_apellido: null,
          },
        ]);
      }
      return Promise.resolve([]);
    }),
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
  let dbService: Db;
  let cajaService: jest.Mocked<CajaService>;
  let idempotencia: { ejecutar: jest.Mock };
  let calculoPreciosService: jest.Mocked<CalculoPreciosService>;
  let inventarioService: jest.Mocked<InventarioService>;
  let itemsService: jest.Mocked<ItemsService>;
  let pagosServiceMock: { registrar: jest.Mock };
  let ventaDocumentosMock: {
    documentarVenta: jest.Mock;
    descartarAlAnular: jest.Mock;
    listarParaDetalle: jest.Mock;
    evaluarAnulacion: jest.Mock;
    ventaDocumentada: jest.Mock;
    completarNumero: jest.Mock;
    documentoQueCorrige: jest.Mock;
    exigirTopeDelDocumento: jest.Mock;
    documentarCorreccion: jest.Mock;
    opcionesDevolucion: jest.Mock;
    devolvibleDelPagoUnico: jest.Mock;
  };
  let ventaPropinaServiceMock: { crearEnTransaccion: jest.Mock };
  let garzonesServiceMock: {
    asegurarMostrador: jest.Mock;
    obtenerActivoPorId: jest.Mock;
  };
  let catalogService: jest.Mocked<CatalogService>;
  let ubicacionesService: { localDe: jest.Mock };
  let dataSourceMock: { transaction: jest.Mock; query: jest.Mock };
  /**
   * Unidades ya comprometidas por devoluciones previas, por ítem. Vive en el
   * scope de afuera porque la consulta va por `db.query` —la misma para la
   * transacción de la nota y para la lectura del detalle— y el mock de `db` se
   * arma acá.
   */
  let unidadesComprometidasRows: { item_id: string; devuelto: string }[] = [];
  /**
   * El remanente acreditable por porción fiscal que `findOne` expone. Vive acá
   * por lo mismo que el contador: la consulta va por `db.query`.
   */
  let disponiblePorPorcionRows: { clasificacion: string; monto: string }[] = [];

  beforeEach(async () => {
    const manager = buildManagerMock();
    pagosServiceMock = {
      registrar: jest.fn().mockResolvedValue({
        pagos: [],
        montoAplicadoVenta: '0.0000',
        porPago: [],
      }),
    };
    ventaDocumentosMock = {
      documentarVenta: jest.fn().mockResolvedValue([]),
      descartarAlAnular: jest.fn().mockResolvedValue(undefined),
      listarParaDetalle: jest.fn().mockResolvedValue([]),
      evaluarAnulacion: jest
        .fn()
        .mockResolvedValue({ resultado: 'anulable', descartes: [] }),
      ventaDocumentada: jest.fn().mockResolvedValue(false),
      completarNumero: jest.fn(),
      // Por defecto la nota corrige la boleta del sistema y no mueve caja: los
      // casos que prueban otra cosa lo pisan.
      documentoQueCorrige: jest.fn().mockResolvedValue({
        documento: { id: 'doc-boleta', emisor: 'sistema', monto: '11305.0000' },
        saldo: null,
        mueveCaja: false,
        devolvibleDelPago: null,
      }),
      exigirTopeDelDocumento: jest.fn().mockResolvedValue(undefined),
      devolvibleDelPagoUnico: jest.fn().mockResolvedValue(null),
      documentarCorreccion: jest.fn().mockResolvedValue({ id: 'doc-nc' }),
      // Una opción: lo mínimo para que el detalle ofrezca acreditar.
      opcionesDevolucion: jest.fn().mockResolvedValue([
        {
          pagoId: 'pago-1',
          sinPlata: false,
          metodo: 'Efectivo',
          monto: '11305.0000',
          mueveCaja: true,
          registro: 'nota_credito_sistema',
        },
      ]),
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
      // Despacha por SQL: la resolución del tipo "nota de crédito" del país es
      // la única consulta que nombra `es_nota_credito`; todo lo demás que pasa
      // por `db.query` en estos tests son las filas de moneda.
      query: jest.fn().mockImplementation((sql: string) => {
        if (typeof sql !== 'string') return Promise.resolve(MONEDA_ROWS);
        if (sql.includes('es_nota_credito'))
          return Promise.resolve([{ tipo_documento_id: TIPO_DOCUMENTO_NC_ID }]);
        // El contador de unidades ya comprometidas por devoluciones previas.
        // Va por `db.query` y no por el manager: adentro de la transacción
        // `db.query` resuelve el manager activo (ADR-020), y afuera —en
        // `findOne`— el pool.
        if (sql.includes('WITH docs AS'))
          return Promise.resolve(unidadesComprometidasRows);
        if (sql.includes('AS clasificacion'))
          return Promise.resolve(disponiblePorPorcionRows);
        return Promise.resolve(MONEDA_ROWS);
      }),
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
            // Pasa la operación tal cual y deja pasar el error: lo que este
            // spec fija es que `ventas` ENTREGA el intento con los datos
            // correctos. Que el rastro sobreviva al rollback lo fija
            // `caja.service.spec.ts` (unit) y el e2e (contra la base real).
            conRastroDeRechazo: jest.fn(
              (_tenantId: string, fn: () => Promise<unknown>) => fn(),
            ),
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
            // Frente de bodegas y traslados: el 400 enriquecido del tope al
            // cobrar. Rechaza distinto del genérico de `registrarMovimiento`
            // para que los tests de este archivo puedan distinguir "el catch de
            // `crear()` corrió" de "el genérico se propagó sin enriquecer".
            errorStockInsuficienteEnLocal: jest
              .fn()
              .mockResolvedValue(new BadRequestException('enriquecido-mock')),
            // El ítem de sistema del que cuelga la línea de ajuste de una nota
            // de crédito. `tipo: 'servicio'` no es decorativo: de ahí sale la
            // unidad base de esa línea (`resolverUnidadBaseDeItem`).
            asegurarItemAjuste: jest.fn().mockResolvedValue({
              id: ITEM_AJUSTE_ID,
              tipo: 'servicio',
            }),
          },
        },
        {
          provide: PagosService,
          useValue: pagosServiceMock,
        },
        {
          provide: VentaDocumentosService,
          useValue: ventaDocumentosMock,
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
          provide: UbicacionesService,
          useValue: {
            localDe: jest.fn().mockResolvedValue(UBICACION_LOCAL_ID),
          },
        },
        // Pasa-manos (`docs/patterns/backend.md` § 18): `crear` sin clave (el
        // camino de Webpay) no lo toca, y la nota manual corre su operación tal
        // cual. Reclamo, reproducción y 422 se prueban en su propio spec y en el
        // e2e contra Postgres real.
        {
          provide: IdempotenciaService,
          useValue: {
            ejecutar: jest.fn((_s: unknown, operar: () => Promise<unknown>) =>
              operar(),
            ),
          },
        },
        {
          provide: Db,
          useValue: dbMock,
        },
      ],
    }).compile();

    service = module.get<VentasService>(VentasService);
    dbService = module.get(Db);
    cajaService = module.get(CajaService);
    idempotencia = module.get(IdempotenciaService);
    calculoPreciosService = module.get(CalculoPreciosService);
    inventarioService = module.get(InventarioService);
    itemsService = module.get(ItemsService);
    catalogService = module.get(CatalogService);
    ubicacionesService = module.get(UbicacionesService);
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
        porPago: [
          {
            pagoId: 'pago-uuid-001',
            metodoPagoId: EFECTIVO_ID,
            emisor: 'sistema',
            esEfectivo: true,
            aplicadoVenta: '100.0000',
          },
        ],
      });
      const result = await service.crear(TENANT_ID, USUARIO_ID, baseDto);
      expect(result).toBeDefined();

      expect(calculoPreciosService.calcular).toHaveBeenCalled();
      expect(dataSourceMock.transaction).toHaveBeenCalled();
      expect(result.estado).toBe(EstadoVenta.PAGADA);
    });

    it('el estado de la venta nueva es el que dice la regla única del estado, bajo el tenant del token', async () => {
      // La regla (sin saldo → pagada; con saldo y algo aplicado → pagada_parcial;
      // si no, pendiente) es SQL compartido con el abono y las correcciones
      // ("saldo-venta.ts"): un mock no la ve y la cubre el e2e. Acá se afirma que
      // `crear` NO decide el estado por su cuenta: devuelve el que ella calculó.
      const manager = buildManagerMock();
      manager.recalculo.estado = 'pendiente';
      dataSourceMock.transaction.mockImplementationOnce(
        (cb: (m: typeof manager) => unknown) => cb(manager),
      );

      const result = await service.crear(TENANT_ID, USUARIO_ID, baseDto);

      expect(result.estado).toBe(EstadoVenta.PENDIENTE);
      const llamada = manager.query.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('WITH s AS'),
      );
      expect(llamada?.[1]).toEqual(['venta-uuid-001', TENANT_ID]);
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

    it('resuelve la ubicación local UNA vez para todo el carrito, no una por línea', async () => {
      // Guarda contra la regresión al N+1 del chokepoint de bodegas:
      // `ubicacionLocalId` se resuelve acá y baja por parámetro a
      // `venderIngredientesReceta`/`venderComponentesCombo`, que a su vez lo
      // vuelven a bajar a sus propias expansiones internas (ingredientes de
      // receta, componentes de combo, opciones de grupo). Si cualquier eslabón
      // de esa cadena vuelve a resolverlo por su cuenta, `localDe` se llama más
      // de una vez por venta y este test lo caza.
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

      expect(ubicacionesService.localDe).toHaveBeenCalledTimes(1);
      const ubicacionLocalId =
        await ubicacionesService.localDe.mock.results[0].value;
      const recetaArgs = (itemsService.venderIngredientesReceta as jest.Mock)
        .mock.calls[0][1] as { ubicacionLocalId: unknown };
      const comboArgs = (itemsService.venderComponentesCombo as jest.Mock).mock
        .calls[0][1] as { ubicacionLocalId: unknown };
      expect(recetaArgs.ubicacionLocalId).toBe(ubicacionLocalId);
      expect(comboArgs.ubicacionLocalId).toBe(ubicacionLocalId);
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
        porPago: [
          {
            pagoId: 'pago-uuid-001',
            metodoPagoId: EFECTIVO_ID,
            emisor: 'sistema',
            esEfectivo: true,
            aplicadoVenta: '100.0000',
          },
        ],
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
              promociones: [],
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
          promociones: [],
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

    it('congela la promo por línea, cruzada por índice (2 trazas, líneas 0 y 1)', async () => {
      const trazaPromo = (over: Record<string, unknown> = {}) => ({
        id: 'promo-1',
        nombre: '2x1 martes',
        tipo: 'nxm',
        monto: '500.0000',
        valorEfectivo: '1.0000',
        aplicacion: 1,
        ...over,
      });
      calculoPreciosService.calcular.mockResolvedValueOnce({
        ...mockResultadoVenta,
        lineas: [
          {
            ...mockResultadoVenta.lineas[0],
            trazas: {
              descuentos: [],
              recargos: [],
              impuestos: [],
              promociones: [trazaPromo()],
            },
          },
          {
            ...mockResultadoVenta.lineas[0],
            trazas: {
              descuentos: [],
              recargos: [],
              impuestos: [],
              promociones: [trazaPromo({ monto: '300.0000', aplicacion: 2 })],
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

      // Un solo round-trip con las dos filas adentro.
      const savesPromo = manager.save.mock.calls.filter(
        (call) => call[0] === VentaPromocion,
      );
      expect(savesPromo).toHaveLength(1);

      const filas = savesPromo[0][1] as Record<string, unknown>[];
      expect(filas).toEqual([
        expect.objectContaining({
          ventaId: 'venta-uuid-001',
          detalleId: 'detalle-uuid-001',
          promocionId: 'promo-1',
          nombrePromocion: '2x1 martes',
          tipo: 'nxm',
          valorEfectivo: '1.0000',
          monto: '500.0000',
          aplicacion: 1,
        }),
        expect.objectContaining({
          // La segunda línea, no la primera: mismo bug que atrapa el test
          // gemelo de descuentos, acá con el cruce traza→detalle por índice.
          detalleId: 'detalle-uuid-002',
          promocionId: 'promo-1',
          monto: '300.0000',
          aplicacion: 2,
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
              promociones: [],
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
              promociones: [],
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
              promociones: [],
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
      // El fixture base trae `trazas.promociones: []`: cero trazas de promo,
      // cero filas y cero round-trip extra — mismo criterio que las otras tres.
      expect(entidadesGuardadas).not.toContain(VentaPromocion);
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

    describe('productos con número de serie: quien vende elige las unidades', () => {
      const U1 = '11111111-1111-4111-8111-111111111111';
      const U2 = '22222222-2222-4222-8222-222222222222';
      const itemSerie = {
        ...mockItem,
        nombre: 'Celular',
        modoInventario: 'serie',
        unidadMedida: 'unidad',
      };
      const venderSerie = (lineas: Record<string, unknown>[]) =>
        service.crear(TENANT_ID, USUARIO_ID, { ...baseDto, lineas } as never);

      beforeEach(() => {
        itemsService.cargarBasePorIds.mockImplementation(mapaDe(itemSerie));
      });

      it('pasa la cuenta que se cobra al chokepoint, junto con las unidades', async () => {
        await service.crearEnTransaccion(
          buildManagerMock() as never,
          TENANT_ID,
          USUARIO_ID,
          {
            ...baseDto,
            lineas: [{ itemId: ITEM_ID, cantidad: '1', unidadIds: [U1] }],
          },
          'cuenta-1',
        );

        expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            cuentaId: 'cuenta-1',
            unidadIds: [U1],
          }),
        );
      });

      it.each([
        ['sin unidadIds', { cantidad: '1' }],
        ['con unidadIds vacío', { cantidad: '1', unidadIds: [] }],
      ])('%s: pide elegir y no toca el stock', async (_caso, extra) => {
        await expect(
          venderSerie([{ itemId: ITEM_ID, ...extra }]),
        ).rejects.toThrow(
          'Elegí qué unidades salen: «Celular» tiene número de serie',
        );
        expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
      });

      it.each([
        ['2', [U1], '2', '1'],
        ['1', [U1, U2], '1', '2'],
        ['1.5', [U1], '1.5', '1'],
      ])(
        'cantidad %s con %j unidades: no coincide',
        async (cantidad, unidadIds, n, m) => {
          await expect(
            venderSerie([{ itemId: ITEM_ID, cantidad, unidadIds }]),
          ).rejects.toThrow(
            `«Celular»: la cantidad (${n}) no coincide con las unidades elegidas (${m})`,
          );
          expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
        },
      );

      it('la misma unidad en dos líneas, aunque una venga en mayúsculas, se rechaza', async () => {
        await expect(
          venderSerie([
            { itemId: ITEM_ID, cantidad: '1', unidadIds: [U1] },
            { itemId: ITEM_ID, cantidad: '1', unidadIds: [U1.toUpperCase()] },
          ]),
        ).rejects.toThrow('Una unidad viene repetida en la venta');
        expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
      });

      it('una presentación distinta de la unidad base se rechaza con el texto de la merma', async () => {
        itemsService.cargarBasePorIds.mockImplementation(
          mapaDe({ ...itemSerie, unidadMedida: 'kg' }),
        );
        await expect(
          venderSerie([
            {
              itemId: ITEM_ID,
              cantidad: '1',
              cantidadPresentacion: '1000',
              unidadCodigoPresentacion: 'g',
              unidadIds: [U1],
            },
          ]),
        ).rejects.toThrow(
          'Los productos por serie o lote solo admiten su unidad base',
        );
        expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
      });

      it('unidadIds en un producto que no es de serie se rechaza', async () => {
        itemsService.cargarBasePorIds.mockImplementation(mapaDe(mockItem));
        await expect(
          venderSerie([{ itemId: ITEM_ID, cantidad: '1', unidadIds: [U1] }]),
        ).rejects.toThrow(
          '«Smartphone» no tiene número de serie: no lleva unidades',
        );
        expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
      });
    });

    /**
     * Frente de bodegas y traslados: el chokepoint de inventario rechaza con un
     * mensaje genérico —"Stock insuficiente para la salida", sin nombrar el
     * ítem ni el lugar— porque no sabe qué línea de qué venta lo llamó.
     * `crear()` lo intercepta y lo reemplaza por el enriquecido de
     * `ItemsService.errorStockInsuficienteEnLocal`, con los mismos datos que ya
     * tenía en la línea (`item.id`, `item.nombre`, la cantidad pedida y la
     * unidad).
     */
    it('el genérico de "Stock insuficiente para la salida" se reemplaza por el enriquecido, con el ítem y la cantidad de la línea', async () => {
      inventarioService.registrarMovimiento.mockRejectedValueOnce(
        new BadRequestException('Stock insuficiente para la salida'),
      );

      await expect(
        service.crear(TENANT_ID, USUARIO_ID, baseDto),
      ).rejects.toThrow('enriquecido-mock');

      expect(itemsService.errorStockInsuficienteEnLocal).toHaveBeenCalledWith(
        TENANT_ID,
        mockItem.id,
        mockItem.nombre,
        expect.any(Decimal),
        mockItem.unidadMedida,
      );
      const [, , , cantidadArg] = (
        itemsService.errorStockInsuficienteEnLocal as jest.Mock
      ).mock.calls[0];
      expect((cantidadArg as InstanceType<typeof Decimal>).toString()).toBe(
        baseDto.lineas[0].cantidad,
      );
    });

    /**
     * El catch es específico: otro 400 del mismo chokepoint (series, lotes,
     * o cualquier otro motivo) NO se reemplaza — el enriquecido de acá arriba
     * solo tiene sentido para el mensaje EXACTO de `moverCantidad`, y pisar
     * cualquier otro sería mentir sobre por qué rebotó.
     */
    it('otro 400 del chokepoint de inventario NO se reemplaza', async () => {
      inventarioService.registrarMovimiento.mockRejectedValueOnce(
        new BadRequestException('Unidad no encontrada'),
      );

      await expect(
        service.crear(TENANT_ID, USUARIO_ID, baseDto),
      ).rejects.toThrow('Unidad no encontrada');
      expect(itemsService.errorStockInsuficienteEnLocal).not.toHaveBeenCalled();
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
        porPago: [
          {
            pagoId: 'pago-uuid-001',
            metodoPagoId: EFECTIVO_ID,
            emisor: 'sistema',
            esEfectivo: true,
            aplicadoVenta: '100.0000',
          },
        ],
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
        porPago: [
          {
            pagoId: 'pago-uuid-tip',
            metodoPagoId: EFECTIVO_ID,
            emisor: 'sistema',
            esEfectivo: true,
            aplicadoVenta: '100.0000',
          },
        ],
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

  describe('crear() — el tipo de documento lo resuelve el servidor', () => {
    // Catálogo mínimo de dos países, con las formas que importan: la boleta, una
    // factura, la NC (inactiva, como en el seed), un tipo inactivo y los de otro
    // país. El fake de `manager.query` aplica sobre él la misma regla que el SQL
    // de `resolverTipoDocumento` (país del tenant; el id pedido o la boleta
    // activa), así el test no trae la respuesta ya hecha: la consulta real la
    // cubre el e2e.
    const BOLETA = '550e8400-e29b-41d4-a716-446655440145';
    const FACTURA = '550e8400-e29b-41d4-a716-446655440146';
    const TIPO_INACTIVO = '550e8400-e29b-41d4-a716-446655440147';
    const NC_ARGENTINA = '550e8400-e29b-41d4-a716-446655440378';
    // No sembrado: un tipo `customer_requerido` de otro país, para fijar que
    // ahí conserva el significado viejo (exige solo el nombre).
    const FACTURA_ARGENTINA = '550e8400-e29b-41d4-a716-446655449998';
    /** El receptor completo que la Factura chilena exige (SII, Formato DTE). */
    const RECEPTOR_FACTURA = {
      nombre: 'Comercial Andes SpA',
      rut: '76.543.210-3',
      giro: 'Venta de artículos de ferretería',
      direccion: 'Av. Matta 1234',
      comuna: 'Santiago',
    };
    const MENSAJE_CUSTOMER_REQUERIDO =
      'Este tipo de documento requiere los datos del cliente';
    const tipo = (
      id: string,
      pais: string,
      extra: Partial<{
        es_boleta: boolean;
        es_nota_credito: boolean;
        activo: boolean;
        customer_requerido: boolean;
      }> = {},
    ) => ({
      tipo_documento_id: id,
      pais,
      es_boleta: false,
      es_nota_credito: false,
      activo: true,
      customer_requerido: false,
      ...extra,
    });
    const CATALOGO = [
      tipo(BOLETA, 'CL', { es_boleta: true }),
      tipo(FACTURA, 'CL', { customer_requerido: true }),
      tipo(TIPO_DOCUMENTO_NC_ID, 'CL', {
        es_nota_credito: true,
        activo: false,
      }),
      tipo(TIPO_INACTIVO, 'CL', { activo: false }),
      tipo(NC_ARGENTINA, 'AR', { es_nota_credito: true, activo: false }),
      tipo(FACTURA_ARGENTINA, 'AR', { customer_requerido: true }),
    ];

    let paisDelTenant: string;
    let manager: ReturnType<typeof buildManagerMock>;

    const consultasDeTipo = () =>
      manager.query.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('es_boleta'),
      );
    const tipoGuardado = () => {
      const ventas = manager.save.mock.calls.filter((c) => c[0] === Venta);
      return (ventas[0]?.[1] as { tipoDocumentoId: string | null } | undefined)
        ?.tipoDocumentoId;
    };

    beforeEach(() => {
      paisDelTenant = 'CL';
      manager = buildManagerMock();
      const queryBase = manager.query.getMockImplementation()!;
      manager.query.mockImplementation((sql: string, params?: unknown[]) => {
        if (typeof sql === 'string' && sql.includes('es_boleta')) {
          const pedido = params?.[1] ?? null;
          const filas = CATALOGO.filter(
            (t) =>
              t.pais === paisDelTenant &&
              (t.tipo_documento_id === pedido ||
                (t.es_boleta && t.activo && !t.es_nota_credito)),
          ).map((t) => ({
            codigo_iso: paisDelTenant,
            tipo_documento_id: t.tipo_documento_id,
            es_boleta: t.es_boleta,
            es_nota_credito: t.es_nota_credito,
            activo: t.activo,
            customer_requerido: t.customer_requerido,
          }));
          // `LEFT JOIN`: sin tipo que calce, igual vuelve el país.
          return Promise.resolve(
            filas.length
              ? filas
              : [
                  {
                    codigo_iso: paisDelTenant,
                    tipo_documento_id: null,
                    es_boleta: null,
                    es_nota_credito: null,
                    activo: null,
                    customer_requerido: null,
                  },
                ],
          );
        }
        return queryBase(sql);
      });
      dataSourceMock.transaction.mockImplementation(
        (cb: (m: typeof manager) => unknown) => cb(manager),
      );
    });

    it('sin tipoDocumentoId la venta nace con la boleta del país', async () => {
      await service.crear(TENANT_ID, USUARIO_ID, baseDto);

      expect(tipoGuardado()).toBe(BOLETA);
    });

    it('un tipo del país, activo y que no es NC se respeta', async () => {
      await service.crear(TENANT_ID, USUARIO_ID, {
        ...baseDto,
        tipoDocumentoId: FACTURA,
        customer: RECEPTOR_FACTURA,
      });

      expect(tipoGuardado()).toBe(FACTURA);
    });

    it('rechaza con 400 un tipo con customer_requerido sin customer, sin escribir la venta', async () => {
      await expect(
        service.crear(TENANT_ID, USUARIO_ID, {
          ...baseDto,
          tipoDocumentoId: FACTURA,
        }),
      ).rejects.toThrow(new BadRequestException(MENSAJE_CUSTOMER_REQUERIDO));
      expect(tipoGuardado()).toBeUndefined();
    });

    it('un customer con el nombre en blanco no cuenta como customer (la pantalla hace trim)', async () => {
      await expect(
        service.crear(TENANT_ID, USUARIO_ID, {
          ...baseDto,
          tipoDocumentoId: FACTURA,
          customer: { nombre: '   ' },
        }),
      ).rejects.toThrow(new BadRequestException(MENSAJE_CUSTOMER_REQUERIDO));
      expect(tipoGuardado()).toBeUndefined();
    });

    it('la boleta no exige customer', async () => {
      await service.crear(TENANT_ID, USUARIO_ID, {
        ...baseDto,
        tipoDocumentoId: BOLETA,
      });

      expect(tipoGuardado()).toBe(BOLETA);
    });

    it('rechaza con 400 un tipo de otro país, sin escribir la venta', async () => {
      await expect(
        service.crear(TENANT_ID, USUARIO_ID, {
          ...baseDto,
          tipoDocumentoId: NC_ARGENTINA,
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'El tipo de documento no corresponde al país del comercio',
        ),
      );
      expect(tipoGuardado()).toBeUndefined();
    });

    it('rechaza con 400 un id que no existe en el catálogo', async () => {
      await expect(
        service.crear(TENANT_ID, USUARIO_ID, {
          ...baseDto,
          tipoDocumentoId: '550e8400-e29b-41d4-a716-446655449999',
        }),
      ).rejects.toThrow(
        'El tipo de documento no corresponde al país del comercio',
      );
    });

    it('rechaza con 400 la nota de crédito: nace de un reembolso, no de una venta', async () => {
      await expect(
        service.crear(TENANT_ID, USUARIO_ID, {
          ...baseDto,
          tipoDocumentoId: TIPO_DOCUMENTO_NC_ID,
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'La nota de crédito no se elige: la genera el sistema al reembolsar',
        ),
      );
      expect(tipoGuardado()).toBeUndefined();
    });

    it('rechaza con 400 un tipo inactivo', async () => {
      await expect(
        service.crear(TENANT_ID, USUARIO_ID, {
          ...baseDto,
          tipoDocumentoId: TIPO_INACTIVO,
        }),
      ).rejects.toThrow(
        new BadRequestException('El tipo de documento no está activo'),
      );
      expect(tipoGuardado()).toBeUndefined();
    });

    // Sin customer a propósito: la factura del body no exige nada porque el
    // tipo que se mira es el resuelto (la boleta), no el pedido.
    it('online: siempre la boleta, aunque el body traiga otro tipo, y ni lo consulta', async () => {
      await service.crear(TENANT_ID, USUARIO_ID, {
        ...baseDto,
        canal: 'online',
        tipoDocumentoId: FACTURA,
      });

      expect(tipoGuardado()).toBe(BOLETA);
      // El `canal` guardado decide: el id del body no llega a la consulta.
      expect(consultasDeTipo()[0]![1]).toEqual([TENANT_ID, null]);
    });

    it('online con un tipo inválido en el body no falla: se ignora', async () => {
      await service.crear(TENANT_ID, USUARIO_ID, {
        ...baseDto,
        canal: 'online',
        tipoDocumentoId: TIPO_DOCUMENTO_NC_ID,
      });

      expect(tipoGuardado()).toBe(BOLETA);
    });

    it('un país sin boleta sembrada deja el tipo en null, como hoy', async () => {
      paisDelTenant = 'AR';

      await service.crear(TENANT_ID, USUARIO_ID, baseDto);
      expect(tipoGuardado()).toBeNull();
    });

    it('un país sin boleta: online tampoco inventa un tipo', async () => {
      paisDelTenant = 'AR';

      await service.crear(TENANT_ID, USUARIO_ID, {
        ...baseDto,
        canal: 'online',
      });
      expect(tipoGuardado()).toBeNull();
    });

    it('una sola lectura por venta, sin importar cuántas líneas lleva', async () => {
      const dtoTresLineas = {
        ...baseDto,
        tipoDocumentoId: FACTURA,
        customer: RECEPTOR_FACTURA,
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

      expect(consultasDeTipo()).toHaveLength(1);
    });

    describe('el receptor, según el país', () => {
      const customerGuardado = () => {
        const filas = manager.save.mock.calls.filter(
          (c) => c[0] === VentaCustomer,
        );
        return filas[0]?.[1] as Record<string, unknown> | undefined;
      };
      const facturaCon = (customer: Record<string, string>) =>
        service.crear(TENANT_ID, USUARIO_ID, {
          ...baseDto,
          tipoDocumentoId: FACTURA,
          customer: customer as typeof RECEPTOR_FACTURA,
        });

      it('Chile: la Factura con solo el nombre nombra lo que falta, sin escribir la venta', async () => {
        await expect(
          facturaCon({ nombre: 'Comercial Andes SpA' }),
        ).rejects.toThrow(
          new BadRequestException(
            'Este tipo de documento requiere del cliente: RUT, giro, dirección, comuna',
          ),
        );
        expect(tipoGuardado()).toBeUndefined();
      });

      it.each([
        ['rut', 'RUT'],
        ['giro', 'giro'],
        ['direccion', 'dirección'],
        ['comuna', 'comuna'],
      ])(
        'Chile: la Factura con %s en blanco es un 400 que lo nombra',
        async (campo, nombre) => {
          await expect(
            facturaCon({ ...RECEPTOR_FACTURA, [campo]: '   ' }),
          ).rejects.toThrow(
            new BadRequestException(
              `Este tipo de documento requiere del cliente: ${nombre}`,
            ),
          );
        },
      );

      it('Chile: la Factura completa congela el RUT normalizado, el giro y la comuna, sin bordes', async () => {
        await facturaCon({
          ...RECEPTOR_FACTURA,
          nombre: '  Comercial Andes SpA ',
          giro: ' Venta de artículos de ferretería ',
          comuna: ' Santiago ',
        });

        expect(customerGuardado()).toMatchObject({
          nombre: 'Comercial Andes SpA',
          rut: '76543210-3',
          giro: 'Venta de artículos de ferretería',
          direccion: 'Av. Matta 1234',
          comuna: 'Santiago',
        });
      });

      it('Chile: un RUT con el DV equivocado es 400 en la Factura', async () => {
        await expect(
          facturaCon({ ...RECEPTOR_FACTURA, rut: '76.543.210-5' }),
        ).rejects.toThrow(
          new BadRequestException('El RUT del cliente no es válido'),
        );
        expect(tipoGuardado()).toBeUndefined();
      });

      it('Chile: un RUT con el DV equivocado es 400 también en una boleta', async () => {
        await expect(
          service.crear(TENANT_ID, USUARIO_ID, {
            ...baseDto,
            customer: { nombre: 'Juan Pérez', rut: '76.543.210-5' },
          }),
        ).rejects.toThrow(
          new BadRequestException('El RUT del cliente no es válido'),
        );
      });

      // Lo cazó la revisión de seguridad: el nombre en blanco salía antes de
      // mirar el RUT, y un RUT basura quedaba congelado en la boleta.
      it('Chile: un RUT malo es 400 aunque el nombre venga en blanco', async () => {
        await expect(
          service.crear(TENANT_ID, USUARIO_ID, {
            ...baseDto,
            customer: { nombre: '   ', rut: 'basura' },
          }),
        ).rejects.toThrow(
          new BadRequestException('El RUT del cliente no es válido'),
        );
      });

      it('Chile: una boleta con customer sin RUT no exige nada más', async () => {
        await service.crear(TENANT_ID, USUARIO_ID, {
          ...baseDto,
          customer: { nombre: 'Juan Pérez' },
        });

        expect(customerGuardado()).toMatchObject({
          nombre: 'Juan Pérez',
          rut: null,
          giro: null,
          comuna: null,
        });
      });

      it('otro país: el tipo customer_requerido exige solo el nombre y el RUT no se mira', async () => {
        paisDelTenant = 'AR';
        await service.crear(TENANT_ID, USUARIO_ID, {
          ...baseDto,
          tipoDocumentoId: FACTURA_ARGENTINA,
          customer: { nombre: 'Distribuidora Sur SA', rut: '20-12345678-9' },
        });

        expect(customerGuardado()).toMatchObject({
          nombre: 'Distribuidora Sur SA',
          rut: '20-12345678-9',
        });
      });

      it('otro país sin tipo: el customer pasa sin chequeo de RUT', async () => {
        paisDelTenant = 'AR';
        await service.crear(TENANT_ID, USUARIO_ID, {
          ...baseDto,
          customer: { nombre: 'Distribuidora Sur SA', rut: '20-12345678-9' },
        });

        expect(tipoGuardado()).toBeNull();
        expect(customerGuardado()).toMatchObject({ rut: '20-12345678-9' });
      });
    });

    describe('resolverTipoDocumento()', () => {
      // Lo consume la emisión (tarea 4): cuál es el tipo y si es boleta.
      const resolver = (id: string | undefined, canal: 'fisico' | 'online') =>
        (
          service as unknown as {
            resolverTipoDocumento: (
              m: typeof manager,
              tenantId: string,
              id: string | undefined,
              canal: string,
              customer: { nombre: string } | undefined,
            ) => Promise<{ id: string | null; esBoleta: boolean }>;
          }
        ).resolverTipoDocumento(
          manager,
          TENANT_ID,
          id,
          canal,
          RECEPTOR_FACTURA,
        );

      it('la boleta del país es boleta', async () => {
        expect(await resolver(undefined, 'fisico')).toMatchObject({
          id: BOLETA,
          esBoleta: true,
        });
        expect(await resolver(BOLETA, 'fisico')).toMatchObject({
          id: BOLETA,
          esBoleta: true,
        });
      });

      it('una factura no es boleta', async () => {
        expect(await resolver(FACTURA, 'fisico')).toMatchObject({
          id: FACTURA,
          esBoleta: false,
        });
      });

      it('sin boleta en el país no hay tipo ni es boleta', async () => {
        paisDelTenant = 'AR';
        expect(await resolver(undefined, 'fisico')).toMatchObject({
          id: null,
          esBoleta: false,
        });
      });
    });
  });

  describe('crear() — los documentos de la venta', () => {
    // La resolución de quién emite cada documento vive en `VentaDocumentosService`
    // (su spec la prueba entera). Lo que le toca probar a ventas es que se lo
    // **llama** una vez, dentro de la transacción, después de registrar los
    // pagos, y con los datos que ya tiene en memoria.
    const BOLETA = '550e8400-e29b-41d4-a716-446655440145';
    const FACTURA = '550e8400-e29b-41d4-a716-446655440146';
    const ITEM_EXENTO_ID = '550e8400-e29b-41d4-a716-446655440999';
    const TARJETA_ID = '550e8400-e29b-41d4-a716-446655440200';
    let manager: ReturnType<typeof buildManagerMock>;

    beforeEach(() => {
      manager = buildManagerMock();
      const queryBase = manager.query.getMockImplementation()!;
      manager.query.mockImplementation((sql: string) => {
        if (typeof sql === 'string' && sql.includes('es_boleta'))
          return Promise.resolve(
            [
              [BOLETA, true],
              [FACTURA, false],
            ].map(([id, esBoleta]) => ({
              tipo_documento_id: id,
              es_boleta: esBoleta,
              es_nota_credito: false,
              activo: true,
            })),
          );
        return queryBase(sql);
      });
      dataSourceMock.transaction.mockImplementation(
        (cb: (m: typeof manager) => unknown) => cb(manager),
      );
    });

    const llamada = () =>
      ventaDocumentosMock.documentarVenta.mock.calls[0] as [
        unknown,
        Record<string, any>,
      ];

    it('documenta una vez, con el manager de la transacción y los datos de la venta', async () => {
      await service.crear(TENANT_ID, USUARIO_ID, baseDto);

      expect(ventaDocumentosMock.documentarVenta).toHaveBeenCalledTimes(1);
      const [m, p] = llamada();
      expect(m).toBe(manager);
      expect(p).toMatchObject({
        tenantId: TENANT_ID,
        facturador: 'sistema',
        venta: {
          id: 'venta-uuid-001',
          tipoDocumentoId: BOLETA,
          esBoleta: true,
          canal: 'fisico',
          totalFinal: '100.0000',
          configCalculo: mockConfigCalculo,
        },
      });
    });

    it('una factura llega como no-boleta con su tipo', async () => {
      await service.crear(TENANT_ID, USUARIO_ID, {
        ...baseDto,
        tipoDocumentoId: FACTURA,
      });

      expect(llamada()[1].venta).toMatchObject({
        tipoDocumentoId: FACTURA,
        esBoleta: false,
      });
    });

    it('el facturador del comercio sale de la consulta de la moneda, sin otra lectura', async () => {
      dataSourceMock.query.mockImplementation(() =>
        Promise.resolve(
          MONEDA_ROWS.map((r) => ({ ...r, facturador: 'externo' })),
        ),
      );
      const consultasAntes = dataSourceMock.query.mock.calls.length;

      await service.crear(TENANT_ID, USUARIO_ID, baseDto);

      expect(llamada()[1].facturador).toBe('externo');
      // La consulta de la moneda ya existía: no se suma una lectura de `tenants`.
      const lecturasDeTenants = dataSourceMock.query.mock.calls
        .slice(consultasAntes)
        .filter((c) => typeof c[0] === 'string' && /FROM tenants\b/.test(c[0]));
      expect(lecturasDeTenants).toHaveLength(1);
    });

    it('un cierre sin tipo (país sin boleta) llega con tipo nulo', async () => {
      const queryBase = manager.query.getMockImplementation()!;
      manager.query.mockImplementation((sql: string) =>
        typeof sql === 'string' && sql.includes('es_boleta')
          ? Promise.resolve([])
          : queryBase(sql),
      );

      await service.crear(TENANT_ID, USUARIO_ID, baseDto);

      expect(llamada()[1].venta).toMatchObject({
        tipoDocumentoId: null,
        esBoleta: false,
      });
    });

    it('las porciones son la suma por clasificación de las líneas ya calculadas', async () => {
      // Tres líneas: dos afectas (distinto importe) y una exenta.
      calculoPreciosService.calcular.mockResolvedValueOnce({
        ...mockResultadoVenta,
        lineas: [
          {
            ...mockResultadoVenta.lineas[0],
            totalLinea: '119.0000',
            impuestoAplicado: '19.0000',
          },
          {
            ...mockResultadoVenta.lineas[0],
            totalLinea: '238.0000',
            impuestoAplicado: '38.0000',
          },
          {
            ...mockResultadoVenta.lineas[0],
            itemId: ITEM_EXENTO_ID,
            totalLinea: '70.0000',
            impuestoAplicado: '0.0000',
          },
        ],
        totales: { ...mockResultadoVenta.totales, totalFinal: '427.0000' },
      });
      itemsService.cargarBasePorIds.mockImplementationOnce(
        (_t: string, ids: string[]) =>
          Promise.resolve(
            new Map(
              ids.map((id) => [
                id,
                id === ITEM_EXENTO_ID
                  ? { ...mockItem, clasificacionTributaria: 'exento' }
                  : mockItem,
              ]),
            ) as never,
          ),
      );

      await service.crear(TENANT_ID, USUARIO_ID, {
        ...baseDto,
        lineas: [
          { itemId: ITEM_ID, cantidad: '1' },
          { itemId: ITEM_ID, cantidad: '2' },
          { itemId: ITEM_EXENTO_ID, cantidad: '1' },
        ],
      });

      const porciones = llamada()[1].porciones as {
        clasificacion: string;
        total: string;
        impuesto: string;
      }[];
      expect(
        [...porciones].sort((a, b) =>
          a.clasificacion.localeCompare(b.clasificacion),
        ),
      ).toEqual([
        { clasificacion: 'afecto', total: '357.0000', impuesto: '57.0000' },
        { clasificacion: 'exento', total: '70.0000', impuesto: '0.0000' },
      ]);
    });

    it('los pagos salen de lo que registró PagosService, cruzados por índice con el número que tipeó el cajero', async () => {
      pagosServiceMock.registrar.mockResolvedValueOnce({
        pagos: [],
        montoAplicadoVenta: '100.0000',
        porPago: [
          {
            pagoId: 'pago-ef',
            metodoPagoId: EFECTIVO_ID,
            emisor: 'sistema',
            esEfectivo: true,
            aplicadoVenta: '60.0000',
          },
          {
            pagoId: 'pago-tj',
            metodoPagoId: TARJETA_ID,
            emisor: 'maquina',
            esEfectivo: false,
            aplicadoVenta: '40.0000',
          },
        ],
      });

      await service.crear(TENANT_ID, USUARIO_ID, {
        ...baseDto,
        pagos: [
          { metodoPagoId: EFECTIVO_ID, monto: '60.0000' },
          {
            metodoPagoId: TARJETA_ID,
            monto: '40.0000',
            numeroDocumento: '445566',
            claseDocumento: 'voucher',
          },
        ],
      });

      expect(llamada()[1].pagos).toEqual([
        {
          pagoId: 'pago-ef',
          metodoPagoId: EFECTIVO_ID,
          emisor: 'sistema',
          aplicadoVenta: '60.0000',
          numeroDocumento: undefined,
          claseDocumento: undefined,
        },
        {
          pagoId: 'pago-tj',
          metodoPagoId: TARJETA_ID,
          emisor: 'maquina',
          aplicadoVenta: '40.0000',
          numeroDocumento: '445566',
          claseDocumento: 'voucher',
        },
      ]);
    });

    it('sin pagos (cuenta por cobrar) también documenta, con la lista vacía', async () => {
      await service.crear(TENANT_ID, USUARIO_ID, { ...baseDto, pagos: [] });

      expect(ventaDocumentosMock.documentarVenta).toHaveBeenCalledTimes(1);
      expect(llamada()[1].pagos).toEqual([]);
    });

    it('corre después de registrar los pagos y de dejar el estado de la venta', async () => {
      await service.crear(TENANT_ID, USUARIO_ID, baseDto);

      const orden = (m: jest.Mock) => m.mock.invocationCallOrder[0];
      expect(orden(ventaDocumentosMock.documentarVenta)).toBeGreaterThan(
        orden(pagosServiceMock.registrar),
      );
      const update = manager.query.mock.calls.findIndex(
        (c) => typeof c[0] === 'string' && c[0].includes('WITH s AS'),
      );
      expect(update).toBeGreaterThanOrEqual(0);
      expect(orden(ventaDocumentosMock.documentarVenta)).toBeGreaterThan(
        manager.query.mock.invocationCallOrder[update],
      );
    });

    it('si documentar falla, la venta falla: va en la misma transacción', async () => {
      ventaDocumentosMock.documentarVenta.mockRejectedValueOnce(
        new Error('documento roto'),
      );

      await expect(
        service.crear(TENANT_ID, USUARIO_ID, baseDto),
      ).rejects.toThrow('documento roto');
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
        porPago: [
          {
            pagoId: 'pago-uuid-001',
            metodoPagoId: EFECTIVO_ID,
            emisor: 'sistema',
            esEfectivo: true,
            aplicadoVenta: '4000.0000',
          },
        ],
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
              // El canal interno del motor, no un override del cliente: la venta
              // ya resolvió la personalización y ya convirtió. Ver `LineaCalculo`.
              precioUnitarioResuelto: '4000.0000',
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
        porPago: [
          {
            pagoId: 'pago-uuid-001',
            metodoPagoId: EFECTIVO_ID,
            emisor: 'sistema',
            esEfectivo: true,
            aplicadoVenta: '100.0000',
          },
        ],
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
        porPago: [
          {
            pagoId: 'pago-uuid-001',
            metodoPagoId: EFECTIVO_ID,
            emisor: 'sistema',
            esEfectivo: true,
            aplicadoVenta: '100.0000',
          },
        ],
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

  describe('crearNotaCredito()', () => {
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
      venta_referencia_id: null,
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
        unidad_codigo_base: 'unidad',
        // Bruto de la línea: 3 × 100, sin IVA porque es exenta. De acá sale el
        // valor por unidad con el que la NC valúa la devolución.
        total_linea: '300.0000',
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
        clasificacion_tributaria: 'afecto',
        unidad_codigo_base: 'unidad',
        total_linea: '500.0000',
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
        clasificacion_tributaria: 'afecto',
        unidad_codigo_base: 'unidad',
        total_linea: '50.0000',
        modo_inventario: null,
      },
    ];

    let ncManager: ReturnType<typeof buildManagerMock>;
    // Resultados configurables por test para las queries dentro de la tx
    let ventaRows: unknown[];
    let ncPreviasTotal: string;
    /**
     * La composición del documento original, por porción fiscal: de acá salen
     * la tasa efectiva de cada porción y el remanente que reparte el ajuste.
     * Suma el `total_final` de la venta original (11.305), como en la base real.
     */
    let composicionRows: {
      es_nc: boolean;
      clasificacion: string;
      total: string;
      impuesto: string;
    }[];
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
      unidadesComprometidasRows = [];
      disponiblePorPorcionRows = [];
      composicionRows = [
        {
          es_nc: false,
          clasificacion: 'afecto',
          total: '11005.0000',
          impuesto: '1757.1000',
        },
        {
          es_nc: false,
          clasificacion: 'exento',
          total: '300.0000',
          impuesto: '0.0000',
        },
      ];
      efectivoCobrado = '1100.0000';
      efectivoDevuelto = '0';
      costosCongelados = [{ item_id: ITEM_ID, costo_unitario: '50.0000' }];
      ncManager.query.mockImplementation((sql: string) => {
        if (sql.includes('WITH s AS'))
          return Promise.resolve([{ ...ncManager.recalculo }]);
        if (sql.includes('FOR UPDATE')) return Promise.resolve(ventaRows);
        if (sql.includes('SUM(total_final)'))
          return Promise.resolve([{ total: ncPreviasTotal }]);
        // Antes que el genérico: la consulta de composición TAMBIÉN lee
        // `venta_detalles`, y devolverle las filas de devolución la dejaría sin
        // `clasificacion` ni `total`.
        if (sql.includes('AS es_nc')) return Promise.resolve(composicionRows);
        if (sql.includes('FROM ventas_impuestos')) return Promise.resolve([]);
        if (sql.includes('FROM venta_detalles'))
          return Promise.resolve(detallesRows);
        if (sql.includes('costo_unitario'))
          return Promise.resolve(costosCongelados);
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

    const VIA_PAGO = { tipo: 'pago' as const, pagoId: 'pago-1' };
    const baseParams = {
      tenantId: TENANT_ID,
      usuarioId: USUARIO_ID,
      ventaOriginalId: VENTA_ORIG_ID,
      monto: '1100.0000',
      comentario: 'NC por reembolso orden O-1',
      via: VIA_PAGO,
    };
    /** El pago elegido es en efectivo: la plata sale de la caja. */
    const conSalidaDeCaja = () =>
      ventaDocumentosMock.documentoQueCorrige.mockResolvedValue({
        documento: { id: 'doc-boleta', emisor: 'sistema', monto: '11305.0000' },
        saldo: null,
        mueveCaja: true,
        devolvibleDelPago: null,
      });

    it('la NC se marca con el tipo de documento DEL PAÍS del tenant, no con una constante', async () => {
      // El bug que esto cierra: hasta el 2026-09-03 el tipo salía de una
      // constante con la fila CHILENA código 61 y se usaba sin mirar el país,
      // así que un reembolso en un tenant argentino congelaba un documento
      // chileno — y ADR-010 dice que lo congelado no se corrige después.
      dataSourceMock.query.mockImplementation((sql: string) =>
        sql.includes('es_nota_credito')
          ? Promise.resolve([{ tipo_documento_id: 'nc-de-argentina' }])
          : Promise.resolve(MONEDA_ROWS),
      );

      await service.crearNotaCredito(baseParams);

      expect(ncManager.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ tipoDocumentoId: 'nc-de-argentina' }),
      );
    });

    it('un país sin nota de crédito sembrada rechaza el reembolso y no escribe nada', async () => {
      // Sin tipo, la NC quedaría sin marcar y dejaría de encontrarse a sí misma
      // —el tope de reembolso la busca por ese id—, así que se corta antes.
      dataSourceMock.query.mockImplementation((sql: string) =>
        sql.includes('es_nota_credito')
          ? Promise.resolve([])
          : Promise.resolve(MONEDA_ROWS),
      );

      await expect(service.crearNotaCredito(baseParams)).rejects.toThrow(
        BadRequestException,
      );
      expect(ncManager.save).not.toHaveBeenCalled();
    });

    it('le pide el documento a corregir al servicio de documentos con el tenant del token, la venta y la vía elegida', async () => {
      await service.crearNotaCredito(baseParams);

      expect(ventaDocumentosMock.documentoQueCorrige).toHaveBeenCalledWith(
        ncManager,
        { tenantId: TENANT_ID, ventaId: VENTA_ORIG_ID, via: VIA_PAGO },
      );
    });

    it('un pago rechazado por el servicio de documentos (de otra venta, sin saldo) corta antes de escribir nada', async () => {
      ventaDocumentosMock.documentoQueCorrige.mockRejectedValueOnce(
        new BadRequestException('El pago indicado no es de esta venta.'),
      );

      await expect(service.crearNotaCredito(baseParams)).rejects.toThrow(
        'El pago indicado no es de esta venta.',
      );
      expect(ncManager.save).not.toHaveBeenCalled();
      expect(ventaDocumentosMock.documentarCorreccion).not.toHaveBeenCalled();
    });

    it('el documento de la corrección se escribe DESPUÉS de sus líneas, con el tipo NC y el documento corregido', async () => {
      await service.crearNotaCredito(baseParams);

      expect(ventaDocumentosMock.documentarCorreccion).toHaveBeenCalledTimes(1);
      expect(ventaDocumentosMock.documentarCorreccion).toHaveBeenCalledWith(
        ncManager,
        {
          tenantId: TENANT_ID,
          correccionVentaId: expect.any(String) as string,
          corregido: {
            id: 'doc-boleta',
            emisor: 'sistema',
            monto: '11305.0000',
          },
          monto: '1100.0000',
          tipoNotaCreditoId: TIPO_DOCUMENTO_NC_ID,
        },
      );
      // Sus baldes salen de las líneas de la corrección: tienen que existir ya.
      const iLineas = ncManager.save.mock.calls.findIndex(
        (c: unknown[]) => c[0] === VentaDetalle,
      );
      expect(iLineas).toBeGreaterThanOrEqual(0);
      expect(
        ventaDocumentosMock.documentarCorreccion.mock.invocationCallOrder[0],
      ).toBeGreaterThan(ncManager.save.mock.invocationCallOrder[iLineas]);
    });

    it('el tope por documento corre bajo el mismo lock, con el documento y el monto de la nota', async () => {
      await service.crearNotaCredito(baseParams);

      expect(ventaDocumentosMock.exigirTopeDelDocumento).toHaveBeenCalledWith(
        ncManager,
        {
          tenantId: TENANT_ID,
          documento: {
            id: 'doc-boleta',
            emisor: 'sistema',
            monto: '11305.0000',
          },
          monto: '1100.0000',
        },
      );
    });

    it('si el documento ya no admite ese monto, la nota no se escribe', async () => {
      ventaDocumentosMock.exigirTopeDelDocumento.mockRejectedValueOnce(
        new BadRequestException('El monto excede lo que queda por corregir'),
      );

      await expect(service.crearNotaCredito(baseParams)).rejects.toThrow(
        'El monto excede lo que queda por corregir',
      );
      expect(ncManager.save).not.toHaveBeenCalled();
    });

    describe('la corrección registra por dónde volvió la plata', () => {
      const guardada = () =>
        ncManager.save.mock.calls
          .map((c: unknown[]) => c[1] as Record<string, unknown>)
          .find((d) => d['ventaReferenciaId'] === VENTA_ORIG_ID)!;

      it('por un pago: la vía y el pago', async () => {
        await service.crearNotaCredito(baseParams);

        expect(guardada()).toMatchObject({
          devolucionVia: 'pago',
          devolucionPagoId: 'pago-1',
        });
      });

      it('sin plata: la vía y ningún pago', async () => {
        ventaDocumentosMock.documentoQueCorrige.mockResolvedValue({
          documento: {
            id: 'doc-deuda',
            emisor: 'sistema',
            monto: '11305.0000',
          },
          saldo: '5000.0000',
          mueveCaja: false,
          devolvibleDelPago: null,
        });

        await service.crearNotaCredito({
          ...baseParams,
          via: { tipo: 'sin_plata' },
        });

        expect(guardada()).toMatchObject({
          devolucionVia: 'sin_plata',
          devolucionPagoId: null,
        });
      });

      it('por la pasarela de una venta sin un único pago: la vía y ningún pago', async () => {
        await service.crearNotaCredito({
          ...baseParams,
          via: { tipo: 'pasarela', documentoId: null, pagoId: null },
        });

        expect(guardada()).toMatchObject({
          devolucionVia: 'pasarela',
          devolucionPagoId: null,
        });
      });

      it('por la pasarela de una venta de un único pago: sigue siendo la pasarela, pero anota el pago para que gaste su tope', async () => {
        await service.crearNotaCredito({
          ...baseParams,
          via: { tipo: 'pasarela', documentoId: null, pagoId: 'pago-unico' },
        });

        expect(guardada()).toMatchObject({
          devolucionVia: 'pasarela',
          devolucionPagoId: 'pago-unico',
        });
      });
    });

    describe('"no vuelve plata" no pasa de lo que la venta todavía debe', () => {
      const SIN_PLATA = { tipo: 'sin_plata' as const };
      const conSaldo = (saldo: string) =>
        ventaDocumentosMock.documentoQueCorrige.mockResolvedValue({
          // El documento de la deuda es MAYOR que el saldo: hubo abonos. Solo el
          // tope del saldo lo ve.
          documento: {
            id: 'doc-deuda',
            emisor: 'sistema',
            monto: '11305.0000',
          },
          saldo,
          mueveCaja: false,
          devolvibleDelPago: null,
        });

      it('un monto por encima del saldo es un 400 corto que no dice ningún número, y no escribe nada', async () => {
        conSaldo('1000.0000');

        const error = (await service
          .crearNotaCredito({
            ...baseParams,
            via: SIN_PLATA,
            monto: '1000.0001',
          })
          .catch((e: Error) => e)) as BadRequestException;

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.message).toMatch(/todavía debe/);
        expect(error.message).not.toMatch(/\d/);
        expect(ncManager.save).not.toHaveBeenCalled();
        expect(ventaDocumentosMock.documentarCorreccion).not.toHaveBeenCalled();
      });

      it('un monto igual al saldo pasa', async () => {
        conSaldo('1000.0000');

        const res = await service.crearNotaCredito({
          ...baseParams,
          via: SIN_PLATA,
          monto: '1000.0000',
        });

        expect(res.totalFinal).toBe('1000.0000');
      });

      const recalculos = () =>
        ncManager.query.mock.calls.filter(
          (c: unknown[]) =>
            typeof c[0] === 'string' && c[0].includes('WITH s AS'),
        );

      it('"no vuelve plata" recalcula el estado de la venta que corrige, con la regla única y bajo su tenant', async () => {
        conSaldo('1000.0000');

        await service.crearNotaCredito({
          ...baseParams,
          via: SIN_PLATA,
          monto: '1000.0000',
        });

        expect(recalculos()).toHaveLength(1);
        expect(recalculos()[0][1]).toEqual([VENTA_ORIG_ID, TENANT_ID]);
        // Después de guardar la corrección: si no, el saldo todavía no la cuenta.
        expect(
          ncManager.query.mock.invocationCallOrder[
            ncManager.query.mock.calls.indexOf(recalculos()[0])
          ],
        ).toBeGreaterThan(ncManager.save.mock.invocationCallOrder[0]);
      });

      it('una corrección que devolvió plata no mueve el saldo: no hay nada que recalcular', async () => {
        await service.crearNotaCredito(baseParams);

        expect(recalculos()).toHaveLength(0);
      });

      it('con un pago el saldo no cuenta (viene nulo): la venta paga entera igual se corrige', async () => {
        // Es el caso de siempre: `saldo: null` y un monto que nada tiene que ver con la deuda.
        const res = await service.crearNotaCredito(baseParams);

        expect(res.totalFinal).toBe('1100.0000');
      });
    });

    describe('el tope por pago: una corrección por un pago no pasa de lo que ese pago trajo', () => {
      const conDevolvible = (devolvible: string, mueveCaja = false) =>
        ventaDocumentosMock.documentoQueCorrige.mockResolvedValue({
          // Un documento enorme (boleta `sistema` de toda la venta): el tope por
          // documento no acota por pago, solo este lo ve.
          documento: {
            id: 'doc-boleta',
            emisor: 'sistema',
            monto: '11305.0000',
          },
          saldo: null,
          mueveCaja,
          devolvibleDelPago: devolvible,
        });

      it('un monto por encima de lo que queda por devolver por el pago es un 400 sin cifras, y no escribe nada', async () => {
        conDevolvible('400.0000');

        const error = (await service
          .crearNotaCredito({ ...baseParams, monto: '900.0000' })
          .catch((e: Error) => e)) as BadRequestException;

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.message).toMatch(/por devolver por ese pago/);
        expect(error.message).not.toMatch(/\d/);
        expect(ncManager.save).not.toHaveBeenCalled();
        expect(ventaDocumentosMock.documentarCorreccion).not.toHaveBeenCalled();
      });

      it('un monto igual a lo que queda por devolver pasa', async () => {
        conDevolvible('400.0000');

        const res = await service.crearNotaCredito({
          ...baseParams,
          monto: '400.0000',
        });

        expect(res.totalFinal).toBe('400.0000');
      });

      it('con una vía que no es un pago el tope no existe (viene nulo)', async () => {
        const res = await service.crearNotaCredito(baseParams);

        expect(res.totalFinal).toBe('1100.0000');
      });

      it('el efectivo también lo respeta: pasa el tope del efectivo de la venta y cae en el del pago', async () => {
        // La venta cobró 1.100 en efectivo (tope de arriba), pero ESTE pago solo trajo 400.
        conDevolvible('400.0000', true);

        const error = (await service
          .crearNotaCredito({ ...baseParams, monto: '900.0000' })
          .catch((e: Error) => e)) as BadRequestException;

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.message).toMatch(/por devolver por ese pago/);
        expect(error.message).not.toMatch(/\d/);
        expect(
          cajaService.registrarMovimientoEnTransaccion,
        ).not.toHaveBeenCalled();
      });

      it('con efectivo, el tope del efectivo de la venta corre primero (el 422 con su rastro, no este 400)', async () => {
        // Del efectivo de la venta quedan 100 y del pago 400: pedir 900 rompe los
        // dos, y tiene que verse el del efectivo.
        efectivoCobrado = '1100.0000';
        efectivoDevuelto = '1000.0000';
        conDevolvible('400.0000', true);

        const error = (await service
          .crearNotaCredito({ ...baseParams, monto: '900.0000' })
          .catch((e: Error) => e)) as Error;

        expect(error).toBeInstanceOf(IntentoRechazadoError);
      });
    });

    // La forma del SQL (filtro de borrado, que la fila es de la venta original) la
    // ve el e2e (`ventas.e2e-spec.ts`, "el receptor"); acá, las ramas.
    describe('el receptor de la nota', () => {
      const CLIENTE = {
        tercero_id: 'tercero-1',
        nombre: 'Comercial Andes SpA',
        rut: '76123456-0',
        direccion: 'Av. Matta 1234',
        giro: 'Ferretería',
        comuna: 'Santiago',
        telefono: null,
        email: null,
      };
      let customerRows: (typeof CLIENTE)[];
      let codigoIso: string;
      const interna = () =>
        ventaDocumentosMock.documentoQueCorrige.mockResolvedValue({
          documento: { id: 'doc-nadie', emisor: 'nadie', monto: '11305.0000' },
          saldo: null,
          mueveCaja: false,
          devolvibleDelPago: null,
        });
      const guardadoComoCustomer = () =>
        ncManager.save.mock.calls.filter(([e]) => e === VentaCustomer);
      const notaGuardada = () =>
        ncManager.save.mock.calls.find(([e]) => e === Venta)?.[1] as {
          receptorEsEmisor: boolean;
        };

      beforeEach(() => {
        customerRows = [];
        codigoIso = 'CL';
        const base = ncManager.query.getMockImplementation()!;
        ncManager.query.mockImplementation((sql: string, p?: unknown[]) => {
          if (sql.includes('FROM venta_customer'))
            return Promise.resolve(customerRows);
          if (sql.includes('codigo_iso'))
            return Promise.resolve([{ codigo_iso: codigoIso }]);
          return base(sql, p);
        });
      });

      it.each([
        ['una nota con tipo', () => undefined],
        ['la devolución interna', interna],
      ])(
        'con customer en la venta, %s lo copia entero a la nota y no lleva la marca',
        async (_caso, preparar) => {
          preparar();
          customerRows = [CLIENTE];

          await service.crearNotaCredito(baseParams);

          expect(guardadoComoCustomer()).toEqual([
            [
              VentaCustomer,
              [
                {
                  ventaId: 'venta-uuid-001',
                  terceroId: 'tercero-1',
                  nombre: 'Comercial Andes SpA',
                  rut: '76123456-0',
                  direccion: 'Av. Matta 1234',
                  giro: 'Ferretería',
                  comuna: 'Santiago',
                  telefono: null,
                  email: null,
                },
              ],
            ],
          ]);
          expect(notaGuardada().receptorEsEmisor).toBe(false);
        },
      );

      it('sin customer ni receptor, la nota con tipo va a nombre del emisor; la devolución interna no lleva la marca', async () => {
        await service.crearNotaCredito(baseParams);
        expect(notaGuardada().receptorEsEmisor).toBe(true);
        expect(guardadoComoCustomer()).toEqual([]);

        ncManager.save.mockClear();
        interna();
        await service.crearNotaCredito(baseParams);
        expect(notaGuardada().receptorEsEmisor).toBe(false);
        expect(guardadoComoCustomer()).toEqual([]);
      });

      it('el receptor capturado, en Chile, se congela con el RUT normalizado y sin blancos', async () => {
        await service.crearNotaCredito({
          ...baseParams,
          receptor: { nombre: ' Juan Pérez ', rut: '12.345.678-5' },
        });

        expect(guardadoComoCustomer()).toEqual([
          [
            VentaCustomer,
            [
              {
                ventaId: 'venta-uuid-001',
                terceroId: null,
                nombre: 'Juan Pérez',
                rut: '12345678-5',
              },
            ],
          ],
        ]);
        expect(notaGuardada().receptorEsEmisor).toBe(false);
      });

      it('en otro país (en pausa) el RUT no se mira: se guarda como vino, sin blancos', async () => {
        codigoIso = 'AR';

        await service.crearNotaCredito({
          ...baseParams,
          receptor: { nombre: 'Juan Pérez', rut: ' 20-12345678-3 ' },
        });

        expect(guardadoComoCustomer()[0][1]).toEqual([
          expect.objectContaining({ rut: '20-12345678-3' }),
        ]);
      });

      it.each([
        [
          { nombre: 'Juan', rut: '12.345.678-9' },
          'CL',
          'El RUT del cliente no es válido',
        ],
        [
          { nombre: '  ', rut: '12.345.678-5' },
          'CL',
          'El nombre del cliente no puede quedar en blanco',
        ],
        [{ nombre: 'Juan', rut: '  ' }, 'AR', 'Falta el RUT del cliente'],
      ])(
        'un receptor inválido (%j, %s) es 400 y no guarda nada',
        async (receptor, pais, mensaje) => {
          codigoIso = pais;

          await expect(
            service.crearNotaCredito({ ...baseParams, receptor }),
          ).rejects.toThrow(mensaje);
          expect(notaGuardada()).toBeUndefined();
        },
      );

      it('con customer en la venta, un receptor distinto es 400 y no guarda nada', async () => {
        customerRows = [CLIENTE];

        await expect(
          service.crearNotaCredito({
            ...baseParams,
            receptor: { nombre: 'Otra persona', rut: '12.345.678-5' },
          }),
        ).rejects.toThrow(
          'La nota de crédito va al mismo cliente que la venta',
        );
        expect(notaGuardada()).toBeUndefined();
      });
    });

    describe('la devolución interna (el documento corregido es de "nadie")', () => {
      beforeEach(() => {
        ventaDocumentosMock.documentoQueCorrige.mockResolvedValue({
          documento: { id: 'doc-nadie', emisor: 'nadie', monto: '11305.0000' },
          saldo: null,
          mueveCaja: false,
          devolvibleDelPago: null,
        });
      });

      it('la fila de la corrección lleva el tipo nulo', async () => {
        await service.crearNotaCredito(baseParams);

        expect(ncManager.save).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            tipoDocumentoId: null,
            ventaReferenciaId: VENTA_ORIG_ID,
            estado: EstadoVenta.PAGADA,
          }),
        );
        expect(ventaDocumentosMock.documentarCorreccion).toHaveBeenCalledWith(
          ncManager,
          expect.objectContaining({
            corregido: expect.objectContaining({ emisor: 'nadie' }) as unknown,
            tipoNotaCreditoId: null,
          }),
        );
      });

      it('un país sin nota de crédito sembrada no la frena (no necesita el tipo)', async () => {
        dataSourceMock.query.mockImplementation((sql: string) =>
          sql.includes('es_nota_credito')
            ? Promise.resolve([])
            : Promise.resolve(MONEDA_ROWS),
        );

        const res = await service.crearNotaCredito(baseParams);

        expect(res.id).toBeDefined();
        expect(ncManager.save).toHaveBeenCalled();
      });
    });

    it('sin documentos que corregir (país sin boleta) la nota se emite como siempre: con el tipo NC y sin fila de documento', async () => {
      ventaDocumentosMock.documentoQueCorrige.mockResolvedValue({
        documento: null,
        saldo: null,
        mueveCaja: false,
        devolvibleDelPago: null,
      });

      await service.crearNotaCredito(baseParams);

      expect(ncManager.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ tipoDocumentoId: TIPO_DOCUMENTO_NC_ID }),
      );
      expect(ventaDocumentosMock.exigirTopeDelDocumento).not.toHaveBeenCalled();
      expect(ventaDocumentosMock.documentarCorreccion).not.toHaveBeenCalled();
    });

    it('el tope de la venta cuenta toda corrección (venta_referencia_id), sin mirar el tipo de documento', async () => {
      await service.crearNotaCredito(baseParams);

      const sqls = ncManager.query.mock.calls.map((c: unknown[]) =>
        String(c[0]),
      );
      const previas = sqls.find((q) => q.includes('SUM(total_final)'))!;
      const composicion = sqls.find((q) => q.includes('AS es_nc'))!;
      expect(previas).toContain('venta_referencia_id = $1');
      expect(previas).not.toContain('tipo_documento_id');
      expect(composicion).toContain('venta_referencia_id = $1');
      expect(composicion).not.toContain('tipo_documento_id');
    });

    it('NC por monto libre: sin devoluciones igual tiene líneas, una por porción fiscal del remanente', async () => {
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
          // Los totales se DERIVAN de las líneas: `total_bruto` es el neto
          // —igual que en una venta normal— y ya no una copia del monto.
          // 1.100 repartido 11.005 / 300 → 1.070,8094 afecto y 29,1906 exento;
          // la porción afecta se descompone al 19% que esa venta cobró.
          totalBruto: '929.0305',
          totalImpuestos: '170.9695',
          totalFinal: '1100.0000',
          totalDescuentos: '0',
          totalRecargos: '0',
          baseVentasTotalFinal: '1100.0000',
          baseVentasSinImpuestos: '929.0305',
          comentario: 'NC por reembolso orden O-1',
        }),
      );

      // Dos líneas de ajuste, una por porción, colgadas del ítem de sistema y
      // con la glosa del operador. Suman el monto de la nota.
      const lineas = ncManager.save.mock.calls[1][1] as {
        itemId: string;
        clasificacionTributaria: string;
        descripcion: string;
        totalLinea: string;
        subtotal: string;
        impuestoAplicado: string;
      }[];
      expect(lineas).toHaveLength(2);
      expect(lineas.every((l) => l.itemId === ITEM_AJUSTE_ID)).toBe(true);
      expect(
        lineas.every((l) => l.descripcion === 'NC por reembolso orden O-1'),
      ).toBe(true);
      expect(lineas.map((l) => l.clasificacionTributaria)).toEqual([
        'afecto',
        'exento',
      ]);
      expect(
        lineas
          .reduce((a, l) => a.plus(l.totalLinea), new Decimal(0))
          .toFixed(4),
      ).toBe('1100.0000');
      // Y cada línea cierra sola: neto + impuesto = su bruto.
      for (const l of lineas)
        expect(
          new Decimal(l.subtotal).plus(l.impuestoAplicado).toFixed(4),
        ).toBe(new Decimal(l.totalLinea).toFixed(4));

      expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
    });

    it('NC con devoluciones: la línea se valúa a lo que costó en esa boleta y el resto va a ajuste', async () => {
      const res = await service.crearNotaCredito({
        ...baseParams,
        devoluciones: [{ itemId: ITEM_ID, cantidad: '2' }],
      });
      const lineas = ncManager.save.mock.calls[1][1] as {
        itemId: string;
        cantidad: string;
        precioUnitario: string;
        monedaIdOrigen: string;
        totalLinea: string;
        clasificacionTributaria: string;
      }[];
      // 300 de bruto entre 3 unidades vendidas → 100 por unidad. Con descuento
      // de línea, ese número YA no es el precio de lista: por eso sale de
      // `total_linea` y no de `precio_unitario`.
      expect(lineas[0]).toEqual(
        expect.objectContaining({
          itemId: ITEM_ID,
          cantidad: '2',
          precioUnitario: '100.0000',
          monedaIdOrigen: MONEDA_OFICIAL_ID,
          totalLinea: '200.0000',
          clasificacionTributaria: 'exento',
        }),
      );
      // Los 900 restantes salen en líneas de ajuste, y el documento cierra.
      expect(
        lineas
          .reduce((a, l) => a.plus(l.totalLinea), new Decimal(0))
          .toFixed(4),
      ).toBe('1100.0000');

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
      // Y SOLO por la devolución: la línea de ajuste cuelga de un servicio, que
      // `registrarMovimiento` rechaza con 400.
      expect(inventarioService.registrarMovimiento).toHaveBeenCalledTimes(1);
    });

    it('mercadería que vale más que el monto: la línea se ESCALA, no se saca del documento', async () => {
      // Hasta el 2026-09-04 esto se rechazaba con 400 en el camino manual y por
      // el webhook la devolución quedaba fuera del documento —que salía entero
      // de ajuste, sin decir qué había vuelto—. Hoy la línea se escala a
      // prorrata y suma el monto.
      //
      // 3 unidades valen 300 en esa boleta y la nota acredita 200.
      const res = await service.crearNotaCredito({
        ...baseParams,
        monto: '200.0000',
        devoluciones: [{ itemId: ITEM_ID, cantidad: '3' }],
      });
      expect(res.id).toBeDefined();

      const lineas = ncManager.save.mock.calls[1][1] as {
        itemId: string;
        cantidad: string;
        totalLinea: string;
      }[];
      // Una sola línea, la de la mercadería, escalada. Sin ajuste: el monto
      // entero lo explica lo que volvió.
      expect(lineas).toHaveLength(1);
      expect(lineas[0].itemId).toBe(ITEM_ID);
      expect(new Decimal(lineas[0].totalLinea).toFixed(4)).toBe('200.0000');
      // Lo que se escala es la PLATA: la cantidad sigue siendo la que volvió.
      expect(lineas[0].cantidad).toBe('3');

      // Y el stock vuelve por las 3, no por las 2 que la plata escalada
      // "pagaría".
      expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
        ncManager,
        expect.objectContaining({
          itemId: ITEM_ID,
          motivo: 'devolucion',
          cantidad: '3',
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
      unidadesComprometidasRows = [{ item_id: ITEM_ID, devuelto: '2' }];
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

    // Estos dos rechazos disparaban por NOMBRAR el ítem, y desde el 2026-09-04
    // disparan solo cuando se pide que vuelva al stock. Los cuatro casos de
    // abajo son las dos mitades del contrato nuevo.
    it('pedir que un ítem modo serie/lote reponga se rechaza antes de tocar inventario', async () => {
      await expect(
        service.crearNotaCredito({
          ...baseParams,
          validarVentaElegible: true,
          devoluciones: [
            { itemId: ITEM_SERIE_ID, cantidad: '1', reponerStock: true },
          ],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
    });

    it('pedir que un servicio reponga se rechaza con mensaje propio', async () => {
      await expect(
        service.crearNotaCredito({
          ...baseParams,
          validarVentaElegible: true,
          devoluciones: [
            { itemId: SERVICIO_ID, cantidad: '1', reponerStock: true },
          ],
        }),
      ).rejects.toThrow(/no maneja stock/);
    });

    it('sin pedir reposición, un servicio se acredita por línea y no mueve inventario', async () => {
      await service.crearNotaCredito({
        ...baseParams,
        validarVentaElegible: true,
        devoluciones: [{ itemId: SERVICIO_ID, cantidad: '1' }],
      });

      // La línea existe en el documento —con el nombre del servicio, no
      // "Ajuste"— y el inventario no se toca.
      const detalles = ncManager.save.mock.calls
        .flatMap((c: unknown[]) => (Array.isArray(c[1]) ? c[1] : []))
        .map((d) => d as { descripcion?: string });
      expect(detalles.some((d) => d.descripcion === 'Instalación')).toBe(true);
      expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
    });

    it('por el webhook, pedir reposición imposible NO tira: se acredita y no repone', async () => {
      // Un throw acá pierde el evento: el hook corre después del commit del
      // reembolso y `cobros.service.ts` se lo traga como warning.
      await expect(
        service.crearNotaCredito({
          ...baseParams,
          devoluciones: [
            { itemId: SERVICIO_ID, cantidad: '1', reponerStock: true },
          ],
        }),
      ).resolves.toBeDefined();

      expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
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
        // La resolución del tipo NC del país corre en el mismo `db.query`; sin
        // esta rama devolvería las filas de abajo y el id saldría cualquiera.
        if (sql.includes('es_nota_credito'))
          return Promise.resolve([{ tipo_documento_id: TIPO_DOCUMENTO_NC_ID }]);
        // Antes que el genérico: el contador de unidades comprometidas TAMBIÉN
        // nombra `FROM ventas`, y devolverle la cabecera lo dejaría sin
        // `devuelto`.
        if (sql.includes('WITH docs AS'))
          return Promise.resolve(unidadesComprometidasRows);
        // Con porciones y SIN notas hijas: es lo que hace que el corte de
        // elegibilidad se pueda distinguir. Devolviendo la cabecera también
        // como "nota previa" —que es lo que hacía el genérico `FROM ventas`—
        // el total daba 0 solo, y el caso pasaba sin guard.
        if (sql.includes('AS clasificacion'))
          return Promise.resolve([
            { clasificacion: 'afecto', monto: '100.0000' },
          ]);
        if (sql.includes('venta_referencia_id = $1'))
          return Promise.resolve([]);
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
              tipo_documento_es_boleta: false,
            },
          ]);
        return Promise.resolve([]);
      });

      const res = await service.findOne(
        TENANT_ID,
        VENTA_ORIG_ID,
        'u-test',
        true,
      );
      expect(res.tipoDocumento?.codigo).toBe('9999');
      expect(res.tipoDocumento?.esBoleta).toBe(false);
      expect(res.esNotaCredito).toBe(true);
      // Y no promete capacidad de acreditar sobre sí misma: sin este corte la
      // subconsulta no encuentra hijas y devuelve las líneas de la PROPIA nota
      // en positivo, o sea plata ya acreditada presentada como disponible.
      expect(res.disponibleNotaCredito).toEqual({
        total: '0.0000',
        porPorcion: [],
      });
    });

    describe('findOne: opcionesDevolucion y elegibilidad', () => {
      const filaVenta = (extra: Record<string, unknown> = {}) => ({
        venta_id: VENTA_ORIG_ID,
        caja_id: CAJA_VIRTUAL_ID,
        moneda_id: MONEDA_OFICIAL_ID,
        tipo_documento_id: 'doc-boleta',
        canal: 'fisico',
        estado: 'pagada',
        total_bruto: '100.0000',
        total_descuentos: '0',
        total_recargos: '0',
        total_impuestos: '0',
        total_final: '100.0000',
        config_calculo: { decimalesMoneda: 4 },
        comentario: null,
        fecha: new Date('2026-07-10'),
        creado_el: new Date('2026-07-10'),
        venta_referencia_id: null,
        tipo_documento_codigo: '39',
        tipo_documento_nombre: 'Boleta',
        tipo_documento_es_boleta: true,
        ...extra,
      });
      const responder = (
        venta: Record<string, unknown>,
        tipoNc: string | null,
      ) =>
        dataSourceMock.query.mockImplementation((sql: string) => {
          if (sql.includes('es_nota_credito'))
            return Promise.resolve(
              tipoNc ? [{ tipo_documento_id: tipoNc }] : [],
            );
          if (sql.includes('AS clasificacion'))
            return Promise.resolve([
              { clasificacion: 'afecto', monto: '100.0000' },
            ]);
          if (sql.includes('venta_referencia_id = $1'))
            return Promise.resolve([]);
          if (sql.includes('FROM ventas')) return Promise.resolve([venta]);
          return Promise.resolve([]);
        });
      const opcion = (registro: string, pagoId: string) => ({
        pagoId,
        sinPlata: false,
        metodo: 'Medio',
        monto: '50.0000',
        mueveCaja: false,
        registro,
      });

      it('sin el tipo NC del país solo ofrece lo que no lo lleva (la devolución interna), y lo dice el disponible', async () => {
        ventaDocumentosMock.opcionesDevolucion.mockResolvedValue([
          opcion('nota_credito_sistema', 'p-1'),
          opcion('devolucion_interna', 'p-2'),
        ]);
        responder(filaVenta(), null);

        const res = await service.findOne(TENANT_ID, VENTA_ORIG_ID, 'u', true);

        expect(res.opcionesDevolucion.map((o) => o.pagoId)).toEqual(['p-2']);
        expect(res.disponibleNotaCredito.total).toBe('100.0000');
      });

      it('sin el tipo NC y sin ninguna opción interna no hay nada que acreditar: disponible en cero', async () => {
        ventaDocumentosMock.opcionesDevolucion.mockResolvedValue([
          opcion('nota_credito_sistema', 'p-1'),
        ]);
        responder(filaVenta(), null);

        const res = await service.findOne(TENANT_ID, VENTA_ORIG_ID, 'u', true);

        expect(res.opcionesDevolucion).toEqual([]);
        expect(res.disponibleNotaCredito).toEqual({
          total: '0.0000',
          porPorcion: [],
        });
      });

      it('una devolución interna es una corrección sin ser una NC, y no ofrece nada ni consulta las opciones', async () => {
        responder(
          filaVenta({ tipo_documento_id: null, venta_referencia_id: 'madre' }),
          TIPO_DOCUMENTO_NC_ID,
        );
        ventaDocumentosMock.opcionesDevolucion.mockClear();

        const res = await service.findOne(TENANT_ID, VENTA_ORIG_ID, 'u', true);

        expect(res.esCorreccion).toBe(true);
        expect(res.esNotaCredito).toBe(false);
        expect(res.opcionesDevolucion).toEqual([]);
        expect(ventaDocumentosMock.opcionesDevolucion).not.toHaveBeenCalled();
        expect(res.disponibleNotaCredito.total).toBe('0.0000');
      });

      it('una venta cancelada no ofrece opciones ni las consulta', async () => {
        ventaDocumentosMock.opcionesDevolucion.mockClear();
        responder(filaVenta({ estado: 'cancelada' }), TIPO_DOCUMENTO_NC_ID);

        const res = await service.findOne(TENANT_ID, VENTA_ORIG_ID, 'u', true);

        expect(res.opcionesDevolucion).toEqual([]);
        expect(ventaDocumentosMock.opcionesDevolucion).not.toHaveBeenCalled();
        expect(res.disponibleNotaCredito.total).toBe('0.0000');
      });

      it('una venta pendiente ofrece lo que la resolución dice (solo "No vuelve plata": no tiene pagos) y publica el disponible', async () => {
        ventaDocumentosMock.opcionesDevolucion.mockResolvedValue([
          {
            pagoId: null,
            sinPlata: true,
            metodo: null,
            monto: '100.0000',
            mueveCaja: false,
            registro: 'nota_externa',
          },
        ]);
        responder(filaVenta({ estado: 'pendiente' }), TIPO_DOCUMENTO_NC_ID);

        const res = await service.findOne(TENANT_ID, VENTA_ORIG_ID, 'u', true);

        expect(res.opcionesDevolucion.map((o) => o.sinPlata)).toEqual([true]);
        expect(res.disponibleNotaCredito.total).toBe('100.0000');
      });
    });

    it('findOne expone referencia, tipo documento, modo/devuelto por detalle, reembolsos y NCs hijas', async () => {
      dataSourceMock.query.mockImplementation((sql: string) => {
        // Sin esta rama, `tipoNotaCreditoDelTenant` devuelve `null` y el caso
        // afirmaba el disponible EN LA CONFIGURACIÓN QUE NO ADMITE emitir: un
        // test defendiendo el hueco del cuarto guard.
        if (sql.includes('es_nota_credito'))
          return Promise.resolve([{ tipo_documento_id: TIPO_DOCUMENTO_NC_ID }]);
        // Por el nombre de la consulta y no por `FROM movimientos_inventario`:
        // la CTE `movs` del contador nombra esa tabla, así que el genérico
        // acertaba por colisión de substring.
        //
        // Y el valor lleva los cuatro decimales que devuelve Postgres
        // (`SUM(...)::text` → `'1.0000'`): con `'1'` el fixture no discrimina y
        // la aserción de abajo pasaría diga lo que diga la API.
        if (sql.includes('WITH docs AS'))
          return Promise.resolve([{ item_id: ITEM_ID, devuelto: '1.0000' }]);
        // Antes del genérico de `venta_detalles`: el remanente por porción
        // también lee esa tabla. Porciones DISTINTAS a propósito — con dos
        // iguales, mapear mal la clasificación pasaría igual.
        if (sql.includes('AS clasificacion'))
          return Promise.resolve([
            { clasificacion: 'afecto', monto: '9905.0000' },
            // 9.905 + 400 = 10.305, y el total es 10.205: los dos caminos
            // dejan de dar el mismo número, que es lo único que distingue
            // `total_final − Σ NC` de `Σ porPorcion`.
            { clasificacion: 'exento', monto: '400.0000' },
          ]);
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
              // La columna que la venta real siempre trae: sin ella el corte
              // de elegibilidad la trataba como no congelada, y el caso pasaba
              // por el lado equivocado.
              config_calculo: { decimalesMoneda: 4 },
              comentario: null,
              fecha: new Date('2026-07-10'),
              creado_el: new Date('2026-07-10'),
              venta_referencia_id: null,
              tipo_documento_codigo: '39',
              tipo_documento_nombre: 'Boleta de Venta',
              // Lo manda la consulta (`td.es_boleta`): el flag es del catálogo,
              // no se deduce del nombre ni del código.
              tipo_documento_es_boleta: true,
              // El país del tipo: con él la pantalla valida el RUT que capture
              // para una nota de crédito (DV módulo 11 solo en Chile).
              tipo_documento_pais: 'CL',
            },
          ]);
        return Promise.resolve([]);
      });

      const res = await service.findOne(
        TENANT_ID,
        VENTA_ORIG_ID,
        'u-test',
        true,
      );
      expect(res.ventaReferenciaId).toBeNull();
      expect(res.tipoDocumento).toEqual({
        id: 'doc-boleta',
        codigo: '39',
        nombre: 'Boleta de Venta',
        esBoleta: true,
        rutChileno: true,
      });
      expect(res.esNotaCredito).toBe(false);
      expect(res.esCorreccion).toBe(false);
      // Las opciones de "¿por dónde vuelve la plata?" las calcula el servicio de
      // documentos (la misma resolución que usa la nota), sobre esta venta.
      expect(ventaDocumentosMock.opcionesDevolucion).toHaveBeenCalledWith(
        expect.anything(),
        { tenantId: TENANT_ID, ventaId: VENTA_ORIG_ID },
      );
      expect(res.opcionesDevolucion).toEqual([
        expect.objectContaining({
          pagoId: 'pago-1',
          registro: 'nota_credito_sistema',
        }),
      ]);
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
      // El disponible para nota de crédito. El TOTAL sale de `total_final`
      // menos las notas previas (11.305 − 1.100 = 10.205) y NO de sumar las
      // porciones, que acá dan 10.305 a propósito: es el número que el backend
      // después exige. Las porciones viajan como lista, con su clasificación.
      expect(res.disponibleNotaCredito).toEqual({
        total: '10205.0000',
        porPorcion: [
          { clasificacion: 'afecto', monto: '9905.0000' },
          { clasificacion: 'exento', monto: '400.0000' },
        ],
      });
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

    it('listar mapea totalReembolsado y esCorreccion / esNotaCredito por venta_referencia_id', async () => {
      dataSourceMock.query.mockImplementation((sql: string) => {
        if (sql.includes('COUNT(*)')) return Promise.resolve([{ total: 3 }]);
        return Promise.resolve([
          {
            venta_id: 'v-1',
            canal: 'online',
            estado: 'pagada',
            total_final: '11305.0000',
            fecha: new Date('2026-07-10'),
            creado_el: new Date('2026-07-10'),
            monto_pagado: '11305.0000',
            saldo: '0.0000',
            total_reembolsado: '1100.0000',
            tipo_documento_id: 'doc-boleta',
            venta_referencia_id: null,
            documentos_resumen: {
              emisores: ['maquina', 'sistema'],
              tieneDuplicado: true,
            },
          },
          {
            venta_id: 'nc-1',
            canal: 'online',
            estado: 'pagada',
            total_final: '1100.0000',
            fecha: new Date('2026-07-10'),
            creado_el: new Date('2026-07-10'),
            monto_pagado: '0',
            saldo: '0',
            total_reembolsado: '0',
            tipo_documento_id: TIPO_DOCUMENTO_NC_ID,
            venta_referencia_id: 'v-1',
            documentos_resumen: { emisores: [], tieneDuplicado: false },
          },
          {
            // La devolución interna: corrige una venta y no lleva tipo.
            venta_id: 'di-1',
            canal: 'online',
            estado: 'pagada',
            total_final: '500.0000',
            fecha: new Date('2026-07-10'),
            creado_el: new Date('2026-07-10'),
            monto_pagado: '0',
            saldo: '0',
            total_reembolsado: '0',
            tipo_documento_id: null,
            venta_referencia_id: 'v-1',
            documentos_resumen: { emisores: [], tieneDuplicado: false },
          },
        ]);
      });

      const res = await service.listar(TENANT_ID, {}, 'u-test', true);
      const listSql = dataSourceMock.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('FROM ventas v') &&
          c[0].includes('LIMIT'),
      )?.[0] as string;
      // El saldo por venta sale de la expresión única, no de `total − pagado`.
      expect(listSql).toContain('sv_c.venta_referencia_id');
      expect(listSql).toContain("pa.tipo = 'venta'");
      expect(listSql).toContain('pago_aplicaciones');
      // El listado trae `venta_referencia_id`: de ahí sale el flag.
      expect(listSql).toContain('v.venta_referencia_id');
      expect(res.data[0]).toEqual(
        expect.objectContaining({
          totalReembolsado: '1100.0000',
          esCorreccion: false,
          esNotaCredito: false,
          emisores: ['maquina', 'sistema'],
          tieneDuplicado: true,
        }),
      );
      expect(res.data[1]).toEqual(
        expect.objectContaining({
          totalReembolsado: '0.0000',
          esCorreccion: true,
          esNotaCredito: true,
        }),
      );
      expect(res.data[2]).toEqual(
        expect.objectContaining({ esCorreccion: true, esNotaCredito: false }),
      );
    });

    it('resumen separa las correcciones por venta_referencia_id y las canceladas salen', async () => {
      dataSourceMock.query.mockResolvedValueOnce([
        {
          total_ventas: 5,
          total_bruto: '130',
          total_notas_credito: '30',
          total_facturado: '100',
          saldo_pendiente: '0',
        },
      ]);

      const res = await service.resumen(TENANT_ID, 'u-test', true);

      const [sql, params] = dataSourceMock.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('v.venta_referencia_id IS NULL');
      expect(sql).toContain('v.venta_referencia_id IS NOT NULL');
      expect(sql).toContain("v.estado <> 'cancelada'");
      expect(sql).toContain('GREATEST(');
      expect(sql).toContain("pa.tipo = 'venta'");
      expect(sql).toContain('pago_aplicaciones');
      expect(res).toEqual({
        totalVentas: 5,
        totalBruto: '130',
        totalNotasCredito: '30',
        totalFacturado: '100',
        saldoPendiente: '0',
      });
      // El tipo de documento ya no entra: una sola consulta, sin su parámetro.
      expect(dataSourceMock.query).toHaveBeenCalledTimes(1);
      expect(sql).not.toContain('IS DISTINCT FROM');
      expect(params).toEqual([TENANT_ID]);
    });

    describe('exigirTopeDelReembolsoPasarela: el REFUND respeta el tope por pago antes de llamar al proveedor', () => {
      let manager: ReturnType<typeof buildManagerMock>;
      let ventaExiste: boolean;
      const exigir = (monto: string) =>
        service.exigirTopeDelReembolsoPasarela(
          manager as unknown as EntityManager,
          { tenantId: TENANT_ID, ventaId: VENTA_ORIG_ID, monto },
        );
      beforeEach(() => {
        manager = buildManagerMock();
        ventaExiste = true;
        manager.query.mockImplementation((sql: string) =>
          Promise.resolve(
            sql.includes('FOR UPDATE') && ventaExiste
              ? [{ venta_id: VENTA_ORIG_ID }]
              : [],
          ),
        );
      });

      it('toma el FOR UPDATE de la venta (el mismo de la nota) ANTES de leer lo que el pago puede devolver', async () => {
        ventaDocumentosMock.devolvibleDelPagoUnico.mockResolvedValue(
          '70000.0000',
        );

        await exigir('70000');

        const lock = manager.query.mock.calls.find(([sql]) =>
          (sql as string).includes('FOR UPDATE'),
        ) as [string, unknown[]];
        expect(lock[0]).toMatch(/FROM ventas/);
        expect(lock[0]).toMatch(/eliminado_el IS NULL/);
        expect(lock[1]).toEqual([VENTA_ORIG_ID, TENANT_ID]);
        // Leído sin el lock, una nota concurrente pasaría con el mismo saldo.
        expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
          ventaDocumentosMock.devolvibleDelPagoUnico.mock
            .invocationCallOrder[0],
        );
        expect(ventaDocumentosMock.devolvibleDelPagoUnico).toHaveBeenCalledWith(
          manager,
          { tenantId: TENANT_ID, ventaId: VENTA_ORIG_ID },
        );
      });

      it('un monto por encima de lo que queda por devolver del pago es un 400 sin cifras', async () => {
        ventaDocumentosMock.devolvibleDelPagoUnico.mockResolvedValue(
          '70000.0000',
        );

        const error = (await exigir('70001').catch(
          (e: Error) => e,
        )) as BadRequestException;

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.message).toMatch(/por devolver del pago/);
        expect(error.message).not.toMatch(/\d/);
      });

      it('un monto igual a lo que queda por devolver pasa', async () => {
        ventaDocumentosMock.devolvibleDelPagoUnico.mockResolvedValue(
          '70000.0000',
        );

        await expect(exigir('70000')).resolves.toBeUndefined();
      });

      it('sin un único pago (nulo) no hay tope: elegir uno sería adivinar', async () => {
        ventaDocumentosMock.devolvibleDelPagoUnico.mockResolvedValue(null);

        await expect(exigir('999999')).resolves.toBeUndefined();
      });

      it('una venta que ya no existe no frena el reembolso: no hay a qué topar y no lee nada más', async () => {
        ventaExiste = false;

        await expect(exigir('70000')).resolves.toBeUndefined();
        expect(
          ventaDocumentosMock.devolvibleDelPagoUnico,
        ).not.toHaveBeenCalled();
      });
    });

    describe('viaDeReembolsoPasarela: un hecho consumado, nunca lanza', () => {
      const via = (
        filas: { documento_id: string }[],
        pagos: { pago_id: string }[] = [],
      ) => {
        dataSourceMock.query
          .mockResolvedValueOnce(filas)
          .mockResolvedValueOnce(pagos);
        return service.viaDeReembolsoPasarela(
          TENANT_ID,
          VENTA_ORIG_ID,
          'orden-1',
        );
      };
      let advertencia: jest.SpyInstance;
      beforeEach(() => {
        advertencia = jest
          .spyOn(service['logger'], 'warn')
          .mockImplementation(() => undefined);
      });

      it('un solo documento válido: la corrección lo corrige', async () => {
        await expect(via([{ documento_id: 'doc-boleta' }])).resolves.toEqual({
          tipo: 'pasarela',
          documentoId: 'doc-boleta',
          pagoId: null,
        });
        expect(advertencia).not.toHaveBeenCalled();
      });

      it('ninguno: sin documento, como siempre (tipo NC), y sin advertencia', async () => {
        await expect(via([])).resolves.toEqual({
          tipo: 'pasarela',
          documentoId: null,
          pagoId: null,
        });
        expect(advertencia).not.toHaveBeenCalled();
      });

      it('más de uno (inalcanzable hoy): sin documento y una advertencia con la venta y la orden', async () => {
        await expect(
          via([{ documento_id: 'a' }, { documento_id: 'b' }]),
        ).resolves.toEqual({
          tipo: 'pasarela',
          documentoId: null,
          pagoId: null,
        });

        expect(advertencia).toHaveBeenCalledTimes(1);
        const mensaje = String(advertencia.mock.calls[0][0]);
        expect(mensaje).toContain(VENTA_ORIG_ID);
        expect(mensaje).toContain('orden-1');
      });

      it('con un único pago lo trae: lo que devolvió la pasarela gasta el tope de ese pago', async () => {
        await expect(
          via([{ documento_id: 'doc-boleta' }], [{ pago_id: 'pago-unico' }]),
        ).resolves.toEqual({
          tipo: 'pasarela',
          documentoId: 'doc-boleta',
          pagoId: 'pago-unico',
        });
      });

      it('con dos pagos no elige ninguno: elegir uno sería adivinar, y queda una advertencia con la venta y la orden', async () => {
        const r = await via(
          [{ documento_id: 'doc-boleta' }],
          [{ pago_id: 'p-1' }, { pago_id: 'p-2' }],
        );

        expect(r.tipo === 'pasarela' && r.pagoId).toBeNull();
        expect(advertencia).toHaveBeenCalledTimes(1);
        const mensaje = String(advertencia.mock.calls[0][0]);
        expect(mensaje).toContain(VENTA_ORIG_ID);
        expect(mensaje).toContain('orden-1');
        expect(mensaje).toContain('pago');
      });

      it('con un pago, o con ninguno, no hay advertencia: una venta sin pagos no es rara', async () => {
        await via([{ documento_id: 'doc-boleta' }], [{ pago_id: 'p-1' }]);
        await via([{ documento_id: 'doc-boleta' }], []);

        expect(advertencia).not.toHaveBeenCalled();
      });

      it('mira solo los documentos válidos de esa venta y ese tenant', async () => {
        await via([]);

        const [sql, params] = dataSourceMock.query.mock.calls[0] as [
          string,
          unknown[],
        ];
        expect(sql).toContain('FROM venta_documentos');
        expect(sql).toContain('descarte IS NULL');
        expect(sql).toContain('es_duplicado = false');
        expect(sql).toContain('eliminado_el IS NULL');
        expect(sql).toContain('tenant_id = $2');
        expect(params).toEqual([VENTA_ORIG_ID, TENANT_ID]);
      });

      it('y de sus pagos solo los vivos de esa venta y ese tenant', async () => {
        await via([]);

        const [sql, params] = dataSourceMock.query.mock.calls[1] as [
          string,
          unknown[],
        ];
        expect(sql).toContain('FROM pagos');
        expect(sql).toContain('eliminado_el IS NULL');
        expect(sql).toContain('tenant_id = $2');
        expect(params).toEqual([VENTA_ORIG_ID, TENANT_ID]);
      });
    });

    /**
     * Reponer toma un `FOR UPDATE` por ítem (`registrarMovimiento`), y la NC recorría las líneas en
     * el orden en que las mandó el cliente: dos devoluciones
     * cruzadas sobre los mismos productos podían bloquearse en cruz (auditoría `inventario`,
     * 2026-08-15). El arreglo es el de `crear()` y `cancelar()`: orden por `itemId` con el mismo
     * comparador, y reintento ante `40P01`.
     */
    describe('orden y reintento ante deadlock', () => {
      // Ordena antes que `ITEM_ID` con `localeCompare`, que es el comparador que usan `crear()` y
      // `cancelar()`.
      const ITEM_ANTES_ID = '000e8400-e29b-41d4-a716-446655440001';
      const deadlock = Object.assign(new Error('deadlock detected'), {
        code: '40P01',
      });

      /** La venta original con un segundo producto que repone, además de `ITEM_ID`. */
      function conOtroProductoQueRepone() {
        const previa = ncManager.query.getMockImplementation()!;
        ncManager.query.mockImplementation((sql: string, params?: unknown) =>
          sql.includes('FROM venta_detalles') &&
          !sql.includes('AS es_nc') &&
          !sql.includes('FOR UPDATE')
            ? Promise.resolve([
                ...detallesRows,
                {
                  ...detallesRows[0],
                  item_id: ITEM_ANTES_ID,
                  cantidad: '1',
                  total_linea: '100.0000',
                  descripcion: 'Cargador',
                },
              ])
            : (previa(sql, params) as Promise<unknown>),
        );
      }

      const itemsRepuestos = () =>
        inventarioService.registrarMovimiento.mock.calls.map(
          (c) => (c[1] as { itemId: string }).itemId,
        );

      it('la NC repone en orden de itemId, no en el que llegaron las devoluciones', async () => {
        conOtroProductoQueRepone();

        await service.crearNotaCredito({
          ...baseParams,
          devoluciones: [
            { itemId: ITEM_ID, cantidad: '1' },
            { itemId: ITEM_ANTES_ID, cantidad: '1' },
          ],
        });

        expect(itemsRepuestos()).toEqual([ITEM_ANTES_ID, ITEM_ID]);
      });

      it('la NC reintenta ante un deadlock', async () => {
        dataSourceMock.transaction
          .mockRejectedValueOnce(deadlock)
          .mockImplementationOnce((cb: (m: unknown) => unknown) =>
            cb(ncManager),
          );

        const res = await service.crearNotaCredito(baseParams);

        expect(res.totalFinal).toBe('1100.0000');
        expect(dataSourceMock.transaction).toHaveBeenCalledTimes(2);
      });

      it('la NC no reintenta un error de negocio', async () => {
        dataSourceMock.transaction.mockRejectedValueOnce(
          new BadRequestException('Stock insuficiente para la salida'),
        );

        await expect(service.crearNotaCredito(baseParams)).rejects.toThrow(
          'Stock insuficiente para la salida',
        );
        expect(dataSourceMock.transaction).toHaveBeenCalledTimes(1);
      });
    });

    describe('completarNumeroDocumento()', () => {
      const DOCUMENTO_ID = 'documento-uuid-1';
      const params = (over: Record<string, unknown> = {}) => ({
        tenantId: TENANT_ID,
        usuarioId: USUARIO_ID,
        verTodas: true,
        ventaId: VENTA_ORIG_ID,
        documentoId: DOCUMENTO_ID,
        numero: '445566',
        ...over,
      });
      let visible: unknown[];
      let delaVenta: unknown[];
      const orden = (patron: string) =>
        ncManager.query.mock.calls.findIndex((c) =>
          String(c[0]).includes(patron),
        );

      beforeEach(() => {
        visible = [{ '?column?': 1 }];
        delaVenta = [{ '?column?': 1 }];
        ventaRows = [ventaOriginalRow];
        ventaDocumentosMock.completarNumero.mockResolvedValue({
          id: DOCUMENTO_ID,
          numero: '445566',
        });
        ncManager.query.mockImplementation((sql: string) => {
          if (sql.includes('FOR UPDATE')) return Promise.resolve(ventaRows);
          if (sql.includes('FROM venta_documentos'))
            return Promise.resolve(delaVenta);
          if (sql.includes('FROM ventas v')) return Promise.resolve(visible);
          return Promise.resolve([]);
        });
      });

      it('toma el lock de la venta y delega la escritura con lo que tipeó, sin nada del request', async () => {
        const res = await service.completarNumeroDocumento(
          params({ clase: 'voucher' }),
        );
        expect(res).toEqual({ id: DOCUMENTO_ID, numero: '445566' });
        expect(ventaDocumentosMock.completarNumero).toHaveBeenCalledWith(
          ncManager,
          {
            tenantId: TENANT_ID,
            documentoId: DOCUMENTO_ID,
            numero: '445566',
            clase: 'voucher',
          },
        );
      });

      it('el lock (FOR UPDATE) va antes de leer el documento y de escribir', async () => {
        await service.completarNumeroDocumento(params());
        const lock = orden('FOR UPDATE');
        expect(lock).toBeGreaterThanOrEqual(0);
        expect(lock).toBeLessThan(orden('FROM venta_documentos'));
        expect(ncManager.query.mock.invocationCallOrder[lock]).toBeLessThan(
          ventaDocumentosMock.completarNumero.mock.invocationCallOrder[0],
        );
      });

      it('una venta que no es del cajero es 404, sin lock y sin escribir', async () => {
        visible = [];
        await expect(
          service.completarNumeroDocumento(params({ verTodas: false })),
        ).rejects.toThrow(NotFoundException);
        expect(orden('FOR UPDATE')).toBe(-1);
        expect(ventaDocumentosMock.completarNumero).not.toHaveBeenCalled();
        const alcance = ncManager.query.mock.calls[0];
        expect(String(alcance[0])).toContain('c.usuario_id =');
        expect(alcance[1]).toEqual([VENTA_ORIG_ID, TENANT_ID, USUARIO_ID]);
      });

      it('con alcance sobre todas las cajas no filtra por usuario', async () => {
        await service.completarNumeroDocumento(params({ verTodas: true }));
        const alcance = ncManager.query.mock.calls[0];
        expect(String(alcance[0])).not.toContain('c.usuario_id');
        expect(alcance[1]).toEqual([VENTA_ORIG_ID, TENANT_ID]);
      });

      it('un documento que no es de esa venta es 404 y no escribe', async () => {
        delaVenta = [];
        await expect(
          service.completarNumeroDocumento(params()),
        ).rejects.toThrow(NotFoundException);
        expect(ventaDocumentosMock.completarNumero).not.toHaveBeenCalled();
        const lectura = ncManager.query.mock.calls.find((c) =>
          String(c[0]).includes('FROM venta_documentos'),
        )!;
        expect(String(lectura[0])).toContain('venta_id = $2');
        expect(String(lectura[0])).toContain('eliminado_el IS NULL');
        expect(lectura[1]).toEqual([DOCUMENTO_ID, VENTA_ORIG_ID, TENANT_ID]);
      });

      it('lo que rechaza el servicio de documentos (400, 404) sale tal cual', async () => {
        ventaDocumentosMock.completarNumero.mockRejectedValueOnce(
          new BadRequestException('la clase solo con la máquina'),
        );
        await expect(
          service.completarNumeroDocumento(params()),
        ).rejects.toThrow('la clase solo con la máquina');
      });
    });

    describe('cancelar()', () => {
      const cancelarParams = {
        tenantId: TENANT_ID,
        usuarioId: USUARIO_ID,
        verTodas: true,
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
      // El alcance de caja (`exigirVentaVisible`): vacío = la venta no es suya.
      let visible: unknown[];
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
        visible = [{ '?column?': 1 }];
        ncManager.query.mockImplementation((sql: string) => {
          if (sql.includes('FOR UPDATE')) return Promise.resolve(ventaRows);
          if (sql.includes('FROM ventas v')) return Promise.resolve(visible);
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

      it('anula una venta pendiente sin pagos aunque tenga tipo de documento', async () => {
        // La etiqueta ya no impide anular: desde que toda venta nace con la
        // boleta del país, mirarla dejaría a ninguna venta anulable. Un documento
        // solo armado y sin enviar no cuenta como emitido (E8), y hoy no se
        // envía nada.
        ventaRows = [{ ...ventaAnulable, tipo_documento_id: 'doc-uuid' }];

        const res = await service.cancelar(cancelarParams);

        expect(res.estado).toBe(EstadoVenta.CANCELADA);
        expect(res.stockRepuesto).toBe(true);
      });

      it('con tipo de documento sigue rechazando una venta con pagos o ya pagada', async () => {
        ventaRows = [{ ...ventaAnulable, tipo_documento_id: 'doc-uuid' }];
        conPagos = [{ '1': 1 }];
        await expect(service.cancelar(cancelarParams)).rejects.toThrow(
          /pagos registrados: se revierte con nota de crédito/,
        );

        ventaRows = [
          {
            ...ventaAnulable,
            tipo_documento_id: 'doc-uuid',
            estado: 'pagada',
          },
        ];
        await expect(service.cancelar(cancelarParams)).rejects.toThrow(
          /Solo se anula una venta pendiente/,
        );
      });

      describe('lo emitido decide (E8, E10)', () => {
        it('le pide a los documentos que descarten, con el usuario del token y en la transacción de la anulación', async () => {
          await service.cancelar({ ...cancelarParams, externoHecho: false });

          expect(ventaDocumentosMock.descartarAlAnular).toHaveBeenCalledTimes(
            1,
          );
          expect(ventaDocumentosMock.descartarAlAnular).toHaveBeenCalledWith(
            ncManager,
            {
              tenantId: TENANT_ID,
              ventaId: VENTA_ORIG_ID,
              usuarioId: USUARIO_ID,
              externoHecho: false,
            },
          );
        });

        it.each([undefined, true, false])(
          'pasa externoHecho = %s tal cual: ausente y false son dos conductas',
          async (externoHecho) => {
            await service.cancelar({ ...cancelarParams, externoHecho });
            const [, args] = ventaDocumentosMock.descartarAlAnular.mock
              .calls[0] as [unknown, { externoHecho?: boolean }];
            expect(args.externoHecho).toBe(externoHecho);
          },
        );

        it('si los documentos bloquean, el 400 sale tal cual y no se mueve stock ni se cancela la venta', async () => {
          ventaDocumentosMock.descartarAlAnular.mockRejectedValueOnce(
            new BadRequestException('motivo de los documentos'),
          );
          await expect(service.cancelar(cancelarParams)).rejects.toThrow(
            'motivo de los documentos',
          );
          expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
          expect(
            ncManager.query.mock.calls.some((c) =>
              String(c[0]).includes('UPDATE ventas'),
            ),
          ).toBe(false);
        });

        it('una venta que ya no es anulable por estado o por pagos ni llega a mirar los documentos', async () => {
          ventaRows = [{ ...ventaAnulable, estado: 'pagada' }];
          await expect(service.cancelar(cancelarParams)).rejects.toThrow(
            /Solo se anula una venta pendiente/,
          );
          ventaRows = [ventaAnulable];
          conPagos = [{ '1': 1 }];
          await expect(service.cancelar(cancelarParams)).rejects.toThrow(
            /pagos registrados/,
          );
          expect(ventaDocumentosMock.descartarAlAnular).not.toHaveBeenCalled();
        });

        it('una venta con una nota de crédito no se anula: ni repone stock ni mira los documentos', async () => {
          const base = ncManager.query.getMockImplementation()!;
          // La pendiente que una nota "no vuelve plata" parcial dejó pendiente y sin pagos.
          ncManager.query.mockImplementation((sql: string) =>
            sql.includes('venta_referencia_id = $1')
              ? Promise.resolve([{ '?column?': 1 }])
              : base(sql),
          );
          await expect(service.cancelar(cancelarParams)).rejects.toThrow(
            /ya tiene una nota de crédito/,
          );
          expect(ventaDocumentosMock.descartarAlAnular).not.toHaveBeenCalled();
          expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
        });

        it('descarta ANTES de reponer stock: lo que bloquea no deja movimientos a medias', async () => {
          await service.cancelar(cancelarParams);
          const ordenDescarte =
            ventaDocumentosMock.descartarAlAnular.mock.invocationCallOrder[0];
          const ordenStock =
            inventarioService.registrarMovimiento.mock.invocationCallOrder[0];
          expect(ordenDescarte).toBeLessThan(ordenStock);
        });
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

      it('una venta que no es del cajero es 404, sin lock y sin anular', async () => {
        visible = [];
        await expect(
          service.cancelar({ ...cancelarParams, verTodas: false }),
        ).rejects.toThrow(NotFoundException);
        const llamadas = ncManager.query.mock.calls.map((c) => String(c[0]));
        expect(llamadas.some((q) => q.includes('FOR UPDATE'))).toBe(false);
        expect(llamadas.some((q) => q.includes('UPDATE ventas'))).toBe(false);
        expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
        const alcance = ncManager.query.mock.calls[0];
        expect(String(alcance[0])).toContain('c.usuario_id =');
        expect(alcance[1]).toEqual([VENTA_ORIG_ID, TENANT_ID, USUARIO_ID]);
      });

      it('con alcance sobre todas las cajas no filtra por usuario', async () => {
        await service.cancelar(cancelarParams);
        const alcance = ncManager.query.mock.calls[0];
        expect(String(alcance[0])).toContain('FROM ventas v');
        expect(String(alcance[0])).not.toContain('c.usuario_id');
        expect(alcance[1]).toEqual([VENTA_ORIG_ID, TENANT_ID]);
      });
    });

    describe('crearNotaCreditoDesdeVenta()', () => {
      const CLAVE = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7';
      const desdeVenta = { ...baseParams, verTodas: true, clave: CLAVE };
      const consultaDeAlcance = () =>
        dataSourceMock.query.mock.calls.find((c) =>
          String(c[0]).includes('FROM ventas v'),
        );

      it('una venta que no es del cajero es 404, sin abrir la transacción', async () => {
        dataSourceMock.query.mockResolvedValueOnce([]);
        await expect(
          service.crearNotaCreditoDesdeVenta({
            ...desdeVenta,
            verTodas: false,
          }),
        ).rejects.toThrow(NotFoundException);
        expect(dataSourceMock.transaction).not.toHaveBeenCalled();
        const alcance = consultaDeAlcance()!;
        expect(String(alcance[0])).toContain('c.usuario_id =');
        expect(alcance[1]).toEqual([VENTA_ORIG_ID, TENANT_ID, USUARIO_ID]);
      });

      it('con alcance sobre todas las cajas no filtra por usuario', async () => {
        await service.crearNotaCreditoDesdeVenta(desdeVenta);
        const alcance = consultaDeAlcance()!;
        expect(String(alcance[0])).not.toContain('c.usuario_id');
        expect(alcance[1]).toEqual([VENTA_ORIG_ID, TENANT_ID]);
      });

      it('emite dentro de IdempotenciaService.ejecutar, con la clave y una huella de lo que se pidió', async () => {
        await service.crearNotaCreditoDesdeVenta(desdeVenta);
        expect(idempotencia.ejecutar).toHaveBeenCalledTimes(1);
        const [solicitud] = idempotencia.ejecutar.mock.calls[0] as [
          SolicitudIdempotenteInput,
        ];
        expect(solicitud).toEqual({
          tenantId: TENANT_ID,
          usuarioId: USUARIO_ID,
          clave: CLAVE,
          operacion: 'notaCredito.emitir',
          huella: expect.any(String) as string,
          mensajeOtrosDatos: MENSAJE_NOTA_CREDITO_OTROS_DATOS,
        });
        // Otro monto con la misma clave tiene que caer en "otros datos".
        await service.crearNotaCreditoDesdeVenta({ ...desdeVenta, monto: '1' });
        const [otra] = idempotencia.ejecutar.mock.calls[1] as [
          SolicitudIdempotenteInput,
        ];
        expect(otra.huella).not.toBe(solicitud.huella);
      });

      it('sin receptor la huella es la de antes del campo (una clave previa al deploy se reproduce); con receptor, cambia', async () => {
        await service.crearNotaCreditoDesdeVenta(desdeVenta);
        await service.crearNotaCreditoDesdeVenta({
          ...desdeVenta,
          receptor: { nombre: 'Juan Pérez', rut: '12.345.678-5' },
        });
        const [[sin], [con]] = idempotencia.ejecutar.mock.calls as [
          SolicitudIdempotenteInput,
        ][];
        // Literal a la composición anterior al receptor, sin la clave.
        expect(sin.huella).toBe(
          huellaDe('notaCredito.emitir', {
            ventaId: VENTA_ORIG_ID,
            monto: baseParams.monto,
            comentario: baseParams.comentario,
            devoluciones: [],
            via: baseParams.via,
          }),
        );
        expect(con.huella).not.toBe(sin.huella);
      });

      it('los mismos ítems devueltos en otro orden dan la misma huella', async () => {
        const a = { itemId: ITEM_ID, cantidad: '1' };
        const b = {
          itemId: '00000000-0000-4000-8000-000000000001',
          cantidad: '2',
          reponerStock: false,
        };
        await service
          .crearNotaCreditoDesdeVenta({ ...desdeVenta, devoluciones: [a, b] })
          .catch(() => undefined);
        await service
          .crearNotaCreditoDesdeVenta({ ...desdeVenta, devoluciones: [b, a] })
          .catch(() => undefined);
        const [[primera], [segunda]] = idempotencia.ejecutar.mock.calls as [
          SolicitudIdempotenteInput,
        ][];
        expect(segunda.huella).toBe(primera.huella);
      });

      it('feliz sin dinero: delega en crearNotaCredito y devuelve movimientoCajaId null', async () => {
        const res = await service.crearNotaCreditoDesdeVenta(desdeVenta);
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

        const res = await service.crearNotaCreditoDesdeVenta(desdeVenta);

        expect(res.totalFinal).toBe('1100.0000');
      });

      it('rechaza una venta cancelada, aunque la nota sea "no vuelve plata"', async () => {
        ventaRows = [{ ...ventaOriginalRow, estado: 'cancelada' }];
        await expect(
          service.crearNotaCreditoDesdeVenta({
            ...desdeVenta,
            via: { tipo: 'sin_plata' },
          }),
        ).rejects.toThrow(/Solo se puede emitir nota de crédito de ventas/);
      });

      it('una venta pendiente rechaza la nota por un pago: todavía no tiene pagos', async () => {
        ventaRows = [{ ...ventaOriginalRow, estado: 'pendiente' }];
        await expect(
          service.crearNotaCreditoDesdeVenta(desdeVenta),
        ).rejects.toThrow(/todavía no tiene pagos/);
      });

      it('una venta pendiente admite la nota "no vuelve plata"', async () => {
        ventaRows = [{ ...ventaOriginalRow, estado: 'pendiente' }];
        ventaDocumentosMock.documentoQueCorrige.mockResolvedValueOnce({
          documento: null,
          saldo: '1100.0000',
          mueveCaja: false,
          devolvibleDelPago: null,
        });

        const res = await service.crearNotaCreditoDesdeVenta({
          ...desdeVenta,
          via: { tipo: 'sin_plata' },
        });

        expect(res.totalFinal).toBe('1100.0000');
      });

      it('rechaza devolver en efectivo más de lo que la venta cobró en efectivo', async () => {
        conSalidaDeCaja();
        // Venta de 1100 pagada con 200 en efectivo y el resto con tarjeta: el
        // saldo GLOBAL de la caja alcanza (viene de otras ventas), pero esta
        // venta solo ingresó 200 en billetes.
        efectivoCobrado = '200.0000';

        await expect(
          service.crearNotaCreditoDesdeVenta(desdeVenta),
        ).rejects.toThrow(/más de lo que esta venta cobró en efectivo/);

        expect(
          cajaService.registrarMovimientoEnTransaccion,
        ).not.toHaveBeenCalled();
      });

      it('el 422 NO imprime el efectivo disponible (fuga 5 del modo ciego)', async () => {
        conSalidaDeCaja();
        // Era un oráculo de UN request: monto = techo + 1 y el mensaje
        // devolvía el efectivo cobrado de la venta, sin emitir ninguna NC.
        efectivoCobrado = '200.0000';

        const error = (await service
          .crearNotaCreditoDesdeVenta(desdeVenta)
          .catch((e: Error) => e)) as Error;

        expect(error).toBeInstanceOf(IntentoRechazadoError);
        expect(error.message).not.toMatch(/200/);
        expect(error.message).not.toMatch(/disponible/);
      });

      it('el intento rechazado se entrega al rastro con quién, qué caja, cuánto pidió y sobre qué venta', async () => {
        conSalidaDeCaja();
        efectivoCobrado = '200.0000';

        const error = (await service
          .crearNotaCreditoDesdeVenta(desdeVenta)
          .catch((e: Error) => e)) as IntentoRechazadoError;

        expect(error.intento).toEqual({
          cajaId: CAJA_ID,
          usuarioId: USUARIO_ID,
          tipo: 'devolucion_nc',
          motivo: 'supera_efectivo_de_la_venta',
          montoSolicitado: '1100.0000',
          ventaId: VENTA_ORIG_ID,
        });
        // Y la operación entera pasó por el envoltorio que lo escribe fuera de
        // la transacción: sin esto el 422 se lleva el rastro en el rollback.
        expect(cajaService.conRastroDeRechazo).toHaveBeenCalledWith(
          TENANT_ID,
          expect.any(Function),
        );
      });

      it('el 422 de saldo insuficiente en la NC también deja intento, con su propio motivo', async () => {
        conSalidaDeCaja();
        efectivoCobrado = '5000.0000';
        cajaService.calcularEsperadoEfectivo.mockResolvedValueOnce('10.0000');

        const error = (await service
          .crearNotaCreditoDesdeVenta(desdeVenta)
          .catch((e: Error) => e)) as IntentoRechazadoError;

        expect(error.message).toBe('Saldo insuficiente en caja');
        expect(error.intento.motivo).toBe('saldo_insuficiente');
        expect(error.intento.tipo).toBe('devolucion_nc');
      });

      it('el tope acota el DINERO, no el documento: la NC sin devolución pasa igual', async () => {
        // Distinción central: anular una venta cobrada a medias es legítimo
        // (borra la cuenta por cobrar); devolver efectivo que nunca entró, no.
        efectivoCobrado = '0.0000';

        const res = await service.crearNotaCreditoDesdeVenta(desdeVenta);

        expect(res.totalFinal).toBe('1100.0000');
        expect(res.movimientoCajaId).toBeNull();
      });

      it('descuenta lo ya devuelto en efectivo por NCs anteriores', async () => {
        conSalidaDeCaja();
        efectivoCobrado = '1100.0000';
        efectivoDevuelto = '900.0000'; // disponible: 200

        await expect(
          service.crearNotaCreditoDesdeVenta(desdeVenta),
        ).rejects.toThrow(/más de lo que esta venta cobró en efectivo/);
      });

      it('el efectivo ya devuelto cuenta toda corrección que sacó plata de la caja, lleve o no el tipo NC', async () => {
        conSalidaDeCaja();

        await service.crearNotaCreditoDesdeVenta(desdeVenta);

        const sqlEfectivo = ncManager.query.mock.calls
          .map((c: unknown[]) => String(c[0]))
          .find((q) => q.includes('es_efectivo'))!;
        expect(sqlEfectivo).toContain('nc.venta_referencia_id = $1');
        expect(sqlEfectivo).not.toContain('tipo_documento_id');
      });

      it('rechaza NC sobre otra NC', async () => {
        // Una corrección se reconoce por `venta_referencia_id`, no por el tipo.
        ventaRows = [
          {
            ...ventaOriginalRow,
            tipo_documento_id: TIPO_DOCUMENTO_NC_ID,
            venta_referencia_id: 'venta-madre',
          },
        ];
        await expect(
          service.crearNotaCreditoDesdeVenta(desdeVenta),
        ).rejects.toThrow(
          'No se puede emitir una nota de crédito sobre otra nota de crédito',
        );
      });

      it('rechaza NC sobre una devolución interna (tipo nulo): también es una corrección', async () => {
        ventaRows = [
          {
            ...ventaOriginalRow,
            tipo_documento_id: null,
            venta_referencia_id: 'venta-madre',
          },
        ];
        await expect(
          service.crearNotaCreditoDesdeVenta(desdeVenta),
        ).rejects.toThrow(
          'No se puede emitir una nota de crédito sobre otra nota de crédito',
        );
      });

      it('por el pago en efectivo: registra salida en la caja activa ligada a la NC', async () => {
        conSalidaDeCaja();
        const res = await service.crearNotaCreditoDesdeVenta(desdeVenta);
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

      it('por el pago en efectivo sin caja física abierta → 422', async () => {
        conSalidaDeCaja();
        cajaService.findActiva.mockResolvedValueOnce(null);
        await expect(
          service.crearNotaCreditoDesdeVenta(desdeVenta),
        ).rejects.toThrow(UnprocessableEntityException);
      });

      it('por el pago en efectivo con saldo insuficiente → 422 y no registra movimiento', async () => {
        conSalidaDeCaja();
        cajaService.calcularEsperadoEfectivo.mockResolvedValueOnce('1000.0000');
        await expect(
          service.crearNotaCreditoDesdeVenta(desdeVenta),
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
  describe('el eje "lo mío / todo"', () => {
    const USUARIO = 'usuario-uuid-eje';

    // Saltea la resolución del tipo "nota de crédito" del país: es una consulta
    // de apoyo que corre en varios de estos métodos y correría los índices.
    const sqlDe = (llamada: number): string =>
      dataSourceMock.query.mock.calls
        .map((c: unknown[]) => c[0] as string)
        .filter((sql: string) => !sql.includes('es_nota_credito'))
        [llamada].replace(/\s+/g, ' ');

    it('sin alcance completo, listar acota a las cajas del usuario', async () => {
      dataSourceMock.query
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([]);

      await service.listar(TENANT_ID, {}, USUARIO, false);

      const sql = sqlDe(0);
      expect(sql).toContain('EXISTS');
      expect(sql).toContain('FROM cajas c');
      expect(sql).toContain('c.caja_id = v.caja_id');
      expect(sql).toContain('c.usuario_id =');
      expect(dataSourceMock.query.mock.calls[0][1]).toContain(USUARIO);
    });

    it('la venta ONLINE queda visible aunque no sea de nadie', async () => {
      // Va siempre contra la caja virtual del tenant (`findVirtual`), nunca
      // contra una física, así que no puede revelar el esperado de ningún cajón
      // que alguien vaya a arquear — que es lo único que este eje protege.
      // Ocultársela al cajero rompería una pantalla legítima a cambio de nada.
      dataSourceMock.query
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([]);

      await service.listar(TENANT_ID, {}, USUARIO, false);

      expect(sqlDe(0)).toContain("v.canal = 'online'");
    });

    it('el mismo filtro va en el COUNT y en las filas', async () => {
      dataSourceMock.query
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([]);

      await service.listar(TENANT_ID, {}, USUARIO, false);

      expect(sqlDe(0)).toContain('c.usuario_id =');
      expect(sqlDe(1)).toContain('c.usuario_id =');
    });

    it('con alcance completo no acota nada', async () => {
      dataSourceMock.query
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([]);

      await service.listar(TENANT_ID, {}, USUARIO, true);

      expect(sqlDe(0)).not.toContain('c.usuario_id =');
    });

    it('resumen acota igual, y con alcance completo no', async () => {
      const encolarResumen = () =>
        dataSourceMock.query.mockResolvedValueOnce([{}]);

      encolarResumen();
      await service.resumen(TENANT_ID, USUARIO, false);
      expect(sqlDe(0)).toContain('c.usuario_id =');

      dataSourceMock.query.mockClear();
      encolarResumen();
      await service.resumen(TENANT_ID, USUARIO, true);
      expect(sqlDe(0)).not.toContain('c.usuario_id =');
    });

    it('el caja_id de un pago ajeno se redacta, aunque la venta sea propia', async () => {
      // El abono cruzado: A deja una venta por cobrar, B la abona con SU caja.
      // La cabecera no corta —la venta es de A— así que sin esto A se lleva el
      // triplete caja_id + monto + vuelto de la caja de B.
      dataSourceMock.query.mockResolvedValue([]);
      dataSourceMock.query.mockResolvedValueOnce([
        {
          venta_id: 'v1',
          caja_id: 'caja-a',
          canal: 'fisico',
          estado: 'pagada',
        },
      ]);

      await service.findOne(TENANT_ID, 'v1', USUARIO, false).catch(() => null);

      const sqlPagos = dataSourceMock.query.mock.calls
        .map((c: unknown[]) => (c[0] as string).replace(/\s+/g, ' '))
        .find((sql: string) => sql.includes('FROM pagos WHERE venta_id'));
      expect(sqlPagos).toBeDefined();
      expect(sqlPagos).toContain('CASE WHEN');
      expect(sqlPagos).toContain('c.usuario_id =');
    });

    it('findOne de una venta ajena responde 404, no el detalle', async () => {
      // 404 y no 403: un 403 confirmaría que la venta existe. El detalle trae
      // caja_id, monto y vuelto por pago — es la fuga 3 de la auditoría.
      dataSourceMock.query.mockResolvedValueOnce([]);

      await expect(
        service.findOne(TENANT_ID, 'venta-ajena', USUARIO, false),
      ).rejects.toThrow(NotFoundException);

      expect(sqlDe(0)).toContain('c.usuario_id =');
    });
  });

  /**
   * El default del checkbox "Reponer el stock" del modal de anulación. Reponer
   * comida que la cocina ya hizo mete al inventario ingredientes que
   * físicamente no existen, así que la venta tiene que poder decir si alguna de
   * sus líneas salió despachada. `cantidad_enviada` vive SOLO en
   * `cuenta_lineas`, y se llega por `cuentas.venta_id`.
   */
  describe('la marca de líneas ya despachadas a cocina', () => {
    const USUARIO = 'usuario-uuid-despacho';
    const VENTA_ID = 'venta-uuid-despacho';

    /** La cabecera con el `EXISTS` ya resuelto por la base. */
    const cabecera = (despachadas: boolean) => ({
      venta_id: VENTA_ID,
      caja_id: CAJA_ID,
      moneda_id: MONEDA_OFICIAL_ID,
      tipo_documento_id: null,
      canal: 'fisico',
      estado: 'pendiente',
      total_bruto: '5000.0000',
      total_descuentos: '0',
      total_recargos: '0',
      total_impuestos: '0',
      total_final: '5000.0000',
      comentario: null,
      fecha: new Date('2026-08-23'),
      creado_el: new Date('2026-08-23'),
      venta_referencia_id: null,
      tipo_documento_codigo: null,
      tipo_documento_nombre: null,
      tiene_lineas_despachadas: despachadas,
    });

    const responderCabecera = (despachadas: boolean) => {
      dataSourceMock.query.mockImplementation((sql: string) =>
        sql.includes('FROM ventas v')
          ? Promise.resolve([cabecera(despachadas)])
          : Promise.resolve([]),
      );
    };

    /** El SQL de la cabecera, normalizado a un solo espacio. */
    const sqlCabecera = (): string =>
      (dataSourceMock.query.mock.calls[0][0] as string).replace(/\s+/g, ' ');

    it('viaja en true cuando la cuenta tenía algo ya enviado a cocina', async () => {
      responderCabecera(true);

      const res = await service.findOne(TENANT_ID, VENTA_ID, USUARIO, true);

      expect(res.tieneLineasDespachadas).toBe(true);
    });

    it('viaja en false cuando la cuenta existe pero nunca se mandó comanda', async () => {
      responderCabecera(false);

      const res = await service.findOne(TENANT_ID, VENTA_ID, USUARIO, true);

      expect(res.tieneLineasDespachadas).toBe(false);
    });

    it('la venta de POS —sin cuenta— viaja en false, y no puede heredar la de otra venta', async () => {
      // El `EXISTS` no encuentra ninguna fila de `cuentas`, así que da false. Lo
      // que hace que eso sea cierto y no una casualidad del mock es la
      // correlación: sin `cta.venta_id = v.venta_id` el EXISTS sería global y
      // CUALQUIER venta del tenant nacería destildada en cuanto una sola mesa
      // del local hubiera despachado algo alguna vez.
      responderCabecera(false);

      const res = await service.findOne(TENANT_ID, VENTA_ID, USUARIO, true);

      expect(res.tieneLineasDespachadas).toBe(false);
      expect(sqlCabecera()).toContain('cta.venta_id = v.venta_id');
    });

    it('mira lo DESPACHADO, no la mera existencia de la cuenta', async () => {
      // Sin esta condición el flag daría true para toda venta que venga de
      // salón —haya salido o no un plato— y el checkbox nacería destildado
      // siempre, que es justo lo que la decisión no dice.
      responderCabecera(true);

      await service.findOne(TENANT_ID, VENTA_ID, USUARIO, true);

      expect(sqlCabecera()).toContain('cl.cantidad_enviada > 0');
    });

    it('no cuenta cuentas ni líneas borradas', async () => {
      responderCabecera(true);

      await service.findOne(TENANT_ID, VENTA_ID, USUARIO, true);

      const sql = sqlCabecera();
      expect(sql).toContain('cl.eliminado_el IS NULL');
      expect(sql).toContain('cta.eliminado_el IS NULL');
    });

    it('el tenant sale de la venta, no de la cuenta suelta', async () => {
      responderCabecera(true);

      await service.findOne(TENANT_ID, VENTA_ID, USUARIO, true);

      expect(sqlCabecera()).toContain('cta.tenant_id = v.tenant_id');
    });
  });

  /**
   * Lo que el detalle decide sobre los documentos (spec `2026-10-01-emision-por-venta`,
   * § 3.4 y § 3.5): `anulable`, `anularPreguntaExterno` y `abonoConMaquinaDuplica`.
   * La pantalla solo los muestra, así que cada uno se afirma contra la regla real
   * (estado + pagos + lo emitido), no contra su valor por defecto.
   */
  describe('findOne() — documentos y banderas del detalle', () => {
    const VENTA_ID = 'venta-uuid-documentos';
    const USUARIO = 'usuario-uuid-documentos';

    /**
     * Una venta de $100.000. `aplicado` es lo aplicado A LA VENTA por sus pagos,
     * y `propina` lo que quedó de propina (no baja el saldo). Cada pago existe
     * solo si lo aplicado lo exige, porque `SELECT 1 FROM pagos` es la pregunta
     * de "tiene pagos".
     */
    const responder = (
      estado: string,
      aplicado: string,
      propina = '0',
      tienePagos = aplicado !== '0' || propina !== '0',
      // El saldo lo calcula la expresión única del SQL (`saldo-venta.ts`), que un mock
      // no ve: por defecto es el total menos lo aplicado, y un caso con una nota "sin
      // plata" lo fija a mano.
      saldo: string = Math.max(0, 100000 - Number(aplicado)).toString(),
    ) => {
      dataSourceMock.query.mockImplementation((sql: string) => {
        if (sql.includes('sv_c.venta_referencia_id'))
          return Promise.resolve([{ saldo }]);
        if (sql.includes('SELECT 1 FROM pagos'))
          return Promise.resolve(tienePagos ? [{ '?column?': 1 }] : []);
        if (sql.includes('FROM pago_aplicaciones'))
          return Promise.resolve(
            [
              { tipo: 'venta', monto: aplicado },
              { tipo: 'propina', monto: propina },
            ]
              .filter((a) => a.monto !== '0')
              .map((a, i) => ({
                pago_aplicacion_id: `pa-${i}`,
                pago_id: 'pago-1',
                tipo: a.tipo,
                referencia_id: null,
                monto: a.monto,
              })),
          );
        if (sql.includes('FROM pagos '))
          return Promise.resolve(
            tienePagos
              ? [
                  {
                    pago_id: 'pago-1',
                    metodo_pago_id: EFECTIVO_ID,
                    moneda_oficial_id: MONEDA_OFICIAL_ID,
                    caja_id: CAJA_ID,
                    monto: '1',
                    vuelto: '0',
                    fecha: new Date('2026-10-01'),
                    referencia: null,
                  },
                ]
              : [],
          );
        if (sql.includes('FROM ventas v'))
          return Promise.resolve([
            {
              venta_id: VENTA_ID,
              caja_id: CAJA_ID,
              moneda_id: MONEDA_OFICIAL_ID,
              tipo_documento_id: null,
              canal: 'fisico',
              estado,
              total_bruto: '100000.0000',
              total_descuentos: '0',
              total_recargos: '0',
              total_impuestos: '0',
              total_final: '100000.0000',
              comentario: null,
              fecha: new Date('2026-10-01'),
              creado_el: new Date('2026-10-01'),
              venta_referencia_id: null,
              tipo_documento_codigo: null,
              tipo_documento_nombre: null,
              tiene_lineas_despachadas: false,
            },
          ]);
        return Promise.resolve([]);
      });
    };
    const detalle = () => service.findOne(TENANT_ID, VENTA_ID, USUARIO, true);

    describe('anulable y anularPreguntaExterno', () => {
      it('pendiente, sin pagos y con lo emitido anulable: anulable, sin pregunta', async () => {
        responder('pendiente', '0');
        ventaDocumentosMock.evaluarAnulacion.mockResolvedValue({
          resultado: 'anulable',
          descartes: [],
        });
        const res = await detalle();
        expect(res.anulable).toBe(true);
        expect(res.anularPreguntaExterno).toBe(false);
      });

      it('con un externo sin número: anulable, y pregunta', async () => {
        responder('pendiente', '0');
        ventaDocumentosMock.evaluarAnulacion.mockResolvedValue({
          resultado: 'pregunta_externo',
          motivo: 'falta decir',
        });
        const res = await detalle();
        expect(res.anulable).toBe(true);
        expect(res.anularPreguntaExterno).toBe(true);
      });

      it('con algo ya emitido (bloqueada): ni anulable ni pregunta', async () => {
        responder('pendiente', '0');
        ventaDocumentosMock.evaluarAnulacion.mockResolvedValue({
          resultado: 'bloqueada',
          motivo: 'va por NC',
        });
        const res = await detalle();
        expect(res.anulable).toBe(false);
        expect(res.anularPreguntaExterno).toBe(false);
      });

      it('con una nota de crédito (pendiente y sin pagos): no es anulable y ni mira los documentos', async () => {
        responder('pendiente', '0');
        const base = dataSourceMock.query.getMockImplementation()!;
        dataSourceMock.query.mockImplementation((sql: string) =>
          /FROM ventas\s+WHERE venta_referencia_id = \$1 AND tenant_id/.test(
            sql,
          )
            ? Promise.resolve([
                {
                  venta_id: 'nc-1',
                  total_final: '59500.0000',
                  fecha: new Date('2026-10-02'),
                  comentario: null,
                },
              ])
            : base(sql),
        );
        ventaDocumentosMock.evaluarAnulacion.mockClear();
        const res = await detalle();
        expect(res.anulable).toBe(false);
        expect(ventaDocumentosMock.evaluarAnulacion).not.toHaveBeenCalled();
      });

      it('no repite la consulta de pagos: usa los que el detalle ya cargó', async () => {
        responder('pendiente', '0');
        await detalle();
        expect(
          dataSourceMock.query.mock.calls.some((c: unknown[]) =>
            String(c[0]).includes('SELECT 1 FROM pagos'),
          ),
        ).toBe(false);
      });

      it('le pregunta a evaluarAnulacion sin externoHecho: pedir la respuesta no es un bloqueo', async () => {
        responder('pendiente', '0');
        await detalle();
        expect(ventaDocumentosMock.evaluarAnulacion).toHaveBeenCalledTimes(1);
        expect(ventaDocumentosMock.evaluarAnulacion.mock.calls[0][1]).toEqual({
          tenantId: TENANT_ID,
          ventaId: VENTA_ID,
        });
      });

      it.each(['pagada', 'pagada_parcial', 'cancelada'])(
        'una venta %s no es anulable, aunque lo emitido lo permita, y ni mira los documentos',
        async (estado) => {
          responder(estado, '0', '0', false);
          ventaDocumentosMock.evaluarAnulacion.mockResolvedValue({
            resultado: 'pregunta_externo',
            motivo: 'falta decir',
          });
          const res = await detalle();
          expect(res.anulable).toBe(false);
          // Sin ser anulable no hay pregunta que hacer, aunque haya un externo.
          expect(res.anularPreguntaExterno).toBe(false);
          expect(ventaDocumentosMock.evaluarAnulacion).not.toHaveBeenCalled();
        },
      );

      it('una venta pendiente con pagos no es anulable y ni mira los documentos', async () => {
        responder('pendiente', '40000');
        const res = await detalle();
        expect(res.anulable).toBe(false);
        expect(res.anularPreguntaExterno).toBe(false);
        expect(ventaDocumentosMock.evaluarAnulacion).not.toHaveBeenCalled();
      });
    });

    describe('saldo y puedeAbonar: los decide el backend con la expresión única', () => {
      it('devuelve el saldo que calculó la consulta y puedeAbonar con estado abonable y saldo', async () => {
        responder('pagada_parcial', '60000', '0', true, '40000.0000');
        const res = await detalle();
        expect(res.saldo).toBe('40000.0000');
        expect(res.puedeAbonar).toBe(true);
      });

      it('una nota "sin plata" que cubrió la deuda: saldo 0 y nada que abonar, aunque el estado leído diga pendiente', async () => {
        responder('pendiente', '0', '0', false, '0.0000');
        const res = await detalle();
        expect(res.saldo).toBe('0.0000');
        expect(res.puedeAbonar).toBe(false);
        expect(res.abonoConMaquinaDuplica).toBe(false);
        expect(ventaDocumentosMock.ventaDocumentada).not.toHaveBeenCalled();
      });

      it.each(['pagada', 'cancelada'])(
        'una venta %s no admite abonos aunque el saldo sea positivo',
        async (estado) => {
          responder(estado, '0', '0', false, '100000.0000');
          expect((await detalle()).puedeAbonar).toBe(false);
        },
      );
    });

    describe('abonoConMaquinaDuplica', () => {
      it('con saldo, abonable y ya documentada: true', async () => {
        responder('pagada_parcial', '40000');
        ventaDocumentosMock.ventaDocumentada.mockResolvedValue(true);
        const res = await detalle();
        expect(res.abonoConMaquinaDuplica).toBe(true);
        expect(ventaDocumentosMock.ventaDocumentada).toHaveBeenCalledWith(
          expect.anything(),
          { tenantId: TENANT_ID, ventaId: VENTA_ID },
        );
      });

      it('también con la venta pendiente sin pagar (hay deuda documentada)', async () => {
        responder('pendiente', '0');
        ventaDocumentosMock.ventaDocumentada.mockResolvedValue(true);
        expect((await detalle()).abonoConMaquinaDuplica).toBe(true);
      });

      it('sin documentos que duplicar (de $0, de un país sin boleta, o solo nadie): false', async () => {
        responder('pagada_parcial', '40000');
        ventaDocumentosMock.ventaDocumentada.mockResolvedValue(false);
        expect((await detalle()).abonoConMaquinaDuplica).toBe(false);
      });

      it('sin saldo (pagada) no hay deuda que duplicar, y ni consulta los documentos', async () => {
        responder('pagada', '100000');
        ventaDocumentosMock.ventaDocumentada.mockResolvedValue(true);
        const res = await detalle();
        expect(res.abonoConMaquinaDuplica).toBe(false);
        expect(ventaDocumentosMock.ventaDocumentada).not.toHaveBeenCalled();
      });

      it('con el saldo en cero no hay deuda que duplicar, aunque el estado leído diga pagada_parcial', async () => {
        // El saldo se mide solo, no se deduce del estado: dos fuentes que hoy
        // coinciden y que este caso separa a propósito.
        responder('pagada_parcial', '100000');
        ventaDocumentosMock.ventaDocumentada.mockResolvedValue(true);
        const res = await detalle();
        expect(res.abonoConMaquinaDuplica).toBe(false);
        expect(ventaDocumentosMock.ventaDocumentada).not.toHaveBeenCalled();
      });

      it('la propina no baja el saldo: pagó $100.000, $90.000 a la venta y $10.000 de propina, debe $10.000', async () => {
        // Sumando también la propina el "saldo" daría 0 y diría false.
        responder('pagada_parcial', '90000', '10000');
        ventaDocumentosMock.ventaDocumentada.mockResolvedValue(true);
        expect((await detalle()).abonoConMaquinaDuplica).toBe(true);
      });

      it.each(['pagada', 'cancelada'])(
        'una venta %s no admite abonos: false aunque el saldo calculado sea positivo',
        async (estado) => {
          // Una venta cancelada no tiene pagos, y su "saldo" es el total entero.
          responder(estado, '0', '0', false);
          ventaDocumentosMock.ventaDocumentada.mockResolvedValue(true);
          const res = await detalle();
          expect(res.abonoConMaquinaDuplica).toBe(false);
          expect(ventaDocumentosMock.ventaDocumentada).not.toHaveBeenCalled();
        },
      );
    });

    it('trae los documentos de la venta y de sus correcciones de una sola vez, por el tenant del token', async () => {
      responder('pendiente', '0');
      const doc = { id: 'doc-1', emisor: 'sistema' };
      ventaDocumentosMock.listarParaDetalle.mockResolvedValue([doc]);
      const res = await detalle();
      expect(res.documentos).toEqual([doc]);
      expect(ventaDocumentosMock.listarParaDetalle).toHaveBeenCalledTimes(1);
      expect(ventaDocumentosMock.listarParaDetalle.mock.calls[0][1]).toEqual({
        tenantId: TENANT_ID,
        ventaId: VENTA_ID,
      });
    });
  });

  /**
   * Precedente que motiva este test: `config_calculo` se escribió meses en
   * la cabecera sin que el SELECT de `findOne` lo trajera — nadie lo notó
   * porque nada afirmaba sobre la respuesta. Acá el SELECT nuevo entra CON
   * su test: que la API además lo DEVUELVA, no solo que la fila exista.
   */
  describe('findOne() — expone las promociones congeladas', () => {
    const USUARIO = 'usuario-uuid-promos';
    const VENTA_ID = 'venta-uuid-promos';

    const cabecera = {
      venta_id: VENTA_ID,
      caja_id: CAJA_ID,
      moneda_id: MONEDA_OFICIAL_ID,
      tipo_documento_id: null,
      canal: 'fisico',
      estado: 'pagada',
      total_bruto: '5000.0000',
      total_descuentos: '500.0000',
      total_recargos: '0',
      total_impuestos: '0',
      total_final: '4500.0000',
      comentario: null,
      fecha: new Date('2026-08-27'),
      creado_el: new Date('2026-08-27'),
      venta_referencia_id: null,
      tipo_documento_codigo: null,
      tipo_documento_nombre: null,
      tiene_lineas_despachadas: false,
    };

    it('devuelve las columnas congeladas de ventas_promociones, filtrando eliminado_el', async () => {
      dataSourceMock.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM ventas v')) return Promise.resolve([cabecera]);
        if (sql.includes('FROM ventas_promociones')) {
          expect(sql).toContain('eliminado_el IS NULL');
          return Promise.resolve([
            {
              venta_promocion_id: 'vp-1',
              detalle_id: 'detalle-uuid-001',
              aplicacion: 1,
              promocion_id: 'promo-1',
              nombre_promocion: '2x1 martes',
              tipo: 'nxm',
              valor_efectivo: '1.0000',
              monto: '500.0000',
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const res = await service.findOne(TENANT_ID, VENTA_ID, USUARIO, true);

      expect(res.promociones).toEqual([
        {
          id: 'vp-1',
          detalleId: 'detalle-uuid-001',
          aplicacion: 1,
          promocionId: 'promo-1',
          nombre: '2x1 martes',
          tipo: 'nxm',
          valorEfectivo: '1.0000',
          monto: '500.0000',
        },
      ]);
    });

    it('sin promos, la respuesta trae el array vacío', async () => {
      dataSourceMock.query.mockImplementation((sql: string) =>
        sql.includes('FROM ventas v')
          ? Promise.resolve([cabecera])
          : Promise.resolve([]),
      );

      const res = await service.findOne(TENANT_ID, VENTA_ID, USUARIO, true);

      expect(res.promociones).toEqual([]);
    });
  });

  /**
   * `armarBoleta` arma el payload de la boleta desde la venta ya persistida
   * (Task 1 de `docs/superpowers/specs/2026-09-17-boleta-desde-la-venta-design.md`).
   * `runner` es `Db` en estos tests —el mismo objeto que la Task 2 (reimpresión)
   * le pasa fuera de transacción—; `db.query` ya está mockeado sobre
   * `dataSourceMock.query` en el `beforeEach` de arriba.
   */
  describe('armarBoleta()', () => {
    const VENTA_ID = 'venta-uuid-boleta';

    type BoletaFixture = {
      cabecera: Record<string, unknown>;
      detalles?: Record<string, unknown>[];
      nombresItems?: Record<string, unknown>[];
      impuestos?: Record<string, unknown>[];
      promociones?: Record<string, unknown>[];
      pagos?: Record<string, unknown>[];
      metodosPago?: Record<string, unknown>[];
      propina?: Record<string, unknown>[];
      customer?: Record<string, unknown>[];
    };

    /** Cabecera con todos los campos en blanco: cada test pisa lo que necesita. */
    const cabeceraBase = (overrides: Record<string, unknown> = {}) => ({
      venta_id: VENTA_ID,
      fecha: new Date('2026-09-17T12:00:00Z'),
      canal: 'fisico',
      estado: 'pagada',
      total_bruto: '0.0000',
      total_descuentos: '0.0000',
      total_recargos: '0.0000',
      total_impuestos: '0.0000',
      total_final: '0.0000',
      cuenta_numero: null,
      mesa_nombre: null,
      cajero_nombre: null,
      cajero_apellido: null,
      ...overrides,
    });

    /** Despacha cada tabla de `armarBoleta` por el `FROM` de su SQL. */
    const mockArmarBoleta = (fixture: BoletaFixture) => {
      dataSourceMock.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM ventas v'))
          return Promise.resolve([fixture.cabecera]);
        if (sql.includes('FROM venta_detalles'))
          return Promise.resolve(fixture.detalles ?? []);
        if (sql.includes('FROM items'))
          return Promise.resolve(fixture.nombresItems ?? []);
        if (sql.includes('FROM ventas_impuestos'))
          return Promise.resolve(fixture.impuestos ?? []);
        if (sql.includes('FROM ventas_promociones'))
          return Promise.resolve(fixture.promociones ?? []);
        if (sql.includes('FROM pagos'))
          return Promise.resolve(fixture.pagos ?? []);
        if (sql.includes('FROM metodos_pago'))
          return Promise.resolve(fixture.metodosPago ?? []);
        if (sql.includes('FROM venta_propina'))
          return Promise.resolve(fixture.propina ?? []);
        if (sql.includes('FROM venta_customer'))
          return Promise.resolve(fixture.customer ?? []);
        return Promise.resolve([]);
      });
    };

    it('una venta de dos líneas devuelve items en el orden persistido', async () => {
      mockArmarBoleta({
        cabecera: cabeceraBase(),
        detalles: [
          {
            item_id: 'item-1',
            descripcion: 'Hamburguesa clásica',
            cantidad: '2',
            cantidad_presentacion: null,
            unidad_codigo_presentacion: null,
            unidad_codigo_base: 'unidad',
            precio_unitario: '5000.0000',
            total_linea: '10000.0000',
            personalizacion: null,
          },
          {
            item_id: 'item-2',
            descripcion: 'Papas fritas',
            cantidad: '1',
            cantidad_presentacion: null,
            unidad_codigo_presentacion: null,
            unidad_codigo_base: 'unidad',
            precio_unitario: '3000.0000',
            total_linea: '3000.0000',
            personalizacion: null,
          },
        ],
      });

      const boleta = await service.armarBoleta(
        dbService,
        TENANT_ID,
        VENTA_ID,
        USUARIO_ID,
        true,
      );

      expect(boleta.items).toEqual([
        {
          descripcion: 'Hamburguesa clásica',
          cantidad: '2',
          cantidadPresentacion: null,
          unidadCodigoPresentacion: null,
          unidadCodigoBase: 'unidad',
          precioUnitario: '5000.0000',
          totalLinea: '10000.0000',
        },
        {
          descripcion: 'Papas fritas',
          cantidad: '1',
          cantidadPresentacion: null,
          unidadCodigoPresentacion: null,
          unidadCodigoBase: 'unidad',
          precioUnitario: '3000.0000',
          totalLinea: '3000.0000',
        },
      ]);
    });

    it('una línea vendida por presentación no cruza cantidad con cantidad_presentacion ni sus unidades', async () => {
      // Bug ya cometido en este repo: 0,3 kg impreso como "0" por cruzar
      // `cantidad`/`cantidad_presentacion` o sus unidades. Los cuatro valores
      // son distintos entre sí a propósito, para que ningún par sea
      // intercambiable sin romper esta aserción.
      mockArmarBoleta({
        cabecera: cabeceraBase(),
        detalles: [
          {
            item_id: 'item-carne',
            descripcion: 'Carne molida',
            cantidad: '0.5',
            cantidad_presentacion: '500',
            unidad_codigo_presentacion: 'g',
            unidad_codigo_base: 'kg',
            precio_unitario: '8000.0000',
            total_linea: '4000.0000',
            personalizacion: null,
          },
        ],
      });

      const boleta = await service.armarBoleta(
        dbService,
        TENANT_ID,
        VENTA_ID,
        USUARIO_ID,
        true,
      );

      expect(boleta.items).toEqual([
        {
          descripcion: 'Carne molida',
          cantidad: '0.5',
          cantidadPresentacion: '500',
          unidadCodigoPresentacion: 'g',
          unidadCodigoBase: 'kg',
          precioUnitario: '8000.0000',
          totalLinea: '4000.0000',
        },
      ]);
    });

    it('una línea con personalización devuelve personalizacionDetalle con su monto y el comentario', async () => {
      mockArmarBoleta({
        cabecera: cabeceraBase(),
        detalles: [
          {
            item_id: 'item-1',
            descripcion: 'Hamburguesa clásica',
            cantidad: '1',
            cantidad_presentacion: null,
            unidad_codigo_presentacion: null,
            unidad_codigo_base: 'unidad',
            precio_unitario: '5000.0000',
            total_linea: '6000.0000',
            personalizacion: {
              omitidos: ['ing-cebolla'],
              extras: [
                {
                  ingredienteItemId: 'ing-tocino',
                  cantidad: '2',
                  unidadCodigo: 'unidad',
                  precioExtra: '1000.0000',
                  unidades: '2',
                },
              ],
              comentario: 'sin sal',
            },
          },
        ],
        nombresItems: [
          { item_id: 'ing-cebolla', nombre: 'Cebolla' },
          { item_id: 'ing-tocino', nombre: 'Tocino' },
        ],
      });

      const boleta = await service.armarBoleta(
        dbService,
        TENANT_ID,
        VENTA_ID,
        USUARIO_ID,
        true,
      );

      // Estructurado, sin frasear: el texto ("Sin X" / "Extra X xN") lo arma
      // `lineasPersonalizacionPreciada` en el frontend
      // (`ticket-builder.ts:122-138`), no el backend — dos dueños del mismo
      // renglón mandarían el papel a divergir en silencio. `unidades: 2` va
      // explícito para que no sea un campo decorativo sin cubrir.
      expect(boleta.items[0].personalizacionDetalle).toEqual([
        { nombre: 'Cebolla', tipo: 'omitido', monto: '0' },
        { nombre: 'Tocino', tipo: 'extra', unidades: 2, monto: '2000' },
      ]);
      expect(boleta.items[0].comentario).toBe('sin sal');
    });

    it('los totales se mapean con los nombres del ticket (subtotalNeto sale de total_bruto)', async () => {
      mockArmarBoleta({
        cabecera: cabeceraBase({
          total_bruto: '10000.0000',
          total_descuentos: '500.0000',
          total_recargos: '200.0000',
          total_impuestos: '1800.0000',
          total_final: '11500.0000',
        }),
        detalles: [],
      });

      const boleta = await service.armarBoleta(
        dbService,
        TENANT_ID,
        VENTA_ID,
        USUARIO_ID,
        true,
      );

      expect(boleta.totales).toEqual({
        subtotalNeto: '10000.0000',
        totalDescuentos: '500.0000',
        totalRecargos: '200.0000',
        totalImpuestos: '1800.0000',
        totalFinal: '11500.0000',
      });
    });

    it('dos pagos de métodos distintos devuelven sus nombres, y el vuelto del pago en efectivo', async () => {
      mockArmarBoleta({
        cabecera: cabeceraBase(),
        detalles: [],
        pagos: [
          {
            pago_id: 'pago-1',
            metodo_pago_id: 'metodo-efectivo',
            monto: '10000.0000',
            vuelto: '1500.0000',
          },
          {
            pago_id: 'pago-2',
            metodo_pago_id: 'metodo-tarjeta',
            monto: '5894.0000',
            vuelto: '0.0000',
          },
        ],
        metodosPago: [
          { metodo_pago_id: 'metodo-efectivo', nombre: 'Efectivo' },
          { metodo_pago_id: 'metodo-tarjeta', nombre: 'Tarjeta de débito' },
        ],
      });

      const boleta = await service.armarBoleta(
        dbService,
        TENANT_ID,
        VENTA_ID,
        USUARIO_ID,
        true,
      );

      expect(boleta.pagos).toEqual([
        { nombre: 'Efectivo', monto: '10000.0000' },
        { nombre: 'Tarjeta de débito', monto: '5894.0000' },
      ]);
      expect(boleta.vuelto).toBe('1500.0000');
    });

    it('impuestos y promociones se agregan por id: dos filas del mismo id se suman, y no se cruzan con las de otro', async () => {
      mockArmarBoleta({
        cabecera: cabeceraBase(),
        detalles: [],
        impuestos: [
          {
            impuesto_id: 'iva',
            nombre_regla: 'IVA',
            valor_aplicado: '950.0000',
            porcentaje_aplicado: '0.1900',
          },
          {
            impuesto_id: 'iva',
            nombre_regla: 'IVA',
            valor_aplicado: '550.0000',
            porcentaje_aplicado: '0.1900',
          },
          {
            impuesto_id: 'ila',
            nombre_regla: 'ILA',
            valor_aplicado: '300.0000',
            porcentaje_aplicado: '0.1000',
          },
        ],
        promociones: [
          {
            promocion_id: 'promo-2x1',
            nombre_promocion: '2x1 martes',
            monto: '1200.0000',
          },
          {
            promocion_id: 'promo-2x1',
            nombre_promocion: '2x1 martes',
            monto: '800.0000',
          },
          {
            promocion_id: 'promo-happy',
            nombre_promocion: 'Happy hour',
            monto: '400.0000',
          },
        ],
      });

      const boleta = await service.armarBoleta(
        dbService,
        TENANT_ID,
        VENTA_ID,
        USUARIO_ID,
        true,
      );

      // Ni el de una sola fila (950 o 1200) ni la suma cruzada entre ids
      // (950+550+300, o 1200+800+400): cada id agregado por su cuenta.
      expect(boleta.impuestos).toEqual([
        { nombre: 'IVA', tasa: '0.1900', monto: '1500.0000' },
        { nombre: 'ILA', tasa: '0.1000', monto: '300.0000' },
      ]);
      expect(boleta.promociones).toEqual([
        { id: 'promo-2x1', nombre: '2x1 martes', monto: '2000.0000' },
        { id: 'promo-happy', nombre: 'Happy hour', monto: '400.0000' },
      ]);
    });

    it('propina con estado pagada devuelve el monto', async () => {
      mockArmarBoleta({
        cabecera: cabeceraBase(),
        detalles: [],
        propina: [{ monto_pagado: '1500.0000' }],
      });

      const boleta = await service.armarBoleta(
        dbService,
        TENANT_ID,
        VENTA_ID,
        USUARIO_ID,
        true,
      );

      expect(boleta.propina).toEqual({ monto: '1500.0000' });
    });

    it('sin fila de propina pagada, la boleta no inventa una: null', async () => {
      // Qué controla esto y qué NO: controla la rama de cero filas — un
      // `armarBoleta` que fabricara `{ monto: '0' }` en vez de `null` pasaría
      // el test de arriba y fallaría este. **No** controla el filtro
      // `estado = 'pagada'` del SQL: el mock despacha por substring de la
      // tabla y devuelve el fixture sin mirar el `WHERE`, así que borrar el
      // filtro no cambiaría nada acá. Ese control vive en el e2e de la ruta
      // de reimpresión, donde la query se ejecuta de verdad contra una venta
      // sin propina (`cerrarCuenta` siempre crea la fila, con
      // `estado = 'sin_propina'` — `venta-propina.service.ts:47-49`).
      mockArmarBoleta({
        cabecera: cabeceraBase(),
        detalles: [],
        propina: [],
      });

      const boleta = await service.armarBoleta(
        dbService,
        TENANT_ID,
        VENTA_ID,
        USUARIO_ID,
        true,
      );

      expect(boleta.propina).toBeNull();
    });

    /**
     * El agujero que encontró la revisión de toda la rama (post
     * `docs/superpowers/specs/2026-09-17-boleta-desde-la-venta-design.md`):
     * `BoletaVenta` no llevaba ningún dato del cliente, así que el POS
     * imprimía nombre/RUT/dirección desde el formulario y la reimpresión los
     * perdía. Mismos tres campos que `BoletaCliente` imprime
     * (`ticket-builder.ts`) — `telefono`/`email`/`terceroId` de
     * `venta_customer` no tienen lector en el papel.
     */
    it('con fila en venta_customer, la boleta trae nombre, rut y dirección', async () => {
      mockArmarBoleta({
        cabecera: cabeceraBase(),
        detalles: [],
        customer: [
          {
            nombre: 'Juan Pérez',
            rut: '11.111.111-1',
            direccion: 'Calle Falsa 123',
          },
        ],
      });

      const boleta = await service.armarBoleta(
        dbService,
        TENANT_ID,
        VENTA_ID,
        USUARIO_ID,
        true,
      );

      expect(boleta.customer).toEqual({
        nombre: 'Juan Pérez',
        rut: '11.111.111-1',
        direccion: 'Calle Falsa 123',
      });
    });

    it('una venta sin cliente registrado: null, no un objeto vacío', async () => {
      mockArmarBoleta({
        cabecera: cabeceraBase(),
        detalles: [],
        customer: [],
      });

      const boleta = await service.armarBoleta(
        dbService,
        TENANT_ID,
        VENTA_ID,
        USUARIO_ID,
        true,
      );

      expect(boleta.customer).toBeNull();
    });

    it('una venta de otro tenant no se encuentra (404)', async () => {
      dataSourceMock.query.mockResolvedValueOnce([]);

      await expect(
        service.armarBoleta(
          dbService,
          TENANT_ID,
          'venta-ajena',
          USUARIO_ID,
          true,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    /**
     * Ronda de corrección 1 (Task 2, 2026-09-17): la boleta trae pagos con
     * monto, vuelto y cajero — el mismo dato por el que la auditoría del
     * 2026-08-22 le puso alcance por caja a `findOne`
     * (`docs/superpowers/specs/2026-08-22-visibilidad-ventas-pagos-design.md`).
     * `armarBoleta` reusa `filtroDeMisCajas` en la query de CABECERA, igual
     * que `findOne`. El mock despacha por nombre de tabla y no ejecuta el
     * `WHERE`, así que no controla si el filtro EXCLUYE una fila — pero sí
     * puede afirmar sobre el SQL que de verdad se mandó a Postgres: con
     * `verTodas: false` la query de cabecera lleva el filtro de
     * `filtroDeMisCajas` (la subquery contra `cajas c`), y con `true` no.
     */
    it('la query de cabecera lleva el filtro de alcance por caja solo cuando verTodas es false', async () => {
      mockArmarBoleta({ cabecera: cabeceraBase() });

      await service.armarBoleta(
        dbService,
        TENANT_ID,
        VENTA_ID,
        USUARIO_ID,
        false,
      );
      const [sqlAcotado, paramsAcotado] = dataSourceMock.query.mock.calls.find(
        ([sql]: [string]) => sql.includes('FROM ventas v'),
      ) as [string, unknown[]];
      expect(sqlAcotado).toContain('FROM cajas c');
      expect(paramsAcotado).toEqual([VENTA_ID, TENANT_ID, USUARIO_ID]);

      dataSourceMock.query.mockClear();
      mockArmarBoleta({ cabecera: cabeceraBase() });

      await service.armarBoleta(
        dbService,
        TENANT_ID,
        VENTA_ID,
        USUARIO_ID,
        true,
      );
      const [sqlCompleto, paramsCompleto] =
        dataSourceMock.query.mock.calls.find(([sql]: [string]) =>
          sql.includes('FROM ventas v'),
        ) as [string, unknown[]];
      expect(sqlCompleto).not.toContain('FROM cajas c');
      expect(paramsCompleto).toEqual([VENTA_ID, TENANT_ID]);
    });

    /**
     * Reimprimir: solo una venta pagada o anulada (owner, 2026-09-18). El
     * filtro vive en `reimprimirBoleta` y no en `armarBoleta`, porque el cobro
     * del POS también arma la boleta de una venta que queda pendiente.
     */
    describe('reimprimirBoleta()', () => {
      it.each(['pagada', 'cancelada'])(
        'una venta %s se reimprime, con su estado en el payload',
        async (estado) => {
          mockArmarBoleta({ cabecera: cabeceraBase({ estado }) });

          const boleta = await service.reimprimirBoleta(
            TENANT_ID,
            VENTA_ID,
            USUARIO_ID,
            true,
          );

          expect(boleta.estado).toBe(estado);
        },
      );

      it.each(['pendiente', 'pagada_parcial'])(
        'una venta %s da 400',
        async (estado) => {
          mockArmarBoleta({ cabecera: cabeceraBase({ estado }) });

          await expect(
            service.reimprimirBoleta(TENANT_ID, VENTA_ID, USUARIO_ID, true),
          ).rejects.toThrow(BadRequestException);
        },
      );

      it('armarBoleta sigue armando la de una venta pendiente: el cobro del POS la necesita', async () => {
        mockArmarBoleta({ cabecera: cabeceraBase({ estado: 'pendiente' }) });

        const boleta = await service.armarBoleta(
          dbService,
          TENANT_ID,
          VENTA_ID,
          USUARIO_ID,
          true,
        );

        expect(boleta.estado).toBe('pendiente');
      });
    });

    /**
     * `reimprimirBoletaPropia` — la cajera SIN `Ventas:Anular` (owner,
     * 2026-09-30, `docs/agent/pendientes.md` § 3). Dos capas, en orden:
     * 1) `reimprimirBoleta(..., verTodas: false)` — el mismo alcance de
     *    siempre (`filtroDeMisCajas`, en la query de cabecera). Lo que ese
     *    filtro EXCLUYE (una venta física de OTRA caja) nunca llega: cabecera
     *    vacía → 404, mismo camino que la de otro tenant (arriba). El mock no
     *    ejecuta el `WHERE` (despacha por tabla), así que "no visible" y
     *    "realmente no existe" se simulan igual acá — la distinción real la
     *    prueba el e2e contra Postgres.
     * 2) `exigirCajaPropiaAbierta` — sobre lo que SÍ es visible, exige que
     *    sea la caja del usuario Y siga `abierta`. Su query también hace
     *    `FROM ventas v` (mismo texto que la cabecera de `armarBoleta`), así
     *    que `mockReimprimirBoletaPropia` la distingue por una porción única
     *    del SQL (`cj.usuario_id, cj.estado`) antes de delegar al despacho
     *    por tabla de `mockArmarBoleta`.
     */
    describe('reimprimirBoletaPropia()', () => {
      /** Cabecera (`filtroDeMisCajas` ya pasó) + fila de `exigirCajaPropiaAbierta`. */
      const mockReimprimirBoletaPropia = (
        fixture: BoletaFixture,
        cajaRows: { usuario_id: string | null; estado: string | null }[],
      ) => {
        mockArmarBoleta(fixture);
        const base = dataSourceMock.query.getMockImplementation()!;
        dataSourceMock.query.mockImplementation(
          (sql: string, params?: unknown[]) => {
            if (sql.includes('cj.usuario_id, cj.estado'))
              return Promise.resolve(cajaRows);
            return base(sql, params) as Promise<unknown[]>;
          },
        );
      };

      it('caja propia y abierta: reimprime (200)', async () => {
        mockReimprimirBoletaPropia(
          { cabecera: cabeceraBase({ estado: 'pagada' }) },
          [{ usuario_id: USUARIO_ID, estado: 'abierta' }],
        );

        const boleta = await service.reimprimirBoletaPropia(
          TENANT_ID,
          VENTA_ID,
          USUARIO_ID,
        );

        expect(boleta.estado).toBe('pagada');
      });

      /**
       * La venta NO es ni de su caja ni `online`: `filtroDeMisCajas` la deja
       * afuera de la cabecera, así que ni se entera de que existe — 404, no
       * 403. Antes de esta ronda esto daba 403 (revisión de seguridad,
       * 2026-09-30): confirmaba por otra puerta que la venta existe, el mismo
       * hueco que la auditoría del 2026-08-22 le cerró a `findOne`.
       */
      it('venta física de OTRA caja (no visible bajo el alcance de siempre): 404', async () => {
        dataSourceMock.query.mockResolvedValueOnce([]); // cabecera: filtroDeMisCajas la excluye

        await expect(
          service.reimprimirBoletaPropia(TENANT_ID, VENTA_ID, USUARIO_ID),
        ).rejects.toThrow(NotFoundException);
      });

      it.each(['cerrada', 'en_conciliacion'])(
        'su caja, pero %s (no "abierta" a secas): 403 con el mensaje del encargado',
        async (estado) => {
          mockReimprimirBoletaPropia(
            { cabecera: cabeceraBase({ estado: 'pagada' }) },
            [{ usuario_id: USUARIO_ID, estado }],
          );

          await expect(
            service.reimprimirBoletaPropia(TENANT_ID, VENTA_ID, USUARIO_ID),
          ).rejects.toThrow(ForbiddenException);
        },
      );

      /**
       * `online` SÍ es visible (`filtroDeMisCajas` la deja pasar sin
       * distinguir dueño) pero no la tiene como suya (`cajas.usuario_id`
       * de la caja virtual es `NULL`) — 403, no 404: la vio, no la puede
       * reimprimir.
       */
      it('venta online (visible, pero sin dueño): 403', async () => {
        mockReimprimirBoletaPropia(
          { cabecera: cabeceraBase({ estado: 'pagada', canal: 'online' }) },
          [{ usuario_id: null, estado: 'abierta' }],
        );

        await expect(
          service.reimprimirBoletaPropia(TENANT_ID, VENTA_ID, USUARIO_ID),
        ).rejects.toThrow(ForbiddenException);
      });
    });
  });
});
