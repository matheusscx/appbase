import type { TipoMotivoBaja } from '~/composables/useSalones'

/**
 * Espejo de `ResumenNegocioHoy` (`backend/src/modules/resumen-negocio/resumen-negocio.service.ts`),
 * copiado campo por campo (spec `2026-09-18-dashboard-inicio-design.md` § 3.2 y
 * § 5.1) — mismo criterio que `~/types/boleta.ts` mientras backend y frontend
 * no comparten workspace (`docs/agent/pendientes.md` § "workspace compartido").
 * Único consumidor: `InicioHoy.vue` y sus bloques (`InicioVentas.vue`,
 * `InicioPorCobrar.vue`, `InicioPerdidas.vue`, `InicioMasVendidos.vue`).
 */

/** Espejo de `Comparado<T>`. */
export interface Comparado<T = string> {
  hoy: T
  semanaPasada: T
  /** `(hoy − semanaPasada) / semanaPasada`, `toFixed(4)`; `null` si semanaPasada ≤ 0. */
  variacion: string | null
}

export interface VentasHoy {
  /** NETO de notas de crédito: `vendidoDesglose.bruto − vendidoDesglose.notasCredito` en `hoy`. */
  vendido: Comparado
  /** De hoy: lo vendido sin descontar, y lo que restaron las notas de crédito de hoy (positivo). */
  vendidoDesglose: { bruto: string, notasCredito: string }
  /** NETO de lo devuelto: `cobradoDesglose.cobrado − cobradoDesglose.devuelto` en `hoy`. */
  cobrado: Comparado
  /** De hoy: lo cobrado sin descontar, y lo devuelto hoy (efectivo de las correcciones, devoluciones por la máquina o el banco y REFUND aprobados), positivo. */
  cobradoDesglose: { cobrado: string, devuelto: string }
  cantidad: Comparado<number>
  /** `null` cuando esa cantidad es 0 o el neto no es positivo: no hay ticket que promediar. */
  ticketPromedio: Comparado<string | null>
  /** Vendido de HOY por canal, no comparado contra la semana pasada. */
  porCanal: { fisico: string, online: string }
}

export interface PorCobrar {
  cantidad: number
  saldo: string
}

/** Espejo de `CostoPorMoneda` (`anulaciones-reporte.service.ts`): el costo nunca se convierte de moneda. */
export interface CostoPorMoneda {
  monedaId: string
  monto: string
}

/**
 * Espejo de `GrupoResumen & { tipo: TipoMotivoBaja }` — la forma `porTipo` de `ResumenAnulaciones`.
 * El backend trae además `fiscal` (el IVA de las cortesías, 2026-10-03), que el Inicio no muestra.
 */
export interface AnulacionPorTipo {
  tipo: TipoMotivoBaja
  /** Σ `cantidad` de las filas del grupo. */
  platos: string
  /** Σ del `precioCarta` ya redondeado de cada fila. */
  precioCarta: string
  /** Σ por moneda, solo de las filas valorizadas. */
  costo: CostoPorMoneda[]
  /** Cuántas anulaciones del grupo quedaron sin valorizar. */
  sinValorizar: number
}

/** Espejo de `ResumenMermas` (`mermas.service.ts`). */
export interface ResumenMermas {
  cantidad: number
  costo: CostoPorMoneda[]
  sinValorizar: number
}

/**
 * Espejo de `PerdidasHoy`. Sin "total de pérdidas": sumar los dos bloques
 * contaría dos veces un plato quemado en mesa (anulación tipo merma Y merma
 * de cocina a la vez), y los costos vienen en más de una moneda (spec § 4.4).
 */
export interface PerdidasHoy {
  anulaciones: AnulacionPorTipo[]
  mermas: ResumenMermas
}

export interface MasVendidoItem {
  itemId: string
  itemNombre: string
  /**
   * Neto, en unidad base: Σ `venta_detalles.cantidad` de lo vendido hoy menos
   * la de las líneas de las correcciones de hoy, sin la línea de ajuste.
   */
  cantidad: string
  /**
   * Neto: Σ `venta_detalles.total_linea` de lo vendido hoy menos la de las
   * líneas de las correcciones de hoy, sin la línea de ajuste.
   */
  monto: string
}

export interface ResumenNegocioHoy {
  /** `YYYY-MM-DD`, día local del tenant. */
  fecha: string
  ventas: VentasHoy
  porCobrar: PorCobrar
  perdidas: PerdidasHoy
  /** Hasta 5, `ORDER BY monto DESC, itemId`; solo entran ítems con neto > 0. */
  masVendidos: MasVendidoItem[]
}
