<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

interface MetodoPago {
  metodoPagoId: string
  nombre: string
  abreviatura: string | null
  habilitada: boolean
  permiteVuelto: boolean
  emisor: EmisorMedio
  esEfectivo: boolean
}

// Quién emite el documento de lo cobrado con el medio (espeja el backend).
type EmisorMedio = 'sistema' | 'maquina' | 'nadie'
// Quién hace las facturas del comercio y documenta lo que queda debiendo.
type Facturador = 'sistema' | 'externo'

const emisorItems: { label: string, value: EmisorMedio }[] = [
  { label: 'El sistema', value: 'sistema' },
  { label: 'La máquina', value: 'maquina' },
  { label: 'Nadie', value: 'nadie' },
]
const facturadorItems: { label: string, value: Facturador }[] = [
  { label: 'El sistema', value: 'sistema' },
  { label: 'Otro facturador', value: 'externo' },
]

// `admin`: pantalla admin-only (backend con `TenantAdminGuard`). Sin guard de
// ruta la URL escrita a mano la abría igual y el 403 llegaba al guardar.
definePageMeta({ middleware: ['auth', 'admin'], layout: 'dashboard' })

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const metodos = ref<MetodoPago[]>([])
const loading = ref(false)
const toggling = reactive(new Set<string>())
// `null` hasta que carga `GET /tenants/me`: el selector va deshabilitado.
const facturador = ref<Facturador | null>(null)
const guardandoFacturador = ref(false)

async function cargar() {
  loading.value = true
  // Dos lecturas independientes: que falle `/tenants/me` no esconde la tabla.
  const [lista, tenant] = await Promise.allSettled([
    useApiFetch<MetodoPago[]>(`${apiUrl}/metodos-pago`),
    useApiFetch<{ facturador: Facturador }>(`${apiUrl}/tenants/me`),
  ])
  if (lista.status === 'fulfilled') {
    metodos.value = lista.value
  }
  else {
    const msg = apiErrorMsg(lista.reason, 'Error al cargar métodos de pago')
    toast.add({ title: msg, color: 'error' })
  }
  if (tenant.status === 'fulfilled') {
    facturador.value = tenant.value.facturador
  }
  else {
    // El selector queda deshabilitado (`facturador === null`).
    toast.add({ title: 'No se pudo cargar quién hace las facturas', color: 'error' })
  }
  loading.value = false
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

async function cambiarEmisor(m: MetodoPago, nuevo: EmisorMedio) {
  if (toggling.has(m.metodoPagoId) || nuevo === m.emisor) return
  toggling.add(m.metodoPagoId)
  const prev = m.emisor
  m.emisor = nuevo
  try {
    await useApiFetch(`${apiUrl}/metodos-pago/${m.metodoPagoId}`, {
      method: 'PATCH',
      body: { emisor: nuevo },
    })
    toast.add({ title: 'Emisor del documento actualizado', color: 'success' })
  }
  catch (e: unknown) {
    m.emisor = prev
    const msg = apiErrorMsg(e, 'Error al actualizar')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    toggling.delete(m.metodoPagoId)
  }
}

async function cambiarFacturador(nuevo: Facturador) {
  if (guardandoFacturador.value || nuevo === facturador.value) return
  guardandoFacturador.value = true
  const prev = facturador.value
  facturador.value = nuevo
  try {
    // Solo `facturador`: el PATCH es parcial y no toca el resto del tenant.
    await useApiFetch(`${apiUrl}/tenants/me`, {
      method: 'PATCH',
      body: { facturador: nuevo },
    })
    toast.add({ title: 'Quién hace las facturas actualizado', color: 'success' })
  }
  catch (e: unknown) {
    facturador.value = prev
    const msg = apiErrorMsg(e, 'Error al actualizar')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    guardandoFacturador.value = false
  }
}

onMounted(cargar)

const columns: TableColumn<MetodoPago>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'emisor', header: 'Emite el documento' },
  { id: 'permiteVuelto', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'habilitada', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Métodos de pago"
      description="Habilita los métodos de pago disponibles para tu país, indica cuáles permiten dar vuelto y quién emite el documento de cada uno."
    />

    <UFormField label="Facturas y lo que queda debiendo: las hace">
      <USelect
        :model-value="facturador ?? undefined"
        :items="facturadorItems"
        :disabled="facturador === null || guardandoFacturador"
        class="w-56"
        @update:model-value="cambiarFacturador($event as Facturador)"
      />
      <template
        v-if="facturador === 'externo'"
        #help
      >
        El sistema las registra como hechas por fuera, y su número se anota después.
      </template>
    </UFormField>

    <CrudTable :data="metodos" :columns="columns" :loading="loading">
      <template #nombre-cell="{ row }">
        <CrudListItem
          :title="row.original.nombre"
          :subtitle="row.original.abreviatura || undefined"
        />
      </template>

      <template #emisor-cell="{ row }">
        <div class="space-y-1">
          <USelect
            :model-value="row.original.emisor"
            :items="emisorItems"
            :disabled="toggling.has(row.original.metodoPagoId)"
            class="w-40"
            @update:model-value="cambiarEmisor(row.original, $event as EmisorMedio)"
          />
          <p
            v-if="row.original.emisor === 'nadie'"
            class="text-xs text-muted"
          >
            Las ventas con este medio quedan sin documento. Emitirlo es responsabilidad del comercio.
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
    </CrudTable>
  </div>
</template>
