<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Tarjeta } from '~/composables/useTarjetas'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { formatFecha } = useFormatters()

const {
  tarjetas, oneclickDisponible, loading,
  agregar, eliminar, marcarPreferida,
} = useTarjetas()

const agregando = ref(false)
const working = reactive(new Set<string>())
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)

function apiErrorMsg(e: unknown, fallback: string): string {
  return (e as { data?: { message?: string } })?.data?.message ?? fallback
}

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

async function confirmarEliminar(id: string) {
  confirmModalOpen.value = false
  confirmDeleteId.value = null
  if (working.has(id)) return
  working.add(id)
  try {
    await eliminar(id)
    toast.add({ title: 'Tarjeta eliminada', color: 'success' })
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
      <AppNavbar title="Medios de pago">
        <template #right>
          <UserMenu />
        </template>
      </AppNavbar>
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <CrudPageHeader
          title="Medios de pago"
          description="Tarjetas inscritas en Webpay Oneclick para pagar en la tienda online. Nunca guardamos el número: solo la marca y los últimos 4 dígitos."
        >
          <template #actions>
            <UButton
              icon="i-lucide-plus"
              :disabled="!oneclickDisponible"
              :loading="agregando"
              @click="abrirInscripcion"
            >
              Agregar tarjeta
            </UButton>
          </template>
        </CrudPageHeader>

        <UAlert
          v-if="!loading && !oneclickDisponible"
          icon="i-lucide-triangle-alert"
          color="warning"
          variant="soft"
          title="Inscripción no disponible"
          description="El tenant no tiene una pasarela con tokenización (Oneclick) configurada y activa."
        />

        <div v-if="loading" class="py-8 text-center text-sm text-muted">
          Cargando…
        </div>

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
                class="p-1 rounded transition-colors hover:bg-muted"
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
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              @click="() => { confirmDeleteId = row.original.inscripcionId; confirmModalOpen = true }"
            />
          </template>

          <template #empty>
            <div class="py-8 text-center text-sm text-muted">
              No tenés tarjetas inscritas.
            </div>
          </template>
        </CrudTable>

        <CrudModal
          v-model:open="confirmModalOpen"
          title="Eliminar tarjeta"
          message="¿Estás seguro? La tarjeta se eliminará también en Transbank y no podrá usarse para cobros."
          @cancel="confirmDeleteId = null"
          @confirm="confirmDeleteId && confirmarEliminar(confirmDeleteId)"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
