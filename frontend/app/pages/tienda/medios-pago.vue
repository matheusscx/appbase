<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Tarjeta } from '~/composables/useTarjetas'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { formatFecha } = useFormatters()

const {
  tarjetas, oneclickDisponible, loading, error, sinPermiso, cargar,
  agregar, eliminar, marcarPreferida,
} = useTarjetas()

// Agregar, quitar y marcar preferida exigen `Tienda Online:Crear` en el backend: sin él se ve la lista, no los botones (09.14).
const { puedeCrear } = usePermisosCrud('Tienda Online')

const agregando = ref(false)
const working = reactive(new Set<string>())
const confirmDelete = ref<Tarjeta | null>(null)
const confirmModalOpen = ref(false)

const eliminarMensaje = computed(() => {
  const n = confirmDelete.value?.suscripcionesActivas ?? 0
  const base = 'La tarjeta se eliminará también en Transbank y no podrá usarse para cobros.'
  if (n > 0) {
    const plural = n === 1 ? 'suscripción activa' : 'suscripciones activas'
    return `Esta tarjeta tiene ${n} ${plural}: al eliminarla, ${n === 1 ? 'se cancelará' : 'se cancelarán'}. ${base}`
  }
  return `¿Estás seguro? ${base}`
})

onMounted(async () => {
  // Retorno de Webpay: /tienda/medios-pago?inscripcionId=...&estado=activa|fallida
  const estado = route.query.estado
  if (typeof estado === 'string' && route.query.inscripcionId) {
    if (estado === 'activa') {
      toast.add({ title: 'Tarjeta inscrita correctamente', color: 'success' })
    } else {
      toast.add({ title: 'La inscripción de la tarjeta fue rechazada', color: 'error' })
    }
    await router.replace({ query: {} })
  }
})

async function abrirInscripcion() {
  if (agregando.value) return
  agregando.value = true
  try {
    await agregar() // si funciona, el navegador sale hacia Webpay: no reseteamos el loading
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'No se pudo iniciar la inscripción'), color: 'error' })
    agregando.value = false
  }
}

async function confirmarEliminar(t: Tarjeta) {
  const id = t.inscripcionId
  confirmModalOpen.value = false
  confirmDelete.value = null
  if (working.has(id)) return
  working.add(id)
  try {
    await eliminar(id)
    toast.add({
      title: t.suscripcionesActivas > 0 ? 'Tarjeta eliminada y suscripciones canceladas' : 'Tarjeta eliminada',
      color: 'success',
    })
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'No se pudo eliminar la tarjeta'), color: 'error' })
  } finally {
    working.delete(id)
  }
}

async function preferir(t: Tarjeta) {
  if (t.preferida || working.has(t.inscripcionId)) return
  working.add(t.inscripcionId)
  try {
    await marcarPreferida(t.inscripcionId)
    toast.add({ title: 'Tarjeta preferida actualizada', color: 'success' })
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'No se pudo marcar la preferida'), color: 'error' })
  } finally {
    working.delete(t.inscripcionId)
  }
}

const columns: TableColumn<Tarjeta>[] = [
  { accessorKey: 'marca', header: 'Tarjeta' },
  { id: 'preferida', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Tarjetas">
        <template #right>
          <UserMenu />
        </template>
      </AppNavbar>
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <CrudPageHeader
          title="Tarjetas"
          description="Tarjetas inscritas para tus suscripciones. Nunca guardamos el número: solo la marca y los últimos 4 dígitos."
        >
          <template #actions>
            <UButton
              v-if="tarjetas.length"
              icon="i-lucide-plus"
              class="whitespace-nowrap"
              :disabled="oneclickDisponible !== true || !puedeCrear"
              :loading="agregando"
              @click="abrirInscripcion"
            >
              Agregar tarjeta
            </UButton>
          </template>
        </CrudPageHeader>

        <UAlert
          v-if="!puedeCrear"
          icon="i-lucide-lock"
          color="neutral"
          variant="soft"
          title="Tu rol puede ver las tarjetas, pero no agregarlas ni quitarlas"
          description="Pídele el permiso de Tienda Online a quien administra el local."
        />

        <UAlert
          v-if="!loading && oneclickDisponible === false"
          icon="i-lucide-triangle-alert"
          color="warning"
          variant="soft"
          title="Inscripción no disponible"
          description="Tu local aún no tiene activo el cobro con tarjeta inscrita. Actívalo en Configuración › Pasarelas, o pídelo a quien administra el local."
        />

        <div v-if="loading" class="py-8 text-center text-sm text-muted">
          Cargando…
        </div>

        <AppEstadoLista
          v-else-if="error"
          recurso="tus tarjetas"
          vacio=""
          error
          :sin-permiso="sinPermiso"
          @reintentar="cargar"
        />

        <CrudTable v-else :data="tarjetas" :columns="columns">
          <template #marca-cell="{ row }">
            <CrudListItem
              :title="`${row.original.marca ?? 'Tarjeta'} •••• ${row.original.last4 ?? '????'}`"
              :subtitle="`Inscrita el ${formatFecha(row.original.creadoEl)}`"
            />
          </template>

          <template #preferida-cell="{ row }">
            <div class="flex justify-end">
              <button
                type="button"
                class="inline-flex size-11 items-center justify-center rounded transition-colors hover:bg-muted"
                :aria-label="`Tarjeta preferida: ${row.original.marca ?? 'Tarjeta'} ${row.original.last4 ?? ''}`.trim()"
                :aria-pressed="!!row.original.preferida"
                :disabled="!puedeCrear"
                @click="preferir(row.original)"
              >
                <UIcon
                  name="i-lucide-star"
                  class="w-5 h-5"
                  :class="row.original.preferida ? 'text-warning fill-current' : 'text-muted'"
                />
              </button>
            </div>
          </template>

          <template #acciones-cell="{ row }">
            <UButton
              :aria-label="`Eliminar la tarjeta ${row.original.marca ?? ''} ${row.original.last4 ?? ''}`.trim()"
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              :disabled="!puedeCrear"
              @click="() => { confirmDelete = row.original; confirmModalOpen = true }"
            />
          </template>

          <template #empty>
            <div class="py-8 text-center space-y-3" data-qa="tarjetas-vacio">
              <p class="text-sm text-muted">
                Aún no tienes tarjetas. Agrega una para suscribirte; saldrás a Webpay y volverás aquí.
              </p>
              <UButton
                icon="i-lucide-plus"
                :disabled="oneclickDisponible !== true || !puedeCrear"
                :loading="agregando"
                @click="abrirInscripcion"
              >
                Agregar tarjeta
              </UButton>
            </div>
          </template>
        </CrudTable>

        <CrudModal
          v-model:open="confirmModalOpen"
          title="Eliminar tarjeta"
          :message="eliminarMensaje"
          @cancel="confirmDelete = null"
          @confirm="confirmDelete && confirmarEliminar(confirmDelete)"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
