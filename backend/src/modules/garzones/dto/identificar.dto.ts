import { Matches } from 'class-validator';

export class IdentificarDto {
  @Matches(/^\d{6}$/, { message: 'El PIN debe tener exactamente 6 dígitos' })
  pin: string;
}
