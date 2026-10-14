import { envolverParaXsd, tedParaXsd } from './__fixtures__/envio-boleta';
import { validarContraXsd } from './__fixtures__/xsd';
import { armarDocumento } from './boleta-documento';
import type { DatosBoleta, LineaBoleta } from './dte.types';

const XSD_42 = 'EnvioBOLETA_v11_formato42.xsd';
const XSD_V11 = 'EnvioBOLETA_v11.xsd';
const TMST = '2026-10-14T12:00:00';

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
  // 4470 / 1,19 = 3756,30 → neto 3756; IVA 714. Cierra sin aviso.
  montos: {
    neto: '3756',
    exento: '0',
    iva: '714',
    total: '4470',
    adicionales: '0',
  },
  ...over,
});

const armar = (d: DatosBoleta) =>
  armarDocumento(d, tedParaXsd(d.tipo, d.folio), TMST);

const validar = (xml: string, tipo: 39 | 41, xsd = XSD_42) =>
  validarContraXsd(envolverParaXsd(xml, tipo), xsd, ['xmldsignature_v10.xsd']);

const codigo = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { codigo?: string }).codigo;
  }
  return 'NO_LANZO';
};

/** Boleta de más de 135 UF identificada: la base de los casos del umbral. */
const sobreUmbral = (over: Partial<DatosBoleta> = {}) =>
  boleta({
    superaUmbralIdentificacion: true,
    receptor: {
      rut: '12.345.678-5',
      nombre: 'Juana Pérez',
      correo: 'juana@ejemplo.cl',
      telefono: '+56912345678',
    },
    medioPago: 1,
    ...over,
  });

