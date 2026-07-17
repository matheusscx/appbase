import { BadRequestException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';
import { TipoGarzon } from '../../garzones/enums/tipo-garzon.enum';

function parseTurnoIds({ value }: { value: unknown }): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const source = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(source.map(String).map((id) => id.trim()).filter(Boolean))];
}

export class QueryPropinaReporteDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'desde debe usar YYYY-MM-DD',
  })
  desde: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'hasta debe usar YYYY-MM-DD',
  })
  hasta: string;

  @IsOptional()
  @Transform(parseTurnoIds)
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  turnoIds?: string[];

  @IsOptional()
  @IsEnum(TipoGarzon)
  tipoGarzon?: TipoGarzon;
}

export interface RangoReporteNormalizado {
  desde: string;
  hasta: string;
  turnoIds: string[];
  tipoGarzon?: TipoGarzon;
}

export function normalizarRangoReporte(
  dto: Pick<
    QueryPropinaReporteDto,
    'desde' | 'hasta' | 'turnoIds' | 'tipoGarzon'
  >,
): RangoReporteNormalizado {
  const desdeMs = Date.parse(`${dto.desde}T00:00:00.000Z`);
  const hastaMs = Date.parse(`${dto.hasta}T00:00:00.000Z`);
  const fechasInvalidas =
    !Number.isFinite(desdeMs) ||
    !Number.isFinite(hastaMs) ||
    new Date(desdeMs).toISOString().slice(0, 10) !== dto.desde ||
    new Date(hastaMs).toISOString().slice(0, 10) !== dto.hasta;

  if (fechasInvalidas) {
    throw new BadRequestException('Las fechas deben usar YYYY-MM-DD');
  }
  if (hastaMs <= desdeMs) {
    throw new BadRequestException(
      'La fecha hasta debe ser posterior a desde',
    );
  }
  if (hastaMs - desdeMs > 366 * 24 * 60 * 60 * 1000) {
    throw new BadRequestException('El rango máximo del reporte es 366 días');
  }

  return {
    desde: dto.desde,
    hasta: dto.hasta,
    turnoIds: dto.turnoIds ?? [],
    tipoGarzon: dto.tipoGarzon,
  };
}
