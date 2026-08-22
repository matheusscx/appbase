import {
  bordeFechaSql,
  bordeHastaSql,
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

  // El bug que cierra esta función: `hasta` llega como fecha pura y compararla
  // contra un `timestamptz` la castea a la MEDIANOCHE de ese día, así que
  // `<= hasta` dejaba fuera el día entero — "hasta el 16" no mostraba nada del
  // 16. El patrón es el mismo que `sesiones-garzon` ya tenía probado.
  describe('bordeHastaSql', () => {
    it('la fecha pura incluye el día completo: < día siguiente', () => {
      expect(bordeHastaSql('mv.creado_el', '2026-08-16', 3, 2)).toBe(
        ' AND mv.creado_el < (($3::date + 1)::timestamp AT TIME ZONE $2)',
      );
    });

    // Sumar el día es correcto para una fecha pura y sería un ensanche mudo
    // para un instante: quien manda `T15:30:00Z` pidió ese corte, no el final
    // del día. Es la misma razón por la que `bordeFechaSql` no aplica `::date`
    // a un timestamp.
    it('el timestamp pasa tal cual y sigue siendo inclusivo del instante', () => {
      const sql = bordeHastaSql('mv.creado_el', '2026-08-16T15:30:00Z', 3, 2);
      expect(sql).toBe(' AND mv.creado_el <= $3');
      expect(sql).not.toContain('::date');
      expect(sql).not.toContain('+ 1');
    });

    it('respeta la columna y los índices de parámetro que le pasan', () => {
      expect(bordeHastaSql('o.creado_el', '2026-12-31', 5, 4)).toBe(
        ' AND o.creado_el < (($5::date + 1)::timestamp AT TIME ZONE $4)',
      );
    });

    // Rueda de mes y de año: la aritmética la hace Postgres (`::date + 1`), no
    // JS. Se fija acá porque es la parte que un refactor podría querer
    // "simplificar" a `hasta 23:59:59`, que se come el último segundo.
    it('no usa el molde 23:59:59, que pierde el último segundo del día', () => {
      const sql = bordeHastaSql('mv.creado_el', '2026-12-31', 3, 2);
      expect(sql).not.toContain('23:59');
      expect(sql).toContain('::date + 1');
    });
  });
});
