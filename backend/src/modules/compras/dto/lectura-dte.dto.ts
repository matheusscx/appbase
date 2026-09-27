import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

/** RUT chileno con o sin puntos, con o sin guion; el DV puede ser K. */
export const PATRON_RUT = /^[0-9.\s]{1,12}-?[0-9kK]\s*$/;

/**
 * `PATRON_RUT` no acota el largo por sí solo: el `\s*$` final acepta
 * cualquier cantidad de espacios de cola, así que la cota real va en un
 * `@MaxLength` aparte. 20 alcanza de sobra para un RUT con puntos y guion
 * (máximo 12 dígitos de cuerpo en el patrón).
 */
const LARGO_MAXIMO_RUT = 20;

/**
 * Body de `POST /compras/dte/lectura` (spec compras-xml-dte § 7). Lo arma el
 * navegador con lo que leyó del XML; **solo** estos campos (forbidNonWhitelisted).
 * ⚠️ `tenantId` no está y no puede estar: sale del token.
 */
export class LecturaDteDto {
  @IsString()
  @MaxLength(LARGO_MAXIMO_RUT)
  @Matches(PATRON_RUT)
  emisorRut: string;
  @IsString()
  @MaxLength(LARGO_MAXIMO_RUT)
  @Matches(PATRON_RUT)
  receptorRut: string;
  /** Código SII del tipo (33, 34, 52…). */
  @IsString() @Matches(/^\d{1,3}$/) tipoDte: string;
  @IsString() @MaxLength(40) @Matches(/\S/) folio: string;
  /** Cuando el encargado eligió el proveedor a mano (el RUT no calzó). */
  @IsOptional() @IsUUID() proveedorId?: string;
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  claves: string[];
}
