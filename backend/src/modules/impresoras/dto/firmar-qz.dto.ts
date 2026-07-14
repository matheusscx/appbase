import { IsString } from 'class-validator';

export class FirmarQzDto {
  @IsString()
  data: string;
}
