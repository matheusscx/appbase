import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { DataSource } from 'typeorm';
import { CreateLiquidacionDto } from '../dto/create-liquidacion.dto';
import { LiquidarDto } from '../dto/liquidar.dto';
import { PreviewLiquidacionDto } from '../dto/preview-liquidacion.dto';
import { rangoLiquidacion } from './rango-liquidacion';

// Los tres DTOs del período de liquidación comparten el mismo par de fechas y
// el mismo par de decoradores. Se prueban juntos para que agregar un cuarto sin
// `strict` no pase inadvertido.
const DTOS = [
  ['CreateLiquidacionDto', CreateLiquidacionDto],
  ['LiquidarDto', LiquidarDto],
  ['PreviewLiquidacionDto', PreviewLiquidacionDto],
] as const;

describe.each(DTOS)('%s — fechaDesde/fechaHasta', (_nombre, Dto) => {
  const validar = (valores: Record<string, string>) =>
    validate(plainToInstance(Dto, valores));

  it('acepta fecha pura', async () => {
    expect(
      await validar({ fechaDesde: '2026-08-01', fechaHasta: '2026-08-31' }),
    ).toHaveLength(0);
  });

  // A diferencia de `QuerySesionesDto`, acá NO va un `@Matches(YYYY-MM-DD)`: el
  // SQL de la liquidación no hace `::date` a un timestamp, así que una hora es
  // un límite de período legítimo y el regex rompería a quien la mande.
  it('acepta un timestamp completo', async () => {
    expect(
      await validar({
        fechaDesde: '2026-08-01T12:00:00Z',
        fechaHasta: '2026-08-31T23:59:59.999Z',
      }),
    ).toHaveLength(0);
  });

  it.each(['2026-02-31', '2026-04-31', '2026-02-29'])(
    'rechaza %s: es ISO bien formado pero no existe en el calendario',
    async (valor) => {
      const errores = await validar({
        fechaDesde: '2026-01-01',
        fechaHasta: valor,
      });
      expect(errores).toHaveLength(1);
      expect(errores[0]?.constraints).toHaveProperty('isIso8601');
    },
  );

  it('acepta 2028-02-29, que sí es un 29 de febrero real', async () => {
    expect(
      await validar({ fechaDesde: '2028-02-01', fechaHasta: '2028-02-29' }),
    ).toHaveLength(0);
  });

  // Este test afirma un HUECO, no una virtud: son ISO 8601 válidas, así que
  // `strict` las acepta. Lo que las corta es `rangoLiquidacion`. Si algún
  // día el decorador empieza a rechazarlas, este test se cae y hay que mover la
  // defensa, no borrarla.
  it.each(['2026-W32-1', '20260807'])(
    'el decorador NO alcanza para %s — la corta el normalizador',
    async (valor) => {
      expect(
        await validar({ fechaDesde: '2026-01-01', fechaHasta: valor }),
      ).toHaveLength(0);
      expect(Number.isNaN(new Date(valor).getTime())).toBe(true);
    },
  );
});

