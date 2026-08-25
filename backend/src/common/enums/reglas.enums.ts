/**
 * Enums compartidos por los catálogos de reglas de precio (descuentos / recargos).
 * Reflejan los tipos PG `modo_regla` y `condicion_tipo` definidos en startup-pos.sql.
 */

export enum ModoRegla {
  PORCENTAJE = 'porcentaje',
  MONTO_FIJO = 'monto_fijo',
}

export enum CondicionTipo {
  NINGUNA = 'ninguna',
  CUSTOMER = 'customer',
  PRODUCTO = 'producto',
  CATEGORIA = 'categoria',
  FECHA = 'fecha',
  METODO_PAGO = 'metodo_pago',
  VENCIMIENTO = 'vencimiento',
  MONTO_MINIMO = 'monto_minimo',
  CANTIDAD_MINIMA = 'cantidad_minima',
}

/**
 * Dónde se aplica una regla de precio: sobre una LÍNEA del carrito o sobre el
 * TOTAL de la venta. No es un detalle de presentación — decide contra qué
 * magnitud se evalúa: un "20% sobre compras de $50.000" medido contra una línea
 * cobra distinto que medido contra la venta, y hasta acá el catálogo no tenía
 * cómo decir cuál de las dos quiso el que la creó.
 *
 * Es **binario a propósito** (decisión del owner, 2026-08-15: "si aplica por
 * línea o por venta"). Un negocio que quiera la misma promo en los dos lugares
 * crea dos reglas: es más trabajo una vez, contra un tercer estado que habría
 * que explicar en cada pantalla y respetar en cada puerta.
 */
export enum NivelRegla {
  /** Se asocia a ítems (`item_descuentos` / `item_recargos`) y se evalúa por línea. */
  LINEA = 'linea',
  /** Se elige en la venta (`descuentosVentaIds` / `recargosVentaIds`) y se evalúa sobre el total. */
  VENTA = 'venta',
}
