<!-- frontend/app/pages/configuracion/inventario.vue -->
<script setup lang="ts">
const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()

interface Movimiento {
  id: string
  itemId: string
  itemNombre: string
  tipo: string
  motivo: string
  cantidad: string
  stockAnterior: string
  stockResultante: string
  usuarioNombre: string | null
  comentario: string | null
  creadoEl: string
}
interface Opt { label: string; value: string }

const movimientos = ref<Movimiento[]>([])
const loading = ref(false)
const productosOpts = ref<Opt[]>([])
const filtroItem = ref('')
const filtroMotivo = ref('')

const motivoOpts: Opt[] = [
  { label: 'Todos los motivos', value: '' },
  { label: 'Compra', value: 'compra' },
  { label: 'Venta', value: 'venta' },
  { label: 'Devolución', value: 'devolucion' },
  { label: 'Merma', value: 'merma' },
  { label: 'Ajuste manual', value: 'ajuste_manual' },
  { label: 'Inventario inicial', value: 'inventario_inicial' },
]

async function cargarProductos() {
  try {
    const items = await useApiFetch<{ id: string; nombre: string }[]>(
      `${apiUrl}/items?tipo=producto`,
    )
    productosOpts.value = [
      { label: 'Todos los productos', value: '' },
      ...items.map((i) => ({ label: i.nombre, value: i.id })),
    ]
  } catch {
    toast.add({ title: 'Error al cargar productos', color: 'error' })
  }
}

async function cargar() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (filtroItem.value) params.set('itemId', filtroItem.value)
    if (filtroMotivo.value) params.set('motivo', filtroMotivo.value)
    const qs = params.toString()
    movimientos.value = await useApiFetch<Movimiento[]>(
      `${apiUrl}/inventario/movimientos${qs ? `?${qs}` : ''}`,
    )
  } catch (e) {
    const msg = apiErrorMsg(e, 'Error al cargar movimientos')
    toast.add({ title: msg, color: 'error' })
  } finally {
    loading.value = false
  }
}

watch([filtroItem, filtroMotivo], cargar)
onMounted(async () => {
  await Promise.all([cargarProductos(), cargar()])
})
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-2xl font-semibold">Inventario</h1>
      <p class="text-sm text-muted">Kardex de movimientos de stock</p>
    </div>

    <div class="flex flex-wrap gap-2">
      <USelectMenu
        v-model="filtroItem"
        :items="productosOpts"
        value-key="value"
        class="w-64"
        placeholder="Producto"
      />
      <USelectMenu
        v-model="filtroMotivo"
        :items="motivoOpts"
        value-key="value"
        class="w-52"
        placeholder="Motivo"
      />
    </div>

    <UCard>
      <div v-if="loading" class="py-8 text-center text-muted">Cargando…</div>
      <div v-else-if="!movimientos.length" class="py-8 text-center text-muted">
        No hay movimientos registrados.
      </div>
      <table v-else class="w-full text-sm">
        <thead class="text-muted text-left">
          <tr class="border-b border-default">
            <th class="py-2">Fecha</th>
            <th>Producto</th>
            <th>Tipo</th>
            <th>Motivo</th>
            <th class="text-right">Cantidad</th>
            <th class="text-right">Resultante</th>
            <th>Usuario</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in movimientos" :key="m.id" class="border-b border-default">
            <td class="py-2">{{ new Date(m.creadoEl).toLocaleString() }}</td>
            <td class="font-medium">{{ m.itemNombre }}</td>
            <td>
              <UBadge
                :label="m.tipo === 'entrada' ? 'Entrada' : 'Salida'"
                :color="m.tipo === 'entrada' ? 'success' : 'warning'"
                variant="subtle"
                size="sm"
              />
            </td>
            <td>{{ m.motivo }}</td>
            <td class="text-right">{{ m.cantidad }}</td>
            <td class="text-right font-medium">{{ m.stockResultante }}</td>
            <td>{{ m.usuarioNombre ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </UCard>
  </div>
</template>
