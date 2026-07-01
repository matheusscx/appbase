<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

interface RazonSocial {
  id: string
  nombre: string
  rut: string
  direccion: string | null
  telefono: string | null
  habilitado: boolean
  preferida: boolean
}

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const razones = ref<RazonSocial[]>([])
const loading = ref(false)
const saving = ref(false)
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)
const toggling = reactive(new Set<string>())

const emptyForm = () => ({
  nombre: '',
  rut: '',
  direccion: '',
  telefono: '',
  habilitado: true,
})
const form = ref(emptyForm())

const drawerTitle = computed(() =>
  editingId.value ? 'Editar razón social' : 'Nueva razón social',
)

const submitLabel = computed(() =>
  editingId.value ? 'Guardar' : 'Crear',
)

function resetDrawer() {
  editingId.value = null
  form.value = emptyForm()
}

watch(drawerOpen, (open) => {
  if (!open) resetDrawer()
})

async function cargar() {
  loading.value = true
  try {
    razones.value = await useApiFetch<RazonSocial[]>(`${apiUrl}/tenants/razones-sociales`)
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar razones sociales')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
}

function abrirEditar(rs: RazonSocial) {
  resetDrawer()
  editingId.value = rs.id
  form.value = {
    nombre: rs.nombre,
    rut: rs.rut,
    direccion: rs.direccion ?? '',
    telefono: rs.telefono ?? '',
    habilitado: rs.habilitado,
  }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const body = {
      nombre: form.value.nombre,
      rut: form.value.rut,
      direccion: form.value.direccion || null,
      telefono: form.value.telefono || null,
      habilitado: form.value.habilitado,
    }
    if (editingId.value) {
      await useApiFetch(`${apiUrl}/tenants/razones-sociales/${editingId.value}`, {
        method: 'PATCH',
        body,
      })
      toast.add({ title: 'Razón social actualizada', color: 'success' })
    }
    else {
      await useApiFetch(`${apiUrl}/tenants/razones-sociales`, {
        method: 'POST',
        body,
      })
      toast.add({ title: 'Razón social creada', color: 'success' })
    }
    drawerOpen.value = false
    await cargar()
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al guardar')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function toggleHabilitado(rs: RazonSocial) {
  if (toggling.has(rs.id)) return
  if (rs.preferida && rs.habilitado) {
    toast.add({ title: 'No se puede deshabilitar la razón social preferida', color: 'warning' })
    return
  }
  toggling.add(rs.id)
  const prev = rs.habilitado
  rs.habilitado = !prev
  try {
    await useApiFetch(`${apiUrl}/tenants/razones-sociales/${rs.id}`, {
      method: 'PATCH',
      body: { habilitado: rs.habilitado },
    })
    toast.add({ title: rs.habilitado ? 'Razón social habilitada' : 'Razón social deshabilitada', color: 'success' })
  }
  catch (e: unknown) {
    rs.habilitado = prev
    const msg = apiErrorMsg(e, 'Error al actualizar')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    toggling.delete(rs.id)
  }
}

async function togglePreferida(rs: RazonSocial) {
  if (rs.preferida || toggling.has(rs.id)) return
  if (!rs.habilitado) {
    toast.add({ title: 'Debes habilitar la razón social antes de marcarla como preferida', color: 'warning' })
    return
  }
  const prev = razones.value.find(r => r.preferida)
  if (prev) prev.preferida = false
  rs.preferida = true
  toggling.add(rs.id)
  try {
    await useApiFetch(`${apiUrl}/tenants/razones-sociales/${rs.id}/preferida`, {
      method: 'PATCH',
    })
    toast.add({ title: 'Razón social preferida actualizada', color: 'success' })
  }
  catch (e: unknown) {
    rs.preferida = false
    if (prev) prev.preferida = true
    const msg = apiErrorMsg(e, 'Error al actualizar preferida')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    toggling.delete(rs.id)
  }
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/tenants/razones-sociales/${id}`, {
      method: 'DELETE',
    })
    toast.add({ title: 'Razón social eliminada', color: 'success' })
    await cargar()
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al eliminar')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    confirmDeleteId.value = null
    confirmModalOpen.value = false
  }
}

onMounted(cargar)

const columns: TableColumn<RazonSocial>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'preferida', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'habilitado', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold">
          Razones sociales
        </h2>
        <p class="text-sm text-muted">
          Datos legales para facturación del tenant.
        </p>
      </div>
      <UButton
        icon="i-heroicons-plus"
        @click="abrirCrear"
      >
        Nueva razón social
      </UButton>
    </div>

    <UCard>
      <UTable :data="razones" :columns="columns" :loading="loading">
        <template #nombre-cell="{ row }">
          <div class="min-w-0">
            <p class="font-medium truncate">
              {{ row.original.nombre }}
            </p>
            <p class="text-sm text-muted">
              RUT: {{ row.original.rut }}
            </p>
            <p
              v-if="row.original.direccion"
              class="text-sm text-muted truncate"
            >
              {{ row.original.direccion }}
            </p>
          </div>
        </template>

        <template #preferida-cell="{ row }">
          <div class="flex justify-end">
            <button
              type="button"
              class="p-1 rounded transition-colors hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="toggling.has(row.original.id)"
              @click="togglePreferida(row.original)"
            >
              <UIcon
                :name="row.original.preferida ? 'i-heroicons-star-solid' : 'i-heroicons-star'"
                class="w-5 h-5"
                :class="row.original.preferida ? 'text-warning' : 'text-muted'"
              />
            </button>
          </div>
        </template>

        <template #habilitado-cell="{ row }">
          <div class="flex justify-end">
            <USwitch
              :model-value="row.original.habilitado"
              :disabled="toggling.has(row.original.id)"
              @update:model-value="toggleHabilitado(row.original)"
            />
          </div>
        </template>

        <template #acciones-cell="{ row }">
          <div class="flex justify-end gap-2">
            <UButton
              icon="i-heroicons-pencil-square"
              color="neutral"
              variant="ghost"
              @click="abrirEditar(row.original)"
            />
            <UButton
              icon="i-heroicons-trash"
              color="error"
              variant="ghost"
              @click="() => { confirmDeleteId = row.original.id; confirmModalOpen = true }"
            />
          </div>
        </template>

        <template #empty>
          <div class="py-8 text-center text-sm text-muted">
            No hay razones sociales registradas.
          </div>
        </template>
      </UTable>
    </UCard>

    <AppDrawer v-model:open="drawerOpen" width="50%">
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>

      <template #body>
        <UForm
          id="razon-social-form"
          :state="form"
          class="space-y-4"
          @submit="guardar"
        >
          <UFormField label="Nombre legal" required>
            <UInput
              v-model="form.nombre"
              placeholder="Empresa S.A."
              autofocus
            />
          </UFormField>
          <UFormField label="RUT" required>
            <UInput v-model="form.rut" placeholder="76.123.456-7" />
          </UFormField>
          <UFormField label="Dirección">
            <UInput v-model="form.direccion" placeholder="Av. Ejemplo 123" />
          </UFormField>
          <UFormField label="Teléfono">
            <UInput v-model="form.telefono" placeholder="+56 9 1234 5678" />
          </UFormField>
          <UFormField label="Habilitada">
            <USwitch v-model="form.habilitado" />
          </UFormField>
        </UForm>
      </template>

      <template #actions>
        <UButton
          color="neutral"
          variant="ghost"
          @click="drawerOpen = false"
        >
          Cancelar
        </UButton>
        <UButton
          type="submit"
          form="razon-social-form"
          :loading="saving"
        >
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>

    <!-- Modal confirmación eliminar -->
    <UModal
      v-model:open="confirmModalOpen"
      title="Eliminar razón social"
    >
      <template #body>
        <p class="text-sm">
          ¿Estás seguro de que quieres eliminar esta razón social? Esta acción no se puede deshacer.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="confirmModalOpen = false; confirmDeleteId = null">
            Cancelar
          </UButton>
          <UButton
            color="error"
            @click="confirmDeleteId && eliminar(confirmDeleteId)"
          >
            Eliminar
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
