import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DevolucionLineaDto } from './create-reembolso.dto';

/**
 * "Generar nota" de un REFUND aprobado que quedó sin corrección. El monto NO
 * viaja: es el del REFUND, y la plata ya volvió por el proveedor. Solo las
 * líneas que se acreditan, con el mismo contrato que el reembolso (la pantalla
 * las precarga de lo que el reembolso pidió). Ver
 * `docs/features/reembolsos-nota-credito.md`.
 */
export class GenerarNotaReembolsoDto {
  @IsOptional()
  @IsArray()
  // El mismo tope que `CreateReembolsoDto.devoluciones`.
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DevolucionLineaDto)
  devoluciones?: DevolucionLineaDto[];
}