describe('armarDocumento', () => {
  it('boleta afecta: válida contra el XSD, con ID, receptor genérico y sin IndMntNeto', async () => {
    const r = armar(boleta());
    expect(r.id).toBe('B39F101');
    expect(r.diferenciaIvaRedondeo).toBe('0');
    expect(r.xml.startsWith('<Documento ID="B39F101">')).toBe(true);
    expect(r.xml).toContain('<RUTRecep>66666666-6</RUTRecep>');
    expect(r.xml).toContain('<IndServicio>3</IndServicio>');
    expect(r.xml).not.toContain('IndMntNeto');
    expect(r.xml).not.toContain('<MedioPago>');
    expect(r.xml).toContain(
      '</Receptor><RutProvSW>77777777-7</RutProvSW><RznSocProvSW>Venka SpA</RznSocProvSW><Totales>',
    );
    expect(r.xml).not.toMatch(/<Emisor>[^]*ProvSW[^]*<\/Emisor>/);
    expect(r.xml).toContain(
      '<MntNeto>3756</MntNeto><IVA>714</IVA><MntTotal>4470</MntTotal>',
    );
    expect(r.xml).toContain('<QtyItem>3</QtyItem><PrcItem>1490</PrcItem>');
    expect(await validar(r.xml, 39)).toEqual({ valido: true, errores: [] });
  });

  it('el aviso de redondeo sale tal cual lo calcula verificarMontos', () => {
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
    expect(armar(d).diferenciaIvaRedondeo).toBe('1');
  });

  it('boleta 41 toda exenta: sin MntNeto ni IVA, IndExe en cada línea', async () => {
    const d = boleta({
      tipo: 41,
      folio: 7,
      lineas: [
        linea({
          nombre: 'Pan',
          cantidad: '2',
          precioUnitario: '500',
          monto: '1000',
          exenta: true,
        }),
        linea({
          nombre: 'Leche',
          cantidad: '1',
          precioUnitario: '1200',
          monto: '1200',
          exenta: true,
        }),
      ],
      montos: {
        neto: '0',
        exento: '2200',
        iva: '0',
        total: '2200',
        adicionales: '0',
      },
    });
    const r = armar(d);
    expect(r.id).toBe('B41F7');
    expect(r.xml).not.toContain('MntNeto');
    expect(r.xml).not.toContain('<IVA>');
    expect(r.xml).toContain('<MntExe>2200</MntExe><MntTotal>2200</MntTotal>');
    expect(r.xml.match(/<IndExe>1<\/IndExe>/g)).toHaveLength(2);
    expect(r.diferenciaIvaRedondeo).toBe('0');
    expect(await validar(r.xml, 41)).toEqual({ valido: true, errores: [] });
  });

  it('boleta mixta con descuento global: DscRcgGlobal en pesos', async () => {
    const d = boleta({
      lineas: [
        linea({
          nombre: 'Torta',
          cantidad: '1',
          precioUnitario: '1190',
          monto: '1190',
        }),
        linea({
          nombre: 'Pan',
          cantidad: '1',
          precioUnitario: '500',
          monto: '500',
          exenta: true,
        }),
      ],
      // afecto 1190 − 190 = 1000 → neto 840 + IVA 160; exento 500
      ajustesGlobales: [
        { tipo: 'D', glosa: 'Promo del día', monto: '190', exento: false },
      ],
      montos: {
        neto: '840',
        exento: '500',
        iva: '160',
        total: '1500',
        adicionales: '0',
      },
    });
    const r = armar(d);
    expect(r.xml).toContain(
      '<DscRcgGlobal><NroLinDR>1</NroLinDR><TpoMov>D</TpoMov><GlosaDR>Promo del día</GlosaDR><TpoValor>$</TpoValor><ValorDR>190</ValorDR></DscRcgGlobal>',
    );
    expect(r.xml).toContain(
      '<MntNeto>840</MntNeto><MntExe>500</MntExe><IVA>160</IVA>',
    );
    expect(await validar(r.xml, 39)).toEqual({ valido: true, errores: [] });
  });

  it('un ajuste exento lleva IndExeDR 1 y un recargo va como R', async () => {
    const d = boleta({
      lineas: [
        linea({
          nombre: 'Torta',
          cantidad: '1',
          precioUnitario: '1190',
          monto: '1190',
        }),
        linea({
          nombre: 'Pan',
          cantidad: '1',
          precioUnitario: '500',
          monto: '500',
          exenta: true,
        }),
      ],
      ajustesGlobales: [
        { tipo: 'R', glosa: 'Propina', monto: '100', exento: true },
      ],
      montos: {
        neto: '1000',
        exento: '600',
        iva: '190',
        total: '1790',
        adicionales: '0',
      },
    });
    const r = armar(d);
    expect(r.xml).toContain(
      '<TpoMov>R</TpoMov><GlosaDR>Propina</GlosaDR><TpoValor>$</TpoValor><ValorDR>100</ValorDR><IndExeDR>1</IndExeDR>',
    );
    expect(await validar(r.xml, 39)).toEqual({ valido: true, errores: [] });
  });

  it('descuento y recargo de línea van antes de MontoItem', async () => {
    const d = boleta({
      lineas: [
        linea({
          cantidad: '2.5',
          precioUnitario: '1000',
          descuentoMonto: '100',
          recargoMonto: '50',
          monto: '2450',
        }),
      ],
      montos: {
        neto: '2059',
        exento: '0',
        iva: '391',
        total: '2450',
        adicionales: '0',
      },
    });
    const r = armar(d);
    expect(r.xml).toContain(
      '<QtyItem>2.5</QtyItem><PrcItem>1000</PrcItem><DescuentoMonto>100</DescuentoMonto><RecargoMonto>50</RecargoMonto><MontoItem>2450</MontoItem>',
    );
    expect(await validar(r.xml, 39)).toEqual({ valido: true, errores: [] });
  });

  it('cantidad y precio salen sin ceros finales', () => {
    const d = boleta({
      lineas: [linea({ cantidad: '3.000000', precioUnitario: '1490.000000' })],
    });
    expect(armar(d).xml).toContain(
      '<QtyItem>3</QtyItem><PrcItem>1490</PrcItem>',
    );
  });

  it('una línea sin cantidad ni precio no los emite', async () => {
    const d = boleta({
      lineas: [{ nombre: 'Varios', monto: '4470', exenta: false }],
    });
    const r = armar(d);
    expect(r.xml).not.toContain('QtyItem');
    expect(r.xml).not.toContain('PrcItem');
    expect(await validar(r.xml, 39)).toEqual({ valido: true, errores: [] });
  });

  it('sobre 135 UF con receptor, nombre y medio de pago: válida contra la copia v4.2', async () => {
    const r = armar(sobreUmbral());
    expect(r.xml).toContain('<MedioPago>1</MedioPago>');
    expect(r.xml).toContain('<RUTRecep>12345678-5</RUTRecep>');
    expect(r.xml).toContain('<RznSocRecep>Juana Pérez</RznSocRecep>');
    expect(r.xml).toContain(
      '<CorreoRecep>juana@ejemplo.cl</CorreoRecep><TelefonoRecep>+56912345678</TelefonoRecep>',
    );
    expect(await validar(r.xml, 39)).toEqual({ valido: true, errores: [] });
  });

  it('el medio de pago también sale bajo el umbral si viene', () => {
    expect(armar(boleta({ medioPago: 2 })).xml).toContain(
      '<MedioPago>2</MedioPago>',
    );
  });

  it('sobre 135 UF sin nombre → FALTA_IDENTIFICACION_135_UF', () => {
    const d = sobreUmbral({ receptor: { rut: '12345678-5' } });
    expect(codigo(() => armar(d))).toBe('FALTA_IDENTIFICACION_135_UF');
  });

  it('sobre 135 UF sin medio de pago → FALTA_IDENTIFICACION_135_UF', () => {
    const d = sobreUmbral({ medioPago: undefined });
    expect(codigo(() => armar(d))).toBe('FALTA_IDENTIFICACION_135_UF');
  });

  it('sobre 135 UF sin receptor, con RUT inválido o con el genérico → FALTA_IDENTIFICACION_135_UF', () => {
    const base = sobreUmbral();
    const con = (rut: string) => ({ ...base.receptor!, rut });
    expect(codigo(() => armar({ ...base, receptor: undefined }))).toBe(
      'FALTA_IDENTIFICACION_135_UF',
    );
    expect(codigo(() => armar({ ...base, receptor: con('12345678-9') }))).toBe(
      'FALTA_IDENTIFICACION_135_UF',
    );
    expect(codigo(() => armar({ ...base, receptor: con('66666666-6') }))).toBe(
      'FALTA_IDENTIFICACION_135_UF',
    );
  });

  it('el código de sucursal de 9 dígitos sale entre GiroEmisor y DirOrigen y valida', async () => {
    const d = boleta({
      emisor: { ...boleta().emisor, cdgSiiSucur: '123456789' },
    });
    const r = armar(d);
    expect(r.xml).toContain(
      '</GiroEmisor><CdgSIISucur>123456789</CdgSIISucur><DirOrigen>',
    );
    expect(await validar(r.xml, 39)).toEqual({ valido: true, errores: [] });
  });

  it('un código de sucursal que no es un entero de 1 a 9 dígitos → CDG_SUCURSAL_INVALIDO', () => {
    for (const malo of ['abc', '0123', '1234567890', '12 3', '-5', '1.5']) {
      const d = boleta({
        emisor: { ...boleta().emisor, cdgSiiSucur: malo },
      });
      expect(codigo(() => armar(d))).toBe('CDG_SUCURSAL_INVALIDO');
    }
  });

  it('RUT del emisor con dígito malo → RUT_INVALIDO', () => {
    const d = boleta({ emisor: { ...boleta().emisor, rut: '76543210-4' } });
    expect(codigo(() => armar(d))).toBe('RUT_INVALIDO');
  });

  it('RUT del proveedor de software o del receptor malo → RUT_INVALIDO', () => {
    expect(
      codigo(() =>
        armar(
          boleta({
            proveedorSoftware: { rut: '77777777-1', razonSocial: 'Venka SpA' },
          }),
        ),
      ),
    ).toBe('RUT_INVALIDO');
    expect(
      codigo(() => armar(boleta({ receptor: { rut: '12345678-9' } }))),
    ).toBe('RUT_INVALIDO');
  });

  it('los RUT salen normalizados', () => {
    const d = boleta({
      emisor: { ...boleta().emisor, rut: '76.543.210-3' },
      receptor: { rut: '12.345.678-5' },
    });
    const r = armar(d);
    expect(r.xml).toContain('<RUTEmisor>76543210-3</RUTEmisor>');
    expect(r.xml).toContain('<RUTRecep>12345678-5</RUTRecep>');
  });

  it('NmbItem de 81 caracteres → TEXTO_DEMASIADO_LARGO, sin XML', () => {
    const d = boleta({ lineas: [linea({ nombre: 'x'.repeat(81) })] });
    expect(codigo(() => armar(d))).toBe('TEXTO_DEMASIADO_LARGO');
    expect(
      codigo(() =>
        armar(boleta({ lineas: [linea({ nombre: 'x'.repeat(80) })] })),
      ),
    ).toBe('NO_LANZO');
  });

  it('cada texto del emisor, receptor y ajustes tiene su tope', () => {
    const emisor = boleta().emisor;
    const largo = (d: DatosBoleta) => codigo(() => armar(d));
    expect(
      largo(boleta({ emisor: { ...emisor, razonSocial: 'x'.repeat(101) } })),
    ).toBe('TEXTO_DEMASIADO_LARGO');
    expect(largo(boleta({ emisor: { ...emisor, giro: 'x'.repeat(81) } }))).toBe(
      'TEXTO_DEMASIADO_LARGO',
    );
    expect(
      largo(boleta({ emisor: { ...emisor, direccion: 'x'.repeat(71) } })),
    ).toBe('TEXTO_DEMASIADO_LARGO');
    expect(
      largo(boleta({ emisor: { ...emisor, comuna: 'x'.repeat(21) } })),
    ).toBe('TEXTO_DEMASIADO_LARGO');
    expect(
      largo(
        boleta({
          proveedorSoftware: {
            rut: '77777777-7',
            razonSocial: 'x'.repeat(101),
          },
        }),
      ),
    ).toBe('TEXTO_DEMASIADO_LARGO');
    const rec = (r: object) =>
      boleta({ receptor: { rut: '12345678-5', ...r } });
    expect(largo(rec({ nombre: 'x'.repeat(101) }))).toBe(
      'TEXTO_DEMASIADO_LARGO',
    );
    expect(largo(rec({ correo: 'x'.repeat(81) }))).toBe(
      'TEXTO_DEMASIADO_LARGO',
    );
    expect(largo(rec({ telefono: 'x'.repeat(21) }))).toBe(
      'TEXTO_DEMASIADO_LARGO',
    );
    const ajuste = (glosa: string) =>
      boleta({
        ajustesGlobales: [{ tipo: 'D', glosa, monto: '100', exento: false }],
        montos: {
          neto: '3672',
          exento: '0',
          iva: '698',
          total: '4370',
          adicionales: '0',
        },
      });
    expect(largo(ajuste('x'.repeat(46)))).toBe('TEXTO_DEMASIADO_LARGO');
    expect(largo(ajuste('x'.repeat(45)))).toBe('NO_LANZO');
  });

  it('un carácter fuera de ISO-8859-1 en cualquier texto → TEXTO_NO_ISO_8859_1', () => {
    const emisor = boleta().emisor;
    const malo = (d: DatosBoleta) => codigo(() => armar(d));
    expect(malo(boleta({ lineas: [linea({ nombre: 'Café ☕' })] }))).toBe(
      'TEXTO_NO_ISO_8859_1',
    );
    expect(
      malo(boleta({ emisor: { ...emisor, razonSocial: 'Pan € SpA' } })),
    ).toBe('TEXTO_NO_ISO_8859_1');
    expect(
      malo(boleta({ receptor: { rut: '12345678-5', nombre: 'Zoë 😀' } })),
    ).toBe('TEXTO_NO_ISO_8859_1');
    expect(
      malo(
        boleta({
          ajustesGlobales: [
            { tipo: 'D', glosa: 'Promo 50€', monto: '100', exento: false },
          ],
          montos: {
            neto: '3672',
            exento: '0',
            iva: '698',
            total: '4370',
            adicionales: '0',
          },
        }),
      ),
    ).toBe('TEXTO_NO_ISO_8859_1');
  });

  it('los montos incoherentes los frena verificarMontos antes de escribir XML', () => {
    const d = boleta({
      montos: {
        neto: '3756',
        exento: '0',
        iva: '714',
        total: '4471',
        adicionales: '0',
      },
    });
    expect(codigo(() => armar(d))).toBe('TOTALES_NO_CIERRAN');
  });

  it('el texto con acentos y Ñ sale tal cual; & < > se escapan y las comillas van crudas', () => {
    const d = boleta({
      emisor: { ...boleta().emisor, razonSocial: 'Panadería Ñuñoa SpA' },
      lineas: [linea({ nombre: 'Pan <A&B> "x"' })],
    });
    const { xml } = armar(d);
    expect(xml).toContain('<RznSocEmisor>Panadería Ñuñoa SpA</RznSocEmisor>');
    expect(xml).not.toContain('&#');
    expect(xml).toContain('<NmbItem>Pan &lt;A&amp;B&gt; "x"</NmbItem>');
  });

  it('el TED y TmstFirma van al final, el TED tal cual', () => {
    const ted = tedParaXsd(39, 101);
    const { xml } = armarDocumento(boleta(), ted, TMST);
    expect(
      xml.endsWith(`${ted}<TmstFirma>${TMST}</TmstFirma></Documento>`),
    ).toBe(true);
  });
});

