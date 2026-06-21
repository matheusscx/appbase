<script setup lang="ts">
interface Rol {
  id: string
  nombre: string
  descripcion: string | null
  esFijo: boolean
}

const config = useRuntimeConfig()
const toast = useToast()

const roles = ref<Rol[]>([])
const loading = ref(false)
const apiUrl = config.public.apiUrl

const modalOpen = ref(false)
const creating = ref(false)
const nuevo = reactive({ nombre: '', descripcion: '' })

async function cargar() {
  loading.value = true
  try {
    roles.value = await useApiFetch<Rol[]>(`${apiUrl}/roles`)
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al cargar roles', color: 'error' })
  }
  finally {
    loading.value = false
  }
}

async function crear() {
  if (!nuevo.nombre.trim()) return
  creating.value = true
  try {
    const rol = await useApiFetch<Rol>(`${apiUrl}/roles`, {
      method: 'POST',
      body: { nombre: nuevo.nombre.trim(), descripcion: nuevo.descripcion.trim() || null },
    })
    modalOpen.value = false
    nuevo.nombre = ''
    nuevo.descripcion = ''
    navigateTo(`/configuracion/roles/${rol.id}`)
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al crear rol', color: 'error' })
  }
  finally {
    creating.value = false
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
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al eliminar rol', color: 'error' })
  }
}

onMounted(cargar)
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold">
          Roles y permisos
        </h2>
        <p class="text-sm text-gray-500">
          Define roles y los permisos que tienen sobre cada módulo.
        </p>
      </div>
      <UButton icon="i-heroicons-plus" @click="modalOpen = true">
        Nuevo rol
      </UButton>
    </div>

    <UCard>
      <div
        v-if="loading"
        class="py-8 text-center text-sm text-gray-500"
      >
        Cargando…
      </div>
      <div
        v-else-if="!roles.length"
        class="py-8 text-center text-sm text-gray-500"
      >
        No hay roles todavía.
      </div>
      <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
        <li
          v-for="rol in roles"
          :key="rol.id"
          class="flex items-center justify-between py-3"
        >
          <div>
            <div class="flex items-center gap-2">
              <span class="font-medium">{{ rol.nombre }}</span>
              <UBadge
                v-if="rol.esFijo"
                color="neutral"
                variant="subtle"
                size="xs"
              >
                Fijo
              </UBadge>
            </div>
            <p class="text-sm text-gray-500">
              {{ rol.descripcion || 'Sin descripción' }}
            </p>
          </div>
          <div class="flex items-center gap-1">
            <UButton
              icon="i-heroicons-pencil-square"
              color="neutral"
              variant="ghost"
              :to="`/configuracion/roles/${rol.id}`"
            />
            <UButton
              icon="i-heroicons-trash"
              color="error"
              variant="ghost"
              :disabled="rol.esFijo"
              @click="eliminar(rol)"
            />
          </div>
        </li>
      </ul>
    </UCard>

    <UModal v-model:open="modalOpen" title="Nuevo rol">
      <template #body>
        <form class="space-y-4" @submit.prevent="crear">
          <UFormField label="Nombre" required>
            <UInput v-model="nuevo.nombre" placeholder="Ej: Cajero" autofocus />
          </UFormField>
          <UFormField label="Descripción">
            <UInput v-model="nuevo.descripcion" placeholder="Opcional" />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              @click="modalOpen = false"
            >
              Cancelar
            </UButton>
            <UButton type="submit" :loading="creating">
              Crear y configurar
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
