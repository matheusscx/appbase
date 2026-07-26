import Decimal from 'decimal.js';

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
  return new Decimal(cantidadIngresada)
    .mul(costoUnitario)
    .div(cantidadConvertidaABase)
    .toFixed(4);
}
