import { IsBase64, IsString, MaxLength } from 'class-validator';

/**
 * El .pfx del firmante y su clave. El archivo viaja en base64 dentro del JSON (el body de la
 * API tiene techo de 100 kB, y un certificado pesa unos pocos kB): 100.000 caracteres son unos
 * 75 kB de archivo, de sobra para un .pfx con su cadena. La clave puede ir vacía: hay
 * certificados sin clave.
 */
export class SubirCertificadoDto {
  @IsBase64()
  @MaxLength(100_000)
  pfxBase64: string;

  @IsString()
  @MaxLength(200)
  clave: string;
}
