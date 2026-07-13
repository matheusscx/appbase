import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import type {
  RolImpresora,
  TipoConexionImpresora,
} from '../entities/impresora.entity';

export class CreateImpresoraDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsIn(['comanda', 'boleta'])
  rol: RolImpresora;

  @IsIn(['red', 'sistema'])
  tipoConexion: TipoConexionImpresora;

  @ValidateIf((o: CreateImpresoraDto) => o.tipoConexion === 'red')
  @IsString()
  @IsNotEmpty()
  host?: string;

  @ValidateIf((o: CreateImpresoraDto) => o.tipoConexion === 'red')
  @IsInt()
  @Min(1)
  puerto?: number;

  @ValidateIf((o: CreateImpresoraDto) => o.tipoConexion === 'sistema')
  @IsString()
  @IsNotEmpty()
  nombreCola?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
