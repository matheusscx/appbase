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

  // La pasarela solicita 4 URLs al iniciar. A las de retorno del navegador
  // (exito/fracaso/pendiente, GET) se les agregan ?ordenId=&estado=. urlCallback
  // (POST) es server-to-server para apps externas; el monolito usa callback in-process.

  /** Retorno del navegador cuando la orden queda pagada/conciliada. */
  @IsUrl({ require_tld: false }) // permite http://localhost en dev
  urlExito: string;

  /** Retorno del navegador cuando la orden queda fallida. */
  @IsUrl({ require_tld: false })
  urlFracaso: string;

  /** Retorno del navegador para pagos con conciliación demorada. Default: urlExito. */
  @IsOptional()
  @IsUrl({ require_tld: false })
  urlPendiente?: string;

  /** Callback server-to-server (POST {ordenId}) para apps externas. */
  @IsOptional()
  @IsUrl({ require_tld: false })
  urlCallback?: string;

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