describe('armarDocumento con fechas', () => {
  it.each(['14-10-2026', '2026-02-30', new Date().toISOString()])(
    'FchEmis %s da FECHA_INVALIDA',
    (fechaEmision) => {
      expect(codigo(() => armar(boleta({ fechaEmision })))).toBe(
        'FECHA_INVALIDA',
      );
    },
  );

  it.each(['2026-10-14 12:00:00', '2026-10-14T24:00:00', '2026-10-14'])(
    'TmstFirma %s da FECHA_INVALIDA',
    (tmst) => {
      expect(
        codigo(() => armarDocumento(boleta(), tedParaXsd(39, 101), tmst)),
      ).toBe('FECHA_INVALIDA');
    },
  );
});

describe('armarDocumento sin líneas', () => {
  it('una boleta sin líneas da SIN_LINEAS, no un descuadre de totales', () => {
    expect(codigo(() => armar(boleta({ lineas: [] })))).toBe('SIN_LINEAS');
  });
});

describe('XSD con el formato v4.2', () => {
  it('el v11 original rechaza MedioPago y la copia lo acepta', async () => {
    const { xml } = armar(boleta({ medioPago: 1 }));
    const v11 = await validar(xml, 39, XSD_V11);
    expect(v11.valido).toBe(false);
    expect(v11.errores.join('\n')).toContain('MedioPago');
    expect(await validar(xml, 39, XSD_42)).toEqual({
      valido: true,
      errores: [],
    });
  });

  it('el v11 rechaza cada campo nuevo y acepta la boleta sin ellos', async () => {
    const sinNuevos = armar(
      boleta({
        proveedorSoftware: { rut: '77777777-7', razonSocial: 'Venka SpA' },
      }),
    ).xml.replace(
      '<RutProvSW>77777777-7</RutProvSW><RznSocProvSW>Venka SpA</RznSocProvSW>',
      '',
    );
    expect((await validar(sinNuevos, 39, XSD_V11)).valido).toBe(true);

    const pruebas: Array<[string, string]> = [
      [
        'CorreoRecep',
        armar(boleta({ receptor: { rut: '12345678-5', correo: 'a@b.cl' } }))
          .xml,
      ],
      [
        'TelefonoRecep',
        armar(boleta({ receptor: { rut: '12345678-5', telefono: '123' } })).xml,
      ],
      ['RutProvSW', armar(boleta()).xml],
    ];
    for (const [campo, xml] of pruebas) {
      const r = await validar(xml, 39, XSD_V11);
      expect(r.valido).toBe(false);
      expect(r.errores.join('\n')).toContain(campo);
      expect((await validar(xml, 39, XSD_42)).valido).toBe(true);
    }
  });

  it('la copia rechaza un MedioPago fuera de 1–5 y los largos pasados', async () => {
    const { xml } = armar(boleta({ medioPago: 1 }));
    const medio = xml.replace(
      '<MedioPago>1</MedioPago>',
      '<MedioPago>6</MedioPago>',
    );
    expect((await validar(medio, 39)).valido).toBe(false);
    const correo = armar(
      boleta({ receptor: { rut: '12345678-5', correo: 'a@b.cl' } }),
    ).xml.replace('a@b.cl', 'x'.repeat(81));
    expect((await validar(correo, 39)).valido).toBe(false);
  });

  it('con Ñ el validador no da falso verde ni falso rojo (xmllint sobre latin1)', async () => {
    // CmnaOrigen admite 20: 20 Ñ pasan y 21 no. Medido: sin declarar UTF-8 en el validador
    // (`comoUtf8` de __fixtures__/xsd.ts) las 20 Ñ daban "largo 40" y fallaban.
    const { xml } = armar(boleta());
    const con = (n: number) =>
      xml.replace(
        '<CmnaOrigen>Ñuñoa</CmnaOrigen>',
        `<CmnaOrigen>${'Ñ'.repeat(n)}</CmnaOrigen>`,
      );
    expect(await validar(con(20), 39)).toEqual({ valido: true, errores: [] });
    const r = await validar(con(21), 39);
    expect(r.valido).toBe(false);
    expect(r.errores.join('\n')).toContain('CmnaOrigen');
  });
});
