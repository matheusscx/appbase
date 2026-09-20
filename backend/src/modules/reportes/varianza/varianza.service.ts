import { Injectable } from '@nestjs/common';
import { Db } from '../../../common/db/db.service';
import type { PaginatedResponse } from '../../../common/interfaces/paginated-response.interface';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../../common/utils/pagination.util';
import { QueryVarianzaDto } from './dto/query-varianza.dto';

/**
 * Σ por moneda, **sin convertir nunca entre monedas**.
 *
 * 📌 Se duplica respecto de `anulaciones-reporte.service.ts` a propósito: es el
 * **segundo** uso, y la convención del repo es duplicar dos veces y extraer a la
 * tercera (`CLAUDE.md`, "Archivos"). El tercer reporte que la necesite la mueve
 * a `common/`.
 */
export interface CostoPorMoneda {
  monedaId: string;
  /** Decimal serializado, a `ESCALA_COSTO`. Nunca `number`. */
  monto: string;
}

/**
 * Los dos recuentos aplicados que cierran la ventana de un (item, ubicación).
 *
 * ⛔ **El filtro se ancla en `secuencia`, no en las fechas.** El kardex
 * documenta que `creado_el` **no sirve para ordenar**: es la hora en que
 * *empezó* la transacción, y dos que compiten por el lock del mismo producto
 * pueden aplicarse en orden inverso (docblock de `secuencia` en
 * `movimiento-inventario.entity.ts`). La `secuencia` exacta la da
 * `recuento_inventario_linea.movimiento_id`.
 *
 * ⚠️ `secuenciaDesde`/`secuenciaHasta` son `null` cuando ese recuento **dio
 * justo**: un delta cero no escribe movimiento, así que no hay `movimiento_id`
 * del cual sacarla (`recuentos.service.ts`). En ese caso el borde cae de nuevo
 * en `aplicado_el` y vuelve el riesgo de orden — lo detecta la columna «Otros».
 */
export interface VentanaVarianza {
  itemId: string;
  ubicacionId: string;
  recuentoInicialId: string;
  recuentoFinalId: string;
  /** `A.aplicado_el`. Para MOSTRAR, no para filtrar. */
  desdeEl: Date;
  /** `B.aplicado_el`. Para MOSTRAR, no para filtrar. */
  hastaEl: Date;
  secuenciaDesde: string | null;
  secuenciaHasta: string | null;
}

/**
 * Una fila del reporte: un (producto, ubicación) y su ventana.
 *
 * Los números son string a escala 4 —`Decimal.js` de punta a punta, nunca
 * `number`— y vienen en `null` cuando `medible` es `false`.
 */
export interface VarianzaFila {
  itemId: string;
  itemNombre: string;
  unidadMedida: string;
  ubicacionId: string;
  ubicacionNombre: string;
  /** `false` cuando el rango no tiene dos recuentos aplicados: "falta contarlo". */
  medible: boolean;
  desdeEl: Date | null;
  hastaEl: Date | null;
  recuentoInicialId: string | null;
  recuentoFinalId: string | null;
  /** Σ salidas `venta`, MENOS entradas `anulacion` y `devolucion`: es neto. */
  teorico: string | null;
  merma: string | null;
  cortesia: string | null;
  /** Σ `recuento` con signo: salidas menos entradas. Un sobrante resta. */
  sinExplicacion: string | null;
  /**
   * El **residuo** entre las dos formas de calcular el consumo real.
   * Estructuralmente cero; es un detector, no un bucket.
   *
   * ⚠️ **Viaja siempre, incluso en `'0.0000'`.** Omitirlo cuando es cero dejaría
   * al consumidor sin poder distinguir "cerró perfecto" de "esta versión todavía
   * no lo calcula", que es justo la ambigüedad que la columna existe para
   * cerrar.
   */
  otros: string | null;
  costoSinExplicacion: CostoPorMoneda[];
  faltaCosto: boolean;
}

/**
 * Reporte de varianza (AVT): consumo **teórico** —lo que las recetas dicen que
 * se consumió, dado lo vendido— contra consumo **real** entre dos conteos.
 *
 * Spec: `docs/superpowers/specs/2026-09-19-modulo-reportes-varianza-design.md`.
 *
 * 📌 **El teórico no se recalcula desde las recetas: ya está escrito.** Vender
 * una receta descuenta sus ingredientes del kardex con la receta vigente en ese
 * momento (`ItemsService.venderIngredientesReceta`), así que el consumo teórico
 * **es** el conjunto de salidas `motivo='venta'`. Recalcularlo desde
 * `receta_ingredientes` mentiría cada vez que alguien edita una receta — el repo
 * ya depende de esto para reponer stock al cancelar una venta
 * (`VentasService.cancelarUnaVez`, que lee el kardex y no las recetas).
 *
 * ⚠️ **Este service está a medio construir a propósito.** La Tarea 1 del plan
 * deja el módulo, el permiso y la ruta en pie; las tareas 2 a 5 completan la
 * ventana, los cuatro números, «Otros» y la plata
 * (`docs/superpowers/plans/2026-09-19-modulo-reportes-varianza.md`). Hasta
 * entonces `findAll` devuelve una página vacía, que es una respuesta **honesta**
 * —no hay filas calculadas— y no un placeholder con datos inventados.
 */
@Injectable()
export class VarianzaService {
  constructor(private readonly db: Db) {}

  /**
   * ⚠️ **Sin `async` a propósito, y es temporal.** El cuerpo todavía no toca la
   * base —la consulta la traen las tareas 2 a 5—, y un método `async` sin
   * ningún `await` es un error de lint (`require-await`), no un warning. El
   * tipo de retorno ya es el definitivo: `async` vuelve en cuanto haya una
   * consulta que esperar, sin que ningún llamador se entere.
   */
  findAll(
    _tenantId: string,
    query: QueryVarianzaDto,
  ): Promise<PaginatedResponse<VarianzaFila>> {
    const { page, pageSize } = resolvePagination(query);

    return Promise.resolve({
      data: [],
      meta: buildPaginationMeta(page, pageSize, 0),
    });
  }
}
