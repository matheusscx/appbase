import { IsArray, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { IsDecimalNoNegativo } from '../../../common/decorators/decimal-signo.decorator';

export class MontoManualDto {
  @IsUUID()
  garzonId: string;

  // Un monto de propina no puede ser negativo. El CHECK de BD ya lo frenaba,
  // pero devolvía un 500 crudo — y el preview, que no persiste, mostraba el
  // número negativo en pantalla. Quedó fuera del barrido de signo de `74f3f35`.
  @IsDecimalNoNegativo()
  monto: string;
}

export class AjustesRepartoDto {
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  exclusiones?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MontoManualDto)
  montosManuales?: MontoManualDto[];
}
