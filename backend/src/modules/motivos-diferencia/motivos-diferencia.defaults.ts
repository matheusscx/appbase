export const MOTIVOS_DIFERENCIA_DEFAULTS: {
  nombre: string;
  requiereComentario: boolean;
}[] = [
  { nombre: 'falta de efectivo', requiereComentario: false },
  { nombre: 'sobra de efectivo', requiereComentario: false },
  { nombre: 'divergencia de tarjeta', requiereComentario: false },
  { nombre: 'error de lanzamiento manual', requiereComentario: false },
  { nombre: 'pago no registrado', requiereComentario: false },
  { nombre: 'error operacional', requiereComentario: false },
  { nombre: 'otro', requiereComentario: true },
];
