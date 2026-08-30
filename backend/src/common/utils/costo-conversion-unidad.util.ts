import { BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ESCALA_COSTO } from '../constants/escalas';

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
 * Los tres llamadores son los tres lugares donde el costo se convierte de unidad:
 * `ItemsService.ajustarStock` (compra en otra unidad), `ItemsService.update`
 * (cambio de `unidad_medida`, que reconvierte el costo vigente) e
 * `InventarioService.registrarAjusteCosto` (costo tipeado por la unidad elegida).
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
