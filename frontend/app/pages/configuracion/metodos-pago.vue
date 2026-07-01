<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

interface MetodoPago {
  metodoPagoId: string
  nombre: string
  abreviatura: string | null
  habilitada: boolean
  permiteVuelto: boolean
}

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const metodos = ref<MetodoPago[]>([])
const loading = ref(false)
const toggling = reactive(new Set<string>())

async function cargar() {
  loading.value = true
  try {
    metodos.value = await useApiFetch<MetodoPago[]>(`${apiUrl}/metodos-pago`)
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar métodos de pago')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    loading.value = false
  }
}

async function toggleHabilitada(m: MetodoPago) {
  if (toggling.has(m.metodoPagoId)) return
  toggling.add(m.metodoPagoId)
  const prev = m.habilitada
  m.habilitada = !prev
  try {
    await useApiFetch(`${apiUrl}/metodos-pago/${m.metodoPagoId}`, {
      method: 'PATCH',
      body: { habilitada: m.habilitada },
    })
    toast.add({ title: m.habilitada ? 'Método habilitado' : 'Método deshabilitado', color: 'success' })
  }
  catch (e: unknown) {
    m.habilitada = prev
    const msg = apiErrorMsg(e, 'Error al actualizar')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    toggling.delete(m.metodoPagoId)
  }
}

async function togglePermiteVuelto(m: MetodoPago) {
  if (toggling.has(m.metodoPagoId)) return
  toggling.add(m.metodoPagoId)
  const prev = m.permiteVuelto
  m.permiteVuelto = !prev
  try {
    await useApiFetch(`${apiUrl}/metodos-pago/${m.metodoPagoId}`, {
      method: 'PATCH',
      body: { permiteVuelto: m.permiteVuelto },
    })
    toast.add({ title: 'Configuración de vuelto actualizada', color: 'success' })
  }
  catch (e: unknown) {
    m.permiteVuelto = prev
    const msg = apiErrorMsg(e, 'Error al actualizar')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    toggling.delete(m.metodoPagoId)
  }
}

onMounted(cargar)

const columns: TableColumn<MetodoPago>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'permiteVuelto', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'habilitada', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-semibold text-default">
        Métodos de pago
      </h2>
      <p class="text-sm text-muted">
        Habilita los métodos de pago disponibles para tu país e indica cuáles permiten dar vuelto.
      </p>
    </div>

    <UCard>
      <UTable :data="metodos" :columns="columns" :loading="loading">
        <template #nombre-cell="{ row }">
          <div class="min-w-0">
            <p class="font-medium truncate">
              {{ row.original.nombre }}
            </p>
            <p v-if="row.original.abreviatura" class="text-sm text-muted">
              {{ row.original.abreviatura }}
            </p>
          </div>
        </template>

        <template #permiteVuelto-cell="{ row }">
          <div class="flex items-center justify-end gap-2">
            <span class="text-sm text-muted">Permite vuelto</span>
            <USwitch
              :model-value="row.original.permiteVuelto"
              :disabled="toggling.has(row.original.metodoPagoId)"
              @update:model-value="togglePermiteVuelto(row.original)"
            />
          </div>
        </template>

        <template #habilitada-cell="{ row }">
          <div class="flex items-center justify-end gap-2">
            <span class="text-sm text-muted">Habilitado</span>
            <USwitch
              :model-value="row.original.habilitada"
              :disabled="toggling.has(row.original.metodoPagoId)"
              @update:model-value="toggleHabilitada(row.original)"
            />
          </div>
        </template>

        <template #empty>
          <div class="py-8 text-center text-sm text-muted">
            No hay métodos de pago disponibles para el país del tenant.
          </div>
        </template>
      </UTable>
    </UCard>
  </div>
</template>
