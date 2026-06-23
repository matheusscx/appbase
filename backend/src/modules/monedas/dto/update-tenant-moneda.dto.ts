import { IsBoolean, IsOptional, IsNumberString } from 'class-validator';

export class UpdateTenantMonedaDto {
  @IsOptional()
  @IsBoolean()
  habilitada?: boolean;

  @IsOptional()
  @IsNumberString()
  valorDelDia?: string;
}
