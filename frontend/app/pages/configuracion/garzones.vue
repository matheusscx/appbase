<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Garzon } from '~/composables/useGarzones'

const toast = useToast()
const garzonesApi = useGarzones()

const garzones = ref<Garzon[]>([])
const loading = ref(false)

async function cargar() {
  loading.value = true
  try {
    garzones.value = await garzonesApi.listar()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar garzones'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

onMounted(cargar)

// ── Crear / editar garzón ──────────────────────────────────────────────────
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const form = ref<{ nombre: string, pin: string, activo: boolean }>({
  nombre: '',
  pin: '',
  activo: true,
})
const saving = ref(false)

const drawerTitle = computed(() =>
  editingId.value ? 'Editar garzón' : 'Nuevo garzón',
)

function abrirCrear() {
  editingId.value = null
  form.value = { nombre: '', pin: '', activo: true }
  drawerOpen.value = true
}

function abrirEditar(garzon: Garzon) {
  editingId.value = garzon.id
  form.value = { nombre: garzon.nombre, pin: '', activo: garzon.activo }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    if (editingId.value) {
      await garzonesApi.actualizar(editingId.value, {
        nombre: form.value.nombre,
        activo: form.value.activo,
      })
      toast.add({ title: 'Garzón actualizado', color: 'success' })
    }
    else {
      if (!/^\d{6}$/.test(form.value.pin)) {
        toast.add({ title: 'El PIN debe tener 6 dígitos', color: 'error' })
        saving.value = false
        return
      }
      await garzonesApi.crear({
        nombre: form.value.nombre,
        pin: form.value.pin,
        activo: form.value.activo,
      })
      toast.add({ title: 'Garzón creado', color: 'success' })
    }
    drawerOpen.value = false
    await cargar()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar el garzón'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

// ── Resetear PIN ───────────────────────────────────────────────────────────
const pinDrawerOpen = ref(false)
const pinTarget = ref<Garzon | null>(null)
const pinForm = ref({ pin: '' })
const savingPin = ref(false)

function abrirResetPin(garzon: Garzon) {
  pinTarget.value = garzon
  pinForm.value = { pin: '' }
  pinDrawerOpen.value = true
}

async function guardarPin() {
  if (!pinTarget.value) return
  if (!/^\d{6}$/.test(pinForm.value.pin)) {
    toast.add({ title: 'El PIN debe tener 6 dígitos', color: 'error' })
    return
  }
  savingPin.value = true
  try {
    await garzonesApi.resetPin(pinTarget.value.id, pinForm.value.pin)
    toast.add({ title: 'PIN actualizado', color: 'success' })
    pinDrawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al actualizar el PIN'), color: 'error' })
  }
  finally {
    savingPin.value = false
  }
}

// ── Eliminar ───────────────────────────────────────────────────────────────
const deleteOpen = ref(false)
const toDelete = ref<Garzon | null>(null)

function confirmarEliminar(garzon: Garzon) {
  toDelete.value = garzon
  deleteOpen.value = true
}

async function eliminar() {
  if (!toDelete.value) return
  try {
    await garzonesApi.eliminar(toDelete.value.id)
    toast.add({ title: 'Garzón eliminado', color: 'success' })
    await cargar()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al eliminar el garzón'), color: 'error' })
  }
  finally {
    deleteOpen.value = false
    toDelete.value = null
  }
}

const columns: TableColumn<Garzon>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { accessorKey: 'activo', header: 'Estado' },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Garzones"
      description="Registra los garzones del local con un PIN de 6 dígitos para identificarlos al abrir y cerrar cuentas en dispositivos compartidos."
    >
      <template #actions>
        <UButton icon="i-lucide-plus" @click="abrirCrear">
          Nuevo garzón
        </UButton>
      </template>
    </CrudPageHeader>

    <CrudTable :data="garzones" :columns="columns" :loading="loading">
      <template #nombre-cell="{ row }">
        <span class="font-medium text-default">{{ row.original.nombre }}</span>
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
            icon="i-lucide-key-round"
            color="neutral"
            variant="ghost"
            aria-label="Resetear PIN"
            @click="abrirResetPin(row.original)"
          />
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
          No hay garzones. Crea el primero para empezar.
        </div>
      </template>
    </CrudTable>

    <!-- Drawer crear/editar -->
    <AppDrawer v-model:open="drawerOpen" width="40%">
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>
      <template #body>
        <UForm id="garzon-form" :state="form" class="space-y-4" @submit="guardar">
          <UFormField label="Nombre" required>
            <UInput v-model="form.nombre" placeholder="Ana Torres" autofocus />
          </UFormField>
          <UFormField
            v-if="!editingId"
            label="PIN (6 dígitos)"
            required
            help="El garzón usará este PIN para identificarse. Se guarda cifrado."
          >
            <UInput
              v-model="form.pin"
              type="password"
              inputmode="numeric"
              maxlength="6"
              placeholder="••••••"
            />
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
        <UButton type="submit" form="garzon-form" :loading="saving">
          {{ editingId ? 'Guardar' : 'Crear' }}
        </UButton>
      </template>
    </AppDrawer>

    <!-- Drawer resetear PIN -->
    <AppDrawer v-model:open="pinDrawerOpen" width="40%">
      <template #header>
        <span class="font-semibold text-default">
          Resetear PIN{{ pinTarget ? ` — ${pinTarget.nombre}` : '' }}
        </span>
      </template>
      <template #body>
        <UForm id="pin-form" :state="pinForm" class="space-y-4" @submit="guardarPin">
          <UFormField
            label="Nuevo PIN (6 dígitos)"
            required
            help="Reemplaza el PIN anterior. Comunícaselo al garzón."
          >
            <UInput
              v-model="pinForm.pin"
              type="password"
              inputmode="numeric"
              maxlength="6"
              placeholder="••••••"
              autofocus
            />
          </UFormField>
        </UForm>
      </template>
      <template #actions>
        <UButton color="neutral" variant="ghost" @click="pinDrawerOpen = false">
          Cancelar
        </UButton>
        <UButton type="submit" form="pin-form" :loading="savingPin">
          Guardar PIN
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="deleteOpen"
      title="Eliminar garzón"
      message="Se eliminará el garzón. Las cuentas ya registradas conservan su trazabilidad."
      @cancel="toDelete = null"
      @confirm="eliminar"
    />
  </div>
</template>
