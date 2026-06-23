<script setup lang="ts">
interface Moneda {
  monedaId: string
  nombre: string
  codigoIso: string
  simbolo: string | null
  decimales: number
  habilitada: boolean
  esDefault: boolean
  esOficial: boolean
  valorDelDia: string | null
}

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const monedas = ref<Moneda[]>([])
const loading = ref(false)
const toggling = reactive(new Set<string>())
const tasaOriginal = reactive(new Map<string, string | null>())

async function cargar() {
  loading.value = true
  try {
    monedas.value = await useApiFetch<Moneda[]>(`${apiUrl}/monedas`)
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar monedas')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    loading.value = false
  }
}

async function toggleHabilitada(m: Moneda) {
  if (m.esOficial || toggling.has(m.monedaId)) return
  if (m.esDefault && m.habilitada) {
    toast.add({ title: 'No se puede deshabilitar la moneda predeterminada', color: 'warning' })
    return
  }
  toggling.add(m.monedaId)
  const prev = m.habilitada
  m.habilitada = !prev
  try {
    await useApiFetch(`${apiUrl}/monedas/${m.monedaId}`, {
      method: 'PATCH',
      body: { habilitada: m.habilitada },
    })
    toast.add({ title: m.habilitada ? 'Moneda habilitada' : 'Moneda deshabilitada', color: 'success' })
  }
  catch (e: unknown) {
    m.habilitada = prev
    const msg = apiErrorMsg(e, 'Error al actualizar')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    toggling.delete(m.monedaId)
  }
}

async function setDefault(m: Moneda) {
  if (m.esDefault || toggling.has(m.monedaId)) return
  if (!m.habilitada) {
    toast.add({ title: 'Debes habilitar la moneda antes de marcarla como predeterminada', color: 'warning' })
    return
  }
  const prev = monedas.value.find(x => x.esDefault)
  if (prev) prev.esDefault = false
  m.esDefault = true
  toggling.add(m.monedaId)
  try {
    await useApiFetch(`${apiUrl}/monedas/${m.monedaId}/default`, {
      method: 'PATCH',
    })
    toast.add({ title: 'Moneda predeterminada actualizada', color: 'success' })
  }
  catch (e: unknown) {
    m.esDefault = false
    if (prev) prev.esDefault = true
    const msg = apiErrorMsg(e, 'Error al actualizar predeterminada')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    toggling.delete(m.monedaId)
  }
}

function onTasaFocus(m: Moneda) {
  tasaOriginal.set(m.monedaId, m.valorDelDia)
}

async function guardarTasa(m: Moneda) {
  if (m.esOficial || toggling.has(m.monedaId)) return
  const prev = tasaOriginal.get(m.monedaId) ?? null
  if (m.valorDelDia === prev) return
  const num = Number(m.valorDelDia)
  if (!m.valorDelDia || Number.isNaN(num) || num <= 0) {
    toast.add({ title: 'Ingresa una tasa de cambio válida', color: 'warning' })
    m.valorDelDia = prev
    return
  }
  toggling.add(m.monedaId)
  try {
    await useApiFetch(`${apiUrl}/monedas/${m.monedaId}`, {
      method: 'PATCH',
      body: { valorDelDia: m.valorDelDia },
    })
    toast.add({ title: 'Tasa de cambio actualizada', color: 'success' })
  }
  catch (e: unknown) {
    m.valorDelDia = prev
    const msg = apiErrorMsg(e, 'Error al actualizar la tasa')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    toggling.delete(m.monedaId)
  }
}

onMounted(cargar)
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-semibold">
        Monedas
      </h2>
      <p class="text-sm text-gray-500">
        Habilita las monedas disponibles para tu país y define la tasa de cambio del día.
        La moneda oficial siempre está habilitada con tasa 1.
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
        v-else-if="!monedas.length"
        class="py-8 text-center text-sm text-gray-500"
      >
        No hay monedas disponibles para el país del tenant.
      </div>
      <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
        <li
          v-for="m in monedas"
          :key="m.monedaId"
          class="flex items-center justify-between py-3 gap-4"
        >
          <div class="min-w-0">
            <p class="font-medium truncate flex items-center gap-2">
              {{ m.nombre }}
              <UBadge
                v-if="m.esOficial"
                color="primary"
                variant="subtle"
                size="sm"
              >
                Oficial
              </UBadge>
            </p>
            <p class="text-sm text-gray-500">
              {{ m.codigoIso }}<span v-if="m.simbolo"> · {{ m.simbolo }}</span>
            </p>
          </div>

          <div class="flex items-center gap-4 shrink-0">
            <!-- Tasa de cambio -->
            <div class="w-32">
              <UInput
                :model-value="m.esOficial ? '1' : (m.valorDelDia ?? '')"
                inputmode="decimal"
                size="sm"
                :disabled="m.esOficial || toggling.has(m.monedaId)"
                placeholder="Tasa"
                @focus="onTasaFocus(m)"
                @update:model-value="(v: string | number) => { m.valorDelDia = v === '' ? null : String(v) }"
                @blur="guardarTasa(m)"
              />
            </div>

            <!-- Estrella predeterminada -->
            <button
              type="button"
              class="p-1 rounded transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="toggling.has(m.monedaId)"
              :title="m.esDefault ? 'Moneda predeterminada' : 'Marcar como predeterminada'"
              @click="setDefault(m)"
            >
              <UIcon
                :name="m.esDefault ? 'i-heroicons-star-solid' : 'i-heroicons-star'"
                class="w-5 h-5"
                :class="m.esDefault ? 'text-yellow-400' : 'text-gray-400'"
              />
            </button>

            <!-- Habilitada -->
            <USwitch
              :model-value="m.habilitada"
              :disabled="m.esOficial || toggling.has(m.monedaId)"
              @update:model-value="toggleHabilitada(m)"
            />
          </div>
        </li>
      </ul>
    </UCard>
  </div>
</template>
