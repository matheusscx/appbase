<script setup lang="ts">
interface RazonSocial {
  id: string
  nombre: string
  rut: string
  direccion: string | null
  telefono: string | null
  habilitado: boolean
}

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const razones = ref<RazonSocial[]>([])
const loading = ref(false)
const saving = ref(false)
const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)
const toggling = reactive(new Set<string>())

const emptyForm = () => ({
  nombre: '',
  rut: '',
  direccion: '',
  telefono: '',
  habilitado: true,
})
const form = ref(emptyForm())

async function cargar() {
  loading.value = true
  try {
    razones.value = await useApiFetch<RazonSocial[]>(`${apiUrl}/tenants/razones-sociales`)
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al cargar razones sociales', color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function abrirCrear() {
  editingId.value = null
  form.value = emptyForm()
  modalOpen.value = true
}

function abrirEditar(rs: RazonSocial) {
  editingId.value = rs.id
  form.value = {
    nombre: rs.nombre,
    rut: rs.rut,
    direccion: rs.direccion ?? '',
    telefono: rs.telefono ?? '',
    habilitado: rs.habilitado,
  }
  modalOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const body = {
      nombre: form.value.nombre,
      rut: form.value.rut,
      direccion: form.value.direccion || null,
      telefono: form.value.telefono || null,
      habilitado: form.value.habilitado,
    }
    if (editingId.value) {
      await useApiFetch(`${apiUrl}/tenants/razones-sociales/${editingId.value}`, {
        method: 'PATCH',
        body,
      })
      toast.add({ title: 'Razón social actualizada', color: 'success' })
    }
    else {
      await useApiFetch(`${apiUrl}/tenants/razones-sociales`, {
        method: 'POST',
        body,
      })
      toast.add({ title: 'Razón social creada', color: 'success' })
    }
    modalOpen.value = false
    await cargar()
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al guardar', color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function toggleHabilitado(rs: RazonSocial) {
  if (toggling.has(rs.id)) return
  toggling.add(rs.id)
  const prev = rs.habilitado
  rs.habilitado = !prev
  try {
    await useApiFetch(`${apiUrl}/tenants/razones-sociales/${rs.id}`, {
      method: 'PATCH',
      body: { habilitado: rs.habilitado },
    })
    toast.add({ title: rs.habilitado ? 'Razón social habilitada' : 'Razón social deshabilitada', color: 'success' })
  }
  catch (e: unknown) {
    rs.habilitado = prev
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al actualizar', color: 'error' })
  }
  finally {
    toggling.delete(rs.id)
  }
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/tenants/razones-sociales/${id}`, {
      method: 'DELETE',
    })
    toast.add({ title: 'Razón social eliminada', color: 'success' })
    await cargar()
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al eliminar', color: 'error' })
  }
  finally {
    confirmDeleteId.value = null
    confirmModalOpen.value = false
  }
}

onMounted(cargar)
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold">
          Razones sociales
        </h2>
        <p class="text-sm text-gray-500">
          Datos legales para facturación del tenant.
        </p>
      </div>
      <UButton
        icon="i-heroicons-plus"
        @click="abrirCrear"
      >
        Nueva razón social
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
        v-else-if="!razones.length"
        class="py-8 text-center text-sm text-gray-500"
      >
        No hay razones sociales registradas.
      </div>
      <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
        <li
          v-for="rs in razones"
          :key="rs.id"
          class="flex items-center justify-between py-3"
        >
          <div class="min-w-0">
            <p class="font-medium truncate">
              {{ rs.nombre }}
            </p>
            <p class="text-sm text-gray-500">
              RUT: {{ rs.rut }}
            </p>
            <p
              v-if="rs.direccion"
              class="text-sm text-gray-400 truncate"
            >
              {{ rs.direccion }}
            </p>
          </div>
          <div class="flex items-center gap-4 shrink-0 ml-4">
            <USwitch
              :model-value="rs.habilitado"
              :disabled="toggling.has(rs.id)"
              @update:model-value="toggleHabilitado(rs)"
            />
            <div class="flex gap-2">
              <UButton
                icon="i-heroicons-pencil-square"
                color="neutral"
                variant="ghost"
                @click="abrirEditar(rs)"
              />
              <UButton
                icon="i-heroicons-trash"
                color="error"
                variant="ghost"
                @click="() => { confirmDeleteId = rs.id; confirmModalOpen = true }"
              />
            </div>
          </div>
        </li>
      </ul>
    </UCard>

    <!-- Modal crear/editar -->
    <UModal
      v-model:open="modalOpen"
      :title="editingId ? 'Editar razón social' : 'Nueva razón social'"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField label="Nombre legal" required>
            <UInput v-model="form.nombre" placeholder="Empresa S.A." />
          </UFormField>
          <UFormField label="RUT" required>
            <UInput v-model="form.rut" placeholder="76.123.456-7" />
          </UFormField>
          <UFormField label="Dirección">
            <UInput v-model="form.direccion" placeholder="Av. Ejemplo 123" />
          </UFormField>
          <UFormField label="Teléfono">
            <UInput v-model="form.telefono" placeholder="+56 9 1234 5678" />
          </UFormField>
          <UFormField label="Habilitada">
            <USwitch v-model="form.habilitado" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="modalOpen = false">
            Cancelar
          </UButton>
          <UButton :loading="saving" @click="guardar">
            Guardar
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Modal confirmación eliminar -->
    <UModal
      v-model:open="confirmModalOpen"
      title="Eliminar razón social"
    >
      <template #body>
        <p class="text-sm">
          ¿Estás seguro de que quieres eliminar esta razón social? Esta acción no se puede deshacer.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="confirmModalOpen = false; confirmDeleteId = null">
            Cancelar
          </UButton>
          <UButton
            color="error"
            @click="confirmDeleteId && eliminar(confirmDeleteId)"
          >
            Eliminar
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
