<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

// Pantalla admin-only: sus escrituras van con `TenantAdminGuard` en el
// backend. El menú ya la esconde a los no-admin, pero sin guard de ruta la URL
// escrita a mano la abría igual (la lectura es abierta, así que la tabla
// cargaba) y el 403 llegaba recién al guardar.
definePageMeta({ middleware: 'admin' })

interface CausaMerma {
  id: string
  nombre: string
  activo: boolean
  esFijo: boolean
  eliminadoEl?: string | null
  eliminadoPorNombre?: string | null
}

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const { verEliminados, restaurar, formatearBorradoPor } = usePapelera('causas-merma')

const causas = ref<CausaMerma[]>([])
const loading = ref(false)
const saving = ref(false)
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)
const confirmRestaurarId = ref<string | null>(null)
const confirmRestaurarModalOpen = ref(false)
const restaurando = ref(false)
// Segundo paso del restaurar, solo cuando el backend contesta 400 de colisión:
// el mensaje que explica cuál nombre está tomado y el nombre libre —editable—
// con el que se reintenta.
const colisionModalOpen = ref(false)
const colisionMensaje = ref('')
const nombrePropuesto = ref('')
const toggling = reactive(new Set<string>())

const emptyForm = () => ({
  nombre: '',
  activo: true,
})
const form = ref(emptyForm())

const drawerTitle = computed(() =>
  editingId.value ? 'Editar causa' : 'Nueva causa',
)

const submitLabel = computed(() =>
  editingId.value ? 'Guardar' : 'Crear',
)

const editingEsFijo = computed(() => {
  if (!editingId.value) return false
  return causas.value.find(c => c.id === editingId.value)?.esFijo ?? false
})

function resetDrawer() {
  editingId.value = null
  form.value = emptyForm()
}

watch(drawerOpen, (open) => {
  if (!open) resetDrawer()
})

// Cola serial, mismo patrón que `configuracion/descuentos.vue` → `cargar()`:
// `watch(verEliminados, cargar)` dispara una llamada por toggle del switch, y
// sin encadenarlas la respuesta que llega segunda pisa `causas.value` sin
// importar cuál toggle la originó — el listado queda desincronizado del
// switch. Esta pantalla NO usa `usePaginatedList`, así que no hereda la cola
// que vive ahí: va local.
let cargaEnCurso: Promise<void> | null = null

async function cargar() {
  const previa = cargaEnCurso
  const actual = (async () => {
    await previa
    loading.value = true
    try {
      const query = verEliminados.value ? '?incluirEliminados=true' : ''
      causas.value = await useApiFetch<CausaMerma[]>(`${apiUrl}/causas-merma${query}`)
    }
    catch (e: unknown) {
      toast.add({ title: apiErrorMsg(e, 'Error al cargar causas'), color: 'error' })
    }
    finally {
      loading.value = false
    }
  })()
  cargaEnCurso = actual
  await actual
}

watch(verEliminados, cargar)

function upsertLocal(saved: CausaMerma) {
  const idx = causas.value.findIndex(c => c.id === saved.id)
  if (idx >= 0) {
    causas.value[idx] = { ...causas.value[idx], ...saved }
  }
  else {
    causas.value.push(saved)
  }
  causas.value = ordenarFijosPrimero(causas.value)
}

function removeLocal(id: string) {
  causas.value = causas.value.filter(c => c.id !== id)
}

function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
}

