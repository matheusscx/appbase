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
import { EsCosto } from '../../../common/decorators/escala-moneda.decorator';

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

  // Dinero, mismo criterio que su gemelo de `items`: `>= 0` y `@EsCosto()`
  // (escala 4, es precio por unidad de la opción). Que sean el mismo criterio
  // hay que sostenerlo: sin la marca acá, el override se validaba por la ruta
  // de `items` y no por ésta, que es la misma asimetría que tenía el PATCH de
  // ítems. El `@ValidateIf` sigue mandando para los validadores de
  // class-validator; el pipe no lo lee, pero el vacío pasa igual porque
  // `new Decimal('')` tira y su `catch` deja pasar lo no parseable.
  @ValidateIf((o: AplicarOverridesDto) => o.precioExtra !== '')
  @IsOptional()
  @IsNumberString()
  @IsDecimalNoNegativo()
  @EsCosto()
  precioExtra?: string;
}
