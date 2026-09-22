<script setup lang="ts">
// Mínimo de stock por producto y ubicación (`docs/features/aviso-stock-bajo.md`).
// Es el listado de inventario con la marca por fila —acá sí la lista completa,
// el usuario vino a buscarla— y el lugar donde se carga el mínimo, que nace
// vacío. El bloque del inicio es el otro lugar del aviso: un número, no esta
// lista.
//
// Tres permisos, cada control con el suyo (`docs/patterns/frontend.md` § 1.1):
// ver es `Inventario:Leer` (lo exige la ruta entera), cargar el mínimo es
// `Inventario:Actualizar` y trasladar es `Inventario:Crear`. A quien no puede
// trasladar se le dice dónde está la mercadería, sin darle un botón que va a
// rebotar con 403 — el mismo matiz que `useRechazoPorStock`.
import type { TableColumn } from '@nuxt/ui'
import type { StockMinimoFila } from '~/composables/useStockMinimo'

definePageMeta({
  middleware: ['auth', 'permiso'],
  permiso: 'Inventario:Leer',
  layout: 'dashboard',
})

const route = useRoute()
const toast = useToast()
const { formatStock } = useFormatters()
const { pageSize } = useUserPreferences()
const { ubicaciones, hayBodegas, cargar: cargarUbicaciones } = useUbicaciones()
const { puedeActualizar, puedeCrear: puedeTrasladar } = usePermisosCrud('Inventario')
const { guardarMinimo, sinCambio, rutaTraslado } = useStockMinimo()
const unidadesMedidaStore = useUnidadesMedidaStore()

// El bloque del inicio llega con `?soloBajoMinimo=true`.
const soloBajoMinimo = ref(route.query.soloBajoMinimo === 'true')
const filtroUbicacion = ref<string | undefined>()
const busqueda = ref('')

const listFilters = computed(() => ({
  soloBajoMinimo: soloBajoMinimo.value ? 'true' : undefined,
  ubicacionId: filtroUbicacion.value,
  search: busqueda.value.trim() || undefined,
}))

const { items: filas, meta, page, loading } = usePaginatedList<StockMinimoFila>({
  path: '/inventario/stock-minimo',
  pageSize,
  filters: listFilters,
})

// Las bodegas desactivadas no se evalúan y el backend no las lista: el filtro
// tampoco las ofrece.
const ubicacionOpts = computed(() =>
  ubicaciones.value.filter(u => u.activo).map(u => ({ label: u.nombre, value: u.id })),
)

onMounted(() => {
  void cargarUbicaciones()
  void unidadesMedidaStore.ensureLoaded()
})

// ── Editar el mínimo ─────────────────────────────────────────────────────

/** Lo tipeado por fila, hasta que se guarda. */
const borradores = reactive(new Map<string, string>())
const guardando = reactive(new Set<string>())
const clave = (f: StockMinimoFila) => `${f.itemId}:${f.ubicacionId}`

function valorMinimo(f: StockMinimoFila): string {
  return borradores.get(clave(f)) ?? f.minimo ?? ''
}

async function guardar(f: StockMinimoFila) {
  const k = clave(f)
  const tipeado = borradores.get(k)
  if (tipeado === undefined || guardando.has(k)) return
  if (sinCambio(f, tipeado)) {
    borradores.delete(k)
    return
  }
  guardando.add(k)
  // La lista con la que se editó: si mientras viaja el PUT el usuario cambió
  // de página o de filtro, `usePaginatedList` ya la reemplazó y la respuesta
  // no le corresponde — la lista nueva trae el dato del servidor igual.
  const lista = filas.value
  try {
    const nueva = await guardarMinimo(f, tipeado)
    // La fila la recalcula el backend: se reemplaza entera, sin recargar la
    // página ni derivar la marca acá.
    const i = lista.findIndex(x => clave(x) === k)
    if (nueva && filas.value === lista && i !== -1) lista.splice(i, 1, nueva)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'No se pudo guardar el mínimo'), color: 'error' })
  }
  finally {
    // También si falló: el campo vuelve al valor guardado. Si quedara lo
    // tipeado, salir del campo lo mandaría otra vez solo, y el owner no quiere
    // que la app repita lo que falló — el usuario lo vuelve a tipear.
    borradores.delete(k)
    guardando.delete(k)
  }
}

