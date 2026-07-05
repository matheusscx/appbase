<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Tarjeta } from '~/composables/useTarjetas'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const { tarjetas, agregar, eliminar, marcarPreferida } = useTarjetas()

const drawerOpen = ref(false)
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)

const emptyForm = () => ({ numero: '', titular: '', vencimiento: '' })
const form = ref(emptyForm())

function abrirCrear() {
  form.value = emptyForm()
  drawerOpen.value = true
}

function guardar() {
  agregar(form.value)
  drawerOpen.value = false
}

function confirmarEliminar(id: string) {
  eliminar(id)
  confirmDeleteId.value = null
  confirmModalOpen.value = false
}

const columns: TableColumn<Tarjeta>[] = [
  { accessorKey: 'titular', header: 'Tarjeta' },
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
      <div class="max-w-5xl mx-auto space-y-6 py-6">
        <CrudPageHeader
          title="Medios de pago"
          description="Tarjetas guardadas para pagar en la tienda online. Solo se guardan la marca y los últimos 4 dígitos."
        >
          <template #actions>
            <UButton icon="i-lucide-plus" @click="abrirCrear">
              Agregar tarjeta
            </UButton>
          </template>
        </CrudPageHeader>

        <CrudTable :data="tarjetas" :columns="columns">
          <template #titular-cell="{ row }">
            <CrudListItem
              :title="`${row.original.marca} •••• ${row.original.last4}`"
              :subtitle="`${row.original.titular} · vence ${row.original.vencimiento}`"
            />
          </template>

          <template #preferida-cell="{ row }">
            <div class="flex justify-end">
              <button
                type="button"
                class="p-1 rounded transition-colors hover:bg-muted"
                @click="marcarPreferida(row.original.id)"
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
              @click="() => { confirmDeleteId = row.original.id; confirmModalOpen = true }"
            />
          </template>

          <template #empty>
            <div class="py-8 text-center text-sm text-muted">
              No tenés tarjetas registradas.
            </div>
          </template>
        </CrudTable>

        <AppDrawer v-model:open="drawerOpen" width="50%">
          <template #header>
            <span class="font-semibold text-default">Nueva tarjeta</span>
          </template>

          <template #body>
            <UForm id="tarjeta-form" :state="form" class="space-y-4" @submit="guardar">
              <UFormField label="Número de tarjeta" required>
                <UInput v-model="form.numero" placeholder="4111 1111 1111 1111" autofocus />
              </UFormField>
              <UFormField label="Titular" required>
                <UInput v-model="form.titular" placeholder="Nombre como aparece en la tarjeta" />
              </UFormField>
              <UFormField label="Vencimiento" required>
                <UInput v-model="form.vencimiento" placeholder="MM/AA" />
              </UFormField>
            </UForm>
          </template>

          <template #actions>
            <UButton color="neutral" variant="ghost" @click="drawerOpen = false">
              Cancelar
            </UButton>
            <UButton type="submit" form="tarjeta-form">
              Guardar
            </UButton>
          </template>
        </AppDrawer>

        <CrudModal
          v-model:open="confirmModalOpen"
          title="Eliminar tarjeta"
          message="¿Estás seguro de que quieres eliminar esta tarjeta?"
          @cancel="confirmDeleteId = null"
          @confirm="confirmDeleteId && confirmarEliminar(confirmDeleteId)"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
