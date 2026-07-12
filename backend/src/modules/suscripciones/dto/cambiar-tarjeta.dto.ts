import { IsUUID } from 'class-validator';

export class CambiarTarjetaDto {
  // Inscripción Oneclick (tarjeta) del usuario a la que se reasigna la suscripción.
  @IsUUID()
  inscripcionId: string;
}
