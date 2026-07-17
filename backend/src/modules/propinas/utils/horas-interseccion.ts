import Decimal from 'decimal.js';

export function horasInterseccionHoras(
  inicioSesion: Date,
  finSesionOAhora: Date,
  fechaDesde: Date,
  fechaHasta: Date,
): string {
  const inicio = Math.max(inicioSesion.getTime(), fechaDesde.getTime());
  const fin = Math.min(finSesionOAhora.getTime(), fechaHasta.getTime());

  if (fin <= inicio) {
    return '0.0000';
  }

  return new Decimal(fin - inicio)
    .div(1000)
    .div(60)
    .div(60)
    .toFixed(4);
}
