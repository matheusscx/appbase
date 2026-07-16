import {
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

  @IsOptional()
  @ValidateNested()
  @Type(() => PersonalizacionRecetaDto)
  personalizacion?: PersonalizacionRecetaDto;
}
