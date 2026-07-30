import { IsUUID, IsNumberString, IsString, IsNotEmpty } from 'class-validator';
import { IsDecimalPositivo } from '../../../common/decorators/decimal-signo.decorator';

export class AjusteCostoDto {
  @IsUUID()
  itemId: string;

  // Costo nuevo del producto. Pisa el promedio ponderado vigente. Un costo de 0
  // o negativo no existe: el ajuste corrige el promedio ponderado, no lo anula.
  @IsNumberString()
  @IsDecimalPositivo()
  costoNuevo: string;

  // Obligatorio: un ajuste de costo es una corrección y tiene que quedar
  // explicada. No lleva causa tipificada (a diferencia de las mermas): es un
  // evento puntual, no un fenómeno recurrente que se reporte por categoría.
  @IsString()
  @IsNotEmpty()
  comentario: string;
}
