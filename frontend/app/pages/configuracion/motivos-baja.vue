<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

// Pantalla admin-only: sus escrituras van con `TenantAdminGuard` en el
// backend. El menú ya la esconde a los no-admin, pero sin guard de ruta la URL
// escrita a mano la abría igual (la lectura es abierta, así que la tabla
// cargaba) y el 403 llegaba recién al guardar.
definePageMeta({ middleware: 'admin' })

type TipoMotivoBaja = 'merma' | 'cortesia' | 'no_elaborado'

interface MotivoBaja {
  id: string
  nombre: string
  activo: boolean
  esFijo: boolean
  tipo: TipoMotivoBaja
  enUso: boolean
  eliminadoEl?: string | null
  eliminadoPorNombre?: string | null
}

// Solo esta pantalla las usa hoy (`CLAUDE.md`, Frontend): si otra pantalla
// necesita las mismas opciones, se extraen a un composable recién ahí.
const TIPO_OPTS: { label: string, value: TipoMotivoBaja }[] = [
  { label: 'Merma', value: 'merma' },
  { label: 'Cortesía', value: 'cortesia' },
  { label: 'No se llegó a hacer', value: 'no_elaborado' },
]

function tipoLabel(tipo: TipoMotivoBaja): string {
  return TIPO_OPTS.find(o => o.value === tipo)?.label ?? tipo
}

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const { verEliminados, restaurar, formatearBorradoPor } = usePapelera('motivos-baja')

const motivos = ref<MotivoBaja[]>([])
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
  tipo: 'merma' as TipoMotivoBaja,
})
const form = ref(emptyForm())

const drawerTitle = computed(() =>
  editingId.value ? 'Editar motivo' : 'Nuevo motivo',
)

const submitLabel = computed(() =>
  editingId.value ? 'Guardar' : 'Crear',
)

const editingEsFijo = computed(() => {
  if (!editingId.value) return false
  return motivos.value.find(c => c.id === editingId.value)?.esFijo ?? false
})

// Cambiar el tipo de un motivo ya usado reescribiría la historia (mismo
// motivo que bloquea el borrado): el backend lo rechaza con 400, esto es
// solo la UX que anticipa esa regla.
const editingEnUso = computed(() => {
  if (!editingId.value) return false
  return motivos.value.find(c => c.id === editingId.value)?.enUso ?? false
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
// sin encadenarlas la respuesta que llega segunda pisa `motivos.value` sin
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
      motivos.value = await useApiFetch<MotivoBaja[]>(`${apiUrl}/motivos-baja${query}`)
    }
    catch (e: unknown) {
      toast.add({ title: apiErrorMsg(e, 'Error al cargar motivos'), color: 'error' })
    }
    finally {
      loading.value = false
    }
  })()
  cargaEnCurso = actual
  await actual
}

watch(verEliminados, cargar)

function upsertLocal(saved: MotivoBaja) {
  const idx = motivos.value.findIndex(c => c.id === saved.id)
  if (idx >= 0) {
    motivos.value[idx] = { ...motivos.value[idx], ...saved }
  }
  else {
    motivos.value.push(saved)
  }
  motivos.value = ordenarFijosPrimero(motivos.value)
}

function removeLocal(id: string) {
  motivos.value = motivos.value.filter(c => c.id !== id)
}

function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
}

