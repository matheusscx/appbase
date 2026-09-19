import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import type { EstadoCompra } from '../entities/compra.entity';

export class FindComprasDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['borrador', 'confirmada', 'anulada'])
  estado?: EstadoCompra;

  @IsOptional()
  @IsUUID()
  proveedorId?: string;

  /** Solo las confirmadas con alguna línea sin precio. */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  faltaCosto?: boolean;

  /**
   * Sobre `fecha_documento`, que es `date`: se compara directo, no hay zona
   * que convertir (`docs/patterns/backend.md` § 10b vale para `timestamptz`).
   */
  @IsOptional()
  @IsDateString()
  desde?: string;

  @IsOptional()
  @IsDateString()
  hasta?: string;
}
