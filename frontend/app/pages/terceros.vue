<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

interface Tercero {
  id: string
  tipo: string
  nombre: string
  rut: string | null
  nombreLegal: string | null
  rutFiscal: string | null
  correo: string | null
  telefono: string | null
  direccion: string | null
  activo: boolean
}

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const terceros = ref<Tercero[]>([])
const loading = ref(false)
const saving = ref(false)
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)
const toggling = reactive(new Set<string>())

const tipoOptions = [
  { label: 'Proveedor', value: 'proveedor' },
  { label: 'Empresa', value: 'empresa' },
  { label: 'Persona natural', value: 'persona_natural' },
]

const emptyForm = () => ({
  tipo: 'proveedor',
  nombre: '',
  rut: '',
  nombreLegal: '',
  rutFiscal: '',
  correo: '',
  telefono: '',
  direccion: '',
  activo: true,
})
const form = ref(emptyForm())

const drawerTitle = computed(() =>
  editingId.value ? 'Editar tercero' : 'Nuevo tercero',
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

function tipoLabel(value: string) {
  return tipoOptions.find(o => o.value === value)?.label ?? value
}

async function cargar() {
  loading.value = true
  try {
    terceros.value = await useApiFetch<Tercero[]>(`${apiUrl}/terceros`)
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar terceros')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function upsertLocal(saved: Tercero) {
  const idx = terceros.value.findIndex(t => t.id === saved.id)
  if (idx >= 0) {
    terceros.value[idx] = { ...terceros.value[idx], ...saved }
  }
  else {
    terceros.value.push(saved)
  }
  terceros.value = [...terceros.value].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es'),
  )
}

function removeLocal(id: string) {
  terceros.value = terceros.value.filter(t => t.id !== id)
}

function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
}

function abrirEditar(tercero: Tercero) {
  resetDrawer()
  editingId.value = tercero.id
  form.value = {
    tipo: tercero.tipo,
    nombre: tercero.nombre,
    rut: tercero.rut ?? '',
    nombreLegal: tercero.nombreLegal ?? '',
    rutFiscal: tercero.rutFiscal ?? '',
    correo: tercero.correo ?? '',
    telefono: tercero.telefono ?? '',
    direccion: tercero.direccion ?? '',
    activo: tercero.activo,
  }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const body = {
      tipo: form.value.tipo,
      nombre: form.value.nombre,
      rut: form.value.rut || undefined,
      nombreLegal: form.value.nombreLegal || undefined,
      rutFiscal: form.value.rutFiscal || undefined,
      correo: form.value.correo || undefined,
      telefono: form.value.telefono || undefined,
      direccion: form.value.direccion || undefined,
      activo: form.value.activo,
    }
    const isNew = !editingId.value
    const saved = isNew
      ? await useApiFetch<Tercero>(`${apiUrl}/terceros`, { method: 'POST', body })
      : await useApiFetch<Tercero>(`${apiUrl}/terceros/${editingId.value}`, {
          method: 'PATCH',
          body,
        })
    upsertLocal(saved)
    toast.add({ title: isNew ? 'Tercero creado' : 'Tercero actualizado', color: 'success' })
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

async function toggleActivo(tercero: Tercero) {
  if (toggling.has(tercero.id)) return
  toggling.add(tercero.id)
  const prev = tercero.activo
  tercero.activo = !prev
  try {
    await useApiFetch(`${apiUrl}/terceros/${tercero.id}`, {
      method: 'PATCH',
      body: { activo: tercero.activo },
    })
    toast.add({ title: tercero.activo ? 'Tercero activado' : 'Tercero desactivado', color: 'success' })
  }
  catch (e: unknown) {
    tercero.activo = prev
    const msg = apiErrorMsg(e, 'Error al actualizar')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    toggling.delete(tercero.id)
  }
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/terceros/${id}`, {
      method: 'DELETE',
    })
    removeLocal(id)
    toast.add({ title: 'Tercero eliminado', color: 'success' })
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

const columns: TableColumn<Tercero>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'contacto', header: 'Contacto' },
  { id: 'activo', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Terceros" />
    </template>

    <template #body>
      <div class="w-full space-y-6">
        <CrudPageHeader
          title="Terceros"
          description="Directorio de proveedores, empresas y personas naturales recurrentes."
        >
          <template #actions>
            <UButton
              icon="i-lucide-plus"
              @click="abrirCrear"
            >
              Nuevo tercero
            </UButton>
          </template>
        </CrudPageHeader>

        <CrudTable :data="terceros" :columns="columns" :loading="loading">
          <template #nombre-cell="{ row }">
            <CrudListItem
              :title="row.original.nombre"
              :subtitle="`${tipoLabel(row.original.tipo)}${row.original.rut ? ' · ' + row.original.rut : ''}`"
            />
          </template>

          <template #contacto-cell="{ row }">
            <div class="text-sm text-muted">
              <p v-if="row.original.correo">{{ row.original.correo }}</p>
              <p v-if="row.original.telefono">{{ row.original.telefono }}</p>
              <p v-if="!row.original.correo && !row.original.telefono">—</p>
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
                @click="() => { confirmDeleteId = row.original.id; confirmModalOpen = true }"
              />
            </div>
          </template>

          <template #empty>
            <div class="py-8 text-center text-sm text-muted">
              No hay terceros registrados.
            </div>
          </template>
        </CrudTable>

        <AppDrawer v-model:open="drawerOpen" width="50%">
          <template #header>
            <span class="font-semibold text-default">{{ drawerTitle }}</span>
          </template>

          <template #body>
            <UForm
              id="tercero-form"
              :state="form"
              class="space-y-4"
              @submit="guardar"
            >
              <UFormField label="Tipo" required>
                <USelectMenu
                  v-model="form.tipo"
                  :items="tipoOptions"
                  value-key="value"
                />
              </UFormField>
              <UFormField label="Nombre" required>
                <UInput
                  v-model="form.nombre"
                  placeholder="Distribuidora Andina"
                  autofocus
                />
              </UFormField>
              <UFormField label="RUT">
                <UInput v-model="form.rut" placeholder="76.123.456-7" />
              </UFormField>
              <UFormField label="Nombre legal (razón social)">
                <UInput v-model="form.nombreLegal" placeholder="Distribuidora Andina SpA" />
              </UFormField>
              <UFormField label="RUT fiscal">
                <UInput v-model="form.rutFiscal" placeholder="76.123.456-7" />
              </UFormField>
              <UFormField label="Correo">
                <UInput v-model="form.correo" type="email" placeholder="contacto@empresa.cl" />
              </UFormField>
              <UFormField label="Teléfono">
                <UInput v-model="form.telefono" placeholder="+56 9 1234 5678" />
              </UFormField>
              <UFormField label="Dirección">
                <UTextarea v-model="form.direccion" :rows="2" />
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
              form="tercero-form"
              :loading="saving"
            >
              {{ submitLabel }}
            </UButton>
          </template>
        </AppDrawer>

        <CrudModal
          v-model:open="confirmModalOpen"
          title="Eliminar tercero"
          message="¿Estás seguro de que quieres eliminar este tercero? Esta acción no se puede deshacer."
          @cancel="confirmDeleteId = null"
          @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
