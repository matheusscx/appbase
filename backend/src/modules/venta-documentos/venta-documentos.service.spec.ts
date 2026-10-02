import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import type { EntityManager } from 'typeorm';
import type { ConfigCalculo } from '../calculo-precios/calculo-precios.engine';
import type { PorcionOriginal } from '../ventas/nota-credito-composicion';
import {
  VentaDocumentosService,
  componerBaldes,
  type AbonoParaDuplicado,
  type DocumentarVentaParams,
  type PagoParaDocumento,
} from './venta-documentos.service';
import type { VentaDocumento } from './entities/venta-documento.entity';

// CLP: sin decimales, para que el residuo de cuantizar se vea en pesos enteros.
const CFG: ConfigCalculo = {
  formula: ['descuentos', 'recargos', 'impuestos'],
  calculoDescuentos: 'base',
  calculoRecargos: 'base',
  escalaCalculo: 4,
  modoRedondeo: 'HALF_UP',
  nivelRedondeo: 'linea',
  decimalesMoneda: 0,
  promosAcumulanDescuentos: false,
};

// Venta de $100.000: afecto 71.400 (neto 60.000 + IVA 11.400) y exento 28.600.
const PORCIONES: PorcionOriginal[] = [
  { clasificacion: 'afecto', total: '71400', impuesto: '11400' },
  { clasificacion: 'exento', total: '28600', impuesto: '0' },
];

const TENANT = 'tenant-1';
const VENTA = 'venta-1';
const BOLETA = 'tipo-boleta';
const FACTURA = 'tipo-factura';

function pago(
  id: string,
  emisor: PagoParaDocumento['emisor'],
  aplicadoVenta: number,
  extra: Partial<PagoParaDocumento> = {},
): PagoParaDocumento {
  return {
    pagoId: `pago-${id}`,
    metodoPagoId: `metodo-${id}`,
    emisor,
    aplicadoVenta: aplicadoVenta.toFixed(4),
    ...extra,
  };
}

function params(
  over: Partial<Omit<DocumentarVentaParams, 'venta'>> & {
    venta?: Partial<DocumentarVentaParams['venta']>;
  } = {},
): DocumentarVentaParams {
  const { venta, ...resto } = over;
  return {
    tenantId: TENANT,
    venta: {
      id: VENTA,
      tipoDocumentoId: BOLETA,
      esBoleta: true,
      canal: 'fisico',
      totalFinal: '100000.0000',
      configCalculo: CFG,
      ...venta,
    },
    facturador: 'sistema',
    porciones: PORCIONES,
    pagos: [],
    ...resto,
  };
}

function managerFalso() {
  // Como TypeORM, `save` devuelve las filas con su id: el enlace de cada pago
  // a su documento lo necesita.
  const save = jest.fn(
    (
      _entidad: unknown,
      filas: Record<string, unknown> | Record<string, unknown>[],
    ) =>
      Promise.resolve(
        Array.isArray(filas)
          ? filas.map((f, i) => ({ id: `doc-${i + 1}`, ...f }))
          : { id: 'doc-1', ...filas },
      ),
  );
  // El `UPDATE pagos` que enlaza cada pago a su documento.
  const query = jest.fn().mockResolvedValue([]);
  const create = jest.fn(
    (_entidad: unknown, datos: Record<string, unknown>) => ({
      ...datos,
    }),
  );
  return {
    save,
    create,
    queryEnlace: query,
    manager: { save, create, query } as unknown as EntityManager,
  };
}

async function documentar(p: DocumentarVentaParams) {
  const m = managerFalso();
  const docs = await new VentaDocumentosService().documentarVenta(m.manager, p);
  return { docs, ...m };
}

/** Invariante de la cobertura: lo que no es duplicado suma el total de la venta. */
function sumaDeLaCobertura(docs: VentaDocumento[]): string {
  return docs
    .filter((d) => !d.esDuplicado)
    .reduce((a, d) => a.plus(d.monto), new Decimal(0))
    .toFixed(4);
}

describe('componerBaldes', () => {
  it('con el total de la venta reproduce sus baldes exactos', () => {
    const b = componerBaldes(new Decimal(100000), PORCIONES, CFG);
    expect(b.montoAfecto.toString()).toBe('60000');
    expect(b.montoExento.toString()).toBe('28600');
    expect(b.montoImpuestos.toString()).toBe('11400');
  });

  it('con una parte, reparte a prorrata de las porciones y cierra exacto', () => {
    // 40.000 de 100.000: 28.560 afecto (neto 24.000 + IVA 4.560) y 11.440 exento.
    const b = componerBaldes(new Decimal(40000), PORCIONES, CFG);
    expect(b.montoAfecto.toString()).toBe('24000');
    expect(b.montoExento.toString()).toBe('11440');
    expect(b.montoImpuestos.toString()).toBe('4560');
    expect(
      b.montoAfecto.plus(b.montoExento).plus(b.montoImpuestos).toString(),
    ).toBe('40000');
  });

  it('el orden de las porciones no cambia el reparto (desempate por clasificación)', () => {
    const alReves = [...PORCIONES].reverse();
    // 250: las dos porciones quedan con el mismo resto (178,5 y 71,5), se
    // redondean las dos para arriba y el residuo de -1 lo decide el desempate.
    const a = componerBaldes(new Decimal(250), PORCIONES, CFG);
    const b = componerBaldes(new Decimal(250), alReves, CFG);
    expect(b.montoAfecto.toString()).toBe(a.montoAfecto.toString());
    expect(b.montoExento.toString()).toBe(a.montoExento.toString());
    expect(b.montoImpuestos.toString()).toBe(a.montoImpuestos.toString());
  });

  it('una venta solo exenta no genera impuesto', () => {
    const b = componerBaldes(
      new Decimal(7000),
      [{ clasificacion: 'exento', total: '28600', impuesto: '0' }],
      CFG,
    );
    expect(b.montoAfecto.toString()).toBe('0');
    expect(b.montoExento.toString()).toBe('7000');
    expect(b.montoImpuestos.toString()).toBe('0');
  });

  it('una clasificación desconocida lanza: no se descarta en silencio', () => {
    expect(() =>
      componerBaldes(
        new Decimal(1000),
        [{ clasificacion: 'otra', total: '1000', impuesto: '0' }],
        CFG,
      ),
    ).toThrow(/otra/);
  });

  it('sin config congelada usa el fallback y no lanza', () => {
    const b = componerBaldes(new Decimal(100000), PORCIONES, null);
    expect(
      b.montoAfecto.plus(b.montoExento).plus(b.montoImpuestos).toString(),
    ).toBe('100000');
  });
});

