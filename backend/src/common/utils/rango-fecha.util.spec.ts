import type { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import {
  bordeFechaSql,
  bordeHastaSql,
  esFechaPura,
  fechaLocalTenant,
  requiereZonaTenant,
  zonaHorariaTenant,
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

  describe('zonaHorariaTenant', () => {
    const TENANT = 'tenant-uuid';

    function dbConZona(filas: unknown[]) {
      const query = jest.fn().mockResolvedValue(filas);
      return { db: { query } as unknown as DataSource, query };
    }

    it('la zona sale de la PROVINCIA, no del país', async () => {
      // `provincia.zona_horaria` existía y estaba sembrada —Isla de Pascua es
      // `Pacific/Easter`— y esta consulta pasaba POR la provincia para leer
      // `pais.zona_horaria_principal`, salteándose su columna. El nombre
      // "principal" del país ya decía que la provincia manda.
      const { db, query } = dbConZona([{ zona_horaria: 'Pacific/Easter' }]);

      await expect(zonaHorariaTenant(db, TENANT)).resolves.toBe(
        'Pacific/Easter',
      );

      const [sql] = query.mock.calls[0] as [string, unknown[]];
      // Sobre la cláusula que SELECCIONA, no sobre una mención cualquiera: un
      // `toContain('pr.zona_horaria')` lo satisface hasta un comentario.
      expect(sql).toMatch(/SELECT\s+pr\.zona_horaria\s+AS\s+zona_horaria/);
      expect(sql).not.toMatch(/SELECT\s+p\.zona_horaria_principal/);
    });

    it('sigue filtrando el borrado de provincia y de país', async () => {
      // El `JOIN pais` se queda aunque ya no se lea su columna: es lo que
      // impide resolver la zona de un tenant cuyo país está dado de baja, y hay
      // un test gemelo en `sesiones-garzon.service.spec.ts` que lo exige —
      // nació porque el mutante que borraba estos filtros pasaba la suite.
      const { db, query } = dbConZona([{ zona_horaria: 'America/Santiago' }]);

      await zonaHorariaTenant(db, TENANT);

      const [sql] = query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/JOIN provincia pr[\s\S]*?pr\.eliminado_el IS NULL/);
      expect(sql).toMatch(/JOIN pais p[\s\S]*?p\.eliminado_el IS NULL/);
    });

    it('sin fila es 404, no undefined que reviente más abajo', async () => {
      const { db } = dbConZona([]);
      await expect(zonaHorariaTenant(db, TENANT)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('fechaLocalTenant', () => {
    const TENANT = 'tenant-uuid';

    function dbConZona(zona: string) {
      return {
        query: jest.fn().mockResolvedValue([{ zona_horaria: zona }]),
      } as unknown as DataSource;
    }

    it('colapsa el instante al día del LOCAL, no al de UTC', async () => {
      // 02:30 UTC del 1-dic todavía es 30-nov en Chile. Si esto se resolviera
      // en UTC, una promo que arranca el 1-dic empezaría a las 21:00 del 30.
      const instante = new Date('2026-12-01T02:30:00Z');
      await expect(
        fechaLocalTenant(dbConZona('America/Santiago'), TENANT, instante),
      ).resolves.toBe('2026-11-30');
    });

    it('respeta la zona de la provincia, que puede no ser la del país', async () => {
      // Isla de Pascua está dos horas detrás del continente. El test existe
      // para que el día que alguien devuelva la zona del país esto se ponga
      // rojo — ver `resueltos.md` § "Una sola noción de zona horaria".
      const instante = new Date('2026-12-01T04:30:00Z');
      const santiago = await fechaLocalTenant(
        dbConZona('America/Santiago'),
        TENANT,
        instante,
      );
      const pascua = await fechaLocalTenant(
        dbConZona('Pacific/Easter'),
        TENANT,
        instante,
      );
      expect(santiago).toBe('2026-12-01');
      expect(pascua).toBe('2026-11-30');
    });

    it('devuelve siempre `YYYY-MM-DD`, que es lo que se compara contra las columnas `date`', async () => {
      const fecha = await fechaLocalTenant(
        dbConZona('America/Santiago'),
        TENANT,
        new Date('2026-03-05T15:00:00Z'),
      );
      expect(fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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
