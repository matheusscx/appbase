import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ModoRegla, CondicionTipo } from '../../../common/enums/reglas.enums';

export class CreateDescuentoDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsUUID()
  tipoReglaId: string;

  @IsEnum(ModoRegla)
  modo: ModoRegla;

  @IsNumberString()
  valor: string;

  @IsOptional()
  @IsEnum(CondicionTipo)
  condicionTipo?: CondicionTipo;

  @IsOptional()
  @IsString()
  condicionValor?: string | null;

  @IsOptional()
  @IsDateString()
  fechaInicio?: string | null;

  @IsOptional()
  @IsDateString()
  fechaFin?: string | null;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
