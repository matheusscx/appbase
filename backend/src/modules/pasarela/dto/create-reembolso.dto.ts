import { IsNumberString } from 'class-validator';

export class CreateReembolsoDto {
  @IsNumberString()
  monto: string;
}