describe('rangoLiquidacion', () => {
  const TENANT = 'tenant-uuid';
  const ZONA = 'America/Santiago';
  const CORTE = 5;

  /** `db.query` mockeado, con una resolución en cola por llamada. */
  function dbMock(...filas: unknown[][]) {
    const query = jest.fn();
    filas.forEach((f) => query.mockResolvedValueOnce(f));
    return { db: { query } as unknown as DataSource, query };
  }

  const filaDia = [{ zona_horaria: ZONA, hora_corte: CORTE }];

  it('dos fechas puras: una sola consulta de expansión, que borda desde con inicioDiaNegocioSql($1::date) y hasta con $2::date + 1, con params [desde, hasta, zona, corte]', async () => {
    const desdeDate = new Date('2026-08-01T05:00:00Z');
    const hastaDate = new Date('2026-09-01T05:00:00Z');
    const { db, query } = dbMock(filaDia, [
      { desde: desdeDate, hasta: hastaDate },
    ]);

    const res = await rangoLiquidacion(db, TENANT, '2026-08-01', '2026-08-31');

    expect(query).toHaveBeenCalledTimes(2);
    const [sql, params] = query.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual(['2026-08-01', '2026-08-31', ZONA, CORTE]);
    const sqlPlano = sql.replace(/\s+/g, ' ');
    expect(sqlPlano).toContain(
      '(($1::date)::timestamp + make_interval(hours => $4::int)) AT TIME ZONE $3 AS desde',
    );
    expect(sqlPlano).toContain(
      '(($2::date + 1)::timestamp + make_interval(hours => $4::int)) AT TIME ZONE $3 AS hasta',
    );
    expect(res).toEqual({ fechaDesde: desdeDate, fechaHasta: hastaDate });
  });

  it('dos timestamps completos: cero consultas y los Date tal cual', async () => {
    const { db, query } = dbMock();

    const res = await rangoLiquidacion(
      db,
      TENANT,
      '2026-08-01T12:00:00Z',
      '2026-08-31T23:59:59.999Z',
    );

    expect(query).not.toHaveBeenCalled();
    expect(res.fechaDesde.toISOString()).toBe('2026-08-01T12:00:00.000Z');
    expect(res.fechaHasta.toISOString()).toBe('2026-08-31T23:59:59.999Z');
  });

  it('desde puro + hasta timestamp: una consulta, $1 se expande y $2 va tal cual', async () => {
    const desdeDate = new Date('2026-08-01T05:00:00Z');
    const hastaDate = new Date('2026-08-31T23:59:59Z');
    const { db, query } = dbMock(filaDia, [
      { desde: desdeDate, hasta: hastaDate },
    ]);

    const res = await rangoLiquidacion(
      db,
      TENANT,
      '2026-08-01',
      '2026-08-31T23:59:59Z',
    );

    expect(query).toHaveBeenCalledTimes(2);
    const [sql, params] = query.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual(['2026-08-01', '2026-08-31T23:59:59Z', ZONA, CORTE]);
    expect(sql).toContain('$2::timestamptz AS hasta');
    expect(sql).not.toContain('$2::date');
    expect(res).toEqual({ fechaDesde: desdeDate, fechaHasta: hastaDate });
  });

  it('desde timestamp + hasta pura: una consulta, $1 va tal cual y $2 se expande', async () => {
    const desdeDate = new Date('2026-08-01T12:00:00Z');
    const hastaDate = new Date('2026-09-01T05:00:00Z');
    const { db, query } = dbMock(filaDia, [
      { desde: desdeDate, hasta: hastaDate },
    ]);

    const res = await rangoLiquidacion(
      db,
      TENANT,
      '2026-08-01T12:00:00Z',
      '2026-08-31',
    );

    expect(query).toHaveBeenCalledTimes(2);
    const [sql, params] = query.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual(['2026-08-01T12:00:00Z', '2026-08-31', ZONA, CORTE]);
    expect(sql).toContain('$1::timestamptz AS desde');
    expect(sql).not.toContain('$1::date');
    expect(res).toEqual({ fechaDesde: desdeDate, fechaHasta: hastaDate });
  });

  // Regresión del mismo 42P18 que ya cerraron resumen-negocio.service.ts y
  // caja.service.ts (Task 2 de `hora-de-corte`): un `$n` sin bind, o un bind
  // sin `$n` que lo referencie, revienta en Postgres real aunque el mock de
  // `db.query` de este test no lo vea.
  it.each([
    ['pure/pure', '2026-08-01', '2026-08-31'],
    ['pure/timestamp', '2026-08-01', '2026-08-31T23:59:59Z'],
    ['timestamp/pure', '2026-08-01T12:00:00Z', '2026-08-31'],
  ])(
    'cada $n del SQL de expansión es exactamente 1..params.length (%s)',
    async (_nombre, fechaDesde, fechaHasta) => {
      const { db, query } = dbMock(filaDia, [
        {
          desde: new Date('2026-08-01T05:00:00Z'),
          hasta: new Date('2026-09-01T05:00:00Z'),
        },
      ]);

      await rangoLiquidacion(db, TENANT, fechaDesde, fechaHasta);

      const [sql, params] = query.mock.calls[1] as [string, unknown[]];
      const referenciados = new Set(
        Array.from(sql.matchAll(/\$(\d+)/g)).map((m) => Number(m[1])),
      );
      const esperados = new Set(
        Array.from({ length: params.length }, (_v, i) => i + 1),
      );
      expect(referenciados).toEqual(esperados);
    },
  );

  it.each(['2026-W32-1', '20260807'])(
    'rechaza %s antes de tocar la base',
    async (valor) => {
      const { db, query } = dbMock();

      await expect(
        rangoLiquidacion(db, TENANT, '2026-08-01', valor),
      ).rejects.toThrow(BadRequestException);
      await expect(
        rangoLiquidacion(db, TENANT, valor, '2026-08-31'),
      ).rejects.toThrow(BadRequestException);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('mantiene la guarda de orden con timestamps (corre sin tocar la base)', async () => {
    const { db, query } = dbMock();

    await expect(
      rangoLiquidacion(
        db,
        TENANT,
        '2026-08-31T23:59:59Z',
        '2026-08-01T00:00:00Z',
      ),
    ).rejects.toThrow('La fecha hasta debe ser posterior a desde');
    expect(query).not.toHaveBeenCalled();
  });

  // La guarda es estrictamente POSTERIOR: dos timestamps idénticos no son un
  // período válido de "cero duración".
  it('rechaza dos timestamps idénticos (hasta debe ser POSTERIOR, no igual)', async () => {
    const { db } = dbMock();

    await expect(
      rangoLiquidacion(
        db,
        TENANT,
        '2026-08-01T12:00:00Z',
        '2026-08-01T12:00:00Z',
      ),
    ).rejects.toThrow('La fecha hasta debe ser posterior a desde');
  });

  // La de orden corre DESPUÉS de expandir: con fecha pura, `desde = hasta` es
  // un período válido de un día porque `hasta` expande al día SIGUIENTE.
  it('desde = hasta en fecha pura es un período válido de un día', async () => {
    const desdeDate = new Date('2026-09-12T04:00:00Z');
    const hastaDate = new Date('2026-09-13T04:00:00Z');
    const { db } = dbMock(filaDia, [{ desde: desdeDate, hasta: hastaDate }]);

    await expect(
      rangoLiquidacion(db, TENANT, '2026-09-12', '2026-09-12'),
    ).resolves.toEqual({ fechaDesde: desdeDate, fechaHasta: hastaDate });
  });

  it('mantiene la guarda de orden cuando la expansión invierte el resultado', async () => {
    // Caso construido: si la base devolviera hasta <= desde ya expandidos,
    // la guarda lo corta igual — no confía en que el llamador mande el orden
    // correcto de fechas puras.
    const desdeDate = new Date('2026-09-13T04:00:00Z');
    const hastaDate = new Date('2026-09-12T04:00:00Z');
    const { db } = dbMock(filaDia, [{ desde: desdeDate, hasta: hastaDate }]);

    await expect(
      rangoLiquidacion(db, TENANT, '2026-09-13', '2026-09-12'),
    ).rejects.toThrow('La fecha hasta debe ser posterior a desde');
  });
});
