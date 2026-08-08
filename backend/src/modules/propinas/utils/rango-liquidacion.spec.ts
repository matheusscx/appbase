import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateLiquidacionDto } from '../dto/create-liquidacion.dto';
import { LiquidarDto } from '../dto/liquidar.dto';
import { PreviewLiquidacionDto } from '../dto/preview-liquidacion.dto';
import { rangoLiquidacionDesde } from './rango-liquidacion';

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
  // SQL de la liquidación no hace `::date`, así que una hora es un límite de
  // período legítimo y el regex rompería a quien la mande.
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
  // `strict` las acepta. Lo que las corta es `rangoLiquidacionDesde`. Si algún
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

describe('rangoLiquidacionDesde', () => {
  it('devuelve el par convertido cuando el período es válido', () => {
    const { fechaDesde, fechaHasta } = rangoLiquidacionDesde(
      '2026-08-01',
      '2026-08-31T23:59:59Z',
    );
    expect(fechaDesde.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(fechaHasta.toISOString()).toBe('2026-08-31T23:59:59.000Z');
  });

  // El caso que la guarda de orden no puede ver: `NaN <= NaN` es `false`, así
  // que sin este chequeo la fecha inválida seguía de largo hasta Postgres, que
  // cortaba con `invalid input syntax for type timestamp with time zone:
  // "0NaN-NaN-NaN..."` — un 500 donde correspondía un 400.
  it.each(['2026-W32-1', '20260807'])(
    'rechaza %s antes de que llegue a la query',
    (valor) => {
      expect(() => rangoLiquidacionDesde('2026-08-01', valor)).toThrow(
        BadRequestException,
      );
      expect(() => rangoLiquidacionDesde(valor, '2026-08-31')).toThrow(
        BadRequestException,
      );
    },
  );

  it('mantiene la guarda de orden', () => {
    expect(() => rangoLiquidacionDesde('2026-08-31', '2026-08-01')).toThrow(
      'La fecha hasta debe ser posterior a desde',
    );
    expect(() => rangoLiquidacionDesde('2026-08-01', '2026-08-01')).toThrow(
      'La fecha hasta debe ser posterior a desde',
    );
  });
});
