import {
  COND_ATRASADA,
  COND_CON_PROBLEMAS,
  COND_CON_REPAROS,
  COND_RECHAZADA,
  motivoDe,
} from './problemas-sii';

describe('condiciones de los grupos', () => {
  it('atrasada: en cola o enviada hace más de una hora', () => {
    expect(COND_ATRASADA).toBe(
      `d.estado IN ('pendiente','enviado') AND d.emitido_el < now() - interval '1 hour'`,
    );
  });

  it('rechazada y con reparos', () => {
    expect(COND_RECHAZADA).toBe(`d.estado = 'rechazado'`);
    expect(COND_CON_REPAROS).toBe(
      `d.estado = 'reparos' AND d.emitido_el >= now() - interval '30 days'`,
    );
  });

  it('con problemas es atrasada o rechazada, y no incluye los reparos', () => {
    expect(COND_CON_PROBLEMAS).toBe(
      `((${COND_ATRASADA}) OR (${COND_RECHAZADA}))`,
    );
    expect(COND_CON_PROBLEMAS).not.toContain('reparos');
  });
});

describe('motivoDe', () => {
  const entrada = (estado: string, extra: object = {}) => ({
    tipo: 39,
    folio: 2077,
    estado,
    ...extra,
  });
  const error = (descripcion: string) => ({
    seccion: 'Encabezado',
    linea: 14,
    nivel: 1,
    codigo: 650,
    descripcion,
    detalle: 'detalle 650',
  });

  describe('atrasada', () => {
    it('es el último error de la cola', () => {
      expect(motivoDe('atrasada', null, 'El SII no contestó')).toBe(
        'El SII no contestó',
      );
    });

    it('sin último error es null', () => {
      expect(motivoDe('atrasada', null, null)).toBeNull();
    });

    it('ignora el detalle del SII', () => {
      expect(
        motivoDe('atrasada', entrada('RCH', { descripcion: 'x' }), 'Cola'),
      ).toBe('Cola');
    });
  });

  describe('error del sistema', () => {
    it.each(['esquema', 'sobre', 'envio'])('origen %s', (origen) => {
      expect(motivoDe('rechazada', { origen }, null)).toBe(
        'Error del sistema al enviarla al SII.',
      );
    });

    it('el rechazo del sobre entero trae estado RCH pero manda el origen', () => {
      expect(
        motivoDe(
          'rechazada',
          { origen: 'sobre', estado: 'RCH', descripcion: 'Firma inválida' },
          null,
        ),
      ).toBe('Error del sistema al enviarla al SII.');
    });
  });

  describe('rechazada por el SII', () => {
    it('usa la descripción del primer error', () => {
      expect(
        motivoDe(
          'rechazada',
          entrada('RCH', {
            error: [error('Monto no cuadra'), error('RUT inválido')],
          }),
          null,
        ),
      ).toBe('El SII la rechazó: Monto no cuadra.');
    });

    it('salta los errores sin descripción de texto', () => {
      expect(
        motivoDe(
          'rechazada',
          entrada('RCH', {
            error: [null, 7, { codigo: 1 }, { descripcion: 5 }, error('RUT')],
          }),
          null,
        ),
      ).toBe('El SII la rechazó: RUT.');
    });

    it('acepta un error que es texto', () => {
      expect(
        motivoDe(
          'rechazada',
          entrada('RCH', { error: ['Folio repetido'] }),
          null,
        ),
      ).toBe('El SII la rechazó: Folio repetido.');
    });

    it('sin errores usa la descripción de la entrada', () => {
      expect(
        motivoDe(
          'rechazada',
          entrada('RCH', { descripcion: 'Sobre mal formado' }),
          null,
        ),
      ).toBe('El SII la rechazó: Sobre mal formado.');
    });

    it('un error que no es lista cae a la descripción de la entrada', () => {
      expect(
        motivoDe(
          'rechazada',
          entrada('RCH', { error: 'raro', descripcion: 'Descripción' }),
          null,
        ),
      ).toBe('El SII la rechazó: Descripción.');
    });

    it('sin ninguna descripción', () => {
      expect(motivoDe('rechazada', entrada('RCH'), null)).toBe(
        'El SII la rechazó.',
      );
      expect(motivoDe('rechazada', entrada('RCH', { error: [] }), null)).toBe(
        'El SII la rechazó.',
      );
    });

    it('no duplica el punto final', () => {
      expect(
        motivoDe(
          'rechazada',
          entrada('RCH', { error: [error('Fecha atrasada.')] }),
          null,
        ),
      ).toBe('El SII la rechazó: Fecha atrasada.');
    });
  });

  describe('con reparos', () => {
    it.each(['RPR', 'RLV'])('%s: avisa con la descripción', (estado) => {
      expect(
        motivoDe(
          'con_reparos',
          entrada(estado, { error: [{ descripcion: 'Fecha atrasada' }] }),
          null,
        ),
      ).toBe('El SII avisa: Fecha atrasada.');
    });

    it('cae a la descripción de la entrada', () => {
      expect(
        motivoDe(
          'con_reparos',
          entrada('RPR', { descripcion: 'Giro largo' }),
          null,
        ),
      ).toBe('El SII avisa: Giro largo.');
    });

    it('sin ninguna descripción', () => {
      expect(motivoDe('con_reparos', entrada('RLV'), null)).toBe(
        'El SII la aceptó con reparos.',
      );
    });

    it('no duplica el punto final', () => {
      expect(
        motivoDe(
          'con_reparos',
          entrada('RPR', { descripcion: 'Giro largo.' }),
          null,
        ),
      ).toBe('El SII avisa: Giro largo.');
    });
  });

  describe('formas que no entendemos: null y nunca lanza', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['un string', 'RCH'],
      ['un número', 7],
      ['una lista', [entrada('RCH')]],
      ['objeto vacío', {}],
      ['estado desconocido', entrada('XYZ')],
      ['estado que no es texto', entrada(['RCH'] as unknown as string)],
      ['DOK', entrada('DOK')],
    ])('%s', (_nombre, detalle) => {
      expect(motivoDe('rechazada', detalle, null)).toBeNull();
      expect(motivoDe('con_reparos', detalle, null)).toBeNull();
    });
  });
});
