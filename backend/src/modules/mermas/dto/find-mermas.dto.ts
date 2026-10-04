import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { EsFechaOTimestamp } from '../../../common/decorators/fecha-pura.decorator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { TipoMotivoBaja } from '../../motivos-baja/tipo-motivo-baja.enum';

/** Lo que registra la pantalla de Mermas: la merma de bodega y la comida del personal. */
export const TIPOS_DE_MERMAS = [
  TipoMotivoBaja.MERMA,
  TipoMotivoBaja.CONSUMO_PERSONAL,
] as const;
export type TipoDeMermas = (typeof TIPOS_DE_MERMAS)[number];

export class FindMermasDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsOptional()
  @IsUUID()
  motivoBajaId?: string;

  @IsOptional()
  @EsFechaOTimestamp()
  desde?: string;

  @IsOptional()
  @EsFechaOTimestamp()
  hasta?: string;

  /**
   * Qué se lista: `merma` (por defecto, la respuesta de siempre) o la comida
   * del personal, que no es pérdida y se muestra aparte (spec
   * 2026-10-04-comida-del-personal § 3.3).
   */
  @IsOptional()
  @IsIn(TIPOS_DE_MERMAS)
  tipo?: TipoDeMermas;
}
