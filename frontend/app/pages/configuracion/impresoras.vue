<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Impresora, RolImpresora, TipoConexionImpresora } from '~/composables/useImpresoras'

const toast = useToast()
const impresorasApi = useImpresoras()

const impresoras = ref<Impresora[]>([])
const loading = ref(false)
const saving = ref(false)
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)

const rolOptions: { label: string, value: RolImpresora }[] = [
  { label: 'Comanda (cocina/barra)', value: 'comanda' },
  { label: 'Boleta / precuenta', value: 'boleta' },
]
const tipoConexionOptions: { label: string, value: TipoConexionImpresora }[] = [
  { label: 'Red (host + puerto)', value: 'red' },
  { label: 'Sistema (cola instalada)', value: 'sistema' },
]

const emptyForm = () => ({
  nombre: '',
  rol: 'comanda' as RolImpresora,
  tipoConexion: 'red' as TipoConexionImpresora,
  host: '',
  puerto: '9100',
  nombreCola: '',
  activo: true,
})
const form = ref(emptyForm())

const drawerTitle = computed(() => editingId.value ? 'Editar impresora' : 'Nueva impresora')
const submitLabel = computed(() => editingId.value ? 'Guardar' : 'Crear')

function resetDrawer() {
  editingId.value = null
  form.value = emptyForm()
}

watch(drawerOpen, (open) => { if (!open) resetDrawer() })

function rolLabel(rol: RolImpresora) {
  return rolOptions.find(o => o.value === rol)?.label ?? rol
}

async function cargar() {
  loading.value = true
  try {
    impresoras.value = await impresorasApi.listar()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar impresoras'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function upsertLocal(saved: Impresora) {
  const idx = impresoras.value.findIndex(i => i.id === saved.id)
  if (idx >= 0) {
    impresoras.value[idx] = { ...impresoras.value[idx], ...saved }
  }
  else {
    impresoras.value.push(saved)
  }
  impresoras.value = [...impresoras.value].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es'),
  )
}

function removeLocal(id: string) {
  impresoras.value = impresoras.value.filter(i => i.id !== id)
}

function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
}

function abrirEditar(imp: Impresora) {
  resetDrawer()
  editingId.value = imp.id
  form.value = {
    nombre: imp.nombre,
    rol: imp.rol,
    tipoConexion: imp.tipoConexion,
    host: imp.host ?? '',
    puerto: imp.puerto ? String(imp.puerto) : '9100',
    nombreCola: imp.nombreCola ?? '',
    activo: imp.activo,
  }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const body = {
      nombre: form.value.nombre,
      rol: form.value.rol,
      tipoConexion: form.value.tipoConexion,
      host: form.value.tipoConexion === 'red' ? form.value.host : undefined,
      puerto: form.value.tipoConexion === 'red' ? Number(form.value.puerto) : undefined,
      nombreCola: form.value.tipoConexion === 'sistema' ? form.value.nombreCola : undefined,
      activo: form.value.activo,
    }
    const isNew = !editingId.value
    const saved = isNew
      ? await impresorasApi.crear(body)
      : await impresorasApi.actualizar(editingId.value!, body)
    upsertLocal(saved)
    toast.add({ title: isNew ? 'Impresora creada' : 'Impresora actualizada', color: 'success' })
    drawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar la impresora'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

// ── Eliminar ────────────────────────────────────────────────────────────────
const deleteOpen = ref(false)
const toDelete = ref<Impresora | null>(null)

function confirmarEliminar(imp: Impresora) {
  toDelete.value = imp
  deleteOpen.value = true
}

async function eliminar() {
  if (!toDelete.value) return
  try {
    const id = toDelete.value.id
    await impresorasApi.eliminar(id)
    removeLocal(id)
    toast.add({ title: 'Impresora eliminada', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al eliminar'), color: 'error' })
  }
  finally {
    deleteOpen.value = false
    toDelete.value = null
  }
}

onMounted(cargar)

const columns: TableColumn<Impresora>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'conexion', header: 'Conexión' },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Impresoras"
      description="Configura las impresoras térmicas para comandas de cocina/barra y para boletas/precuenta."
    >
      <template #actions>
        <UButton icon="i-lucide-plus" @click="abrirCrear">
          Nueva impresora
        </UButton>
      </template>
    </CrudPageHeader>

    <CrudTable :data="impresoras" :columns="columns" :loading="loading">
      <template #nombre-cell="{ row }">
        <CrudListItem :title="row.original.nombre" :subtitle="rolLabel(row.original.rol)" />
      </template>

      <template #conexion-cell="{ row }">
        <span class="text-sm text-muted">
          <template v-if="row.original.tipoConexion === 'red'">
            {{ row.original.host }}:{{ row.original.puerto }}
          </template>
          <template v-else>
            Cola: {{ row.original.nombreCola }}
          </template>
        </span>
      </template>

      <template #acciones-cell="{ row }">
        <div class="flex justify-end gap-1">
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
          No hay impresoras configuradas.
        </div>
      </template>
    </CrudTable>

    <AppDrawer v-model:open="drawerOpen" width="50%">
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>

      <template #body>
        <UForm id="impresora-form" :state="form" class="space-y-4" @submit="guardar">
          <UFormField label="Nombre" required>
            <UInput v-model="form.nombre" placeholder="Cocina" autofocus />
          </UFormField>
          <UFormField label="Rol">
            <USelectMenu v-model="form.rol" :items="rolOptions" value-key="value" />
          </UFormField>
          <UFormField label="Tipo de conexión">
            <USelectMenu v-model="form.tipoConexion" :items="tipoConexionOptions" value-key="value" />
          </UFormField>

          <template v-if="form.tipoConexion === 'red'">
            <UFormField label="Host / IP" required>
              <UInput v-model="form.host" placeholder="192.168.1.50" />
            </UFormField>
            <UFormField label="Puerto" required>
              <UInput v-model="form.puerto" inputmode="decimal" placeholder="9100" />
            </UFormField>
          </template>
          <template v-else>
            <UFormField label="Nombre de la cola" required>
              <UInput v-model="form.nombreCola" placeholder="EPSON_TM_T20" />
            </UFormField>
          </template>

          <UFormField label="Activa">
            <USwitch v-model="form.activo" />
          </UFormField>
        </UForm>
      </template>

      <template #actions>
        <UButton color="neutral" variant="ghost" @click="drawerOpen = false">
          Cancelar
        </UButton>
        <UButton type="submit" form="impresora-form" :loading="saving">
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="deleteOpen"
      title="Eliminar impresora"
      message="¿Estás seguro de que quieres eliminar esta impresora? Las categorías que la usan quedarán sin ruta de comanda."
      @cancel="toDelete = null"
      @confirm="eliminar"
    />
  </div>
</template>
