import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class DescartarDesfasesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  recetaItemIds: string[];
}
