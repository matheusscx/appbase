import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class CreateGarzonDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  // PIN operativo: exactamente 6 dígitos numéricos.
  @Matches(/^\d{6}$/, { message: 'El PIN debe tener exactamente 6 dígitos' })
  pin: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
