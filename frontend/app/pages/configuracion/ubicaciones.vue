<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

// Pantalla admin-only: sus escrituras van con `TenantAdminGuard` en el
// backend. El menú ya la esconde a los no-admin, pero sin guard de ruta la URL
// escrita a mano la abría igual (la lectura es abierta, así que la tabla
// cargaba) y el 403 llegaba recién al guardar.
definePageMeta({ middleware: 'admin' })

interface Ubicacion {
  id: string
  nombre: string
  tipo: 'local' | 'bodega'
  activo: boolean
  eliminadoEl?: string | null
  eliminadoPorNombre?: string | null
}

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const { verEliminados, restaurar, formatearBorradoPor } = usePapelera('ubicaciones')

const ubicaciones = ref<Ubicacion[]>([])
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

// El local nace sembrado con el tenant y siempre está exactamente una vez:
// se dibuja separado, arriba, y nunca entra a la tabla de bodegas.
const local = computed(() => ubicaciones.value.find(u => u.tipo === 'local'))
const bodegas = computed(() => ubicaciones.value.filter(u => u.tipo === 'bodega'))

const editingEsLocal = computed(() => !!editingId.value && editingId.value === local.value?.id)

const drawerTitle = computed(() => {
  if (editingEsLocal.value) return 'Renombrar local'
  return editingId.value ? 'Editar bodega' : 'Nueva bodega'
})

const submitLabel = computed(() =>
  editingId.value ? 'Guardar' : 'Crear',
)

function resetDrawer() {
  editingId.value = null
  form.value = emptyForm()
}

watch(drawerOpen, (open) => {
  if (!open) resetDrawer()
})

// Cola serial, mismo patrón que `configuracion/motivos-baja.vue` → `cargar()`:
// `watch(verEliminados, cargar)` dispara una llamada por toggle del switch, y
// sin encadenarlas la respuesta que llega segunda pisa `ubicaciones.value` sin
// importar cuál toggle la originó — el listado queda desincronizado del
// switch.
let cargaEnCurso: Promise<void> | null = null

async function cargar() {
  const previa = cargaEnCurso
  const actual = (async () => {
    await previa
    loading.value = true
    try {
      const query = verEliminados.value ? '?incluirEliminados=true' : ''
      ubicaciones.value = await useApiFetch<Ubicacion[]>(`${apiUrl}/ubicaciones${query}`)
    }
    catch (e: unknown) {
      toast.add({ title: apiErrorMsg(e, 'Error al cargar ubicaciones'), color: 'error' })
    }
    finally {
      loading.value = false
    }
  })()
  cargaEnCurso = actual
  await actual
}

watch(verEliminados, cargar)

function upsertLocal(saved: Ubicacion) {
  const idx = ubicaciones.value.findIndex(u => u.id === saved.id)
  if (idx >= 0) {
    ubicaciones.value[idx] = { ...ubicaciones.value[idx], ...saved }
  }
  else {
    ubicaciones.value.push(saved)
  }
}

function removeLocalItem(id: string) {
  ubicaciones.value = ubicaciones.value.filter(u => u.id !== id)
}

function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
}

function abrirEditarLocal() {
  if (!local.value) return
  resetDrawer()
  editingId.value = local.value.id
  form.value = { nombre: local.value.nombre, activo: true }
  drawerOpen.value = true
}