function abrirEditar(motivo: MotivoBaja) {
  if (motivo.esFijo || motivo.eliminadoEl) return
  resetDrawer()
  editingId.value = motivo.id
  form.value = {
    nombre: motivo.nombre,
    activo: motivo.activo,
    tipo: motivo.tipo,
  }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const body = {
      nombre: form.value.nombre.trim(),
      activo: form.value.activo,
      tipo: form.value.tipo,
    }
    const isNew = !editingId.value
    const saved = isNew
      ? await useApiFetch<MotivoBaja>(`${apiUrl}/motivos-baja`, { method: 'POST', body })
      : await useApiFetch<MotivoBaja>(`${apiUrl}/motivos-baja/${editingId.value}`, {
          method: 'PATCH',
          body,
        })
    upsertLocal(saved)
    toast.add({ title: isNew ? 'Motivo creado' : 'Motivo actualizado', color: 'success' })
    drawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function toggleActivo(motivo: MotivoBaja) {
  if (motivo.esFijo || motivo.eliminadoEl || toggling.has(motivo.id)) return
  toggling.add(motivo.id)
  const prev = motivo.activo
  motivo.activo = !prev
  try {
    await useApiFetch(`${apiUrl}/motivos-baja/${motivo.id}`, {
      method: 'PATCH',
      body: { activo: motivo.activo },
    })
    toast.add({
      title: motivo.activo ? 'Motivo activado' : 'Motivo desactivado',
      color: 'success',
    })
  }
  catch (e: unknown) {
    motivo.activo = prev
    toast.add({ title: apiErrorMsg(e, 'Error al actualizar'), color: 'error' })
  }
  finally {
    toggling.delete(motivo.id)
  }
}

function pedirEliminar(motivo: MotivoBaja) {
  if (motivo.eliminadoEl) return
  confirmDeleteId.value = motivo.id
  confirmModalOpen.value = true
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/motivos-baja/${id}`, { method: 'DELETE' })
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
    toast.add({ title: 'Motivo eliminado', color: 'success' })
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
async function restaurarMotivo(id: string, nombreNuevo?: string) {
  // El modal no se cierra solo al confirmar (lo cierran las funciones de acá),
  // así que mientras el POST viaja el segundo click manda un segundo
  // `POST .../restaurar` sobre una fila que el primero ya revivió: el backend
  // contesta 404 "no está en la papelera" y el usuario ve un toast de ERROR
  // inmediatamente después de un restore exitoso.
  if (restaurando.value) return
  restaurando.value = true
  try {
    await restaurar(id, nombreNuevo)
    const c = motivos.value.find(x => x.id === id)
    if (c) {
      c.eliminadoEl = null
      c.eliminadoPorNombre = null
      if (nombreNuevo) {
        // El backend solo devuelve 2xx si aplicó ESE nombre, así que el patch
        // local no adivina. Reordenar hace falta porque el listado viene
        // ordenado por nombre y el renombre lo puede mover de lugar.
        c.nombre = nombreNuevo
        motivos.value = ordenarFijosPrimero(motivos.value)
      }
    }
    toast.add({ title: 'Motivo restaurado', color: 'success' })
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
  restaurarMotivo(id, nombre)
}

onMounted(cargar)

const columns: TableColumn<MotivoBaja>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'tipo', header: 'Tipo' },
  { id: 'activo', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Motivos de baja"
      description="Tipifica por qué se da de baja algo. Los motivos fijos del sistema no se editan."
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
            Nuevo motivo
          </UButton>
        </div>
      </template>
    </CrudPageHeader>

    <CrudTable
      :data="motivos"
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

      <template #tipo-cell="{ row }">
        <UBadge
          :label="tipoLabel(row.original.tipo)"
          color="neutral"
          variant="subtle"
          size="sm"
        />
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
          No hay motivos de baja.
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
          id="motivo-baja-form"
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
          <UFormField
            label="Tipo"
            required
            :help="editingEnUso
              ? 'Ya se usó: cambiarle el tipo reescribiría lo que pasó con el stock.'
              : undefined"
          >
            <USelect
              v-model="form.tipo"
              :items="TIPO_OPTS"
              :disabled="editingEsFijo || editingEnUso"
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
          form="motivo-baja-form"
          :loading="saving"
        >
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="confirmModalOpen"
      title="Eliminar motivo"
      message="¿Eliminar este motivo de baja? Podés recuperarlo desde «Ver eliminados»."
      @cancel="confirmDeleteId = null"
      @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
    />

    <CrudModal
      v-model:open="confirmRestaurarModalOpen"
      title="Restaurar motivo"
      message="¿Restaurar este motivo de baja? Volverá a aparecer en el listado y podrá usarse de nuevo."
      confirm-label="Restaurar"
      confirm-color="neutral"
      :loading="restaurando"
      @cancel="cerrarRestaurar"
      @confirm="confirmRestaurarId && restaurarMotivo(confirmRestaurarId)"
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
