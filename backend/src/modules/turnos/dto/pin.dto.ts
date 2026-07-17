import { Matches } from 'class-validator';

export class PinDto {
  @Matches(/^\d{6}$/, { message: 'El PIN debe tener exactamente 6 dígitos' })
  pin: string;
}
