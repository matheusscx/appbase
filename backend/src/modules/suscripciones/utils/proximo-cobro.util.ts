function toISODate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Calcula la próxima fecha de cobro para una suscripción, en base a su
 * frecuencia y a un ancla (día del mes o día de la semana).
 *
 * Función pura, sin dependencias de zona horaria más allá de las que ya
 * trae `Date` en el entorno de ejecución (se opera solo con año/mes/día).
 *
 * - `mensual`: usa `diaMes` (1-28, evita meses cortos) del mes siguiente al alta.
 * - `quincenal`: primera ocurrencia posterior al alta entre `diaMes`,
 *   `diaMes + 15` (mismo mes) o `diaMes` del mes siguiente.
 * - `semanal`: usa `diaSemana` (0-6, 0 = domingo) de la semana siguiente al alta.
 */
export function calcularProximoCobro(
  frecuencia: string,
  desde: Date,
  diaMes?: number | null,
  diaSemana?: number | null,
): string {
  const base = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate());

  if (frecuencia === 'mensual') {
    return toISODate(
      new Date(base.getFullYear(), base.getMonth() + 1, diaMes as number),
    );
  }

  if (frecuencia === 'quincenal') {
    const d = diaMes as number;
    const candidatas = [
      new Date(base.getFullYear(), base.getMonth(), d),
      new Date(base.getFullYear(), base.getMonth(), d + 15),
      new Date(base.getFullYear(), base.getMonth() + 1, d),
    ];
    const proxima = candidatas.find((c) => c.getTime() > base.getTime());
    return toISODate(proxima as Date);
  }

  // semanal: siempre en la semana siguiente (7 a 13 días desde el alta)
  const delta = ((diaSemana as number) - base.getDay() + 7) % 7;
  return toISODate(
    new Date(base.getFullYear(), base.getMonth(), base.getDate() + delta + 7),
  );
}
