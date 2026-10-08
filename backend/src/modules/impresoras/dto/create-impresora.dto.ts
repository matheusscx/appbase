import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type {
  RolImpresora,
  TipoConexionImpresora,
} from '../entities/impresora.entity';

export class CreateImpresoraDto {
  // Los topes de largo son los de las columnas `varchar` de `impresoras`: sin
  // ellos, uno más largo pasaba el DTO y daba 500 al guardar (2026-10-08).
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nombre: string;

  @IsIn(['comanda', 'boleta'])
  rol: RolImpresora;

  @IsIn(['red', 'sistema'])
  tipoConexion: TipoConexionImpresora;

  @ValidateIf((o: CreateImpresoraDto) => o.tipoConexion === 'red')
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  host?: string;

  // Un puerto TCP va de 1 a 65535: uno mayor se guardaba (201) y la
  // impresora no conectaba nunca.
  @ValidateIf((o: CreateImpresoraDto) => o.tipoConexion === 'red')
  @IsInt()
  @Min(1)
  @Max(65535)
  puerto?: number;

  @ValidateIf((o: CreateImpresoraDto) => o.tipoConexion === 'sistema')
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nombreCola?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
