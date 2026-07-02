import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryItemsDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['producto', 'servicio'])
  tipo?: 'producto' | 'servicio';

  @IsOptional()
  @IsUUID()
  categoriaId?: string;
}
