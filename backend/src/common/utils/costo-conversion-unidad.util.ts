import { BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ESCALA_COSTO } from '../constants/escalas';
import {
  cabeEnColumnaDePlata,
  formatearMontoPersistible,
  TECHO_PERSISTIBLE_FORMATEADO,
} from './monto-persistible.util';

/**
 * Convierte un `costoUnitario` ingresado en una unidad distinta a la base,
 * preservando el valor total de la operación.
 *
 * `costoUnitario` significa "costo por la unidad que el usuario ingresó", no
 * por la unidad base: si la cantidad se convirtió (ver
 * `CatalogService.convertirUnidad`), el costo se convierte junto con ella para
 * no inflar/desinflar el costo por unidad base (comprar "2 kg a 5.000/kg" en
 * un producto en `g` no puede costear a 5.000/g).
 *
 * Fórmula: `costoBase = (cantidadIngresada × costoUnitario) / cantidadConvertidaABase`.
 *
 * Espejo en el frontend: `frontend/app/composables/useUnidadConversion.ts`
 * (`convertirCosto`). No hay workspace compartido entre backend y frontend en
 * este repo, así que la aritmética vive duplicada en los dos lados — si tocás
 * una, revisá la otra.
 */
export function convertirCostoUnitario(
  cantidadIngresada: string,
  costoUnitario: string,
  cantidadConvertidaABase: string,
): string {
  // Escala de costo (4), HALF_UP fijo: tasa interna, misma familia que el CPP —
  // no mira modo_redondeo ni la escala de la moneda (hay costos por gramo).
  return new Decimal(cantidadIngresada)
    .mul(costoUnitario)
    .div(cantidadConvertidaABase)
    .toFixed(ESCALA_COSTO);
}

/**
 * Rechaza el costo POSITIVO que se pierde en la conversión: `convertirCostoUnitario`
 * cuantiza a `ESCALA_COSTO` (4), así que un costo chico por una unidad grande puede
 * aterrizar en `'0.0000'` (0,0001/kg son 0,0000001/g).
 *
 * Hasta el 2026-08-29 esto lo frenaba de rebote el guard de `registrarMovimiento`,
 * que rechazaba todo `costoUnitario <= 0`. Desde que el `0` es un costo legítimo
 * —mercadería de donación o muestra— ese guard solo mira el signo, y sin este
 * chequeo el costo colapsado se persistiría como 0 **en silencio**. La distinción
 * que sostiene: se rechaza el 0 que NADIE escribió, nunca el que alguien eligió.
 *
 * Lo llama todo lugar donde el costo se convierte de unidad —por ejemplo
 * `ItemsService.ajustarStock` (compra en otra unidad), `ItemsService.update`
 * (cambio de `unidad_medida`), `InventarioService.registrarAjusteCosto` (costo
 * tipeado por la unidad elegida) y `ComprasService.costearCompra`, al confirmar y
 * al corregir una compra (precio por la unidad del proveedor)—. Un camino nuevo
 * que convierta un costo va también por acá.
 */
export function assertCostoNoColapsaACero(
  costoOriginal: string,
  costoConvertido: string,
  unidadDestino: string,
): void {
  if (
    new Decimal(costoOriginal).greaterThan(0) &&
    new Decimal(costoConvertido).isZero()
  ) {
    throw new BadRequestException(
      `El costo se pierde al convertirlo a "${unidadDestino}": queda por debajo ` +
        'del cuarto decimal, que es la escala de los costos',
    );
  }
}

/**
 * Rechaza el costo que, ya convertido a la unidad base, no cabe en su columna
 * (`item_producto.costo_actual`, `movimientos_inventario.costo_unitario`,
 * `compra_lineas.costo_unitario_base`: todas `NUMERIC(18,4)`). El techo del DTO
 * (`IsMontoPersistible`) mira el costo tal como se tipeó, y el costo se guarda
 * por unidad base: $99 billones por gramo caben, y por kilo son ×1000. Medido el
 * 2026-10-13: el ajuste de costo, el ajuste de stock, la compra con una unidad o
 * una presentación menor que la base y la corrección de su precio daban 500.
 *
 * Decisión del owner (2026-10-13, por AskUserQuestion de la orquestadora, con la
 * escena "ingrediente por kilo, ajuste por gramo"): "Sí, con aviso". Se rechaza
 * antes de escribir y el aviso dice cuánto sería el costo por unidad base; no
 * cambia cómo se convierte ni qué se guarda.
 *
 * Lo llaman los mismos que `assertCostoNoColapsaACero`, con el costo ya
 * convertido: un camino nuevo que convierta un costo va también por acá.
 */
export function assertCostoConvertidoCabe(
  costoConvertido: string,
  unidadDestino: string,
): void {
  if (!cabeEnColumnaDePlata(costoConvertido)) {
    throw new BadRequestException(
      `El costo por ${unidadDestino} sería de $${formatearMontoPersistible(costoConvertido)}: ` +
        `el sistema no puede guardar costos de $${TECHO_PERSISTIBLE_FORMATEADO} o más`,
    );
  }
}
