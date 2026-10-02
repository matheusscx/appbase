import { InternalServerErrorException } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { EntityManager } from 'typeorm';
import type { ConfigCalculo } from '../calculo-precios/calculo-precios.engine';
import type { PorcionOriginal } from '../ventas/nota-credito-composicion';
import {
  VentaDocumentosService,
  componerBaldes,
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
