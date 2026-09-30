import { IsOptional, IsUUID } from 'class-validator';
import { EsFechaOTimestamp } from '../../../common/decorators/fecha-pura.decorator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

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
}
