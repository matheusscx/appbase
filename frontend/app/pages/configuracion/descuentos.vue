<script setup lang="ts">
import type { NivelRegla } from '~/composables/useNivelRegla'
import type { TableColumn } from '@nuxt/ui'
import { DESCUENTO_CONFIG, type TipoConfig } from '~/utils/reglas-form-config'

// Pantalla admin-only: sus escrituras van con `TenantAdminGuard` en el
// backend. El menú ya la esconde a los no-admin, pero sin guard de ruta la URL
// escrita a mano la abría igual (la lectura es abierta, así que la tabla
// cargaba) y el 403 llegaba recién al guardar.
definePageMeta({ middleware: 'admin' })

interface TipoRegla { id: string; nombre: string; codigo: string; descripcion: string | null }

interface Regla {
  id: string
  nombre: string
  nivel: NivelRegla
  tipoReglaId: string
  tipoRegla?: { id: string; codigo: string; nombre: string }
  modo: string | null
  valorMonto: string | null
  valorPorcentaje: string | null
  metodoPagoIds: string[]
  tramos: { minimoCantidad: string | null; minimoMonto: string | null; valorMonto: string | null; valorPorcentaje: string | null }[]
  diasVencimiento: number | null
  fechaInicio: string | null
  fechaFin: string | null
  activo: boolean
  eliminadoEl?: string | null
  eliminadoPorNombre?: string | null
}

const runtimeConfig = useRuntimeConfig()
const toast = useToast()
const apiUrl = runtimeConfig.public.apiUrl

const { verEliminados, restaurar, formatearBorradoPor } = usePapelera('descuentos')
const { estadoVigencia, vigenciaColor, vigenciaLabel } = useVigenciaRegla()
const { nivelOptions, nivelLabel, itemsQueLoTienen } = useNivelRegla()

const descuentos = ref<Regla[]>([])
const tipos = ref<{ label: string; value: string; codigo: string; descripcion: string | null }[]>([])
const metodos = ref<{ label: string; value: string }[]>([])
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
const nombreError = ref<string | null>(null)

// ── Pausar: confirmación con el alcance ─────────────────────────────────────
const {
  toggling,
  confirmPausarNombre,
  confirmPausarItems,
  confirmPausarNivel,
  confirmPausarModalOpen,
  toggleActivo,
  cerrarPausar,
  confirmarPausar,
} = usePausaRegla('descuentos', 'Descuento', descuentos)

const modoOptions = [
  { label: 'Porcentaje', value: 'porcentaje' },
  { label: 'Monto fijo', value: 'monto_fijo' },
]

// Cómo dice la regla cuánto descuenta. Es un eje distinto del `modo`: el modo
// elige la UNIDAD (plata o porcentaje) y esto elige la FORMA (un valor para toda
// la venta, o escalones según el monto). Solo aparece en los tipos que admiten
// las dos — ver `eligeForma`.
const formaImporteOptions = [
  { label: 'Un valor único', value: 'valor' },
  { label: 'Por escalones', value: 'tramos' },
]

const CONFIG_MAP = DESCUENTO_CONFIG

const emptyForm = () => ({
  nombre: '',
  tipoReglaId: '',
  nivel: 'linea' as NivelRegla,
  modo: 'porcentaje' as string,
  valorMonto: '' as string,
  valorPorcentaje: '' as string,
  metodoPagoIds: [] as string[],
  formaImporte: 'valor' as 'valor' | 'tramos',
  tramos: [] as { minimo: string; valorMonto: string; valorPorcentaje: string }[],
  diasVencimiento: null as number | null,
  fechaInicio: null as string | null,
  fechaFin: null as string | null,
  activo: true,
})
const form = ref(emptyForm())

const drawerTitle = computed(() =>
  editingId.value ? 'Editar descuento' : 'Nuevo descuento',
)

const submitLabel = computed(() =>
  editingId.value ? 'Guardar' : 'Crear',
)

