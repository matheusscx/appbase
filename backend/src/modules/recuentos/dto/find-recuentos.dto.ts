import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class FindRecuentosDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['borrador', 'aplicado', 'cancelado'])
  estado?: 'borrador' | 'aplicado' | 'cancelado';
}
