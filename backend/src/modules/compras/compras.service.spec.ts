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
        unidad_base: 'kg',
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
