import type { TipoPromocion, TipoScope } from '~/composables/usePromociones'

/**
 * Qué campos pide el drawer según el `tipo` de promoción.
 *
 * A diferencia de `reglas-form-config.ts` esto NO es un espejo de un
 * catálogo (`tipos_regla`): `tipo` es una columna con CHECK, fija a los tres
 * valores de `TipoPromocion` — un tipo nuevo exige rama propia en el
 * evaluador, no hay caso "agregar un tipo sin tocar código" (diseño §Modelo
 * de datos). Por eso el mapa es `Record<TipoPromocion, …>`: al compilador ya
 * no se le puede colar una clave de menos, a diferencia del
 * `Record<string, TipoConfig>` de descuentos/recargos.
 */
export interface PromocionTipoConfig {
  /** `porcentaje` y `nxm`: el descuento en decimal (0.10 = 10%). */
  campoPorcentaje: boolean
  labelPorcentaje?: string
  /** Solo `nxm`: cada cuántas unidades se regala una (2x1→2, 3x2→3). */
  campoCadaN: boolean
  /** Solo `precio_fijo`: el precio del combo, en moneda oficial. */
  campoMonto: boolean
  /**
   * `false` (porcentaje/nxm): exactamente un scope — a qué le aplica la
   * promo —, sin botones de agregar/quitar.
   * `true` (precio_fijo): 1..N slots, cada uno un componente del combo, con
   * su propia `cantidad`.
   */
  scopesMultiples: boolean
  /**
   * Los tres tipos exigen `fechaInicio`/`fechaFin` — el guardarraíl heredado
   * de eliminar `promocional` (CLAUDE.md, diseño §Modelo de datos): una
   * campaña sin fecha de fin no se acepta. No es un eje que varíe por tipo;
   * queda como campo (en vez de una constante aparte) para que un tipo nuevo
   * que algún día quisiera la excepción no pueda colarse sin declararla acá.
   */
  fechasRequeridas: true
}

export const PROMOCION_CONFIG: Record<TipoPromocion, PromocionTipoConfig> = {
  porcentaje: {
    campoPorcentaje: true,
    labelPorcentaje: 'Porcentaje de descuento',
    campoCadaN: false,
    campoMonto: false,
    scopesMultiples: false,
    fechasRequeridas: true,
  },
  nxm: {
    campoPorcentaje: true,
    labelPorcentaje: 'Porcentaje sobre la unidad más barata del grupo',
    campoCadaN: true,
    campoMonto: false,
    scopesMultiples: false,
    fechasRequeridas: true,
  },
  precio_fijo: {
    campoPorcentaje: false,
    campoCadaN: false,
    campoMonto: true,
    scopesMultiples: true,
    fechasRequeridas: true,
  },
}

export const TIPO_PROMOCION_OPTIONS: { label: string, value: TipoPromocion }[] = [
  { label: 'Porcentaje (ej. happy hour)', value: 'porcentaje' },
  { label: 'N x M (ej. 2x1, 3x2)', value: 'nxm' },
  { label: 'Precio fijo (combo)', value: 'precio_fijo' },
]

export const TIPO_SCOPE_OPTIONS: { label: string, value: TipoScope }[] = [
  { label: 'Ítems específicos', value: 'items' },
  { label: 'Una categoría', value: 'categoria' },
  { label: 'Todo el pedido', value: 'venta' },
]

/** `USelectMenu`/reka-ui rechaza un item con `value` vacío (medido en
 *  `items.vue`, ver `docs/patterns/frontend.md` §5): "Físico y online" (=
 *  `canal: null`) necesita un centinela, no `''`. Se traduce a `null` al
 *  armar el body. */
export const CANAL_SENTINEL_AMBOS = 'ambos'

export const CANAL_OPTIONS: { label: string, value: string }[] = [
  { label: 'Físico y online', value: CANAL_SENTINEL_AMBOS },
  { label: 'Solo físico', value: 'fisico' },
  { label: 'Solo online', value: 'online' },
]

/** ISO-8601: 1=lunes…7=domingo (mismo orden que `Promocion.diasSemana`). */
export const DIA_SEMANA_OPTIONS: { label: string, value: number }[] = [
  { label: 'Lunes', value: 1 },
  { label: 'Martes', value: 2 },
  { label: 'Miércoles', value: 3 },
  { label: 'Jueves', value: 4 },
  { label: 'Viernes', value: 5 },
  { label: 'Sábado', value: 6 },
  { label: 'Domingo', value: 7 },
]
