<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

interface Moneda {
  monedaId: string
  nombre: string
  codigoIso: string
  simbolo: string | null
  decimales: number
  separadorDecimal: string
  separadorMiles: string
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

const columns: TableColumn<Moneda>[] = [
  { accessorKey: 'nombre', header: 'Moneda' },
  { id: 'tasa', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'predeterminada', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'habilitada', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Monedas"
      description="Habilita las monedas disponibles para tu país y define la tasa de cambio del día. La moneda oficial siempre está habilitada con tasa 1."
    />

    <CrudTable :data="monedas" :columns="columns" :loading="loading">
        <template #nombre-cell="{ row }">
          <div class="min-w-0">
            <p class="font-medium truncate flex items-center gap-2">
              {{ row.original.nombre }}
              <UBadge
                v-if="row.original.esOficial"
                color="primary"
                variant="subtle"
                size="sm"
              >
                Oficial
              </UBadge>
            </p>
            <p class="text-sm text-muted">
              {{ row.original.codigoIso }}<span v-if="row.original.simbolo"> · {{ row.original.simbolo }}</span>
            </p>
          </div>
        </template>

        <template #tasa-cell="{ row }">
          <div class="w-32 ml-auto">
            <UInput
              :model-value="row.original.esOficial ? '1' : (row.original.valorDelDia ?? '')"
              inputmode="decimal"
              size="sm"
              :disabled="row.original.esOficial || toggling.has(row.original.monedaId)"
              placeholder="Tasa"
              @focus="onTasaFocus(row.original)"
              @update:model-value="(v: string | number) => { row.original.valorDelDia = v === '' ? null : String(v) }"
              @blur="guardarTasa(row.original)"
            />
          </div>
        </template>

        <template #predeterminada-cell="{ row }">
          <div class="flex justify-end">
            <button
              type="button"
              class="p-1 rounded transition-colors hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="toggling.has(row.original.monedaId)"
              :title="row.original.esDefault ? 'Moneda predeterminada' : 'Marcar como predeterminada'"
              @click="setDefault(row.original)"
            >
              <UIcon
                :name="'i-lucide-star'"
                class="w-5 h-5"
                :class="row.original.esDefault ? 'text-warning fill-current' : 'text-muted'"
              />
            </button>
          </div>
        </template>

        <template #habilitada-cell="{ row }">
          <div class="flex justify-end">
            <USwitch
              :model-value="row.original.habilitada"
              :disabled="row.original.esOficial || toggling.has(row.original.monedaId)"
              @update:model-value="toggleHabilitada(row.original)"
            />
          </div>
        </template>

      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          No hay monedas disponibles para el país del tenant.
        </div>
      </template>
    </CrudTable>
  </div>
</template>
