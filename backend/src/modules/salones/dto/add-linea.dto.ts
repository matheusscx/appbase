import {
  ArrayMaxSize,
  IsArray,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PersonalizacionRecetaDto } from '../../../common/dto/personalizacion-receta.dto';

export class AddLineaDto {
  @IsUUID()
  itemId: string;

  @IsNumberString()
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

  @IsOptional()
  @ValidateNested()
  @Type(() => PersonalizacionRecetaDto)
  personalizacion?: PersonalizacionRecetaDto;
}
