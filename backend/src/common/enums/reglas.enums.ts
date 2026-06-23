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
