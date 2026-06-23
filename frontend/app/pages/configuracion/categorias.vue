<script setup lang="ts">
interface Categoria {
  id: string
  nombre: string
  aplicaA: string
  activo: boolean
}

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const categorias = ref<Categoria[]>([])
const loading = ref(false)
const saving = ref(false)
const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)
const toggling = reactive(new Set<string>())

const aplicaAOptions = [
  { label: 'Productos', value: 'productos' },
  { label: 'Servicios', value: 'servicios' },
  { label: 'Ambos', value: 'ambos' },
]

const emptyForm = () => ({
  nombre: '',
  aplicaA: 'ambos',
  activo: true,
})
const form = ref(emptyForm())

function aplicaALabel(value: string) {
  return aplicaAOptions.find(o => o.value === value)?.label ?? value
}

async function cargar() {
  loading.value = true
  try {
    categorias.value = await useApiFetch<Categoria[]>(`${apiUrl}/categorias`)
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al cargar categorías', color: 'error' })
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

function abrirEditar(cat: Categoria) {
  editingId.value = cat.id
  form.value = {
    nombre: cat.nombre,
    aplicaA: cat.aplicaA,
    activo: cat.activo,
  }
  modalOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const body = {
      nombre: form.value.nombre,
      aplicaA: form.value.aplicaA,
      activo: form.value.activo,
    }
    if (editingId.value) {
      await useApiFetch(`${apiUrl}/categorias/${editingId.value}`, {
        method: 'PATCH',
        body,
      })
      toast.add({ title: 'Categoría actualizada', color: 'success' })
    }
    else {
      await useApiFetch(`${apiUrl}/categorias`, {
        method: 'POST',
        body,
      })
      toast.add({ title: 'Categoría creada', color: 'success' })
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

async function toggleActivo(cat: Categoria) {
  if (toggling.has(cat.id)) return
  toggling.add(cat.id)
  const prev = cat.activo
  cat.activo = !prev
  try {
    await useApiFetch(`${apiUrl}/categorias/${cat.id}`, {
      method: 'PATCH',
      body: { activo: cat.activo },
    })
    toast.add({ title: cat.activo ? 'Categoría activada' : 'Categoría desactivada', color: 'success' })
  }
  catch (e: unknown) {
    cat.activo = prev
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al actualizar', color: 'error' })
  }
  finally {
    toggling.delete(cat.id)
  }
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/categorias/${id}`, {
      method: 'DELETE',
    })
    toast.add({ title: 'Categoría eliminada', color: 'success' })
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
          Categorías
        </h2>
        <p class="text-sm text-gray-500">
          Clasifica productos y servicios del catálogo.
        </p>
      </div>
      <UButton
        icon="i-heroicons-plus"
        @click="abrirCrear"
      >
        Nueva categoría
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
        v-else-if="!categorias.length"
        class="py-8 text-center text-sm text-gray-500"
      >
        No hay categorías registradas.
      </div>
      <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
        <li
          v-for="cat in categorias"
          :key="cat.id"
          class="flex items-center justify-between py-3"
        >
          <div class="min-w-0">
            <p class="font-medium truncate">
              {{ cat.nombre }}
            </p>
            <p class="text-sm text-gray-500">
              Aplica a: {{ aplicaALabel(cat.aplicaA) }}
            </p>
          </div>
          <div class="flex items-center gap-4 shrink-0 ml-4">
            <USwitch
              :model-value="cat.activo"
              :disabled="toggling.has(cat.id)"
              @update:model-value="toggleActivo(cat)"
            />
            <div class="flex gap-2">
              <UButton
                icon="i-heroicons-pencil-square"
                color="neutral"
                variant="ghost"
                @click="abrirEditar(cat)"
              />
              <UButton
                icon="i-heroicons-trash"
                color="error"
                variant="ghost"
                @click="() => { confirmDeleteId = cat.id; confirmModalOpen = true }"
              />
            </div>
          </div>
        </li>
      </ul>
    </UCard>

    <!-- Modal crear/editar -->
    <UModal
      v-model:open="modalOpen"
      :title="editingId ? 'Editar categoría' : 'Nueva categoría'"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField label="Nombre" required>
            <UInput v-model="form.nombre" placeholder="Bebidas" />
          </UFormField>
          <UFormField label="Aplica a">
            <USelectMenu
              v-model="form.aplicaA"
              :items="aplicaAOptions"
              value-key="value"
            />
          </UFormField>
          <UFormField label="Activa">
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
      title="Eliminar categoría"
    >
      <template #body>
        <p class="text-sm">
          ¿Estás seguro de que quieres eliminar esta categoría? Esta acción no se puede deshacer.
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