describe('VentaDocumentosService.documentarVenta', () => {
  it('una venta de $0 no lleva documento (E6)', async () => {
    const { docs, save } = await documentar(
      params({ venta: { totalFinal: '0.0000' } }),
    );
    expect(docs).toEqual([]);
    expect(save).not.toHaveBeenCalled();
  });

  it('una venta sin tipo de documento (país sin boleta) no lleva documento', async () => {
    const { docs, save } = await documentar(
      params({
        venta: { tipoDocumentoId: null, esBoleta: false },
        pagos: [pago('a', 'sistema', 100000)],
      }),
    );
    expect(docs).toEqual([]);
    expect(save).not.toHaveBeenCalled();
  });

  it('el $0 vale también para una factura (de cualquiera de los dos facturadores)', async () => {
    for (const facturador of ['sistema', 'externo'] as const) {
      const { docs } = await documentar(
        params({
          venta: {
            totalFinal: '0.0000',
            tipoDocumentoId: FACTURA,
            esBoleta: false,
          },
          facturador,
        }),
      );
      expect(docs).toEqual([]);
    }
  });

  it('el $0 gana sobre el canal online', async () => {
    const { docs } = await documentar(
      params({ venta: { canal: 'online', totalFinal: '0.0000' } }),
    );
    expect(docs).toEqual([]);
  });

  describe('online (E5)', () => {
    it('un sistema/armado por el total, sin mirar el medio ni el facturador', async () => {
      const { docs } = await documentar(
        params({
          venta: { canal: 'online' },
          facturador: 'externo',
          pagos: [pago('cr', 'maquina', 100000)],
        }),
      );
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        tenantId: TENANT,
        ventaId: VENTA,
        emisor: 'sistema',
        tipoDocumentoId: BOLETA,
        estadoEnvio: 'armado',
        monto: '100000.0000',
        montoAfecto: '60000.0000',
        montoExento: '28600.0000',
        montoImpuestos: '11400.0000',
        pagoId: null,
        esDuplicado: false,
      });
    });
  });

  describe('factura (E2)', () => {
    const factura = { tipoDocumentoId: FACTURA, esBoleta: false };

    it('facturador sistema: un solo documento del sistema, aunque se pague con la máquina', async () => {
      const { docs } = await documentar(
        params({
          venta: factura,
          pagos: [pago('t', 'maquina', 100000, { numeroDocumento: '777' })],
        }),
      );
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        emisor: 'sistema',
        tipoDocumentoId: FACTURA,
        estadoEnvio: 'armado',
        monto: '100000.0000',
        pagoId: null,
        numero: null,
      });
    });

    it('facturador sistema: un pendiente sin pagos también lleva su factura', async () => {
      const { docs } = await documentar(params({ venta: factura }));
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        emisor: 'sistema',
        monto: '100000.0000',
      });
    });

    it('facturador externo: un solo documento externo con el tipo factura y sin número', async () => {
      const { docs } = await documentar(
        params({
          venta: factura,
          facturador: 'externo',
          pagos: [pago('t', 'maquina', 100000)],
        }),
      );
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        emisor: 'externo',
        tipoDocumentoId: FACTURA,
        numero: null,
        estadoEnvio: null,
        monto: '100000.0000',
        montoAfecto: '60000.0000',
        montoExento: '28600.0000',
        montoImpuestos: '11400.0000',
        pagoId: null,
      });
    });
  });

  describe('boleta (E1, E2)', () => {
    it('efectivo del sistema + débito de la máquina: boleta por lo uno y voucher por lo otro', async () => {
      const { docs } = await documentar(
        params({
          pagos: [
            pago('ef', 'sistema', 60000),
            pago('db', 'maquina', 40000, {
              numeroDocumento: '445566',
              claseDocumento: 'voucher',
            }),
          ],
        }),
      );
      expect(docs).toHaveLength(2);
      const sistema = docs.find((d) => d.emisor === 'sistema')!;
      const maquina = docs.find((d) => d.emisor === 'maquina')!;
      expect(sistema).toMatchObject({
        tipoDocumentoId: BOLETA,
        estadoEnvio: 'armado',
        monto: '60000.0000',
        pagoId: null,
      });
      expect(maquina).toMatchObject({
        pagoId: 'pago-db',
        numero: '445566',
        claseMaquina: 'voucher',
        monto: '40000.0000',
        tipoDocumentoId: null,
        estadoEnvio: null,
        montoAfecto: null,
        montoExento: null,
        montoImpuestos: null,
        esDuplicado: false,
      });
      expect(sumaDeLaCobertura(docs)).toBe('100000.0000');
    });

    it('los baldes del documento del sistema son los de su parte (prorrata)', async () => {
      const { docs } = await documentar(
        params({
          pagos: [pago('ef', 'sistema', 60000), pago('db', 'maquina', 40000)],
        }),
      );
      const s = docs.find((d) => d.emisor === 'sistema')!;
      // 60.000 de 100.000: 42.840 afecto (neto 36.000 + IVA 6.840) y 17.160 exento.
      expect(s.montoAfecto).toBe('36000.0000');
      expect(s.montoExento).toBe('17160.0000');
      expect(s.montoImpuestos).toBe('6840.0000');
    });

    it('la mesa que paga 40.000 con la máquina y debe 60.000 (sistema): voucher + boleta del sistema por lo debido', async () => {
      const { docs } = await documentar(
        params({ pagos: [pago('tj', 'maquina', 40000)] }),
      );
      expect(docs.map((d) => [d.emisor, d.monto])).toEqual([
        ['maquina', '40000.0000'],
        ['sistema', '60000.0000'],
      ]);
      expect(docs[1]).toMatchObject({
        tipoDocumentoId: BOLETA,
        estadoEnvio: 'armado',
      });
      expect(sumaDeLaCobertura(docs)).toBe('100000.0000');
    });

    it('la misma mesa con facturador externo: lo debido va en un externo con el tipo boleta y sin número', async () => {
      const { docs } = await documentar(
        params({
          facturador: 'externo',
          pagos: [pago('tj', 'maquina', 40000)],
        }),
      );
      expect(docs.map((d) => [d.emisor, d.monto])).toEqual([
        ['maquina', '40000.0000'],
        ['externo', '60000.0000'],
      ]);
      expect(docs[1]).toMatchObject({
        tipoDocumentoId: BOLETA,
        numero: null,
        estadoEnvio: null,
        montoAfecto: '36000.0000',
        montoExento: '17160.0000',
        montoImpuestos: '6840.0000',
      });
      expect(sumaDeLaCobertura(docs)).toBe('100000.0000');
    });

    it('boleta pendiente sin pagos: boleta del sistema por el total', async () => {
      const { docs } = await documentar(params());
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        emisor: 'sistema',
        monto: '100000.0000',
        estadoEnvio: 'armado',
      });
    });

    it('boleta pendiente sin pagos con facturador externo: un externo por el total', async () => {
      const { docs } = await documentar(params({ facturador: 'externo' }));
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        emisor: 'externo',
        tipoDocumentoId: BOLETA,
        monto: '100000.0000',
      });
    });

    it('con facturador sistema, lo no pagado se suma a la boleta de los pagos del sistema: UNA sola', async () => {
      const { docs } = await documentar(
        params({
          pagos: [
            pago('ef', 'sistema', 25000),
            pago('nd', 'nadie', 15000),
            pago('tj', 'maquina', 20000),
          ],
        }),
      );
      // debido: 100.000 − 60.000 = 40.000; sistema = 25.000 + 40.000.
      expect(docs.map((d) => [d.emisor, d.monto]).sort()).toEqual([
        ['maquina', '20000.0000'],
        ['nadie', '15000.0000'],
        ['sistema', '65000.0000'],
      ]);
      expect(sumaDeLaCobertura(docs)).toBe('100000.0000');
    });

    it('con facturador externo, la boleta del sistema cubre solo los pagos del sistema', async () => {
      const { docs } = await documentar(
        params({
          facturador: 'externo',
          pagos: [
            pago('ef', 'sistema', 25000),
            pago('nd', 'nadie', 15000),
            pago('tj', 'maquina', 20000),
          ],
        }),
      );
      expect(docs.map((d) => [d.emisor, d.monto]).sort()).toEqual([
        ['externo', '40000.0000'],
        ['maquina', '20000.0000'],
        ['nadie', '15000.0000'],
        ['sistema', '25000.0000'],
      ]);
      expect(sumaDeLaCobertura(docs)).toBe('100000.0000');
    });

    it('los pagos de la máquina dan un documento cada uno, con su pago', async () => {
      const { docs } = await documentar(
        params({
          pagos: [pago('t1', 'maquina', 30000), pago('t2', 'maquina', 70000)],
        }),
      );
      expect(docs.map((d) => [d.pagoId, d.monto])).toEqual([
        ['pago-t1', '30000.0000'],
        ['pago-t2', '70000.0000'],
      ]);
    });

    it('los pagos de "nadie" dan UNA fila por su suma, sin pago ni tipo', async () => {
      const { docs } = await documentar(
        params({
          pagos: [pago('n1', 'nadie', 30000), pago('n2', 'nadie', 70000)],
        }),
      );
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        emisor: 'nadie',
        monto: '100000.0000',
        pagoId: null,
        tipoDocumentoId: null,
        estadoEnvio: null,
        montoAfecto: null,
      });
    });

    it('un pago cuyo aplicado a la venta es 0 (todo fue propina) no da documento', async () => {
      const { docs } = await documentar(
        params({
          pagos: [pago('tj', 'maquina', 0), pago('ef', 'sistema', 100000)],
        }),
      );
      expect(docs.map((d) => [d.emisor, d.monto])).toEqual([
        ['sistema', '100000.0000'],
      ]);
    });

    it('el número y la clase solo viajan al documento de la máquina; sin número queda nulo', async () => {
      const { docs } = await documentar(
        params({
          pagos: [
            pago('ef', 'sistema', 60000, {
              numeroDocumento: '999',
              claseDocumento: 'boleta',
            }),
            pago('tj', 'maquina', 40000, { numeroDocumento: '' }),
          ],
        }),
      );
      const s = docs.find((d) => d.emisor === 'sistema')!;
      const m = docs.find((d) => d.emisor === 'maquina')!;
      expect(s.numero).toBeNull();
      expect(s.claseMaquina).toBeNull();
      expect(m.numero).toBeNull();
      expect(m.claseMaquina).toBeNull();
    });
  });

  it.each([
    ['online', params({ venta: { canal: 'online' } })],
    [
      'factura del sistema',
      params({ venta: { tipoDocumentoId: FACTURA, esBoleta: false } }),
    ],
    [
      'factura externa con pago',
      params({
        venta: { tipoDocumentoId: FACTURA, esBoleta: false },
        facturador: 'externo',
        pagos: [pago('t', 'maquina', 100000)],
      }),
    ],
    ['boleta sin pagos', params()],
    [
      'pago mixto con deuda (sistema)',
      params({
        pagos: [pago('a', 'sistema', 12345), pago('b', 'maquina', 33333)],
      }),
    ],
    [
      'pago mixto con deuda (externo)',
      params({
        facturador: 'externo',
        pagos: [pago('a', 'sistema', 12345), pago('b', 'nadie', 33333)],
      }),
    ],
    [
      'pagado entero, todo propina en un pago',
      params({
        pagos: [pago('a', 'maquina', 0), pago('b', 'maquina', 100000)],
      }),
    ],
  ])('la suma de los documentos es el total de la venta: %s', async (_n, p) => {
    const { docs } = await documentar(p);
    expect(sumaDeLaCobertura(docs)).toBe('100000.0000');
  });

  it('si lo aplicado supera el total de la venta lanza: un total fiscal falso es peor que un 500', async () => {
    const m = managerFalso();
    await expect(
      new VentaDocumentosService().documentarVenta(
        m.manager,
        params({ pagos: [pago('ef', 'sistema', 100001)] }),
      ),
    ).rejects.toThrow(InternalServerErrorException);
    await expect(
      new VentaDocumentosService().documentarVenta(
        m.manager,
        params({ pagos: [pago('ef', 'sistema', 100001)] }),
      ),
    ).rejects.toThrow(/supera su total/);
    expect(m.save).not.toHaveBeenCalled();
  });

  it('lo aplicado exactamente igual al total no lanza y no deja nada sin pagar', async () => {
    const { docs } = await documentar(
      params({ pagos: [pago('ef', 'sistema', 100000)] }),
    );
    expect(docs.map((d) => [d.emisor, d.monto])).toEqual([
      ['sistema', '100000.0000'],
    ]);
  });

  describe('baldes entre documentos de una misma venta', () => {
    // Venta de 58.712: afecto 47.601 (neto 40.001 + IVA 7.600) y exento 11.111.
    // Sus baldes salen de las porciones, no de `componerBaldes`.
    const AFECTO = '47601';
    const IVA = '7600';
    const EXENTO = '11111';
    const TOTAL = new Decimal(AFECTO).plus(EXENTO);
    const porciones: PorcionOriginal[] = [
      { clasificacion: 'afecto', total: AFECTO, impuesto: IVA },
      { clasificacion: 'exento', total: EXENTO, impuesto: '0' },
    ];
    const NETO_VENTA = new Decimal(AFECTO).minus(IVA); // 40.001
    const baldes = (docs: VentaDocumento[]) => ({
      afecto: docs.reduce((a, d) => a.plus(d.montoAfecto!), new Decimal(0)),
      exento: docs.reduce((a, d) => a.plus(d.montoExento!), new Decimal(0)),
      impuestos: docs.reduce(
        (a, d) => a.plus(d.montoImpuestos!),
        new Decimal(0),
      ),
    });

    it('cada documento cierra exacto y la suma de sus baldes difiere de los de la venta en una unidad, no en cero', async () => {
      // Boleta pagada 15.036 con el sistema y el resto sin pagar, con
      // facturador externo: dos documentos con baldes (sistema y externo).
      const { docs } = await documentar(
        params({
          venta: { totalFinal: TOTAL.toFixed(4) },
          porciones,
          facturador: 'externo',
          pagos: [pago('ef', 'sistema', 15036)],
        }),
      );
      expect(docs.map((d) => [d.emisor, d.monto])).toEqual([
        ['sistema', '15036.0000'],
        ['externo', '43676.0000'],
      ]);

      // (a) cada documento: afecto + exento + impuestos = monto, exacto.
      for (const d of docs) {
        expect(
          new Decimal(d.montoAfecto!)
            .plus(d.montoExento!)
            .plus(d.montoImpuestos!)
            .toFixed(4),
        ).toBe(d.monto);
      }

      // (c) el caso concreto donde la diferencia NO es cero: cada documento se
      // cuantiza por su cuenta, así que el neto afecto suma 40.000 (uno menos
      // que los 40.001 de la venta) y el exento 11.112 (uno más que los
      // 11.111). El IVA coincide.
      const suma = baldes(docs);
      expect(suma.afecto.toString()).toBe('40000');
      expect(suma.exento.toString()).toBe('11112');
      expect(suma.impuestos.toString()).toBe('7600');
      expect(suma.afecto.minus(NETO_VENTA).toString()).toBe('-1');
      expect(suma.exento.minus(EXENTO).toString()).toBe('1');
      // Y el total sigue cerrando: lo que baja en un balde sube en el otro.
      expect(
        suma.afecto.plus(suma.exento).plus(suma.impuestos).toString(),
      ).toBe(TOTAL.toString());
    });

    it('para CUALQUIER partición en dos documentos la diferencia con la venta es de a lo sumo 1 unidad por balde', () => {
      // (b) La cota está medida sobre esta venta, con las 58.711 particiones
      // posibles en dos documentos —lo máximo que `documentarVenta` produce
      // con baldes: uno del sistema y uno externo—. En la tarea 1 se midió
      // sobre 20.000 ventas partidas en 2 o 3 documentos un máximo de 2 en el
      // neto y 1 en el impuesto: es el residuo de cuantización de una serie de
      // NC (ADR-010), no un error de la prorrata.
      const COTA = 1;
      const venta = componerBaldes(TOTAL, porciones, CFG);
      expect(venta.montoAfecto.toString()).toBe(NETO_VENTA.toString());
      let hubo = 0;
      for (let m = 1; m < TOTAL.toNumber(); m++) {
        const a = componerBaldes(new Decimal(m), porciones, CFG);
        const b = componerBaldes(TOTAL.minus(m), porciones, CFG);
        const dAfecto = a.montoAfecto
          .plus(b.montoAfecto)
          .minus(venta.montoAfecto);
        const dExento = a.montoExento
          .plus(b.montoExento)
          .minus(venta.montoExento);
        const dImp = a.montoImpuestos
          .plus(b.montoImpuestos)
          .minus(venta.montoImpuestos);
        expect(dAfecto.abs().lte(COTA)).toBe(true);
        expect(dExento.abs().lte(COTA)).toBe(true);
        expect(dImp.abs().lte(COTA)).toBe(true);
        if (!dAfecto.isZero() || !dExento.isZero() || !dImp.isZero()) hubo++;
      }
      // El residuo existe: si algún día es cero en todas, la cota ya no mide nada.
      expect(hubo).toBeGreaterThan(0);
    });

    it('un voucher o una fila nadie no llevan baldes: la suma queda por debajo de la venta por porciones enteras', async () => {
      const { docs } = await documentar(
        params({
          venta: { totalFinal: TOTAL.toFixed(4) },
          porciones,
          pagos: [pago('tj', 'maquina', 20000), pago('nd', 'nadie', 10000)],
        }),
      );
      const conBaldes = docs.filter((d) => d.montoAfecto !== null);
      expect(conBaldes.map((d) => d.emisor)).toEqual(['sistema']);
      const suma = baldes(conBaldes);
      expect(
        suma.afecto.plus(suma.exento).plus(suma.impuestos).toString(),
      ).toBe('28712');
    });
  });

  it('inserta todos los documentos en un solo save del array (sin N+1)', async () => {
    const { save, docs } = await documentar(
      params({
        pagos: [
          pago('a', 'maquina', 20000),
          pago('b', 'maquina', 30000),
          pago('c', 'nadie', 10000),
        ],
      }),
    );
    expect(docs.length).toBeGreaterThan(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(Array.isArray(save.mock.calls[0][1])).toBe(true);
  });
});