function abrirEditar(causa: CausaMerma) {
  if (causa.esFijo || causa.eliminadoEl) return
  resetDrawer()
  editingId.value = causa.id
  form.value = {
    nombre: causa.nombre,
    activo: causa.activo,
  }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const body = {
      nombre: form.value.nombre.trim(),
      activo: form.value.activo,
    }
    const isNew = !editingId.value
    const saved = isNew
      ? await useApiFetch<CausaMerma>(`${apiUrl}/causas-merma`, { method: 'POST', body })
      : await useApiFetch<CausaMerma>(`${apiUrl}/causas-merma/${editingId.value}`, {
          method: 'PATCH',
          body,
        })
    upsertLocal(saved)
    toast.add({ title: isNew ? 'Causa creada' : 'Causa actualizada', color: 'success' })
    drawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function toggleActivo(causa: CausaMerma) {
  if (causa.esFijo || causa.eliminadoEl || toggling.has(causa.id)) return
  toggling.add(causa.id)
  const prev = causa.activo
  causa.activo = !prev
  try {
    await useApiFetch(`${apiUrl}/causas-merma/${causa.id}`, {
      method: 'PATCH',
      body: { activo: causa.activo },
    })
    toast.add({
      title: causa.activo ? 'Causa activada' : 'Causa desactivada',
      color: 'success',
    })
  }
  catch (e: unknown) {
    causa.activo = prev
    toast.add({ title: apiErrorMsg(e, 'Error al actualizar'), color: 'error' })
  }
  finally {
    toggling.delete(causa.id)
  }
}

function pedirEliminar(causa: CausaMerma) {
  if (causa.eliminadoEl) return
  confirmDeleteId.value = causa.id
  confirmModalOpen.value = true
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/causas-merma/${id}`, { method: 'DELETE' })
    // Con la papelera abierta la fila no desaparece: pasa a "eliminada" con su
    // autor y fecha. El DELETE no devuelve esos datos —solo llegan en el
    // próximo GET con el flag—, así que acá hace falta recargar en vez del
    // patch local de siempre.
    if (verEliminados.value) {
      await cargar()
    }
    else {
      removeLocal(id)
    }
    toast.add({ title: 'Causa eliminada', color: 'success' })
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

/**
 * Restaura una fila de la papelera. `nombreNuevo` solo llega en el reintento
 * desde el modal de colisión.
 *
 * A diferencia de un catch genérico, NO cierra todo y tira un toast rojo: un
 * 400 de colisión no es un error terminal sino una pregunta —qué nombre
 * querés usar—, así que abre el segundo modal con la sugerencia del backend.
 * Solo los errores de verdad (404 "no está en la papelera", red) terminan en
 * toast.
 */
async function restaurarCausa(id: string, nombreNuevo?: string) {
  // El modal no se cierra solo al confirmar (lo cierran las funciones de acá),
  // así que mientras el POST viaja el segundo click manda un segundo
  // `POST .../restaurar` sobre una fila que el primero ya revivió: el backend
  // contesta 404 "no está en la papelera" y el usuario ve un toast de ERROR
  // inmediatamente después de un restore exitoso.
  if (restaurando.value) return
  restaurando.value = true
  try {
    await restaurar(id, nombreNuevo)
    const c = causas.value.find(x => x.id === id)
    if (c) {
      c.eliminadoEl = null
      c.eliminadoPorNombre = null
      if (nombreNuevo) {
        // El backend solo devuelve 2xx si aplicó ESE nombre, así que el patch
        // local no adivina. Reordenar hace falta porque el listado viene
        // ordenado por nombre y el renombre lo puede mover de lugar.
        c.nombre = nombreNuevo
        causas.value = ordenarFijosPrimero(causas.value)
      }
    }
    toast.add({ title: 'Causa restaurada', color: 'success' })
    cerrarRestaurar()
  }
  catch (e: unknown) {
    const sugerido = nombreSugeridoDe(e)
    if (sugerido) {
      // Se reabre con la sugerencia NUEVA: si el usuario editó a un nombre que
      // también estaba tomado, el backend ya calculó el siguiente libre.
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
  restaurarCausa(id, nombre)
}

onMounted(cargar)

const columns: TableColumn<CausaMerma>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'activo', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Causas de merma"
      description="Tipifica por qué se descarta stock. Las causas fijas del sistema no se editan."
    >
      <template #actions>
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-2">
            <USwitch v-model="verEliminados" aria-label="Ver eliminados" />
            <span class="text-sm text-muted">Ver eliminados</span>
          </div>
          <UButton
            icon="i-lucide-plus"
            @click="abrirCrear"
          >
            Nueva causa
          </UButton>
        </div>
      </template>
    </CrudPageHeader>

    <CrudTable
      :data="causas"
      :columns="columns"
      :loading="loading"
    >
      <template #nombre-cell="{ row }">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-medium text-default truncate">{{ row.original.nombre }}</span>
            <UBadge
              v-if="row.original.esFijo"
              label="Fija"
              color="neutral"
              variant="subtle"
              size="xs"
            />
            <UBadge v-if="row.original.eliminadoEl" color="neutral" variant="subtle">
              Eliminado
            </UBadge>
          </div>
          <p v-if="row.original.eliminadoEl" class="text-xs text-muted">
            {{ formatearBorradoPor(row.original) }}
          </p>
        </div>
      </template>

      <template #activo-cell="{ row }">
        <div class="flex justify-end">
          <USwitch
            :model-value="row.original.activo"
            :disabled="row.original.esFijo || toggling.has(row.original.id) || !!row.original.eliminadoEl"
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
            @click="() => { confirmRestaurarId = row.original.id; confirmRestaurarModalOpen = true }"
          >
            Restaurar
          </UButton>
        </div>
        <div v-else class="flex justify-end gap-2">
          <UButton
            icon="i-lucide-square-pen"
            color="neutral"
            variant="ghost"
            title="Editar"
            :disabled="row.original.esFijo"
            @click="abrirEditar(row.original)"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            title="Eliminar"
            :disabled="row.original.esFijo"
            @click="pedirEliminar(row.original)"
          />
        </div>
      </template>

      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          <UIcon
            name="i-lucide-tags"
            class="w-8 h-8 mx-auto mb-2 opacity-40"
          />
          No hay causas de merma.
        </div>
      </template>
    </CrudTable>

    <AppDrawer
      v-model:open="drawerOpen"
      width="md"
    >
      <template #header>
        <div class="flex items-center gap-2">
          <span class="font-semibold text-default">{{ drawerTitle }}</span>
          <UBadge
            v-if="editingEsFijo"
            label="Fija"
            color="neutral"
            variant="subtle"
            size="xs"
          />
        </div>
      </template>

      <template #body>
        <UForm
          id="causa-merma-form"
          :state="form"
          class="space-y-4"
          @submit="guardar"
        >
          <UFormField
            label="Nombre"
            required
          >
            <UInput
              v-model="form.nombre"
              placeholder="Ej: Rotura de envase"
              autofocus
              :disabled="editingEsFijo"
            />
          </UFormField>
          <UFormField label="Activa">
            <USwitch
              v-model="form.activo"
              :disabled="editingEsFijo"
            />
          </UFormField>
        </UForm>
      </template>

      <template #actions>
        <UButton
          color="neutral"
          variant="ghost"
          @click="() => { drawerOpen = false }"
        >
          Cancelar
        </UButton>
        <UButton
          v-if="!editingEsFijo"
          type="submit"
          form="causa-merma-form"
          :loading="saving"
        >
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="confirmModalOpen"
      title="Eliminar causa"
      message="¿Eliminar esta causa de merma? Podés recuperarla desde «Ver eliminados»."
      @cancel="confirmDeleteId = null"
      @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
    />

    <CrudModal
      v-model:open="confirmRestaurarModalOpen"
      title="Restaurar causa"
      message="¿Restaurar esta causa de merma? Volverá a aparecer en el listado y podrá usarse de nuevo."
      confirm-label="Restaurar"
      confirm-color="neutral"
      :loading="restaurando"
      @cancel="cerrarRestaurar"
      @confirm="confirmRestaurarId && restaurarCausa(confirmRestaurarId)"
    />

    <!-- Segundo paso, solo si el backend rechazó por nombre tomado. El campo
         viene precargado con la sugerencia pero es editable: el usuario
         confirma o escribe el suyo (decisión del owner). -->
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
          <UInput
            v-model="nombrePropuesto"
            aria-label="Restaurar como"
            autofocus
          />
        </UFormField>
      </template>
    </CrudModal>
  </div>
</template>
