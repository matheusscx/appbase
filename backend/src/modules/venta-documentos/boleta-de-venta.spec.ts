import {
  cafDePrueba,
  certificadoDePrueba,
} from '../dte/__fixtures__/credenciales-prueba';
import { leerCaf } from '../dte/caf';
import { type CodigoDteError, DteError } from '../dte/dte.types';
import { emitirBoleta } from '../dte/envio-boleta';
import { leerCertificado } from '../dte/firma';
import {
  datosBoletaDeVenta,
  grupoDelError,
  NOMBRE_LINEA_SALDO,
  NOMBRE_LINEA_SALDO_EXENTO,
  tipoBoletaDe,
  type LineaParaBoleta,
  type VentaParaBoleta,
} from './boleta-de-venta';

// El día de la firma NO es el de la venta: así se ve que la fecha de la boleta sale de la venta.
const AHORA = '2026-10-14T12:00:00';
const FECHA_VENTA = '2026-10-10';

const EMISOR = {
  rut: '76543210-3',
  razonSocial: 'Panadería Ñuñoa SpA',
  giro: 'Panadería',
  direccion: 'Irarrázaval 2401',
  comuna: 'Peñalolén',
};
const PROVEEDOR = { rut: '77777777-7', razonSocial: 'Venka SpA' };

const caf39 = leerCaf(
  cafDePrueba({ rut: EMISOR.rut, tipo: 39, desde: 1, hasta: 600 }),
);
const caf41 = leerCaf(
  cafDePrueba({ rut: EMISOR.rut, tipo: 41, desde: 1, hasta: 50 }),
);
const { pfx, clave } = certificadoDePrueba();
const certificado = leerCertificado(pfx, clave);

/** Arma los datos y los pasa por el motor, que es quien verifica las igualdades de verdad. */
const datos = (v: VentaParaBoleta, folio = 7) =>
  datosBoletaDeVenta(v, folio, EMISOR, PROVEEDOR);
const emitir = (v: VentaParaBoleta) => {
  const d = datos(v);
  return emitirBoleta(
    d,
    { caf: d.tipo === 39 ? caf39 : caf41, certificado },
    AHORA,
  );
};

const linea = (over: Partial<LineaParaBoleta> = {}): LineaParaBoleta => ({
  descripcion: 'Café',
  cantidad: '3',
  subtotal: '7563',
  totalLinea: '9000',
  exenta: false,
  tasaIva: '0.19',
  ...over,
});

const venta = (over: Partial<VentaParaBoleta> = {}): VentaParaBoleta => ({
  fechaVenta: FECHA_VENTA,
  lineas: [linea()],
  documento: {
    monto: '9000',
    montoAfecto: '7563',
    montoExento: '0',
    montoImpuestos: '1437',
    cubreTodo: true,
  },
  adicionales: '0',
  receptor: null,
  superaUmbral: false,
  pagos: [],
  ...over,
});

const cuenta = (xml: string, etiqueta: string) =>
  xml.match(new RegExp(`<${etiqueta}>`, 'g'))?.length ?? 0;