/** Un manager con `query` además de `save`/`create`: lo que leen el abono y la anulación. */
function managerConLectura(filas: Record<string, unknown>[]) {
  const query = jest.fn().mockResolvedValue(filas);
  const base = managerFalso();
  return {
    ...base,
    query,
    manager: {
      save: base.save,
      create: base.create,
      query,
    } as unknown as EntityManager,
  };
}

describe('VentaDocumentosService.documentarVenta: cada pago queda enlazado a su documento', () => {
  /** Lo que se escribió: `[pagoId → documentoId]`, en el orden de los pagos. */
  async function enlaces(p: DocumentarVentaParams) {
    const r = await documentar(p);
    const llamadas = r.queryEnlace.mock.calls as [string, unknown[]][];
    if (!llamadas.length) return { r, llamadas, pares: [] as string[][] };
    const [, binds] = llamadas[0];
    const pagos = binds[0] as string[];
    const documentos = binds[1] as string[];
    return {
      r,
      llamadas,
      pares: pagos.map((pg, i) => [pg, documentos[i]]),
    };
  }

  it('boleta: el pago de la máquina lleva su voucher y el del sistema la boleta', async () => {
    // Los documentos salen en este orden: voucher (1) y boleta del sistema (2).
    const { pares } = await enlaces(
      params({
        pagos: [pago('ef', 'sistema', 60000), pago('db', 'maquina', 40000)],
      }),
    );

    expect(pares).toEqual([
      ['pago-ef', 'doc-2'],
      ['pago-db', 'doc-1'],
    ]);
  });

  it('un solo UPDATE para todos los pagos, no uno por pago (sin N+1)', async () => {
    const { llamadas, pares } = await enlaces(
      params({
        pagos: [
          pago('a', 'maquina', 30000),
          pago('b', 'maquina', 30000),
          pago('c', 'sistema', 20000),
          pago('d', 'nadie', 20000),
        ],
      }),
    );

    expect(llamadas).toHaveLength(1);
    expect(pares).toHaveLength(4);
    const [sql, binds] = llamadas[0];
    expect(sql).toMatch(/UPDATE pagos/);
    expect(sql).toMatch(/unnest\(\$1::uuid\[\], \$2::uuid\[\]\)/);
    // Acotado al tenant del token y a pagos vivos.
    expect(sql).toMatch(/p\.tenant_id = \$3/);
    expect(sql).toMatch(/p\.eliminado_el IS NULL/);
    expect(binds[2]).toBe(TENANT);
  });

  it('cada pago de la máquina lleva SU voucher, no el del otro', async () => {
    const { pares } = await enlaces(
      params({
        pagos: [pago('a', 'maquina', 60000), pago('b', 'maquina', 40000)],
      }),
    );

    expect(pares).toEqual([
      ['pago-a', 'doc-1'],
      ['pago-b', 'doc-2'],
    ]);
  });

  it('el pago de nadie lleva la fila nadie y el del sistema la boleta (con deuda, la misma boleta)', async () => {
    // Orden de los documentos: nadie (1) y sistema (2: lo del sistema + lo debido).
    const { pares } = await enlaces(
      params({
        pagos: [pago('n', 'nadie', 30000), pago('s', 'sistema', 20000)],
      }),
    );

    expect(pares).toEqual([
      ['pago-n', 'doc-1'],
      ['pago-s', 'doc-2'],
    ]);
  });

  it('con facturador externo el pago del sistema lleva la boleta del sistema, no el documento de la deuda', async () => {
    // Documentos: sistema (1, por lo cobrado) y externo (2, por lo debido).
    const { pares, r } = await enlaces(
      params({
        facturador: 'externo',
        pagos: [pago('s', 'sistema', 30000)],
      }),
    );

    expect(r.docs.map((d) => d.emisor)).toEqual(['sistema', 'externo']);
    expect(pares).toEqual([['pago-s', 'doc-1']]);
  });

  it.each([
    ['factura del sistema', { esBoleta: false }, 'sistema' as const],
    ['factura hecha por fuera', { esBoleta: false }, 'externo' as const],
    ['venta online', { canal: 'online' }, 'sistema' as const],
  ])(
    '%s: todos los pagos caen en el único documento, sea cual sea su medio',
    async (_nombre, venta, facturador) => {
      const { pares } = await enlaces(
        params({
          venta,
          facturador,
          pagos: [
            pago('a', 'sistema', 19000),
            pago('b', 'maquina', 40000),
            pago('c', 'nadie', 41000),
          ],
        }),
      );

      expect(pares).toEqual([
        ['pago-a', 'doc-1'],
        ['pago-b', 'doc-1'],
        ['pago-c', 'doc-1'],
      ]);
    },
  );

  it('un pago de la máquina que fue todo propina no tiene voucher: queda sin enlace, y los demás sí', async () => {
    const { pares } = await enlaces(
      params({
        pagos: [pago('propina', 'maquina', 0), pago('ef', 'sistema', 100000)],
      }),
    );

    expect(pares).toEqual([['pago-ef', 'doc-1']]);
  });

  it.each([
    ['venta de $0', { totalFinal: '0.0000' }],
    ['país sin boleta', { tipoDocumentoId: null }],
  ])('%s: sin documentos no hay nada que enlazar', async (_n, venta) => {
    const { llamadas } = await enlaces(
      params({ venta, pagos: [pago('a', 'sistema', 100000)] }),
    );

    expect(llamadas).toHaveLength(0);
  });
});

describe('VentaDocumentosService.registrarDuplicadoDeAbono (E1b)', () => {
  const abono = (pagos: AbonoParaDuplicado[]) => ({
    tenantId: TENANT,
    ventaId: VENTA,
    pagos,
  });
  const conDocumentos = [{ '?column?': 1 }];

  it('un pago de la máquina sobre una venta ya documentada da un documento duplicado, con su pago, número y clase', async () => {
    const m = managerConLectura(conDocumentos);
    const docs = await new VentaDocumentosService().registrarDuplicadoDeAbono(
      m.manager,
      abono([
        {
          pagoId: 'pago-a',
          metodoPagoId: 'metodo-a',
          emisor: 'maquina',
          aplicadoVenta: '37500.0000',
          numeroDocumento: '  778899 ',
          claseDocumento: 'voucher',
        },
      ]),
    );
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      tenantId: TENANT,
      ventaId: VENTA,
      emisor: 'maquina',
      tipoDocumentoId: null,
      claseMaquina: 'voucher',
      numero: '778899',
      estadoEnvio: null,
      monto: '37500.0000',
      montoAfecto: null,
      montoExento: null,
      montoImpuestos: null,
      pagoId: 'pago-a',
      documentoCorregidoId: null,
      esDuplicado: true,
      descarte: null,
    });
  });

  it('sin número ni clase quedan nulos (se completan después)', async () => {
    const m = managerConLectura(conDocumentos);
    const [doc] = await new VentaDocumentosService().registrarDuplicadoDeAbono(
      m.manager,
      abono([
        {
          pagoId: 'pago-a',
          metodoPagoId: 'metodo-a',
          emisor: 'maquina',
          aplicadoVenta: '37500.0000',
        },
      ]),
    );
    expect(doc.numero).toBeNull();
    expect(doc.claseMaquina).toBeNull();
    expect(doc.esDuplicado).toBe(true);
  });

  it('los pagos del sistema y de nadie no dan documento: la deuda ya estaba documentada (E1), ni siquiera se consulta', async () => {
    const m = managerConLectura(conDocumentos);
    const docs = await new VentaDocumentosService().registrarDuplicadoDeAbono(
      m.manager,
      abono([
        {
          pagoId: 'pago-a',
          metodoPagoId: 'metodo-a',
          emisor: 'sistema',
          aplicadoVenta: '20000.0000',
          numeroDocumento: '1',
        },
        {
          pagoId: 'pago-b',
          metodoPagoId: 'metodo-b',
          emisor: 'nadie',
          aplicadoVenta: '10000.0000',
        },
      ]),
    );
    expect(docs).toEqual([]);
    expect(m.query).not.toHaveBeenCalled();
    expect(m.save).not.toHaveBeenCalled();
  });

  it('una venta sin documentos vigentes que no sean duplicados (de $0 o de un país sin boleta) no duplica nada', async () => {
    const m = managerConLectura([]);
    const docs = await new VentaDocumentosService().registrarDuplicadoDeAbono(
      m.manager,
      abono([
        {
          pagoId: 'pago-a',
          metodoPagoId: 'metodo-a',
          emisor: 'maquina',
          aplicadoVenta: '37500.0000',
        },
      ]),
    );
    expect(docs).toEqual([]);
    expect(m.save).not.toHaveBeenCalled();
  });

  it('la consulta mira solo documentos vigentes, no duplicados, de ESA venta y de ESE tenant', async () => {
    const m = managerConLectura(conDocumentos);
    await new VentaDocumentosService().registrarDuplicadoDeAbono(
      m.manager,
      abono([
        {
          pagoId: 'pago-a',
          metodoPagoId: 'metodo-a',
          emisor: 'maquina',
          aplicadoVenta: '37500.0000',
        },
      ]),
    );
    const [sql, binds] = m.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/es_duplicado = false/);
    expect(sql).toMatch(/emisor <> 'nadie'/);
    expect(sql).toMatch(/descarte IS NULL/);
    expect(sql).toMatch(/eliminado_el IS NULL/);
    expect(binds).toEqual([VENTA, TENANT]);
  });

  it('un pago de la máquina cuyo aplicado a la venta es 0 no da documento', async () => {
    const m = managerConLectura(conDocumentos);
    const docs = await new VentaDocumentosService().registrarDuplicadoDeAbono(
      m.manager,
      abono([
        {
          pagoId: 'pago-a',
          metodoPagoId: 'metodo-a',
          emisor: 'maquina',
          aplicadoVenta: '0.0000',
        },
      ]),
    );
    expect(docs).toEqual([]);
  });

  it('varios pagos de la máquina: un documento por pago, una sola lectura y un solo save (sin N+1)', async () => {
    const m = managerConLectura(conDocumentos);
    const docs = await new VentaDocumentosService().registrarDuplicadoDeAbono(
      m.manager,
      abono([
        {
          pagoId: 'pago-a',
          metodoPagoId: 'metodo-a',
          emisor: 'maquina',
          aplicadoVenta: '12000.0000',
          numeroDocumento: '111',
        },
        {
          pagoId: 'pago-b',
          metodoPagoId: 'metodo-b',
          emisor: 'sistema',
          aplicadoVenta: '5000.0000',
        },
        {
          pagoId: 'pago-c',
          metodoPagoId: 'metodo-c',
          emisor: 'maquina',
          aplicadoVenta: '8000.0000',
          claseDocumento: 'boleta',
        },
      ]),
    );
    expect(
      docs.map((d) => [d.pagoId, d.monto, d.numero, d.claseMaquina]),
    ).toEqual([
      ['pago-a', '12000.0000', '111', null],
      ['pago-c', '8000.0000', null, 'boleta'],
    ]);
    expect(m.query).toHaveBeenCalledTimes(1);
    expect(m.save).toHaveBeenCalledTimes(1);
  });

  it('un duplicado no cuenta para la cobertura: no suma al total de la venta', async () => {
    const m = managerConLectura(conDocumentos);
    const docs = await new VentaDocumentosService().registrarDuplicadoDeAbono(
      m.manager,
      abono([
        {
          pagoId: 'pago-a',
          metodoPagoId: 'metodo-a',
          emisor: 'maquina',
          aplicadoVenta: '60000.0000',
        },
      ]),
    );
    expect(sumaDeLaCobertura(docs)).toBe('0.0000');
  });
});

