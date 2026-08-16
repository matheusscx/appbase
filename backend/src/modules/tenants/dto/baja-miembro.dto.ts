import { IsIn, IsOptional } from 'class-validator';
import type { DecisionGarzonBaja } from '../tenants.service';

/**
 * Qué hacer con el garzón cuya credencial era la cuenta que se da de baja.
 *
 * Opcional en el DTO y **obligatorio en el service cuando hay vínculo**: la
 * mayoría de las bajas no tocan ningún garzón, y exigirlo siempre obligaría a
 * quien llama a contestar una pregunta que no se le hizo. `TenantsService`
 * rechaza la baja —nombrando al garzón y las dos salidas— cuando el vínculo
 * existe y esto no vino.
 *
 * Va por query y no por body: es un `DELETE`, y un body en un `DELETE` es un
 * borde que no todos los clientes HTTP mandan igual.
 */
export class BajaMiembroDto {
  @IsOptional()
  @IsIn(['sigue', 'no-sigue'], {
    message: "garzon debe ser 'sigue' o 'no-sigue'",
  })
  garzon?: DecisionGarzonBaja;
}
