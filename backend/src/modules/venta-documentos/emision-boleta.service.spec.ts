import { Test } from '@nestjs/testing';
import { DataSource, type EntityManager } from 'typeorm';
import { Db } from '../../common/db/db.service';
import { TxContext } from '../../common/db/tx-context';
import { ColaDteService } from '../dte/cola-dte.service';
import { DteError } from '../dte/dte.types';
import { emitirBoleta } from '../dte/envio-boleta';
import { FoliosService } from '../dte/folios.service';
import { PerfilFiscalService } from '../dte/perfil-fiscal.service';
import type { VentaDocumento } from './entities/venta-documento.entity';
import { EmisionBoletaService } from './emision-boleta.service';

jest.mock('../dte/envio-boleta', () => ({ emitirBoleta: jest.fn() }));

const TENANT = 'tenant-1';
const DOC_ID = 'doc-1';
const BOLETA_TIPO = 'tipo-boleta';
const CAF = 'caf-1';

const doc = (over: Partial<VentaDocumento> = {}): VentaDocumento =>
  ({
    id: DOC_ID,
    emisor: 'sistema',
    tipoDocumentoId: BOLETA_TIPO,
    descarte: null,
    esDuplicado: false,
    ...over,
  }) as VentaDocumento;

describe('EmisionBoletaService.documentoAEmitir', () => {
  const servicio = new EmisionBoletaService(
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );

  it('la boleta del sistema de una venta con tipo de boleta es la que se emite', () => {
    const d = doc();
    expect(servicio.documentoAEmitir([d], true)).toBe(d);
  });

  it('entre la boleta del sistema y el voucher de la máquina (pago mixto) elige la del sistema', () => {
    const sistema = doc();
    const maquina = doc({
      id: 'doc-2',
      emisor: 'maquina',
      tipoDocumentoId: null,
    });
    expect(servicio.documentoAEmitir([maquina, sistema], true)).toBe(sistema);
  });

  it('una factura (el tipo de la venta no es boleta) no se emite: queda armada', () => {
    expect(servicio.documentoAEmitir([doc()], false)).toBeNull();
  });

  it.each(['maquina', 'nadie', 'externo'] as const)(
    'un documento del emisor %s no lo emite el sistema',
    (emisor) => {
      expect(
        servicio.documentoAEmitir(
          [doc({ emisor, tipoDocumentoId: null })],
          true,
        ),
      ).toBeNull();
    },
  );

  it('un documento descartado no se emite', () => {
    expect(
      servicio.documentoAEmitir([doc({ descarte: 'armado_sin_enviar' })], true),
    ).toBeNull();
  });

  it('un voucher duplicado no se emite', () => {
    expect(
      servicio.documentoAEmitir([doc({ esDuplicado: true })], true),
    ).toBeNull();
  });

  it('un documento del sistema sin tipo (país sin boleta) no se emite', () => {
    expect(
      servicio.documentoAEmitir([doc({ tipoDocumentoId: null })], true),
    ).toBeNull();
  });

  it('sin documentos no hay nada que emitir', () => {
    expect(servicio.documentoAEmitir([], true)).toBeNull();
  });

  it('dos boletas del sistema contradicen ADR-028: tira en vez de elegir una', () => {
    expect(() =>
      servicio.documentoAEmitir([doc(), doc({ id: 'doc-2' })], true),
    ).toThrow('ADR-028');
  });
});