describe('VentaDocumentosService.evaluarAnulacion (E8, E10)', () => {
  const fila = (
    emisor: string,
    over: Partial<{ estado_envio: string | null; numero: string | null }> = {},
  ) => ({
    documento_id: `doc-${emisor}-${Math.random()}`,
    emisor,
    estado_envio: emisor === 'sistema' ? 'armado' : null,
    numero: null,
    ...over,
  });
  const evaluar = async (
    filas: ReturnType<typeof fila>[],
    externoHecho?: boolean,
  ) => {
    const m = managerConLectura(filas);
    const r = await new VentaDocumentosService().evaluarAnulacion(m.manager, {
      tenantId: TENANT,
      ventaId: VENTA,
      externoHecho,
    });
    return { r, ...m };
  };

  it('lee solo documentos vigentes (sin descarte ni borrado) de esa venta y ese tenant', async () => {
    const { query } = await evaluar([]);
    const [sql, binds] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/descarte IS NULL/);
    expect(sql).toMatch(/eliminado_el IS NULL/);
    expect(binds).toEqual([VENTA, TENANT]);
  });

  it('una venta sin documentos es anulable y no descarta nada', async () => {
    const { r } = await evaluar([]);
    expect(r).toEqual({ resultado: 'anulable', descartes: [] });
  });

  it('una boleta del sistema solo armada no bloquea y queda para descartar con armado_sin_enviar', async () => {
    const doc = fila('sistema');
    const { r } = await evaluar([doc]);
    expect(r).toEqual({
      resultado: 'anulable',
      descartes: [
        { documentoId: doc.documento_id, descarte: 'armado_sin_enviar' },
      ],
    });
  });

  it('las filas nadie no bloquean ni se descartan', async () => {
    const { r } = await evaluar([fila('nadie')]);
    expect(r).toEqual({ resultado: 'anulable', descartes: [] });
  });

  it('un documento de la máquina bloquea: se revierte con nota de crédito', async () => {
    const { r } = await evaluar([fila('sistema'), fila('maquina')]);
    expect(r).toMatchObject({ resultado: 'bloqueada' });
    expect((r as { motivo: string }).motivo).toMatch(/máquina/);
    expect((r as { motivo: string }).motivo).toMatch(/nota de crédito/);
  });

  it('un documento del sistema ya enviado bloquea (hoy ninguno: no hay envío)', async () => {
    const { r } = await evaluar([fila('sistema', { estado_envio: 'enviado' })]);
    expect(r).toMatchObject({ resultado: 'bloqueada' });
    expect((r as { motivo: string }).motivo).toMatch(/enviado/);
  });

  describe('documento hecho por fuera (externo)', () => {
    it('externoHecho null (nadie contestó) pide la respuesta, no anula', async () => {
      const { r } = await evaluar(
        [fila('externo')],
        null as unknown as boolean,
      );
      expect(r.resultado).toBe('pregunta_externo');
    });

    it('sin número y sin respuesta: pide la respuesta, con el mensaje exacto', async () => {
      const { r } = await evaluar([fila('externo')], undefined);
      expect(r).toEqual({
        resultado: 'pregunta_externo',
        motivo:
          'Esta venta tiene un documento hecho por fuera: falta decir si ya lo hiciste en tu facturador.',
      });
    });

    it('externoHecho true: bloquea con el mensaje exacto (va por nota de crédito)', async () => {
      const { r } = await evaluar([fila('externo')], true);
      expect(r).toEqual({
        resultado: 'bloqueada',
        motivo:
          'Ya está hecho: se revierte con una nota de crédito, hecha por fuera y anotada con su número.',
      });
    });

    it('externoHecho false: anula y el externo queda para descartar con afirmado_no_hecho', async () => {
      const doc = fila('externo');
      const { r } = await evaluar([doc], false);
      expect(r).toEqual({
        resultado: 'anulable',
        descartes: [
          { documentoId: doc.documento_id, descarte: 'afirmado_no_hecho' },
        ],
      });
    });

    it.each([undefined, true, false])(
      'con número anotado bloquea con externoHecho = %s: el número salió del otro facturador, el documento existe',
      async (hecho) => {
        const { r } = await evaluar(
          [fila('externo', { numero: 'F-9981' })],
          hecho,
        );
        expect(r).toEqual({
          resultado: 'bloqueada',
          motivo:
            'Ya está hecho: se revierte con una nota de crédito, hecha por fuera y anotada con su número.',
        });
      },
    );

    it('un número en blanco no cuenta como número', async () => {
      const { r } = await evaluar([fila('externo', { numero: '   ' })], false);
      expect(r.resultado).toBe('anulable');
    });

    it('un bloqueo gana sobre la pregunta: con una máquina no se pregunta por el externo', async () => {
      const { r } = await evaluar(
        [fila('externo'), fila('maquina')],
        undefined,
      );
      expect(r.resultado).toBe('bloqueada');
    });

    it('un externo y un sistema armado: con false se descartan los dos, cada uno con su motivo', async () => {
      const ext = fila('externo');
      const sis = fila('sistema');
      const { r } = await evaluar([sis, ext], false);
      expect(r).toEqual({
        resultado: 'anulable',
        descartes: [
          { documentoId: sis.documento_id, descarte: 'armado_sin_enviar' },
          { documentoId: ext.documento_id, descarte: 'afirmado_no_hecho' },
        ],
      });
    });
  });
});

describe('VentaDocumentosService.descartarAlAnular', () => {
  const fila = (emisor: string) => ({
    documento_id: `doc-${emisor}`,
    emisor,
    estado_envio: emisor === 'sistema' ? 'armado' : null,
    numero: null,
  });

  it('descarta en UNA sola sentencia, con el usuario del token, sin borrar filas', async () => {
    const m = managerConLectura([fila('sistema'), fila('externo')]);
    await new VentaDocumentosService().descartarAlAnular(m.manager, {
      tenantId: TENANT,
      ventaId: VENTA,
      usuarioId: 'usuario-7',
      externoHecho: false,
    });
    // La 1ª query es la lectura; la 2ª, el UPDATE.
    expect(m.query).toHaveBeenCalledTimes(2);
    const [sql, binds] = m.query.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/^\s*UPDATE venta_documentos/);
    expect(sql).not.toMatch(/DELETE/i);
    expect(sql).toMatch(/descartado_el = NOW\(\)/);
    // Defensa en profundidad: aunque los ids salieron de una lectura del tenant.
    expect(sql).toMatch(/vd\.tenant_id = \$4/);
    expect(sql).toMatch(/eliminado_el IS NULL/);
    expect(sql).toMatch(/descarte IS NULL/);
    expect(binds).toEqual([
      'usuario-7',
      ['doc-sistema', 'doc-externo'],
      ['armado_sin_enviar', 'afirmado_no_hecho'],
      TENANT,
    ]);
  });

  it('sin nada que descartar no escribe', async () => {
    const m = managerConLectura([]);
    await new VentaDocumentosService().descartarAlAnular(m.manager, {
      tenantId: TENANT,
      ventaId: VENTA,
      usuarioId: 'usuario-7',
    });
    expect(m.query).toHaveBeenCalledTimes(1);
  });

  it('una venta bloqueada lanza 400 con el motivo y no escribe', async () => {
    const m = managerConLectura([fila('maquina')]);
    const intento = new VentaDocumentosService().descartarAlAnular(m.manager, {
      tenantId: TENANT,
      ventaId: VENTA,
      usuarioId: 'usuario-7',
    });
    await expect(intento).rejects.toBeInstanceOf(BadRequestException);
    await expect(intento).rejects.toThrow(/nota de crédito/);
    expect(m.query).toHaveBeenCalledTimes(1);
  });

  it('un externo sin respuesta lanza 400 que pide la respuesta, y no escribe', async () => {
    const m = managerConLectura([fila('externo')]);
    const intento = new VentaDocumentosService().descartarAlAnular(m.manager, {
      tenantId: TENANT,
      ventaId: VENTA,
      usuarioId: 'usuario-7',
      externoHecho: undefined,
    });
    await expect(intento).rejects.toThrow(
      'Esta venta tiene un documento hecho por fuera: falta decir si ya lo hiciste en tu facturador.',
    );
    expect(m.query).toHaveBeenCalledTimes(1);
  });

  it('un externo con externoHecho true lanza 400 y no escribe', async () => {
    const m = managerConLectura([fila('externo')]);
    await expect(
      new VentaDocumentosService().descartarAlAnular(m.manager, {
        tenantId: TENANT,
        ventaId: VENTA,
        usuarioId: 'usuario-7',
        externoHecho: true,
      }),
    ).rejects.toThrow(/Ya está hecho/);
    expect(m.query).toHaveBeenCalledTimes(1);
  });
});

describe('VentaDocumentosService.ventaDocumentada (el predicado que comparten el abono y el detalle)', () => {
  it('es true si hay un documento vigente, no duplicado y que no sea de nadie', async () => {
    const m = managerConLectura([{ '?column?': 1 }]);
    await expect(
      new VentaDocumentosService().ventaDocumentada(m.manager, {
        tenantId: TENANT,
        ventaId: VENTA,
      }),
    ).resolves.toBe(true);
  });

  it('es false sin documentos que cumplan', async () => {
    const m = managerConLectura([]);
    await expect(
      new VentaDocumentosService().ventaDocumentada(m.manager, {
        tenantId: TENANT,
        ventaId: VENTA,
      }),
    ).resolves.toBe(false);
  });

  it('lee solo documentos de ESA venta y ESE tenant, vigentes, no duplicados y con emisor distinto de nadie', async () => {
    const m = managerConLectura([]);
    await new VentaDocumentosService().ventaDocumentada(m.manager, {
      tenantId: TENANT,
      ventaId: VENTA,
    });
    const [sql, binds] = m.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/es_duplicado = false/);
    expect(sql).toMatch(/emisor <> 'nadie'/);
    expect(sql).toMatch(/descarte IS NULL/);
    expect(sql).toMatch(/eliminado_el IS NULL/);
    expect(binds).toEqual([VENTA, TENANT]);
  });
});

