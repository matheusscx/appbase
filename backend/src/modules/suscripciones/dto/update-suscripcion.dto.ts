import { IsIn } from 'class-validator';

/** Una suscripción se da de baja y nada más: no existe pausarla (owner, 2026-10-17). */
export class UpdateSuscripcionDto {
  @IsIn(['cancelar'])
  accion: 'cancelar';
}
