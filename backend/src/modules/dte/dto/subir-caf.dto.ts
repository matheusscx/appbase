import { IsBase64, MaxLength } from 'class-validator';

/**
 * El archivo de folios (CAF) del SII, en base64 dentro del JSON. Un CAF pesa 2 a 3 kB:
 * 50.000 caracteres son unos 37 kB de archivo, de sobra.
 */
export class SubirCafDto {
  @IsBase64()
  @MaxLength(50_000)
  xmlBase64: string;
}