describe('datosBoletaDeVenta', () => {
  describe('venta que el documento cubre entera', () => {
    it('dos líneas afectas, una con un descuento de venta repartido: sale y esa línea lleva DescuentoMonto', () => {
      const v = venta({
        lineas: [
          linea(),
          linea({
            descripcion: 'Torta',
            cantidad: '2',
            subtotal: '12605',
            // 14.999,95 a precio de lista menos 2.000 de descuentos (línea y venta)
            totalLinea: '13000',
          }),
        ],
        documento: {
          monto: '22000',
          montoAfecto: '18487',
          montoExento: '0',
          montoImpuestos: '3513',
          cubreTodo: true,
        },
      });
      const d = datos(v);
      expect(d.lineas[0]).toEqual({
        nombre: 'Café',
        cantidad: '3',
        precioUnitario: '2999.99',
        monto: '9000',
        exenta: false,
      });
      expect(d.lineas[1]).toMatchObject({
        nombre: 'Torta',
        cantidad: '2',
        precioUnitario: '7499.975',
        descuentoMonto: '2000',
        monto: '13000',
      });
      expect(d.lineas[1].recargoMonto).toBeUndefined();

      const b = emitir(v);
      expect(cuenta(b.xml, 'DescuentoMonto')).toBe(1);
      expect(b.xml).toContain('<DescuentoMonto>2000</DescuentoMonto>');
    });

    it('un recargo de venta repartido sale como RecargoMonto', () => {
      const v = venta({
        lineas: [
          linea({ cantidad: '2', subtotal: '8403', totalLinea: '10500' }),
        ],
        documento: {
          monto: '10500',
          montoAfecto: '8824',
          montoExento: '0',
          montoImpuestos: '1676',
          cubreTodo: true,
        },
      });
      const d = datos(v);
      expect(d.lineas[0].recargoMonto).toBe('500');
      expect(d.lineas[0].descuentoMonto).toBeUndefined();
      expect(emitir(v).xml).toContain('<RecargoMonto>500</RecargoMonto>');
    });

    it('una línea a granel (0,375 kg) con descuento cierra con la tolerancia del motor', () => {
      const v = venta({
        lineas: [
          linea({
            descripcion: 'Jamón a granel',
            cantidad: '0.375',
            subtotal: '1000',
            totalLinea: '1121',
          }),
        ],
        documento: {
          monto: '1121',
          montoAfecto: '942',
          montoExento: '0',
          montoImpuestos: '179',
          cubreTodo: true,
        },
      });
      const d = datos(v);
      // 1000 / 0,375 × 1,19 = 3.173,333333… a 6 decimales; × 0,375 = 1.189,99999875
      expect(d.lineas[0].precioUnitario).toBe('3173.333333');
      expect(d.lineas[0].cantidad).toBe('0.375');
      // 1.189,99999875 − 1.121 = 68,99999875 → 69 pesos
      expect(d.lineas[0].descuentoMonto).toBe('69');
      const b = emitir(v);
      expect(b.xml).toContain('<QtyItem>0.375</QtyItem>');
      expect(b.xml).toContain('<DescuentoMonto>69</DescuentoMonto>');
    });

    it('el descuento en pesos se redondea hacia arriba desde la mitad (1.974,53 → 1.975)', () => {
      const v = venta({
        lineas: [
          linea({ cantidad: '0.3333', subtotal: '2487', totalLinea: '985' }),
        ],
        documento: {
          monto: '985',
          montoAfecto: '828',
          montoExento: '0',
          montoImpuestos: '157',
          cubreTodo: true,
        },
      });
      const d = datos(v);
      // 2487 / 0,3333 × 1,19 = 8.879,477948 (6 decimales); × 0,3333 = 2.959,53; − 985 = 1.974,53
      expect(d.lineas[0].precioUnitario).toBe('8879.477948');
      expect(d.lineas[0].descuentoMonto).toBe('1975');
      expect(emitir(v).xml).toContain('<DescuentoMonto>1975</DescuentoMonto>');
    });

    it('afecta más exenta: tipo 39 con una línea exenta', () => {
      const v = venta({
        lineas: [
          linea({ cantidad: '4', subtotal: '8403', totalLinea: '10000' }),
          linea({
            descripcion: 'Pan integral',
            cantidad: '3',
            subtotal: '2500',
            totalLinea: '2500',
            exenta: true,
            tasaIva: '0',
          }),
        ],
        documento: {
          monto: '12500',
          montoAfecto: '8403',
          montoExento: '2500',
          montoImpuestos: '1597',
          cubreTodo: true,
        },
      });
      const d = datos(v);
      expect(d.tipo).toBe(39);
      expect(d.lineas.map((l) => l.exenta)).toEqual([false, true]);
      expect(d.montos).toEqual({
        neto: '8403',
        exento: '2500',
        iva: '1597',
        total: '12500',
        adicionales: '0',
      });
      const b = emitir(v);
      expect(b.tipo).toBe(39);
      expect(cuenta(b.xml, 'IndExe')).toBe(1);
    });

    it('todo exento: tipo 41 sin neto ni IVA', () => {
      const v = venta({
        lineas: [
          linea({
            cantidad: '3',
            subtotal: '2500',
            totalLinea: '2500',
            exenta: true,
            tasaIva: '0',
          }),
          linea({
            descripcion: 'Leche',
            cantidad: '2',
            subtotal: '1800',
            totalLinea: '1800',
            exenta: true,
            tasaIva: '0',
          }),
        ],
        documento: {
          monto: '4300',
          montoAfecto: '0',
          montoExento: '4300',
          montoImpuestos: '0',
          cubreTodo: true,
        },
      });
      const b = emitir(v);
      expect(b.tipo).toBe(41);
      expect(cuenta(b.xml, 'MntNeto')).toBe(0);
      expect(cuenta(b.xml, 'IVA')).toBe(0);
      expect(b.xml).toContain('<MntExe>4300</MntExe>');
    });

    it('la venta que un descuento deja en $0 sale con la línea a precio de lista y su DescuentoMonto', () => {
      const v = venta({
        lineas: [linea({ cantidad: '2', subtotal: '10084', totalLinea: '0' })],
        documento: {
          monto: '0',
          montoAfecto: '0',
          montoExento: '0',
          montoImpuestos: '0',
          cubreTodo: true,
        },
      });
      const d = datos(v);
      expect(d.lineas[0].descuentoMonto).toBe('12000');
      const b = emitir(v);
      expect(b.xml).toContain('<MntTotal>0</MntTotal>');
      expect(b.xml).toContain('<DescuentoMonto>12000</DescuentoMonto>');
    });

    it('un total 0 sin descuento que lo explique (todo cortesía) sigue siendo TOTAL_NO_POSITIVO', () => {
      const v = venta({
        lineas: [
          linea({ cantidad: '2', subtotal: '0', totalLinea: '0' }),
          linea({ cantidad: '4', subtotal: '0', totalLinea: '0' }),
        ],
        documento: {
          monto: '0',
          montoAfecto: '0',
          montoExento: '0',
          montoImpuestos: '0',
          cubreTodo: true,
        },
      });
      expect(() => emitir(v)).toThrow(
        expect.objectContaining({ codigo: 'TOTAL_NO_POSITIVO' }),
      );
    });

    it('una línea de subtotal 0 (cortesía) sale sin precio y con la cantidad de la venta', () => {
      const v = venta({
        lineas: [
          linea(),
          linea({
            descripcion: 'Cortesía',
            cantidad: '5',
            subtotal: '0',
            totalLinea: '0',
          }),
        ],
      });
      const d = datos(v);
      expect(d.lineas[1]).toEqual({
        nombre: 'Cortesía',
        cantidad: '5',
        monto: '0',
        exenta: false,
      });
      expect(d.lineas[1].precioUnitario).toBeUndefined();
      const b = emitir(v);
      expect(cuenta(b.xml, 'PrcItem')).toBe(1);
      expect(b.xml).toContain('<QtyItem>5</QtyItem><MontoItem>0</MontoItem>');
    });

    it.each([null, '', '   '])(
      'una línea sin nombre (%j) no llega al motor: LINEA_SIN_NOMBRE con el número de la línea',
      (descripcion) => {
        const v = venta({ lineas: [linea(), linea({ descripcion })] });
        const intento = () => datos(v);
        expect(intento).toThrow(DteError);
        expect(intento).toThrow(
          expect.objectContaining({
            codigo: 'LINEA_SIN_NOMBRE',
            message: expect.stringContaining('La línea 2 de la venta'),
          }),
        );
      },
    );

    it('el documento parcial no mira los nombres de las líneas (no las lleva)', () => {
      const v = venta({
        lineas: [linea({ descripcion: null })],
        documento: {
          monto: '9000',
          montoAfecto: '7563',
          montoExento: '0',
          montoImpuestos: '1437',
          cubreTodo: false,
        },
      });
      expect(datos(v).lineas[0].nombre).toBe(NOMBRE_LINEA_SALDO);
    });

    it('sin líneas ni nada que tocar: el motor dice SIN_LINEAS', () => {
      expect(() => emitir(venta({ lineas: [] }))).toThrow(
        expect.objectContaining({ codigo: 'SIN_LINEAS' }),
      );
    });
  });

  describe('documento que cubre una parte (pago mixto)', () => {
    const parcial = (montoExento = '0'): VentaParaBoleta =>
      venta({
        lineas: [linea(), linea({ descripcion: 'Torta' })],
        documento: {
          monto: String(60000 + Number(montoExento)),
          montoAfecto: '50420',
          montoExento,
          montoImpuestos: '9580',
          cubreTodo: false,
        },
      });

    it('una línea "Saldo de la venta" por afecto más IVA, sin cantidad ni precio', () => {
      const v = parcial();
      const d = datos(v);
      expect(d.lineas).toEqual([
        { nombre: NOMBRE_LINEA_SALDO, monto: '60000', exenta: false },
      ]);
      expect(d.tipo).toBe(39);
      const b = emitir(v);
      expect(b.xml).toContain(`<NmbItem>${NOMBRE_LINEA_SALDO}</NmbItem>`);
      expect(cuenta(b.xml, 'QtyItem')).toBe(0);
    });

    it('con parte exenta, una segunda línea "(exento)"', () => {
      const v = parcial('4500');
      const d = datos(v);
      expect(d.lineas).toEqual([
        { nombre: NOMBRE_LINEA_SALDO, monto: '60000', exenta: false },
        { nombre: NOMBRE_LINEA_SALDO_EXENTO, monto: '4500', exenta: true },
      ]);
      expect(d.montos.total).toBe('64500');
      expect(cuenta(emitir(v).xml, 'Detalle')).toBe(2);
    });

    it('las líneas de saldo nunca llevan descuento ni recargo (el motor no las verifica)', () => {
      for (const v of [parcial(), parcial('4500')]) {
        for (const l of datos(v).lineas) {
          expect(l).not.toHaveProperty('descuentoMonto');
          expect(l).not.toHaveProperty('recargoMonto');
          expect(l).not.toHaveProperty('cantidad');
          expect(l).not.toHaveProperty('precioUnitario');
        }
      }
    });

    it('solo exento: una sola línea exenta y tipo 41', () => {
      const v = venta({
        documento: {
          monto: '4500',
          montoAfecto: '0',
          montoExento: '4500',
          montoImpuestos: '0',
          cubreTodo: false,
        },
      });
      const d = datos(v);
      expect(d.tipo).toBe(41);
      expect(d.lineas).toEqual([
        { nombre: NOMBRE_LINEA_SALDO_EXENTO, monto: '4500', exenta: true },
      ]);
      expect(emitir(v).tipo).toBe(41);
    });

    it('si todo vale cero, una sola línea afecta de 0', () => {
      const d = datos(
        venta({
          documento: {
            monto: '0',
            montoAfecto: '0',
            montoExento: '0',
            montoImpuestos: '0',
            cubreTodo: false,
          },
        }),
      );
      expect(d.lineas).toEqual([
        { nombre: NOMBRE_LINEA_SALDO, monto: '0', exenta: false },
      ]);
    });
  });

  describe('sobre 135 UF', () => {
    const grande = (over: Partial<VentaParaBoleta> = {}) =>
      venta({
        lineas: [
          linea({ cantidad: '2', subtotal: '4202521', totalLinea: '5001000' }),
        ],
        documento: {
          monto: '5001000',
          montoAfecto: '4202521',
          montoExento: '0',
          montoImpuestos: '798479',
          cubreTodo: true,
        },
        receptor: {
          rut: '12345678-5',
          nombre: 'Rosa Pérez',
          correo: null,
          telefono: null,
        },
        superaUmbral: true,
        pagos: [
          { monto: '1000', medioPagoSii: 1 },
          { monto: '5000000', medioPagoSii: 2 },
        ],
        ...over,
      });

    it('el medio de pago es el del pago de mayor monto', () => {
      const v = grande();
      expect(datos(v).medioPago).toBe(2);
      expect(emitir(v).xml).toContain('<MedioPago>2</MedioPago>');
    });

    it('el mayor se compara como número, no como texto ("900" vs "1000")', () => {
      const v = grande({
        pagos: [
          { monto: '900', medioPagoSii: 2 },
          { monto: '1000', medioPagoSii: 1 },
          { monto: '5000000', medioPagoSii: 3 },
        ],
      });
      // el 5.000.000 es el mayor; con solo los dos primeros el mayor es el de 1.000
      expect(datos(v).medioPago).toBe(3);
      expect(
        datos(
          grande({
            pagos: [
              { monto: '900', medioPagoSii: 2 },
              { monto: '1000', medioPagoSii: 1 },
            ],
          }),
        ).medioPago,
      ).toBe(1);
    });

    it('el pago mayor sin código se manda como 5, aunque el menor tenga uno', () => {
      const v = grande({
        pagos: [
          { monto: '1000', medioPagoSii: 1 },
          { monto: '5000000', medioPagoSii: null },
        ],
      });
      expect(datos(v).medioPago).toBe(5);
      expect(emitir(v).xml).toContain('<MedioPago>5</MedioPago>');
    });

    it('en un empate gana el primero registrado', () => {
      const v = grande({
        pagos: [
          { monto: '2500500', medioPagoSii: 3 },
          { monto: '2500500', medioPagoSii: 1 },
        ],
      });
      expect(datos(v).medioPago).toBe(3);
    });

    it('sin pagos no hay medio de pago, y el motor pide la identificación completa', () => {
      const v = grande({ pagos: [] });
      expect(datos(v).medioPago).toBeUndefined();
      expect(() => emitir(v)).toThrow(
        expect.objectContaining({ codigo: 'FALTA_IDENTIFICACION_135_UF' }),
      );
    });

    it('bajo el umbral no se manda medio de pago aunque haya pagos', () => {
      const d = datos(venta({ pagos: [{ monto: '9000', medioPagoSii: 1 }] }));
      expect(d.superaUmbralIdentificacion).toBe(false);
      expect(d.medioPago).toBeUndefined();
    });
  });

  describe('receptor, fecha y adicionales', () => {
    it('el receptor va solo si trae RUT, y sin los datos que faltan', () => {
      expect(datos(venta({ receptor: null })).receptor).toBeUndefined();
      expect(
        datos(
          venta({
            receptor: {
              rut: '',
              nombre: 'Sin rut',
              correo: null,
              telefono: null,
            },
          }),
        ).receptor,
      ).toBeUndefined();
      expect(
        datos(
          venta({
            receptor: {
              rut: '12345678-5',
              nombre: 'Rosa Pérez',
              correo: null,
              telefono: '912345678',
            },
          }),
        ).receptor,
      ).toEqual({
        rut: '12345678-5',
        nombre: 'Rosa Pérez',
        telefono: '912345678',
      });
    });

    it('fechaEmision es la de la venta aunque el ahora de la firma sea otro día', () => {
      const d = datos(venta());
      expect(d.fechaEmision).toBe(FECHA_VENTA);
      const b = emitir(venta());
      expect(b.xml).toContain(`<FchEmis>${FECHA_VENTA}</FchEmis>`);
      expect(b.xml).toContain(`<TmstFirma>${AHORA}</TmstFirma>`);
    });

    it('lleva el folio, el emisor y el proveedor que se le pasan, y ningún ajuste global', () => {
      const d = datosBoletaDeVenta(venta(), 77, EMISOR, PROVEEDOR);
      expect(d.folio).toBe(77);
      expect(d.emisor).toBe(EMISOR);
      expect(d.proveedorSoftware).toBe(PROVEEDOR);
      expect(d.ajustesGlobales).toEqual([]);
    });

    it('impuestos adicionales: el motor dice IMPUESTO_ADICIONAL_NO_SOPORTADO', () => {
      const v = venta({ adicionales: '500' });
      expect(datos(v).montos.adicionales).toBe('500');
      expect(() => emitir(v)).toThrow(
        expect.objectContaining({ codigo: 'IMPUESTO_ADICIONAL_NO_SOPORTADO' }),
      );
    });
  });
});

