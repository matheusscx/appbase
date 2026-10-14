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

  it('total $0 → TOTAL_NO_POSITIVO', () => {
    const d = boleta({
      lineas: [
        linea({ monto: '0', cantidad: undefined, precioUnitario: undefined }),
      ],
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

  it('línea negativa → MONTO_NEGATIVO', () => {
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

describe('verificarMontos: entradas que el SII rechaza', () => {
  const con = (over: Partial<LineaBoleta>) => boleta({ lineas: [linea(over)] });

  it('el borde exacto de 1,00 de la tolerancia de línea no cierra', () => {
    // 1490 × 3 − 1 = 4469 contra un MontoItem de 4470: se aparta justo un peso.
    expect(codigo(() => verificarMontos(con({ descuentoMonto: '1' })))).toBe(
      'LINEA_NO_CIERRA',
    );
  });

  it('0,99 de diferencia sí cierra', () => {
    // 1490,33 × 3 = 4470,99 contra 4470.
    expect(verificarMontos(con({ precioUnitario: '1490.33' }))).toEqual({
      diferenciaIvaRedondeo: '0',
    });
  });

  it.each([
    ['monto', { monto: 'abc' }],
    ['monto vacío', { monto: '' }],
    ['monto NaN', { monto: 'NaN' }],
    ['monto Infinity', { monto: 'Infinity' }],
    ['cantidad', { cantidad: 'tres' }],
    ['precioUnitario', { precioUnitario: 'x' }],
    ['descuentoMonto', { descuentoMonto: 'x' }],
    ['recargoMonto', { recargoMonto: 'x' }],
  ] as Array<[string, Partial<LineaBoleta>]>)(
    '%s que no es un número → MONTO_INVALIDO, nunca un DecimalError',
    (_, over) => {
      expect(codigo(() => verificarMontos(con(over)))).toBe('MONTO_INVALIDO');
    },
  );

  it.each(['neto', 'exento', 'iva', 'total', 'adicionales'] as const)(
    'el total congelado %s que no es un número → MONTO_INVALIDO',
    (campo) => {
      const d = boleta();
      expect(
        codigo(() =>
          verificarMontos({ ...d, montos: { ...d.montos, [campo]: 'x' } }),
        ),
      ).toBe('MONTO_INVALIDO');
    },
  );

  it('el ValorDR que no es un número → MONTO_INVALIDO', () => {
    const d = boleta({
      ajustesGlobales: [
        { tipo: 'D', glosa: 'Promo', monto: 'x', exento: false },
      ],
    });
    expect(codigo(() => verificarMontos(d))).toBe('MONTO_INVALIDO');
  });

  it.each([
    ['cantidad 0 (no describe una venta)', { cantidad: '0', monto: '0' }],
    ['cantidad negativa', { cantidad: '-3' }],
    ['precio negativo', { precioUnitario: '-1490' }],
    ['cantidad con 7 decimales', { cantidad: '0.1234567', monto: '0' }],
    ['precio con 7 decimales', { precioUnitario: '1490.1234567' }],
  ] as Array<[string, Partial<LineaBoleta>]>)(
    '%s → MONTO_INVALIDO',
    (_, over) => {
      expect(codigo(() => verificarMontos(con(over)))).toBe('MONTO_INVALIDO');
    },
  );

  it('una línea gratis (precio 0, monto 0) junto a una pagada cierra; el IVA sale de la pagada', () => {
    const d = boleta({
      lineas: [
        linea(),
        linea({
          nombre: 'Cortesía',
          cantidad: '1',
          precioUnitario: '0',
          monto: '0',
        }),
      ],
    });
    expect(verificarMontos(d)).toEqual({ diferenciaIvaRedondeo: '0' });
  });

  it('precio 0 sin cantidad con monto > 0: saldría como línea pagada sin precio → MONTO_INVALIDO', () => {
    const d = boleta({
      lineas: [linea({ cantidad: undefined, precioUnitario: '0' })],
    });
    expect(codigo(() => verificarMontos(d))).toBe('MONTO_INVALIDO');
  });

  it('precio 0 con un descuento en pesos: el monto quedaría negativo → LINEA_NO_CIERRA', () => {
    const d = boleta({
      lineas: [
        linea(),
        linea({
          cantidad: '1',
          precioUnitario: '0',
          descuentoMonto: '100',
          monto: '0',
        }),
      ],
    });
    expect(codigo(() => verificarMontos(d))).toBe('LINEA_NO_CIERRA');
  });

  it('cantidad y precio con exactamente 6 decimales sí pasan', () => {
    const d = con({
      cantidad: '1.000000',
      precioUnitario: '4470.000000',
    });
    expect(verificarMontos(d)).toEqual({ diferenciaIvaRedondeo: '0' });
  });

  it.each([
    ['descuentoMonto con decimales', { descuentoMonto: '1.5' }],
    ['descuentoMonto negativo', { descuentoMonto: '-1' }],
    ['recargoMonto con decimales', { recargoMonto: '0.5' }],
    ['recargoMonto negativo', { recargoMonto: '-1' }],
  ] as Array<[string, Partial<LineaBoleta>]>)(
    '%s → MONTO_INVALIDO',
    (_, over) => {
      expect(codigo(() => verificarMontos(con(over)))).toBe('MONTO_INVALIDO');
    },
  );

  it('descuentoMonto y recargoMonto en 0 sí pasan', () => {
    expect(
      verificarMontos(con({ descuentoMonto: '0', recargoMonto: '0' })),
    ).toEqual({ diferenciaIvaRedondeo: '0' });
  });

  it('un ValorDR en 0 → MONTO_INVALIDO (el XSD pide más que 0)', () => {
    const d = boleta({
      ajustesGlobales: [
        { tipo: 'D', glosa: 'Promo', monto: '0', exento: false },
      ],
    });
    expect(codigo(() => verificarMontos(d))).toBe('MONTO_INVALIDO');
  });

  it('1000 líneas pasan el conteo y 1001 dan DEMASIADAS_LINEAS', () => {
    const una = linea({
      cantidad: undefined,
      precioUnitario: undefined,
      monto: '1',
    });
    const con1000 = boleta({
      lineas: Array.from({ length: 1000 }, () => una),
      montos: {
        neto: '840',
        exento: '0',
        iva: '160',
        total: '1000',
        adicionales: '0',
      },
    });
    expect(codigo(() => verificarMontos(con1000))).not.toBe(
      'DEMASIADAS_LINEAS',
    );
    const con1001 = boleta({ lineas: Array.from({ length: 1001 }, () => una) });
    expect(codigo(() => verificarMontos(con1001))).toBe('DEMASIADAS_LINEAS');
  });

  it('20 ajustes globales pasan el conteo y 21 dan DEMASIADAS_LINEAS', () => {
    const ajuste = {
      tipo: 'D' as const,
      glosa: 'Promo',
      monto: '1',
      exento: false,
    };
    const con20 = boleta({
      ajustesGlobales: Array.from({ length: 20 }, () => ajuste),
    });
    expect(codigo(() => verificarMontos(con20))).not.toBe('DEMASIADAS_LINEAS');
    const con21 = boleta({
      ajustesGlobales: Array.from({ length: 21 }, () => ajuste),
    });
    expect(codigo(() => verificarMontos(con21))).toBe('DEMASIADAS_LINEAS');
  });
});
