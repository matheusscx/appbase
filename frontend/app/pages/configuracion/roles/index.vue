<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { ModuloDisponible } from '~/components/RolPermisosPorModulo.vue'

interface Rol {
  id: string
  nombre: string
  descripcion: string | null
  esFijo: boolean
}

interface RolPermisoModulo {
  rolId: string
  moduloTenantId: string
  moduloAppPermisoId: string
}

const config = useRuntimeConfig()
const toast = useToast()

const roles = ref<Rol[]>([])
const loading = ref(false)
const apiUrl = config.public.apiUrl

const drawerOpen = ref(false)
const drawerMode = ref<'create' | 'edit'>('create')
const editandoRol = ref<Rol | null>(null)
const saving = ref(false)
const loadingDrawer = ref(false)
const modulos = ref<ModuloDisponible[]>([])
const seleccionados = ref<Set<string>>(new Set())
const form = reactive({ nombre: '', descripcion: '' })

const drawerTitle = computed(() =>
  drawerMode.value === 'create' ? 'Nuevo rol' : 'Editar rol',
)

const esFijo = computed(() => editandoRol.value?.esFijo ?? false)

const submitLabel = computed(() =>
  drawerMode.value === 'create' ? 'Crear' : 'Guardar',
)

function resetDrawer() {
  drawerMode.value = 'create'
  editandoRol.value = null
  form.nombre = ''
  form.descripcion = ''
  seleccionados.value = new Set()
}

function togglePermiso(id: string, value: boolean | 'indeterminate') {
  const next = new Set(seleccionados.value)
  if (value === true) next.add(id)
  else next.delete(id)
  seleccionados.value = next
}

async function cargarModulos() {
  if (modulos.value.length) return
  try {
    modulos.value = await useApiFetch<ModuloDisponible[]>(`${apiUrl}/roles/modulos-disponibles`)
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar módulos')
    toast.add({ title: msg, color: 'error' })
  }
}

async function cargarPermisosRol(rolId: string) {
  const perms = await useApiFetch<RolPermisoModulo[]>(`${apiUrl}/roles/${rolId}/permissions`)
  seleccionados.value = new Set(perms.map(p => p.moduloAppPermisoId))
}

async function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
  loadingDrawer.value = true
  try {
    await cargarModulos()
  }
  finally {
    loadingDrawer.value = false
  }
}

async function abrirEditar(rol: Rol) {
  resetDrawer()
  drawerMode.value = 'edit'
  editandoRol.value = rol
  form.nombre = rol.nombre
  form.descripcion = rol.descripcion ?? ''
  drawerOpen.value = true
  loadingDrawer.value = true
  try {
    await cargarModulos()
    await cargarPermisosRol(rol.id)
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar el rol')
    toast.add({ title: msg, color: 'error' })
    drawerOpen.value = false
    resetDrawer()
  }
  finally {
    loadingDrawer.value = false
  }
}

watch(drawerOpen, (open) => {
  if (!open) resetDrawer()
})

async function guardarPermisos(rolId: string) {
  for (const modulo of modulos.value) {
    const ids = modulo.permisos
      .map(p => p.moduloAppPermisoId)
      .filter(id => seleccionados.value.has(id))
    await useApiFetch(
      `${apiUrl}/roles/${rolId}/modules/${modulo.moduloTenantId}/permissions`,
      { method: 'PUT', body: { moduloAppPermisoIds: ids } },
    )
  }
}

async function cargar() {
  loading.value = true
  try {
    roles.value = await useApiFetch<Rol[]>(`${apiUrl}/roles`)
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar roles')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    loading.value = false
  }
}