describe('tipoBoletaDe', () => {
  const exenta = linea({ exenta: true, tasaIva: '0' });
  const doc = (
    cubreTodo: boolean,
    montoAfecto: string,
    montoImpuestos: string,
  ) => ({
    monto: '1000',
    montoAfecto,
    montoExento: '0',
    montoImpuestos,
    cubreTodo,
  });

  it('cubriendo todo: 41 si todas las líneas son exentas', () => {
    expect(
      tipoBoletaDe(
        venta({ lineas: [exenta, exenta], documento: doc(true, '0', '0') }),
      ),
    ).toBe(41);
  });

  it('cubriendo todo: 39 si alguna línea no es exenta, aunque los baldes afectos sean 0', () => {
    expect(
      tipoBoletaDe(
        venta({ lineas: [exenta, linea()], documento: doc(true, '0', '0') }),
      ),
    ).toBe(39);
  });

  it('cubriendo todo y sin líneas: 39 (no hay "todas exentas" que valga)', () => {
    expect(
      tipoBoletaDe(venta({ lineas: [], documento: doc(true, '0', '0') })),
    ).toBe(39);
  });

  it('cubriendo una parte: 41 si el afecto y el IVA son 0, sin mirar las líneas', () => {
    expect(
      tipoBoletaDe(
        venta({ lineas: [linea()], documento: doc(false, '0', '0') }),
      ),
    ).toBe(41);
  });

  it('cubriendo una parte: 39 si el afecto o el IVA no son 0', () => {
    expect(
      tipoBoletaDe(
        venta({ lineas: [exenta], documento: doc(false, '100', '0') }),
      ),
    ).toBe(39);
    expect(
      tipoBoletaDe(
        venta({ lineas: [exenta], documento: doc(false, '0', '19') }),
      ),
    ).toBe(39);
  });
});

describe('grupoDelError', () => {
  it.each([
    'SIN_FOLIOS',
    'SIN_CERTIFICADO',
    'CERTIFICADO_VENCIDO',
    'PERFIL_INCOMPLETO',
    'AMBIENTE_DISTINTO',
  ] as CodigoDteError[])('%s es del perfil', (codigo) => {
    expect(grupoDelError(codigo)).toBe('perfil');
  });

  it.each([
    'TOTAL_NO_POSITIVO',
    'LINEA_NO_CIERRA',
    'IMPUESTO_ADICIONAL_NO_SOPORTADO',
    'LINEA_SIN_NOMBRE',
    'ERROR_INTERNO',
  ] as CodigoDteError[])('%s es de la boleta', (codigo) => {
    expect(grupoDelError(codigo)).toBe('boleta');
  });
});
