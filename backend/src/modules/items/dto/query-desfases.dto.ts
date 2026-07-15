import { IsOptional, IsUUID } from 'class-validator';

export class QueryDesfasesDto {
  @IsUUID()
  @IsOptional()
  ingredienteItemId?: string;
}