/**
 * ¿El usuario ya eligió el nivel a mano? Es un **testigo**, no un dato del
 * formulario: no se guarda ni viaja al backend.
 *
 * Existe porque "el tipo empuja el default, sin bloquearlo" (decisión del owner,
 * 2026-08-25) describe un DEFAULT, y un default solo manda mientras nadie eligió.
 *
 * ⚠️ **Es lo contrario de lo que hace `onTipoChange` con los demás campos**, que
 * los pisa siempre, así que este camino no puede colgarse de aquél: los otros
 * campos dependen del tipo (un `general` no tiene métodos de pago que conservar),
 * y el nivel no — las dos opciones son válidas para cualquier tipo.
 *
 * Arranca en `true` al EDITAR: una regla que ya existe tomó su decisión de nivel
 * cuando se creó, y cambiarle el tipo no puede darla vuelta sola.
 */
const nivelTocado = ref(false)

function onNivelChange(value: NivelRegla) {
  nivelTocado.value = true
  form.value.nivel = value
}

function resetDrawer() {
  editingId.value = null
  form.value = emptyForm()
  nivelTocado.value = false
  nombreError.value = null
}

watch(drawerOpen, (open) => {
  if (!open) resetDrawer()
})

const tipoSeleccionado = computed(() =>
  tipos.value.find(t => t.value === form.value.tipoReglaId),
)
const config = computed<TipoConfig | null>(() =>
  tipoSeleccionado.value ? CONFIG_MAP[tipoSeleccionado.value.codigo] ?? null : null,
)

// Un tipo con las DOS banderas prendidas no muestra los dos campos: admite las
// dos formas y hay que elegir una (backend: `validarFormaDeImporte`). Con una
// sola bandera no hay nada que elegir y el interruptor no aparece, así que los
// tipos de siempre se ven igual que antes.
const eligeForma = computed(() => !!(config.value?.campoValor && config.value?.campoTramos))
const mostrarValor = computed(() =>
  !!config.value?.campoValor && (!eligeForma.value || form.value.formaImporte === 'valor'),
)
const mostrarTramos = computed(() =>
  !!config.value?.campoTramos && (!eligeForma.value || form.value.formaImporte === 'tramos'),
)

// Reset dependent fields only on a real user change of tipo (not on programmatic
// form population in abrirEditar). Bound to the select's change event below.
function onTipoChange(value: string) {
  form.value.tipoReglaId = value
  // El tipo empuja el nivel SOLO mientras nadie lo eligió a mano. Va después de
  // asignar `tipoReglaId` porque `config` se deriva de él.
  if (!nivelTocado.value) form.value.nivel = config.value?.nivelSugerido ?? 'linea'
  form.value.metodoPagoIds = []
  form.value.formaImporte = 'valor'
  form.value.tramos = []
  form.value.diasVencimiento = null
  form.value.modo = config.value?.modo === 'porcentaje' ? 'porcentaje' : 'monto_fijo'
}

// Mismo criterio que `onTipoChange`: solo en un cambio REAL del usuario (bindeado al
// evento del radio, no un watch), para no pisar la población programática de
// `abrirEditar`.
//
// Desde que el importe se guarda en dos columnas (`valorMonto` / `valorPorcentaje`)
// cada rama del `v-if` de abajo escribe la suya, así que cambiar de modo ya no
// reinterpreta un número: lo deja de lado. El reset sigue haciendo falta igual, por
// dos motivos. Uno de pantalla, que es el que lo originó: escribir `0.10` como
// porcentaje y pasar a monto fijo dejaba el input mostrando `0` (MoneyInput trunca a
// los decimales de la moneda para MOSTRAR) mientras el valor seguía siendo `0.10` —
// el usuario veía un número y guardaba otro. Y uno del backend: rechaza un body que
// traiga las dos columnas, así que la abandonada no puede quedar cargada.
// Vaciar es la salida honesta — no hay conversión sensata de "10%" a un monto.
function onModoChange(value: string) {
  if (value === form.value.modo) return
  form.value.modo = value
  form.value.valorMonto = ''
  form.value.valorPorcentaje = ''
  for (const tramo of form.value.tramos) {
    tramo.valorMonto = ''
    tramo.valorPorcentaje = ''
  }
}

// Cola serial, mismo patrón que `configuracion/impuestos.vue` → `cargar()`:
// `watch(verEliminados, cargar)` dispara una llamada por toggle del switch, y
// sin encadenarlas la respuesta que llega segunda pisa `descuentos.value` sin
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
      descuentos.value = await useApiFetch<Regla[]>(`${apiUrl}/descuentos${query}`)
    }
    catch (e: unknown) {
      const msg = apiErrorMsg(e, 'Error al cargar descuentos')
      toast.add({ title: msg, color: 'error' })
    }
    finally {
      loading.value = false
    }
  })()
  cargaEnCurso = actual
  await actual
}

