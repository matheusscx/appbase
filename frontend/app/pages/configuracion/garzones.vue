<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Garzon, TipoGarzon } from '~/composables/useGarzones'

const TIPO_GARZON_OPTIONS: { label: string, value: TipoGarzon }[] = [
  { label: 'Garzón', value: 'garzon' },
  { label: 'Cocina', value: 'cocina' },
  { label: 'Barra', value: 'barra' },
]

function labelTipo(tipo: TipoGarzon): string {
  return TIPO_GARZON_OPTIONS.find(o => o.value === tipo)?.label ?? tipo
}

// La lectura es abierta (`Salones:Leer`), pero cada escritura pega a un endpoint
// con su propio `@RequiresPermiso`. Garzones NO tiene módulo propio: sus rutas
// piden permisos de **Salones**. `Salones:Operar` no entra acá — es de la
// operación (`garzones/verificar-pin`, cuentas), no de esta pantalla.
const { puedeCrear, puedeActualizar, puedeEliminar } = usePermisosCrud('Salones')

const toast = useToast()
const garzonesApi = useGarzones()

// El toggle "ver eliminados" y el restaurar van los dos detrás de
// `Salones:Eliminar`: `POST /garzones/:id/restaurar` exige ese permiso, así
// que ofrecer la papelera sin él sería prometer una acción que termina en 403.
const { verEliminados, restaurar, formatearBorradoPor } = usePapelera('garzones')

const garzones = ref<Garzon[]>([])
const loading = ref(false)

// Cola serial, mismo patrón que `configuracion/descuentos.vue` → `cargar()`:
// `watch(verEliminados, cargar)` dispara una llamada por toggle del switch, y
// sin encadenarlas la respuesta que llega segunda pisa `garzones.value` sin
// importar cuál toggle la originó — el listado queda desincronizado del
// switch. Esta pantalla no usa `usePaginatedList`, así que no hereda la cola
// que vive ahí: va local.
let cargaEnCurso: Promise<void> | null = null

async function cargar() {
  const previa = cargaEnCurso
  const actual = (async () => {
    await previa
    loading.value = true
    try {
      garzones.value = await garzonesApi.listar(verEliminados.value)
    }
    catch (e: unknown) {
      toast.add({ title: apiErrorMsg(e, 'Error al cargar garzones'), color: 'error' })
    }
    finally {
      loading.value = false
    }
  })()
  cargaEnCurso = actual
  await actual
}

watch(verEliminados, cargar)

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

onMounted(async () => {
  await Promise.all([cargar(), cargarMiembros()])
})

async function cargarMiembros() {
  // Con `catch` como su hermana `cargar()`: sin él, un fallo de la carga deja el
  // selector VACÍO y sin explicación, y el admin concluye que no hay cuentas
  // vinculables cuando lo que falló fue la carga.
  //
  // `para-selector` y no `members`: esta pantalla no es admin-only, y el roster
  // completo trae el correo de cada miembro. Acá solo hacen falta los nombres.
  try {
    miembros.value = await useApiFetch<typeof miembros.value>(
      `${useRuntimeConfig().public.apiUrl}/tenants/members/para-selector`,
    )
  }
  catch (e: unknown) {
    toast.add({
      title: apiErrorMsg(e, 'No se pudieron cargar las cuentas del tenant'),
      color: 'error',
    })
  }
}

// ── Crear / editar garzón ──────────────────────────────────────────────────
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)
const form = ref<{
  nombre: string
  activo: boolean
  tipo: TipoGarzon
  usuarioId: string | null
}>({
  nombre: '',
  activo: true,
  tipo: 'garzon',
  usuarioId: null,
})

/**
 * Miembros del tenant, para el vínculo opcional del modo personal.
 *
 * Se cargan una vez al montar y no al abrir el drawer: son pocos y no cambian
 * mientras se edita un garzón.
 */
const miembros = ref<{ usuarioId: string, nombre: string, apellido: string, esTotem: boolean }[]>([])

/**
 * Proxy entre el `undefined` que usa `USelectMenu` para "nada elegido" y el
 * `null` que el backend necesita para **desvincular**.
 *
 * No son sinónimos en el DTO: ausente significa "no toques el vínculo" y `null`
 * es "sacalo". Sin esta traducción, vaciar el selector no desvincularía nada.
 */
const usuarioVinculado = computed<string | undefined>({
  get: () => form.value.usuarioId ?? undefined,
  set: (v) => { form.value.usuarioId = v ?? null },
})

/**
 * Cuentas ofrecibles: ni marcadas tótem ni **ya vinculadas a otro garzón**. Las
 * dos son error del backend, así que ofrecerlas sería hacerle descubrir la
 * regla al admin chocándose — y la de "ya vinculada" era un 500 hasta que se le
 * puso mensaje.
 */
