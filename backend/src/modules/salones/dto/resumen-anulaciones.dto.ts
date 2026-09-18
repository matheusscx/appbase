import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { TipoMotivoBaja } from '../../motivos-baja/tipo-motivo-baja.enum';

/**
 * Filtros de `GET /salones/anulaciones/resumen` (spec § 5.1). A diferencia
 * del listado paginado (`FindAnulacionesDto`, donde `desde`/`hasta` son
 * opcionales), acá son **obligatorios**: el resumen corre dos consultas SIN
 * `LIMIT` sobre TODO el rango filtrado, así que sin un rango no hay tope y
 * `{}` traería a memoria el historial entero de anulaciones del tenant
 * (hallazgo de la revisión de seguridad, ronda de fix 1). El listado no
 * cambia — pagina, así que un rango sin acotar no tiene el mismo costo.
 *
 * Precedente del repo para el mismo problema en otro reporte agregado sin
 * paginar: `propinas/dto/query-propina-reporte.dto.ts` (mismo tope: 366 días
 * de DIFERENCIA entre `desde` y `hasta`, no de días calendario cubiertos —
 * con fecha pura y `hasta` inclusivo el resumen puede terminar cubriendo
 * hasta 367 días calendario; detalle en el docblock de
 * `validarRangoResumen`). **No se reusa `normalizarRangoReporte`** de ahí:
 * esa función trata `hasta` como EXCLUSIVO y rechaza `hasta <= desde`. Acá
 * `hasta` es INCLUSIVO (`bordeHastaSql`, ya usado por el listado), así que
 * `desde === hasta` es un caso válido — la pantalla lo arma para pedir "hoy"
 * con el mismo día en las dos puntas. La validación del rango (tope de 366
 * días de diferencia, `hasta` no anterior a `desde`) vive en el service
 * (`AnulacionesReporteService.validarRangoResumen`), no en un decorator acá:
 * así se puede unit-testear sin pasar por el `ValidationPipe`.
 */
export class ResumenAnulacionesDto {
  @IsDateString()
  desde: string;

  @IsDateString()
  hasta: string;

  @IsOptional()
  @IsUUID()
  garzonId?: string;

  @IsOptional()
  @IsUUID()
  motivoBajaId?: string;

  @IsOptional()
  @IsEnum(TipoMotivoBaja)
  tipo?: TipoMotivoBaja;
}
