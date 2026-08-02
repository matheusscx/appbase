<script setup lang="ts">
import type { SalonConMesas, MesaResumen, FormaMesa, TamanoMesa } from '~/composables/useSalones'
import { FORMA_MESA_OPTIONS, TAMANO_MESA_OPTIONS } from '~/composables/useSalones'

// La lectura es abierta (`Salones:Leer`), pero cada escritura pega a un endpoint
// con su propio `@RequiresPermiso`. Salón y mesa comparten los tres permisos del
// módulo. `Salones:Operar` no entra acá: es de la operación (cuentas, comandas),
// no de esta pantalla de configuración.
const { puedeCrear, puedeActualizar, puedeEliminar } = usePermisosCrud('Salones')

const toast = useToast()
const salonesApi = useSalones()

// Dos recursos, dos endpoints de restaurar (`docs/features/papelera.md`):
// `POST /salones/:id/restaurar` vive en `SalonesController`, `POST
// /mesas/:id/restaurar` en `MesasController` — son clases distintas del mismo
// archivo backend. Confundirlos manda el POST equivocado. Ninguno de los dos
// tiene unicidad de nombre, así que a diferencia de `turnos`/`descuentos` acá
// NO hay modal de colisión: un error al restaurar es siempre terminal (toast).
const { verEliminados, restaurar: restaurarSalonApi, formatearBorradoPor } = usePapelera('salones')
const { restaurar: restaurarMesaApi } = usePapelera('mesas')

const salones = ref<SalonConMesas[]>([])
const loading = ref(false)
const selectedSalonId = ref<string | undefined>(undefined)

// Copia local editable de las mesas VIVAS del salón seleccionado (posiciones
// drag). Las mesas eliminadas quedan afuera a propósito: el plano es para
// operar (arrastrar, doble-click para editar), no para auditar — decisión
// tomada acá, no un recorte del backend. Se listan aparte, más abajo.
const localMesas = ref<MesaResumen[]>([])
const savingLayout = ref(false)

const selectedSalon = computed(() =>
  salones.value.find(s => s.id === selectedSalonId.value) ?? null,
)

const salonItems = computed(() =>
  salones.value.map(s => ({
    label: s.eliminadoEl ? `${s.nombre} (Eliminado)` : s.nombre,
    value: s.id,
  })),
)

/** Mesas eliminadas del salón seleccionado: huérfanas de un borrado individual
 * de mesa, o colaterales del borrado del salón (mismo `eliminadoEl` que él).
 * Se listan y restauran una por una — no hay forma de saber desde acá cuáles
 * volverían solas si se restaura el salón sin reimplementar en el frontend la
 * comparación de timestamps que ya vive en el backend. */
const mesasEliminadas = computed(() =>
  (selectedSalon.value?.mesas ?? []).filter(m => m.eliminadoEl),
)

function syncLocalMesas() {
  localMesas.value = (selectedSalon.value?.mesas ?? [])
    .filter(m => !m.eliminadoEl)
    .map(m => ({ ...m }))
}

function patchSalonMesas(salonId: string, mesasVivas: MesaResumen[]) {
  const salon = salones.value.find(s => s.id === salonId)
  if (!salon) return
  // `mesasVivas` viene de `localMesas`, que ya excluye las eliminadas: si se
  // pisara `salon.mesas` entero se perderían del estado local hasta el
  // próximo `cargar()`.
  const eliminadas = salon.mesas.filter(m => m.eliminadoEl)
  salon.mesas = [...mesasVivas.map(m => ({ ...m })), ...eliminadas]
  if (selectedSalonId.value === salonId) syncLocalMesas()
}

// Cola serial, mismo patrón que `configuracion/descuentos.vue` → `cargar()`:
// `watch(verEliminados, cargar)` dispara una llamada por toggle del switch, y
// sin encadenarlas la respuesta que llega segunda pisa `salones.value` sin
// importar cuál toggle la originó. Esta pantalla no usa `usePaginatedList`,
// así que no hereda la cola que vive ahí: va local.
let cargaEnCurso: Promise<void> | null = null

