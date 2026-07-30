<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

// Pantalla admin-only: sus escrituras van con `TenantAdminGuard` en el
// backend. El menú ya la esconde a los no-admin, pero sin guard de ruta la URL
// escrita a mano la abría igual (la lectura es abierta, así que la tabla
// cargaba) y el 403 llegaba recién al guardar.
definePageMeta({ middleware: 'admin' })

interface MotivoDiferencia {
  id: string
  nombre: string
  activo: boolean
  requiereComentario: boolean
  esFijo: boolean
}

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const motivos = ref<MotivoDiferencia[]>([])
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
  requiereComentario: false,
})
const form = ref(emptyForm())

const drawerTitle = computed(() =>
  editingId.value ? 'Editar motivo' : 'Nuevo motivo',
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
    motivos.value = await useApiFetch<MotivoDiferencia[]>(`${apiUrl}/motivos-diferencia`)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar motivos'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function upsertLocal(saved: MotivoDiferencia) {
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

function abrirEditar(motivo: MotivoDiferencia) {
  resetDrawer()
  editingId.value = motivo.id
  form.value = {
    nombre: motivo.nombre,
    activo: motivo.activo,
    requiereComentario: motivo.requiereComentario,
  }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const isNew = !editingId.value
    const esFijo = !isNew && editingEsFijo.value
    const body: Record<string, unknown> = {
      activo: form.value.activo,
      requiereComentario: form.value.requiereComentario,
    }
    // Divergencia de causas-merma: un fijo permite togglear activo/requiereComentario
    // pero no renombrarse — omitir nombre evita el 400 del backend.
    if (!esFijo) {
      body.nombre = form.value.nombre.trim()
    }
    const saved = isNew
      ? await useApiFetch<MotivoDiferencia>(`${apiUrl}/motivos-diferencia`, { method: 'POST', body })
      : await useApiFetch<MotivoDiferencia>(`${apiUrl}/motivos-diferencia/${editingId.value}`, {
          method: 'PATCH',
          body,
        })
    upsertLocal(saved)
    toast.add({ title: isNew ? 'Motivo creado' : 'Motivo actualizado', color: 'success' })
    drawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function toggleActivo(motivo: MotivoDiferencia) {
  if (toggling.has(motivo.id)) return
  toggling.add(motivo.id)
  const prev = motivo.activo
  motivo.activo = !prev
  try {
    await useApiFetch(`${apiUrl}/motivos-diferencia/${motivo.id}`, {
      method: 'PATCH',
      body: { activo: motivo.activo },
    })
    toast.add({
      title: motivo.activo ? 'Motivo activado' : 'Motivo desactivado',
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
    await useApiFetch(`${apiUrl}/motivos-diferencia/${id}`, { method: 'DELETE' })
    removeLocal(id)
    toast.add({ title: 'Motivo eliminado', color: 'success' })
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

const columns: TableColumn<MotivoDiferencia>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'requiereComentario', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'activo', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Motivos de diferencia"
      description="Tipifica por qué descuadra una caja al cerrar. Los fijos no se renombran ni se eliminan; podés activarlos/desactivarlos."
    >
      <template #actions>
        <UButton
          icon="i-lucide-plus"
          @click="abrirCrear"
        >
          Nuevo motivo
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
            label="Fijo"
            color="neutral"
            variant="subtle"
            size="xs"
          />
        </div>
      </template>

      <template #requiereComentario-cell="{ row }">
        <div class="flex justify-end">
          <UBadge
            v-if="row.original.requiereComentario"
            label="Requiere comentario"
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
            :disabled="toggling.has(row.original.id)"
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
            name="i-lucide-scale"
            class="w-8 h-8 mx-auto mb-2 opacity-40"
          />
          No hay motivos de diferencia.
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
            label="Fijo"
            color="neutral"
            variant="subtle"
            size="xs"
          />
        </div>
      </template>

      <template #body>
        <UForm
          id="motivo-diferencia-form"
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
              placeholder="Ej: Error de vuelto"
              autofocus
              :disabled="editingEsFijo"
            />
          </UFormField>
          <UFormField label="Activo">
            <USwitch v-model="form.activo" />
          </UFormField>
          <UFormField label="Requiere comentario">
            <USwitch v-model="form.requiereComentario" />
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
          type="submit"
          form="motivo-diferencia-form"
          :loading="saving"
        >
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="confirmModalOpen"
      title="Eliminar motivo"
      message="¿Eliminar este motivo de diferencia? No se puede si ya está usado en cierres de caja."
      @cancel="confirmDeleteId = null"
      @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
    />
  </div>
</template>