// ── Tabla ────────────────────────────────────────────────────────────────

const columns = computed<TableColumn<StockMinimoFila>[]>(() => [
  { accessorKey: 'itemNombre', header: 'Producto' },
  ...(hayBodegas.value
    ? [{ accessorKey: 'ubicacionNombre', header: 'Ubicación' } as TableColumn<StockMinimoFila>]
    : []),
  { accessorKey: 'stock', header: 'Stock', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'minimo', header: 'Mínimo', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'estado', header: 'Estado' },
  { id: 'accion', header: '' },
])
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Stock mínimo" />
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <CrudPageHeader
          large
          title="Stock mínimo"
          description="Bajo el mínimo, el producto se marca acá y se cuenta en el inicio. Sin mínimo cargado, no avisa."
        />

        <div class="flex flex-wrap items-center gap-3">
          <UInput
            v-model="busqueda"
            icon="i-lucide-search"
            placeholder="Buscar producto"
            class="w-64"
          />
          <USelectMenu
            v-if="hayBodegas"
            v-model="filtroUbicacion"
            :items="ubicacionOpts"
            value-key="value"
            class="w-52"
            placeholder="Todas las ubicaciones"
          />
          <USwitch
            v-model="soloBajoMinimo"
            label="Solo bajo el mínimo"
            data-qa="filtro-bajo-minimo"
          />
        </div>

        <CrudTable
          :data="filas"
          :columns="columns"
          :loading="loading"
        >
          <template #stock-cell="{ row }">
            <span class="whitespace-nowrap">{{ formatStock(row.original.stock, row.original.unidadMedida) }}</span>
          </template>

          <template #minimo-cell="{ row }">
            <UInput
              v-if="puedeActualizar"
              :model-value="valorMinimo(row.original)"
              inputmode="decimal"
              placeholder="—"
              size="sm"
              class="w-24 ml-auto"
              :loading="guardando.has(clave(row.original))"
              :data-qa="`minimo-${row.original.itemId}-${row.original.ubicacionId}`"
              @update:model-value="(v: string | number) => borradores.set(clave(row.original), String(v))"
              @blur="guardar(row.original)"
              @keydown.enter="guardar(row.original)"
            />
            <span
              v-else
              class="text-muted"
              data-qa="minimo-solo-lectura"
            >
              {{ row.original.minimo === null ? '—' : formatStock(row.original.minimo, row.original.unidadMedida) }}
            </span>
          </template>

          <template #estado-cell="{ row }">
            <UBadge
              v-if="row.original.bajoMinimo && row.original.enCamino"
              color="info"
              variant="subtle"
              data-qa="marca-en-camino"
            >
              Bajo el mínimo · en camino
            </UBadge>
            <UBadge
              v-else-if="row.original.bajoMinimo"
              color="warning"
              variant="subtle"
              data-qa="marca-bajo-minimo"
            >
              Bajo el mínimo
            </UBadge>
          </template>

          <template #accion-cell="{ row }">
            <template v-if="rutaTraslado(row.original)">
              <UButton
                v-if="puedeTrasladar"
                size="xs"
                color="neutral"
                variant="outline"
                icon="i-lucide-arrow-left-right"
                data-qa="trasladar"
                @click="void navigateTo(rutaTraslado(row.original)!)"
              >
                Trasladar desde {{ row.original.origenSugerido!.ubicacionNombre }}
              </UButton>
              <span
                v-else
                class="text-sm text-muted"
                data-qa="hay-en-otra-ubicacion"
              >
                Hay {{ formatStock(row.original.origenSugerido!.stock, row.original.unidadMedida) }}
                en {{ row.original.origenSugerido!.ubicacionNombre }}
              </span>
            </template>
          </template>

          <template #empty>
            <div class="py-8 text-center text-sm text-muted">
              <UIcon
                name="i-lucide-package-check"
                class="w-8 h-8 mx-auto mb-2 opacity-40"
              />
              {{ soloBajoMinimo ? 'Nada bajo el mínimo.' : 'No hay productos con stock.' }}
            </div>
          </template>
        </CrudTable>

        <div
          v-if="meta.total > pageSize"
          class="flex justify-end"
        >
          <UPagination
            v-model:page="page"
            :items-per-page="pageSize"
            :total="meta.total"
          />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