async function cargar() {
  const previa = cargaEnCurso
  const actual = (async () => {
    await previa
    loading.value = true
    try {
      salones.value = await salonesApi.listarSalones(verEliminados.value)
      if (!selectedSalonId.value || !selectedSalon.value) {
        selectedSalonId.value = salones.value[0]?.id ?? undefined
      }
      syncLocalMesas()
    }
    catch (e: unknown) {
      toast.add({ title: apiErrorMsg(e, 'Error al cargar salones'), color: 'error' })
    }
    finally {
      loading.value = false
    }
  })()
  cargaEnCurso = actual
  await actual
}

watch(verEliminados, cargar)
watch(selectedSalonId, syncLocalMesas)

onMounted(cargar)

// ── Drag & drop de posiciones ──────────────────────────────────────────────
function onMove(mesaId: string, posX: number, posY: number) {
  if (selectedSalon.value?.eliminadoEl) return
  const mesa = localMesas.value.find(m => m.id === mesaId)
  if (!mesa) return
  mesa.posX = posX.toFixed(5)
  mesa.posY = posY.toFixed(5)
}

async function guardarDistribucion() {
  if (!selectedSalonId.value || selectedSalon.value?.eliminadoEl) return
  savingLayout.value = true
  try {
    await salonesApi.guardarLayout(
      selectedSalonId.value,
      localMesas.value.map(m => ({
        mesaId: m.id,
        posX: Number(m.posX),
        posY: Number(m.posY),
      })),
    )
    patchSalonMesas(selectedSalonId.value, localMesas.value)
    toast.add({ title: 'Distribución guardada', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar la distribución'), color: 'error' })
  }
  finally {
    savingLayout.value = false
  }
}

// ── CRUD salón ─────────────────────────────────────────────────────────────
const salonDrawerOpen = ref(false)
const salonEditingId = ref<string | null>(null)
const salonForm = ref({ nombre: '' })
const savingSalon = ref(false)
const deleteSalonOpen = ref(false)

const salonDrawerTitle = computed(() =>
  salonEditingId.value ? 'Editar salón' : 'Nuevo salón',
)

function abrirCrearSalon() {
  salonEditingId.value = null
  salonForm.value = { nombre: '' }
  salonDrawerOpen.value = true
}

function abrirEditarSalon() {
  if (!selectedSalon.value || selectedSalon.value.eliminadoEl) return
  salonEditingId.value = selectedSalon.value.id
  salonForm.value = { nombre: selectedSalon.value.nombre }
  salonDrawerOpen.value = true
}

async function guardarSalon() {
  savingSalon.value = true
  try {
    if (salonEditingId.value) {
      const saved = await salonesApi.actualizarSalon(
        salonEditingId.value,
        salonForm.value.nombre,
      )
      const salon = salones.value.find(s => s.id === saved.id)
      if (salon) salon.nombre = saved.nombre
      salones.value = [...salones.value].sort((a, b) =>
        a.nombre.localeCompare(b.nombre, 'es'),
      )
      toast.add({ title: 'Salón actualizado', color: 'success' })
    }
    else {
      const saved = await salonesApi.crearSalon(salonForm.value.nombre)
      salones.value = [...salones.value, { id: saved.id, nombre: saved.nombre, mesas: [] }]
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      selectedSalonId.value = saved.id
      toast.add({ title: 'Salón creado', color: 'success' })
    }
    salonDrawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar el salón'), color: 'error' })
  }
  finally {
    savingSalon.value = false
  }
}

async function eliminarSalon() {
  if (!selectedSalonId.value || selectedSalon.value?.eliminadoEl) return
  try {
    const id = selectedSalonId.value
    await salonesApi.eliminarSalon(id)
    // Con la papelera abierta la fila no desaparece: pasa a "eliminada" con su
    // autor y fecha. El DELETE no devuelve esos datos —solo llegan en el
    // próximo GET con el flag—, así que acá hace falta recargar en vez del
    // patch local de siempre.
    if (verEliminados.value) {
      await cargar()
    }
    else {
      salones.value = salones.value.filter(s => s.id !== id)
      selectedSalonId.value = salones.value[0]?.id
      syncLocalMesas()
    }
    toast.add({ title: 'Salón eliminado', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al eliminar el salón'), color: 'error' })
  }
  finally {
    deleteSalonOpen.value = false
  }
}

// ── Restaurar salón ──────────────────────────────────────────────────────────
const confirmRestaurarSalonOpen = ref(false)
const restaurandoSalon = ref(false)

function abrirRestaurarSalon() {
  if (!selectedSalon.value?.eliminadoEl) return
  confirmRestaurarSalonOpen.value = true
}

/**
 * `POST /salones/:id/restaurar` revive el salón y, en la MISMA sentencia, las
 * mesas que ESE borrado se llevó (docs/features/papelera.md → "Colateral
 * acotado" / "Restaurar el padre revive esas filas"). La respuesta solo trae
 * el salón, no las mesas revividas: reconstruir esa comparación de timestamps
 * en el frontend duplicaría lógica de negocio que ya vive en el backend. Por
 * eso, a diferencia del patch local de `restaurarMesaSeleccionada` (y de
 * `terceros`/`turnos`, que no tienen cascada), acá se recarga el listado
 * entero con `cargar()` — decisión tomada en esta tarea.
 */
async function restaurarSalonSeleccionado() {
  if (!selectedSalonId.value) return
  // Guard de reentrancia: el modal no se cierra solo al confirmar, así que
  // mientras el POST viaja un segundo click mandaría otro `POST .../restaurar`
  // sobre una fila ya revivida → 404 → toast de ERROR encima de un éxito.
  if (restaurandoSalon.value) return
  restaurandoSalon.value = true
  try {
    await restaurarSalonApi(selectedSalonId.value)
    await cargar()
    toast.add({ title: 'Salón restaurado', color: 'success' })
    confirmRestaurarSalonOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al restaurar'), color: 'error' })
    confirmRestaurarSalonOpen.value = false
  }
  finally {
    restaurandoSalon.value = false
  }
}

// ── CRUD mesa ──────────────────────────────────────────────────────────────
const mesaDrawerOpen = ref(false)
const mesaEditingId = ref<string | null>(null)
const mesaForm = ref<{ nombre: string, forma: FormaMesa, tamano: TamanoMesa }>({
  nombre: '',
  forma: 'cuadrada',
  tamano: 'mediano',
})
const savingMesa = ref(false)
const deleteMesaOpen = ref(false)
const mesaToDelete = ref<MesaResumen | null>(null)

const mesaDrawerTitle = computed(() =>
  mesaEditingId.value ? 'Editar mesa' : 'Nueva mesa',
)

function abrirCrearMesa() {
  if (!selectedSalon.value || selectedSalon.value.eliminadoEl) return
  mesaEditingId.value = null
  mesaForm.value = { nombre: '', forma: 'cuadrada', tamano: 'mediano' }
  mesaDrawerOpen.value = true
}

function abrirEditarMesa(mesa: MesaResumen) {
  if (mesa.eliminadoEl) return
  mesaEditingId.value = mesa.id
  mesaForm.value = { nombre: mesa.nombre, forma: mesa.forma, tamano: mesa.tamano }
  mesaToDelete.value = mesa
  mesaDrawerOpen.value = true
}

function eliminarMesaDesdeDrawer() {
  mesaDrawerOpen.value = false
  deleteMesaOpen.value = true
}

async function guardarMesa() {
  if (!selectedSalonId.value) return
  savingMesa.value = true
  try {
    const salonId = selectedSalonId.value
    const salon = salones.value.find(s => s.id === salonId)
    if (!salon) return

    if (mesaEditingId.value) {
      const saved = await salonesApi.actualizarMesa(mesaEditingId.value, {
        nombre: mesaForm.value.nombre,
        forma: mesaForm.value.forma,
        tamano: mesaForm.value.tamano,
      })
      const idx = salon.mesas.findIndex(m => m.id === saved.id)
      if (idx >= 0) {
        salon.mesas[idx] = {
          ...salon.mesas[idx]!,
          nombre: saved.nombre,
          posX: saved.posX,
          posY: saved.posY,
          forma: saved.forma,
          tamano: saved.tamano,
        }
      }
      syncLocalMesas()
      toast.add({ title: 'Mesa actualizada', color: 'success' })
    }
    else {
      const saved = await salonesApi.crearMesa(salonId, {
        nombre: mesaForm.value.nombre,
        posX: 0.5,
        posY: 0.5,
        forma: mesaForm.value.forma,
        tamano: mesaForm.value.tamano,
      })
      salon.mesas.push({
        id: saved.id,
        nombre: saved.nombre,
        posX: saved.posX,
        posY: saved.posY,
        forma: saved.forma,
        tamano: saved.tamano,
        cuentasAbiertas: 0,
        ocupada: false,
      })
      syncLocalMesas()
      toast.add({ title: 'Mesa creada', color: 'success' })
    }
    mesaDrawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar la mesa'), color: 'error' })
  }
  finally {
    savingMesa.value = false
  }
}

async function eliminarMesa() {
  if (!mesaToDelete.value || !selectedSalonId.value) return
  try {
    const mesaId = mesaToDelete.value.id
    await salonesApi.eliminarMesa(mesaId)
    // Mismo motivo que `eliminarSalon`: con la papelera abierta hay que
    // recargar para traer `eliminadoEl`/`eliminadoPorNombre`, que el DELETE
    // no devuelve.
    if (verEliminados.value) {
      await cargar()
    }
    else {
      const salon = salones.value.find(s => s.id === selectedSalonId.value)
      if (salon) {
        salon.mesas = salon.mesas.filter(m => m.id !== mesaId)
        syncLocalMesas()
      }
    }
    toast.add({ title: 'Mesa eliminada', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al eliminar la mesa'), color: 'error' })
  }
  finally {
    deleteMesaOpen.value = false
    mesaToDelete.value = null
  }
}

// ── Restaurar mesa ────────────────────────────────────────────────────────────
const confirmRestaurarMesaId = ref<string | null>(null)
const confirmRestaurarMesaOpen = ref(false)
const restaurandoMesa = ref(false)

function abrirRestaurarMesa(mesa: MesaResumen) {
  if (!mesa.eliminadoEl) return
  confirmRestaurarMesaId.value = mesa.id
  confirmRestaurarMesaOpen.value = true
}

function cerrarRestaurarMesa() {
  confirmRestaurarMesaId.value = null
  confirmRestaurarMesaOpen.value = false
}

/**
 * `POST /mesas/:id/restaurar` — endpoint DISTINTO del de salón, vive en
 * `MesasController` (`docs/features/papelera.md`). Sin cascada que
 * reconstruir, así que acá sí alcanza el patch local, como en
 * `terceros`/`turnos`.
 */
async function restaurarMesaSeleccionada(id: string) {
  // Mismo guard de reentrancia que `restaurarSalonSeleccionado`.
  if (restaurandoMesa.value) return
  restaurandoMesa.value = true
  try {
    await restaurarMesaApi(id)
    const salon = salones.value.find(s => s.mesas.some(m => m.id === id))
    const mesa = salon?.mesas.find(m => m.id === id)
    if (mesa) {
      mesa.eliminadoEl = null
      mesa.eliminadoPorNombre = null
    }
    syncLocalMesas()
    toast.add({ title: 'Mesa restaurada', color: 'success' })
    cerrarRestaurarMesa()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al restaurar'), color: 'error' })
    cerrarRestaurarMesa()
  }
  finally {
    restaurandoMesa.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Salones y mesas"
      description="Configura los salones del local y la distribución de sus mesas."
    >
      <template #actions>
        <div class="flex items-center gap-4">
          <!-- El toggle solo si puede restaurar: sin `Salones:Eliminar` el
               backend rechaza los dos restaurar (salón y mesa), así que
               mostrar la papelera sería ofrecer una acción que termina en 403. -->
          <div v-if="puedeEliminar" class="flex items-center gap-2">
            <USwitch v-model="verEliminados" aria-label="Ver eliminados" />
            <span class="text-sm text-muted">Ver eliminados</span>
          </div>
          <UButton v-if="puedeCrear" icon="i-lucide-plus" @click="abrirCrearSalon">
            Nuevo salón
          </UButton>
        </div>
      </template>
    </CrudPageHeader>

    <div v-if="loading" class="flex justify-center py-12">
      <UIcon name="i-lucide-loader" class="h-8 w-8 animate-spin text-muted" />
    </div>

    <div v-else-if="salones.length === 0" class="py-12 text-center text-sm text-muted">
      No hay salones. Crea el primero para empezar.
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center gap-3">
        <USelectMenu
          v-model="selectedSalonId"
          :items="salonItems"
          value-key="value"
          class="w-56"
        />
        <UBadge v-if="selectedSalon?.eliminadoEl" color="neutral" variant="subtle">
          Eliminado
        </UBadge>
        <UButton
          v-if="puedeActualizar && !selectedSalon?.eliminadoEl"
          icon="i-lucide-square-pen"
          color="neutral"
          variant="ghost"
          title="Editar salón"
          aria-label="Editar salón"
          @click="abrirEditarSalon"
        />
        <UButton
          v-if="puedeEliminar && !selectedSalon?.eliminadoEl"
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          title="Eliminar salón"
          aria-label="Eliminar salón"
          @click="() => { deleteSalonOpen = true }"
        />
        <UButton
          v-if="puedeEliminar && selectedSalon?.eliminadoEl"
          icon="i-lucide-rotate-ccw"
          color="neutral"
          variant="ghost"
          title="Restaurar salón"
          @click="abrirRestaurarSalon"
        >
          Restaurar
        </UButton>
      </div>
      <p v-if="selectedSalon?.eliminadoEl" class="text-xs text-muted">
        {{ formatearBorradoPor(selectedSalon) }}
      </p>

      <div v-if="selectedSalon && !selectedSalon.eliminadoEl" class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-1.5">
            <span class="text-sm text-muted">Distribución del salón</span>
            <!-- Explica arrastrar y doble-click: sin `editable` no hay ninguna
                 de las dos, y dejarla haría que la pantalla mienta. -->
            <AppInfoButton v-if="puedeActualizar" title="Cómo editar el plano">
              <ul class="space-y-3">
                <li class="flex items-start gap-2">
                  <UIcon name="i-lucide-move" class="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                  <span>Arrastra una mesa para ubicarla en el plano.</span>
                </li>
                <li class="flex items-start gap-2">
                  <UIcon name="i-lucide-mouse-pointer-click" class="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                  <span>Doble click en una mesa para editarla o eliminarla.</span>
                </li>
              </ul>
            </AppInfoButton>
          </div>
          <div class="flex items-center gap-3">
            <span v-if="savingLayout" class="flex items-center gap-1.5 text-xs text-muted">
              <UIcon name="i-lucide-loader" class="h-3.5 w-3.5 animate-spin" />
              Guardando…
            </span>
            <UButton
              v-if="puedeCrear"
              icon="i-lucide-plus"
              size="sm"
              variant="soft"
              @click="abrirCrearMesa"
            >
              Agregar mesa
            </UButton>
          </div>
        </div>

        <!--
          `editable` habilita arrastrar (guarda `PATCH :id/layout`) y el
          doble-click que abre el drawer de la mesa (`PATCH /mesas/:id`): las dos
          escrituras son `Salones:Actualizar`, así que van con el mismo gate.
        -->
        <SalonesSalonPlano
          :mesas="localMesas"
          :editable="puedeActualizar"
          @move="onMove"
          @edit="abrirEditarMesa"
          @dragend="guardarDistribucion"
        />
      </div>

      <!-- Mesas eliminadas del salón seleccionado: fuera del plano a propósito
           (el plano es para operar, no para auditar). Cada una se restaura
           por separado con su propio endpoint (`POST /mesas/:id/restaurar`). -->
      <div v-if="puedeEliminar && mesasEliminadas.length > 0" class="space-y-2">
        <span class="text-sm text-muted">Mesas eliminadas</span>
        <ul class="space-y-2">
          <li
            v-for="mesa in mesasEliminadas"
            :key="mesa.id"
            class="flex items-center justify-between gap-3 rounded-lg border border-default p-3"
          >
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <p class="font-medium truncate">{{ mesa.nombre }}</p>
                <UBadge color="neutral" variant="subtle">Eliminado</UBadge>
              </div>
              <p class="text-xs text-muted">{{ formatearBorradoPor(mesa) }}</p>
            </div>
            <UButton
              icon="i-lucide-rotate-ccw"
              color="neutral"
              variant="ghost"
              @click="abrirRestaurarMesa(mesa)"
            >
              Restaurar
            </UButton>
          </li>
        </ul>
      </div>
    </template>

    <!-- Drawer salón -->
    <AppDrawer v-model:open="salonDrawerOpen" width="40%">
      <template #header>
        <span class="font-semibold text-default">{{ salonDrawerTitle }}</span>
      </template>
      <template #body>
        <UForm id="salon-form" :state="salonForm" class="space-y-4" @submit="guardarSalon">
          <UFormField label="Nombre" required>
            <UInput v-model="salonForm.nombre" placeholder="Salón Principal" autofocus />
          </UFormField>
        </UForm>
      </template>
      <template #actions>
        <UButton color="neutral" variant="ghost" @click="() => { salonDrawerOpen = false }">
          Cancelar
        </UButton>
        <UButton type="submit" form="salon-form" :loading="savingSalon">
          {{ salonEditingId ? 'Guardar' : 'Crear' }}
        </UButton>
      </template>
    </AppDrawer>

    <!-- Drawer mesa -->
    <AppDrawer v-model:open="mesaDrawerOpen" width="40%">
      <template #header>
        <span class="font-semibold text-default">{{ mesaDrawerTitle }}</span>
      </template>
      <template #body>
        <UForm id="mesa-form" :state="mesaForm" class="space-y-4" @submit="guardarMesa">
          <UFormField label="Nombre" required>
            <UInput v-model="mesaForm.nombre" placeholder="Mesa 1" autofocus />
          </UFormField>
          <UFormField label="Forma">
            <USelectMenu
              v-model="mesaForm.forma"
              :items="FORMA_MESA_OPTIONS"
              value-key="value"
            />
          </UFormField>
          <UFormField label="Tamaño">
            <USelectMenu
              v-model="mesaForm.tamano"
              :items="TAMANO_MESA_OPTIONS"
              value-key="value"
            />
          </UFormField>
        </UForm>
      </template>
      <template #actions>
        <!--
          `DELETE /mesas/:id` pide `Eliminar`, no `Actualizar`: quien solo puede
          editar la mesa no ve la papelera. (Al revés no aplica: la única puerta
          a este drawer es el doble-click del plano, que ya exige `Actualizar`.)
        -->
        <UButton
          v-if="mesaEditingId && puedeEliminar"
          color="error"
          variant="soft"
          icon="i-lucide-trash-2"
          class="mr-auto"
          @click="eliminarMesaDesdeDrawer"
        >
          Eliminar
        </UButton>
        <UButton color="neutral" variant="ghost" @click="() => { mesaDrawerOpen = false }">
          Cancelar
        </UButton>
        <UButton type="submit" form="mesa-form" :loading="savingMesa">
          {{ mesaEditingId ? 'Guardar' : 'Crear' }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudModal
      v-model:open="deleteSalonOpen"
      title="Eliminar salón"
      message="Se eliminará el salón junto con sus mesas activas. Podés recuperarlo desde «Ver eliminados» (las mesas que se lleve este borrado vuelven con él)."
      @confirm="eliminarSalon"
    />
    <CrudModal
      v-model:open="deleteMesaOpen"
      title="Eliminar mesa"
      message="¿Eliminar esta mesa? Podés recuperarla desde «Ver eliminados»."
      @cancel="mesaToDelete = null"
      @confirm="eliminarMesa"
    />

    <CrudModal
      v-model:open="confirmRestaurarSalonOpen"
      title="Restaurar salón"
      message="¿Restaurar este salón? Volverá a aparecer en el listado, junto con las mesas que este borrado se llevó."
      confirm-label="Restaurar"
      confirm-color="neutral"
      :loading="restaurandoSalon"
      @cancel="confirmRestaurarSalonOpen = false"
      @confirm="restaurarSalonSeleccionado"
    />
    <CrudModal
      v-model:open="confirmRestaurarMesaOpen"
      title="Restaurar mesa"
      message="¿Restaurar esta mesa? Volverá a aparecer en el plano del salón."
      confirm-label="Restaurar"
      confirm-color="neutral"
      :loading="restaurandoMesa"
      @cancel="cerrarRestaurarMesa"
      @confirm="confirmRestaurarMesaId && restaurarMesaSeleccionada(confirmRestaurarMesaId)"
    />
  </div>
</template>
