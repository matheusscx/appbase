import { IsUUID, Matches } from 'class-validator';

export class IniciarSesionDto {
  @Matches(/^\d{6}$/, { message: 'El PIN debe tener exactamente 6 dígitos' })
  pin: string;

  @IsUUID()
  turnoId: string;
}