describe('EmisionBoletaService.emitir', () => {
  // La instalación de verdad de Db + TxContext, con un manager que anota cada sentencia en el
  // orden en que llega: lo que importa del savepoint es QUÉ se escribe antes y después de
  // volver, y eso solo se ve con las sentencias reales.
  const sentencias: { sql: string; params?: unknown[] }[] = [];
  let filas: (sql: string) => unknown[];
  const manager = {
    query: jest.fn((sql: string, params?: unknown[]) => {
      sentencias.push({ sql, params });
      return Promise.resolve(filas(sql));
    }),
  } as unknown as EntityManager;
  const dataSource = {
    transaction: jest.fn((cb: (m: EntityManager) => Promise<unknown>) =>
      cb(manager),
    ),
  } as unknown as DataSource;

  const folios = {
    tomarFolio: jest.fn(),
    credencialesParaFirmar: jest.fn(),
  };
  const cola = { encolar: jest.fn() };
  const perfil = { proveedorSoftware: jest.fn() };
  const emitirBoletaMock = emitirBoleta as jest.MockedFunction<
    typeof emitirBoleta
  >;

  let db: Db;
  let servicio: EmisionBoletaService;

  const cred = {
    caf: { id: 'caf-leido' },
    certificado: { id: 'cert' },
    emisor: {
      rut: '76543210-3',
      razonSocial: 'Panadería SpA',
      giro: 'Panadería',
      direccion: 'Calle 1',
      comuna: 'Ñuñoa',
    },
  };
  const AHORA = new Date('2027-01-05T15:00:00Z');

  const LINEA_BASE = {
    descripcion: 'Café' as string | null,
    cantidad: '1.0000',
    subtotal: '5000.0000',
    total_linea: '5950.0000',
    exenta: false,
    tasa_iva: '0.1900',
  };
  /** Lo que devuelve cada lectura; se pisa por test lo que cambia. */
  const lecturas = {
    documento: {
      documento_id: DOC_ID,
      emisor: 'sistema',
      estado_envio: 'armado',
      descarte: null as string | null,
      monto: '5950.0000',
      monto_afecto: '5000.0000',
      monto_exento: '0.0000',
      monto_impuestos: '950.0000',
      es_boleta: true as boolean | null,
      venta_id: 'venta-1' as string | null,
      pais_id: 'pais-1' as string | null,
      // 31-dic-2026 23:30 en Chile (UTC-3): ya es enero en UTC, y la boleta lleva diciembre.
      creado_el: new Date('2027-01-01T02:30:00Z'),
      total_final: '5950.0000',
      cubre_todo: true,
      umbral_identidad: '5363274.6000' as string | null,
    },
    lineas: [{ ...LINEA_BASE }],
    adicionales: '0',
    receptor: [] as {
      nombre: string | null;
      rut: string | null;
      email: string | null;
      telefono: string | null;
    }[],
    pagos: [] as { monto: string; medio_pago_sii: number | null }[],
  };
  let doc0: typeof lecturas.documento | null;

  const sqls = () => sentencias.map((s) => s.sql);
  const control = () =>
    sqls().filter((s) => /^(SAVEPOINT|RELEASE|ROLLBACK)/.test(s.trim()));
  const sinEmitirEscrito = () =>
    sentencias.find((s) => s.sql.includes("estado_envio = 'sin_emitir'"));
  const datosDelMotor = () => emitirBoletaMock.mock.calls[0][0];

  beforeEach(async () => {
    sentencias.length = 0;
    jest.clearAllMocks();
    doc0 = { ...lecturas.documento };
    lecturas.lineas = [{ ...LINEA_BASE }];
    lecturas.adicionales = '0';
    lecturas.receptor = [];
    lecturas.pagos = [];
    filas = (sql) => {
      if (sql.includes('FROM venta_documentos d')) return doc0 ? [doc0] : [];
      if (sql.includes('FROM venta_detalles d')) return lecturas.lineas;
      if (sql.includes('AS adicionales'))
        return [{ adicionales: lecturas.adicionales }];
      if (sql.includes('FROM venta_customer')) return lecturas.receptor;
      if (sql.includes('FROM pagos p')) return lecturas.pagos;
      return [];
    };
    folios.tomarFolio.mockResolvedValue({ cafId: CAF, folio: 1234 });
    folios.credencialesParaFirmar.mockResolvedValue(cred);
    perfil.proveedorSoftware.mockReturnValue({
      rut: '76222333-3',
      razonSocial: 'Proveedor SpA',
    });
    emitirBoletaMock.mockReturnValue({
      xml: '<DTE/>',
      rutEmisor: '76543210-3',
      folio: 1234,
      tipo: 39,
      diferenciaIvaRedondeo: '0',
    });
    cola.encolar.mockResolvedValue({ documentoId: 'dte-1' });

    const modulo = await Test.createTestingModule({
      providers: [
        TxContext,
        Db,
        EmisionBoletaService,
        { provide: DataSource, useValue: dataSource },
        { provide: FoliosService, useValue: folios },
        { provide: ColaDteService, useValue: cola },
        { provide: PerfilFiscalService, useValue: perfil },
      ],
    }).compile();
    db = modulo.get(Db);
    servicio = modulo.get(EmisionBoletaService);
  });

  const emitir = () =>
    db.transaccion(() => servicio.emitir(TENANT, DOC_ID, AHORA));

  it('fuera de una transacción tira y no toca nada', async () => {
    await expect(servicio.emitir(TENANT, DOC_ID, AHORA)).rejects.toThrow(
      'db.transaccion',
    );
    expect(sentencias).toEqual([]);
    expect(folios.tomarFolio).not.toHaveBeenCalled();
  });

  it('emite: toma el folio, firma, encola y marca el documento emitido, todo detrás del savepoint', async () => {
    const r = await emitir();

    expect(r).toEqual({ estado: 'emitido', folio: 1234, tipo: 39 });
    expect(folios.tomarFolio).toHaveBeenCalledWith(TENANT, 39);
    expect(folios.credencialesParaFirmar).toHaveBeenCalledWith(
      TENANT,
      CAF,
      AHORA,
    );
    // La hora de la firma es la de AHORA en Chile, no la de la venta.
    expect(emitirBoletaMock).toHaveBeenCalledWith(
      expect.any(Object),
      cred,
      '2027-01-05T12:00:00',
    );
    expect(cola.encolar).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ folio: 1234 }),
      CAF,
    );
    expect(control()).toEqual([
      'SAVEPOINT emision_boleta',
      'RELEASE SAVEPOINT emision_boleta',
    ]);
    const marca = sentencias.find((s) =>
      s.sql.includes("estado_envio = 'emitido'"),
    );
    expect(marca?.params).toEqual([DOC_ID, TENANT, 'dte-1']);
    expect(marca?.sql).toContain('emision_error_codigo = NULL');
    expect(sinEmitirEscrito()).toBeUndefined();
    // La marca se escribe antes de soltar el savepoint.
    const orden = sqls();
    expect(orden.findIndex((s) => s.includes("= 'emitido'"))).toBeLessThan(
      orden.findIndex((s) => s.startsWith('RELEASE')),
    );
  });

  it('la boleta lleva la fecha de la venta en la hora de Chile, no la de hoy ni la de UTC', async () => {
    await emitir();

    expect(datosDelMotor().fechaEmision).toBe('2026-12-31');
  });

  it('el documento se lee bloqueado y con las lecturas fijas: una por tabla, ninguna por línea', async () => {
    lecturas.lineas = [
      ...lecturas.lineas,
      { ...lecturas.lineas[0], descripcion: 'Pan' },
      { ...lecturas.lineas[0], descripcion: 'Té' },
    ];

    await emitir();

    const lecturasHechas = sqls().filter((s) => /^\s*SELECT/.test(s));
    expect(lecturasHechas).toHaveLength(5);
    expect(lecturasHechas[0]).toContain('FOR UPDATE OF d');
    expect(datosDelMotor().lineas).toHaveLength(3);
  });

  it('el IVA de las líneas se lee de ventas_impuestos sin filtrar el borrado del impuesto', async () => {
    await emitir();

    const lineas = sqls().find((s) => s.includes('FROM venta_detalles d'));
    expect(lineas).toContain("i.tipo = 'iva'");
    // Que el impuesto se borre después no cambia lo que la venta cobró.
    expect(lineas).not.toMatch(/\bi\.eliminado_el/);
  });

  describe('el umbral de identidad es el del año de la venta', () => {
    it('lo lee con el año de v.creado_el en la zona de la provincia, no con now()', async () => {
      await emitir();

      const lectura = sqls()[1];
      expect(lectura).toContain(
        'EXTRACT(YEAR FROM v.creado_el AT TIME ZONE prov.zona_horaria)',
      );
      expect(lectura).not.toMatch(/now\(\)/i);
    });

    it.each([
      ['supera el umbral', '6000000.0000', '5363274.6000', true],
      [
        'es igual (la norma dice "exceda")',
        '5363274.6000',
        '5363274.6000',
        false,
      ],
      ['queda debajo', '5950.0000', '5363274.6000', false],
      ['el país no tiene la regla', '9999999.0000', null, false],
    ])('%s', async (_caso, total, umbral, esperado) => {
      doc0 = { ...doc0!, total_final: total, umbral_identidad: umbral };

      await emitir();

      expect(datosDelMotor().superaUmbralIdentificacion).toBe(esperado);
    });
  });

  it('sobre el umbral el medio de pago es el del pago de mayor monto', async () => {
    doc0 = { ...doc0!, total_final: '6000000.0000' };
    lecturas.receptor = [
      { nombre: 'Ana', rut: '11111111-1', email: 'a@b.cl', telefono: null },
    ];
    lecturas.pagos = [
      { monto: '1000000.0000', medio_pago_sii: 1 },
      { monto: '5000000.0000', medio_pago_sii: 2 },
    ];

    await emitir();

    const datos = datosDelMotor();
    expect(datos.medioPago).toBe(2);
    expect(datos.receptor).toEqual({
      rut: '11111111-1',
      nombre: 'Ana',
      correo: 'a@b.cl',
    });
  });

  it('un medio de pago fuera del catálogo del SII se declara como "otro"', async () => {
    doc0 = { ...doc0!, total_final: '6000000.0000' };
    lecturas.pagos = [{ monto: '6000000.0000', medio_pago_sii: 9 }];

    await emitir();

    expect(datosDelMotor().medioPago).toBe(5);
  });

  it('los pagos se piden por el documento (no por la venta) y del tenant', async () => {
    await emitir();

    const pagos = sentencias.find((s) => s.sql.includes('FROM pagos p'));
    expect(pagos?.params).toEqual([DOC_ID, TENANT]);
    expect(pagos?.sql).toContain('p.documento_id = $1');
    expect(pagos?.sql).toContain('p.tenant_id = $2');
    // Defensa en profundidad: la aplicación también es del tenant del pago.
    expect(pagos?.sql).toContain('a.tenant_id = p.tenant_id');
  });

  it('las lecturas de la venta cuelgan de su venta_id y de la venta que el tenant ya validó', async () => {
    await emitir();

    // venta_detalles, ventas_impuestos y venta_customer no tienen tenant_id propio: el
    // aislamiento lo da el documento (por id y tenant) y la venta que de ahí sale. Se afirma
    // que cada lectura recibe ESE venta_id y nada más.
    for (const fragmento of [
      'FROM venta_detalles d',
      'AS adicionales',
      'FROM venta_customer',
    ]) {
      const llamada = sentencias.find((x) => x.sql.includes(fragmento));
      expect(llamada?.params).toEqual(['venta-1']);
    }
    const principal = sentencias.find((x) =>
      x.sql.includes('FROM venta_documentos d'),
    );
    expect(principal?.sql).toContain('d.tenant_id = $2');
    expect(principal?.sql).toContain('v.tenant_id = d.tenant_id');
  });

  it('un documento que cubre una parte sale con la línea de saldo y los baldes que congeló', async () => {
    doc0 = {
      ...doc0!,
      monto: '2975.0000',
      monto_afecto: '2500.0000',
      monto_impuestos: '475.0000',
      cubre_todo: false,
    };

    await emitir();

    const datos = datosDelMotor();
    expect(datos.lineas.map((l) => l.nombre)).toEqual(['Saldo de la venta']);
    expect(datos.montos).toMatchObject({
      total: '2975.0000',
      neto: '2500.0000',
    });
  });

  describe('un DteError no tumba la venta', () => {
    it('sin folios: vuelve al savepoint y DESPUÉS marca sin_emitir con el motivo', async () => {
      folios.tomarFolio.mockRejectedValue(
        new DteError('SIN_FOLIOS', 'No quedan folios de tipo 39 cargados'),
      );

      const r = await emitir();

      expect(r).toEqual({
        estado: 'sin_emitir',
        codigo: 'SIN_FOLIOS',
        mensaje: 'No quedan folios de tipo 39 cargados',
      });
      expect(control()).toEqual([
        'SAVEPOINT emision_boleta',
        'ROLLBACK TO SAVEPOINT emision_boleta',
      ]);
      // Escribir antes de volver lo deshace el rollback (y una sentencia fallida dejaría la
      // transacción abortada): la marca va después.
      const orden = sqls();
      expect(
        orden.findIndex((s) => s.includes("= 'sin_emitir'")),
      ).toBeGreaterThan(orden.findIndex((s) => s.startsWith('ROLLBACK')));
      expect(sinEmitirEscrito()?.params).toEqual([
        DOC_ID,
        TENANT,
        'SIN_FOLIOS',
        'No quedan folios de tipo 39 cargados',
      ]);
      expect(cola.encolar).not.toHaveBeenCalled();
    });

    it('la marca no pisa un documento que otra emisión ya dejó emitido', async () => {
      folios.tomarFolio.mockRejectedValue(new DteError('SIN_FOLIOS', 'x'));

      await emitir();

      expect(sinEmitirEscrito()?.sql).toContain(
        "estado_envio IN ('armado', 'sin_emitir')",
      );
    });

    it('un rechazo del motor (el dato de esta boleta) también cae en sin_emitir', async () => {
      emitirBoletaMock.mockImplementation(() => {
        throw new DteError('TOTALES_NO_CIERRAN', 'Los totales no cierran');
      });

      const r = await emitir();

      expect(r).toMatchObject({
        estado: 'sin_emitir',
        codigo: 'TOTALES_NO_CIERRAN',
      });
      expect(cola.encolar).not.toHaveBeenCalled();
      expect(control().at(-1)).toBe('ROLLBACK TO SAVEPOINT emision_boleta');
    });

    it('una línea sin nombre (la rechaza el armado, no el motor) cae en sin_emitir', async () => {
      lecturas.lineas = [{ ...lecturas.lineas[0], descripcion: null }];

      const r = await emitir();

      expect(r).toMatchObject({
        estado: 'sin_emitir',
        codigo: 'LINEA_SIN_NOMBRE',
      });
    });

    it('sin el proveedor de software queda sin emitir con PERFIL_INCOMPLETO', async () => {
      perfil.proveedorSoftware.mockReturnValue(null);

      const r = await emitir();

      expect(r).toMatchObject({
        estado: 'sin_emitir',
        codigo: 'PERFIL_INCOMPLETO',
      });
      expect(emitirBoletaMock).not.toHaveBeenCalled();
    });
  });

  it('un error que NO es un DteError se propaga: la venta se cae y no se marca nada', async () => {
    cola.encolar.mockRejectedValue(new Error('se cayó la base'));

    await expect(emitir()).rejects.toThrow('se cayó la base');

    expect(control()).toEqual([
      'SAVEPOINT emision_boleta',
      'ROLLBACK TO SAVEPOINT emision_boleta',
    ]);
    expect(sinEmitirEscrito()).toBeUndefined();
  });

  describe('lo que ya no está por emitir se omite sin tocar nada', () => {
    const omitido = async () => {
      const r = await emitir();
      expect(r).toEqual({ estado: 'omitido' });
      expect(folios.tomarFolio).not.toHaveBeenCalled();
      expect(cola.encolar).not.toHaveBeenCalled();
      expect(sentencias.some((s) => /^\s*UPDATE/.test(s.sql))).toBe(false);
      expect(control()).toEqual([
        'SAVEPOINT emision_boleta',
        'RELEASE SAVEPOINT emision_boleta',
      ]);
    };

    it('ya emitido', async () => {
      doc0 = { ...doc0!, estado_envio: 'emitido' };
      await omitido();
    });

    it('descartado (la venta se anuló)', async () => {
      doc0 = { ...doc0!, descarte: 'armado_sin_enviar' };
      await omitido();
    });

    it('borrado o de otro tenant (la lectura no lo encuentra)', async () => {
      doc0 = null;
      await omitido();
    });

    it('un documento de la máquina (no tiene estado de emisión)', async () => {
      doc0 = { ...doc0!, emisor: 'maquina', estado_envio: null as never };
      await omitido();
    });
  });

  describe('si el contexto del documento no se encuentra es un bug, no un omitido', () => {
    // El documento SÍ está por emitir (armado): que falte la venta, el país o el tipo, o que no
    // sea una boleta del sistema, no es "ya no está por emitir". Un `Error` común (no `DteError`):
    // no es un dato de la boleta que el local pueda arreglar, y tumba la transacción.
    const tira = async (mensaje: string) => {
      await expect(emitir()).rejects.toThrow(mensaje);
      expect(folios.tomarFolio).not.toHaveBeenCalled();
      expect(cola.encolar).not.toHaveBeenCalled();
      // Se propaga: no se marca sin_emitir y la transacción vuelve al savepoint.
      expect(sinEmitirEscrito()).toBeUndefined();
      expect(control()).toEqual([
        'SAVEPOINT emision_boleta',
        'ROLLBACK TO SAVEPOINT emision_boleta',
      ]);
    };

    it('la venta no se encuentra', async () => {
      doc0 = { ...doc0!, venta_id: null, creado_el: null as never };
      await tira('No se encontró la venta');
    });

    it('el comercio o su país no se encuentran', async () => {
      doc0 = { ...doc0!, pais_id: null };
      await tira('No se encontró la venta, el comercio o el país');
    });

    it('el tipo de documento no existe (es_boleta nulo)', async () => {
      doc0 = { ...doc0!, es_boleta: null };
      await tira('tipo de documento que no existe');
    });

    it('una factura del sistema que llega a emitir como boleta', async () => {
      doc0 = { ...doc0!, es_boleta: false };
      await tira('no es una boleta del sistema');
    });

    it('el error no es un DteError (no se confunde con un dato de la boleta)', async () => {
      doc0 = { ...doc0!, pais_id: null };
      await expect(emitir()).rejects.not.toBeInstanceOf(DteError);
    });

    it('la consulta deja todo lo que cuelga del documento en LEFT JOIN y no filtra la baja del tipo, con el porqué', async () => {
      await emitir();
      const lectura = sqls()[1];
      expect(lectura).toMatch(/LEFT JOIN ventas v/);
      expect(lectura).toMatch(/LEFT JOIN pais p/);
      expect(lectura).toMatch(/LEFT JOIN tipos_documento_tributario td/);
      expect(lectura).not.toMatch(/td\.eliminado_el/);
      expect(lectura).toContain('Sin filtro de baja en el tipo');
    });
  });

  it('un documento sin_emitir se vuelve a intentar y, si sale, queda emitido', async () => {
    doc0 = { ...doc0!, estado_envio: 'sin_emitir' };

    const r = await emitir();

    expect(r).toEqual({ estado: 'emitido', folio: 1234, tipo: 39 });
  });

  it('todo exento sale como boleta exenta (41)', async () => {
    lecturas.lineas = [
      {
        ...lecturas.lineas[0],
        subtotal: '5950.0000',
        exenta: true,
        tasa_iva: '0',
      },
    ];
    doc0 = {
      ...doc0!,
      monto_afecto: '0.0000',
      monto_exento: '5950.0000',
      monto_impuestos: '0.0000',
    };

    const r = await emitir();

    expect(r).toMatchObject({ estado: 'emitido', tipo: 41 });
    expect(folios.tomarFolio).toHaveBeenCalledWith(TENANT, 41);
  });
});
