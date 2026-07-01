<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

interface Impuesto {
  id: string
  nombre: string
  porcentaje: string
  activo: boolean
}

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const impuestos = ref<Impuesto[]>([])
const loading = ref(false)
const saving = ref(false)
const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)
const toggling = reactive(new Set<string>())

const emptyForm = () => ({
  nombre: '',
  porcentaje: '',
  activo: true,
})
const form = ref(emptyForm())

async function cargar() {
  loading.value = true
  try {
    impuestos.value = await useApiFetch<Impuesto[]>(`${apiUrl}/impuestos`)
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar impuestos')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function abrirCrear() {
  editingId.value = null
  form.value = emptyForm()
  modalOpen.value = true
}

function abrirEditar(imp: Impuesto) {
  editingId.value = imp.id
  form.value = {
    nombre: imp.nombre,
    porcentaje: imp.porcentaje,
    activo: imp.activo,
  }
  modalOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const body = {
      nombre: form.value.nombre,
      porcentaje: form.value.porcentaje,
      activo: form.value.activo,
    }
    if (editingId.value) {
      await useApiFetch(`${apiUrl}/impuestos/${editingId.value}`, {
        method: 'PATCH',
        body,
      })
      toast.add({ title: 'Impuesto actualizado', color: 'success' })
    }
    else {
      await useApiFetch(`${apiUrl}/impuestos`, {
        method: 'POST',
        body,
      })
      toast.add({ title: 'Impuesto creado', color: 'success' })
    }
    modalOpen.value = false
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

async function toggleActivo(imp: Impuesto) {
  if (toggling.has(imp.id)) return
  toggling.add(imp.id)
  const prev = imp.activo
  imp.activo = !prev
  try {
    await useApiFetch(`${apiUrl}/impuestos/${imp.id}`, {
      method: 'PATCH',
      body: { activo: imp.activo },
    })
    toast.add({ title: imp.activo ? 'Impuesto activado' : 'Impuesto desactivado', color: 'success' })
  }
  catch (e: unknown) {
    imp.activo = prev
    const msg = apiErrorMsg(e, 'Error al actualizar')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    toggling.delete(imp.id)
  }
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/impuestos/${id}`, {
      method: 'DELETE',
    })
    toast.add({ title: 'Impuesto eliminado', color: 'success' })
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

const columns: TableColumn<Impuesto>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'activo', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold">
          Impuestos
        </h2>
        <p class="text-sm text-muted">
          Tasas impositivas del tenant (en decimal: 0.19 = 19%).
        </p>
      </div>
      <UButton
        icon="i-heroicons-plus"
        @click="abrirCrear"
      >
        Nuevo impuesto
      </UButton>
    </div>

    <UCard>
      <UTable :data="impuestos" :columns="columns" :loading="loading">
        <template #nombre-cell="{ row }">
          <div class="min-w-0">
            <p class="font-medium truncate">
              {{ row.original.nombre }}
            </p>
            <p class="text-sm text-muted">
              Porcentaje: {{ row.original.porcentaje }}
            </p>
          </div>
        </template>

        <template #activo-cell="{ row }">
          <div class="flex justify-end">
            <USwitch
              :model-value="row.original.activo"
              :disabled="toggling.has(row.original.id)"
              @update:model-value="toggleActivo(row.original)"
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
            No hay impuestos registrados.
          </div>
        </template>
      </UTable>
    </UCard>

    <!-- Modal crear/editar -->
    <UModal
      v-model:open="modalOpen"
      :title="editingId ? 'Editar impuesto' : 'Nuevo impuesto'"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField label="Nombre" required>
            <UInput v-model="form.nombre" placeholder="IVA" />
          </UFormField>
          <UFormField label="Porcentaje (decimal)" required>
            <UInput
              v-model="form.porcentaje"
              inputmode="decimal"
              placeholder="0.19"
            />
          </UFormField>
          <UFormField label="Activo">
            <USwitch v-model="form.activo" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="modalOpen = false">
            Cancelar
          </UButton>
          <UButton :loading="saving" @click="guardar">
            Guardar
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Modal confirmación eliminar -->
    <UModal
      v-model:open="confirmModalOpen"
      title="Eliminar impuesto"
    >
      <template #body>
        <p class="text-sm">
          ¿Estás seguro de que quieres eliminar este impuesto? Esta acción no se puede deshacer.
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
