import { IsNotEmpty, IsString } from 'class-validator';

export class AnularLiquidacionDto {
  @IsString()
  @IsNotEmpty()
  motivo: string;
}
