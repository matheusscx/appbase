import type { UpdatePreferenciasFinancierasDto } from '../../src/modules/tenants/dto/update-preferencias-financieras.dto';

/**
 * Lo que `PUT /tenants/preferencias-financieras` acepta, sacado de lo que
 * devolvió el `GET`.
 *
 * El `GET` trae además seis campos de solo lectura —el candado de redondeo por
 * país: `modoRedondeoBloqueado`, `modoRedondeoNorma`, `modoRedondeoImpuesto` y
 * sus tres gemelos `nivelRedondeo…`— que el DTO del `PUT` no declara. Mientras
 * el pipe global los borraba callado, los specs reenviaban el `GET` entero; con
 * `forbidNonWhitelisted` (2026-09-27) eso es un 400. La pantalla no lo hace:
 * arma el body campo por campo.
 *
 * Las claves las fija el tipo: el `satisfies` no compila si al DTO le falta o
 * le sobra una respecto de esta lista.
 */
const CAMPOS_DEL_PUT = {
  calculoDescuentos: true,
  calculoRecargos: true,
  formula: true,
  escalaCalculo: true,
  modoRedondeo: true,
  nivelRedondeo: true,
  montoTolerancia: true,
  umbralDescuadreAviso: true,
  umbralDescuadreAlto: true,
  promosAcumulanDescuentos: true,
} satisfies Record<keyof UpdatePreferenciasFinancierasDto, true>;

export function bodyPreferencias(
  leidas: object,
): Partial<UpdatePreferenciasFinancierasDto> {
  return Object.fromEntries(
    Object.entries(leidas).filter(([campo]) => campo in CAMPOS_DEL_PUT),
  );
}
