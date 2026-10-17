import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { IdEnMinusculas } from '../../../common/decorators/id-en-minusculas.decorator';

export class UpdateRepartidorDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefono?: string | null;

  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  activo?: boolean;

  /** `null` le saca la tarifa; ausente la deja como está. */
  @IsOptional()
  @IdEnMinusculas()
  @IsUUID()
  tarifaPagoId?: string | null;
}
