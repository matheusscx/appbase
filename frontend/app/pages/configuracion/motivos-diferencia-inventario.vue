<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

// Pantalla admin-only: sus escrituras van con `TenantAdminGuard` en el
// backend. El menú ya la esconde a los no-admin, pero sin guard de ruta la URL
// escrita a mano la abría igual (la lectura es abierta, así que la tabla
// cargaba) y el 403 llegaba recién al guardar.
definePageMeta({ middleware: 'admin' })

interface MotivoDiferenciaInventario {
  id: string
  nombre: string
  activo: boolean
  esFijo: boolean
}

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const motivos = ref<MotivoDiferenciaInventario[]>([])
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
  return motivos.value.find(m => m.id === editingId.value)?.esFijo ?? false
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
    motivos.value = await useApiFetch<MotivoDiferenciaInventario[]>(
      `${apiUrl}/motivos-diferencia-inventario`,
    )
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar causas'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function upsertLocal(saved: MotivoDiferenciaInventario) {
  const idx = motivos.value.findIndex(m => m.id === saved.id)
  if (idx >= 0) {
    motivos.value[idx] = { ...motivos.value[idx], ...saved }
  }
  else {
    motivos.value.push(saved)
  }
  motivos.value = [...motivos.value].sort((a, b) => {
    if (a.esFijo !== b.esFijo) return a.esFijo ? -1 : 1
    return a.nombre.localeCompare(b.nombre, 'es')
  })
}

function removeLocal(id: string) {
  motivos.value = motivos.value.filter(m => m.id !== id)
}

function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
}

function abrirEditar(motivo: MotivoDiferenciaInventario) {
  if (motivo.esFijo) return
  resetDrawer()
  editingId.value = motivo.id
  form.value = {
    nombre: motivo.nombre,
    activo: motivo.activo,
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
      ? await useApiFetch<MotivoDiferenciaInventario>(
          `${apiUrl}/motivos-diferencia-inventario`,
          { method: 'POST', body },
        )
      : await useApiFetch<MotivoDiferenciaInventario>(
          `${apiUrl}/motivos-diferencia-inventario/${editingId.value}`,
          { method: 'PATCH', body },
        )
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

async function toggleActivo(motivo: MotivoDiferenciaInventario) {
  if (motivo.esFijo || toggling.has(motivo.id)) return
  toggling.add(motivo.id)
  const prev = motivo.activo
  motivo.activo = !prev
  try {
    await useApiFetch(`${apiUrl}/motivos-diferencia-inventario/${motivo.id}`, {
      method: 'PATCH',
      body: { activo: motivo.activo },
    })
    toast.add({
      title: motivo.activo ? 'Causa activada' : 'Causa desactivada',
      color: 'success',
    })
  }
  catch (e: unknown) {
    motivo.activo = prev
    toast.add({ title: apiErrorMsg(e, 'Error al actualizar'), color: 'error' })
  }
  finally {
    toggling.delete(motivo.id)
  }
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/motivos-diferencia-inventario/${id}`, { method: 'DELETE' })
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

const columns: TableColumn<MotivoDiferenciaInventario>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'activo', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Motivos de diferencia (inventario)"
      description="Tipifica por qué un recuento descuadra contra el stock del sistema. Las causas fijas del sistema no se editan."
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
      :data="motivos"
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
            name="i-lucide-clipboard-check"
            class="w-8 h-8 mx-auto mb-2 opacity-40"
          />
          No hay causas de diferencia de inventario.
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
          id="motivo-diferencia-inventario-form"
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
              placeholder="Ej: Error de conteo"
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
          @click="() => { drawerOpen = false }"
        >
          Cancelar
        </UButton>
        <UButton
          v-if="!editingEsFijo"
          type="submit"
          form="motivo-diferencia-inventario-form"
          :loading="saving"
        >
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="confirmModalOpen"
      title="Eliminar causa"
      message="¿Eliminar esta causa de diferencia? No se puede si ya está usada en un movimiento de recuento."
      @cancel="confirmDeleteId = null"
      @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
    />
  </div>
</template>
