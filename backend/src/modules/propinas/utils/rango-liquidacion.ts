import { BadRequestException } from '@nestjs/common';

/**
 * Convierte el par de fechas de una liquidación a `Date` y corta lo que el
 * decorador no puede cortar. Lo usan los tres puntos donde se construye el
 * período: `crear()`, `liquidar()` y el `preview` del controller.
 *
 * **Por qué no alcanza `@IsISO8601({ strict: true })`** (medido 2026-08-07
 * contra validator.js y el Postgres 15 del compose):
 *
 * | valor          | `strict` | `new Date(v)`  | qué pasaba |
 * |----------------|----------|----------------|------------|
 * | `2026-02-31`   | rechaza  | `2026-03-03`   | período corrido **persistido**, sin error |
 * | `2026-02-29`   | rechaza  | `2026-03-01`   | ídem (2026 no es bisiesto) |
 * | `2028-02-29`   | PASA     | `2028-02-29`   | correcto: bisiesto real |
 * | `2026-W32-1`   | **PASA** | `Invalid Date` | 500 |
 * | `20260807`     | **PASA** | `Invalid Date` | 500 |
 *
 * Las dos últimas son ISO 8601 legítimas, así que `strict` las acepta, pero
 * `new Date` no las sabe leer. Y la guarda de orden **no las frena**: compara
 * `NaN <= NaN`, que es siempre `false`. El `Date` inválido llegaba a la query y
 * Postgres cortaba con `invalid input syntax for type timestamp with time zone:
 * "0NaN-NaN-NaNTNaN:NaN:NaN.NaN+NaN:NaN"` — un 500 donde correspondía un 400.
 *
 * ⚠️ A diferencia de `normalizarRangoReporte`, **no** exige `YYYY-MM-DD`: acá un
 * timestamp completo es un límite de período legítimo y el SQL no hace `::date`.
 * Copiar el `@Matches` del reporte rompería a quien mande hora.
 */
export function rangoLiquidacionDesde(
  fechaDesde: string,
  fechaHasta: string,
): { fechaDesde: Date; fechaHasta: Date } {
  const desde = new Date(fechaDesde);
  const hasta = new Date(fechaHasta);

  if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) {
    throw new BadRequestException(
      'Las fechas del período deben ser fechas ISO 8601 reales',
    );
  }
  if (hasta <= desde) {
    throw new BadRequestException('La fecha hasta debe ser posterior a desde');
  }

  return { fechaDesde: desde, fechaHasta: hasta };
}
