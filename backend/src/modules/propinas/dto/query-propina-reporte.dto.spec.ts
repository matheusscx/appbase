import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  normalizarRangoReporte,
  QueryPropinaReporteDto,
} from './query-propina-reporte.dto';

describe('QueryPropinaReporteDto', () => {
  it('normaliza UUIDs separados por coma y elimina duplicados', async () => {
    const id = '550e8400-e29b-41d4-a716-446655440001';
    const dto = plainToInstance(QueryPropinaReporteDto, {
      desde: '2026-07-01',
      hasta: '2026-08-01',
      turnoIds: `${id},${id}`,
      tipoGarzon: 'garzon',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.turnoIds).toEqual([id]);
  });

  it.each([
    { label: 'desde requerido', input: { hasta: '2026-08-01' } },
    { label: 'hasta requerido', input: { desde: '2026-07-01' } },
    {
      label: 'turno inválido',
      input: {
        desde: '2026-07-01',
        hasta: '2026-08-01',
        turnoIds: 'no-es-uuid',
      },
    },
    {
      label: 'tipo inválido',
      input: {
        desde: '2026-07-01',
        hasta: '2026-08-01',
        tipoGarzon: 'administrador',
      },
    },
  ])('rechaza $label', async ({ input }) => {
    const errors = await validate(
      plainToInstance(QueryPropinaReporteDto, input),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza rango invertido', () => {
    expect(() =>
      normalizarRangoReporte({
        desde: '2026-08-01',
        hasta: '2026-07-01',
      }),
    ).toThrow(
      new BadRequestException('La fecha hasta debe ser posterior a desde'),
    );
  });

  it('rechaza más de 366 días', () => {
    expect(() =>
      normalizarRangoReporte({
        desde: '2025-01-01',
        hasta: '2026-07-01',
      }),
    ).toThrow(
      new BadRequestException('El rango máximo del reporte es 366 días'),
    );
  });

  it('rechaza una fecha calendario imposible', () => {
    expect(() =>
      normalizarRangoReporte({
        desde: '2026-02-30',
        hasta: '2026-03-02',
      }),
    ).toThrow(new BadRequestException('Las fechas deben usar YYYY-MM-DD'));
  });
});