function abrirEditar(bodega: Ubicacion) {
  if (bodega.eliminadoEl) return
  resetDrawer()
  editingId.value = bodega.id
  form.value = {
    nombre: bodega.nombre,
    activo: bodega.activo,
  }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const nombre = form.value.nombre.trim()
    const isNew = !editingId.value
    // El local no manda `activo`: no se desactiva (el backend lo rechaza con
    // 400 si llega `activo: false`), así que el campo ni siquiera se ofrece.
    const body = isNew
      ? { nombre, tipo: 'bodega' as const, activo: form.value.activo }
      : editingEsLocal.value
        ? { nombre }
        : { nombre, activo: form.value.activo }
    const saved = isNew
      ? await useApiFetch<Ubicacion>(`${apiUrl}/ubicaciones`, { method: 'POST', body })
      : await useApiFetch<Ubicacion>(`${apiUrl}/ubicaciones/${editingId.value}`, {
          method: 'PATCH',
          body,
        })
    upsertLocal(saved)
    toast.add({ title: isNew ? 'Bodega creada' : 'Ubicación actualizada', color: 'success' })
    drawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function toggleActivo(bodega: Ubicacion) {
  if (bodega.eliminadoEl || toggling.has(bodega.id)) return
  toggling.add(bodega.id)
  const prev = bodega.activo
  bodega.activo = !prev
  try {
    await useApiFetch(`${apiUrl}/ubicaciones/${bodega.id}`, {
      method: 'PATCH',
      body: { activo: bodega.activo },
    })
    toast.add({
      title: bodega.activo ? 'Bodega activada' : 'Bodega desactivada',
      color: 'success',
    })
  }
  catch (e: unknown) {
    bodega.activo = prev
    toast.add({ title: apiErrorMsg(e, 'Error al actualizar'), color: 'error' })
  }
  finally {
    toggling.delete(bodega.id)
  }
}

function pedirEliminar(bodega: Ubicacion) {
  if (bodega.eliminadoEl) return
  confirmDeleteId.value = bodega.id
  confirmModalOpen.value = true
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/ubicaciones/${id}`, { method: 'DELETE' })
    // Con la papelera abierta la fila no desaparece: pasa a "eliminada" con su
    // autor y fecha. El DELETE no devuelve esos datos —solo llegan en el
    // próximo GET con el flag—, así que acá hace falta recargar en vez del
    // patch local de siempre.
    if (verEliminados.value) {
      await cargar()
    }
    else {
      removeLocalItem(id)
    }
    toast.add({ title: 'Bodega eliminada', color: 'success' })
  }
  catch (e: unknown) {
    // El 400 de "todavía tiene stock" ya nombra el lugar y cuántos productos
    // quedan (viene armado del backend): se muestra tal cual, sin reescribirlo.
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
async function restaurarBodega(id: string, nombreNuevo?: string) {
  // El modal no se cierra solo al confirmar (lo cierran las funciones de acá),
  // así que mientras el POST viaja el segundo click manda un segundo
  // `POST .../restaurar` sobre una fila que el primero ya revivió: el backend
  // contesta 404 "no está en la papelera" y el usuario ve un toast de ERROR
  // inmediatamente después de un restore exitoso.
  if (restaurando.value) return
  restaurando.value = true
  try {
    await restaurar(id, nombreNuevo)
    const u = ubicaciones.value.find(x => x.id === id)
    if (u) {
      u.eliminadoEl = null
      u.eliminadoPorNombre = null
      if (nombreNuevo) {
        // El backend solo devuelve 2xx si aplicó ESE nombre, así que el patch
        // local no adivina.
        u.nombre = nombreNuevo
      }
    }
    toast.add({ title: 'Bodega restaurada', color: 'success' })
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
  restaurarBodega(id, nombre)
}

onMounted(cargar)

const columns: TableColumn<Ubicacion>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'activo', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Ubicaciones"
      description="El local desde el que se vende, y las bodegas que solo guardan stock."
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
            Nueva bodega
          </UButton>
        </div>
      </template>
    </CrudPageHeader>

    <div
      v-if="local"
      class="flex items-center justify-between rounded-lg border border-default px-4 py-3"
    >
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-store" class="w-5 h-5 text-muted" />
        <span class="font-medium text-default">{{ local.nombre }}</span>
        <UBadge label="Local" color="primary" variant="subtle" size="xs" />
      </div>
      <UButton
        icon="i-lucide-square-pen"
        color="neutral"
        variant="ghost"
        title="Renombrar"
        @click="abrirEditarLocal"
      />
    </div>

    <CrudTable
      :data="bodegas"
      :columns="columns"
      :loading="loading"
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

      <template #activo-cell="{ row }">
        <div class="flex justify-end">
          <USwitch
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
            @click="abrirEditar(row.original)"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            title="Eliminar"
            @click="pedirEliminar(row.original)"
          />
        </div>
      </template>

      <template #empty>
        <div class="py-8 text-center text-sm text-muted">
          <UIcon
            name="i-lucide-warehouse"
            class="w-8 h-8 mx-auto mb-2 opacity-40"
          />
          No hay bodegas. El local siempre está arriba.
        </div>
      </template>
    </CrudTable>

    <AppDrawer
      v-model:open="drawerOpen"
      width="md"
    >
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>

      <template #body>
        <UForm
          id="ubicacion-form"
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
              placeholder="Ej: Bodega Subsuelo"
              autofocus
            />
          </UFormField>
          <UFormField v-if="!editingEsLocal" label="Activa">
            <USwitch v-model="form.activo" />
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
          type="submit"
          form="ubicacion-form"
          :loading="saving"
        >
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="confirmModalOpen"
      title="Eliminar bodega"
      message="¿Eliminar esta bodega? Podés recuperarla desde «Ver eliminados»."
      @cancel="confirmDeleteId = null"
      @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
    />

    <CrudModal
      v-model:open="confirmRestaurarModalOpen"
      title="Restaurar bodega"
      message="¿Restaurar esta bodega? Volverá a aparecer en el listado y podrá usarse de nuevo."
      confirm-label="Restaurar"
      confirm-color="neutral"
      :loading="restaurando"
      @cancel="cerrarRestaurar"
      @confirm="confirmRestaurarId && restaurarBodega(confirmRestaurarId)"
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