async function guardar() {
  if (!form.nombre.trim()) return
  saving.value = true
  try {
    if (drawerMode.value === 'create') {
      const rol = await useApiFetch<Rol>(`${apiUrl}/roles`, {
        method: 'POST',
        body: { nombre: form.nombre.trim(), descripcion: form.descripcion.trim() || null },
      })
      if (modulos.value.length) {
        await guardarPermisos(rol.id)
      }
      toast.add({ title: 'Rol creado', color: 'success' })
    }
    else if (editandoRol.value) {
      if (!editandoRol.value.esFijo) {
        await useApiFetch(`${apiUrl}/roles/${editandoRol.value.id}`, {
          method: 'PATCH',
          body: { nombre: form.nombre.trim(), descripcion: form.descripcion.trim() || null },
        })
        if (modulos.value.length) {
          await guardarPermisos(editandoRol.value.id)
        }
      }
      toast.add({ title: 'Rol actualizado', color: 'success' })
    }
    drawerOpen.value = false
    await cargar()
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(
      e,
      drawerMode.value === 'create' ? 'Error al crear rol' : 'Error al guardar rol',
    )
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function eliminar(rol: Rol) {
  if (rol.esFijo) return
  if (!confirm(`¿Eliminar el rol "${rol.nombre}"?`)) return
  try {
    await useApiFetch(`${apiUrl}/roles/${rol.id}`, { method: 'DELETE' })
    toast.add({ title: 'Rol eliminado', color: 'success' })
    await cargar()
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al eliminar rol')
    toast.add({ title: msg, color: 'error' })
  }
}

onMounted(cargar)

const columns: TableColumn<Rol>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { accessorKey: 'descripcion', header: 'Descripción' },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold text-default">
          Roles y permisos
        </h2>
        <p class="text-sm text-muted">
          Define roles y los permisos que tienen sobre cada módulo.
        </p>
      </div>
      <UButton icon="i-lucide-plus" @click="abrirCrear">
        Nuevo rol
      </UButton>
    </div>

    <UCard>
      <UTable :data="roles" :columns="columns" :loading="loading">
        <template #nombre-cell="{ row }">
          <div class="flex items-center gap-2">
            <span class="font-medium">{{ row.original.nombre }}</span>
            <UBadge
              v-if="row.original.esFijo"
              color="neutral"
              variant="subtle"
              size="xs"
            >
              Fijo
            </UBadge>
          </div>
        </template>

        <template #descripcion-cell="{ row }">
          <span class="text-sm text-muted">{{ row.original.descripcion || 'Sin descripción' }}</span>
        </template>

        <template #acciones-cell="{ row }">
          <div class="flex items-center justify-end gap-1">
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
              @click="eliminar(row.original)"
            />
          </div>
        </template>

        <template #empty>
          <div class="py-8 text-center text-sm text-muted">
            No hay roles todavía.
          </div>
        </template>
      </UTable>
    </UCard>

    <AppDrawer v-model:open="drawerOpen" width="50%">
      <template #header>
        <div class="flex items-center gap-2">
          <span class="font-semibold text-default">{{ drawerTitle }}</span>
          <UBadge
            v-if="esFijo"
            color="neutral"
            variant="subtle"
            size="xs"
          >
            Fijo
          </UBadge>
        </div>
      </template>

      <template #body>
        <div
          v-if="loadingDrawer"
          class="py-8 text-center text-sm text-muted"
        >
          Cargando…
        </div>

        <UForm
          v-else
          id="rol-form"
          :state="form"
          class="space-y-6"
          @submit="guardar"
        >
          <div class="space-y-4">
            <UFormField label="Nombre" required>
              <UInput
                v-model="form.nombre"
                placeholder="Ej: Cajero"
                :disabled="esFijo"
                :autofocus="!esFijo"
              />
            </UFormField>
            <UFormField label="Descripción">
              <UInput
                v-model="form.descripcion"
                placeholder="Opcional"
                :disabled="esFijo"
              />
            </UFormField>
          </div>

          <div class="space-y-4">
            <p class="text-sm font-semibold text-default">
              Permisos por módulo
            </p>
            <RolPermisosPorModulo
              :modulos="modulos"
              :seleccionados="seleccionados"
              :disabled="esFijo"
              disabled-message="El rol Administrador tiene acceso completo a todos los módulos contratados; sus permisos no se editan."
              @toggle="togglePermiso"
            />
          </div>
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
          v-if="!esFijo"
          type="submit"
          form="rol-form"
          :loading="saving"
          :disabled="loadingDrawer"
        >
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>
  </div>
</template>
