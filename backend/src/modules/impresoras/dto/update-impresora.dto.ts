import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import type {
  RolImpresora,
  TipoConexionImpresora,
} from '../entities/impresora.entity';

export class UpdateImpresoraDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nombre?: string;

  @IsOptional()
  @IsIn(['comanda', 'boleta'])
  rol?: RolImpresora;

  @IsOptional()
  @IsIn(['red', 'sistema'])
  tipoConexion?: TipoConexionImpresora;

  @IsOptional()
  @IsString()
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  puerto?: number;

  @IsOptional()
  @IsString()
  nombreCola?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
