import {
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LineaJustificacionDto } from './justificar-diferencias.dto';

export class FinalizarCierreDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineaJustificacionDto)
  lineas: LineaJustificacionDto[];

  // Opcional a nivel DTO: solo se exige en el service cuando el cierre es
  // forzado y nadie firmó como testigo (`CajaService.cerrar`) — al congelar
  // el conteo (fase 1) todavía no hay firmas para saber si hará falta.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comentario?: string;

  /**
   * Explicación de texto libre del cajero cuando su descuadre pasó un umbral
   * ("le di vuelto de más", "faltó registrar una compra de insumos"). Siempre
   * opcional: **ningún nivel bloquea el cierre** (owner, 2026-08-23), así que
   * exigirla acá sería reintroducir por la puerta de atrás el bloqueo que esa
   * decisión sacó. Es distinta del `comentario` de arriba (observación del
   * cierre) y del motivo CATEGORIZADO por línea, que va en `lineas`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  explicacionDescuadre?: string;
}
