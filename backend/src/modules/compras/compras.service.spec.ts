import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Db } from '../../common/db/db.service';
import { CatalogService } from '../catalog/catalog.service';
import { InventarioService } from '../inventario/inventario.service';
import { UbicacionesService } from '../ubicaciones/ubicaciones.service';
import { CalculoPreciosService } from '../calculo-precios/calculo-precios.service';
import { MonedasService } from '../monedas/monedas.service';
import type { ConfigCalculo } from '../calculo-precios/calculo-precios.engine';
import { ComprasService, type CompraDetalle } from './compras.service';
import type { CompraBorradorDto } from './dto/compra-borrador.dto';

const CFG_CLP = {
  formula: ['descuentos', 'recargos', 'impuestos'],
  calculoDescuentos: 'base',
  calculoRecargos: 'base',
  escalaCalculo: 4,
  modoRedondeo: 'HALF_UP',
  nivelRedondeo: 'linea',
  promosAcumulanDescuentos: false,
  decimalesMoneda: 0,
} as unknown as ConfigCalculo;

const TENANT = '11111111-1111-4111-8111-111111111111';
const USUARIO = '22222222-2222-4222-8222-222222222222';
const PROVEEDOR = '33333333-3333-4333-8333-333333333333';
const TIPO = '44444444-4444-4444-8444-444444444444';
const UBICACION = '55555555-5555-4555-8555-555555555555';
const ITEM = '66666666-6666-4666-8666-666666666666';
const COMPRA = '77777777-7777-4777-8777-777777777777';

type Respuesta = unknown;
type Ruta = [RegExp, Respuesta];

/**
 * Respuestas del `Db` mockeado por forma de SQL: la primera ruta cuyo regex
 * calce gana. Cada test pisa solo la que su regla necesita.
 */
function rutasBase(): Ruta[] {
  return [
    [
      /FROM terceros\s+WHERE tercero_id/,
      [{ nombre: 'Distribuidora X', tipo: 'proveedor', activo: true }],
    ],
    [
      /JOIN tipos_documento_compra td ON td\.pais_id[\s\S]*tipo_documento_compra_id = \$2/,
      [{ nombre: 'Factura', requiere_folio: true }],
    ],
    [
      /FROM ubicaciones\s+WHERE ubicacion_id/,
      [{ nombre: 'Bodega', activo: true }],
    ],
    [
      /FROM items i/,
      [
        {
          item_id: ITEM,
          nombre: 'Harina',
          tipo: 'ingrediente',
          modo_inventario: 'cantidad',
          unidad_medida: 'kg',
        },
      ],
    ],
    [/FROM compras\s+WHERE tenant_id = \$1 AND proveedor_id/, []],
    [
      /FROM compras\s+WHERE tenant_id = \$1 AND compra_id = \$2[\s\S]*FOR UPDATE/,
      [{ estado: 'borrador' }],
    ],
    [/INSERT INTO compras/, [[{ compra_id: COMPRA }], 1]],
    [/./, []],
  ];
}

function dto(extra: Partial<CompraBorradorDto> = {}): CompraBorradorDto {
  return {
    proveedorId: PROVEEDOR,
    tipoDocumentoCompraId: TIPO,
    folio: '4521',
    fechaDocumento: '2026-09-15',
    ubicacionId: UBICACION,
    lineas: [{ itemId: ITEM, cantidad: '20', unidadCodigo: 'kg' }],
    ...extra,
  };
}

