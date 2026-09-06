import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateUbicacionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombre: string;

  // Acepta los dos valores para que el 400 de "el local no se crea" salga del
  // service (con el mensaje que explica por qué) y no de un enum que solo
  // deja pasar 'bodega': ver UbicacionesService.create.
  @IsIn(['local', 'bodega'])
  tipo: 'local' | 'bodega';

  @IsBoolean()
  @IsOptional()
  activo?: boolean;
}
