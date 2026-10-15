import {
  ahoraChile,
  type CafPerfil,
  DIAS_AVISO_CERTIFICADO,
  type EmisorPerfil,
  evaluarPerfil,
  UMBRAL_FOLIOS,
} from './perfil-fiscal';

const AHORA = new Date('2026-10-14T15:37:00Z');
const MS_DIA = 24 * 60 * 60 * 1000;
const EN_SEIS_MESES = { venceEl: new Date('2027-03-16T01:42:00Z') };

const emisor = (cambios: Partial<EmisorPerfil> = {}): EmisorPerfil => ({
  razonSocialId: '550e8400-e29b-41d4-a716-446655440931',
  nombre: 'Panadería La Espiga Ltda',
  rut: '76543210-3',
  direccion: 'Av. Los Aromos 4817',
  giro: 'Elaboración de pan y pasteles',
  comuna: 'Ñuñoa',
  ambiente: 'produccion',
  fechaResolucion: '2024-08-19',
  numeroResolucion: 83,
  ...cambios,
});

const caf = (
  tipo: 39 | 41,
  restantes: number,
  ambiente: CafPerfil['ambiente'] = 'produccion',
): CafPerfil => ({ tipo, ambiente, restantes });

const FOLIOS_OK = [caf(39, 412), caf(41, 288)];

const codigos = (r: { codigo: string }[]) => r.map((o) => o.codigo);

