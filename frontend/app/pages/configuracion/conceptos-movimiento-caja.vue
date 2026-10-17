<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

// Admin-only: las escrituras llevan `TenantAdminGuard` en el backend. El menú ya lo
// esconde a los no-admin, y sin guard de ruta la URL escrita a mano abría la tabla
// (la lectura es abierta, la cajera la usa en el drawer) y el 403 llegaba al guardar.
definePageMeta({ middleware: 'admin' })

type TipoConcepto = 'entrada' | 'salida' | 'ambos'

interface Concepto {
  id: string
  nombre: string
  tipo: TipoConcepto
  activo: boolean
  eliminadoEl?: string | null
  eliminadoPorNombre?: string | null
}

const TIPOS = [
  { value: 'ambos', label: 'Entradas y salidas' },
  { value: 'entrada', label: 'Solo entradas' },
  { value: 'salida', label: 'Solo salidas' },
] as const

const config = useRuntimeConfig()
const toast = useToast()
const avisarConDeshacer = useAvisoDeshacer()
const apiUrl = config.public.apiUrl

const { verEliminados, restaurar, formatearBorradoPor } = usePapelera('conceptos-movimiento-caja')

const conceptos = ref<Concepto[]>([])
const loading = ref(false)
/** La lectura falló: la tabla lo dice en vez de mostrar su vacío (auditoría UX 07.3). */
const errorCarga = ref(false)
const saving = ref(false)
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)
const confirmRestaurarId = ref<string | null>(null)
const confirmRestaurarModalOpen = ref(false)
const restaurando = ref(false)
// Segundo paso del restaurar, solo si el backend contesta que el nombre está tomado:
// el mensaje y el nombre libre —editable— con el que se reintenta.
const colisionModalOpen = ref(false)
const colisionMensaje = ref('')
const nombrePropuesto = ref('')
const toggling = reactive(new Set<string>())

const emptyForm = () => ({ nombre: '', tipo: 'ambos' as TipoConcepto, activo: true })
const form = ref(emptyForm())

const drawerTitle = computed(() => (editingId.value ? 'Editar concepto' : 'Nuevo concepto'))
const submitLabel = computed(() => (editingId.value ? 'Guardar' : 'Crear'))

function resetDrawer() {
  editingId.value = null
  form.value = emptyForm()
}

watch(drawerOpen, (open) => {
  if (!open) resetDrawer()
})

function etiquetaTipo(tipo: TipoConcepto) {
  return TIPOS.find(t => t.value === tipo)?.label ?? tipo
}

// Cola serial: `watch(verEliminados, cargar)` dispara una carga por toggle y, sin encadenarlas,
// la respuesta que llega segunda pisa la lista sin importar cuál toggle la originó.
let cargaEnCurso: Promise<void> | null = null

async function cargar() {
  const previa = cargaEnCurso
  const actual = (async () => {
    await previa
    errorCarga.value = false
    loading.value = true
    try {
      const query = verEliminados.value ? '?incluirEliminados=true' : ''
      conceptos.value = await useApiFetch<Concepto[]>(`${apiUrl}/conceptos-movimiento-caja${query}`)
    }
    catch (e: unknown) {
      errorCarga.value = true
      toast.add({ title: apiErrorMsg(e, 'Error al cargar los conceptos'), color: 'error' })
    }
    finally {
      loading.value = false
    }
  })()
  cargaEnCurso = actual
  await actual
}

watch(verEliminados, cargar)

function upsertLocal(saved: Concepto) {
  const idx = conceptos.value.findIndex(c => c.id === saved.id)
  if (idx >= 0) conceptos.value[idx] = saved
  else conceptos.value.push(saved)
  conceptos.value = [...conceptos.value].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
}

