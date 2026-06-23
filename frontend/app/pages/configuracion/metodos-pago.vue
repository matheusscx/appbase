<script setup lang="ts">
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
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al cargar métodos de pago', color: 'error' })
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
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al actualizar', color: 'error' })
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
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al actualizar', color: 'error' })
  }
  finally {
    toggling.delete(m.metodoPagoId)
  }
}

onMounted(cargar)
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-semibold">
        Métodos de pago
      </h2>
      <p class="text-sm text-gray-500">
        Habilita los métodos de pago disponibles para tu país e indica cuáles permiten dar vuelto.
      </p>
    </div>

    <UCard>
      <div
        v-if="loading"
        class="py-8 text-center text-sm text-gray-500"
      >
        Cargando…
      </div>
      <div
        v-else-if="!metodos.length"
        class="py-8 text-center text-sm text-gray-500"
      >
        No hay métodos de pago disponibles para el país del tenant.
      </div>
      <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
        <li
          v-for="m in metodos"
          :key="m.metodoPagoId"
          class="flex items-center justify-between py-3 gap-4"
        >
          <div class="min-w-0">
            <p class="font-medium truncate">
              {{ m.nombre }}
            </p>
            <p v-if="m.abreviatura" class="text-sm text-gray-500">
              {{ m.abreviatura }}
            </p>
          </div>

          <div class="flex items-center gap-6 shrink-0">
            <!-- Permite vuelto -->
            <div class="flex items-center gap-2">
              <span class="text-sm text-gray-500">Permite vuelto</span>
              <USwitch
                :model-value="m.permiteVuelto"
                :disabled="toggling.has(m.metodoPagoId)"
                @update:model-value="togglePermiteVuelto(m)"
              />
            </div>

            <!-- Habilitada -->
            <div class="flex items-center gap-2">
              <span class="text-sm text-gray-500">Habilitado</span>
              <USwitch
                :model-value="m.habilitada"
                :disabled="toggling.has(m.metodoPagoId)"
                @update:model-value="toggleHabilitada(m)"
              />
            </div>
          </div>
        </li>
      </ul>
    </UCard>
  </div>
</template>
