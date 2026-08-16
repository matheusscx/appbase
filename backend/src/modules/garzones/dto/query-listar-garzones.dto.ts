import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { QueryIncluirEliminadosDto } from '../../../common/dto/query-incluir-eliminados.dto';

/**
 * `GET /garzones` suma un opt-in al `incluirEliminados` compartido, en vez de
 * agregarle un campo a `QueryIncluirEliminadosDto`: ese DTO lo usan los 16
 * recursos con papelera y `conPermisos` no significa nada en ninguno de los
 * otros 15.
 */
export class QueryListarGarzonesDto extends QueryIncluirEliminadosDto {
  /**
   * Trae `cuentaEsMiembro` y `puedeOperarSalon` de cada garzón con cuenta.
   * Lo pide solo la ficha de `configuracion/garzones.vue`; las otras cinco
   * pantallas que cargan este listado no los miran y no deben pagarlos
   * (ver `GarzonesService.listar`).
   */
  // Mismo `Transform` que el DTO base y por el mismo motivo: el query string
  // trae 'true'/'false' como texto y `@IsBoolean` los rechazaría siempre.
  @Transform(({ value }) => value === 'true' || value === true)
  @IsOptional()
  @IsBoolean()
  conPermisos?: boolean;
}