describe('VentaDocumentosService.listarParaDetalle', () => {
  const FILA = {
    documento_id: 'doc-1',
    venta_id: VENTA,
    emisor: 'externo',
    tipo_documento_id: FACTURA,
    tipo_codigo: '33',
    tipo_nombre: 'Factura electrónica',
    clase_maquina: null,
    numero: 'F-98123',
    estado_envio: null,
    monto: '119000.0000',
    pago_id: null,
    documento_corregido_id: null,
    es_duplicado: false,
    descarte: 'afirmado_no_hecho',
    descartado_el: new Date('2026-10-01T12:00:00Z'),
    descartado_por_nombre: 'Ana Pérez',
  };

  /**
   * `listarParaDetalle` lee dos cosas: los documentos y, en una segunda consulta
   * por lote, los borrados de número de esos documentos. Cada una responde lo suyo.
   */
  function managerDeDetalle(
    filas: Record<string, unknown>[],
    borrados: Record<string, unknown>[] = [],
  ) {
    const query = jest.fn<
      Promise<Record<string, unknown>[]>,
      [string, unknown[]]
    >((sql) =>
      Promise.resolve(
        /FROM venta_documento_numero_borrados/.test(sql) ? borrados : filas,
      ),
    );
    return { query, manager: { query } as unknown as EntityManager };
  }

  it('arma un solo SELECT con la venta y sus correcciones, y mapea la fila', async () => {
    const m = managerDeDetalle([FILA]);
    const docs = await new VentaDocumentosService().listarParaDetalle(
      m.manager,
      { tenantId: TENANT, ventaId: VENTA },
    );
    // Los documentos y, aparte, UN lote con los borrados de número.
    expect(m.query).toHaveBeenCalledTimes(2);
    const [sql, binds] = m.query.mock.calls[0];
    // La venta y sus correcciones en la misma consulta.
    expect(sql).toMatch(/venta_referencia_id = \$1/);
    expect(sql).toMatch(/vd\.eliminado_el IS NULL/);
    expect(sql).toMatch(/vd\.tenant_id = \$2/);
    expect(binds).toEqual([VENTA, TENANT, null]);
    expect(docs).toEqual([
      {
        id: 'doc-1',
        ventaId: VENTA,
        emisor: 'externo',
        tipoDocumento: {
          id: FACTURA,
          codigo: '33',
          nombre: 'Factura electrónica',
        },
        claseMaquina: null,
        numero: 'F-98123',
        estadoEnvio: null,
        monto: '119000.0000',
        pagoId: null,
        documentoCorregidoId: null,
        esDuplicado: false,
        descarte: 'afirmado_no_hecho',
        descartadoEl: FILA.descartado_el,
        descartadoPorNombre: 'Ana Pérez',
        numerosBorrados: [],
      },
    ]);
  });

  describe('los borrados de número (PRODUCTO § 10)', () => {
    const BORRADO = (doc: string, numero: string, nombre: string | null) => ({
      documento_id: doc,
      numero_anterior: numero,
      creado_el: new Date('2026-10-02T15:00:00Z'),
      borrado_por_nombre: nombre,
    });

    it('los trae en UNA consulta para todos los documentos, y cada uno recibe los suyos en el orden en que llegan (el más nuevo primero)', async () => {
      const m = managerDeDetalle(
        [
          { ...FILA, documento_id: 'doc-1' },
          { ...FILA, documento_id: 'doc-2' },
          { ...FILA, documento_id: 'doc-3' },
        ],
        [
          BORRADO('doc-2', 'B-222', 'Luis Soto'),
          BORRADO('doc-1', 'A-2', null),
          BORRADO('doc-2', 'A-111', 'Ana Pérez'),
        ],
      );
      const docs = await new VentaDocumentosService().listarParaDetalle(
        m.manager,
        { tenantId: TENANT, ventaId: VENTA },
      );

      // Documentos + un lote, no una consulta por documento (N+1).
      expect(m.query).toHaveBeenCalledTimes(2);
      const [sql, binds] = m.query.mock.calls[1];
      expect(sql).toMatch(/b\.documento_id = ANY\(\$2::uuid\[\]\)/);
      expect(sql).toMatch(/b\.tenant_id = \$1/);
      expect(sql).toMatch(/b\.eliminado_el IS NULL/);
      expect(sql).toMatch(/ORDER BY b\.creado_el DESC/);
      expect(binds).toEqual([TENANT, ['doc-1', 'doc-2', 'doc-3']]);

      expect(docs.map((d) => d.numerosBorrados)).toEqual([
        [
          {
            numeroAnterior: 'A-2',
            borradoEl: new Date('2026-10-02T15:00:00Z'),
            borradoPorNombre: null,
          },
        ],
        [
          {
            numeroAnterior: 'B-222',
            borradoEl: new Date('2026-10-02T15:00:00Z'),
            borradoPorNombre: 'Luis Soto',
          },
          {
            numeroAnterior: 'A-111',
            borradoEl: new Date('2026-10-02T15:00:00Z'),
            borradoPorNombre: 'Ana Pérez',
          },
        ],
        [],
      ]);
    });

    it('sin documentos no hace la consulta de borrados', async () => {
      const m = managerDeDetalle([]);
      await new VentaDocumentosService().listarParaDetalle(m.manager, {
        tenantId: TENANT,
        ventaId: VENTA,
      });
      expect(m.query).toHaveBeenCalledTimes(1);
    });

    it('el join al usuario no filtra borrados, y lo dice junto al join (excepción deliberada)', async () => {
      const m = managerDeDetalle([FILA]);
      await new VentaDocumentosService().listarParaDetalle(m.manager, {
        tenantId: TENANT,
        ventaId: VENTA,
      });
      const [sql] = m.query.mock.calls[1];
      expect(/LEFT JOIN usuarios u[^\n]*/.exec(sql)![0]).not.toMatch(
        /u\.eliminado_el/,
      );
      expect(sql).toMatch(
        /--[^\n]*eliminado_el[^\n]*\n(?:[^\n]*\n)*?\s*LEFT JOIN usuarios/,
      );
    });
  });

  it('un documento sin tipo (máquina, nadie) devuelve tipoDocumento null', async () => {
    const m = managerConLectura([
      {
        ...FILA,
        emisor: 'maquina',
        tipo_documento_id: null,
        tipo_codigo: null,
        tipo_nombre: null,
        descarte: null,
        descartado_el: null,
        descartado_por_nombre: null,
      },
    ]);
    const [doc] = await new VentaDocumentosService().listarParaDetalle(
      m.manager,
      { tenantId: TENANT, ventaId: VENTA },
    );
    expect(doc.tipoDocumento).toBeNull();
    expect(doc.descarte).toBeNull();
    expect(doc.descartadoPorNombre).toBeNull();
  });

  it('los joins de tipo y de usuario no filtran borrados, y lo dicen (excepción deliberada)', async () => {
    const m = managerConLectura([]);
    await new VentaDocumentosService().listarParaDetalle(m.manager, {
      tenantId: TENANT,
      ventaId: VENTA,
    });
    const [sql] = m.query.mock.calls[0] as [string];
    const joinTipo =
      /LEFT JOIN tipos_documento_tributario td[^\n]*(\n[^\n]*)?/.exec(sql)![0];
    const joinUsuario = /LEFT JOIN usuarios u[^\n]*(\n[^\n]*)?/.exec(sql)![0];
    expect(joinTipo).not.toMatch(/td\.eliminado_el/);
    expect(joinUsuario).not.toMatch(/u\.eliminado_el/);
    // El porqué está escrito en la consulta, junto al join.
    expect(sql).toMatch(
      /--[^\n]*eliminado_el[^\n]*\n(?:[^\n]*\n)*?\s*LEFT JOIN tipos_documento_tributario/,
    );
  });

  it('con documentoId acota a ese documento', async () => {
    const m = managerConLectura([]);
    await new VentaDocumentosService().listarParaDetalle(m.manager, {
      tenantId: TENANT,
      ventaId: VENTA,
      documentoId: 'doc-9',
    });
    const [sql, binds] = m.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/vd\.documento_id = \$3/);
    expect(binds).toEqual([VENTA, TENANT, 'doc-9']);
  });
});

