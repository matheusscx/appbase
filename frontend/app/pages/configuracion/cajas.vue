<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

interface Cajon {
  id: string
  nombre: string
  activo: boolean
  eliminadoEl?: string | null
  eliminadoPorNombre?: string | null
}

interface Member {
  usuarioId: string
  nombre: string
  apellido: string | null
}

const runtimeConfig = useRuntimeConfig()
const toast = useToast()
const perms = usePermissionsStore()
const apiUrl = runtimeConfig.public.apiUrl

const { verEliminados, restaurar, formatearBorradoPor } = usePapelera('cajones')

const cajones = ref<Cajon[]>([])
const loading = ref(false)
const saving = ref(false)
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const confirmModalOpen = ref(false)
const toggling = reactive(new Set<string>())
const arqueoCiego = ref(false)
const savingArqueoCiego = ref(false)
const cajaStore = useCajaStore()
const confirmRestaurarId = ref<string | null>(null)
const confirmRestaurarModalOpen = ref(false)
const restaurando = ref(false)
// Segundo paso del restaurar, solo cuando el backend contesta 400 de colisión:
// el mensaje que explica cuál nombre está tomado y el nombre libre —editable—
// con el que se reintenta. Molde: `configuracion/descuentos.vue`.
const colisionModalOpen = ref(false)
const colisionMensaje = ref('')
const nombrePropuesto = ref('')

const usuariosDrawerOpen = ref(false)
const usuariosCajonId = ref<string | null>(null)
const usuariosCajonNombre = ref('')
const miembros = ref<Member[]>([])
const miembrosCargados = ref(false)
const seleccionados = ref<string[]>([])
const loadingUsuarios = ref(false)
const savingUsuarios = ref(false)

const emptyForm = () => ({ nombre: '', activo: true })
const form = ref(emptyForm())

const drawerTitle = computed(() => (editingId.value ? 'Editar caja' : 'Nueva caja'))
const submitLabel = computed(() => (editingId.value ? 'Guardar' : 'Crear'))

// Gateo de UX (el backend igual enforcea con @RequiresPermiso)
const { puedeCrear, puedeActualizar, puedeEliminar } = usePermisosCrud('Cajas')
// No es un permiso del módulo: el arqueo ciego es del admin del tenant y de nadie más.
const puedeConfigCiego = computed(() => perms.esAdmin)

function resetDrawer() {
  editingId.value = null
  form.value = emptyForm()
}

watch(drawerOpen, (open) => {
  if (!open) resetDrawer()
})

// Cola serial, mismo patrón que `configuracion/descuentos.vue` → `cargar()`:
// `watch(verEliminados, cargar)` dispara una llamada por toggle del switch, y
// sin encadenarlas la respuesta que llega segunda pisa `cajones.value` sin
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
      cajones.value = await useApiFetch<Cajon[]>(`${apiUrl}/cajones${query}`)
    }
    catch (e: unknown) {
      toast.add({ title: apiErrorMsg(e, 'Error al cargar cajas'), color: 'error' })
    }
    finally {
      loading.value = false
    }
  })()
  cargaEnCurso = actual
  await actual
}

watch(verEliminados, cargar)

function upsertLocal(saved: Cajon) {
  const idx = cajones.value.findIndex(c => c.id === saved.id)
  if (idx >= 0) cajones.value[idx] = saved
  else cajones.value.push(saved)
  cajones.value = [...cajones.value].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

function removeLocal(id: string) {
  cajones.value = cajones.value.filter(c => c.id !== id)
}

function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
}

