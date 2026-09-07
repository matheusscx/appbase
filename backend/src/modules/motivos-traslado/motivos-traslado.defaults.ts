/**
 * El motivo nace **tipado** y no como texto libre porque el SII distingue
 * tipos de traslado, y nacer con esa forma evita migrar después. Estos son
 * los que aplican a un traslado entre ubicaciones propias.
 *
 * ⛔ Esta lista NO emite nada. El documento chileno del traslado es el DTE 52
 * y **viaja con la mercadería**; nuestro registro interno no lo reemplaza —
 * el tenant lo emite por fuera, igual que hoy hace con las boletas. Tener el
 * traslado registrado no es lo mismo que estar en regla (ADR-010).
 */
export const MOTIVOS_TRASLADO_FIJOS = [
  'Traslado interno',
  'Ventas por efectuar',
  'Consignación',
  'Entrega gratuita',
  'Devolución a proveedor',
] as const;
