import { IsNumberString, IsUUID } from 'class-validator';

export class AddLineaDto {
  @IsUUID()
  itemId: string;

  @IsNumberString()
  cantidad: string;
}
