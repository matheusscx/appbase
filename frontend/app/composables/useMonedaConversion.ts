import Decimal from 'decimal.js'
import type { MonedaDisplayConfig } from '~/types/moneda'

export function useMonedaConversion() {
  const store = useMonedasStore()
  const { formatMonto } = useFormatters()

  const monedaOficial = computed(() => store.monedaOficial)

  function esMonedaExtranjera(monedaId: string): boolean {
    const oficial = store.monedaOficial
    return !!oficial && monedaId !== oficial.monedaId
  }

  function getConfig(monedaId: string): MonedaDisplayConfig | undefined {
    return store.getById(monedaId)
  }

  /** Misma lógica que el backend: precio × valor_del_dia → moneda oficial. */
  function convertirAMonedaOficial(precio: string, monedaId: string): string {
    if (!esMonedaExtranjera(monedaId)) return precio
    const tasa = new Decimal(store.getById(monedaId)?.valorDelDia ?? '1')
    return new Decimal(precio).times(tasa).toFixed(4)
  }

  function monedasExtranjerasDeIds(monedaIds: string[]): MonedaDisplayConfig[] {
    const seen = new Set<string>()
    const result: MonedaDisplayConfig[] = []
    for (const id of monedaIds) {
      if (!esMonedaExtranjera(id) || seen.has(id)) continue
      seen.add(id)
      const cfg = store.getById(id)
      if (cfg) result.push(cfg)
    }
    return result
  }

  function formatTasa(moneda: MonedaDisplayConfig): string {
    const oficial = store.monedaOficial
    if (!oficial) return '—'
    return `1 ${moneda.codigoIso} = ${formatMonto(moneda.valorDelDia, oficial.monedaId)}`
  }

  return {
    monedaOficial,
    esMonedaExtranjera,
    getConfig,
    convertirAMonedaOficial,
    monedasExtranjerasDeIds,
    formatTasa,
  }
}
