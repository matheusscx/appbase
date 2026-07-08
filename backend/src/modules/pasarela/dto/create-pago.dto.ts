import {
  IsNumberString,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
} from 'class-validator';

export class CreatePagoDto {
  @IsNumberString()
  monto: string;

  @IsString()
  @Length(1, 255)
  descripcion: string;

  // La app vuelve aquí tras el pago; se le agregan ?ordenId=&estado=.
  @IsUrl({ require_tld: false }) // permite http://localhost en dev
  urlRetorno: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Matches(/^\S+$/)
  pagadorRef?: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  referenciaExterna?: string;
}
