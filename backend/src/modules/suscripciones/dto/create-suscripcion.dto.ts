import { IsUUID, IsInt, Min, Max, IsOptional } from 'class-validator';

export class CreateSuscripcionDto {
  @IsUUID()
  itemId: string;

  @IsInt()
  @Min(1)
  @Max(28)
  @IsOptional()
  diaMes?: number;

  @IsInt()
  @Min(0)
  @Max(6)
  @IsOptional()
  diaSemana?: number;

  // Tarjeta Oneclick del usuario a la que se cobra el primer período y queda
  // amarrada la suscripción. El método de pago contable y el snapshot de tarjeta
  // se resuelven server-side desde la inscripción.
  @IsUUID()
  inscripcionId: string;
}