watch(verEliminados, cargar)

function upsertLocal(saved: Regla) {
  const idx = descuentos.value.findIndex(d => d.id === saved.id)
  const prev = idx >= 0 ? descuentos.value[idx] : null
  const merged: Regla = {
    ...(prev ?? { tramos: [], metodoPagoIds: [] }),
    ...saved,
    tramos: saved.tramos ?? prev?.tramos ?? [],
    metodoPagoIds: saved.metodoPagoIds ?? prev?.metodoPagoIds ?? [],
    tipoRegla: saved.tipoRegla ?? prev?.tipoRegla,
  }
  if (idx >= 0) {
    descuentos.value[idx] = merged
  }
  else {
    descuentos.value.push(merged)
  }
  descuentos.value = [...descuentos.value].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es'),
  )
}

function removeLocal(id: string) {
  descuentos.value = descuentos.value.filter(d => d.id !== id)
}

async function cargarTipos() {
  try {
    const data = await useApiFetch<TipoRegla[]>(`${apiUrl}/tipos-regla?clase=descuento`)
    tipos.value = data.map(t => ({ label: t.nombre, value: t.id, codigo: t.codigo, descripcion: t.descripcion ?? null }))
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar tipos de descuento')
    toast.add({ title: msg, color: 'error' })
  }
}

async function cargarMetodos() {
  try {
    const data = await useApiFetch<{ metodoPagoId: string; nombre: string; habilitada: boolean }[]>(
      `${apiUrl}/metodos-pago`,
    )
    metodos.value = data
      .filter(m => m.habilitada)
      .map(m => ({ label: m.nombre, value: m.metodoPagoId }))
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar métodos de pago')
    toast.add({ title: msg, color: 'error' })
  }
}

function abrirCrear() {
  resetDrawer()
  drawerOpen.value = true
}

function abrirEditar(d: Regla) {
  if (d.eliminadoEl) return
  resetDrawer()
  editingId.value = d.id
  form.value = {
    nombre: d.nombre,
    tipoReglaId: d.tipoReglaId,
    nivel: d.nivel ?? 'linea',
    modo: d.modo ?? '',
    valorMonto: d.valorMonto ?? '',
    valorPorcentaje: d.valorPorcentaje ?? '',
    metodoPagoIds: d.metodoPagoIds ?? [],
    // La forma sale de la fila, no de un campo propio: tener escalones ES
    // descontar por escalones, y el backend garantiza que no haya fila con las dos.
    formaImporte: d.tramos?.length ? 'tramos' as const : 'valor' as const,
    tramos: d.tramos?.map(t => ({
      // El form guarda UN campo `minimo`: cuál de las dos columnas lo llena lo
      // decide el tipo de la regla, y el body lo vuelve a separar al guardar.
      minimo: t.minimoCantidad ?? t.minimoMonto ?? '',
      valorMonto: t.valorMonto ?? '',
      valorPorcentaje: t.valorPorcentaje ?? '',
    })) ?? [],
    diasVencimiento: d.diasVencimiento ?? null,
    fechaInicio: d.fechaInicio ?? null,
    fechaFin: d.fechaFin ?? null,
    activo: d.activo,
  }
  nivelTocado.value = true
  drawerOpen.value = true
}

async function checkNombre() {
  if (!form.value.nombre) { nombreError.value = null; return }
  try {
    const params = new URLSearchParams({ nombre: form.value.nombre })
    if (editingId.value) params.append('excludeId', editingId.value)
    const res = await useApiFetch<{ disponible: boolean }>(
      `${apiUrl}/descuentos/nombre-disponible?${params}`,
    )
    nombreError.value = res.disponible ? null : 'Ya existe un descuento con este nombre'
  }
  catch {
    // don't block the form on a check failure
  }
}

/**
 * ¿Corresponde nombrar los ítems en el error del guardado? Solo en la transición
 * que puede producir el 400 del guard de nivel: editar una regla que no era de
 * venta y pasarla a venta.
 *
 * ⚠️ **La condición es la TRANSICIÓN, no el error**, y es a propósito: dentro de
 * esa transición cualquier fallo —un nombre repetido, un 500— sale con la lista
 * pegada. Se aceptó porque la frase *"Lo tienen: …"* es **cierta igual** (esos
 * ítems tienen la regla, falle lo que falle) y la alternativa era matchear el
 * texto del mensaje del backend, que se desincroniza sin que nada avise.
 *
 * El armado del mensaje vive en `useNivelRegla`; acá queda solo el cuándo, que
 * es lo único propio de esta pantalla.
 */
