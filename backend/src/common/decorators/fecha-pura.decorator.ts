import { applyDecorators } from '@nestjs/common';
import { IsDateString, IsISO8601, Matches } from 'class-validator';

/**
 * Fecha pura (`YYYY-MM-DD`) — para columnas `date` (o una comparación
 * `::date` explícita en el SQL), NUNCA para un filtro `desde`/`hasta` contra
 * `timestamptz` que pasa por `rango-fecha.util.ts`, o una columna `timestamptz`
 * de bind directo: esas aceptan fecha pura Y timestamp a propósito
 * (`docs/patterns/backend.md` § 10b) — ahí va `EsFechaOTimestamp()`, más abajo.
 *
 * Hacen falta las DOS validaciones, y cada una tapa lo que la otra deja
 * pasar — medido en el molde original, `turnos/dto/query-sesiones.dto.ts`:
 *
 *   - `@Matches` sola acepta `2026-13-45` y `2026-08-45` → Postgres `::date`
 *     los rechaza con 22008 → 500 sin este decorador.
 *   - `@IsISO8601({ strict: true })` sola acepta `2026-08`, `2026-W32-1`,
 *     `20260807` y un timestamp completo → 22007 → 500. Y además acepta
 *     `2026-02-31`, que es sintácticamente ISO pero no existe en el
 *     calendario, si `strict` falta.
 */
export function EsFechaPura(): PropertyDecorator {
  return applyDecorators(
    Matches(/^\d{4}-\d{2}-\d{2}$/, {
      message: '$property debe usar YYYY-MM-DD',
    }),
    IsISO8601(
      { strict: true },
      { message: '$property debe ser una fecha real' },
    ),
  );
}

/**
 * Fecha pura (`YYYY-MM-DD`) O timestamp completo
 * (`YYYY-MM-DDTHH:MM[:SS[.sss]][Z|±HH:MM]`) — para filtros `desde`/`hasta`
 * que pasan por `rango-fecha.util.ts` (`bordeFechaSql`/`bordeHastaSql`
 * expanden solo la fecha pura al día del negocio; el timestamp llega tal
 * cual, sin `::date`) y para columnas `timestamptz` de bind directo sin
 * comparación de rango (garantía de una serie, elaboración/vencimiento de un
 * lote o producto): las dos aceptan a propósito cualquiera de las dos
 * formas.
 *
 * `@IsDateString({ strict: true })` SOLA no alcanza (medido contra Postgres
 * real, `docs/agent/pendientes.md` § 1): acepta `2026-08` y `2026-W32-1`
 * —sintácticamente ISO 8601 válidos— que el bind sin `::date` contra
 * `timestamptz` rechaza con 22007 → 500 (`'2026-08'::timestamptz` y
 * `'2026-W32-1'::timestamptz` fallan; `'20260807'::timestamptz` no falla —
 * Postgres lo interpreta como `2026-08-07`— pero tampoco es el molde que se
 * quiere aceptar). Este `@Matches` exige el guion literal entre año, mes y
 * día (con o sin la hora detrás); `strict` sigue validando el calendario
 * real (`2026-02-31` → 400, no 500).
 */
export function EsFechaOTimestamp(): PropertyDecorator {
  return applyDecorators(
    Matches(
      /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/,
      {
        message:
          '$property debe usar YYYY-MM-DD o un timestamp ISO 8601 completo',
      },
    ),
    IsDateString(
      { strict: true },
      { message: '$property debe ser una fecha real' },
    ),
  );
}