const miembrosVinculables = computed(() => {
  // Cuentas tomadas por OTRO garzón. La del garzón que se está editando no
  // cuenta: si no, al abrir el drawer su propia cuenta desaparecería del
  // selector y parecería desvinculada.
  // Solo garzones VIVOS: el índice único es parcial sobre `eliminado_el IS
  // NULL`, así que la cuenta de uno borrado está libre y el backend la acepta.
  // Contarla acá dejaría el selector más restrictivo que la regla.
  const tomadas = new Set(
    garzones.value
      .filter(g => g.usuarioId && !g.eliminadoEl && g.id !== editingId.value)
      .map(g => g.usuarioId),
  )
  return miembros.value
    .filter(m => !m.esTotem && !tomadas.has(m.usuarioId))
    .map(m => ({
      // El fallback era `|| m.correo`, y el correo dejó de venir. No se cae sin
      // más: `@MinLength(1)` acepta un nombre en blanco, y una opción con label
      // vacío no se puede elegir a ciegas.
      label: `${m.nombre} ${m.apellido ?? ''}`.trim() || 'Sin nombre',
      value: m.usuarioId,
    }))
})
const saving = ref(false)

const drawerTitle = computed(() =>
  editingId.value ? 'Editar garzón' : 'Nuevo garzón',
)

function abrirCrear() {
  editingId.value = null
  form.value = { nombre: '', activo: true, tipo: 'garzon', usuarioId: null }
  drawerOpen.value = true
}

function abrirEditar(garzon: Garzon) {
  if (garzon.eliminadoEl) return
  editingId.value = garzon.id
  form.value = {
    nombre: garzon.nombre,
    activo: garzon.activo,
    tipo: garzon.tipo ?? 'garzon',
    usuarioId: garzon.usuarioId ?? null,
  }
  drawerOpen.value = true
}

