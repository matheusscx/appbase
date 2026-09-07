import { IsOptional, IsUUID, IsIn, IsDateString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const MOTIVOS = [
  'compra',
  'venta',
  'devolucion',
  'anulacion',
  'merma',
  'ajuste_manual',
  'ajuste_costo',
  'inventario_inicial',
  'recuento',
  // Desde `POST /traslados`: el kardex se llena de filas `motivo='traslado'`
  // (dos por línea trasladada), así que sin este valor el backend contesta 400
  // al pedirlas filtradas.
  //
  // ⚠️ Esta lista tiene un gemelo en el frontend —`motivoOpts` de
  // `pages/inventario/index.vue`, que es a la vez el selector del filtro y el
  // mapa de etiquetas del badge— sin enlace de compilación entre los dos
  // lados: agregar un motivo acá y no allá deja el valor inalcanzable desde la
  // pantalla y el badge pintado con el slug crudo. Al tocar esta lista, tocar
  // también ese archivo. (El otro consumidor del endpoint, el historial de
  // `pages/configuracion/items.vue`, no filtra por motivo.)
  'traslado',
];

export class FindMovimientosDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsOptional()
  @IsUUID()
  ubicacionId?: string;

  @IsOptional()
  @IsIn(MOTIVOS)
  motivo?: string;

  @IsOptional()
  @IsDateString()
  desde?: string;

  @IsOptional()
  @IsDateString()
  hasta?: string;
}