describe('ComprasService (borrador)', () => {
  let service: ComprasService;
  let rutas: Ruta[];
  let queries: string[];
  /** El conversor que devuelve `crearConversor`: convierte en memoria. */
  const convertir = jest.fn();
  const crearConversor = jest.fn();
  /** Lo que pasa por fuera del `Db`, en orden: para afirmar el orden de locks. */
  let eventos: string[];
  const registrarMovimiento = jest.fn();
  const stockTotalPorProducto = jest.fn();
  const bloquearContraBorrado = jest.fn();

  function pisar(regex: RegExp, respuesta: Respuesta) {
    rutas.unshift([regex, respuesta]);
  }

  beforeEach(async () => {
    rutas = rutasBase();
    queries = [];
    eventos = [];
    convertir.mockReset();
    convertir.mockReturnValue('1');
    crearConversor.mockReset();
    crearConversor.mockResolvedValue(convertir);
    registrarMovimiento.mockReset();
    let n = 0;
    registrarMovimiento.mockImplementation(() => {
      eventos.push('registrarMovimiento');
      n += 1;
      return Promise.resolve({
        movimientoId: `mov-${n}`,
        costoActualPrevio: '1000.0000',
      });
    });
    stockTotalPorProducto.mockReset();
    stockTotalPorProducto.mockImplementation(
      (_m: unknown, _t: string, ids: string[]) =>
        Promise.resolve(new Map(ids.map((id) => [id, '5']))),
    );
    bloquearContraBorrado.mockReset();
    bloquearContraBorrado.mockImplementation(() => {
      eventos.push('bloquearContraBorrado');
      return Promise.resolve();
    });
    const query = jest.fn((sql: string) => {
      queries.push(sql);
      if (/FOR UPDATE OF ip/.test(sql)) eventos.push('lock productos');
      const ruta = rutas.find(([re]) => re.test(sql));
      return Promise.resolve(ruta ? ruta[1] : []);
    });
    const dbMock = {
      query,
      // El manager de la transacción usa el mismo ruteo que `db.query`.
      transaccion: jest.fn((cb: (m: unknown) => Promise<unknown>) =>
        cb({ query }),
      ),
      sinTransaccion: (fn: () => Promise<unknown>) => fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ComprasService,
        { provide: Db, useValue: dbMock },
        { provide: CatalogService, useValue: { crearConversor } },
        {
          provide: InventarioService,
          useValue: { registrarMovimiento, stockTotalPorProducto },
        },
        { provide: UbicacionesService, useValue: { bloquearContraBorrado } },
        {
          provide: CalculoPreciosService,
          useValue: { cargarConfig: () => Promise.resolve(CFG_CLP) },
        },
        {
          provide: MonedasService,
          useValue: { decimalesOficiales: () => Promise.resolve(0) },
        },
      ],
    }).compile();
    service = moduleRef.get(ComprasService);
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue({ id: COMPRA } as CompraDetalle);
  });

  it('crea el borrador con un solo INSERT de líneas', async () => {
    await service.crearBorrador(TENANT, USUARIO, dto());
    expect(
      queries.filter((q) => /INSERT INTO compra_lineas/.test(q)),
    ).toHaveLength(1);
  });

  it('un proveedor de otro tenant da el mismo 400 que uno inexistente', async () => {
    pisar(/FROM terceros\s+WHERE tercero_id/, []);
    await expect(service.crearBorrador(TENANT, USUARIO, dto())).rejects.toThrow(
      new BadRequestException('Proveedor no encontrado'),
    );
  });

  it('un tercero que no es proveedor es 400', async () => {
    pisar(/FROM terceros\s+WHERE tercero_id/, [
      { nombre: 'Empresa Y', tipo: 'empresa', activo: true },
    ]);
    await expect(service.crearBorrador(TENANT, USUARIO, dto())).rejects.toThrow(
      '"Empresa Y" no es un proveedor',
    );
  });

  it('un proveedor pausado es 400', async () => {
    pisar(/FROM terceros\s+WHERE tercero_id/, [
      { nombre: 'Distribuidora X', tipo: 'proveedor', activo: false },
    ]);
    await expect(service.crearBorrador(TENANT, USUARIO, dto())).rejects.toThrow(
      '"Distribuidora X" está pausado',
    );
  });

  it('un tipo de documento de otro país es 400', async () => {
    pisar(
      /JOIN tipos_documento_compra td ON td\.pais_id[\s\S]*tipo_documento_compra_id = \$2/,
      [],
    );
    await expect(service.crearBorrador(TENANT, USUARIO, dto())).rejects.toThrow(
      'Tipo de documento no válido para el país del tenant',
    );
  });

  it('un documento que pide folio no acepta el folio vacío', async () => {
    await expect(
      service.crearBorrador(TENANT, USUARIO, dto({ folio: '   ' })),
    ).rejects.toThrow('Este documento necesita folio');
  });

  it('"Sin documento" guarda el folio en null aunque llegue uno', async () => {
    pisar(
      /JOIN tipos_documento_compra td ON td\.pais_id[\s\S]*tipo_documento_compra_id = \$2/,
      [{ nombre: 'Sin documento', requiere_folio: false }],
    );
    const db = (service as unknown as { db: { query: jest.Mock } }).db;
    await service.crearBorrador(TENANT, USUARIO, dto({ folio: '999' }));
    const insert = db.query.mock.calls.find(([sql]) =>
      /INSERT INTO compras/.test(sql as string),
    ) as [string, unknown[]];
    expect(insert[1][3]).toBeNull();
    // Sin folio no hay nada que chequear contra duplicados.
    expect(queries.some((q) => /AND folio = \$4/.test(q))).toBe(false);
  });

  it('un folio repetido es 409 y nombra la compra que ya lo tiene', async () => {
    pisar(/FROM compras\s+WHERE tenant_id = \$1 AND proveedor_id/, [
      { fecha_documento: '2026-09-15', estado: 'confirmada' },
    ]);
    const intento = service.crearBorrador(TENANT, USUARIO, dto());
    await expect(intento).rejects.toBeInstanceOf(ConflictException);
    await expect(service.crearBorrador(TENANT, USUARIO, dto())).rejects.toThrow(
      'Ya cargaste Factura 4521 de Distribuidora X, con fecha 2026-09-15',
    );
  });

  it('una ubicación desactivada es 400', async () => {
    pisar(/FROM ubicaciones\s+WHERE ubicacion_id/, [
      { nombre: 'Bodega vieja', activo: false },
    ]);
    await expect(service.crearBorrador(TENANT, USUARIO, dto())).rejects.toThrow(
      '"Bodega vieja" está desactivada: no puede recibir mercadería',
    );
  });

  it('un ítem sin stock (servicio) es 400', async () => {
    pisar(/FROM items i/, [
      {
        item_id: ITEM,
        nombre: 'Delivery',
        tipo: 'servicio',
        modo_inventario: null,
        unidad_medida: null,
      },
    ]);
    await expect(service.crearBorrador(TENANT, USUARIO, dto())).rejects.toThrow(
      '"Delivery" no lleva stock',
    );
  });

  it('un ingrediente sí se compra', async () => {
    await expect(
      service.crearBorrador(TENANT, USUARIO, dto()),
    ).resolves.toEqual({ id: COMPRA });
  });

  it('una unidad incompatible es 400 con el mensaje del catálogo', async () => {
    convertir.mockImplementation(() => {
      throw new BadRequestException('No se puede convertir de volumen a masa');
    });
    await expect(
      service.crearBorrador(
        TENANT,
        USUARIO,
        dto({ lineas: [{ itemId: ITEM, cantidad: '2', unidadCodigo: 'l' }] }),
      ),
    ).rejects.toThrow('No se puede convertir de volumen a masa');
  });

  it('el catálogo de unidades se carga una sola vez, y cada línea a convertir se valida', async () => {
    await service.crearBorrador(
      TENANT,
      USUARIO,
      dto({
        lineas: [
          { itemId: ITEM, cantidad: '500', unidadCodigo: 'g' },
          { itemId: ITEM, cantidad: '250', unidadCodigo: 'g' },
          { itemId: ITEM, cantidad: '3', unidadCodigo: 'kg' },
        ],
      }),
    );
    expect(crearConversor).toHaveBeenCalledTimes(1);
    // Las dos en gramos; la de kg es la base y no se convierte.
    expect(convertir).toHaveBeenCalledTimes(2);
  });

  it('una factura toda en la unidad base no consulta el catálogo', async () => {
    await service.crearBorrador(TENANT, USUARIO, dto());
    expect(crearConversor).not.toHaveBeenCalled();
  });

  describe('series y lote', () => {
    function itemEnModo(modo: 'serie' | 'lote') {
      pisar(/FROM items i/, [
        {
          item_id: ITEM,
          nombre: 'Notebook',
          tipo: 'producto',
          modo_inventario: modo,
          unidad_medida: 'unidad',
        },
      ]);
    }

    it('en serie, las series tienen que ser tantas como unidades', async () => {
      itemEnModo('serie');
      await expect(
        service.crearBorrador(
          TENANT,
          USUARIO,
          dto({
            lineas: [
              {
                itemId: ITEM,
                cantidad: '2',
                unidadCodigo: 'unidad',
                series: [{ serie: 'A1' }],
              },
            ],
          }),
        ),
      ).rejects.toThrow('necesita una serie por unidad');
    });

    it('en lote, falta el lote es 400', async () => {
      itemEnModo('lote');
      await expect(
        service.crearBorrador(
          TENANT,
          USUARIO,
          dto({
            lineas: [{ itemId: ITEM, cantidad: '5', unidadCodigo: 'unidad' }],
          }),
        ),
      ).rejects.toThrow('va por lote: falta el lote');
    });

    it('en serie o lote, una unidad que no es la base es 400', async () => {
      itemEnModo('lote');
      await expect(
        service.crearBorrador(
          TENANT,
          USUARIO,
          dto({
            lineas: [
              {
                itemId: ITEM,
                cantidad: '5',
                unidadCodigo: 'kg',
                lote: { codigoLote: 'L1' },
              },
            ],
          }),
        ),
      ).rejects.toThrow(
        'Los productos por serie o lote solo admiten su unidad base',
      );
    });
  });

  it('editar una compra confirmada es 409', async () => {
    pisar(
      /FROM compras\s+WHERE tenant_id = \$1 AND compra_id = \$2[\s\S]*FOR UPDATE/,
      [{ estado: 'confirmada' }],
    );
    await expect(
      service.actualizarBorrador(TENANT, COMPRA, dto()),
    ).rejects.toThrow(new ConflictException('La compra ya está confirmada'));
  });

  it('descartar una compra confirmada es 409', async () => {
    pisar(
      /FROM compras\s+WHERE tenant_id = \$1 AND compra_id = \$2[\s\S]*FOR UPDATE/,
      [{ estado: 'confirmada' }],
    );
    await expect(service.descartarBorrador(TENANT, COMPRA)).rejects.toThrow(
      new ConflictException('La compra ya está confirmada'),
    );
  });

  it('editar un borrador excluye su propio folio del chequeo de duplicados', async () => {
    const db = (service as unknown as { db: { query: jest.Mock } }).db;
    await service.actualizarBorrador(TENANT, COMPRA, dto());
    const check = db.query.mock.calls.find(([sql]) =>
      /AND folio = \$4/.test(sql as string),
    ) as [string, unknown[]];
    expect(check[1][4]).toBe(COMPRA);
  });

  describe('confirmar', () => {
    const CABECERA = {
      proveedor_id: PROVEEDOR,
      tipo_documento_compra_id: TIPO,
      folio: '4521',
      fecha_documento: '2026-09-15',
      ubicacion_id: UBICACION,
      observacion: null,
      descuento_total: null,
    };

    function conLineas(lineas: Record<string, unknown>[]) {
      pisar(/SELECT proveedor_id, tipo_documento_compra_id, folio/, [CABECERA]);
      pisar(/SELECT compra_linea_id, item_id, cantidad/, lineas);
    }

    it('sin líneas es 400: no hay nada que recibir', async () => {
      conLineas([]);
      await expect(service.confirmar(TENANT, USUARIO, COMPRA)).rejects.toThrow(
        'La compra no tiene líneas',
      );
    });

    it('la ubicación se bloquea antes que los productos, y los productos antes de mover', async () => {
      conLineas([
        {
          compra_linea_id: 'l1',
          item_id: ITEM,
          cantidad: '10',
          unidad_codigo: 'kg',
          precio_unitario: '1500',
          series: null,
          lote: null,
        },
      ]);
      await service.confirmar(TENANT, USUARIO, COMPRA);
      expect(eventos).toEqual([
        'bloquearContraBorrado',
        'lock productos',
        'registrarMovimiento',
      ]);
    });

    it('dos líneas del mismo producto: la segunda parte del stock que dejó la primera, y la sin precio entra sin costo', async () => {
      conLineas([
        {
          compra_linea_id: 'l1',
          item_id: ITEM,
          cantidad: '10',
          unidad_codigo: 'kg',
          precio_unitario: '1500',
          series: null,
          lote: null,
        },
        {
          compra_linea_id: 'l2',
          item_id: ITEM,
          cantidad: '3',
          unidad_codigo: 'kg',
          precio_unitario: null,
          series: null,
          lote: null,
        },
      ]);
      await service.confirmar(TENANT, USUARIO, COMPRA);

      const llamadas = registrarMovimiento.mock.calls.map(
        (c) =>
          c[1] as {
            compraLineaId: string;
            costoUnitario: string | null;
            motivo: string;
            cantidad: string;
          },
      );
      expect(llamadas.map((p) => [p.compraLineaId, p.costoUnitario])).toEqual([
        ['l1', '1500.0000'],
        ['l2', null],
      ]);
      expect(llamadas.every((p) => p.motivo === 'compra')).toBe(true);

      const update = queries.findIndex((q) =>
        /UPDATE compra_lineas cl/.test(q),
      );
      expect(update).toBeGreaterThan(-1);
      const db = (service as unknown as { db: { query: jest.Mock } }).db;
      const params = db.query.mock.calls.find(([sql]) =>
        /UPDATE compra_lineas cl/.test(sql as string),
      )![1] as unknown[];
      // [tenant, l1: id, base, costo, mov, stockAnterior, costoAnterior, l2: …]
      expect(params[5]).toBe('5'); // antes de la compra
      expect(params[11]).toBe('15'); // 5 + los 10 de la primera línea
    });

    it('un precio que se pierde al convertir a la unidad base es 400', async () => {
      pisar(/FROM items i/, [
        {
          item_id: ITEM,
          nombre: 'Azafrán',
          tipo: 'ingrediente',
          modo_inventario: 'cantidad',
          unidad_medida: 'g',
        },
      ]);
      convertir.mockReturnValue('1000');
      conLineas([
        {
          compra_linea_id: 'l1',
          item_id: ITEM,
          cantidad: '1',
          unidad_codigo: 'kg',
          precio_unitario: '0.0001',
          series: null,
          lote: null,
        },
      ]);
      await expect(service.confirmar(TENANT, USUARIO, COMPRA)).rejects.toThrow(
        'El costo se pierde al convertirlo a "g"',
      );
      expect(registrarMovimiento).not.toHaveBeenCalled();
    });
  });
});
