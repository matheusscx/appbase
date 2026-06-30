<script setup lang="ts">
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
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-semibold">
        Usuarios
      </h2>
      <p class="text-sm text-muted">
        Asigna roles a los usuarios del tenant.
      </p>
    </div>

    <UCard>
      <div
        v-if="loading"
        class="py-8 text-center text-sm text-muted"
      >
        Cargando…
      </div>
      <div
        v-else-if="!members.length"
        class="py-8 text-center text-sm text-muted"
      >
        No hay usuarios en este tenant.
      </div>
      <ul v-else class="divide-y divide-border-default">
        <li
          v-for="member in members"
          :key="member.usuarioId"
          class="flex items-center justify-between py-3"
        >
          <div class="min-w-0">
            <p class="font-medium truncate">
              {{ member.nombre }} {{ member.apellido }}
            </p>
            <p class="text-sm text-muted truncate">
              {{ member.correo }}
            </p>
            <div class="flex flex-wrap gap-1 mt-1">
              <UBadge
                v-for="rol in member.roles"
                :key="rol.rolId"
                color="primary"
                variant="subtle"
                size="xs"
              >
                {{ rol.nombre }}
              </UBadge>
              <span
                v-if="!member.roles.length"
                class="text-xs text-muted"
              >
                Sin roles
              </span>
            </div>
          </div>
          <UButton
            icon="i-heroicons-pencil-square"
            color="neutral"
            variant="ghost"
            @click="abrirEdicion(member)"
          />
        </li>
      </ul>
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