async function descripcionDeUso(): Promise<string | undefined> {
  if (!editingId.value || form.value.nivel !== 'venta') return undefined
  const previo = descuentos.value.find(x => x.id === editingId.value)
  if ((previo?.nivel ?? 'linea') === 'venta') return undefined
  return itemsQueLoTienen('descuentos', editingId.value)
}

async function guardar() {
  await checkNombre()
  if (nombreError.value) return

  saving.value = true
  try {
    const cfg = config.value
    const body: Record<string, unknown> = {
      nombre: form.value.nombre,
      tipoReglaId: form.value.tipoReglaId,
      nivel: form.value.nivel,
      activo: form.value.activo,
    }

    if (cfg) {
      if (cfg.modo === 'libre') body.modo = form.value.modo
      // Solo la columna del modo. Mandar las dos —o la abandonada en `''`— es
      // 400: el backend rechaza el importe expresado en dos unidades.
      const enMonto = form.value.modo === 'monto_fijo'
      if (mostrarValor.value) {
        if (enMonto) body.valorMonto = form.value.valorMonto
        else body.valorPorcentaje = form.value.valorPorcentaje
      }
      // Pasar a escalones tiene que APAGAR el valor único explícitamente. Sin
      // este `null`, un PATCH que solo agrega tramos deja la fila con las dos
      // formas llenas y el backend lo rechaza con 400 — el usuario vería
      // "se expresa de una sola forma" sin entender cuál es la otra.
      else if (eligeForma.value) {
        if (enMonto) body.valorMonto = null
        else body.valorPorcentaje = null
      }
      if (cfg.campoMetodos) body.metodoPagoIds = form.value.metodoPagoIds
      if (mostrarTramos.value) {
        // El umbral va en la columna que corresponde al TIPO (por_mayor mide
        // cantidad; el resto, monto de venta), que es un eje distinto del
        // `modo` que decide el importe. Mandar la columna equivocada es 400.
        const umbralEnMonto = tipoSeleccionado.value?.codigo !== 'por_mayor'
        body.tramos = form.value.tramos.map((t) => {
          const minimo = umbralEnMonto
            ? { minimoMonto: t.minimo }
            : { minimoCantidad: t.minimo }
          return enMonto
            ? { ...minimo, valorMonto: t.valorMonto }
            : { ...minimo, valorPorcentaje: t.valorPorcentaje }
        })
      }
      // La vuelta del interruptor: volver a valor único BORRA los escalones
      // guardados. El `[]` explícito es lo único que los limpia — omitir la key
      // los deja intactos (el backend solo reemplaza hijos que vengan en el DTO).
      else if (eligeForma.value) {
        body.tramos = []
      }
      if (cfg.campoDias) body.diasVencimiento = form.value.diasVencimiento
      if (cfg.campoFechaInicio) body.fechaInicio = form.value.fechaInicio || null
      if (cfg.campoFechaFin) body.fechaFin = form.value.fechaFin || null
    }

    const isNew = !editingId.value
    const saved = isNew
      ? await useApiFetch<Regla>(`${apiUrl}/descuentos`, { method: 'POST', body })
      : await useApiFetch<Regla>(`${apiUrl}/descuentos/${editingId.value}`, {
          method: 'PATCH',
          body,
        })
    upsertLocal(saved)
    toast.add({ title: isNew ? 'Descuento creado' : 'Descuento actualizado', color: 'success' })
    drawerOpen.value = false
  }
  catch (e: unknown) {
    toast.add({
      title: apiErrorMsg(e, 'Error al guardar'),
      description: await descripcionDeUso(),
      color: 'error',
    })
  }
  finally {
    saving.value = false
  }
}

function pedirEliminar(d: Regla) {
  if (d.eliminadoEl) return
  confirmDeleteId.value = d.id
  confirmModalOpen.value = true
}