describe('VentaDocumentosService.completarNumero', () => {
  /** SELECT del emisor, UPDATE ... RETURNING y la relectura del detalle. */
  function managerDeCompletar(emisor: string | null, actualizadas = 1) {
    const query = jest.fn((sql: string) => {
      if (/^\s*SELECT emisor/.test(sql))
        return Promise.resolve(emisor ? [{ emisor }] : []);
      if (/FROM venta_documento_numero_borrados/.test(sql))
        return Promise.resolve([]);
      if (/^\s*UPDATE venta_documentos/.test(sql))
        return Promise.resolve([
          Array.from({ length: actualizadas }, () => ({
            documento_id: 'doc-1',
            venta_id: VENTA,
          })),
          actualizadas,
        ]);
      return Promise.resolve([
        {
          documento_id: 'doc-1',
          venta_id: VENTA,
          emisor: emisor ?? 'maquina',
          tipo_documento_id: null,
          tipo_codigo: null,
          tipo_nombre: null,
          clase_maquina: 'voucher',
          numero: '445566',
          estado_envio: null,
          monto: '40000.0000',
          pago_id: 'pago-1',
          documento_corregido_id: null,
          es_duplicado: false,
          descarte: null,
          descartado_el: null,
          descartado_por_nombre: null,
        },
      ]);
    });
    return { query, manager: { query } as unknown as EntityManager };
  }
  const completar = (
    m: ReturnType<typeof managerDeCompletar>,
    over: Partial<{ numero: string; clase: 'voucher' | 'boleta' }> = {},
  ) =>
    new VentaDocumentosService().completarNumero(m.manager, {
      tenantId: TENANT,
      documentoId: 'doc-1',
      numero: '445566',
      ...over,
    });
  const updateDe = (m: ReturnType<typeof managerDeCompletar>) =>
    m.query.mock.calls.find((c) => /^\s*UPDATE venta_documentos/.test(c[0])) as
      | [string, unknown[]]
      | undefined;

  it('escribe el número con el tenant y devuelve el documento actualizado', async () => {
    const m = managerDeCompletar('maquina');
    const doc = await completar(m, { numero: '  445566 ' });
    const [sql, binds] = updateDe(m)!;
    expect(binds.slice(0, 3)).toEqual(['doc-1', TENANT, '445566']);
    expect(sql).not.toMatch(/DELETE/i);
    expect(doc).toMatchObject({ id: 'doc-1', numero: '445566' });
  });

  it('solo toca documentos vigentes de la máquina o hechos por fuera, y de ese tenant', async () => {
    const m = managerDeCompletar('externo');
    await completar(m);
    for (const [sql] of m.query.mock.calls.filter((c) =>
      /^\s*(SELECT emisor|UPDATE)/.test(c[0]),
    ) as [string][]) {
      expect(sql).toMatch(/emisor IN \('maquina', 'externo'\)/);
      expect(sql).toMatch(/descarte IS NULL/);
      expect(sql).toMatch(/eliminado_el IS NULL/);
      expect(sql).toMatch(/tenant_id = \$2/);
    }
  });

  it('un documento que no es de la máquina ni externo, descartado o de otro tenant: 404 y no escribe', async () => {
    const m = managerDeCompletar(null);
    await expect(completar(m)).rejects.toBeInstanceOf(NotFoundException);
    expect(updateDe(m)).toBeUndefined();
  });

  it('si entre la lectura y el UPDATE el documento dejó de valer: 404', async () => {
    const m = managerDeCompletar('maquina', 0);
    await expect(completar(m)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('la clase con un documento externo es 400 y no escribe', async () => {
    const m = managerDeCompletar('externo');
    await expect(completar(m, { clase: 'voucher' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(updateDe(m)).toBeUndefined();
  });

  it('la clase con la máquina se escribe', async () => {
    const m = managerDeCompletar('maquina');
    await completar(m, { clase: 'boleta' });
    expect(updateDe(m)![1][3]).toBe('boleta');
  });

  it('sin clase la conserva: no se manda null (omitir no es borrar)', async () => {
    const m = managerDeCompletar('maquina');
    await completar(m);
    const [sql, binds] = updateDe(m)!;
    expect(binds[3]).toBeNull();
    expect(sql).toMatch(/clase_maquina = COALESCE\(\$4, clase_maquina\)/);
  });

  it('un número de más de 40 caracteres es 400 y no toca la base; uno de exactamente 40 pasa', async () => {
    const largo = managerDeCompletar('maquina');
    await expect(
      completar(largo, { numero: '9'.repeat(41) }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(largo.query).not.toHaveBeenCalled();

    const justo = managerDeCompletar('maquina');
    await completar(justo, { numero: '9'.repeat(40) });
    expect(updateDe(justo)![1][2]).toBe('9'.repeat(40));
  });

  it.each([
    ['un salto de línea', '12\n34'],
    ['un NUL', '12\u000034'],
    ['un tabulador', '12\t34'],
    ['un DEL', '12\u007f34'],
  ])(
    'un número con %s es 400 y no toca la base: este método no depende del DTO',
    async (_n, numero) => {
      const m = managerDeCompletar('maquina');
      await expect(completar(m, { numero })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(m.query).not.toHaveBeenCalled();
    },
  );

  it('acepta letras, guiones, barras y espacios internos', async () => {
    const m = managerDeCompletar('maquina');
    await completar(m, { numero: 'A-12/34 B' });
    expect(updateDe(m)![1][2]).toBe('A-12/34 B');
  });

  it.each(['', '   '])(
    'un número en blanco (%j) es 400: este método no depende del DTO',
    async (numero) => {
      const m = managerDeCompletar('maquina');
      await expect(completar(m, { numero })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(m.query).not.toHaveBeenCalled();
    },
  );
});

describe('VentaDocumentosService.borrarNumero (PRODUCTO § 10)', () => {
  const USUARIO = 'usuario-que-borra';
  /**
   * SELECT del número, UPDATE ... RETURNING, INSERT del registro y la relectura
   * del detalle. `numero` es lo que decía el documento (`undefined`: no hay
   * documento vigente que cumpla).
   */
  function managerDeBorrar(
    numero: string | null | undefined,
    actualizadas = 1,
  ) {
    const query = jest.fn((sql: string) => {
      if (/^\s*SELECT numero/.test(sql))
        return Promise.resolve(numero === undefined ? [] : [{ numero }]);
      if (/^\s*UPDATE venta_documentos/.test(sql))
        return Promise.resolve([
          Array.from({ length: actualizadas }, () => ({
            documento_id: 'doc-1',
            venta_id: VENTA,
          })),
          actualizadas,
        ]);
      if (/^\s*INSERT INTO venta_documento_numero_borrados/.test(sql))
        return Promise.resolve([]);
      if (/FROM venta_documento_numero_borrados/.test(sql))
        return Promise.resolve([
          {
            documento_id: 'doc-1',
            numero_anterior: 'F-4471',
            creado_el: new Date('2026-10-02T15:00:00Z'),
            borrado_por_nombre: 'Ana Pérez',
          },
        ]);
      return Promise.resolve([
        {
          documento_id: 'doc-1',
          venta_id: VENTA,
          emisor: 'externo',
          tipo_documento_id: null,
          tipo_codigo: null,
          tipo_nombre: null,
          clase_maquina: null,
          numero: null,
          estado_envio: null,
          monto: '119000.0000',
          pago_id: null,
          documento_corregido_id: null,
          es_duplicado: false,
          descarte: null,
          descartado_el: null,
          descartado_por_nombre: null,
        },
      ]);
    });
    return { query, manager: { query } as unknown as EntityManager };
  }
  const borrar = (m: ReturnType<typeof managerDeBorrar>) =>
    new VentaDocumentosService().borrarNumero(m.manager, {
      tenantId: TENANT,
      documentoId: 'doc-1',
      usuarioId: USUARIO,
    });
  const llamada = (m: ReturnType<typeof managerDeBorrar>, patron: RegExp) =>
    m.query.mock.calls.find((c) => patron.test(c[0])) as
      | [string, unknown[]]
      | undefined;
  const UPDATE = /^\s*UPDATE venta_documentos/;
  const INSERT = /^\s*INSERT INTO venta_documento_numero_borrados/;

  it('deja el número en NULL, registra quién lo borró y qué decía, y devuelve el documento con el borrado', async () => {
    const m = managerDeBorrar('F-4471');
    const doc = await borrar(m);

    const [sqlUpdate, bindsUpdate] = llamada(m, UPDATE)!;
    expect(sqlUpdate).toMatch(/SET numero = NULL/);
    // Se borra exactamente lo que se leyó (y se registra).
    expect(sqlUpdate).toMatch(/AND numero = \$3/);
    expect(bindsUpdate).toEqual(['doc-1', TENANT, 'F-4471']);

    const [sqlInsert, bindsInsert] = llamada(m, INSERT)!;
    expect(sqlInsert).toMatch(
      /\(tenant_id, documento_id, numero_anterior, usuario_id\)/,
    );
    expect(bindsInsert).toEqual([TENANT, 'doc-1', 'F-4471', USUARIO]);

    expect(doc).toMatchObject({
      id: 'doc-1',
      numero: null,
      numerosBorrados: [
        {
          numeroAnterior: 'F-4471',
          borradoPorNombre: 'Ana Pérez',
        },
      ],
    });
  });

  it('el registro se escribe DESPUÉS de borrar: sin la fila escrita no hay registro huérfano', async () => {
    const m = managerDeBorrar('F-4471');
    await borrar(m);
    const orden = m.query.mock.calls.map((c) =>
      UPDATE.test(c[0]) ? 'update' : INSERT.test(c[0]) ? 'insert' : '',
    );
    expect(orden.indexOf('update')).toBeGreaterThanOrEqual(0);
    expect(orden.indexOf('insert')).toBeGreaterThan(orden.indexOf('update'));
  });

  it('solo toca un documento hecho por fuera, vigente y de ese tenant; y nunca borra filas', async () => {
    const m = managerDeBorrar('F-4471');
    await borrar(m);
    for (const [sql] of m.query.mock.calls.filter((c) =>
      /^\s*(SELECT numero|UPDATE)/.test(c[0]),
    ) as [string][]) {
      expect(sql).toMatch(/emisor = 'externo'/);
      expect(sql).toMatch(/descarte IS NULL/);
      expect(sql).toMatch(/eliminado_el IS NULL/);
      expect(sql).toMatch(/tenant_id = \$2/);
    }
    for (const [sql] of m.query.mock.calls as [string][])
      expect(sql).not.toMatch(/DELETE/i);
  });

  it('un documento que no es hecho por fuera, descartado, borrado o de otro tenant: 404 y no escribe ni registra', async () => {
    const m = managerDeBorrar(undefined);
    await expect(borrar(m)).rejects.toBeInstanceOf(NotFoundException);
    expect(llamada(m, UPDATE)).toBeUndefined();
    expect(llamada(m, INSERT)).toBeUndefined();
  });

  it.each([
    ['sin número (NULL)', null],
    ['un número vacío', ''],
    ['un número en blanco', '   '],
  ])('%s: 400 y no escribe ni registra', async (_n, numero) => {
    const m = managerDeBorrar(numero);
    await expect(borrar(m)).rejects.toBeInstanceOf(BadRequestException);
    expect(llamada(m, UPDATE)).toBeUndefined();
    expect(llamada(m, INSERT)).toBeUndefined();
  });

  it('si entre la lectura y el UPDATE el número cambió o el documento dejó de valer: 404 y no registra', async () => {
    const m = managerDeBorrar('F-4471', 0);
    await expect(borrar(m)).rejects.toBeInstanceOf(NotFoundException);
    expect(llamada(m, INSERT)).toBeUndefined();
  });
});

describe('VentaDocumentosService.enlazarPagosDeAbono', () => {
  const enlazar = (
    docs: { documento_id: string; emisor: string }[],
    pagoIds: string[],
  ) => {
    const m = managerConLectura(docs);
    return {
      m,
      run: () =>
        new VentaDocumentosService().enlazarPagosDeAbono(m.manager, {
          tenantId: TENANT,
          ventaId: VENTA,
          pagoIds,
        }),
    };
  };

  it('todos los pagos del abono al documento de la deuda, con UN solo UPDATE', async () => {
    const e = enlazar(
      [{ documento_id: 'd-sistema', emisor: 'sistema' }],
      ['pago-a', 'pago-b'],
    );
    await e.run();

    // Una lectura de documentos y un UPDATE.
    expect(e.m.query).toHaveBeenCalledTimes(2);
    const [sql, binds] = e.m.query.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/UPDATE pagos/);
    expect(binds).toEqual([
      ['pago-a', 'pago-b'],
      ['d-sistema', 'd-sistema'],
      TENANT,
    ]);
  });

  it('con facturador externo la deuda es el documento hecho por fuera, no la boleta del sistema', async () => {
    const e = enlazar(
      [
        { documento_id: 'd-sistema', emisor: 'sistema' },
        { documento_id: 'd-externo', emisor: 'externo' },
      ],
      ['pago-a'],
    );
    await e.run();

    const binds = e.m.query.mock.calls[1][1] as unknown[];
    expect(binds[1]).toEqual(['d-externo']);
  });

  it('la lectura excluye el voucher duplicado, lo descartado y lo borrado, y es de esa venta y ese tenant', async () => {
    const e = enlazar([{ documento_id: 'd', emisor: 'sistema' }], ['p']);
    await e.run();

    const [sql, binds] = e.m.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/es_duplicado = false/);
    expect(sql).toMatch(/emisor IN \('sistema', 'externo'\)/);
    expect(sql).toMatch(/descarte IS NULL/);
    expect(sql).toMatch(/eliminado_el IS NULL/);
    expect(binds).toEqual([VENTA, TENANT]);
  });

  it('sin documento de la deuda (venta de $0, país sin boleta) no escribe nada', async () => {
    const e = enlazar([], ['pago-a']);
    await e.run();

    expect(e.m.query).toHaveBeenCalledTimes(1);
  });

  it('sin pagos no consulta nada', async () => {
    const e = enlazar([{ documento_id: 'd', emisor: 'sistema' }], []);
    await e.run();

    expect(e.m.query).not.toHaveBeenCalled();
  });
});

/**
 * Qué documento corrige una corrección (spec § 3.6). La forma del SQL la cubre
 * `test/venta-correcciones.e2e-spec.ts`; acá, la resolución sobre lo que las
 * tres lecturas devuelven. El documento de cada pago se **lee** de
 * `pagos.documento_id`: no se infiere de nada más.
 */
describe('VentaDocumentosService.documentoQueCorrige / opcionesDevolucion', () => {
  interface DocFila {
    documento_id: string;
    emisor: string;
    monto: string;
    es_duplicado: boolean;
  }
  interface PagoFila {
    pago_id: string;
    metodo_nombre: string | null;
    es_efectivo: boolean | null;
    documento_id: string | null;
    aplicado_venta: string;
    /** Lo ya devuelto por este pago (`devolucion_pago_id`) en correcciones anteriores. */
    devuelto: string;
  }
  const doc = (
    id: string,
    emisor: string,
    monto: number,
    extra: Partial<DocFila> = {},
  ): DocFila => ({
    documento_id: id,
    emisor,
    monto: monto.toFixed(4),
    es_duplicado: false,
    ...extra,
  });
  /** Un pago ya enlazado a su documento (`documento_id`). */
  const pagoFila = (
    id: string,
    aplicado: number,
    documentoId: string | null,
    extra: Partial<PagoFila> = {},
  ): PagoFila => ({
    pago_id: id,
    metodo_nombre: `Medio ${id}`,
    es_efectivo: false,
    documento_id: documentoId,
    aplicado_venta: aplicado.toFixed(4),
    devuelto: '0.0000',
    ...extra,
  });
  /** Las tres lecturas, por el nombre de la tabla que cada una consulta. */
  const lector = (
    total: number,
    docs: DocFila[],
    pagos: PagoFila[],
    /** Lo que las correcciones anteriores "sin plata" ya rebajaron. */
    sinPlata = 0,
  ): { query: jest.Mock } => ({
    query: jest.fn((sql: string) => {
      if (sql.includes('FROM venta_documentos')) return Promise.resolve(docs);
      if (sql.includes('FROM pagos p')) return Promise.resolve(pagos);
      return Promise.resolve([
        { total_final: total.toFixed(4), sin_plata: sinPlata.toFixed(4) },
      ]);
    }),
  });
  const via = (pagoId: string) => ({ tipo: 'pago', pagoId }) as const;
  const resolver = (
    l: { query: jest.Mock },
    v: Parameters<VentaDocumentosService['documentoQueCorrige']>[1]['via'],
  ) =>
    new VentaDocumentosService().documentoQueCorrige(
      l as unknown as EntityManager,
      { tenantId: TENANT, ventaId: VENTA, via: v },
    );

  // Mixta: 60.000 en efectivo (boleta del sistema) y 40.000 con la máquina (voucher).
  const MIXTA_DOCS = [
    doc('d-boleta', 'sistema', 60000),
    doc('d-voucher', 'maquina', 40000),
  ];
  const MIXTA_PAGOS = [
    pagoFila('p-efectivo', 60000, 'd-boleta', { es_efectivo: true }),
    pagoFila('p-tarjeta', 40000, 'd-voucher'),
  ];

  it('el pago corrige el documento al que está enlazado (y solo el de efectivo saca plata de la caja)', async () => {
    const l = lector(100000, MIXTA_DOCS, MIXTA_PAGOS);

    await expect(resolver(l, via('p-tarjeta'))).resolves.toEqual({
      documento: { id: 'd-voucher', emisor: 'maquina', monto: '40000.0000' },
      saldo: null,
      mueveCaja: false,
      devolvibleDelPago: '40000.0000',
    });
    await expect(resolver(l, via('p-efectivo'))).resolves.toEqual({
      documento: { id: 'd-boleta', emisor: 'sistema', monto: '60000.0000' },
      saldo: null,
      mueveCaja: true,
      devolvibleDelPago: '60000.0000',
    });
  });

  it('lee el enlace tal cual: dos pagos del mismo medio caen en documentos distintos si así quedaron enlazados', async () => {
    // Nada del medio, ni de cuándo se creó el pago, decide: solo `documento_id`.
    const l = lector(
      100000,
      [doc('d-1', 'sistema', 60000), doc('d-2', 'externo', 40000)],
      [pagoFila('p-a', 60000, 'd-1'), pagoFila('p-b', 40000, 'd-2')],
    );

    expect((await resolver(l, via('p-a'))).documento?.id).toBe('d-1');
    expect((await resolver(l, via('p-b'))).documento?.id).toBe('d-2');
  });

  describe('el tope por pago: lo que ese pago aplicó a la venta menos lo ya devuelto por él', () => {
    const devolvible = async (
      l: { query: jest.Mock },
      pagoId: string,
    ): Promise<string | null> =>
      (await resolver(l, via(pagoId))).devolvibleDelPago;

    it('sin devoluciones previas es todo lo que el pago aplicó a la venta', async () => {
      const l = lector(100000, MIXTA_DOCS, MIXTA_PAGOS);

      expect(await devolvible(l, 'p-tarjeta')).toBe('40000.0000');
      expect(await devolvible(l, 'p-efectivo')).toBe('60000.0000');
    });

    it('descuenta lo ya devuelto por ESE pago y no toca a los otros', async () => {
      const l = lector(100000, MIXTA_DOCS, [
        pagoFila('p-efectivo', 60000, 'd-boleta', {
          es_efectivo: true,
          devuelto: '55000.0000',
        }),
        pagoFila('p-tarjeta', 40000, 'd-voucher', { devuelto: '25000.0000' }),
      ]);

      expect(await devolvible(l, 'p-tarjeta')).toBe('15000.0000');
      expect(await devolvible(l, 'p-efectivo')).toBe('5000.0000');
    });

    it('lee lo devuelto de la corrección vigente de esta venta y este tenant que eligió el pago, en la misma consulta de los pagos', async () => {
      const l = lector(100000, MIXTA_DOCS, MIXTA_PAGOS);

      await resolver(l, via('p-tarjeta'));

      const consultas = l.query.mock.calls.filter(([sql]) =>
        (sql as string).includes('FROM pagos p'),
      ) as [string, unknown[]][];
      // Una sola lectura para todos los pagos: sin una consulta por pago.
      expect(consultas).toHaveLength(1);
      const [sql, binds] = consultas[0];
      expect(sql).toMatch(/c\.devolucion_pago_id = p\.pago_id/);
      expect(sql).toMatch(/c\.venta_referencia_id = \$1/);
      expect(sql).toMatch(/c\.tenant_id = \$2/);
      expect(sql).toMatch(/c\.eliminado_el IS NULL/);
      expect(binds).toEqual([VENTA, TENANT]);
    });

    it('lo que ese pago ya devolvió por completo deja el tope en cero', async () => {
      const l = lector(100000, MIXTA_DOCS, [
        pagoFila('p-tarjeta', 40000, 'd-voucher', { devuelto: '40000.0000' }),
      ]);

      expect(await devolvible(l, 'p-tarjeta')).toBe('0.0000');
    });

    it('la pasarela no topa a su pago (es un hecho consumado): nulo, aunque lo anote', async () => {
      const l = lector(100000, MIXTA_DOCS, MIXTA_PAGOS);

      expect(
        (
          await resolver(l, {
            tipo: 'pasarela',
            documentoId: null,
            pagoId: 'p-tarjeta',
          })
        ).devolvibleDelPago,
      ).toBeNull();
    });
  });

  describe('por pasarela (un hecho consumado: nunca rechaza ni mueve caja)', () => {
    const pasarela = (l: { query: jest.Mock }, documentoId: string | null) =>
      resolver(l, { tipo: 'pasarela', documentoId, pagoId: null });

    it('corrige el documento que trae, que sigue vigente, y no mueve caja', async () => {
      const l = lector(100000, [], []);
      l.query.mockResolvedValueOnce([
        { documento_id: 'd-boleta', emisor: 'sistema', monto: '100000.0000' },
      ]);

      await expect(pasarela(l, 'd-boleta')).resolves.toEqual({
        documento: { id: 'd-boleta', emisor: 'sistema', monto: '100000.0000' },
        saldo: null,
        mueveCaja: false,
        devolvibleDelPago: null,
      });
      // Solo ese documento, de esa venta y ese tenant, vigente.
      const [sql, binds] = l.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/descarte IS NULL/);
      expect(sql).toMatch(/eliminado_el IS NULL/);
      expect(binds).toEqual(['d-boleta', VENTA, TENANT]);
    });

    it('sin documento (null) no consulta nada y la corrección sale sin fila de documento', async () => {
      const l = lector(100000, [], []);

      await expect(pasarela(l, null)).resolves.toEqual({
        documento: null,
        saldo: null,
        mueveCaja: false,
        devolvibleDelPago: null,
      });
      expect(l.query).not.toHaveBeenCalled();
    });

    it('si el documento ya no es vigente no lanza: la corrección sale sin fila de documento', async () => {
      const l = { query: jest.fn().mockResolvedValue([]) };

      await expect(pasarela(l, 'd-descartado')).resolves.toEqual({
        documento: null,
        saldo: null,
        mueveCaja: false,
        devolvibleDelPago: null,
      });
    });
  });

  it('el efectivo en la máquina: el contrato es por pago, no por efectivo (corrige el voucher Y mueve caja)', async () => {
    const l = lector(
      100000,
      [doc('d-v1', 'maquina', 60000), doc('d-v2', 'maquina', 40000)],
      [
        pagoFila('p-efectivo', 60000, 'd-v1', { es_efectivo: true }),
        pagoFila('p-tarjeta', 40000, 'd-v2'),
      ],
    );

    const r = await resolver(l, via('p-efectivo'));

    expect(r.documento?.id).toBe('d-v1');
    expect(r.mueveCaja).toBe(true);
  });

  it('el pago de un abono corrige el documento de la deuda al que se enlazó, nunca el voucher duplicado', async () => {
    const l = lector(
      100000,
      [
        doc('d-voucher', 'maquina', 40000),
        doc('d-deuda', 'sistema', 60000),
        doc('d-dup', 'maquina', 60000, { es_duplicado: true }),
      ],
      [
        pagoFila('p-tarjeta', 40000, 'd-voucher'),
        pagoFila('p-abono', 60000, 'd-deuda'),
      ],
    );

    expect((await resolver(l, via('p-abono'))).documento?.id).toBe('d-deuda');
  });

  it('un pago sin enlace, en una venta con documentos, no se adivina: 400', async () => {
    const l = lector(
      100000,
      [doc('d-sistema', 'sistema', 70000), doc('d-nadie', 'nadie', 30000)],
      [pagoFila('p-1', 30000, null)],
    );

    await expect(resolver(l, via('p-1'))).rejects.toThrow(
      'No se encontró el documento de ese pago.',
    );
  });

  it('un enlace a un documento que ya no vale (descartado: no viene en la lectura de vigentes) tampoco resuelve', async () => {
    const l = lector(
      100000,
      [doc('d-sistema', 'sistema', 100000)],
      [pagoFila('p-1', 100000, 'd-descartado')],
    );

    await expect(resolver(l, via('p-1'))).rejects.toThrow(BadRequestException);
  });

  it('una devolución interna: el pago enlazado a la fila nadie corrige la fila nadie', async () => {
    const l = lector(
      100000,
      [doc('d-nadie', 'nadie', 100000)],
      [pagoFila('p-1', 100000, 'd-nadie')],
    );

    const r = await resolver(l, via('p-1'));

    expect(r.documento).toEqual({
      id: 'd-nadie',
      emisor: 'nadie',
      monto: '100000.0000',
    });
  });

  describe('"no vuelve plata"', () => {
    const MESA_DOCS = [
      doc('d-voucher', 'maquina', 40000),
      doc('d-deuda', 'sistema', 60000),
    ];
    const MESA_PAGOS = [pagoFila('p-tarjeta', 40000, 'd-voucher')];

    it('con saldo corrige el documento de lo debido, y no mueve caja', async () => {
      const l = lector(100000, MESA_DOCS, MESA_PAGOS);

      await expect(resolver(l, { tipo: 'sin_plata' })).resolves.toEqual({
        documento: { id: 'd-deuda', emisor: 'sistema', monto: '60000.0000' },
        // Lo que la venta todavía debe: el tope de "no vuelve plata".
        saldo: '60000.0000',
        mueveCaja: false,
        devolvibleDelPago: null,
      });
    });

    it('con facturador externo lo debido es el documento hecho por fuera', async () => {
      const l = lector(
        100000,
        [
          doc('d-voucher', 'maquina', 40000),
          doc('d-externo', 'externo', 60000),
        ],
        MESA_PAGOS,
      );

      expect((await resolver(l, { tipo: 'sin_plata' })).documento?.id).toBe(
        'd-externo',
      );
    });

    describe('el saldo es de la serie: total − lo aplicado − lo ya rebajado sin plata', () => {
      // Debe 60.000 (voucher de 40.000 pagado), con 20.000 abonados: debe 40.000.
      const DOCS = [
        doc('d-voucher', 'maquina', 40000),
        doc('d-deuda', 'sistema', 60000),
      ];
      const PAGOS = [
        pagoFila('p-tarjeta', 40000, 'd-voucher'),
        pagoFila('p-abono', 20000, 'd-deuda', { es_efectivo: true }),
      ];

      it('sin correcciones anteriores el saldo es total − aplicado', async () => {
        const l = lector(100000, DOCS, PAGOS, 0);

        expect((await resolver(l, { tipo: 'sin_plata' })).saldo).toBe(
          '40000.0000',
        );
      });

      it('lo ya rebajado sin plata baja el saldo (y lo que queda es lo que se puede rebajar)', async () => {
        const l = lector(100000, DOCS, PAGOS, 15000);

        expect((await resolver(l, { tipo: 'sin_plata' })).saldo).toBe(
          '25000.0000',
        );
      });

      it('con todo rebajado no queda saldo: "no vuelve plata" es un 400', async () => {
        const l = lector(100000, DOCS, PAGOS, 40000);

        await expect(resolver(l, { tipo: 'sin_plata' })).rejects.toThrow(
          /no tiene saldo/,
        );
      });

      it('la opción "no vuelve plata" lleva ese mismo saldo y desaparece al agotarse', async () => {
        const opciones = (sinPlata: number) =>
          new VentaDocumentosService().opcionesDevolucion(
            lector(100000, DOCS, PAGOS, sinPlata) as unknown as EntityManager,
            { tenantId: TENANT, ventaId: VENTA },
          );

        expect((await opciones(15000)).find((o) => o.sinPlata)?.monto).toBe(
          '25000.0000',
        );
        expect((await opciones(40000)).some((o) => o.sinPlata)).toBe(false);
      });

      it('solo cuentan las correcciones "sin plata" de esa venta y ese tenant, vivas', async () => {
        const l = lector(100000, DOCS, PAGOS, 0);

        await resolver(l, { tipo: 'sin_plata' });

        const [sql, binds] = l.query.mock.calls.find(
          ([q]: [string]) =>
            !q.includes('FROM venta_documentos') && !q.includes('FROM pagos p'),
        ) as [string, unknown[]];
        // Las que volvieron por un pago o por la pasarela devolvieron plata por
        // fuera: la deuda sigue igual.
        expect(sql).toMatch(/c\.devolucion_via = 'sin_plata'/);
        expect(sql).toMatch(/c\.venta_referencia_id = v\.venta_id/);
        expect(sql).toMatch(/c\.tenant_id = v\.tenant_id/);
        expect(sql).toMatch(/c\.eliminado_el IS NULL/);
        expect(binds).toEqual([VENTA, TENANT]);
      });
    });

    it('sin saldo es un 400', async () => {
      const l = lector(100000, MIXTA_DOCS, MIXTA_PAGOS);

      await expect(resolver(l, { tipo: 'sin_plata' })).rejects.toThrow(
        /no tiene saldo/,
      );
    });

    it('con saldo pero sin documento de lo debido es un 400, no una devolución interna', async () => {
      const l = lector(
        100000,
        [doc('d-nadie', 'nadie', 40000)],
        [pagoFila('p-1', 40000, 'd-nadie')],
      );

      await expect(resolver(l, { tipo: 'sin_plata' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('lo que rechaza', () => {
    it('un pagoId que la lectura no trae (de otra venta o de otro tenant, o inexistente)', async () => {
      const l = lector(100000, MIXTA_DOCS, MIXTA_PAGOS);

      await expect(resolver(l, via('p-ajeno'))).rejects.toThrow(
        'El pago indicado no es de esta venta.',
      );
    });

    it('un pago que fue todo propina: no cubrió nada de la venta', async () => {
      const l = lector(100000, MIXTA_DOCS, [
        ...MIXTA_PAGOS,
        pagoFila('p-propina', 0, null),
      ]);

      await expect(resolver(l, via('p-propina'))).rejects.toThrow(
        /no cubrió nada/,
      );
    });

    it('la venta no existe en ese tenant: 404', async () => {
      const l = { query: jest.fn().mockResolvedValue([]) };

      await expect(resolver(l, via('p-1'))).rejects.toThrow(NotFoundException);
    });
  });

  it('una venta que nunca tuvo documentos (país sin boleta) se corrige sin documento, pero el pago igual se valida', async () => {
    const l = lector(100000, [], [pagoFila('p-1', 100000, null)]);

    await expect(resolver(l, via('p-1'))).resolves.toEqual({
      documento: null,
      saldo: null,
      mueveCaja: false,
      devolvibleDelPago: '100000.0000',
    });
    await expect(resolver(l, via('p-ajeno'))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('todas las lecturas son de ESA venta y ESE tenant, y solo de documentos vigentes', async () => {
    const l = lector(100000, MIXTA_DOCS, MIXTA_PAGOS);

    await resolver(l, via('p-tarjeta'));

    expect(l.query).toHaveBeenCalledTimes(3);
    for (const [sql, binds] of l.query.mock.calls as [string, unknown[]][]) {
      expect(binds).toEqual([VENTA, TENANT]);
      expect(sql).toMatch(/eliminado_el IS NULL/);
    }
    const sqlDocs = (l.query.mock.calls as [string][]).find(([q]) =>
      q.includes('FROM venta_documentos'),
    )![0];
    expect(sqlDocs).toMatch(/descarte IS NULL/);
    // El documento de cada pago sale de la columna enlazada, no del medio ni de
    // cuándo se creó el pago.
    const sqlPagos = (l.query.mock.calls as [string][]).find(([q]) =>
      q.includes('FROM pagos p'),
    )![0];
    expect(sqlPagos).toMatch(/p\.documento_id/);
    expect(sqlPagos).not.toMatch(/tenant_metodo_pago|emisor|creado_el >/);
  });

  describe('opcionesDevolucion', () => {
    const opciones = (l: { query: jest.Mock }) =>
      new VentaDocumentosService().opcionesDevolucion(
        l as unknown as EntityManager,
        { tenantId: TENANT, ventaId: VENTA },
      );

    it('una opción por pago con su método, su monto aplicado y el registro que va a quedar; sin "no vuelve plata" si no hay saldo', async () => {
      const l = lector(100000, MIXTA_DOCS, MIXTA_PAGOS);

      await expect(opciones(l)).resolves.toEqual([
        {
          pagoId: 'p-efectivo',
          sinPlata: false,
          metodo: 'Medio p-efectivo',
          monto: '60000.0000',
          mueveCaja: true,
          registro: 'nota_credito_sistema',
        },
        {
          pagoId: 'p-tarjeta',
          sinPlata: false,
          metodo: 'Medio p-tarjeta',
          monto: '40000.0000',
          mueveCaja: false,
          registro: 'nota_maquina',
        },
      ]);
    });

    it('"no vuelve plata" aparece solo con saldo, por lo debido, con el registro del documento de la deuda', async () => {
      const l = lector(
        100000,
        [
          doc('d-voucher', 'maquina', 40000),
          doc('d-externo', 'externo', 60000),
        ],
        [pagoFila('p-tarjeta', 40000, 'd-voucher')],
      );

      const o = await opciones(l);

      expect(o).toHaveLength(2);
      expect(o[1]).toEqual({
        pagoId: null,
        sinPlata: true,
        metodo: null,
        monto: '60000.0000',
        mueveCaja: false,
        registro: 'nota_externa',
      });
    });

    it('el registro de cada documento: sistema, máquina, hecho por fuera, nadie y sin documento', async () => {
      const casos: [string, string | null][] = [
        ['sistema', 'nota_credito_sistema'],
        ['maquina', 'nota_maquina'],
        ['externo', 'nota_externa'],
        ['nadie', 'devolucion_interna'],
      ];
      for (const [emisor, registro] of casos) {
        const l = lector(
          1000,
          [doc('d-1', emisor, 1000)],
          [pagoFila('p-1', 1000, 'd-1')],
        );
        expect((await opciones(l))[0].registro).toBe(registro);
      }
      const sinDocs = lector(1000, [], [pagoFila('p-1', 1000, null)]);
      expect((await opciones(sinDocs))[0].registro).toBe('nota_credito');
    });

    it('el monto de cada pago es lo que todavía puede devolver (el tope que exige el servidor), no lo que aplicó', async () => {
      const l = lector(100000, MIXTA_DOCS, [
        pagoFila('p-efectivo', 60000, 'd-boleta', {
          es_efectivo: true,
          devuelto: '35000.0000',
        }),
        pagoFila('p-tarjeta', 40000, 'd-voucher', { devuelto: '15000.0000' }),
      ]);

      const o = await opciones(l);

      expect(o.map((x) => [x.pagoId, x.monto])).toEqual([
        ['p-efectivo', '25000.0000'],
        ['p-tarjeta', '25000.0000'],
      ]);
    });

    it('no ofrece el pago que ya devolvió todo lo que trajo, y los otros siguen', async () => {
      const l = lector(100000, MIXTA_DOCS, [
        pagoFila('p-efectivo', 60000, 'd-boleta', { es_efectivo: true }),
        pagoFila('p-tarjeta', 40000, 'd-voucher', { devuelto: '40000.0000' }),
      ]);

      const o = await opciones(l);

      expect(o.map((x) => x.pagoId)).toEqual(['p-efectivo']);
    });

    it('no ofrece el pago que fue todo propina ni el que no tiene documento enlazado', async () => {
      const l = lector(
        30000,
        [doc('d-nadie', 'nadie', 30000)],
        [pagoFila('p-propina', 0, null), pagoFila('p-sin-doc', 30000, null)],
      );

      await expect(opciones(l)).resolves.toEqual([]);
    });
  });
});

describe('VentaDocumentosService.exigirTopeDelDocumento', () => {
  const tope = (corregido: string, monto: string) => {
    const m = managerConLectura([{ corregido }]);
    return {
      m,
      run: () =>
        new VentaDocumentosService().exigirTopeDelDocumento(m.manager, {
          tenantId: TENANT,
          documento: { id: 'd-1', emisor: 'maquina', monto: '40000.0000' },
          monto,
        }),
    };
  };

  it('lo corregido más esta nota puede llegar justo al monto del documento', async () => {
    await expect(
      tope('30000.0000', '10000.0000').run(),
    ).resolves.toBeUndefined();
  });

  it('pasarlo es un 400 que no dice ningún número', async () => {
    const error = (await tope('30000.0000', '10000.0001')
      .run()
      .catch((e: Error) => e)) as BadRequestException;

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toMatch(/queda por corregir/);
    expect(error.message).not.toMatch(/\d/);
  });

  it('cuenta toda corrección que apunte al documento de ese tenant, vigente y de una venta no borrada', async () => {
    const t = tope('0', '1');
    await t.run();

    const [sql, binds] = t.m.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/documento_corregido_id = \$1/);
    expect(sql).toMatch(/vd\.tenant_id = \$2/);
    expect(sql).toMatch(/descarte IS NULL/);
    expect(sql).toMatch(/v\.eliminado_el IS NULL/);
    expect(sql).toMatch(/vd\.eliminado_el IS NULL/);
    expect(binds).toEqual(['d-1', TENANT]);
  });
});

describe('VentaDocumentosService.documentarCorreccion', () => {
  const BALDES = [
    { afecto: '19000.0000', exento: '4000.0000', impuestos: '3610.0000' },
  ];
  const documentar = (
    emisor: 'sistema' | 'maquina' | 'externo' | 'nadie',
    tipoNotaCreditoId: string | null,
    filas: Record<string, unknown>[] = BALDES,
  ) => {
    const m = managerConLectura(filas);
    return {
      m,
      run: () =>
        new VentaDocumentosService().documentarCorreccion(m.manager, {
          tenantId: TENANT,
          correccionVentaId: 'nc-1',
          corregido: { id: 'd-orig', emisor, monto: '60000.0000' },
          monto: '26610',
          tipoNotaCreditoId,
        }),
    };
  };

  it('sistema: NC armada con el tipo NC y los baldes de las líneas de la propia corrección', async () => {
    const d = documentar('sistema', 'tipo-nc');
    await d.run();

    expect(d.m.save).toHaveBeenCalledTimes(1);
    expect(d.m.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT,
        ventaId: 'nc-1',
        emisor: 'sistema',
        tipoDocumentoId: 'tipo-nc',
        estadoEnvio: 'armado',
        numero: null,
        monto: '26610.0000',
        montoAfecto: '19000.0000',
        montoExento: '4000.0000',
        montoImpuestos: '3610.0000',
        documentoCorregidoId: 'd-orig',
        esDuplicado: false,
        pagoId: null,
      }),
    );
    // Los baldes se leen de las líneas de ESA corrección.
    const [sql, binds] = d.m.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/FROM venta_detalles/);
    expect(sql).toMatch(/eliminado_el IS NULL/);
    expect(binds).toEqual(['nc-1']);
  });

  it('externo: NC sin número y sin estado de envío, con el tipo NC y baldes', async () => {
    const d = documentar('externo', 'tipo-nc');
    await d.run();

    expect(d.m.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        emisor: 'externo',
        tipoDocumentoId: 'tipo-nc',
        estadoEnvio: null,
        numero: null,
        montoAfecto: '19000.0000',
      }),
    );
  });

  it('máquina: NC sin número, con el tipo NC, sin baldes ni lectura de líneas', async () => {
    const d = documentar('maquina', 'tipo-nc');
    await d.run();

    expect(d.m.query).not.toHaveBeenCalled();
    expect(d.m.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        emisor: 'maquina',
        tipoDocumentoId: 'tipo-nc',
        estadoEnvio: null,
        numero: null,
        montoAfecto: null,
        montoExento: null,
        montoImpuestos: null,
      }),
    );
  });

  it('nadie: devolución interna, sin tipo (aunque el país tenga NC) y sin baldes', async () => {
    const d = documentar('nadie', 'tipo-nc');
    await d.run();

    expect(d.m.query).not.toHaveBeenCalled();
    expect(d.m.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        emisor: 'nadie',
        tipoDocumentoId: null,
        estadoEnvio: null,
        montoAfecto: null,
        documentoCorregidoId: 'd-orig',
      }),
    );
  });

  it('un documento con tipo y sin el tipo NC del país es un error, no una fila sin tipo', async () => {
    await expect(documentar('sistema', null).run()).rejects.toThrow(
      InternalServerErrorException,
    );
  });
});
