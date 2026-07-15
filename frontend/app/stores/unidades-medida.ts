import { defineStore } from 'pinia'
import { useApiFetch } from '~/composables/useApiFetch'

export interface UnidadMedidaApi {
  unidadMedidaId: string
  codigo: string
  nombre: string
  magnitud: string
  factorBase: string
}

/**
 * Catálogo global de unidades de medida. A diferencia de `monedas`, no depende
 * del tenant: un kg es un kg en todos.
 */
export const useUnidadesMedidaStore = defineStore('unidadesMedida', () => {
  const config = useRuntimeConfig()
  const unidades = ref<UnidadMedidaApi[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const isLoaded = computed(() => unidades.value.length > 0)

  const opts = computed(() =>
    unidades.value.map(u => ({
      label: u.magnitud === 'conteo' ? u.nombre : `${u.nombre} (${u.codigo})`,
      value: u.codigo,
    })),
  )

  function getByCodigo(codigo: string | null | undefined): UnidadMedidaApi | undefined {
    if (!codigo) return undefined
    return unidades.value.find(u => u.codigo === codigo)
  }

  function magnitudDe(codigo: string | null | undefined): string | null {
    return getByCodigo(codigo)?.magnitud ?? null
  }

  /**
   * ¿La unidad admite decimales? Regla: toda magnitud continua los admite; solo
   * 'conteo' es entero.
   * Fallback cuando el catálogo no está cargado (o el código es desconocido):
   * 'unidad' es el único código de conteo sembrado, así que todo lo demás se
   * trata como fraccionario. Evita que el stock se vea mal en el primer render.
   */
  function esFraccionaria(codigo: string | null | undefined): boolean {
    if (!codigo) return false
    const magnitud = magnitudDe(codigo)
    if (magnitud) return magnitud !== 'conteo'
    return codigo !== 'unidad'
  }

  function hydrate(list: UnidadMedidaApi[]): void {
    unidades.value = list
  }

  async function ensureLoaded(): Promise<void> {
    if (isLoaded.value || loading.value) return

    loading.value = true
    error.value = null
    try {
      hydrate(
        await useApiFetch<UnidadMedidaApi[]>(
          `${config.public.apiUrl}/catalog/unidades-medida`,
        ),
      )
    }
    catch (e: unknown) {
      error.value = (e as { data?: { message?: string } })?.data?.message
        ?? 'Error al cargar unidades de medida'
    }
    finally {
      loading.value = false
    }
  }

  function reset(): void {
    unidades.value = []
    error.value = null
  }

  return {
    unidades,
    loading,
    error,
    isLoaded,
    opts,
    getByCodigo,
    magnitudDe,
    esFraccionaria,
    hydrate,
    ensureLoaded,
    reset,
  }
})