async function eliminar(id: string) {
  try {
    await useApiFetch(`${apiUrl}/descuentos/${id}`, {
      method: 'DELETE',
    })
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
    toast.add({ title: 'Descuento eliminado', color: 'success' })
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al eliminar')
    toast.add({ title: msg, color: 'error' })
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
 * A diferencia de `impuestos.vue`, el catch NO cierra todo y tira un toast
 * rojo: un 400 de colisión no es un error terminal sino una pregunta —qué
 * nombre querés usar—, así que abre el segundo modal con la sugerencia del
 * backend. Solo los errores de verdad (404 "no está en la papelera", red)
 * terminan en toast.
 */
async function restaurarDescuento(id: string, nombreNuevo?: string) {
  // El modal no se cierra solo al confirmar (lo cierran las funciones de acá),
  // así que mientras el POST viaja el segundo click manda un segundo
  // `POST .../restaurar` sobre una fila que el primero ya revivió: el backend
  // contesta 404 "no está en la papelera" y el usuario ve un toast de ERROR
  // inmediatamente después de un restore exitoso.
  //
  // ⚠️ Medido con mutantes: este guard y el `:loading="restaurando"` de los dos
  // modales se tapan MUTUAMENTE — `loading` deshabilita el botón, así que sacar
  // cualquiera de los dos por separado deja el test en verde y solo sacando los
  // dos se rompe. No es redundancia muerta: `loading` es de un botón concreto
  // del template y este guard cubre la función, que también entra por
  // `confirmarColision` (otro botón, otro modal). El test fija la CONDUCTA —un
  // solo POST—, no cuál de las dos capas la sostiene.
  if (restaurando.value) return
  restaurando.value = true
  try {
    await restaurar(id, nombreNuevo)
    const d = descuentos.value.find(x => x.id === id)
    if (d) {
      d.eliminadoEl = null
      d.eliminadoPorNombre = null
      if (nombreNuevo) {
        // El backend solo devuelve 2xx si aplicó ESE nombre, así que el patch
        // local no adivina. Reordenar hace falta porque el listado viene
        // ordenado por nombre y el renombre lo puede mover de lugar.
        d.nombre = nombreNuevo
        descuentos.value = [...descuentos.value].sort((a, b) =>
          a.nombre.localeCompare(b.nombre, 'es'),
        )
      }
    }
    toast.add({ title: 'Descuento restaurado', color: 'success' })
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
  restaurarDescuento(id, nombre)
}

function agregarTramo() {
  form.value.tramos = [...form.value.tramos, { minimo: '', valorMonto: '', valorPorcentaje: '' }]
}

function eliminarTramo(i: number) {
  form.value.tramos = form.value.tramos.filter((_, idx) => idx !== i)
}

onMounted(() => {
  cargar()
  cargarTipos()
  cargarMetodos()
})

const columns: TableColumn<Regla>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { id: 'activo', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Descuentos"
      description="Reglas de descuento aplicables en el cálculo de precios."
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
            Nuevo descuento
          </UButton>
        </div>
      </template>
    </CrudPageHeader>

    <CrudTable :data="descuentos" :columns="columns" :loading="loading">
        <template #nombre-cell="{ row }">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <p class="font-medium truncate">
                {{ row.original.nombre }}
              </p>
              <UBadge v-if="row.original.eliminadoEl" color="neutral" variant="subtle">
                Eliminado
              </UBadge>
              <UBadge
                v-if="estadoVigencia(row.original.fechaInicio, row.original.fechaFin) !== 'vigente'"
                :color="vigenciaColor(row.original.fechaInicio, row.original.fechaFin)"
                variant="subtle"
              >
                {{ vigenciaLabel(row.original.fechaInicio, row.original.fechaFin) }}
              </UBadge>
              <UBadge
                v-if="nivelLabel(row.original.nivel)"
                color="neutral"
                variant="outline"
              >
                {{ nivelLabel(row.original.nivel) }}
              </UBadge>
            </div>
            <p v-if="row.original.eliminadoEl" class="text-xs text-muted">
              {{ formatearBorradoPor(row.original) }}
            </p>
            <p class="text-sm text-muted">
              <template v-if="row.original.tramos?.length">
                {{ row.original.tramos.length }} tramo{{ row.original.tramos.length !== 1 ? 's' : '' }}
              </template>
              <template v-else-if="row.original.valorPorcentaje || row.original.valorMonto">
                {{ row.original.valorPorcentaje ? `${(Number(row.original.valorPorcentaje) * 100).toFixed(0)}%` : row.original.valorMonto }}
                ({{ row.original.valorPorcentaje ? 'porcentaje' : 'monto fijo' }})
              </template>
              <template v-else>
                {{ row.original.metodoPagoIds?.length ? `${row.original.metodoPagoIds.length} método(s) de pago` : '—' }}
              </template>
            </p>
            <p class="text-xs text-muted">
              {{ tipos.find(t => t.value === row.original.tipoReglaId)?.label ?? '' }}
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
          No hay descuentos registrados.
        </div>
      </template>
    </CrudTable>

    <AppDrawer v-model:open="drawerOpen" width="50%">
      <template #header>
        <span class="font-semibold text-default">{{ drawerTitle }}</span>
      </template>

      <template #body>
        <UForm
          id="descuento-form"
          :state="form"
          class="space-y-4"
          @submit="guardar"
        >
          <!-- Nombre (always visible) -->
          <UFormField label="Nombre" required :error="nombreError ?? undefined">
            <UInput
              v-model="form.nombre"
              placeholder="Mi descuento"
              autofocus
              @blur="checkNombre"
            />
          </UFormField>

          <!-- Tipo (always visible) -->
          <UFormField label="Tipo" required>
            <USelectMenu
              :model-value="form.tipoReglaId"
              :items="tipos"
              label-key="label"
              value-key="value"
              placeholder="Selecciona un tipo"
              @update:model-value="onTipoChange"
            />
            <p
              v-if="tipoSeleccionado?.descripcion"
              class="mt-1.5 text-xs text-muted leading-snug"
            >
              {{ tipoSeleccionado.descripcion }}
            </p>
          </UFormField>

          <!-- Nivel: dónde se aplica. Va después del Tipo y fuera del `v-if` de
               `config`, porque no depende del tipo elegido: toda regla se aplica
               en un lado o en el otro, y el backend rechaza usarla por la puerta
               que no es. -->
          <UFormField label="Se aplica" required>
            <URadioGroup
              :model-value="form.nivel"
              :items="nivelOptions"
              value-key="value"
              @update:model-value="onNivelChange"
            />
          </UFormField>

          <!-- Only show the rest if a tipo is selected and config is resolved -->
          <template v-if="config">
            <!-- Modo — only when libre -->
            <UFormField v-if="config.modo === 'libre'" label="Modo" required>
              <URadioGroup
                :model-value="form.modo"
                :items="modoOptions"
                orientation="horizontal"
                @update:model-value="onModoChange"
              />
            </UFormField>

            <!-- Cómo descuenta — solo en los tipos que admiten las dos formas. -->
            <UFormField v-if="eligeForma" label="Cómo descuenta" required>
              <URadioGroup
                v-model="form.formaImporte"
                :items="formaImporteOptions"
                value-key="value"
                orientation="horizontal"
              />
            </UFormField>

            <!-- Valor — when campoValor. Cada modo escribe SU campo: `valorMonto`
                 es plata y va con máscara de moneda, `valorPorcentaje` es un decimal
                 y no la lleva. Ya no es la única capa que los distingue —el backend
                 valida cada columna, y la escala de `valorMonto` la rechaza en el
                 borde—; acá el `v-if` elige el input que corresponde. -->
            <UFormField v-if="mostrarValor" :label="config.labelValor ?? 'Valor'" required>
              <MoneyInput
                v-if="form.modo === 'monto_fijo'"
                v-model="form.valorMonto"
                oficial
              />
              <UInput
                v-else
                v-model="form.valorPorcentaje"
                inputmode="decimal"
                placeholder="0.10 (= 10%)"
              />
              <template v-if="form.modo === 'porcentaje'" #hint>
                Expresar en decimal: 0.10 = 10%
              </template>
            </UFormField>

            <!-- Métodos de pago — when campoMetodos -->
            <UFormField v-if="config.campoMetodos" label="Métodos de pago" required>
              <USelectMenu
                v-model="form.metodoPagoIds"
                :items="metodos"
                label-key="label"
                value-key="value"
                multiple
                placeholder="Selecciona uno o más métodos"
              />
            </UFormField>

            <!-- Días de vencimiento — when campoDias -->
            <UFormField v-if="config.campoDias" :label="config.labelDias ?? 'Días de vencimiento'" required>
              <UInput
                v-model.number="form.diasVencimiento"
                type="number"
                :min="config.diasMin"
                :max="config.diasMax"
                placeholder="30"
              />
            </UFormField>

            <!-- Tramos table — when campoTramos -->
            <div v-if="mostrarTramos" class="space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium">Tramos</span>
                <UButton size="xs" icon="i-lucide-plus" variant="ghost" @click="agregarTramo">
                  Agregar tramo
                </UButton>
              </div>
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-left text-muted">
                    <th class="pb-1">{{ config.labelTramos ?? 'Mínimo' }}</th>
                    <th class="pb-1">{{ form.modo === 'porcentaje' ? 'Porcentaje' : 'Monto' }}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(tramo, i) in form.tramos" :key="i" class="border-t border-default">
                    <td class="py-1 pr-2">
                      <!-- "Mínimo" es plata SOLO en `por_monto_venta` (el propio
                           `labelTramos` lo dice: "Monto mínimo"); en `por_mayor` es
                           una cantidad ("Cantidad mínima"). El código del tipo, no el
                           label de UI, decide la máscara. -->
                      <!-- La MISMA condición que elige la columna al guardar (ver el
                           body de `guardar`): si las dos se separan, la pantalla ofrece
                           una máscara y el backend espera la otra columna. -->
                      <MoneyInput v-if="tipoSeleccionado?.codigo !== 'por_mayor'" v-model="tramo.minimo" oficial class="w-full" />
                      <UInput v-else v-model="tramo.minimo" inputmode="decimal" placeholder="0" class="w-full" />
                    </td>
                    <td class="py-1 pr-2">
                      <MoneyInput v-if="form.modo === 'monto_fijo'" v-model="tramo.valorMonto" oficial class="w-full" />
                      <UInput v-else v-model="tramo.valorPorcentaje" inputmode="decimal" placeholder="0.10 (= 10%)" class="w-full" />
                    </td>
                    <td class="py-1">
                      <UButton
                        icon="i-lucide-trash-2"
                        color="error"
                        variant="ghost"
                        size="xs"
                        @click="eliminarTramo(i)"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-if="!form.tramos.length" class="text-xs text-muted">
                Sin tramos. Agrega al menos uno.
              </p>
            </div>

            <!-- Fechas -->
            <div v-if="config.campoFechaInicio || config.campoFechaFin" class="grid grid-cols-2 gap-4">
              <UFormField v-if="config.campoFechaInicio" label="Fecha inicio" :required="config.fechasRequeridas">
                <AppDateInput
                  :model-value="form.fechaInicio"
                  qa="descuento-fecha-inicio"
                  @update:model-value="form.fechaInicio = $event || null"
                />
              </UFormField>
              <UFormField v-if="config.campoFechaFin" label="Fecha fin" :required="config.fechasRequeridas">
                <AppDateInput
                  :model-value="form.fechaFin"
                  qa="descuento-fecha-fin"
                  @update:model-value="form.fechaFin = $event || null"
                />
              </UFormField>
            </div>
          </template>

          <!-- Activo -->
          <UFormField label="Activo">
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
          form="descuento-form"
          :loading="saving"
        >
          {{ submitLabel }}
        </UButton>
      </template>
    </AppDrawer>

    <CrudPausarModal
      v-model:open="confirmPausarModalOpen"
      :nombre="confirmPausarNombre"
      :items="confirmPausarItems"
      :nivel="confirmPausarNivel"
      @cancel="cerrarPausar"
      @confirm="confirmarPausar"
    />

    <CrudModal
      v-model:open="confirmModalOpen"
      title="Eliminar descuento"
      message="¿Eliminar este descuento? Podés recuperarlo desde «Ver eliminados»."
      @cancel="confirmDeleteId = null"
      @confirm="confirmDeleteId && eliminar(confirmDeleteId)"
    />

    <CrudModal
      v-model:open="confirmRestaurarModalOpen"
      title="Restaurar descuento"
      message="¿Restaurar este descuento? Volverá a aparecer en el listado y podrá usarse de nuevo."
      confirm-label="Restaurar"
      confirm-color="neutral"
      :loading="restaurando"
      @cancel="cerrarRestaurar"
      @confirm="confirmRestaurarId && restaurarDescuento(confirmRestaurarId)"
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
