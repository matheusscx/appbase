import {
  ArrayMaxSize,
  IsArray,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PersonalizacionRecetaDto } from '../../../common/dto/personalizacion-receta.dto';
import { IdEnMinusculas } from '../../../common/decorators/id-en-minusculas.decorator';
import { IsDecimalHasta } from '../../../common/decorators/decimal-signo.decorator';
import { MAX_UNIDADES_POR_VENTA } from '../../../common/utils/tope-unidades-venta.util';

export class AddLineaDto {
  // En minúsculas: la línea de cuenta no pasa por `aliasarCasingDeIds`, y el id
  // va crudo a los resolvers de la personalización y a la búsqueda del ítem
  // vivo. En mayúsculas daba 404 "Ítem … no encontrado" (medido el 2026-10-08).
  @IdEnMinusculas()
  @IsUUID()
  itemId: string;

  @IsNumberString()
  @IsDecimalHasta(MAX_UNIDADES_POR_VENTA)
  cantidad: string;

  @IsOptional()
  @IsNumberString()
  cantidadPresentacion?: string;

  @IsOptional()
  @IsString()
  unidadCodigoPresentacion?: string;

  // Las unidades con número de serie que el garzón elige al pedir. Con techo:
  // el service las lockea todas dentro de la transacción que retiene el lock
  // del producto. Mismo 200 que la línea de venta y la de traslado.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID(undefined, { each: true })
  unidadIds?: string[];

  // `IsObject` además de `ValidateNested`: este deja pasar un array, que se
  // aceptaba con 201 guardando `omitidos: []`, y al cerrar la cuenta se
  // descontaba el ingrediente omitido (medido el 2026-10-08).
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PersonalizacionRecetaDto)
  personalizacion?: PersonalizacionRecetaDto;
}
