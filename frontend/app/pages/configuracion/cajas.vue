<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

interface Cajon {
  id: string
  nombre: string
  activo: boolean
}

interface Member {
  usuarioId: string
  nombre: string
  apellido: string | null
}

const runtimeConfig = useRuntimeConfig()
const toast = useToast()
const perms = usePermissionsStore()
const apiUrl = runtimeConfig.public.apiUrl

const cajones = ref<Cajon[]>([])
const loading = ref(false)
const saving = ref(false)
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)
const toggling = reactive(new Set<string>())

const usuariosDrawerOpen = ref(false)
const usuariosCajonId = ref<string | null>(null)
const usuariosCajonNombre = ref('')
const miembros = ref<Member[]>([])
const miembrosCargados = ref(false)
const seleccionados = ref<string[]>([])
const loadingUsuarios = ref(false)
const savingUsuarios = ref(false)

const emptyForm = () => ({ nombre: '', activo: true })
const form = ref(emptyForm())

const drawerTitle = computed(() => (editingId.value ? 'Editar caja' : 'Nueva caja'))
const submitLabel = computed(() => (editingId.value ? 'Guardar' : 'Crear'))

// Gateo de UX (el backend igual enforcea con @RequiresPermiso)
const puedeCrear = computed(() => perms.esAdmin || perms.can('Cajas', 'Crear'))
const puedeActualizar = computed(() => perms.esAdmin || perms.can('Cajas', 'Actualizar'))
const puedeEliminar = computed(() => perms.esAdmin || perms.can('Cajas', 'Eliminar'))

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
    cajones.value = await useApiFetch<Cajon[]>(`${apiUrl}/cajones`)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar cajas'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function upsertLocal(saved: Cajon) {
  const idx = cajones.value.findIndex(c => c.id === saved.id)
  if (idx >= 0) cajones.value[idx] = saved
  else cajones.value.push(saved)
  cajones.value = [...cajones.value].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
}

