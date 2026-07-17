<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Turno } from '~/composables/useTurnos'

const toast = useToast()
const turnosApi = useTurnos()

const turnos = ref<Turno[]>([])
const loading = ref(false)

async function cargar() {
  loading.value = true
  try {
    turnos.value = await turnosApi.listar()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar turnos'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function upsertLocal(saved: Turno) {
  const idx = turnos.value.findIndex(t => t.id === saved.id)
  if (idx >= 0) {
    turnos.value[idx] = { ...turnos.value[idx], ...saved }
  }
  else {
    turnos.value.push(saved)
  }
  turnos.value = [...turnos.value].sort((a, b) =>
    a.horaInicio.localeCompare(b.horaInicio)
      || a.nombre.localeCompare(b.nombre, 'es'),
  )
}

function removeLocal(id: string) {
  turnos.value = turnos.value.filter(t => t.id !== id)
}

onMounted(cargar)

// ── Crear / editar turno ─────────────────────────────────────────────────────
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const form = ref<{
  nombre: string
  horaInicio: string
  horaFin: string
  activo: boolean
}>({
  nombre: '',
  horaInicio: '',
  horaFin: '',
  activo: true,
})
const saving = ref(false)

const drawerTitle = computed(() =>
  editingId.value ? 'Editar turno' : 'Nuevo turno',
)

function abrirCrear() {
  editingId.value = null
  form.value = {
    nombre: '',
    horaInicio: '',
    horaFin: '',
    activo: true,
  }
  drawerOpen.value = true
}

function abrirEditar(turno: Turno) {
  editingId.value = turno.id
  form.value = {
    nombre: turno.nombre,
    horaInicio: turno.horaInicio,
    horaFin: turno.horaFin,
    activo: turno.activo,
  }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const body = {
      nombre: form.value.nombre.trim(),
      horaInicio: form.value.horaInicio.trim(),
      horaFin: form.value.horaFin.trim(),
      activo: form.value.activo,
    }
    if (editingId.value) {
      const saved = await turnosApi.actualizar(editingId.value, body)
      upsertLocal(saved)
      toast.add({ title: 'Turno actualizado', color: 'success' })
    }
    else {
      const saved = await turnosApi.crear(body)
      upsertLocal(saved)
      toast.add({ title: 'Turno creado', color: 'success' })
    }
    drawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar el turno'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

// ── Eliminar ─────────────────────────────────────────────────────────────────
const deleteOpen = ref(false)
const toDelete = ref<Turno | null>(null)

function confirmarEliminar(turno: Turno) {
  toDelete.value = turno
  deleteOpen.value = true
}

async function eliminar() {
  if (!toDelete.value) return
  try {
    const id = toDelete.value.id
    await turnosApi.eliminar(id)
    removeLocal(id)
    toast.add({ title: 'Turno eliminado', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al eliminar el turno'), color: 'error' })
  }
  finally {
    deleteOpen.value = false
    toDelete.value = null
  }
}

const columns: TableColumn<Turno>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { accessorKey: 'horaInicio', header: 'Inicio' },
  { accessorKey: 'horaFin', header: 'Fin' },
  { accessorKey: 'activo', header: 'Estado' },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Turnos"
      description="Define los turnos del local (horario de inicio y fin) para asociarlos a las sesiones de garzón."
    >
      <template #actions>
        <UButton icon="i-lucide-plus" @click="abrirCrear">
          Nuevo turno
        </UButton>
      </template>
    </CrudPageHeader>

    <CrudTable :data="turnos" :columns="columns" :loading="loading">
      <template #nombre-cell="{ row }">
        <span class="font-medium text-default">{{ row.original.nombre }}</span>
      </template>

      <template #horaInicio-cell="{ row }">
        <span class="tabular-nums text-default">{{ row.original.horaInicio }}</span>
      </template>

      <template #horaFin-cell="{ row }">
        <span class="tabular-nums text-default">{{ row.original.horaFin }}</span>
      </template>

      <template #activo-cell="{ row }">
        <UBadge
          :color="row.original.activo ? 'success' : 'neutral'"
          variant="subtle"
          size="xs"
        >
          {{ row.original.activo ? 'Activo' : 'Inactivo' }}
        </UBadge>
      </template>

      <template #acciones-cell="{ row }">
        <div class="flex items-center justify-end gap-1">
          <UButton
            icon="i-lucide-square-pen"
            color="neutral"
            variant="ghost"
            aria-label="Editar"
            @click="abrirEditar(row.original)"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            aria-label="Eliminar"
            @click="confirmarEliminar(row.original)"
          />
        </div>
      </template>

      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          No hay turnos. Crea el primero para empezar.
        </div>
      </template>
    </CrudTable>

    <!-- Drawer crear/editar -->
    <AppDrawer v-model:open="drawerOpen" width="40%">
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>
      <template #body>
        <UForm id="turno-form" :state="form" class="space-y-4" @submit="guardar">
          <UFormField label="Nombre" required>
            <UInput v-model="form.nombre" placeholder="Brunch" autofocus data-qa="turno-nombre" />
          </UFormField>
          <UFormField label="Hora inicio" required>
            <AppTimeInput v-model="form.horaInicio" qa="turno-hora-inicio" />
          </UFormField>
          <UFormField label="Hora fin" required>
            <AppTimeInput v-model="form.horaFin" qa="turno-hora-fin" />
          </UFormField>
          <UFormField label="Activo">
            <USwitch v-model="form.activo" />
          </UFormField>
        </UForm>
      </template>
      <template #actions>
        <UButton color="neutral" variant="ghost" @click="drawerOpen = false">
          Cancelar
        </UButton>
        <UButton type="submit" form="turno-form" :loading="saving">
          {{ editingId ? 'Guardar' : 'Crear' }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="deleteOpen"
      title="Eliminar turno"
      message="Se eliminará el turno. Las sesiones ya registradas conservan su trazabilidad."
      @cancel="toDelete = null"
      @confirm="eliminar"
    />
  </div>
</template>
