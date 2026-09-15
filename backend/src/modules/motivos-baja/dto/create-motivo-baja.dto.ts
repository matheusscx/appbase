import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TipoMotivoBaja } from '../tipo-motivo-baja.enum';

export class CreateMotivoBajaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombre: string;

  @IsEnum(TipoMotivoBaja)
  tipo: TipoMotivoBaja;

  @IsBoolean()
  @IsOptional()
  activo?: boolean;
}
