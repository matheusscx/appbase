<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Turno } from '~/composables/useTurnos'

// La lectura es abierta (`Salones:Leer`), pero cada escritura pega a un endpoint
// con su propio `@RequiresPermiso`. Turnos NO tiene módulo propio: sus rutas
// piden permisos de **Salones**.
const { puedeCrear, puedeActualizar, puedeEliminar } = usePermisosCrud('Salones')

const toast = useToast()
const turnosApi = useTurnos()

const { verEliminados, restaurar, formatearBorradoPor } = usePapelera('turnos')

const turnos = ref<Turno[]>([])
const loading = ref(false)

// Cola serial, mismo patrón que `configuracion/descuentos.vue` → `cargar()`:
// `watch(verEliminados, cargar)` dispara una llamada por toggle del switch, y
// sin encadenarlas la respuesta que llega segunda pisa `turnos.value` sin
// importar cuál toggle la originó — el listado queda desincronizado del switch.
let cargaEnCurso: Promise<void> | null = null

async function cargar() {
  const previa = cargaEnCurso
  const actual = (async () => {
    await previa
    loading.value = true
    try {
      turnos.value = await turnosApi.listar(verEliminados.value)
    }
    catch (e: unknown) {
      toast.add({ title: apiErrorMsg(e, 'Error al cargar turnos'), color: 'error' })
    }
    finally {
      loading.value = false
    }
  })()
  cargaEnCurso = actual
  await actual
}

watch(verEliminados, cargar)

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
  if (turno.eliminadoEl) return
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
  if (turno.eliminadoEl) return
  toDelete.value = turno
  deleteOpen.value = true
}

async function eliminar() {
  if (!toDelete.value) return
  try {
    const id = toDelete.value.id
    await turnosApi.eliminar(id)
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

// ── Restaurar ────────────────────────────────────────────────────────────────
const confirmRestaurarId = ref<string | null>(null)
const confirmRestaurarModalOpen = ref(false)
const restaurando = ref(false)
// Segundo paso del restaurar, solo cuando el backend contesta 400 de colisión:
// el mensaje que explica cuál nombre está tomado y el nombre libre —editable—
// con el que se reintenta.
const colisionModalOpen = ref(false)
const colisionMensaje = ref('')
const nombrePropuesto = ref('')

function cerrarRestaurar() {
  confirmRestaurarId.value = null
  confirmRestaurarModalOpen.value = false
  colisionModalOpen.value = false
  colisionMensaje.value = ''
  nombrePropuesto.value = ''
}

/**
 * Restaura un turno de la papelera. `nombreNuevo` solo llega en el reintento
 * desde el modal de colisión.
 *
 * El catch NO cierra todo y tira un toast rojo: un 400 de colisión no es un
 * error terminal sino una pregunta —qué nombre querés usar—, así que abre el
 * segundo modal con la sugerencia del backend. Molde:
 * `configuracion/descuentos.vue`.
 */
async function restaurarTurno(id: string, nombreNuevo?: string) {
  // Guard de reentrancia: el modal no se cierra solo al confirmar, así que
  // mientras el POST viaja un segundo click mandaría otro `POST .../restaurar`
  // sobre una fila ya revivida → 404 → toast de ERROR encima de un éxito.
  if (restaurando.value) return
  restaurando.value = true
  try {
    await restaurar(id, nombreNuevo)
    const t = turnos.value.find(x => x.id === id)
    if (t) {
      t.eliminadoEl = null
      t.eliminadoPorNombre = null
      // El backend solo devuelve 2xx si aplicó ESE nombre, así que el patch
      // local no adivina. Reordenar hace falta porque el nombre es el segundo
      // criterio del orden (el primero, `horaInicio`, no cambia acá): entre
      // turnos que empiezan a la misma hora, el renombre los reacomoda.
      if (nombreNuevo) {
        t.nombre = nombreNuevo
        turnos.value = [...turnos.value].sort((a, b) =>
          a.horaInicio.localeCompare(b.horaInicio)
            || a.nombre.localeCompare(b.nombre, 'es'),
        )
      }
    }
    toast.add({ title: 'Turno restaurado', color: 'success' })
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
  restaurarTurno(id, nombre)
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
        <div class="flex items-center gap-4">
          <!-- El toggle solo si puede restaurar: sin `Salones:Eliminar` el
               backend rechaza el restaurar, así que mostrar la papelera sería
               ofrecer una acción que termina en 403. -->
          <div v-if="puedeEliminar" class="flex items-center gap-2">
            <USwitch v-model="verEliminados" aria-label="Ver eliminados" />
            <span class="text-sm text-muted">Ver eliminados</span>
          </div>
          <UButton v-if="puedeCrear" icon="i-lucide-plus" @click="abrirCrear">
            Nuevo turno
          </UButton>
        </div>
      </template>
    </CrudPageHeader>

    <CrudTable :data="turnos" :columns="columns" :loading="loading">
      <template #nombre-cell="{ row }">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <span class="font-medium text-default">{{ row.original.nombre }}</span>
            <UBadge v-if="row.original.eliminadoEl" color="neutral" variant="subtle">
              Eliminado
            </UBadge>
          </div>
          <p v-if="row.original.eliminadoEl" class="text-xs text-muted">
            {{ formatearBorradoPor(row.original) }}
          </p>
        </div>
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
        <div v-else class="flex items-center justify-end gap-1">
          <UButton
            v-if="puedeActualizar"
            icon="i-lucide-square-pen"
            color="neutral"
            variant="ghost"
            title="Editar"
            aria-label="Editar"
            @click="abrirEditar(row.original)"
          />
          <UButton
            v-if="puedeEliminar"
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            title="Eliminar"
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
        <UButton color="neutral" variant="ghost" @click="() => { drawerOpen = false }">
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
      message="Se eliminará el turno. Las sesiones ya registradas conservan su trazabilidad, y podés recuperarlo desde «Ver eliminados»."
      @cancel="toDelete = null"
      @confirm="eliminar"
    />

    <CrudModal
      v-model:open="confirmRestaurarModalOpen"
      title="Restaurar turno"
      message="¿Restaurar este turno? Volverá a aparecer en el listado y podrá usarse de nuevo."
      confirm-label="Restaurar"
      confirm-color="neutral"
      :loading="restaurando"
      @cancel="cerrarRestaurar"
      @confirm="confirmRestaurarId && restaurarTurno(confirmRestaurarId)"
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
