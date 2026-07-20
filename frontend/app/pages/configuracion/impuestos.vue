<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

interface Impuesto {
  id: string
  nombre: string
  porcentaje: string
  activo: boolean
  tipo: 'iva' | 'otro'
  origen: 'sistema' | 'personalizado'
}

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const impuestos = ref<Impuesto[]>([])
const loading = ref(false)
const saving = ref(false)
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)
const toggling = reactive(new Set<string>())

const tipoOpts = [
  { label: 'IVA', value: 'iva' },
  { label: 'Otro', value: 'otro' },
]

const emptyForm = () => ({
  nombre: '',
  porcentaje: '',
  activo: true,
  tipo: 'otro' as 'iva' | 'otro',
})
const form = ref(emptyForm())

const drawerTitle = computed(() =>
  editingId.value ? 'Editar impuesto' : 'Nuevo impuesto',
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

function upsertLocal(saved: Impuesto) {
  const idx = impuestos.value.findIndex(i => i.id === saved.id)
  if (idx >= 0) {
    impuestos.value[idx] = { ...impuestos.value[idx], ...saved }
  }
  else {
    impuestos.value.push(saved)
  }
  impuestos.value = [...impuestos.value].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es'),
  )
}

function removeLocal(id: string) {
  impuestos.value = impuestos.value.filter(i => i.id !== id)
}

function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
}

function abrirEditar(imp: Impuesto) {
  if (imp.origen === 'sistema') return
  resetDrawer()
  editingId.value = imp.id
  form.value = {
    nombre: imp.nombre,
    porcentaje: imp.porcentaje,
    activo: imp.activo,
    tipo: imp.tipo,
  }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const body = {
      nombre: form.value.nombre,
      porcentaje: form.value.porcentaje,
      activo: form.value.activo,
      tipo: form.value.tipo,
    }
    const isNew = !editingId.value
    const saved = isNew
      ? await useApiFetch<Impuesto>(`${apiUrl}/impuestos`, { method: 'POST', body })
      : await useApiFetch<Impuesto>(`${apiUrl}/impuestos/${editingId.value}`, {
          method: 'PATCH',
          body,
        })
    // El backend no incluye `origen` en la respuesta de POST/PATCH (solo en GET);
    // toda fila que llega aquí es siempre personalizada (las de sistema no
    // pasan por este form, ver guard en abrirEditar).
    upsertLocal({ ...saved, origen: 'personalizado' })
    toast.add({ title: isNew ? 'Impuesto creado' : 'Impuesto actualizado', color: 'success' })
    drawerOpen.value = false
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
  if (imp.origen === 'sistema') return
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

function pedirEliminar(imp: Impuesto) {
  if (imp.origen === 'sistema') return
  confirmDeleteId.value = imp.id
  confirmModalOpen.value = true
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/impuestos/${id}`, {
      method: 'DELETE',
    })
    removeLocal(id)
    toast.add({ title: 'Impuesto eliminado', color: 'success' })
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
    <CrudPageHeader
      title="Impuestos"
      description="Impuestos oficiales del país (Sistema) e impuestos propios del tenant (en decimal: 0.19 = 19%)."
    >
      <template #actions>
        <UButton
          icon="i-lucide-plus"
          @click="abrirCrear"
        >
          Nuevo impuesto
        </UButton>
      </template>
    </CrudPageHeader>

    <CrudTable :data="impuestos" :columns="columns" :loading="loading">
      <template #nombre-cell="{ row }">
        <div class="flex items-center gap-2">
          <CrudListItem
            :title="row.original.nombre"
            :subtitle="`Porcentaje: ${row.original.porcentaje}`"
          />
          <UBadge
            :label="row.original.origen === 'sistema' ? 'Sistema' : 'Personalizado'"
            :color="row.original.origen === 'sistema' ? 'info' : 'neutral'"
            variant="soft"
            size="sm"
          />
        </div>
      </template>

        <template #activo-cell="{ row }">
          <div class="flex justify-end">
            <USwitch
              v-if="row.original.origen === 'personalizado'"
              :model-value="row.original.activo"
              :disabled="toggling.has(row.original.id)"
              @update:model-value="toggleActivo(row.original)"
            />
          </div>
        </template>

        <template #acciones-cell="{ row }">
          <div class="flex justify-end gap-2">
            <template v-if="row.original.origen === 'personalizado'">
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
                @click="pedirEliminar(row.original)"
              />
            </template>
            <span v-else class="text-xs text-muted">Catálogo oficial</span>
          </div>
        </template>

      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          No hay impuestos registrados.
        </div>
      </template>
    </CrudTable>

    <AppDrawer v-model:open="drawerOpen" width="50%">
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>

      <template #body>
        <UForm
          id="impuesto-form"
          :state="form"
          class="space-y-4"
          @submit="guardar"
        >
          <UFormField label="Nombre" required>
            <UInput
              v-model="form.nombre"
              placeholder="IVA"
              autofocus
            />
          </UFormField>
          <UFormField label="Porcentaje (decimal)" required>
            <UInput
              v-model="form.porcentaje"
              inputmode="decimal"
              placeholder="0.19"
            />
          </UFormField>
          <UFormField label="Tipo" help="Los impuestos tipo IVA no se aplican a items exentos.">
            <USelect v-model="form.tipo" :items="tipoOpts" class="w-full" />
          </UFormField>
          <UFormField label="Activo">
            <USwitch v-model="form.activo" />
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
          form="impuesto-form"
          :loading="saving"
        >
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="confirmModalOpen"
      title="Eliminar impuesto"
      message="¿Estás seguro de que quieres eliminar este impuesto? Esta acción no se puede deshacer."
      @cancel="confirmDeleteId = null"
      @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
    />
  </div>
</template>
