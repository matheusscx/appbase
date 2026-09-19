import { BadRequestException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { Db } from '../../../common/db/db.service';
import {
  diaNegocioTenant,
  empujarDiaNegocio,
  esFechaPura,
  inicioDiaNegocioSql,
  requiereDiaNegocio,
} from '../../../common/utils/rango-fecha.util';

/**
 * Convierte el par de fechas de una liquidación a `Date` reales, cortando lo
 * que el decorador no puede cortar y expandiendo una fecha pura al **día del
 * negocio** del tenant (Task 4 de `hora-de-corte`). Lo usan los tres puntos
 * donde se construye el período: `crear()`, `liquidar()` y el `preview` del
 * controller (vía `LiquidacionPropinasService.resolverPeriodo`, que es quien
 * toca la base — el controller no).
 *
 * **Contrato de fecha pura vs timestamp**, igual que `rango-fecha.util.ts`:
 * - `fechaDesde` pura (`2026-08-01`) es el **inicio del día del negocio** de
 *   esa fecha: la medianoche local + la hora de corte del tenant.
 * - `fechaHasta` pura es **inclusiva del día completo**: el período termina
 *   al inicio del día del negocio SIGUIENTE — mismo molde que `bordeHastaSql`
 *   (`::date + 1`, nunca `23:59:59`, que se come el último segundo).
 * - Un timestamp completo (`2026-08-01T15:30:00Z`) se respeta TAL CUAL, sin
 *   `::date` que le coma la hora: quien manda un instante pidió ESE corte,
 *   no el día del negocio.
 *
 * La expansión se resuelve en Postgres (DST-correcta, sin librería de
 * zonas) y solo cuando hace falta: con los dos bordes en timestamp no se
 * toca la base (`requiereDiaNegocio`) — pasar zona/corte a una consulta que
 * no los referencia tira un 42P18 en Postgres real.
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
 * `NaN <= NaN`, que es siempre `false`. Por eso el `NaN` se corta ACÁ, antes
 * de decidir si hay que expandir — y antes de que un `Date` inválido llegue a
 * la query y Postgres corte con `invalid input syntax for type timestamp
 * with time zone: "0NaN-NaN-NaNTNaN:NaN:NaN.NaN+NaN:NaN"`, un 500 donde
 * corresponde un 400.
 */
export async function rangoLiquidacion(
  db: DataSource | EntityManager | Db,
  tenantId: string,
  fechaDesde: string,
  fechaHasta: string,
): Promise<{ fechaDesde: Date; fechaHasta: Date }> {
  if (
    Number.isNaN(new Date(fechaDesde).getTime()) ||
    Number.isNaN(new Date(fechaHasta).getTime())
  ) {
    throw new BadRequestException(
      'Las fechas del período deben ser fechas ISO 8601 reales',
    );
  }

  let desde: Date;
  let hasta: Date;

  if (requiereDiaNegocio(fechaDesde, fechaHasta)) {
    const dia = await diaNegocioTenant(db, tenantId);
    const params: unknown[] = [fechaDesde, fechaHasta];
    const idx = empujarDiaNegocio(params, dia);

    // Cada lado se expande solo si es fecha pura; el que trae hora pasa
    // tal cual, con `::timestamptz` y nada más — ver contrato arriba.
    const desdeExpr = esFechaPura(fechaDesde)
      ? inicioDiaNegocioSql('$1::date', idx)
      : '$1::timestamptz';
    const hastaExpr = esFechaPura(fechaHasta)
      ? inicioDiaNegocioSql('$2::date + 1', idx)
      : '$2::timestamptz';

    // Una sola consulta para los dos bordes: no hay razón para pagar dos
    // viajes a la base cuando el resultado cabe en una fila.
    const rows: { desde: Date; hasta: Date }[] = await db.query(
      `SELECT ${desdeExpr} AS desde, ${hastaExpr} AS hasta`,
      params,
    );
    const [fila] = rows;
    desde = fila.desde;
    hasta = fila.hasta;
  } else {
    desde = new Date(fechaDesde);
    hasta = new Date(fechaHasta);
  }

  if (hasta <= desde) {
    throw new BadRequestException('La fecha hasta debe ser posterior a desde');
  }

  return { fechaDesde: desde, fechaHasta: hasta };
}
