<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { RepartidorFila } from '~/types/paqueteria'

// Admin-only: el backend va con `TenantAdminGuard`. Sin guard de ruta, la URL escrita a mano la
// abría igual y el 403 llegaba recién al guardar.
definePageMeta({ middleware: 'admin' })

const toast = useToast()
const apiUrl = useRuntimeConfig().public.apiUrl

const repartidores = ref<RepartidorFila[]>([])
const loading = ref(false)
/** La lectura del listado falló: la tabla lo dice en vez de mostrar su vacío (auditoría UX 07.3). */
const errorCarga = ref(false)
const saving = ref(false)
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const toggling = reactive(new Set<string>())

const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)
const eliminando = ref(false)
// El 400 de «tiene hojas de ruta» se queda dentro del modal: con un toast, el modal se cerraba y
// la fila seguía ahí sin explicación a la vista.
const errorEliminar = ref<string | null>(null)

const emptyForm = () => ({ nombre: '', telefono: '' })
const form = ref(emptyForm())

const drawerTitle = computed(() => editingId.value ? 'Editar repartidor' : 'Nuevo repartidor')
const submitLabel = computed(() => editingId.value ? 'Guardar' : 'Crear')
const nombreVacio = computed(() => form.value.nombre.trim() === '')
const repartidorAEliminar = computed(() =>
  repartidores.value.find(r => r.id === confirmDeleteId.value) ?? null,
)

function resetDrawer() {
  editingId.value = null
  form.value = emptyForm()
}

watch(drawerOpen, (open) => {
  if (!open) resetDrawer()
})

async function cargar() {
  errorCarga.value = false
  loading.value = true
  try {
    repartidores.value = await useApiFetch<RepartidorFila[]>(`${apiUrl}/repartidores`)
  }
  catch (e: unknown) {
    errorCarga.value = true
    toast.add({ title: apiErrorMsg(e, 'Error al cargar repartidores'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function upsertLocal(saved: RepartidorFila) {
  const idx = repartidores.value.findIndex(r => r.id === saved.id)
  if (idx >= 0) {
    repartidores.value[idx] = { ...repartidores.value[idx], ...saved }
  }
  else {
    repartidores.value.push(saved)
  }
  repartidores.value = [...repartidores.value].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es'),
  )
}

function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
}

function abrirEditar(r: RepartidorFila) {
  resetDrawer()
  editingId.value = r.id
  form.value = { nombre: r.nombre, telefono: r.telefono ?? '' }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const body = {
      nombre: form.value.nombre.trim(),
      // `null` y no ausente: al editar, vaciar el campo tiene que borrar el teléfono.
      telefono: form.value.telefono.trim() || null,
    }
    const isNew = !editingId.value
    const saved = isNew
      ? await useApiFetch<RepartidorFila>(`${apiUrl}/repartidores`, { method: 'POST', body })
      : await useApiFetch<RepartidorFila>(`${apiUrl}/repartidores/${editingId.value}`, {
          method: 'PATCH',
          body,
        })
    upsertLocal(saved)
    toast.add({ title: isNew ? 'Repartidor creado' : 'Repartidor actualizado', color: 'success' })
    drawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function toggleActivo(r: RepartidorFila) {
  if (toggling.has(r.id)) return
  toggling.add(r.id)
  const prev = r.activo
  r.activo = !prev
  try {
    await useApiFetch(`${apiUrl}/repartidores/${r.id}`, {
      method: 'PATCH',
      body: { activo: r.activo },
    })
    toast.add({ title: r.activo ? 'Repartidor activado' : 'Repartidor desactivado', color: 'success' })
  }
  catch (e: unknown) {
    r.activo = prev
    toast.add({ title: apiErrorMsg(e, 'Error al actualizar'), color: 'error' })
  }
  finally {
    toggling.delete(r.id)
  }
}

function pedirEliminar(r: RepartidorFila) {
  confirmDeleteId.value = r.id
  errorEliminar.value = null
  confirmModalOpen.value = true
}

function cancelarEliminar() {
  confirmDeleteId.value = null
  errorEliminar.value = null
}

async function eliminar(id: string) {
  eliminando.value = true
  errorEliminar.value = null
  try {
    await useApiFetch(`${apiUrl}/repartidores/${id}`, { method: 'DELETE' })
    repartidores.value = repartidores.value.filter(r => r.id !== id)
    toast.add({ title: 'Repartidor eliminado', color: 'success' })
    confirmModalOpen.value = false
    confirmDeleteId.value = null
  }
  catch (e: unknown) {
    errorEliminar.value = apiErrorMsg(e, 'Error al eliminar')
  }
  finally {
    eliminando.value = false
  }
}

onMounted(cargar)

const columns: TableColumn<RepartidorFila>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'activo', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Repartidores"
      description="Quienes salen a repartir. Solo los activos se pueden elegir al armar una hoja de ruta."
    >
      <template #actions>
        <UButton icon="i-lucide-plus" @click="abrirCrear">
          Nuevo repartidor
        </UButton>
      </template>
    </CrudPageHeader>

    <CrudTable :data="repartidores" :columns="columns" :loading="loading" :error="errorCarga" recurso="los repartidores" @reintentar="cargar">
      <template #nombre-cell="{ row }">
        <CrudListItem
          :title="row.original.nombre"
          :subtitle="row.original.telefono ?? 'Sin teléfono'"
        />
      </template>

      <template #activo-cell="{ row }">
        <div class="flex items-center justify-end gap-2">
          <span class="text-sm text-muted">{{ row.original.activo ? 'Activo' : 'Inactivo' }}</span>
          <USwitch
            :model-value="row.original.activo"
            :disabled="toggling.has(row.original.id)"
            :aria-label="`Activo: ${row.original.nombre}`"
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
            title="Editar"
            @click="abrirEditar(row.original)"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            title="Eliminar"
            @click="pedirEliminar(row.original)"
          />
        </div>
      </template>

      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          Todavía no hay repartidores. Crea el primero para poder armar hojas de ruta.
        </div>
      </template>
    </CrudTable>

    <AppDrawer v-model:open="drawerOpen">
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>

      <template #body>
        <UForm
          id="repartidor-form"
          :state="form"
          class="space-y-4"
          @submit="guardar"
        >
          <UFormField label="Nombre" required>
            <UInput
              v-model="form.nombre"
              placeholder="Juan Pérez"
              maxlength="150"
              autofocus
            />
          </UFormField>
          <UFormField label="Teléfono">
            <UInput
              v-model="form.telefono"
              type="tel"
              inputmode="tel"
              placeholder="+56 9 1234 5678"
              maxlength="30"
            />
          </UFormField>
        </UForm>
      </template>

      <template #actions>
        <UButton color="neutral" variant="ghost" @click="() => { drawerOpen = false }">
          Cancelar
        </UButton>
        <UButton
          type="submit"
          form="repartidor-form"
          :loading="saving"
          :disabled="nombreVacio"
        >
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="confirmModalOpen"
      title="Eliminar repartidor"
      :message="`¿Eliminar a ${repartidorAEliminar?.nombre ?? 'este repartidor'}? Si ya tiene hojas de ruta no se puede eliminar: desactívalo.`"
      :loading="eliminando"
      @cancel="cancelarEliminar"
      @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
    >
      <template #detalle>
        <UAlert
          v-if="errorEliminar"
          class="mt-3"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="errorEliminar"
          data-qa="repartidor-error-eliminar"
        />
      </template>
    </CrudModal>
  </div>
</template>
