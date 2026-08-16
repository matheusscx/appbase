<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { ModuloDisponible } from '~/components/RolPermisosPorModulo.vue'

// Pantalla admin-only: sus escrituras van con `TenantAdminGuard` en el
// backend. El menú ya la esconde a los no-admin, pero sin guard de ruta la URL
// escrita a mano la abría igual (la lectura es abierta, así que la tabla
// cargaba) y el 403 llegaba recién al guardar.
definePageMeta({ middleware: 'admin' })

interface Rol {
  id: string
  nombre: string
  descripcion: string | null
  esFijo: boolean
  /**
   * La definición del rol es de la aplicación. Distinto de `esFijo`: aquel es
   * "admin, acceso total"; éste es "lo puede repartir alguien que no es admin,
   * así que su alcance está fijado por construcción". Hoy solo `Operador de
   * salón`, que un encargado con `Salones:Actualizar` le concede a la cuenta
   * de un garzón.
   */
  esSistema: boolean
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
const esSistema = computed(() => editandoRol.value?.esSistema ?? false)

/**
 * Los dos casos que el backend rechaza al editar, agrupados porque en pantalla
 * se ven igual: los campos van deshabilitados y no hay botón de guardar.
 * Separados quedan solo el **badge** y el **mensaje** — el motivo es distinto y
 * decirlo mal deja al admin buscando un permiso que no existe.
 */
const soloLectura = computed(() => esFijo.value || esSistema.value)

const mensajePermisosBloqueados = computed(() =>
  esSistema.value
    ? 'Este rol lo define la aplicación: alguien que no es administrador puede '
      + 'concedérselo a una cuenta, así que su lista de permisos no se edita. '
      + 'Si necesitás otra combinación, creá un rol propio.'
    : 'El rol Administrador tiene acceso completo a todos los módulos contratados; sus permisos no se editan.',
)

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

function upsertLocal(saved: Rol) {
  const idx = roles.value.findIndex(r => r.id === saved.id)
  if (idx >= 0) {
    roles.value[idx] = { ...roles.value[idx], ...saved }
  }
  else {
    roles.value.push(saved)
  }
  roles.value = [...roles.value].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es'),
  )
}

function removeLocal(id: string) {
  roles.value = roles.value.filter(r => r.id !== id)
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
      upsertLocal(rol)
      toast.add({ title: 'Rol creado', color: 'success' })
    }
    else if (editandoRol.value) {
      // Mismo par que `soloLectura`: sin `esSistema` acá, el PATCH sale igual
      // y come el 400 del backend. Hoy el botón de guardar ni se renderiza en
      // ese caso, pero la condición tiene que decir lo mismo en los dos lados.
      if (!editandoRol.value.esFijo && !editandoRol.value.esSistema) {
        const saved = await useApiFetch<Rol>(`${apiUrl}/roles/${editandoRol.value.id}`, {
          method: 'PATCH',
          body: { nombre: form.nombre.trim(), descripcion: form.descripcion.trim() || null },
        })
        if (modulos.value.length) {
          await guardarPermisos(editandoRol.value.id)
        }
        upsertLocal(saved)
      }
      toast.add({ title: 'Rol actualizado', color: 'success' })
    }
    drawerOpen.value = false
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
  if (rol.esFijo || rol.esSistema) return
  if (!confirm(`¿Eliminar el rol "${rol.nombre}"?`)) return
  try {
    await useApiFetch(`${apiUrl}/roles/${rol.id}`, { method: 'DELETE' })
    removeLocal(rol.id)
    toast.add({ title: 'Rol eliminado', color: 'success' })
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
    <CrudPageHeader
      title="Roles y permisos"
      description="Define roles y los permisos que tienen sobre cada módulo."
    >
      <template #actions>
        <UButton icon="i-lucide-plus" @click="abrirCrear">
          Nuevo rol
        </UButton>
      </template>
    </CrudPageHeader>

    <CrudTable :data="roles" :columns="columns" :loading="loading">
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
            <!-- Rótulo propio y no "Fijo": lo que el admin necesita saber de
                 este rol no es que no lo puede tocar, sino POR QUÉ — alguien
                 que no es admin lo reparte. -->
            <UBadge
              v-else-if="row.original.esSistema"
              color="neutral"
              variant="subtle"
              size="xs"
            >
              De la aplicación
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
              :disabled="row.original.esFijo || row.original.esSistema"
              @click="eliminar(row.original)"
            />
          </div>
        </template>

      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          No hay roles todavía.
        </div>
      </template>
    </CrudTable>

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
          <UBadge
            v-else-if="esSistema"
            color="neutral"
            variant="subtle"
            size="xs"
          >
            De la aplicación
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
                :disabled="soloLectura"
                :autofocus="!soloLectura"
              />
            </UFormField>
            <UFormField label="Descripción">
              <UInput
                v-model="form.descripcion"
                placeholder="Opcional"
                :disabled="soloLectura"
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
              :disabled="soloLectura"
              :disabled-message="mensajePermisosBloqueados"
              @toggle="togglePermiso"
            />
          </div>
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
          v-if="!soloLectura"
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
