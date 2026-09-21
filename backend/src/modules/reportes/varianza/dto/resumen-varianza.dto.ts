import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/**
 * Filtros de `GET /reportes/varianza/resumen` (spec § 7.2).
 *
 * ⛔ **`desde`/`hasta` son OBLIGATORIOS acá y opcionales en el listado**, y no es
 * una asimetría cosmética: el resumen corre sus consultas **sin `LIMIT`** sobre
 * todo el rango, así que un `{}` traería a memoria el historial entero del
 * tenant. El listado pagina, o sea que un rango sin acotar no le cuesta lo
 * mismo. Es el bug exacto que la ronda de fix del reporte de anulaciones cerró,
 * y el molde de acá es su `ResumenAnulacionesDto`.
 *
 * ⚠️ **No hereda de una base compartida, y es deliberado.** El plan preveía crear
 * `reportes/dto/rango-reporte.dto.ts` en esta tarea, pero el único que la
 * extendería sería este DTO: `QueryVarianzaDto` ya ocupa su `extends` con la
 * paginación. Una clase base con **un** hijo es el mismo código muerto que la
 * Tarea 1 tuvo que sacar. El precedente del repo va en la misma dirección:
 * `ResumenAnulacionesDto` también declara sus dos fechas y no hereda de nada.
 * Cuando haya un segundo reporte con `/resumen`, ahí nace la base.
 *
 * 📌 **Acepta los mismos filtros que el listado** (menos la paginación) porque el
 * resumen se dibuja **encima de la tabla**: si la tabla está filtrada por una
 * ubicación y el resumen no, los totales describen un conjunto distinto del que
 * el encargado tiene delante, y no hay nada en pantalla que lo avise.
 *
 * ⚠️ **La validación del rango vive en el service, no en un decorator.** Así se
 * puede unit-testear sin pasar por el `ValidationPipe` — mismo motivo que
 * `AnulacionesReporteService.validarRangoResumen`, y el mismo que hace que los
 * tests de DTO no prueben lo que el pipe hace.
 */
export class ResumenVarianzaDto {
  @IsDateString()
  desde: string;

  @IsDateString()
  hasta: string;

  /** La pantalla lo manda con el local por defecto, igual que el listado. */
  @IsOptional()
  @IsUUID()
  ubicacionId?: string;

  @IsOptional()
  @IsUUID()
  itemId?: string;
}
