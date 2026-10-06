import { IsOptional, IsUUID, IsIn } from 'class-validator';
import { EsFechaOTimestamp } from '../../../common/decorators/fecha-pura.decorator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  TipoMotivoBaja,
  tipoMotivoBajaDescuenta,
} from '../../motivos-baja/tipo-motivo-baja.enum';

const MOTIVOS = [
  'compra',
  'venta',
  'devolucion',
  'anulacion',
  'merma',
  'ajuste_manual',
  'ajuste_costo',
  'correccion_compra',
  'inventario_inicial',
  'recuento',
  // Desde `POST /traslados`: el kardex se llena de filas `motivo='traslado'`
  // (dos por línea trasladada), así que sin este valor el backend contesta 400
  // al pedirlas filtradas.
  //
  // ⚠️ Esta lista tiene un gemelo en el frontend —`motivoOpts` de
  // `pages/inventario/index.vue`, que es el mapa de etiquetas del badge y la
  // base del selector del filtro (`motivoFiltroOpts`)— sin enlace de compilación entre los dos
  // lados: agregar un motivo acá y no allá deja el valor inalcanzable desde la
  // pantalla y el badge pintado con el slug crudo. Al tocar esta lista, tocar
  // también ese archivo. (El otro consumidor del endpoint, el historial de
  // `pages/configuracion/items.vue`, no filtra por motivo.)
  'traslado',
];

/**
 * Los tipos de baja que dejan fila en el kardex: los que descuentan. Derivado
 * de `tipoMotivoBajaDescuenta` para que un tipo nuevo se decida en su `switch`
 * y no acá. `no_elaborado` queda afuera: no descuenta, así que filtrar por él
 * siempre traería vacío.
 */
export const TIPOS_BAJA_DEL_KARDEX = Object.values(TipoMotivoBaja).filter(
  tipoMotivoBajaDescuenta,
);

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

  /**
   * Separa las tres bajas, que escriben las tres `motivo = 'merma'` y solo se
   * distinguen por `motivo_baja.tipo` (spec
   * 2026-10-06-kardex-filtro-por-tipo-de-baja). `motivo=merma` sin esto sigue
   * trayendo las tres. Combinado con otro `motivo` es un AND: da vacío.
   *
   * ⚠️ Gemelo en el frontend, igual que `MOTIVOS`: `TIPOS_BAJA_DEL_KARDEX` de
   * `pages/inventario/index.vue`, que arma las opciones de baja del filtro.
   */
  @IsOptional()
  @IsIn(TIPOS_BAJA_DEL_KARDEX)
  motivoBajaTipo?: TipoMotivoBaja;

  @IsOptional()
  @EsFechaOTimestamp()
  desde?: string;

  @IsOptional()
  @EsFechaOTimestamp()
  hasta?: string;
}
