import { Test } from '@nestjs/testing';
import { DataSource, type EntityManager } from 'typeorm';
import { Db } from '../../common/db/db.service';
import { TxContext } from '../../common/db/tx-context';
import { ColaDteService } from '../dte/cola-dte.service';
import { type CodigoDteError, DteError } from '../dte/dte.types';
import { emitirBoleta } from '../dte/envio-boleta';
import { FoliosService } from '../dte/folios.service';
import {
  COND_ATRASADA,
  COND_CON_REPAROS,
  COND_RECHAZADA,
} from '../dte/problemas-sii';
import { PerfilFiscalService } from '../dte/perfil-fiscal.service';
import type { VentaDocumento } from './entities/venta-documento.entity';
import {
  EmisionBoletaService,
  type ResultadoEmision,
} from './emision-boleta.service';

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
        mensaje:
          'Falta el proveedor de software en la configuración del sistema: avisa a soporte',
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

describe('EmisionBoletaService: emitir después (spec § 5, § 8.1)', () => {
  // Db + TxContext de verdad sobre un manager que anota cada sentencia; `emitir` se espía: acá
  // se prueba lo que rodea a cada boleta (el orden, el bloqueo de la venta, el corte), no el motor.
  const sentencias: { sql: string; params?: unknown[]; enTx: boolean }[] = [];
  let enTransaccion = false;
  let filas: (sql: string) => unknown[];
  const consulta = (sql: string, params?: unknown[]) => {
    sentencias.push({ sql, params, enTx: enTransaccion });
    return Promise.resolve(filas(sql));
  };
  const manager = { query: jest.fn(consulta) } as unknown as EntityManager;
  const dataSource = {
    query: jest.fn(consulta),
    transaction: jest.fn(async (cb: (m: EntityManager) => Promise<unknown>) => {
      enTransaccion = true;
      try {
        return await cb(manager);
      } finally {
        enTransaccion = false;
      }
    }),
  } as unknown as DataSource;
  const perfil = { obtener: jest.fn() };

  let servicio: EmisionBoletaService;
  const AHORA = new Date('2027-01-05T15:00:00Z');

  const pendiente = (n: number) => ({
    documento_id: `doc-${n.toString()}`,
    venta_id: `venta-${n.toString()}`,
    monto: '5000.0000',
    fecha: new Date('2027-01-04T15:00:00Z'),
    emision_error_codigo: 'SIN_FOLIOS',
    emision_error: 'No quedan folios de tipo 39',
  });
  let lista: ReturnType<typeof pendiente>[];
  let quedan: number;
  let conProblemas: number;
  let problemas: Record<'atrasadas' | 'rechazadas' | 'conReparos', unknown[]>;
  let emisionPrendida: boolean;
  let ventaExiste: (ventaId: string) => boolean;

  beforeEach(async () => {
    sentencias.length = 0;
    jest.clearAllMocks();
    lista = [1, 2, 3].map(pendiente);
    quedan = 0;
    conProblemas = 0;
    problemas = { atrasadas: [], rechazadas: [], conReparos: [] };
    emisionPrendida = true;
    ventaExiste = () => true;
    filas = (sql) => {
      if (sql.includes('FROM ventas') && sql.includes('FOR UPDATE')) {
        const ventaId = sentencias.at(-1)?.params?.[0] as string;
        return ventaExiste(ventaId) ? [{ venta_id: ventaId }] : [];
      }
      if (sql.includes('FROM tenants')) return [{ emite: emisionPrendida }];
      // El conteo del cajero: los dos números en una sola fila.
      if (sql.includes('con_problemas'))
        return [{ sin_emitir: quedan, con_problemas: conProblemas }];
      if (sql.includes('count(*)')) return [{ n: quedan }];
      // Las tres listas de boletas con problemas: cada una se reconoce por su condición.
      if (sql.includes('FROM dte_documentos d')) {
        if (sql.includes(COND_ATRASADA)) return problemas.atrasadas;
        if (sql.includes(COND_RECHAZADA)) return problemas.rechazadas;
        if (sql.includes(COND_CON_REPAROS)) return problemas.conReparos;
      }
      if (sql.includes('FROM venta_documentos d')) return lista;
      return [];
    };
    const modulo = await Test.createTestingModule({
      providers: [
        TxContext,
        Db,
        EmisionBoletaService,
        { provide: DataSource, useValue: dataSource },
        { provide: FoliosService, useValue: {} },
        { provide: ColaDteService, useValue: {} },
        { provide: PerfilFiscalService, useValue: perfil },
      ],
    }).compile();
    servicio = modulo.get(EmisionBoletaService);
  });

  const emitidaCon = (folio: number): ResultadoEmision => ({
    estado: 'emitido',
    folio,
    tipo: 39,
  });
  const sinEmitirCon = (codigo: CodigoDteError): ResultadoEmision => ({
    estado: 'sin_emitir',
    codigo,
    mensaje: `falló ${codigo}`,
  });

  describe('emitirPendientes', () => {
    it('emite cada pendiente, cuenta las que salieron y dice cuántas quedan', async () => {
      const emitir = jest
        .spyOn(servicio, 'emitir')
        .mockResolvedValueOnce(emitidaCon(1))
        .mockResolvedValueOnce(emitidaCon(2))
        .mockResolvedValueOnce(emitidaCon(3));

      const r = await servicio.emitirPendientes(TENANT, AHORA);

      expect(r).toEqual({ emitidas: 3, pendientes: 0, errores: [] });
      expect(emitir.mock.calls.map((c) => c[1])).toEqual([
        'doc-1',
        'doc-2',
        'doc-3',
      ]);
      expect(emitir).toHaveBeenCalledWith(TENANT, 'doc-1', AHORA);
    });

    it('cada boleta va en SU transacción y bloquea su venta antes de emitir', async () => {
      const antes: string[][] = [];
      jest.spyOn(servicio, 'emitir').mockImplementation(() => {
        // Lo que ya se ejecutó en la transacción de esta boleta cuando `emitir` arranca.
        antes.push(
          sentencias.filter((s) => s.enTx).map((s) => s.params?.[0] as string),
        );
        return Promise.resolve(emitidaCon(1));
      });

      await servicio.emitirPendientes(TENANT, AHORA);

      expect(dataSource.transaction).toHaveBeenCalledTimes(3);
      const locks = sentencias.filter((s) => s.sql.includes('FOR UPDATE'));
      expect(locks.map((s) => s.params)).toEqual([
        ['venta-1', TENANT],
        ['venta-2', TENANT],
        ['venta-3', TENANT],
      ]);
      expect(locks.every((s) => s.enTx)).toBe(true);
      expect(locks[0].sql).toMatch(/eliminado_el IS NULL/);
      // Al llegar a `emitir`, el bloqueo de su venta ya se tomó.
      expect(antes[0]).toContain('venta-1');
      expect(antes[1]).toContain('venta-2');
    });

    it('la lista sale de UNA consulta, del más viejo al más nuevo, con tope de 200 y del tenant', async () => {
      jest.spyOn(servicio, 'emitir').mockResolvedValue(emitidaCon(1));

      await servicio.emitirPendientes(TENANT, AHORA);

      const lecturas = sentencias.filter(
        (s) => !s.enTx && s.sql.includes('FROM venta_documentos d'),
      );
      // La lista y el conteo de lo que queda: dos lecturas en total, no una por boleta.
      expect(lecturas).toHaveLength(2);
      const [leer] = lecturas;
      expect(leer.sql).toMatch(/ORDER BY d\.creado_el, d\.documento_id/);
      expect(leer.sql).toMatch(/LIMIT 200/);
      expect(leer.sql).toMatch(/d\.eliminado_el IS NULL/);
      expect(leer.sql).toMatch(/d\.descarte IS NULL/);
      expect(leer.params).toEqual([TENANT]);
    });

    it('SIN_FOLIOS NO corta: los folios son por tipo y la siguiente puede ser de otro', async () => {
      const emitir = jest
        .spyOn(servicio, 'emitir')
        .mockResolvedValue(sinEmitirCon('SIN_FOLIOS'));
      quedan = 3;

      const r = await servicio.emitirPendientes(TENANT, AHORA);

      expect(emitir).toHaveBeenCalledTimes(3);
      expect(r).toEqual({
        emitidas: 0,
        pendientes: 3,
        errores: [1, 2, 3].map((n) => ({
          ventaId: `venta-${n.toString()}`,
          codigo: 'SIN_FOLIOS',
          mensaje: 'falló SIN_FOLIOS',
        })),
      });
    });

    it.each([
      'SIN_CERTIFICADO',
      'CERTIFICADO_VENCIDO',
      'PERFIL_INCOMPLETO',
      'AMBIENTE_DISTINTO',
    ] as const)('%s corta: las que siguen fallarían igual', async (codigo) => {
      const emitir = jest
        .spyOn(servicio, 'emitir')
        .mockResolvedValue(sinEmitirCon(codigo));

      await servicio.emitirPendientes(TENANT, AHORA);

      expect(emitir).toHaveBeenCalledTimes(1);
    });

    it('un error de ESA boleta (un impuesto adicional) anota el error y sigue con las demás', async () => {
      const emitir = jest
        .spyOn(servicio, 'emitir')
        .mockResolvedValueOnce(sinEmitirCon('IMPUESTO_ADICIONAL_NO_SOPORTADO'))
        .mockResolvedValueOnce(emitidaCon(2))
        .mockResolvedValueOnce(emitidaCon(3));
      quedan = 1;

      const r = await servicio.emitirPendientes(TENANT, AHORA);

      expect(emitir).toHaveBeenCalledTimes(3);
      expect(r.emitidas).toBe(2);
      expect(r.pendientes).toBe(1);
      expect(r.errores).toEqual([
        {
          ventaId: 'venta-1',
          codigo: 'IMPUESTO_ADICIONAL_NO_SOPORTADO',
          mensaje: 'falló IMPUESTO_ADICIONAL_NO_SOPORTADO',
        },
      ]);
    });

    it('una boleta omitida (ya emitida o anulada) no suma ni es un error', async () => {
      jest
        .spyOn(servicio, 'emitir')
        .mockResolvedValueOnce({ estado: 'omitido' })
        .mockResolvedValueOnce(emitidaCon(2))
        .mockResolvedValueOnce({ estado: 'omitido' });

      const r = await servicio.emitirPendientes(TENANT, AHORA);

      expect(r).toEqual({ emitidas: 1, pendientes: 0, errores: [] });
    });

    it('una venta que ya no está (borrada entre la lista y el bloqueo) se salta sin emitir', async () => {
      ventaExiste = (id) => id !== 'venta-2';
      const emitir = jest
        .spyOn(servicio, 'emitir')
        .mockResolvedValue(emitidaCon(1));

      const r = await servicio.emitirPendientes(TENANT, AHORA);

      expect(emitir.mock.calls.map((c) => c[1])).toEqual(['doc-1', 'doc-3']);
      expect(r.emitidas).toBe(2);
    });

    it('un error que no es de la emisión se propaga: no se traga en una lista de errores', async () => {
      jest.spyOn(servicio, 'emitir').mockRejectedValue(new Error('se cayó'));

      await expect(servicio.emitirPendientes(TENANT, AHORA)).rejects.toThrow(
        'se cayó',
      );
    });

    it('sin pendientes no hace nada más que leer', async () => {
      lista = [];
      const emitir = jest.spyOn(servicio, 'emitir');

      const r = await servicio.emitirPendientes(TENANT, AHORA);

      expect(r).toEqual({ emitidas: 0, pendientes: 0, errores: [] });
      expect(emitir).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('sinEmitir', () => {
    it('una consulta, con el grupo de cada error', async () => {
      lista = [
        pendiente(1),
        {
          ...pendiente(2),
          emision_error_codigo: 'IMPUESTO_ADICIONAL_NO_SOPORTADO',
          emision_error: 'lleva un impuesto adicional',
        },
      ];

      const r = await servicio.sinEmitir(TENANT);

      expect(sentencias).toHaveLength(1);
      expect(r).toEqual([
        {
          ventaId: 'venta-1',
          fecha: new Date('2027-01-04T15:00:00Z'),
          monto: '5000.0000',
          codigo: 'SIN_FOLIOS',
          mensaje: 'No quedan folios de tipo 39',
          grupo: 'perfil',
        },
        {
          ventaId: 'venta-2',
          fecha: new Date('2027-01-04T15:00:00Z'),
          monto: '5000.0000',
          codigo: 'IMPUESTO_ADICIONAL_NO_SOPORTADO',
          mensaje: 'lleva un impuesto adicional',
          grupo: 'boleta',
        },
      ]);
    });
  });

  describe('estadoEmision', () => {
    it('con la emisión apagada lee solo el interruptor: ni arma el perfil ni cuenta', async () => {
      emisionPrendida = false;
      perfil.obtener.mockResolvedValue({
        emisionActiva: false,
        avisos: [{ codigo: 'POCOS_FOLIOS', mensaje: 'Quedan 40 folios' }],
      });

      const r = await servicio.estadoEmision(TENANT, AHORA);

      expect(r).toEqual({
        activa: false,
        avisos: [],
        sinEmitir: 0,
        conProblemas: 0,
      });
      expect(perfil.obtener).not.toHaveBeenCalled();
      expect(sentencias).toHaveLength(1);
      expect(sentencias[0].sql).toMatch(/FROM tenants/);
      expect(sentencias[0].sql).toMatch(/eliminado_el IS NULL/);
      expect(sentencias[0].params).toEqual([TENANT]);
    });

    it('prendida: los avisos del perfil y cuántas boletas siguen sin emitir', async () => {
      perfil.obtener.mockResolvedValue({
        emisionActiva: true,
        faltantes: [{ codigo: 'SIN_GIRO', mensaje: 'no debe salir' }],
        emisor: { rut: '76543210-3' },
        avisos: [{ codigo: 'POCOS_FOLIOS', mensaje: 'Quedan 40 folios' }],
      });
      quedan = 4;
      conProblemas = 2;

      const r = await servicio.estadoEmision(TENANT, AHORA);

      expect(r).toEqual({
        activa: true,
        avisos: [{ codigo: 'POCOS_FOLIOS', mensaje: 'Quedan 40 folios' }],
        sinEmitir: 4,
        conProblemas: 2,
      });
      // El interruptor y UNA consulta con los dos números; las del perfil las hace `obtener`.
      expect(sentencias).toHaveLength(2);
      expect(sentencias[1].sql).toMatch(/sin_emitir/);
      expect(sentencias[1].sql).toMatch(/con_problemas/);
      expect(sentencias[1].params).toEqual([TENANT]);
      expect(perfil.obtener).toHaveBeenCalledWith(TENANT, AHORA);
    });
  });

  describe('boletasConProblemas', () => {
    const EMITIDA = new Date('2027-01-05T12:00:00Z');
    const fila = (n: number, over: Record<string, unknown> = {}) => ({
      documento_id: `dte-${n.toString()}`,
      venta_id: `venta-${n.toString()}`,
      tipo: 39,
      folio: 5000 + n,
      emitido_el: EMITIDA,
      monto: '5000.0000',
      detalle_sii: null,
      ultimo_error: null,
      ...over,
    });

    it('tres consultas, una por grupo, todas del tenant y sin borrados', async () => {
      await servicio.boletasConProblemas(TENANT);

      expect(sentencias).toHaveLength(3);
      for (const s of sentencias) {
        expect(s.params).toEqual([TENANT]);
        expect(s.sql).toMatch(/d\.tenant_id = \$1/);
        expect(s.sql).toMatch(
          /WHERE d\.tenant_id = \$1 AND d\.eliminado_el IS NULL/,
        );
        expect(s.sql).toMatch(/vd\.eliminado_el IS NULL/);
        expect(s.sql).toMatch(/v\.eliminado_el IS NULL/);
        expect(s.sql).toMatch(/LIMIT 200/);
      }
      // Atrasadas y rechazadas, de la más vieja a la más nueva; con reparos, la más nueva primero.
      expect(sentencias[0].sql).toContain(COND_ATRASADA);
      expect(sentencias[0].sql).toMatch(/ORDER BY d\.emitido_el ASC/);
      expect(sentencias[1].sql).toContain(COND_RECHAZADA);
      expect(sentencias[1].sql).toMatch(/ORDER BY d\.emitido_el ASC/);
      expect(sentencias[2].sql).toContain(COND_CON_REPAROS);
      expect(sentencias[2].sql).toMatch(/ORDER BY d\.emitido_el DESC/);
    });

    it('arma cada grupo con su motivo y deja el monto como string', async () => {
      problemas.atrasadas = [fila(1, { ultimo_error: 'El SII no contesta' })];
      problemas.rechazadas = [
        fila(2, { detalle_sii: { origen: 'sobre', estado: 'RSC' } }),
      ];
      problemas.conReparos = [
        fila(3, {
          tipo: 41,
          monto: '3000.0000',
          detalle_sii: {
            estado: 'RLV',
            error: [{ descripcion: 'Fecha atrasada' }],
          },
        }),
      ];

      const r = await servicio.boletasConProblemas(TENANT);

      expect(r).toEqual({
        atrasadas: [
          {
            documentoId: 'dte-1',
            ventaId: 'venta-1',
            tipo: 39,
            folio: 5001,
            emitidaEl: EMITIDA,
            monto: '5000.0000',
            motivo: 'El SII no contesta',
          },
        ],
        rechazadas: [
          {
            documentoId: 'dte-2',
            ventaId: 'venta-2',
            tipo: 39,
            folio: 5002,
            emitidaEl: EMITIDA,
            monto: '5000.0000',
            motivo: 'Error del sistema al enviarla al SII.',
          },
        ],
        conReparos: [
          {
            documentoId: 'dte-3',
            ventaId: 'venta-3',
            tipo: 41,
            folio: 5003,
            emitidaEl: EMITIDA,
            monto: '3000.0000',
            motivo: 'El SII avisa: Fecha atrasada.',
          },
        ],
      });
    });

    it('una boleta sin documento de venta se muestra igual, con ventaId y monto en null', async () => {
      problemas.rechazadas = [
        fila(1, {
          venta_id: null,
          monto: null,
          detalle_sii: { origen: 'envio', mensaje: 'x' },
        }),
      ];

      const r = await servicio.boletasConProblemas(TENANT);

      expect(r.rechazadas).toHaveLength(1);
      expect(r.rechazadas[0]).toMatchObject({
        documentoId: 'dte-1',
        ventaId: null,
        monto: null,
      });
    });
  });
});
