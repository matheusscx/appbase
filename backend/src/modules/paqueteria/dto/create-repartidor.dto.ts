import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { IdEnMinusculas } from '../../../common/decorators/id-en-minusculas.decorator';

export class CreateRepartidorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefono?: string | null;

  @IsOptional()
  @IdEnMinusculas()
  @IsUUID()
  tarifaPagoId?: string | null;
}
