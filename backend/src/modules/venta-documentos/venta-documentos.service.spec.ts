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
  const save = jest.fn((_entidad: unknown, filas: Record<string, unknown>[]) =>
    Promise.resolve(filas),
  );
  const create = jest.fn(
    (_entidad: unknown, datos: Record<string, unknown>) => ({
      ...datos,
    }),
  );
  return {
    save,
    create,
    manager: { save, create } as unknown as EntityManager,
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

  it('arma un solo SELECT con la venta y sus correcciones, y mapea la fila', async () => {
    const m = managerConLectura([FILA]);
    const docs = await new VentaDocumentosService().listarParaDetalle(
      m.manager,
      { tenantId: TENANT, ventaId: VENTA },
    );
    expect(m.query).toHaveBeenCalledTimes(1);
    const [sql, binds] = m.query.mock.calls[0] as [string, unknown[]];
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
      },
    ]);
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
