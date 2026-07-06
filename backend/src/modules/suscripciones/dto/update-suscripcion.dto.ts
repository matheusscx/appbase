import { IsIn } from 'class-validator';

export class UpdateSuscripcionDto {
  @IsIn(['pausar', 'reanudar', 'cancelar'])
  accion: 'pausar' | 'reanudar' | 'cancelar';
}
