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
  path: string
  pageSize?: number
  filters?: MaybeRefOrGetter<Record<string, string | undefined | null>>
}

export function usePaginatedList<T>(options: UsePaginatedListOptions) {
  const config = useRuntimeConfig()
  const toast = useToast()
  const apiUrl = config.public.apiUrl
  const pageSize = options.pageSize ?? 15

  const page = ref(1)
  const items = ref<T[]>([]) as Ref<T[]>
  const meta = ref<PaginationMeta>({
    page: 1,
    pageSize,
    total: 0,
    totalPages: 0,
  })
  const loading = ref(false)

  async function fetch() {
    loading.value = true
    try {
      const params = new URLSearchParams()
      params.set('page', String(page.value))
      params.set('pageSize', String(pageSize))

      const filters = toValue(options.filters ?? {})
      for (const [key, value] of Object.entries(filters)) {
        if (value != null && value !== '') {
          params.set(key, value)
        }
      }

      const res = await useApiFetch<PaginatedResponse<T>>(
        `${apiUrl}${options.path}?${params.toString()}`,
      )
      items.value = res.data
      meta.value = res.meta
    }
    catch (e: unknown) {
      const msg = (e as { data?: { message?: string } })?.data?.message
      toast.add({ title: msg ?? 'Error al cargar datos', color: 'error' })
    }
    finally {
      loading.value = false
    }
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

  watch(page, fetch)

  onMounted(fetch)

  return {
    items,
    meta,
    page,
    pageSize,
    loading,
    fetch,
  }
}
