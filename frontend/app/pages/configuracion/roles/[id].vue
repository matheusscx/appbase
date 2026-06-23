<script setup lang="ts">
interface Rol {
  id: string
  nombre: string
  descripcion: string | null
  esFijo: boolean
}

interface ModuloDisponible {
  moduloTenantId: string
  moduloAppId: string
  nombre: string
  icono: string | null
  permisos: { moduloAppPermisoId: string, permisoNombre: string }[]
}

interface RolPermisoModulo {
  rolId: string
  moduloTenantId: string
  moduloAppPermisoId: string
}

const route = useRoute()
const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl
const rolId = route.params.id as string

const rol = ref<Rol | null>(null)
const modulos = ref<ModuloDisponible[]>([])
const seleccionados = ref<Set<string>>(new Set())
const loading = ref(true)
const savingInfo = ref(false)
const savingPerms = ref(false)

const info = reactive({ nombre: '', descripcion: '' })

async function cargar() {
  loading.value = true
  try {
    const [roles, mods, perms] = await Promise.all([
      useApiFetch<Rol[]>(`${apiUrl}/roles`),
      useApiFetch<ModuloDisponible[]>(`${apiUrl}/roles/modulos-disponibles`),
      useApiFetch<RolPermisoModulo[]>(`${apiUrl}/roles/${rolId}/permissions`),
    ])
    rol.value = roles.find(r => r.id === rolId) ?? null
    if (rol.value) {
      info.nombre = rol.value.nombre
      info.descripcion = rol.value.descripcion ?? ''
    }
    modulos.value = mods
    seleccionados.value = new Set(perms.map(p => p.moduloAppPermisoId))
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar el rol')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function toggle(id: string, value: boolean | 'indeterminate') {
  const next = new Set(seleccionados.value)
  if (value === true) next.add(id)
  else next.delete(id)
  seleccionados.value = next
}

async function guardarInfo() {
  if (!rol.value || rol.value.esFijo) return
  savingInfo.value = true
  try {
    await useApiFetch(`${apiUrl}/roles/${rolId}`, {
      method: 'PATCH',
      body: { nombre: info.nombre.trim(), descripcion: info.descripcion.trim() || null },
    })
    toast.add({ title: 'Rol actualizado', color: 'success' })
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al guardar')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    savingInfo.value = false
  }
}

async function guardarPermisos() {
  savingPerms.value = true
  try {
    for (const modulo of modulos.value) {
      const ids = modulo.permisos
        .map(p => p.moduloAppPermisoId)
        .filter(id => seleccionados.value.has(id))
      await useApiFetch(
        `${apiUrl}/roles/${rolId}/modules/${modulo.moduloTenantId}/permissions`,
        { method: 'PUT', body: { moduloAppPermisoIds: ids } },
      )
    }
    toast.add({ title: 'Permisos guardados', color: 'success' })
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al guardar permisos')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    savingPerms.value = false
  }
}

onMounted(cargar)
</script>

<template>
  <div class="space-y-6">
    <UButton
      icon="i-heroicons-arrow-left"
      color="neutral"
      variant="ghost"
      to="/configuracion/roles"
    >
      Volver a roles
    </UButton>

    <div v-if="loading" class="py-8 text-center text-sm text-gray-500">
      Cargando…
    </div>

    <template v-else-if="rol">
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <span class="font-semibold">Datos del rol</span>
            <UBadge
              v-if="rol.esFijo"
              color="neutral"
              variant="subtle"
              size="xs"
            >
              Fijo
            </UBadge>
          </div>
        </template>

        <form class="space-y-4" @submit.prevent="guardarInfo">
          <UFormField label="Nombre" required>
            <UInput v-model="info.nombre" :disabled="rol.esFijo" />
          </UFormField>
          <UFormField label="Descripción">
            <UInput v-model="info.descripcion" :disabled="rol.esFijo" />
          </UFormField>
          <UButton
            v-if="!rol.esFijo"
            type="submit"
            :loading="savingInfo"
          >
            Guardar datos
          </UButton>
        </form>
      </UCard>

      <UCard>
        <template #header>
          <span class="font-semibold">Permisos por módulo</span>
        </template>

        <div
          v-if="rol.esFijo"
          class="py-4 text-sm text-gray-500"
        >
          El rol Administrador tiene acceso completo a todos los módulos
          contratados; sus permisos no se editan.
        </div>

        <div
          v-else-if="!modulos.length"
          class="py-4 text-sm text-gray-500"
        >
          El tenant no tiene módulos contratados.
        </div>

        <div v-else class="space-y-6">
          <div v-for="modulo in modulos" :key="modulo.moduloTenantId">
            <div class="flex items-center gap-2 mb-2">
              <UIcon
                v-if="modulo.icono"
                :name="modulo.icono"
                class="w-4 h-4"
              />
              <span class="font-medium">{{ modulo.nombre }}</span>
            </div>
            <div class="flex flex-wrap gap-4 pl-1">
              <UCheckbox
                v-for="permiso in modulo.permisos"
                :key="permiso.moduloAppPermisoId"
                :label="permiso.permisoNombre"
                :model-value="seleccionados.has(permiso.moduloAppPermisoId)"
                @update:model-value="(v: boolean | 'indeterminate') => toggle(permiso.moduloAppPermisoId, v)"
              />
            </div>
          </div>

          <UButton :loading="savingPerms" @click="guardarPermisos">
            Guardar permisos
          </UButton>
        </div>
      </UCard>
    </template>

    <div v-else class="py-8 text-center text-sm text-gray-500">
      Rol no encontrado.
    </div>
  </div>
</template>
