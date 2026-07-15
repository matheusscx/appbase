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

function upsertLocal(saved: Garzon) {
  const idx = garzones.value.findIndex(g => g.id === saved.id)
  if (idx >= 0) {
    garzones.value[idx] = { ...garzones.value[idx], ...saved }
  }
  else {
    garzones.value.push(saved)
  }
  garzones.value = [...garzones.value].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es'),
  )
}

function removeLocal(id: string) {
  garzones.value = garzones.value.filter(g => g.id !== id)
}

onMounted(cargar)

// ── Crear / editar garzón ──────────────────────────────────────────────────
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const form = ref<{ nombre: string, activo: boolean }>({
  nombre: '',
  activo: true,
})
const saving = ref(false)

const drawerTitle = computed(() =>
  editingId.value ? 'Editar garzón' : 'Nuevo garzón',
)

function abrirCrear() {
  editingId.value = null
  form.value = { nombre: '', activo: true }
  drawerOpen.value = true
}

function abrirEditar(garzon: Garzon) {
  editingId.value = garzon.id
  form.value = { nombre: garzon.nombre, activo: garzon.activo }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    if (editingId.value) {
      const saved = await garzonesApi.actualizar(editingId.value, {
        nombre: form.value.nombre,
        activo: form.value.activo,
      })
      upsertLocal(saved)
      toast.add({ title: 'Garzón actualizado', color: 'success' })
      drawerOpen.value = false
    }
    else {
      const creado = await garzonesApi.crear({
        nombre: form.value.nombre,
        activo: form.value.activo,
      })
      const { pin, ...garzon } = creado
      upsertLocal(garzon)
      drawerOpen.value = false
      // El PIN se genera en el backend y se muestra una sola vez.
      revelarPin(creado.nombre, pin)
    }
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar el garzón'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

// ── Regenerar PIN ──────────────────────────────────────────────────────────
const regenerarOpen = ref(false)
const regenerarTarget = ref<Garzon | null>(null)
const regenerando = ref(false)

function abrirRegenerar(garzon: Garzon) {
  regenerarTarget.value = garzon
  regenerarOpen.value = true
}

async function confirmarRegenerar() {
  if (!regenerarTarget.value) return
  regenerando.value = true
  try {
    const res = await garzonesApi.regenerarPin(regenerarTarget.value.id)
    regenerarOpen.value = false
    revelarPin(res.nombre, res.pin)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al regenerar el PIN'), color: 'error' })
  }
  finally {
    regenerando.value = false
  }
}

// ── Revelado del PIN (una sola vez) ─────────────────────────────────────────
const pinReveladoOpen = ref(false)
const pinRevelado = ref<{ nombre: string, pin: string }>({ nombre: '', pin: '' })

function revelarPin(nombre: string, pin: string) {
  pinRevelado.value = { nombre, pin }
  pinReveladoOpen.value = true
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
    const id = toDelete.value.id
    await garzonesApi.eliminar(id)
    removeLocal(id)
    toast.add({ title: 'Garzón eliminado', color: 'success' })
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
            aria-label="Regenerar PIN"
            @click="abrirRegenerar(row.original)"
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
          <p v-if="!editingId" class="text-sm text-muted">
            Al crear el garzón se generará automáticamente un PIN de 6 dígitos y
            se mostrará una sola vez para que se lo entregues.
          </p>
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

    <!-- Confirmar regeneración de PIN -->
    <CrudModal
      v-model:open="regenerarOpen"
      title="Regenerar PIN"
      :message="regenerarTarget
        ? `Se generará un PIN nuevo para ${regenerarTarget.nombre} y se mostrará una sola vez. El PIN anterior dejará de funcionar de inmediato.`
        : ''"
      confirm-label="Generar nuevo PIN"
      confirm-color="primary"
      :loading="regenerando"
      @cancel="regenerarTarget = null"
      @confirm="confirmarRegenerar"
    />

    <!-- Revelado del PIN (una sola vez) -->
    <UModal
      v-model:open="pinReveladoOpen"
      :title="`PIN de ${pinRevelado.nombre}`"
      :ui="shellUi.modal"
    >
      <template #body>
        <div class="space-y-4">
          <code class="block text-center text-3xl font-semibold tracking-[0.4em] tabular-nums bg-elevated rounded px-3 py-3">{{ pinRevelado.pin }}</code>
          <p class="text-sm text-warning">
            <UIcon name="i-lucide-triangle-alert" class="size-4 align-text-bottom" />
            Guárdalo ahora — <strong>no se volverá a mostrar</strong>. Si se
            pierde, genera uno nuevo.
          </p>
        </div>
      </template>
      <template #footer>
        <AppModalFooter>
          <UButton label="Entendido" @click="pinReveladoOpen = false" />
        </AppModalFooter>
      </template>
    </UModal>

    <CrudModal
      v-model:open="deleteOpen"
      title="Eliminar garzón"
      message="Se eliminará el garzón. Las cuentas ya registradas conservan su trazabilidad."
      @cancel="toDelete = null"
      @confirm="eliminar"
    />
  </div>
</template>
