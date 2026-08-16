import {
  bordeFechaSql,
  esFechaPura,
  requiereZonaTenant,
} from './rango-fecha.util';

describe('rango-fecha.util', () => {
  describe('esFechaPura', () => {
    it.each(['2026-08-01', '2026-12-31', '2026-01-01'])(
      'reconoce la fecha pura %s',
      (v) => {
        expect(esFechaPura(v)).toBe(true);
      },
    );

    it.each([
      '2026-08-01T15:30:00Z',
      '2026-08-01T00:00:00.000Z',
      '2026-08-01T15:30:00-04:00',
    ])('no confunde con fecha pura el timestamp %s', (v) => {
      expect(esFechaPura(v)).toBe(false);
    });
  });

  // No es una optimización: Postgres rechaza el bind si se pasa un parámetro que
  // la consulta no referencia. Con los dos bordes en timestamp, el SQL no nombra
  // la zona, así que pasarla igual tira un 500 — lo cazó el e2e.
  describe('requiereZonaTenant', () => {
    it('la pide si algún borde es fecha pura', () => {
      expect(requiereZonaTenant('2026-08-01', undefined)).toBe(true);
      expect(requiereZonaTenant(undefined, '2026-08-31')).toBe(true);
      expect(requiereZonaTenant('2026-08-01T15:30:00Z', '2026-08-31')).toBe(
        true,
      );
    });

    it('NO la pide si no hay bordes o los dos traen hora', () => {
      expect(requiereZonaTenant(undefined, undefined)).toBe(false);
      expect(requiereZonaTenant('', null)).toBe(false);
      expect(
        requiereZonaTenant('2026-08-01T15:30:00Z', '2026-08-31T23:59:59Z'),
      ).toBe(false);
    });
  });

  describe('bordeFechaSql', () => {
    it('expande la fecha pura a la medianoche del tenant', () => {
      expect(bordeFechaSql('mv.creado_el', '>=', '2026-08-01', 3, 2)).toBe(
        ' AND mv.creado_el >= ($3::date::timestamp AT TIME ZONE $2)',
      );
    });

    // El corazón de la entrada: `'2026-08-01T15:30:00Z'::date` devuelve
    // `2026-08-01` — el `::date` DESCARTA la hora en silencio. Aplicar el molde
    // de `propina-reportes` a ciegas haría que un llamador que hoy filtra desde
    // las 15:30 pasara a filtrar desde la medianoche: un filtro que se ensancha
    // sin avisar es peor que uno con la zona ambigua.
    it('deja pasar el timestamp tal cual, sin ::date que le coma la hora', () => {
      const sql = bordeFechaSql(
        'mv.creado_el',
        '>=',
        '2026-08-01T15:30:00Z',
        3,
        2,
      );
      expect(sql).toBe(' AND mv.creado_el >= $3');
      expect(sql).not.toContain('::date');
      expect(sql).not.toContain('AT TIME ZONE');
    });

    it('respeta el operador y la columna que le pasan', () => {
      expect(bordeFechaSql('o.creado_el', '<=', '2026-08-31', 5, 2)).toBe(
        ' AND o.creado_el <= ($5::date::timestamp AT TIME ZONE $2)',
      );
    });
  });
});
