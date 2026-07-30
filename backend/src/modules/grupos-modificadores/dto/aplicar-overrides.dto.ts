import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { IsDecimalNoNegativo } from '../../../common/decorators/decimal-signo.decorator';

export class AplicarOverridesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  itemGrupoIds: string[];

  @IsUUID()
  grupoOpcionId: string;

  @ValidateIf((o: AplicarOverridesDto) => o.cantidad !== '')
  @IsOptional()
  @IsNumberString()
  cantidad?: string;

  @ValidateIf((o: AplicarOverridesDto) => o.unidadCodigo !== '')
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  unidadCodigo?: string;

  // Dinero, mismo criterio que su gemelo de `items` (`>= 0`). El `@ValidateIf` sigue
  // mandando: vacío es "no aplicar este override" y saltea todos los validadores.
  @ValidateIf((o: AplicarOverridesDto) => o.precioExtra !== '')
  @IsOptional()
  @IsNumberString()
  @IsDecimalNoNegativo()
  precioExtra?: string;
}