function abrirEditar(c: Cajon) {
  if (c.eliminadoEl) return
  resetDrawer()
  editingId.value = c.id
  form.value = { nombre: c.nombre, activo: c.activo }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    const isNew = !editingId.value
    const body = { nombre: form.value.nombre, activo: form.value.activo }
    const saved = isNew
      ? await useApiFetch<Cajon>(`${apiUrl}/cajones`, { method: 'POST', body: { nombre: body.nombre } })
      : await useApiFetch<Cajon>(`${apiUrl}/cajones/${editingId.value}`, { method: 'PATCH', body })
    upsertLocal(saved)
    toast.add({ title: isNew ? 'Caja creada' : 'Caja actualizada', color: 'success' })
    drawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function toggleActivo(c: Cajon) {
  if (c.eliminadoEl) return
  if (toggling.has(c.id)) return
  toggling.add(c.id)
  const prev = c.activo
  c.activo = !prev
  try {
    await useApiFetch(`${apiUrl}/cajones/${c.id}`, { method: 'PATCH', body: { activo: c.activo } })
    toast.add({ title: c.activo ? 'Caja activada' : 'Caja desactivada', color: 'success' })
  }
  catch (e: unknown) {
    c.activo = prev
    toast.add({ title: apiErrorMsg(e, 'Error al actualizar'), color: 'error' })
  }
  finally {
    toggling.delete(c.id)
  }
}

function pedirEliminar(c: Cajon) {
  if (c.eliminadoEl) return
  confirmDeleteId.value = c.id
  confirmModalOpen.value = true
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/cajones/${id}`, { method: 'DELETE' })
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
    toast.add({ title: 'Caja eliminada', color: 'success' })
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
 * Restaura una caja de la papelera. `nombreNuevo` solo llega en el reintento
 * desde el modal de colisión.
 *
 * El catch NO cierra todo y tira un toast rojo: un 400 de colisión no es un
 * error terminal sino una pregunta —qué nombre querés usar—, así que abre el
 * segundo modal con la sugerencia del backend. Molde: `configuracion/descuentos.vue`.
 */
async function restaurarCajon(id: string, nombreNuevo?: string) {
  // Guard de reentrancia: el modal no se cierra solo al confirmar, así que
  // mientras el POST viaja un segundo click mandaría otro `POST .../restaurar`
  // sobre una fila ya revivida → 404 → toast de ERROR encima de un éxito.
  if (restaurando.value) return
  restaurando.value = true
  try {
    await restaurar(id, nombreNuevo)
    const c = cajones.value.find(x => x.id === id)
    if (c) {
      c.eliminadoEl = null
      c.eliminadoPorNombre = null
      // El backend solo devuelve 2xx si aplicó ESE nombre, así que el patch
      // local no adivina. Reordenar hace falta porque el listado viene
      // ordenado por nombre y el renombre lo puede mover de lugar.
      if (nombreNuevo) {
        c.nombre = nombreNuevo
        cajones.value = [...cajones.value].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      }
    }
    toast.add({ title: 'Caja restaurada', color: 'success' })
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
  restaurarCajon(id, nombre)
}

function toggleSeleccion(usuarioId: string, marcado: boolean) {
  if (marcado) {
    if (!seleccionados.value.includes(usuarioId)) seleccionados.value = [...seleccionados.value, usuarioId]
  }
  else {
    seleccionados.value = seleccionados.value.filter(id => id !== usuarioId)
  }
}

async function abrirUsuarios(c: Cajon) {
  const targetId = c.id
  usuariosCajonId.value = c.id
  usuariosCajonNombre.value = c.nombre
  usuariosDrawerOpen.value = true
  loadingUsuarios.value = true
  try {
    const [mem, asignados] = await Promise.all([
      miembrosCargados.value
        ? Promise.resolve(miembros.value)
        : useApiFetch<Member[]>(`${apiUrl}/tenants/members`),
      useApiFetch<string[]>(`${apiUrl}/cajones/${c.id}/usuarios`),
    ])
    if (usuariosCajonId.value !== targetId) return
    miembros.value = mem
    miembrosCargados.value = true
    seleccionados.value = asignados
  }
  catch (e: unknown) {
    if (usuariosCajonId.value !== targetId) return
    toast.add({ title: apiErrorMsg(e, 'Error al cargar usuarios'), color: 'error' })
    usuariosDrawerOpen.value = false
  }
  finally {
    if (usuariosCajonId.value === targetId) loadingUsuarios.value = false
  }
}

async function guardarUsuarios() {
  if (!usuariosCajonId.value) return
  savingUsuarios.value = true
  try {
    await useApiFetch(`${apiUrl}/cajones/${usuariosCajonId.value}/usuarios`, {
      method: 'PUT',
      body: { usuarioIds: seleccionados.value },
    })
    toast.add({ title: 'Usuarios actualizados', color: 'success' })
    usuariosDrawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar usuarios'), color: 'error' })
  }
  finally {
    savingUsuarios.value = false
  }
}

async function onToggleArqueoCiego(valor: boolean) {
  const prev = arqueoCiego.value
  arqueoCiego.value = valor
  savingArqueoCiego.value = true
  try {
    await cajaStore.guardarArqueoCiego(valor)
    toast.add({ title: valor ? 'Arqueo ciego activado' : 'Arqueo ciego desactivado', color: 'success' })
  }
  catch (e: unknown) {
    arqueoCiego.value = prev
    toast.add({ title: apiErrorMsg(e, 'Error al actualizar arqueo ciego'), color: 'error' })
  }
  finally {
    savingArqueoCiego.value = false
  }
}

onMounted(async () => {
  cargar()
  try {
    arqueoCiego.value = await cajaStore.cargarArqueoCiego()
  }
  catch { /* si no tiene Cajas:Leer, el toggle no se muestra igual */ }
})

const columns: TableColumn<Cajon>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'activo', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Cajas"
      description="Cajones físicos del local (Mostrador, Delivery, Barra…)."
    >
      <template #actions>
        <div class="flex items-center gap-4">
          <!-- El toggle solo si puede restaurar: sin `Cajas:Eliminar` el
               backend rechaza el restaurar, así que mostrar la papelera sería
               ofrecer una acción que termina en 403. -->
          <div v-if="puedeEliminar" class="flex items-center gap-2">
            <USwitch v-model="verEliminados" aria-label="Ver eliminados" />
            <span class="text-sm text-muted">Ver eliminados</span>
          </div>
          <UButton v-if="puedeCrear" icon="i-lucide-plus" @click="abrirCrear">
            Nueva caja
          </UButton>
        </div>
      </template>
    </CrudPageHeader>

    <CrudTable :data="cajones" :columns="columns" :loading="loading">
      <template #nombre-cell="{ row }">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <p class="font-medium truncate">
              {{ row.original.nombre }}
            </p>
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
            :disabled="toggling.has(row.original.id) || !puedeActualizar || !!row.original.eliminadoEl"
            @update:model-value="toggleActivo(row.original)"
          />
        </div>
      </template>

      <template #acciones-cell="{ row }">
        <div v-if="row.original.eliminadoEl" class="flex justify-end">
          <UButton
            v-if="puedeEliminar"
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
            v-if="puedeActualizar"
            icon="i-lucide-users"
            color="neutral"
            variant="ghost"
            title="Usuarios"
            @click="abrirUsuarios(row.original)"
          />
          <UButton
            v-if="puedeActualizar"
            icon="i-lucide-square-pen"
            color="neutral"
            variant="ghost"
            title="Editar"
            @click="abrirEditar(row.original)"
          />
          <UButton
            v-if="puedeEliminar"
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
          No hay cajas registradas.
        </div>
      </template>
    </CrudTable>

    <UCard>
      <template #header>
        <h3 class="text-sm font-semibold text-default">
          Política de cierre
        </h3>
      </template>
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-sm font-medium text-default">
            Arqueo ciego
          </p>
          <p class="text-sm text-muted">
            El cajero cuenta el cajón sin ver el monto esperado; el sistema revela la diferencia al cerrar.
          </p>
        </div>
        <USwitch
          :model-value="arqueoCiego"
          :disabled="savingArqueoCiego || !puedeConfigCiego"
          @update:model-value="onToggleArqueoCiego"
        />
      </div>
    </UCard>

    <AppDrawer v-model:open="drawerOpen" width="40%">
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>

      <template #body>
        <UForm id="cajon-form" :state="form" class="space-y-4" @submit="guardar">
          <UFormField label="Nombre" required>
            <UInput v-model="form.nombre" placeholder="Mostrador" autofocus />
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
        <UButton type="submit" form="cajon-form" :loading="saving">
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>

    <AppDrawer v-model:open="usuariosDrawerOpen" width="40%">
      <template #header>
        <span class="font-semibold text-default">Usuarios habilitados — {{ usuariosCajonNombre }}</span>
      </template>

      <template #body>
        <div v-if="loadingUsuarios" class="py-8 text-center text-sm text-muted">
          Cargando…
        </div>
        <div v-else class="space-y-4">
          <p class="text-sm text-muted">
            Marcá quién puede abrir esta caja. Si no seleccionás a nadie, cualquiera con permiso de caja puede abrirla.
          </p>
          <div v-if="miembros.length === 0" class="text-sm text-muted">
            No hay usuarios en el tenant.
          </div>
          <div v-else class="space-y-2">
            <UCheckbox
              v-for="m in miembros"
              :key="m.usuarioId"
              :model-value="seleccionados.includes(m.usuarioId)"
              :label="`${m.nombre} ${m.apellido ?? ''}`"
              @update:model-value="(v) => toggleSeleccion(m.usuarioId, v === true)"
            />
          </div>
        </div>
      </template>

      <template #actions>
        <UButton color="neutral" variant="ghost" @click="() => { usuariosDrawerOpen = false }">
          Cancelar
        </UButton>
        <UButton :loading="savingUsuarios" @click="guardarUsuarios">
          Guardar
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="confirmModalOpen"
      title="Eliminar caja"
      message="¿Eliminar esta caja? Podés recuperarla desde «Ver eliminados»."
      @cancel="confirmDeleteId = null"
      @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
    />

    <CrudModal
      v-model:open="confirmRestaurarModalOpen"
      title="Restaurar caja"
      message="¿Restaurar esta caja? Volverá a aparecer en el listado y podrá usarse de nuevo."
      confirm-label="Restaurar"
      confirm-color="neutral"
      :loading="restaurando"
      @cancel="cerrarRestaurar"
      @confirm="confirmRestaurarId && restaurarCajon(confirmRestaurarId)"
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
