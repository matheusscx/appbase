// Cubren las dos direcciones: las tres primeras explican faltantes; "Error de
// recepción" y "Error de registro" explican faltante Y sobrante.
export const MOTIVOS_DIFERENCIA_INVENTARIO_FIJOS = [
  'Merma no declarada',
  'Robo',
  'Error de recepción',
  'Error de registro',
  'Sobre-porcionado',
  'Otro',
] as const;
