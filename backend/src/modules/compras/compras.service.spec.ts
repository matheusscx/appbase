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
  const recalcularCostoDesdeCompra = jest.fn();

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
    recalcularCostoDesdeCompra.mockReset();
    recalcularCostoDesdeCompra.mockImplementation(
      (_m: unknown, p: { itemId: string }) =>
        Promise.resolve({ movimientoId: `corr-${p.itemId}` }),
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
          useValue: {
            registrarMovimiento,
            stockTotalPorProducto,
            recalcularCostoDesdeCompra,
          },
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

  describe('descuento al total en el borrador (spec § 6)', () => {
    const CON_PRECIO = [
      {
        itemId: ITEM,
        cantidad: '20',
        unidadCodigo: 'kg',
        precioUnitario: '1000',
      },
    ];

    /** El último parámetro del INSERT de la compra: `descuento_total`. */
    function descuentoInsertado(): unknown {
      const db = (service as unknown as { db: { query: jest.Mock } }).db;
      const insert = db.query.mock.calls.find(([sql]) =>
        /INSERT INTO compras/.test(sql as string),
      )!;
      expect(insert[0] as string).toMatch(/descuento_total\)\s+VALUES/);
      return (insert[1] as unknown[]).at(-1);
    }

    it('se guarda cuando todas las líneas tienen precio', async () => {
      await service.crearBorrador(
        TENANT,
        USUARIO,
        dto({ lineas: CON_PRECIO, descuentoTotal: '2000' }),
      );
      expect(descuentoInsertado()).toBe('2000');
    });

    it('un 0 se guarda como sin descuento', async () => {
      await service.crearBorrador(
        TENANT,
        USUARIO,
        dto({ lineas: CON_PRECIO, descuentoTotal: '0' }),
      );
      expect(descuentoInsertado()).toBeNull();
    });

    it('con una línea sin precio es 400', async () => {
      await expect(
        service.crearBorrador(TENANT, USUARIO, dto({ descuentoTotal: '100' })),
      ).rejects.toThrow('Falta el precio de alguna línea');
    });

    it('mayor que el total es 400', async () => {
      await expect(
        service.crearBorrador(
          TENANT,
          USUARIO,
          dto({ lineas: CON_PRECIO, descuentoTotal: '20001' }),
        ),
      ).rejects.toThrow('supera el total de la compra (20000)');
    });

    it('editar el borrador también lo guarda', async () => {
      await service.actualizarBorrador(
        TENANT,
        COMPRA,
        dto({ lineas: CON_PRECIO, descuentoTotal: '500' }),
      );
      const db = (service as unknown as { db: { query: jest.Mock } }).db;
      const update = db.query.mock.calls.find(([sql]) =>
        /UPDATE compras\s+SET proveedor_id/.test(sql as string),
      )!;
      expect(update[0] as string).toContain('descuento_total = $9');
      expect((update[1] as unknown[])[8]).toBe('500');
    });
  });

  describe('listas propias de Compras (owner, 2026-09-19)', () => {
    it('productos ofrece lo mismo que validarLineas acepta: producto e ingrediente con stock, no borrados', async () => {
      pisar(
        /JOIN item_producto ip ON ip\.item_id = i\.item_id\s+WHERE i\.tenant_id = \$1/,
        [
          {
            item_id: ITEM,
            nombre: 'Harina',
            modo_inventario: 'cantidad',
            unidad_medida: 'kg',
          },
        ],
      );

      const r = await service.productos(TENANT);

      expect(r).toEqual([
        {
          id: ITEM,
          nombre: 'Harina',
          modoInventario: 'cantidad',
          unidadMedida: 'kg',
        },
      ]);
      const db = (service as unknown as { db: { query: jest.Mock } }).db;
      const [sql, params] = db.query.mock.calls.find(([q]) =>
        /JOIN item_producto ip ON ip\.item_id = i\.item_id\s+WHERE i\.tenant_id/.test(
          q as string,
        ),
      )! as [string, unknown[]];
      expect(sql).toMatch(
        /i\.tipo = ANY\(\$2::text\[\]\)\s+AND i\.eliminado_el IS NULL/,
      );
      expect(params).toEqual([TENANT, ['producto', 'ingrediente']]);
    });

    it('las unidades de una línea que no es de esa compra (o de otro tenant) son 404', async () => {
      await expect(
        service.unidadesDeLinea(TENANT, COMPRA, 'otra-linea'),
      ).rejects.toThrow('Línea no encontrada');
    });

    it('las unidades filtran la papelera en cada tabla, también en la consulta que las devuelve', async () => {
      pisar(/SELECT cl\.compra_linea_id\s+FROM compra_lineas cl/, [
        { compra_linea_id: 'l1' },
      ]);
      await service.unidadesDeLinea(TENANT, COMPRA, 'l1');
      const db = (service as unknown as { db: { query: jest.Mock } }).db;
      const [sql] = db.query.mock.calls.find(([q]) =>
        /SELECT u\.unidad_id, u\.serie/.test(q as string),
      )! as [string];
      expect(sql).toMatch(
        /c\.tenant_id = cl\.tenant_id\s+AND c\.eliminado_el IS NULL/,
      );
      expect(sql).toMatch(/AND u\.eliminado_el IS NULL/);
      expect(sql).toMatch(
        /cl\.compra_linea_id = \$2\s+AND cl\.eliminado_el IS NULL/,
      );
    });
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

  describe('corregir una confirmada (spec § 4.4)', () => {
    // A < B por orden de texto; las líneas van al revés, para que el orden
    // de las cuentas no salga del orden de la factura.
    const ITEM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const ITEM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    function compra(o: Record<string, unknown> = {}) {
      pisar(/FROM compras c[\s\S]*FOR UPDATE OF c/, [
        {
          compra_id: COMPRA,
          estado: 'confirmada',
          descuento_total: null,
          folio: '4521',
          tipo_documento_nombre: 'Factura',
          proveedor_nombre: 'Distribuidora X',
          ubicacion_id: UBICACION,
          ubicacion_nombre: 'Bodega',
          ubicacion_viva: true,
          ...o,
        },
      ]);
    }

    function linea(o: Record<string, unknown>) {
      return {
        compra_linea_id: 'l1',
        item_id: ITEM_A,
        item_nombre: 'Tomate',
        item_eliminado: false,
        modo_inventario: 'cantidad',
        unidad_base: 'kg',
        unidad_codigo: 'kg',
        series: null,
        lote: null,
        cantidad: '10',
        precio_unitario: '1000',
        cantidad_base: '10',
        costo_unitario_base: '1000.0000',
        ...o,
      };
    }

    function lineas(ls: Record<string, unknown>[]) {
      pisar(/FROM compra_lineas cl\s+JOIN items i/, ls);
    }

    /** Params del INSERT del historial, en filas de 7. */
    function historial(): unknown[][] {
      const db = (service as unknown as { db: { query: jest.Mock } }).db;
      const llamada = db.query.mock.calls.find(([sql]) =>
        /INSERT INTO compra_linea_cambios/.test(sql as string),
      );
      if (!llamada) return [];
      const params = llamada[1] as unknown[];
      // Un placeholder por valor, en orden: sin el `$` el VALUES interpolaba
      // números y Postgres fallaba con 500 (lo cazó el e2e).
      const placeholders = Array.from(
        { length: params.length / 7 },
        (_, k) =>
          `(${Array.from({ length: 7 }, (__, c) => `$${k * 7 + c + 1}`).join(', ')})`,
      ).join(', ');
      expect(llamada[0] as string).toContain(`VALUES ${placeholders}`);
      const filas: unknown[][] = [];
      for (let i = 0; i < params.length; i += 7)
        filas.push(params.slice(i, i + 7));
      return filas;
    }

    function cuentas(): string[] {
      return recalcularCostoDesdeCompra.mock.calls.map(
        (c) => (c[1] as { itemId: string }).itemId,
      );
    }

    describe('precio', () => {
      it('completar el precio guarda el costo nuevo, rehace la cuenta y deja el historial con la corrección', async () => {
        compra();
        lineas([linea({ precio_unitario: null, costo_unitario_base: null })]);

        await service.corregirLinea(TENANT, USUARIO, COMPRA, 'l1', {
          precioUnitario: '1500',
        });

        expect(cuentas()).toEqual([ITEM_A]);
        expect(historial()).toEqual([
          ['l1', TENANT, 'precio', null, '1500', USUARIO, `corr-${ITEM_A}`],
        ]);
        const db = (service as unknown as { db: { query: jest.Mock } }).db;
        const update = db.query.mock.calls.find(([sql]) =>
          /SET costo_unitario_base = v\.costo/.test(sql as string),
        )!;
        expect(update[1]).toEqual([TENANT, 'l1', '1500.0000']);
        expect(update[0] as string).toContain(
          'FROM (VALUES ($2::uuid, $3::numeric))',
        );
      });

      it('con descuento al total, el precio de una línea mueve el costo de las demás: rehace las dos cuentas, en orden de item_id', async () => {
        compra({ descuento_total: '2000' });
        lineas([
          linea({
            compra_linea_id: 'lb',
            item_id: ITEM_B,
            costo_unitario_base: '900.0000',
          }),
          linea({
            compra_linea_id: 'la',
            item_id: ITEM_A,
            costo_unitario_base: '900.0000',
          }),
        ]);

        await service.corregirLinea(TENANT, USUARIO, COMPRA, 'la', {
          precioUnitario: '2000',
        });

        // 20.000 y 10.000: el descuento se reparte 1.333 / 667, y cambian los dos.
        expect(cuentas()).toEqual([ITEM_A, ITEM_B]);
        // El historial es de lo que se corrigió: la línea A.
        expect(historial().map((f) => f[0])).toEqual(['la']);
      });

      it('sin descuento, corregir una línea no toca la cuenta de otro producto', async () => {
        compra();
        lineas([
          linea({ compra_linea_id: 'lb', item_id: ITEM_B }),
          linea({ compra_linea_id: 'la', item_id: ITEM_A }),
        ]);

        await service.corregirLinea(TENANT, USUARIO, COMPRA, 'la', {
          precioUnitario: '1200',
        });

        expect(cuentas()).toEqual([ITEM_A]);
      });

      it('el mismo precio es 400', async () => {
        compra();
        lineas([linea({})]);
        await expect(
          service.corregirLinea(TENANT, USUARIO, COMPRA, 'l1', {
            precioUnitario: '1000.00',
          }),
        ).rejects.toThrow('El precio es igual al vigente');
      });

      it('una línea de otra compra es 404', async () => {
        compra();
        lineas([linea({})]);
        await expect(
          service.corregirLinea(TENANT, USUARIO, COMPRA, 'otra', {
            precioUnitario: '1500',
          }),
        ).rejects.toThrow('Línea no encontrada');
      });

      it('un producto en la papelera es 400 y no toca nada', async () => {
        compra();
        lineas([linea({ item_eliminado: true })]);
        await expect(
          service.corregirLinea(TENANT, USUARIO, COMPRA, 'l1', {
            precioUnitario: '1500',
          }),
        ).rejects.toThrow('"Tomate" está en la papelera');
        expect(recalcularCostoDesdeCompra).not.toHaveBeenCalled();
      });

      it('la papelera frena aunque el costo por unidad base no cambie', async () => {
        compra();
        // 1 kg a $1.000 son $1/g; a $1.000,0001 siguen siendo $1,0000/g.
        lineas([
          linea({
            item_eliminado: true,
            cantidad: '1',
            cantidad_base: '1000',
            unidad_base: 'g',
            costo_unitario_base: '1.0000',
          }),
        ]);
        await expect(
          service.corregirLinea(TENANT, USUARIO, COMPRA, 'l1', {
            precioUnitario: '1000.0001',
          }),
        ).rejects.toThrow('"Tomate" está en la papelera');
      });

      it('si el reparto cambia el costo de un producto en la papelera, es 400', async () => {
        compra({ descuento_total: '2000' });
        lineas([
          linea({
            compra_linea_id: 'lb',
            item_id: ITEM_B,
            item_nombre: 'Lechuga',
            item_eliminado: true,
            costo_unitario_base: '900.0000',
          }),
          linea({
            compra_linea_id: 'la',
            costo_unitario_base: '900.0000',
          }),
        ]);
        await expect(
          service.corregirLinea(TENANT, USUARIO, COMPRA, 'la', {
            precioUnitario: '2000',
          }),
        ).rejects.toThrow('"Lechuga" está en la papelera');
      });

      it.each([
        ['borrador', 'se edita, no se corrige'],
        ['anulada', 'La compra está anulada'],
      ])('sobre una compra %s es 409', async (estado, mensaje) => {
        compra({ estado });
        lineas([linea({})]);
        await expect(
          service.corregirLinea(TENANT, USUARIO, COMPRA, 'l1', {
            precioUnitario: '1500',
          }),
        ).rejects.toThrow(new ConflictException(mensaje).message);
      });
    });

    describe('cantidad', () => {
      /** Params de la ÚNICA llamada a `registrarMovimiento`. */
      function movido() {
        expect(registrarMovimiento).toHaveBeenCalledTimes(1);
        return registrarMovimiento.mock.calls[0][1] as Record<string, unknown>;
      }

      /** Params del UPDATE de la línea: [tenant, id, cantidad, base, series]. */
      function lineaGuardada(): unknown[] {
        const db = (service as unknown as { db: { query: jest.Mock } }).db;
        return db.query.mock.calls.find(([sql]) =>
          /SET cantidad = \$3, cantidad_base = \$4/.test(sql as string),
        )![1] as unknown[];
      }

      function saldo(stock: string) {
        pisar(/SELECT stock FROM stock_ubicacion/, [{ stock }]);
      }

      function saldoLote(stock: string) {
        pisar(/FROM lote_ubicacion/, [{ stock }]);
      }

      it('subir mueve la diferencia como entrada compra de la línea y rehace la cuenta aunque el costo por unidad no cambie', async () => {
        compra();
        lineas([linea({})]);

        await service.corregirLinea(TENANT, USUARIO, COMPRA, 'l1', {
          cantidad: '12',
        });

        expect(movido()).toMatchObject({
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '2',
          ubicacionId: UBICACION,
          compraLineaId: 'l1',
          costoUnitario: '1000.0000',
        });
        expect(lineaGuardada()).toEqual([TENANT, 'l1', '12', '12', null]);
        // Sin descuento, 12 a $1.000 sigue costando $1.000 por kg: la cuenta
        // se rehace igual, porque cambió el peso.
        expect(cuentas()).toEqual([ITEM_A]);
        expect(historial()).toEqual([
          ['l1', TENANT, 'cantidad', '10', '12', USUARIO, 'mov-1'],
        ]);
      });

      it('bajar lo que alcanza es una salida sin costo propio', async () => {
        compra();
        lineas([linea({})]);
        saldo('5');

        await service.corregirLinea(TENANT, USUARIO, COMPRA, 'l1', {
          cantidad: '8',
        });

        expect(movido()).toMatchObject({
          tipo: 'salida',
          cantidad: '2',
          costoUnitario: null,
        });
      });

      it('bajar más de lo que queda es 400 con el producto, la ubicación y cuánto queda', async () => {
        compra();
        lineas([linea({})]);
        saldo('1');

        await expect(
          service.corregirLinea(TENANT, USUARIO, COMPRA, 'l1', {
            cantidad: '8',
          }),
        ).rejects.toThrow(
          'No alcanza para bajar 2: de "Tomate" quedan 1 en Bodega',
        );
        expect(registrarMovimiento).not.toHaveBeenCalled();
      });

      it('en otra unidad, la diferencia se convierte a la base', async () => {
        compra();
        lineas([
          linea({
            unidad_codigo: 'kg',
            unidad_base: 'g',
            cantidad: '1',
            cantidad_base: '1000',
          }),
        ]);
        convertir.mockReturnValue('1500');

        await service.corregirLinea(TENANT, USUARIO, COMPRA, 'l1', {
          cantidad: '1.5',
        });

        expect(convertir).toHaveBeenCalledWith('1.5', 'kg', 'g');
        expect(movido()).toMatchObject({ tipo: 'entrada', cantidad: '500' });
        expect(lineaGuardada().slice(2, 4)).toEqual(['1.5', '1500']);
      });

      it('bloquea la ubicación y después todos los productos de la compra, antes de mover', async () => {
        compra();
        lineas([
          linea({ compra_linea_id: 'lb', item_id: ITEM_B }),
          linea({ compra_linea_id: 'la', item_id: ITEM_A }),
        ]);

        await service.corregirLinea(TENANT, USUARIO, COMPRA, 'lb', {
          cantidad: '12',
        });

        expect(eventos).toEqual([
          'bloquearContraBorrado',
          'lock productos',
          'registrarMovimiento',
        ]);
        const db = (service as unknown as { db: { query: jest.Mock } }).db;
        const lock = db.query.mock.calls.find(([sql]) =>
          /FOR UPDATE OF ip/.test(sql as string),
        )!;
        expect(lock[1]).toEqual([[ITEM_A, ITEM_B], TENANT]);
        // El orden lo fija el SQL, no el arreglo: `docs/patterns/backend.md` §15.
        expect(lock[0] as string).toMatch(
          /ORDER BY ip\.item_id\s+FOR UPDATE OF ip/,
        );
      });

      it('con la ubicación de la compra borrada es 400', async () => {
        compra({ ubicacion_viva: false });
        lineas([linea({})]);
        await expect(
          service.corregirLinea(TENANT, USUARIO, COMPRA, 'l1', {
            cantidad: '12',
          }),
        ).rejects.toThrow('(Bodega) fue eliminada');
      });

      it('la misma cantidad es 400, y sin precio ni cantidad también', async () => {
        compra();
        lineas([linea({})]);
        await expect(
          service.corregirLinea(TENANT, USUARIO, COMPRA, 'l1', {
            cantidad: '10.000',
          }),
        ).rejects.toThrow('La cantidad es igual a la vigente');
        await expect(
          service.corregirLinea(TENANT, USUARIO, COMPRA, 'l1', {}),
        ).rejects.toThrow('No hay nada que corregir');
      });

      it('precio y cantidad juntos: la cantidad primero, dos filas de historial y una sola cuenta', async () => {
        compra();
        lineas([linea({})]);

        await service.corregirLinea(TENANT, USUARIO, COMPRA, 'l1', {
          cantidad: '12',
          precioUnitario: '1500',
        });

        expect(cuentas()).toEqual([ITEM_A]);
        expect(historial().map((f) => [f[2], f[3], f[4], f[6]])).toEqual([
          ['cantidad', '10', '12', 'mov-1'],
          ['precio', '1000', '1500', `corr-${ITEM_A}`],
        ]);
      });

      describe('serie', () => {
        const SERIE = {
          modo_inventario: 'serie',
          unidad_codigo: 'unidad',
          unidad_base: 'unidad',
          cantidad: '2',
          cantidad_base: '2',
          series: [{ serie: 'SN-1' }, { serie: 'SN-2' }],
        };

        it('subir pide las series nuevas y las agrega a la línea', async () => {
          compra();
          lineas([linea(SERIE)]);
          await expect(
            service.corregirLinea(TENANT, USUARIO, COMPRA, 'l1', {
              cantidad: '3',
            }),
          ).rejects.toThrow('Subir 1 unidades pide 1 series nuevas');

          await service.corregirLinea(TENANT, USUARIO, COMPRA, 'l1', {
            cantidad: '3',
            series: [{ serie: 'SN-3' }],
          });
          expect(movido()).toMatchObject({ series: [{ serie: 'SN-3' }] });
          expect(JSON.parse(lineaGuardada()[4] as string)).toEqual([
            { serie: 'SN-1' },
            { serie: 'SN-2' },
            { serie: 'SN-3' },
          ]);
        });

        it('bajar pide cuáles salen y las saca de la línea', async () => {
          compra();
          lineas([linea(SERIE)]);
          saldo('2');
          const UNIDAD = '99999999-9999-4999-8999-999999999999';
          await expect(
            service.corregirLinea(TENANT, USUARIO, COMPRA, 'l1', {
              cantidad: '1',
            }),
          ).rejects.toThrow('Bajar 1 unidades pide cuáles salen');

          pisar(/SELECT serie FROM item_unidad/, [{ serie: 'SN-1' }]);
          await service.corregirLinea(TENANT, USUARIO, COMPRA, 'l1', {
            cantidad: '1',
            unidadIds: [UNIDAD],
          });
          expect(movido()).toMatchObject({
            tipo: 'salida',
            unidadIds: [UNIDAD],
          });
          const db = (service as unknown as { db: { query: jest.Mock } }).db;
          const salen = db.query.mock.calls.find(([sql]) =>
            /SELECT serie FROM item_unidad/.test(sql as string),
          )!;
          expect(salen[0] as string).toMatch(
            /AND item_id = \$2 AND tenant_id = \$3\s+AND eliminado_el IS NULL/,
          );
          expect(JSON.parse(lineaGuardada()[4] as string)).toEqual([
            { serie: 'SN-2' },
          ]);
        });

        it('una unidad que no trajo esta compra no sale por acá', async () => {
          compra();
          lineas([linea(SERIE)]);
          saldo('2');
          pisar(/SELECT serie FROM item_unidad/, [{ serie: 'SN-DE-OTRA' }]);
          await expect(
            service.corregirLinea(TENANT, USUARIO, COMPRA, 'l1', {
              cantidad: '1',
              unidadIds: ['99999999-9999-4999-8999-999999999999'],
            }),
          ).rejects.toThrow('tienen que ser de las que trajo esta compra');
          expect(registrarMovimiento).not.toHaveBeenCalled();
        });
      });

      describe('lote', () => {
        const LOTE = {
          modo_inventario: 'lote',
          unidad_codigo: 'unidad',
          unidad_base: 'unidad',
          lote: { codigoLote: 'L-7' },
        };

        it('subir va al mismo lote', async () => {
          compra();
          lineas([linea(LOTE)]);
          await service.corregirLinea(TENANT, USUARIO, COMPRA, 'l1', {
            cantidad: '12',
          });
          expect(movido()).toMatchObject({ lote: { codigoLote: 'L-7' } });
        });

        it('bajar sale del lote de la línea, buscado por su código', async () => {
          compra();
          lineas([linea(LOTE)]);
          saldoLote('10');
          pisar(/SELECT lote_id FROM item_lote/, [{ lote_id: 'lote-7' }]);
          await service.corregirLinea(TENANT, USUARIO, COMPRA, 'l1', {
            cantidad: '8',
          });
          expect(movido()).toMatchObject({ tipo: 'salida', loteId: 'lote-7' });
        });

        it('el saldo que decide es el del lote, no el del producto entero', async () => {
          compra();
          lineas([linea(LOTE)]);
          // 10 del producto en la bodega, pero solo 1 de este lote.
          saldo('10');
          saldoLote('1');
          pisar(/SELECT lote_id FROM item_lote/, [{ lote_id: 'lote-7' }]);
          await expect(
            service.corregirLinea(TENANT, USUARIO, COMPRA, 'l1', {
              cantidad: '8',
            }),
          ).rejects.toThrow(
            'No alcanza para bajar 2: del lote L-7 de "Tomate" quedan 1 en Bodega',
          );
        });

        it('si el lote ya no existe, bajar es 400 en vez de elegir otro', async () => {
          compra();
          lineas([linea(LOTE)]);
          saldo('10');
          await expect(
            service.corregirLinea(TENANT, USUARIO, COMPRA, 'l1', {
              cantidad: '8',
            }),
          ).rejects.toThrow('El lote L-7 de "Tomate" ya no existe');
          expect(registrarMovimiento).not.toHaveBeenCalled();
        });
      });
    });

    describe('anular (spec § 4.5)', () => {
      function anular(motivo = 'Factura equivocada') {
        return service.anular(TENANT, USUARIO, COMPRA, { motivo });
      }

      function stock(filas: { item_id: string; stock: string }[]) {
        pisar(/SELECT item_id, stock FROM stock_ubicacion/, filas);
      }

      function salidas() {
        return registrarMovimiento.mock.calls.map(
          (c) => c[1] as Record<string, unknown>,
        );
      }

      it('saca cada línea en orden de producto, la deja anulada y después rehace las cuentas', async () => {
        compra();
        lineas([
          linea({ compra_linea_id: 'lb', item_id: ITEM_B, cantidad_base: '4' }),
          linea({
            compra_linea_id: 'la',
            item_id: ITEM_A,
            cantidad_base: '10',
          }),
        ]);
        stock([
          { item_id: ITEM_A, stock: '10' },
          { item_id: ITEM_B, stock: '4' },
        ]);

        await anular();

        expect(
          salidas().map((p) => [
            p.compraLineaId,
            p.tipo,
            p.motivo,
            p.cantidad,
            p.ubicacionId,
          ]),
        ).toEqual([
          ['la', 'salida', 'compra', '10', UBICACION],
          ['lb', 'salida', 'compra', '4', UBICACION],
        ]);
        expect(cuentas()).toEqual([ITEM_A, ITEM_B]);

        const db = (service as unknown as { db: { query: jest.Mock } }).db;
        const i = db.query.mock.calls.findIndex(([sql]) =>
          /SET estado = 'anulada'/.test(sql as string),
        );
        expect(db.query.mock.calls[i][1]).toEqual([
          TENANT,
          COMPRA,
          USUARIO,
          'Factura equivocada',
        ]);
        // El estado antes de las cuentas: el recorrido salta la anulada.
        expect(db.query.mock.invocationCallOrder[i]).toBeLessThan(
          recalcularCostoDesdeCompra.mock.invocationCallOrder[0],
        );
      });

      it('bloquea la ubicación y todos los productos antes de mover', async () => {
        compra();
        lineas([linea({})]);
        stock([{ item_id: ITEM_A, stock: '10' }]);

        await anular();

        expect(eventos).toEqual([
          'bloquearContraBorrado',
          'lock productos',
          'registrarMovimiento',
        ]);
      });

      it('si no alcanza, no saca nada y dice cuál', async () => {
        compra();
        lineas([linea({})]);
        stock([{ item_id: ITEM_A, stock: '3' }]);

        await expect(anular()).rejects.toThrow(
          'No se puede anular: de "Tomate" quedan 3 en Bodega y la compra trajo 10',
        );
        expect(registrarMovimiento).not.toHaveBeenCalled();
      });

      it('dos líneas del mismo producto suman lo que tiene que salir', async () => {
        compra();
        lineas([
          linea({ compra_linea_id: 'l1', cantidad_base: '10' }),
          linea({ compra_linea_id: 'l2', cantidad_base: '20' }),
        ]);
        stock([{ item_id: ITEM_A, stock: '25' }]);

        await expect(anular()).rejects.toThrow(
          'quedan 25 en Bodega y la compra trajo 30',
        );
      });

      it('en lote sale del lote de la línea, y decide su saldo', async () => {
        const LOTE = {
          modo_inventario: 'lote',
          unidad_base: 'unidad',
          unidad_codigo: 'unidad',
          lote: { codigoLote: 'L-7' },
        };
        compra();
        lineas([linea(LOTE)]);
        pisar(/FROM item_lote/, [
          { lote_id: 'lote-7', item_id: ITEM_A, codigo_lote: 'L-7' },
        ]);
        pisar(/FROM lote_ubicacion/, [{ lote_id: 'lote-7', cantidad: '4' }]);
        await expect(anular()).rejects.toThrow(
          'del lote L-7 de "Tomate" quedan 4 en Bodega y la compra trajo 10',
        );

        pisar(/FROM lote_ubicacion/, [{ lote_id: 'lote-7', cantidad: '10' }]);
        await anular();
        expect(salidas()[0]).toMatchObject({ loteId: 'lote-7' });
      });

      it('en lote, un lote que ya no existe es 400', async () => {
        compra();
        lineas([
          linea({
            modo_inventario: 'lote',
            unidad_base: 'unidad',
            unidad_codigo: 'unidad',
            lote: { codigoLote: 'L-7' },
          }),
        ]);
        await expect(anular()).rejects.toThrow(
          'el lote L-7 de "Tomate" ya no existe',
        );
      });

      it('en serie salen las unidades que trajo la línea, si siguen disponibles ahí', async () => {
        const SERIE = {
          modo_inventario: 'serie',
          unidad_base: 'unidad',
          unidad_codigo: 'unidad',
          cantidad_base: '2',
          series: [{ serie: 'SN-1' }, { serie: 'SN-2' }],
        };
        const unidad = (serie: string, o: Record<string, unknown> = {}) => ({
          unidad_id: `u-${serie}`,
          item_id: ITEM_A,
          serie,
          estado: 'disponible',
          ubicacion_id: UBICACION,
          ...o,
        });
        compra();
        lineas([linea(SERIE)]);
        pisar(/FROM item_unidad/, [
          unidad('SN-1'),
          unidad('SN-2', { estado: 'vendida' }),
        ]);
        await expect(anular()).rejects.toThrow(
          'la unidad SN-2 de "Tomate" ya no está disponible en Bodega',
        );

        pisar(/FROM item_unidad/, [
          unidad('SN-1'),
          unidad('SN-2', { ubicacion_id: 'otra-ubicacion' }),
        ]);
        await expect(anular()).rejects.toThrow(
          'la unidad SN-2 de "Tomate" ya no está disponible en Bodega',
        );

        pisar(/FROM item_unidad/, [unidad('SN-1'), unidad('SN-2')]);
        await anular();
        expect(salidas()[0]).toMatchObject({
          cantidad: '2',
          unidadIds: ['u-SN-1', 'u-SN-2'],
        });
      });

      it('sin motivo es 400', async () => {
        await expect(anular('   ')).rejects.toThrow(
          'La anulación necesita un motivo',
        );
      });

      it.each([
        ['borrador', 'se descarta, no se anula'],
        ['anulada', 'La compra está anulada'],
      ])('una compra %s no se anula: 409', async (estado, mensaje) => {
        compra({ estado });
        lineas([linea({})]);
        await expect(anular()).rejects.toThrow(
          new ConflictException(mensaje).message,
        );
      });

      it('con la ubicación borrada o un producto en la papelera es 400', async () => {
        compra({ ubicacion_viva: false });
        lineas([linea({})]);
        await expect(anular()).rejects.toThrow('(Bodega) fue eliminada');

        compra();
        lineas([linea({ item_eliminado: true })]);
        await expect(anular()).rejects.toThrow('"Tomate" está en la papelera');
        expect(registrarMovimiento).not.toHaveBeenCalled();
      });
    });

    describe('descuento al total', () => {
      it('se reparte, rehace la cuenta y deja el historial en cada línea que cambió', async () => {
        compra();
        lineas([
          linea({ compra_linea_id: 'lb', item_id: ITEM_B }),
          linea({ compra_linea_id: 'la', item_id: ITEM_A }),
        ]);

        await service.corregirDescuento(TENANT, USUARIO, COMPRA, {
          descuentoTotal: '2000',
        });

        expect(cuentas()).toEqual([ITEM_A, ITEM_B]);
        expect(historial()).toEqual([
          ['lb', TENANT, 'descuento', null, '2000', USUARIO, `corr-${ITEM_B}`],
          ['la', TENANT, 'descuento', null, '2000', USUARIO, `corr-${ITEM_A}`],
        ]);
      });

      it('con una línea sin precio es 400', async () => {
        compra();
        lineas([linea({ precio_unitario: null, costo_unitario_base: null })]);
        await expect(
          service.corregirDescuento(TENANT, USUARIO, COMPRA, {
            descuentoTotal: '100',
          }),
        ).rejects.toThrow('Falta el precio de alguna línea');
      });

      it('mayor que el total de la compra es 400', async () => {
        compra();
        lineas([linea({})]);
        await expect(
          service.corregirDescuento(TENANT, USUARIO, COMPRA, {
            descuentoTotal: '10001',
          }),
        ).rejects.toThrow('supera el total de la compra (10000)');
      });

      it('igual al total deja la mercadería a costo 0, y no es un costo que se perdió al convertir', async () => {
        compra();
        lineas([linea({})]);

        await service.corregirDescuento(TENANT, USUARIO, COMPRA, {
          descuentoTotal: '10000',
        });

        const db = (service as unknown as { db: { query: jest.Mock } }).db;
        const update = db.query.mock.calls.find(([sql]) =>
          /SET costo_unitario_base = v\.costo/.test(sql as string),
        )!;
        expect(update[1]).toEqual([TENANT, 'l1', '0.0000']);
      });

      it('un descuento parcial que deja una línea en 0,0000 es 400: ese 0 nadie lo eligió', async () => {
        compra();
        // A: 1 kg a $1 son $0,001/g. B: $999. El descuento de $999 le toca
        // $0,999 a A, que en pesos redondea a $1: A queda en 0,0000/g.
        lineas([
          linea({
            compra_linea_id: 'la',
            cantidad: '1',
            cantidad_base: '1000',
            unidad_base: 'g',
            precio_unitario: '1',
            costo_unitario_base: '0.0010',
          }),
          linea({
            compra_linea_id: 'lb',
            item_id: ITEM_B,
            cantidad: '1',
            cantidad_base: '1',
            precio_unitario: '999',
            costo_unitario_base: '999.0000',
          }),
        ]);
        await expect(
          service.corregirDescuento(TENANT, USUARIO, COMPRA, {
            descuentoTotal: '999',
          }),
        ).rejects.toThrow('El costo se pierde al convertirlo a "g"');
        expect(recalcularCostoDesdeCompra).not.toHaveBeenCalled();
      });

      it('quitarlo con 0 lo guarda como sin descuento', async () => {
        compra({ descuento_total: '2000' });
        lineas([linea({ costo_unitario_base: '800.0000' })]);

        await service.corregirDescuento(TENANT, USUARIO, COMPRA, {
          descuentoTotal: '0',
        });

        const db = (service as unknown as { db: { query: jest.Mock } }).db;
        const update = db.query.mock.calls.find(([sql]) =>
          /UPDATE compras SET descuento_total/.test(sql as string),
        )!;
        expect(update[1]).toEqual([TENANT, COMPRA, null]);
        expect(historial()[0].slice(3, 5)).toEqual(['2000', null]);
      });

      it('0 es quitarlo, y quitar el que no hay es 400', async () => {
        compra();
        lineas([linea({})]);
        await expect(
          service.corregirDescuento(TENANT, USUARIO, COMPRA, {
            descuentoTotal: '0',
          }),
        ).rejects.toThrow('El descuento es igual al vigente');
      });
    });
  });
});
