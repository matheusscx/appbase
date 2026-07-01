<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

interface Rol {
  id: string
  nombre: string
}

interface Member {
  usuarioId: string
  nombre: string
  apellido: string
  correo: string
  roles: { rolId: string, nombre: string }[]
}

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const members = ref<Member[]>([])
const roles = ref<Rol[]>([])
const loading = ref(false)

const modalOpen = ref(false)
const saving = ref(false)
const editing = ref<Member | null>(null)
const seleccion = ref<string[]>([])

const roleItems = computed(() =>
  roles.value.map(r => ({ label: r.nombre, value: r.id })),
)

async function cargar() {
  loading.value = true
  try {
    const [mem, rls] = await Promise.all([
      useApiFetch<Member[]>(`${apiUrl}/tenants/members`),
      useApiFetch<Rol[]>(`${apiUrl}/roles`),
    ])
    members.value = mem
    roles.value = rls
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar usuarios')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function abrirEdicion(member: Member) {
  editing.value = member
  seleccion.value = member.roles.map(r => r.rolId)
  modalOpen.value = true
}

async function guardar() {
  if (!editing.value) return
  const member = editing.value
  const actuales = new Set(member.roles.map(r => r.rolId))
  const nuevos = new Set(seleccion.value)
  const agregar = [...nuevos].filter(id => !actuales.has(id))
  const quitar = [...actuales].filter(id => !nuevos.has(id))

  saving.value = true
  try {
    for (const rolId of agregar) {
      await useApiFetch(`${apiUrl}/roles/${rolId}/users`, {
        method: 'POST',
        body: { usuarioId: member.usuarioId },
      })
    }
    for (const rolId of quitar) {
      await useApiFetch(`${apiUrl}/roles/${rolId}/users/${member.usuarioId}`, {
        method: 'DELETE',
      })
    }
    toast.add({ title: 'Roles actualizados', color: 'success' })
    modalOpen.value = false
    await cargar()
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al guardar roles')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    saving.value = false
  }
}

onMounted(cargar)

const columns: TableColumn<Member>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { accessorKey: 'roles', header: 'Roles' },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-semibold text-default">
        Usuarios
      </h2>
      <p class="text-sm text-muted">
        Asigna roles a los usuarios del tenant.
      </p>
    </div>

    <UCard>
      <UTable :data="members" :columns="columns" :loading="loading">
        <template #nombre-cell="{ row }">
          <div class="min-w-0">
            <p class="font-medium truncate">
              {{ row.original.nombre }} {{ row.original.apellido }}
            </p>
            <p class="text-sm text-muted truncate">
              {{ row.original.correo }}
            </p>
          </div>
        </template>

        <template #roles-cell="{ row }">
          <div class="flex flex-wrap gap-1">
            <UBadge
              v-for="rol in row.original.roles"
              :key="rol.rolId"
              color="primary"
              variant="subtle"
              size="xs"
            >
              {{ rol.nombre }}
            </UBadge>
            <span
              v-if="!row.original.roles.length"
              class="text-xs text-muted"
            >
              Sin roles
            </span>
          </div>
        </template>

        <template #acciones-cell="{ row }">
          <div class="flex items-center justify-end">
            <UButton
              icon="i-lucide-square-pen"
              color="neutral"
              variant="ghost"
              @click="abrirEdicion(row.original)"
            />
          </div>
        </template>

        <template #empty>
          <div class="py-8 text-center text-sm text-muted">
            No hay usuarios en este tenant.
          </div>
        </template>
      </UTable>
    </UCard>

    <UModal
      v-model:open="modalOpen"
      :title="editing ? `Roles de ${editing.nombre}` : 'Roles'"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField label="Roles">
            <USelectMenu
              v-model="seleccion"
              :items="roleItems"
              multiple
              value-key="value"
              placeholder="Selecciona roles"
              class="w-full"
            />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              @click="modalOpen = false"
            >
              Cancelar
            </UButton>
            <UButton :loading="saving" @click="guardar">
              Guardar
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
