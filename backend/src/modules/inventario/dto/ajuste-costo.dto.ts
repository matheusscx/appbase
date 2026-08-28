import {
  IsUUID,
  IsNumberString,
  IsString,
  IsNotEmpty,
  IsOptional,
} from 'class-validator';
import { IsDecimalPositivo } from '../../../common/decorators/decimal-signo.decorator';
import { EsCosto } from '../../../common/decorators/escala-moneda.decorator';

export class AjusteCostoDto {
  @IsUUID()
  itemId: string;

  // Costo nuevo del producto. Pisa el promedio ponderado vigente. Un costo de 0
  // o negativo no existe: el ajuste corrige el promedio ponderado, no lo anula.
  @IsNumberString()
  @IsDecimalPositivo()
  @EsCosto()
  costoNuevo: string;

  // Obligatorio: un ajuste de costo es una corrección y tiene que quedar
  // explicada. No lleva causa tipificada (a diferencia de las mermas): es un
  // evento puntual, no un fenómeno recurrente que se reporte por categoría.
  @IsString()
  @IsNotEmpty()
  comentario: string;

  // Unidad en la que la persona tipeó el costo. Ausente = unidad base del
  // producto (comportamiento histórico). Existe para que la precisión venga de
  // elegir la unidad y no de teclear decimales que la moneda no admite: en un
  // insumo por gramo se carga "5050 por kilo", no "5,0500 por gramo".
  // Ver docs/superpowers/specs/2026-08-28-costo-por-unidad-elegida-design.md
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  unidadCodigo?: string;
}
