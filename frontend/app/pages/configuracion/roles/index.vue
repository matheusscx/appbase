<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

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

const drawerOpen = ref(false)
const creating = ref(false)
const nuevo = reactive({ nombre: '', descripcion: '' })

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

async function crear() {
  if (!nuevo.nombre.trim()) return
  creating.value = true
  try {
    const rol = await useApiFetch<Rol>(`${apiUrl}/roles`, {
      method: 'POST',
      body: { nombre: nuevo.nombre.trim(), descripcion: nuevo.descripcion.trim() || null },
    })
    drawerOpen.value = false
    nuevo.nombre = ''
    nuevo.descripcion = ''
    navigateTo(`/configuracion/roles/${rol.id}`)
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al crear rol')
    toast.add({ title: msg, color: 'error' })
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
        <h2 class="text-lg font-semibold">
          Roles y permisos
        </h2>
        <p class="text-sm text-muted">
          Define roles y los permisos que tienen sobre cada módulo.
        </p>
      </div>
      <UButton icon="i-heroicons-plus" @click="drawerOpen = true">
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
              icon="i-heroicons-pencil-square"
              color="neutral"
              variant="ghost"
              :to="`/configuracion/roles/${row.original.id}`"
            />
            <UButton
              icon="i-heroicons-trash"
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

    <AppDrawer v-model:open="drawerOpen" title="Nuevo rol" width="50%">
      <template #body>
        <UForm id="nuevo-rol-form" :state="nuevo" class="space-y-4" @submit="crear">
          <UFormField label="Nombre" required>
            <UInput v-model="nuevo.nombre" placeholder="Ej: Cajero" autofocus />
          </UFormField>
          <UFormField label="Descripción">
            <UInput v-model="nuevo.descripcion" placeholder="Opcional" />
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
          form="nuevo-rol-form"
          :loading="creating"
        >
          Crear y configurar
        </UButton>
      </template>
    </AppDrawer>
  </div>
</template>