function abrirEditar(c: Cajon) {
  resetDrawer()
  editingId.value = c.id
  form.value = { nombre: c.nombre, activo: c.activo }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const isNew = !editingId.value
    const body = { nombre: form.value.nombre, activo: form.value.activo }
    const saved = isNew
      ? await useApiFetch<Cajon>(`${apiUrl}/cajones`, { method: 'POST', body: { nombre: body.nombre } })
      : await useApiFetch<Cajon>(`${apiUrl}/cajones/${editingId.value}`, { method: 'PATCH', body })
    upsertLocal(saved)
    toast.add({ title: isNew ? 'Caja creada' : 'Caja actualizada', color: 'success' })
    drawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function toggleActivo(c: Cajon) {
  if (toggling.has(c.id)) return
  toggling.add(c.id)
  const prev = c.activo
  c.activo = !prev
  try {
    await useApiFetch(`${apiUrl}/cajones/${c.id}`, { method: 'PATCH', body: { activo: c.activo } })
    toast.add({ title: c.activo ? 'Caja activada' : 'Caja desactivada', color: 'success' })
  }
  catch (e: unknown) {
    c.activo = prev
    toast.add({ title: apiErrorMsg(e, 'Error al actualizar'), color: 'error' })
  }
  finally {
    toggling.delete(c.id)
  }
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/cajones/${id}`, { method: 'DELETE' })
    cajones.value = cajones.value.filter(c => c.id !== id)
    toast.add({ title: 'Caja eliminada', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al eliminar'), color: 'error' })
  }
  finally {
    confirmDeleteId.value = null
    confirmModalOpen.value = false
  }
}

function toggleSeleccion(usuarioId: string, marcado: boolean) {
  if (marcado) {
    if (!seleccionados.value.includes(usuarioId)) seleccionados.value = [...seleccionados.value, usuarioId]
  }
  else {
    seleccionados.value = seleccionados.value.filter(id => id !== usuarioId)
  }
}

async function abrirUsuarios(c: Cajon) {
  usuariosCajonId.value = c.id
  usuariosCajonNombre.value = c.nombre
  usuariosDrawerOpen.value = true
  loadingUsuarios.value = true
  try {
    const [mem, asignados] = await Promise.all([
      miembrosCargados.value
        ? Promise.resolve(miembros.value)
        : useApiFetch<Member[]>(`${apiUrl}/tenants/members`),
      useApiFetch<string[]>(`${apiUrl}/cajones/${c.id}/usuarios`),
    ])
    miembros.value = mem
    miembrosCargados.value = true
    seleccionados.value = asignados
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar usuarios'), color: 'error' })
    usuariosDrawerOpen.value = false
  }
  finally {
    loadingUsuarios.value = false
  }
}

async function guardarUsuarios() {
  if (!usuariosCajonId.value) return
  savingUsuarios.value = true
  try {
    await useApiFetch(`${apiUrl}/cajones/${usuariosCajonId.value}/usuarios`, {
      method: 'PUT',
      body: { usuarioIds: seleccionados.value },
    })
    toast.add({ title: 'Usuarios actualizados', color: 'success' })
    usuariosDrawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar usuarios'), color: 'error' })
  }
  finally {
    savingUsuarios.value = false
  }
}

onMounted(() => {
  cargar()
})

const columns: TableColumn<Cajon>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'activo', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Cajas"
      description="Cajones físicos del local (Mostrador, Delivery, Barra…)."
    >
      <template #actions>
        <UButton v-if="puedeCrear" icon="i-lucide-plus" @click="abrirCrear">
          Nueva caja
        </UButton>
      </template>
    </CrudPageHeader>

    <CrudTable :data="cajones" :columns="columns" :loading="loading">
      <template #nombre-cell="{ row }">
        <p class="font-medium truncate">
          {{ row.original.nombre }}
        </p>
      </template>

      <template #activo-cell="{ row }">
        <div class="flex justify-end">
          <USwitch
            :model-value="row.original.activo"
            :disabled="toggling.has(row.original.id) || !puedeActualizar"
            @update:model-value="toggleActivo(row.original)"
          />
        </div>
      </template>

      <template #acciones-cell="{ row }">
        <div class="flex justify-end gap-2">
          <UButton
            v-if="puedeActualizar"
            icon="i-lucide-users"
            color="neutral"
            variant="ghost"
            @click="abrirUsuarios(row.original)"
          />
          <UButton
            v-if="puedeActualizar"
            icon="i-lucide-square-pen"
            color="neutral"
            variant="ghost"
            @click="abrirEditar(row.original)"
          />
          <UButton
            v-if="puedeEliminar"
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            @click="() => { confirmDeleteId = row.original.id; confirmModalOpen = true }"
          />
        </div>
      </template>

      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          No hay cajas registradas.
        </div>
      </template>
    </CrudTable>

    <AppDrawer v-model:open="drawerOpen" width="40%">
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>

      <template #body>
        <UForm id="cajon-form" :state="form" class="space-y-4" @submit="guardar">
          <UFormField label="Nombre" required>
            <UInput v-model="form.nombre" placeholder="Mostrador" autofocus />
          </UFormField>

          <UFormField label="Activo">
            <USwitch v-model="form.activo" />
          </UFormField>
        </UForm>
      </template>

      <template #actions>
        <UButton color="neutral" variant="ghost" @click="() => { drawerOpen = false }">
          Cancelar
        </UButton>
        <UButton type="submit" form="cajon-form" :loading="saving">
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>

    <AppDrawer v-model:open="usuariosDrawerOpen" width="40%">
      <template #header>
        <span class="font-semibold text-default">Usuarios habilitados — {{ usuariosCajonNombre }}</span>
      </template>

      <template #body>
        <div v-if="loadingUsuarios" class="py-8 text-center text-sm text-muted">
          Cargando…
        </div>
        <div v-else class="space-y-4">
          <p class="text-sm text-muted">
            Marcá quién puede abrir esta caja. Si no seleccionás a nadie, cualquiera con permiso de caja puede abrirla.
          </p>
          <div v-if="miembros.length === 0" class="text-sm text-muted">
            No hay usuarios en el tenant.
          </div>
          <div v-else class="space-y-2">
            <UCheckbox
              v-for="m in miembros"
              :key="m.usuarioId"
              :model-value="seleccionados.includes(m.usuarioId)"
              :label="`${m.nombre} ${m.apellido ?? ''}`"
              @update:model-value="(v) => toggleSeleccion(m.usuarioId, v === true)"
            />
          </div>
        </div>
      </template>

      <template #actions>
        <UButton color="neutral" variant="ghost" @click="() => { usuariosDrawerOpen = false }">
          Cancelar
        </UButton>
        <UButton :loading="savingUsuarios" @click="guardarUsuarios">
          Guardar
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="confirmModalOpen"
      title="Eliminar caja"
      message="¿Estás seguro de que quieres eliminar esta caja? Esta acción no se puede deshacer."
      @cancel="confirmDeleteId = null"
      @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
    />
  </div>
</template>
