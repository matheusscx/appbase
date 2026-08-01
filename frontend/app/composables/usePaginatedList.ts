export interface PaginationMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: PaginationMeta
}

export interface PagosResumen {
  totalPagos: number
  montoCobrado: string
  pagosHoy: number
  montoHoy: string
}

interface UsePaginatedListOptions {
  path: MaybeRefOrGetter<string>
  pageSize?: MaybeRefOrGetter<number>
  filters?: MaybeRefOrGetter<Record<string, string | undefined | null>>
}

export function usePaginatedList<T>(options: UsePaginatedListOptions) {
  const config = useRuntimeConfig()
  const toast = useToast()
  const apiUrl = config.public.apiUrl

  const resolvedPath = computed(() => toValue(options.path))
  const resolvedPageSize = computed(() => toValue(options.pageSize ?? 15))

  const page = ref(1)
  const items = ref<T[]>([]) as Ref<T[]>
  const meta = ref<PaginationMeta>({
    page: 1,
    pageSize: resolvedPageSize.value,
    total: 0,
    totalPages: 0,
  })
  const loading = ref(false)

  // Serializa invocaciones concurrentes de `fetch()`: el propio composable
  // lo dispara desde varios `watch` (filtros, pageSize, path, page) además
  // de `onMounted`, así que dos GET pueden quedar en vuelo a la vez (p.ej.
  // un toggle "ver eliminados" que cambia dos veces seguidas antes de que
  // la primera respuesta llegue). Sin esto gana el que responda último, no
  // el que se disparó último. Va ACÁ y no en cada pantalla consumidora
  // porque el refetch lo dispara el composable mismo — blindar solo un
  // consumidor (p.ej. `configuracion/items.vue`) dejaría a los otros 13
  // expuestos a la misma carrera. Mismo patrón que
  // `configuracion/categorias.vue` → `cargar()` (`cargaEnCurso`): cada
  // llamada espera a la anterior antes de pisar `items`/`meta`, así que
  // quedan en orden de invocación y la última en llamarse es la última en
  // escribir. Variable de instancia (dentro de `usePaginatedList`, no a
  // nivel de módulo): cada pantalla —y cada lista dentro de la misma
  // pantalla— tiene su propia cola, sin serializar listados que no tienen
  // nada que ver entre sí.
  let fetchEnCurso: Promise<void> | null = null

  async function fetch() {
    const previa = fetchEnCurso
    const actual = (async () => {
      await previa
      loading.value = true
      try {
        const size = resolvedPageSize.value
        const params = new URLSearchParams()
        params.set('page', String(page.value))
        params.set('pageSize', String(size))

        const filters = toValue(options.filters ?? {})
        for (const [key, value] of Object.entries(filters)) {
          if (value != null && value !== '') {
            params.set(key, value)
          }
        }

        const res = await useApiFetch<PaginatedResponse<T>>(
          `${apiUrl}${resolvedPath.value}?${params.toString()}`,
        )
        items.value = res.data
        meta.value = res.meta
      }
      catch (e: unknown) {
        const msg = apiErrorMsg(e, 'Error al cargar datos')
        toast.add({ title: msg, color: 'error' })
      }
      finally {
        loading.value = false
      }
    })()
    fetchEnCurso = actual
    await actual
  }

  if (options.filters) {
    watch(
      () => toValue(options.filters!),
      () => {
        if (page.value !== 1) {
          page.value = 1
        }
        else {
          fetch()
        }
      },
      { deep: true },
    )
  }

  watch(resolvedPageSize, () => {
    if (page.value !== 1) {
      page.value = 1
    }
    else {
      fetch()
    }
  })

  watch(resolvedPath, () => {
    if (page.value !== 1) {
      page.value = 1
    }
    else {
      fetch()
    }
  })

  watch(page, fetch)

  onMounted(fetch)

  return {
    items,
    meta,
    page,
    pageSize: resolvedPageSize,
    loading,
    fetch,
  }
}