describe('evaluarPerfil', () => {
  it('un perfil completo no tiene faltantes ni avisos', () => {
    expect(evaluarPerfil(emisor(), EN_SEIS_MESES, FOLIOS_OK, AHORA)).toEqual({
      faltantes: [],
      avisos: [],
    });
  });

  it('sin emisor sale solo SIN_EMISOR, y certificado y folios se evalúan igual', () => {
    const r = evaluarPerfil(null, null, [], AHORA);
    expect(codigos(r.faltantes)).toEqual([
      'SIN_EMISOR',
      'SIN_CERTIFICADO',
      'SIN_FOLIOS_39',
    ]);
    expect(r.faltantes[0].mensaje).toBe(
      'Falta cargar los datos de la empresa que emite',
    );
  });

  it('sin emisor, un certificado vencido igual se informa', () => {
    const r = evaluarPerfil(
      null,
      { venceEl: new Date('2026-09-02T09:14:00Z') },
      [],
      AHORA,
    );
    expect(codigos(r.faltantes)).toContain('CERTIFICADO_VENCIDO');
  });

  it('un RUT que no es válido', () => {
    const r = evaluarPerfil(
      emisor({ rut: '76543210-4' }),
      EN_SEIS_MESES,
      FOLIOS_OK,
      AHORA,
    );
    expect(r.faltantes).toEqual([
      { codigo: 'RUT_INVALIDO', mensaje: 'El RUT de la empresa no es válido' },
    ]);
  });

  it.each([
    ['giro', 'SIN_GIRO', 'Falta el giro de la empresa'],
    ['comuna', 'SIN_COMUNA', 'Falta la comuna de la empresa'],
    ['direccion', 'SIN_DIRECCION', 'Falta la dirección de la empresa'],
  ] as const)(
    '%s vacío, null o solo espacios es %s',
    (campo, codigo, mensaje) => {
      for (const valor of [null, '', '   ']) {
        const r = evaluarPerfil(
          emisor({ [campo]: valor }),
          EN_SEIS_MESES,
          FOLIOS_OK,
          AHORA,
        );
        expect(r.faltantes).toEqual([{ codigo, mensaje }]);
      }
    },
  );

  it.each([
    ['nombre', 'a'.repeat(101)],
    ['giro', 'a'.repeat(81)],
    ['direccion', 'a'.repeat(71)],
    ['comuna', 'a'.repeat(21)],
  ] as const)(
    '%s que no cabe en el campo del SII es TEXTO_INVALIDO',
    (campo, valor) => {
      const r = evaluarPerfil(
        emisor({ [campo]: valor }),
        EN_SEIS_MESES,
        FOLIOS_OK,
        AHORA,
      );
      expect(codigos(r.faltantes)).toEqual(['TEXTO_INVALIDO']);
      expect(r.faltantes[0].mensaje).toContain('admite');
    },
  );

  it('el largo máximo exacto de cada campo cabe', () => {
    const r = evaluarPerfil(
      emisor({
        nombre: 'a'.repeat(100),
        giro: 'a'.repeat(80),
        direccion: 'a'.repeat(70),
        comuna: 'a'.repeat(20),
      }),
      EN_SEIS_MESES,
      FOLIOS_OK,
      AHORA,
    );
    expect(r.faltantes).toEqual([]);
  });

  it('un carácter fuera de ISO-8859-1 es TEXTO_INVALIDO con el mensaje del motor', () => {
    const r = evaluarPerfil(
      emisor({ giro: 'Pastelería 🥐' }),
      EN_SEIS_MESES,
      FOLIOS_OK,
      AHORA,
    );
    expect(r.faltantes).toHaveLength(1);
    expect(r.faltantes[0].codigo).toBe('TEXTO_INVALIDO');
    expect(r.faltantes[0].mensaje).toContain('ISO-8859-1');
  });

  it('un campo vacío da solo su SIN_*, no además TEXTO_INVALIDO', () => {
    const r = evaluarPerfil(
      emisor({ giro: '\t' }),
      EN_SEIS_MESES,
      FOLIOS_OK,
      AHORA,
    );
    expect(codigos(r.faltantes)).toEqual(['SIN_GIRO']);
  });

  it('dos campos inválidos dan dos TEXTO_INVALIDO', () => {
    const r = evaluarPerfil(
      emisor({ giro: 'a'.repeat(81), comuna: 'a'.repeat(21) }),
      EN_SEIS_MESES,
      FOLIOS_OK,
      AHORA,
    );
    expect(codigos(r.faltantes)).toEqual(['TEXTO_INVALIDO', 'TEXTO_INVALIDO']);
  });

  it('sin ambiente es SIN_AMBIENTE, y no cuenta ningún folio', () => {
    const r = evaluarPerfil(
      emisor({ ambiente: null }),
      EN_SEIS_MESES,
      FOLIOS_OK,
      AHORA,
    );
    expect(codigos(r.faltantes)).toEqual(['SIN_AMBIENTE', 'SIN_FOLIOS_39']);
    expect(r.avisos).toEqual([]);
  });

  it('sin fecha o sin número de resolución es SIN_RESOLUCION', () => {
    for (const cambios of [
      { fechaResolucion: null },
      { numeroResolucion: null },
      { fechaResolucion: null, numeroResolucion: null },
    ]) {
      const r = evaluarPerfil(emisor(cambios), EN_SEIS_MESES, FOLIOS_OK, AHORA);
      expect(r.faltantes).toEqual([
        {
          codigo: 'SIN_RESOLUCION',
          mensaje: 'Falta la fecha y el número de la resolución del SII',
        },
      ]);
    }
  });

  it('la resolución número 0 (la de certificación) no falta', () => {
    const r = evaluarPerfil(
      emisor({ numeroResolucion: 0, ambiente: 'certificacion' }),
      EN_SEIS_MESES,
      [caf(39, 412, 'certificacion')],
      AHORA,
    );
    expect(r.faltantes).toEqual([]);
  });

  it('sin certificado es SIN_CERTIFICADO', () => {
    const r = evaluarPerfil(emisor(), null, FOLIOS_OK, AHORA);
    expect(r.faltantes).toEqual([
      {
        codigo: 'SIN_CERTIFICADO',
        mensaje: 'Falta cargar el certificado digital',
      },
    ]);
  });

  it('un certificado vencido es CERTIFICADO_VENCIDO, con la fecha en hora de Chile', () => {
    // 02:48 UTC del 3 de septiembre es todavía el 2 en Santiago (UTC-4 en invierno).
    const r = evaluarPerfil(
      emisor(),
      { venceEl: new Date('2026-09-03T02:48:00Z') },
      FOLIOS_OK,
      AHORA,
    );
    expect(r.faltantes).toEqual([
      {
        codigo: 'CERTIFICADO_VENCIDO',
        mensaje: 'El certificado digital venció el 02-09-2026',
      },
    ]);
  });

  it('un certificado que vence justo ahora ya está vencido', () => {
    const r = evaluarPerfil(emisor(), { venceEl: AHORA }, FOLIOS_OK, AHORA);
    expect(codigos(r.faltantes)).toEqual(['CERTIFICADO_VENCIDO']);
  });

  it('un segundo después de ahora todavía no está vencido (pero sí por vencer)', () => {
    const r = evaluarPerfil(
      emisor(),
      { venceEl: new Date(AHORA.getTime() + 1000) },
      FOLIOS_OK,
      AHORA,
    );
    expect(r.faltantes).toEqual([]);
    expect(codigos(r.avisos)).toEqual(['CERTIFICADO_POR_VENCER']);
  });

  it('el borde de 30 días: exacto no avisa, un segundo menos sí', () => {
    const limite = AHORA.getTime() + DIAS_AVISO_CERTIFICADO * MS_DIA;
    const exacto = evaluarPerfil(
      emisor(),
      { venceEl: new Date(limite) },
      FOLIOS_OK,
      AHORA,
    );
    expect(exacto.avisos).toEqual([]);
    const antes = evaluarPerfil(
      emisor(),
      { venceEl: new Date(limite - 1000) },
      FOLIOS_OK,
      AHORA,
    );
    expect(antes.avisos).toEqual([
      {
        codigo: 'CERTIFICADO_POR_VENCER',
        mensaje: 'El certificado digital vence el 13-11-2026',
      },
    ]);
  });

  it('la fecha del certificado se dice en hora de Chile, no en UTC', () => {
    // 01:42 UTC del 16 de marzo es las 22:42 del 15 en Santiago (UTC-3 en verano).
    const r = evaluarPerfil(
      emisor(),
      { venceEl: new Date('2027-03-16T01:42:00Z') },
      FOLIOS_OK,
      new Date('2027-03-01T12:00:00Z'),
    );
    expect(r.avisos[0].mensaje).toBe(
      'El certificado digital vence el 15-03-2027',
    );
  });

  it('el borde de folios: 100 no avisa, 99 sí', () => {
    expect(UMBRAL_FOLIOS).toBe(100);
    const cien = evaluarPerfil(
      emisor(),
      EN_SEIS_MESES,
      [caf(39, 412), caf(41, 100)],
      AHORA,
    );
    expect(cien.avisos).toEqual([]);
    const noventaYNueve = evaluarPerfil(
      emisor(),
      EN_SEIS_MESES,
      [caf(39, 412), caf(41, 99)],
      AHORA,
    );
    expect(noventaYNueve.avisos).toEqual([
      {
        codigo: 'POCOS_FOLIOS',
        mensaje: 'Quedan 99 folios de boleta exenta (41)',
      },
    ]);
  });

  it('los folios se suman por tipo entre varios CAF', () => {
    const r = evaluarPerfil(
      emisor(),
      EN_SEIS_MESES,
      [caf(39, 62), caf(39, 58), caf(41, 288)],
      AHORA,
    );
    expect(r.avisos).toEqual([]);
    const pocos = evaluarPerfil(
      emisor(),
      EN_SEIS_MESES,
      [caf(39, 37), caf(39, 23), caf(41, 288)],
      AHORA,
    );
    expect(pocos.avisos).toEqual([
      {
        codigo: 'POCOS_FOLIOS',
        mensaje: 'Quedan 60 folios de boleta (39)',
      },
    ]);
  });

  it('sin CAF de boleta 39 es SIN_FOLIOS_39', () => {
    const r = evaluarPerfil(emisor(), EN_SEIS_MESES, [caf(41, 288)], AHORA);
    expect(r.faltantes).toEqual([
      {
        codigo: 'SIN_FOLIOS_39',
        mensaje: 'No hay folios de boleta (39) cargados',
      },
    ]);
    expect(r.avisos).toEqual([]);
  });

  it('un CAF de otro ambiente con 500 folios no evita SIN_FOLIOS_39', () => {
    const r = evaluarPerfil(
      emisor({ ambiente: 'produccion' }),
      EN_SEIS_MESES,
      [caf(39, 500, 'certificacion')],
      AHORA,
    );
    expect(codigos(r.faltantes)).toEqual(['SIN_FOLIOS_39']);
  });

  it('los folios de otro ambiente tampoco suman para el aviso', () => {
    const r = evaluarPerfil(
      emisor(),
      EN_SEIS_MESES,
      [caf(39, 412), caf(41, 64), caf(41, 500, 'certificacion')],
      AHORA,
    );
    expect(r.avisos).toEqual([
      {
        codigo: 'POCOS_FOLIOS',
        mensaje: 'Quedan 64 folios de boleta exenta (41)',
      },
    ]);
  });

  it('el 39 con CAF cargado pero 0 folios es solo faltante, no además aviso', () => {
    const r = evaluarPerfil(
      emisor(),
      EN_SEIS_MESES,
      [caf(39, 0), caf(41, 288)],
      AHORA,
    );
    expect(codigos(r.faltantes)).toEqual(['SIN_FOLIOS_39']);
    expect(r.avisos).toEqual([]);
  });

  it('un 41 con CAF cargados y 0 restantes es POCOS_FOLIOS y no es faltante', () => {
    const r = evaluarPerfil(
      emisor(),
      EN_SEIS_MESES,
      [caf(39, 412), caf(41, 0)],
      AHORA,
    );
    expect(r.faltantes).toEqual([]);
    expect(r.avisos).toEqual([
      {
        codigo: 'POCOS_FOLIOS',
        mensaje: 'Quedan 0 folios de boleta exenta (41)',
      },
    ]);
  });

  it('sin ningún CAF del 41 no hay aviso del 41', () => {
    const r = evaluarPerfil(emisor(), EN_SEIS_MESES, [caf(39, 412)], AHORA);
    expect(r).toEqual({ faltantes: [], avisos: [] });
  });
});

describe('ahoraChile', () => {
  it('en horario de verano (UTC-3) resta tres horas', () => {
    expect(ahoraChile(new Date('2026-10-14T16:07:09Z'))).toBe(
      '2026-10-14T13:07:09',
    );
  });

  it('en horario de invierno (UTC-4) resta cuatro horas', () => {
    expect(ahoraChile(new Date('2026-07-01T16:07:09Z'))).toBe(
      '2026-07-01T12:07:09',
    );
  });

  it('la medianoche de Chile es 00:00:00 y no 24:00:00, y cambia el día respecto de UTC', () => {
    expect(ahoraChile(new Date('2026-07-01T04:00:00Z'))).toBe(
      '2026-07-01T00:00:00',
    );
    // 02:30 UTC del 16 es todavía el 15 en Santiago (verano).
    expect(ahoraChile(new Date('2026-12-16T02:30:00Z'))).toBe(
      '2026-12-15T23:30:00',
    );
  });
});