async function guardar() {
  saving.value = true
  try {
    if (editingId.value) {
      const { advertencias, ...saved } = await garzonesApi.actualizar(editingId.value, {
        nombre: form.value.nombre,
        activo: form.value.activo,
        tipo: form.value.tipo,
        // Se manda siempre, incluido `null`: en el DTO, ausente significa "no
        // toques el vínculo" y `null` es "desvinculá". Omitirlo cuando el
        // selector se vacía dejaría el vínculo vivo.
        usuarioId: form.value.usuarioId,
      })
      upsertLocal(saved)
      toast.add({ title: 'Garzón actualizado', color: 'success' })
      // El cambio se guardó; lo que la advertencia dice es que puede no regir
      // todavía (sesión abierta con el tipo congelado). Mismo patrón que el POS
      // con las advertencias de la venta: éxito primero, avisos después.
      for (const advertencia of advertencias) {
        toast.add({ title: advertencia, color: 'warning' })
      }
      drawerOpen.value = false
    }
    else {
      const creado = await garzonesApi.crear({
        nombre: form.value.nombre,
        activo: form.value.activo,
        tipo: form.value.tipo,
      })
      const { pin, advertencias: _sinAdvertencias, ...garzon } = creado
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
  if (garzon.eliminadoEl) return
  regenerarTarget.value = garzon
  regenerarOpen.value = true
}

async function confirmarRegenerar() {
  if (!regenerarTarget.value) return
  regenerando.value = true
  try {
    const res = await garzonesApi.regenerarPin(regenerarTarget.value.id)
    regenerarOpen.value = false
    revelarPin(res.nombre, res.pin, res.advertencias)
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
const pinRevelado = ref<{ nombre: string, pin: string, advertencias: string[] }>({
  nombre: '',
  pin: '',
  advertencias: [],
})

/** Las advertencias del backend van DENTRO de este modal, no en un toast: son
 *  sobre el PIN que se está mostrando ("está en turno, pasáselo ya") y acá es
 *  donde el admin está mirando. Un toast detrás del modal se pierde. */
function revelarPin(nombre: string, pin: string, advertencias: string[] = []) {
  pinRevelado.value = { nombre, pin, advertencias }
  pinReveladoOpen.value = true
}

// ── Eliminar ───────────────────────────────────────────────────────────────
const deleteOpen = ref(false)
const toDelete = ref<Garzon | null>(null)

function confirmarEliminar(garzon: Garzon) {
  if (garzon.eliminadoEl) return
  toDelete.value = garzon
  deleteOpen.value = true
}

async function eliminar() {
  if (!toDelete.value) return
  try {
    const id = toDelete.value.id
    await garzonesApi.eliminar(id)
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

// ── Restaurar ────────────────────────────────────────────────────────────────
// SIN modal de colisión: la única colisión posible de `garzones` es el
// placeholder "Mostrador" (índice único parcial, no de nombre) y renombrar no
// la resuelve — un 400 acá es siempre terminal (toast), nunca una pregunta.
// `docs/features/papelera.md` § "garzones tiene una restricción única parcial
// distinta". Tampoco se arregla el riesgo aceptado de PIN duplicado al
// restaurar: documentado en la misma sección, `restaurar()` no puede
// compararlo porque el PIN solo existe hasheado.
const confirmRestaurarId = ref<string | null>(null)
const confirmRestaurarModalOpen = ref(false)
const restaurando = ref(false)

function cerrarRestaurar() {
  confirmRestaurarId.value = null
  confirmRestaurarModalOpen.value = false
}

async function restaurarGarzon(id: string) {
  // Guard de reentrancia: el modal no se cierra solo al confirmar, así que
  // mientras el POST viaja un segundo click mandaría otro `POST .../restaurar`
  // sobre una fila ya revivida → 404 → toast de ERROR encima de un éxito.
  if (restaurando.value) return
  restaurando.value = true
  try {
    await restaurar(id)
    const g = garzones.value.find(x => x.id === id)
    if (g) {
      g.eliminadoEl = null
      g.eliminadoPorNombre = null
    }
    toast.add({ title: 'Garzón restaurado', color: 'success' })
    cerrarRestaurar()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al restaurar'), color: 'error' })
    cerrarRestaurar()
  }
  finally {
    restaurando.value = false
  }
}

const columns: TableColumn<Garzon>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { accessorKey: 'tipo', header: 'Tipo' },
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
        <div class="flex items-center gap-4">
          <!-- El toggle solo si puede restaurar: sin `Salones:Eliminar` el
               backend rechaza el restaurar, así que mostrar la papelera sería
               ofrecer una acción que termina en 403. -->
          <div v-if="puedeEliminar" class="flex items-center gap-2">
            <USwitch v-model="verEliminados" aria-label="Ver eliminados" />
            <span class="text-sm text-muted">Ver eliminados</span>
          </div>
          <UButton v-if="puedeCrear" icon="i-lucide-plus" @click="abrirCrear">
            Nuevo garzón
          </UButton>
        </div>
      </template>
    </CrudPageHeader>

    <CrudTable :data="garzones" :columns="columns" :loading="loading">
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

      <template #tipo-cell="{ row }">
        <UBadge color="neutral" variant="subtle" size="xs">
          {{ labelTipo(row.original.tipo ?? 'garzon') }}
        </UBadge>
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
          <!-- Regenerar PIN es `PATCH :id/pin`: mismo permiso que editar. -->
          <UButton
            v-if="puedeActualizar"
            icon="i-lucide-key-round"
            color="neutral"
            variant="ghost"
            title="Regenerar PIN"
            aria-label="Regenerar PIN"
            @click="abrirRegenerar(row.original)"
          />
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
            <UInput
              v-model="form.nombre"
              placeholder="Ana Torres"
              :maxlength="100"
              autofocus
            />
          </UFormField>
          <UFormField label="Tipo" required>
            <USelect
              v-model="form.tipo"
              :items="TIPO_GARZON_OPTIONS"
              value-key="value"
              label-key="label"
            />
          </UFormField>
          <p v-if="!editingId" class="text-sm text-muted">
            Al crear el garzón se generará automáticamente un PIN de 6 dígitos y
            se mostrará una sola vez para que se lo entregues.
          </p>
          <UFormField label="Activo">
            <USwitch v-model="form.activo" />
          </UFormField>
          <!-- El vínculo es opcional a propósito: sin él, el garzón sigue
               operando por PIN, que es lo que permite sumar personal temporal
               sin crearle una cuenta. -->
          <UFormField
            label="Cuenta vinculada"
            hint="Opcional"
            description="Si opera desde su propia tablet, entra con su cuenta y no teclea PIN. Sin vincular, se identifica con PIN como siempre."
          >
            <USelectMenu
              v-model="usuarioVinculado"
              :items="miembrosVinculables"
              value-key="value"
              placeholder="Sin vincular (usa PIN)"
              class="w-full"
            />
          </UFormField>
        </UForm>
      </template>
      <template #actions>
        <UButton color="neutral" variant="ghost" @click="() => { drawerOpen = false }">
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
          <!-- Del backend: hoy, que el garzón está en turno y el PIN viejo ya
               dejó de funcionar. Va acá y no en un toast porque es sobre este
               PIN y sobre la urgencia de entregarlo. -->
          <UAlert
            v-for="advertencia in pinRevelado.advertencias"
            :key="advertencia"
            color="warning"
            variant="subtle"
            icon="i-lucide-clock-alert"
            :description="advertencia"
          />
        </div>
      </template>
      <template #footer>
        <AppModalFooter>
          <UButton label="Entendido" @click="() => { pinReveladoOpen = false }" />
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

    <!-- Restaurar: SIN modal de colisión, ver el comentario junto a
         `restaurarGarzon`. Cualquier error es terminal y se avisa por toast. -->
    <CrudModal
      v-model:open="confirmRestaurarModalOpen"
      title="Restaurar garzón"
      message="¿Restaurar este garzón? Volverá a aparecer en el listado y podrá identificarse con su PIN de nuevo."
      confirm-label="Restaurar"
      confirm-color="neutral"
      :loading="restaurando"
      @cancel="cerrarRestaurar"
      @confirm="confirmRestaurarId && restaurarGarzon(confirmRestaurarId)"
    />
  </div>
</template>
