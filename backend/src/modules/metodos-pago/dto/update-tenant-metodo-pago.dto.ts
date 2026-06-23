import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateTenantMetodoPagoDto {
  @IsOptional()
  @IsBoolean()
  habilitada?: boolean;

  @IsOptional()
  @IsBoolean()
  permiteVuelto?: boolean;
}
