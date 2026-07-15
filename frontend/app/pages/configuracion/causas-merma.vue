<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

interface CausaMerma {
  id: string
  nombre: string
  activo: boolean
  esFijo: boolean
}

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const causas = ref<CausaMerma[]>([])
const loading = ref(false)
const saving = ref(false)
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)
const toggling = reactive(new Set<string>())

const emptyForm = () => ({
  nombre: '',
  activo: true,
})
const form = ref(emptyForm())

const drawerTitle = computed(() =>
  editingId.value ? 'Editar causa' : 'Nueva causa',
)

const submitLabel = computed(() =>
  editingId.value ? 'Guardar' : 'Crear',
)

const editingEsFijo = computed(() => {
  if (!editingId.value) return false
  return causas.value.find(c => c.id === editingId.value)?.esFijo ?? false
})

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
    causas.value = await useApiFetch<CausaMerma[]>(`${apiUrl}/causas-merma`)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar causas'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function upsertLocal(saved: CausaMerma) {
  const idx = causas.value.findIndex(c => c.id === saved.id)
  if (idx >= 0) {
    causas.value[idx] = { ...causas.value[idx], ...saved }
  }
  else {
    causas.value.push(saved)
  }
  causas.value = [...causas.value].sort((a, b) => {
    if (a.esFijo !== b.esFijo) return a.esFijo ? -1 : 1
    return a.nombre.localeCompare(b.nombre, 'es')
  })
}

function removeLocal(id: string) {
  causas.value = causas.value.filter(c => c.id !== id)
}

function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
}

function abrirEditar(causa: CausaMerma) {
  if (causa.esFijo) return
  resetDrawer()
  editingId.value = causa.id
  form.value = {
    nombre: causa.nombre,
    activo: causa.activo,
  }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const body = {
      nombre: form.value.nombre.trim(),
      activo: form.value.activo,
    }
    const isNew = !editingId.value
    const saved = isNew
      ? await useApiFetch<CausaMerma>(`${apiUrl}/causas-merma`, { method: 'POST', body })
      : await useApiFetch<CausaMerma>(`${apiUrl}/causas-merma/${editingId.value}`, {
          method: 'PATCH',
          body,
        })
    upsertLocal(saved)
    toast.add({ title: isNew ? 'Causa creada' : 'Causa actualizada', color: 'success' })
    drawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function toggleActivo(causa: CausaMerma) {
  if (causa.esFijo || toggling.has(causa.id)) return
  toggling.add(causa.id)
  const prev = causa.activo
  causa.activo = !prev
  try {
    await useApiFetch(`${apiUrl}/causas-merma/${causa.id}`, {
      method: 'PATCH',
      body: { activo: causa.activo },
    })
    toast.add({
      title: causa.activo ? 'Causa activada' : 'Causa desactivada',
      color: 'success',
    })
  }
  catch (e: unknown) {
    causa.activo = prev
    toast.add({ title: apiErrorMsg(e, 'Error al actualizar'), color: 'error' })
  }
  finally {
    toggling.delete(causa.id)
  }
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/causas-merma/${id}`, { method: 'DELETE' })
    removeLocal(id)
    toast.add({ title: 'Causa eliminada', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al eliminar'), color: 'error' })
  }
  finally {
    confirmDeleteId.value = null
    confirmModalOpen.value = false
  }
}

onMounted(cargar)

const columns: TableColumn<CausaMerma>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'activo', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Causas de merma"
      description="Tipifica por qué se descarta stock. Las causas fijas del sistema no se editan."
    >
      <template #actions>
        <UButton
          icon="i-lucide-plus"
          @click="abrirCrear"
        >
          Nueva causa
        </UButton>
      </template>
    </CrudPageHeader>

    <CrudTable
      :data="causas"
      :columns="columns"
      :loading="loading"
    >
      <template #nombre-cell="{ row }">
        <div class="flex items-center gap-2">
          <span class="font-medium text-default">{{ row.original.nombre }}</span>
          <UBadge
            v-if="row.original.esFijo"
            label="Fija"
            color="neutral"
            variant="subtle"
            size="xs"
          />
        </div>
      </template>

      <template #activo-cell="{ row }">
        <div class="flex justify-end">
          <USwitch
            :model-value="row.original.activo"
            :disabled="row.original.esFijo || toggling.has(row.original.id)"
            @update:model-value="toggleActivo(row.original)"
          />
        </div>
      </template>

      <template #acciones-cell="{ row }">
        <div class="flex justify-end gap-2">
          <UButton
            icon="i-lucide-square-pen"
            color="neutral"
            variant="ghost"
            :disabled="row.original.esFijo"
            @click="abrirEditar(row.original)"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            :disabled="row.original.esFijo"
            @click="() => { confirmDeleteId = row.original.id; confirmModalOpen = true }"
          />
        </div>
      </template>

      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          <UIcon
            name="i-lucide-tags"
            class="w-8 h-8 mx-auto mb-2 opacity-40"
          />
          No hay causas de merma.
        </div>
      </template>
    </CrudTable>

    <AppDrawer
      v-model:open="drawerOpen"
      width="md"
    >
      <template #header>
        <div class="flex items-center gap-2">
          <span class="font-semibold text-default">{{ drawerTitle }}</span>
          <UBadge
            v-if="editingEsFijo"
            label="Fija"
            color="neutral"
            variant="subtle"
            size="xs"
          />
        </div>
      </template>

      <template #body>
        <UForm
          id="causa-merma-form"
          :state="form"
          class="space-y-4"
          @submit="guardar"
        >
          <UFormField
            label="Nombre"
            required
          >
            <UInput
              v-model="form.nombre"
              placeholder="Ej: Rotura de envase"
              autofocus
              :disabled="editingEsFijo"
            />
          </UFormField>
          <UFormField label="Activa">
            <USwitch
              v-model="form.activo"
              :disabled="editingEsFijo"
            />
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
          v-if="!editingEsFijo"
          type="submit"
          form="causa-merma-form"
          :loading="saving"
        >
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="confirmModalOpen"
      title="Eliminar causa"
      message="¿Eliminar esta causa de merma? No se puede si ya está usada en movimientos."
      @cancel="confirmDeleteId = null"
      @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
    />
  </div>
</template>
