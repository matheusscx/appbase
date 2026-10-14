import type { DatosBoleta, LineaBoleta } from './dte.types';
import { verificarMontos } from './montos';

const linea = (over: Partial<LineaBoleta> = {}): LineaBoleta => ({
  nombre: 'Café',
  cantidad: '3',
  precioUnitario: '1490',
  monto: '4470',
  exenta: false,
  ...over,
});

const boleta = (over: Partial<DatosBoleta> = {}): DatosBoleta => ({
  tipo: 39,
  folio: 101,
  fechaEmision: '2026-10-14',
  emisor: {
    rut: '76543210-3',
    razonSocial: 'Panadería Ñuñoa SpA',
    giro: 'Panadería',
    direccion: 'Irarrázaval 2401',
    comuna: 'Ñuñoa',
  },
  proveedorSoftware: { rut: '77777777-7', razonSocial: 'Venka SpA' },
  superaUmbralIdentificacion: false,
  lineas: [linea()],
  ajustesGlobales: [],
  // 4470 / 1,19 = 3756,30 → neto 3756; IVA 714 (0,19 × 3756 = 713,64 → 714). Cierra sin aviso.
  montos: {
    neto: '3756',
    exento: '0',
    iva: '714',
    total: '4470',
    adicionales: '0',
  },
  ...over,
});

const codigo = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { codigo?: string }).codigo;
  }
  return 'NO_LANZO';
};

