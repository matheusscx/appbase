import { IsNumberString } from 'class-validator';

export class UpdateLineaDto {
  @IsNumberString()
  cantidad: string;
}
