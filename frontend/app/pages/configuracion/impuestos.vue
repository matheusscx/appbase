<script setup lang="ts">
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
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al cargar impuestos', color: 'error' })
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
      porcentaje: String(form.value.porcentaje),
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
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al guardar', color: 'error' })
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
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al actualizar', color: 'error' })
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
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al eliminar', color: 'error' })
  }
  finally {
    confirmDeleteId.value = null
    confirmModalOpen.value = false
  }
}

onMounted(cargar)
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold">
          Impuestos
        </h2>
        <p class="text-sm text-gray-500">
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
      <div
        v-if="loading"
        class="py-8 text-center text-sm text-gray-500"
      >
        Cargando…
      </div>
      <div
        v-else-if="!impuestos.length"
        class="py-8 text-center text-sm text-gray-500"
      >
        No hay impuestos registrados.
      </div>
      <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
        <li
          v-for="imp in impuestos"
          :key="imp.id"
          class="flex items-center justify-between py-3"
        >
          <div class="min-w-0">
            <p class="font-medium truncate">
              {{ imp.nombre }}
            </p>
            <p class="text-sm text-gray-500">
              Porcentaje: {{ imp.porcentaje }}
            </p>
          </div>
          <div class="flex items-center gap-4 shrink-0 ml-4">
            <USwitch
              :model-value="imp.activo"
              :disabled="toggling.has(imp.id)"
              @update:model-value="toggleActivo(imp)"
            />
            <div class="flex gap-2">
              <UButton
                icon="i-heroicons-pencil-square"
                color="neutral"
                variant="ghost"
                @click="abrirEditar(imp)"
              />
              <UButton
                icon="i-heroicons-trash"
                color="error"
                variant="ghost"
                @click="() => { confirmDeleteId = imp.id; confirmModalOpen = true }"
              />
            </div>
          </div>
        </li>
      </ul>
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
              type="number"
              step="0.0001"
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