describe('verificarMontos', () => {
  it('una boleta afecta que cierra no avisa nada', () => {
    expect(verificarMontos(boleta())).toEqual({ diferenciaIvaRedondeo: '0' });
  });

  it('góndola $993: sale con el IVA congelado y avisa un peso (spec § 4.4)', () => {
    const d = boleta({
      lineas: [linea({ cantidad: '1', precioUnitario: '993', monto: '993' })],
      montos: {
        neto: '834',
        exento: '0',
        iva: '159',
        total: '993',
        adicionales: '0',
      },
    });
    expect(verificarMontos(d)).toEqual({ diferenciaIvaRedondeo: '1' });
  });

  it('total distinto de neto + IVA + exento → TOTALES_NO_CIERRAN', () => {
    expect(
      codigo(() =>
        verificarMontos(
          boleta({
            montos: {
              neto: '3756',
              exento: '0',
              iva: '714',
              total: '4471',
              adicionales: '0',
            },
          }),
        ),
      ),
    ).toBe('TOTALES_NO_CIERRAN');
  });

  it('líneas afectas que no suman neto + IVA → TOTALES_NO_CIERRAN', () => {
    expect(
      codigo(() =>
        verificarMontos(
          boleta({
            lineas: [linea({ monto: '4480', precioUnitario: '1493.333333' })],
          }),
        ),
      ),
    ).toBe('TOTALES_NO_CIERRAN');
  });

  it('boleta mixta: las exentas suman MntExe y las afectas neto + IVA', () => {
    const d = boleta({
      lineas: [
        linea(),
        linea({
          nombre: 'Libro',
          cantidad: '2',
          precioUnitario: '7350',
          monto: '14700',
          exenta: true,
        }),
      ],
      montos: {
        neto: '3756',
        exento: '14700',
        iva: '714',
        total: '19170',
        adicionales: '0',
      },
    });
    expect(verificarMontos(d)).toEqual({ diferenciaIvaRedondeo: '0' });
  });

  it('exentas que no suman MntExe → TOTALES_NO_CIERRAN', () => {
    const d = boleta({
      lineas: [
        linea(),
        linea({
          nombre: 'Libro',
          cantidad: '2',
          precioUnitario: '7350',
          monto: '14700',
          exenta: true,
        }),
      ],
      montos: {
        neto: '3756',
        exento: '14600',
        iva: '714',
        total: '19070',
        adicionales: '0',
      },
    });
    expect(codigo(() => verificarMontos(d))).toBe('TOTALES_NO_CIERRAN');
  });

  it('descuento global afecto: líneas − descuento = neto + IVA', () => {
    // 4470 − 470 = 4000 → 4000/1,19 = 3361,34 → neto 3361; IVA 639 (0,19 × 3361 = 638,59 → 639).
    const d = boleta({
      ajustesGlobales: [
        { tipo: 'D', glosa: 'Descuento', monto: '470', exento: false },
      ],
      montos: {
        neto: '3361',
        exento: '0',
        iva: '639',
        total: '4000',
        adicionales: '0',
      },
    });
    expect(verificarMontos(d)).toEqual({ diferenciaIvaRedondeo: '0' });
  });

  it('recargo global afecto suma a la base', () => {
    // 4470 + 530 = 5000 → neto 4202 (4201,68); IVA 798 (0,19 × 4202 = 798,38 → 798).
    const d = boleta({
      ajustesGlobales: [
        { tipo: 'R', glosa: 'Recargo', monto: '530', exento: false },
      ],
      montos: {
        neto: '4202',
        exento: '0',
        iva: '798',
        total: '5000',
        adicionales: '0',
      },
    });
    expect(verificarMontos(d)).toEqual({ diferenciaIvaRedondeo: '0' });
  });

  it('granel: 0,375 × 2990 = 1121,25 y MontoItem 1121 cierra (menos de un peso)', () => {
    // 1121 / 1,19 = 942,02 → neto 942; IVA 179 (0,19 × 942 = 178,98 → 179).
    const d = boleta({
      lineas: [
        linea({
          nombre: 'Queso',
          cantidad: '0.375',
          precioUnitario: '2990',
          monto: '1121',
        }),
      ],
      montos: {
        neto: '942',
        exento: '0',
        iva: '179',
        total: '1121',
        adicionales: '0',
      },
    });
    expect(verificarMontos(d)).toEqual({ diferenciaIvaRedondeo: '0' });
  });

  it('una línea que se aparta un peso o más de precio × cantidad − desc + rec → LINEA_NO_CIERRA', () => {
    const d = boleta({
      lineas: [
        linea({
          cantidad: '3',
          precioUnitario: '1490',
          descuentoMonto: '20',
          monto: '4470',
        }),
      ],
    });
    expect(codigo(() => verificarMontos(d))).toBe('LINEA_NO_CIERRA');
  });

  it('una línea sin cantidad ni precio (servicio) solo aporta su monto', () => {
    const d = boleta({
      lineas: [linea({ cantidad: undefined, precioUnitario: undefined })],
    });
    expect(verificarMontos(d)).toEqual({ diferenciaIvaRedondeo: '0' });
  });

  it.each([
    ['neto con decimales', { neto: '3756.5' }],
    ['total con decimales', { total: '4470.5' }],
  ])('%s → MONTO_NO_ENTERO', (_, m) => {
    const d = boleta();
    expect(
      codigo(() => verificarMontos({ ...d, montos: { ...d.montos, ...m } })),
    ).toBe('MONTO_NO_ENTERO');
  });

  it('total $0 → TOTAL_NO_POSITIVO (Review Focus 4)', () => {
    const d = boleta({
      lineas: [linea({ monto: '0', precioUnitario: '0' })],
      montos: {
        neto: '0',
        exento: '0',
        iva: '0',
        total: '0',
        adicionales: '0',
      },
    });
    expect(codigo(() => verificarMontos(d))).toBe('TOTAL_NO_POSITIVO');
  });

  it('línea negativa → MONTO_NEGATIVO (Review Focus 4)', () => {
    const d = boleta({
      lineas: [
        linea(),
        linea({
          nombre: 'Ajuste',
          cantidad: undefined,
          precioUnitario: undefined,
          monto: '-100',
        }),
      ],
    });
    expect(codigo(() => verificarMontos(d))).toBe('MONTO_NEGATIVO');
  });

  it('impuesto adicional > 0 → IMPUESTO_ADICIONAL_NO_SOPORTADO', () => {
    const d = boleta();
    expect(
      codigo(() =>
        verificarMontos({ ...d, montos: { ...d.montos, adicionales: '250' } }),
      ),
    ).toBe('IMPUESTO_ADICIONAL_NO_SOPORTADO');
  });

  it('boleta 41 con una línea afecta o con neto → BOLETA_EXENTA_CON_AFECTO', () => {
    expect(codigo(() => verificarMontos(boleta({ tipo: 41 })))).toBe(
      'BOLETA_EXENTA_CON_AFECTO',
    );
  });

  it('boleta 41 toda exenta cierra y no avisa', () => {
    const d = boleta({
      tipo: 41,
      lineas: [
        linea({
          nombre: 'Libro',
          cantidad: '2',
          precioUnitario: '7350',
          monto: '14700',
          exenta: true,
        }),
      ],
      montos: {
        neto: '0',
        exento: '14700',
        iva: '0',
        total: '14700',
        adicionales: '0',
      },
    });
    expect(verificarMontos(d)).toEqual({ diferenciaIvaRedondeo: '0' });
  });
});
