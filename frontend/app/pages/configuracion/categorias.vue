<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Impresora } from '~/composables/useImpresoras'

interface Categoria {
  id: string
  nombre: string
  aplicaA: string
  activo: boolean
  impresoraId: string | null
}

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const categorias = ref<Categoria[]>([])
const impresorasComanda = ref<Impresora[]>([])
const impresorasApi = useImpresoras()

const impresoraOptions = computed(() => [
  { label: 'Sin ruta de comanda', value: null as string | null },
  ...impresorasComanda.value.map(i => ({ label: i.nombre, value: i.id as string | null })),
])
const loading = ref(false)
const saving = ref(false)
const drawerOpen = ref(false)
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
  impresoraId: null as string | null,
})
const form = ref(emptyForm())

const drawerTitle = computed(() =>
  editingId.value ? 'Editar categoría' : 'Nueva categoría',
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

function aplicaALabel(value: string) {
  return aplicaAOptions.find(o => o.value === value)?.label ?? value
}

async function cargar() {
  loading.value = true
  try {
    categorias.value = await useApiFetch<Categoria[]>(`${apiUrl}/categorias`)
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar categorías')
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

function abrirEditar(cat: Categoria) {
  resetDrawer()
  editingId.value = cat.id
  form.value = {
    nombre: cat.nombre,
    aplicaA: cat.aplicaA,
    activo: cat.activo,
    impresoraId: cat.impresoraId,
  }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const body = {
      nombre: form.value.nombre,
      aplicaA: form.value.aplicaA,
      activo: form.value.activo,
      // Enviar el valor crudo: `null` (opción "Sin ruta de comanda") desasigna la
      // impresora; un id la (re)asigna. No usar `?? undefined` — impediría limpiarla.
      impresoraId: form.value.impresoraId,
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
    const msg = apiErrorMsg(e, 'Error al actualizar')
    toast.add({ title: msg, color: 'error' })
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
    const msg = apiErrorMsg(e, 'Error al eliminar')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    confirmDeleteId.value = null
    confirmModalOpen.value = false
  }
}

async function cargarImpresoras() {
  try {
    impresorasComanda.value = await impresorasApi.listar('comanda')
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar impresoras'), color: 'error' })
  }
}

onMounted(() => {
  cargar()
  cargarImpresoras()
})

const columns: TableColumn<Categoria>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'activo', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Categorías"
      description="Clasifica productos y servicios del catálogo."
    >
      <template #actions>
        <UButton
          icon="i-lucide-plus"
          @click="abrirCrear"
        >
          Nueva categoría
        </UButton>
      </template>
    </CrudPageHeader>

    <CrudTable :data="categorias" :columns="columns" :loading="loading">
      <template #nombre-cell="{ row }">
        <CrudListItem
          :title="row.original.nombre"
          :subtitle="`Aplica a: ${aplicaALabel(row.original.aplicaA)}${row.original.impresoraId ? ' · ' + (impresorasComanda.find(i => i.id === row.original.impresoraId)?.nombre ?? '') : ''}`"
        />
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
              @click="() => { confirmDeleteId = row.original.id; confirmModalOpen = true }"
            />
          </div>
        </template>

      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          No hay categorías registradas.
        </div>
      </template>
    </CrudTable>

    <AppDrawer v-model:open="drawerOpen" width="50%">
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>

      <template #body>
        <UForm
          id="categoria-form"
          :state="form"
          class="space-y-4"
          @submit="guardar"
        >
          <UFormField label="Nombre" required>
            <UInput
              v-model="form.nombre"
              placeholder="Bebidas"
              autofocus
            />
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
          <UFormField
            label="Impresora de comanda"
            description="Rutea los ítems de esta categoría a una estación al enviar comanda."
          >
            <USelectMenu
              v-model="form.impresoraId"
              :items="impresoraOptions"
              value-key="value"
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
          type="submit"
          form="categoria-form"
          :loading="saving"
        >
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="confirmModalOpen"
      title="Eliminar categoría"
      message="¿Estás seguro de que quieres eliminar esta categoría? Esta acción no se puede deshacer."
      @cancel="confirmDeleteId = null"
      @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
    />
  </div>
</template>