function abrirEditar(concepto: Concepto) {
  resetDrawer()
  editingId.value = concepto.id
  form.value = { nombre: concepto.nombre, tipo: concepto.tipo, activo: concepto.activo }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const body = {
      nombre: form.value.nombre.trim(),
      tipo: form.value.tipo,
      activo: form.value.activo,
    }
    const isNew = !editingId.value
    const saved = await useApiFetch<Concepto>(
      isNew ? `${apiUrl}/conceptos-movimiento-caja` : `${apiUrl}/conceptos-movimiento-caja/${editingId.value}`,
      { method: isNew ? 'POST' : 'PATCH', body },
    )
    upsertLocal(saved)
    toast.add({ title: isNew ? 'Concepto creado' : 'Concepto actualizado', color: 'success' })
    drawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function toggleActivo(concepto: Concepto, conDeshacer = true) {
  if (toggling.has(concepto.id)) return
  toggling.add(concepto.id)
  const prev = concepto.activo
  concepto.activo = !prev
  try {
    await useApiFetch(`${apiUrl}/conceptos-movimiento-caja/${concepto.id}`, {
      method: 'PATCH',
      body: { activo: concepto.activo },
    })
    const titulo = concepto.activo ? 'Concepto activado' : 'Concepto desactivado'
    if (conDeshacer) avisarConDeshacer(titulo, () => toggleActivo(concepto, false))
    else toast.add({ title: titulo, color: 'success' })
  }
  catch (e: unknown) {
    concepto.activo = prev
    toast.add({ title: apiErrorMsg(e, 'Error al actualizar'), color: 'error' })
  }
  finally {
    toggling.delete(concepto.id)
  }
}

function pedirEliminar(concepto: Concepto) {
  confirmDeleteId.value = concepto.id
  confirmModalOpen.value = true
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/conceptos-movimiento-caja/${id}`, { method: 'DELETE' })
    // Con la papelera abierta la fila no desaparece: pasa a «eliminada» con su autor y fecha,
    // que el DELETE no devuelve; hace falta recargar.
    if (verEliminados.value) await cargar()
    else conceptos.value = conceptos.value.filter(c => c.id !== id)
    toast.add({ title: 'Concepto eliminado', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al eliminar'), color: 'error' })
  }
  finally {
    confirmDeleteId.value = null
    confirmModalOpen.value = false
  }
}

function cerrarRestaurar() {
  confirmRestaurarId.value = null
  confirmRestaurarModalOpen.value = false
  colisionModalOpen.value = false
  colisionMensaje.value = ''
  nombrePropuesto.value = ''
}

/** `nombreNuevo` solo llega en el reintento desde el modal de colisión. */
async function restaurarConcepto(id: string, nombreNuevo?: string) {
  // El modal no se cierra solo al confirmar: sin este guard, un segundo click manda un segundo
  // POST sobre una fila ya revivida y el 404 sale como error encima de un éxito.
  if (restaurando.value) return
  restaurando.value = true
  try {
    await restaurar(id, nombreNuevo)
    const c = conceptos.value.find(x => x.id === id)
    if (c) {
      c.eliminadoEl = null
      c.eliminadoPorNombre = null
      if (nombreNuevo) c.nombre = nombreNuevo
    }
    conceptos.value = [...conceptos.value].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    toast.add({ title: 'Concepto restaurado', color: 'success' })
    cerrarRestaurar()
  }
  catch (e: unknown) {
    const sugerido = nombreSugeridoDe(e)
    if (sugerido) {
      // Un nombre tomado no es un error terminal sino una pregunta: qué nombre usar.
      colisionMensaje.value = apiErrorMsg(e, 'Ese nombre ya está en uso.')
      nombrePropuesto.value = sugerido
      confirmRestaurarModalOpen.value = false
      colisionModalOpen.value = true
    }
    else {
      toast.add({ title: apiErrorMsg(e, 'Error al restaurar'), color: 'error' })
      cerrarRestaurar()
    }
  }
  finally {
    restaurando.value = false
  }
}

function confirmarColision() {
  const id = confirmRestaurarId.value
  const nombre = nombrePropuesto.value.trim()
  if (!id || !nombre) return
  restaurarConcepto(id, nombre)
}

onMounted(cargar)

const columns: TableColumn<Concepto>[] = [
  { accessorKey: 'nombre', header: 'Concepto' },
  { accessorKey: 'tipo', header: 'Se ofrece en' },
  { id: 'activo', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Conceptos de movimientos"
      description="Atajos para el concepto de las entradas y salidas de caja. Quien registra el movimiento puede tocar uno o escribir otro."
    >
      <template #actions>
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-2">
            <USwitch v-model="verEliminados" aria-label="Ver eliminados" />
            <span class="text-sm text-muted">Ver eliminados</span>
          </div>
          <UButton icon="i-lucide-plus" @click="abrirCrear">
            Nuevo concepto
          </UButton>
        </div>
      </template>
    </CrudPageHeader>

    <CrudTable
      vacio="Aún no tienes conceptos. Crea los que más se repiten, como «Compra de insumos» o «Retiro de efectivo»."
      vacio-accion="Nuevo concepto"
      :data="conceptos"
      :columns="columns"
      :loading="loading"
      :error="errorCarga"
      recurso="los conceptos"
      @vacio-accion="abrirCrear"
      @reintentar="cargar"
    >
      <template #nombre-cell="{ row }">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-medium text-default truncate">{{ row.original.nombre }}</span>
            <UBadge v-if="row.original.eliminadoEl" color="neutral" variant="subtle">
              Eliminado
            </UBadge>
          </div>
          <p v-if="row.original.eliminadoEl" class="text-xs text-muted">
            {{ formatearBorradoPor(row.original) }}
          </p>
        </div>
      </template>

      <template #tipo-cell="{ row }">
        <UBadge :label="etiquetaTipo(row.original.tipo)" color="neutral" variant="subtle" />
      </template>

      <template #activo-cell="{ row }">
        <div class="flex justify-end">
          <USwitch
            :aria-label="`Activo: ${row.original.nombre}`"
            :model-value="row.original.activo"
            :disabled="toggling.has(row.original.id) || !!row.original.eliminadoEl"
            @update:model-value="toggleActivo(row.original)"
          />
        </div>
      </template>

      <template #acciones-cell="{ row }">
        <div v-if="row.original.eliminadoEl" class="flex justify-end">
          <UButton
            icon="i-lucide-rotate-ccw"
            color="neutral"
            variant="ghost"
            class="min-h-11"
            @click="() => { confirmRestaurarId = row.original.id; confirmRestaurarModalOpen = true }"
          >
            Restaurar
          </UButton>
        </div>
        <div v-else class="flex justify-end gap-2">
          <UButton
            :aria-label="`Editar concepto ${row.original.nombre}`"
            icon="i-lucide-square-pen"
            color="neutral"
            variant="ghost"
            title="Editar"
            class="size-11 justify-center"
            @click="abrirEditar(row.original)"
          />
          <UButton
            :aria-label="`Eliminar concepto ${row.original.nombre}`"
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            title="Eliminar"
            class="size-11 justify-center"
            @click="pedirEliminar(row.original)"
          />
        </div>
      </template>
    </CrudTable>

    <AppDrawer v-model:open="drawerOpen" width="md">
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>

      <template #body>
        <UForm id="concepto-movimiento-caja-form" :state="form" class="space-y-4" @submit="guardar">
          <UFormField label="Concepto" required>
            <UInput
              v-model="form.nombre"
              placeholder="Ej: Compra de insumos"
              class="w-full"
              :maxlength="80"
              autofocus
            />
          </UFormField>
          <UFormField label="Se ofrece en" description="Si el movimiento es una entrada, una salida o ambos.">
            <USelect
              v-model="form.tipo"
              :items="[...TIPOS]"
              value-key="value"
              label-key="label"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Activo">
            <USwitch v-model="form.activo" />
          </UFormField>
        </UForm>
      </template>

      <template #actions>
        <UButton color="neutral" variant="ghost" @click="() => { drawerOpen = false }">
          Cancelar
        </UButton>
        <UButton
          type="submit"
          form="concepto-movimiento-caja-form"
          :loading="saving"
          :disabled="!form.nombre.trim()"
        >
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="confirmModalOpen"
      title="Eliminar concepto"
      message="¿Eliminar este concepto? Los movimientos ya registrados no cambian y puedes recuperarlo desde «Ver eliminados»."
      @cancel="confirmDeleteId = null"
      @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
    />

    <CrudModal
      v-model:open="confirmRestaurarModalOpen"
      title="Restaurar concepto"
      message="¿Restaurar este concepto? Volverá a ofrecerse como atajo si está activo."
      confirm-label="Restaurar"
      confirm-color="neutral"
      :loading="restaurando"
      @cancel="cerrarRestaurar"
      @confirm="confirmRestaurarId && restaurarConcepto(confirmRestaurarId)"
    />

    <!-- Segundo paso, solo si el nombre quedó tomado por un concepto vivo: el campo viene
         con el nombre libre que sugiere el servidor y se puede cambiar. -->
    <CrudModal
      v-model:open="colisionModalOpen"
      title="No se puede restaurar con ese nombre"
      :message="colisionMensaje"
      confirm-label="Restaurar"
      confirm-color="neutral"
      :loading="restaurando"
      :confirm-disabled="!nombrePropuesto.trim()"
      @cancel="cerrarRestaurar"
      @confirm="confirmarColision"
    >
      <template #detalle>
        <UFormField label="Restaurar como" class="mt-4">
          <UInput v-model="nombrePropuesto" aria-label="Restaurar como" autofocus />
        </UFormField>
      </template>
    </CrudModal>
  </div>
</template>
