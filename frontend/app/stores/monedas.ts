import { defineStore } from 'pinia'
import { useApiFetch } from '~/composables/useApiFetch'
import type { MonedaDisplayConfig, MonedaTenantApi } from '~/types/moneda'
import { toDisplayConfig } from '~/types/moneda'

function buildIndexes(list: MonedaDisplayConfig[]) {
  const byId: Record<string, MonedaDisplayConfig> = {}
  const byCodigo: Record<string, MonedaDisplayConfig> = {}
  for (const cfg of list) {
    byId[cfg.monedaId] = cfg
    byCodigo[cfg.codigoIso] = cfg
  }
  return { byId, byCodigo }
}

export const useMonedasStore = defineStore('monedas', () => {
  const config = useRuntimeConfig()
  const monedasById = ref<Record<string, MonedaDisplayConfig>>({})
  const monedasByCodigo = ref<Record<string, MonedaDisplayConfig>>({})
  const loadedForTenantId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const isLoaded = computed(() => {
    const auth = useAuthStore()
    return loadedForTenantId.value === auth.activeTenantId
      && Object.keys(monedasById.value).length > 0
  })

  const monedasList = computed(() => Object.values(monedasById.value))

  const monedasHabilitadas = computed(() =>
    monedasList.value.filter(m => m.habilitada),
  )

  const monedaOficial = computed(() =>
    monedasList.value.find(m => m.esOficial) ?? null,
  )

  const monedaDefault = computed(() =>
    monedasList.value.find(m => m.esDefault) ?? monedaOficial.value,
  )

  function getById(monedaId: string): MonedaDisplayConfig | undefined {
    return monedasById.value[monedaId]
  }

  function getByCodigo(codigoIso: string): MonedaDisplayConfig | undefined {
    return monedasByCodigo.value[codigoIso.trim().toUpperCase()]
  }

  function hydrate(list: MonedaTenantApi[], tenantId: string) {
    const configs = list.map(toDisplayConfig)
    const { byId, byCodigo } = buildIndexes(configs)
    monedasById.value = byId
    monedasByCodigo.value = byCodigo
    loadedForTenantId.value = tenantId
  }

  async function ensureLoaded(): Promise<void> {
    const auth = useAuthStore()
    const tenantId = auth.activeTenantId
    if (!tenantId) return
    if (isLoaded.value || loading.value) return

    loading.value = true
    error.value = null
    try {
      const data = await useApiFetch<MonedaTenantApi[]>(
        `${config.public.apiUrl}/monedas`,
      )
      hydrate(data, tenantId)
    }
    catch (e: unknown) {
      error.value = (e as { data?: { message?: string } })?.data?.message
        ?? 'Error al cargar monedas'
    }
    finally {
      loading.value = false
    }
  }

  function reset(): void {
    monedasById.value = {}
    monedasByCodigo.value = {}
    loadedForTenantId.value = null
    error.value = null
  }

  function patchMoneda(monedaId: string, partial: Partial<MonedaTenantApi>): void {
    const current = monedasById.value[monedaId]
    if (!current) return

    const merged: MonedaTenantApi = {
      monedaId: current.monedaId,
      nombre: current.nombre,
      codigoIso: current.codigoIso,
      simbolo: current.prefix.trim() || null,
      decimales: current.decimals,
      separadorDecimal: current.decimal,
      separadorMiles: current.thousands,
      locale: current.locale,
      habilitada: current.habilitada,
      esDefault: current.esDefault,
      esOficial: current.esOficial,
      valorDelDia: current.valorDelDia,
      ...partial,
    }

    const updated = toDisplayConfig(merged)
    const nextById = { ...monedasById.value, [monedaId]: updated }
    const { byId, byCodigo } = buildIndexes(Object.values(nextById))
    monedasById.value = byId
    monedasByCodigo.value = byCodigo
  }

  function setDefaultMoneda(monedaId: string): void {
    for (const id of Object.keys(monedasById.value)) {
      const cfg = monedasById.value[id]!
      patchMoneda(id, { esDefault: id === monedaId })
    }
  }

  return {
    monedasById,
    monedasByCodigo,
    loadedForTenantId,
    loading,
    error,
    isLoaded,
    monedasList,
    monedasHabilitadas,
    monedaOficial,
    monedaDefault,
    getById,
    getByCodigo,
    ensureLoaded,
    reset,
    patchMoneda,
    setDefaultMoneda,
    hydrate,
  }
})
