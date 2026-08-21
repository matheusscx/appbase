<script setup lang="ts">
import Decimal from 'decimal.js'
import type { TableColumn } from '@nuxt/ui'
import { formatCantidadLinea } from '~/utils/cantidad-presentacion'

interface PagoAplicacion {
  tipo: string
  monto: string
  referenciaId: string | null
}

interface Pago {
  id: string
  metodoPagoId: string
  monto: string
  vuelto: string
  fecha: string
  referencia: string | null
  aplicaciones?: PagoAplicacion[]
  montoAplicadoVenta?: string
  montoAplicadoPropina?: string
}

interface PropinaVenta {
  id: string
  porcentajeSugerido: string
  montoSugerido: string
  montoPagado: string
  tipo: string
  estado: string
  garzonId: string
  garzonNombre: string | null
  sesionGarzonId?: string | null
  turnoId?: string | null
  tipoGarzon?: string | null
  liquidacionId?: string | null
}

interface Detalle {
  id: string
  itemId: string
  descripcion: string
  cantidad: string
  cantidadPresentacion?: string | null
  unidadCodigoPresentacion?: string | null
  precioUnitario: string
  /** Unidad en la que está `cantidad`, congelada al vender. */
  unidadCodigoBase: string
  /** Neto de la línea: el punto de partida del que salen las reglas. */
  subtotal: string
  totalLinea: string
  modoInventario: string | null
  cantidadDevuelta: string
}

/**
 * Una regla tal como quedó CONGELADA en la venta. El nombre, el modo y el valor
 * son los del momento del cobro: el catálogo pudo cambiarlos o borrar la regla.
 * No consultar `descuentos`/`recargos`/`impuestos` para mostrar esto.
 */
interface ReglaCongelada {
  id: string
  detalleId: string | null
  nombreRegla: string
  /** `'porcentaje' | 'monto_fijo'`. Ausente en impuestos: siempre son porcentaje. */
  modo?: string
  valorAplicado: string
  /** Solo descuentos: lo que la regla pedía antes del piso en cero. */
  valorSolicitado?: string
  /** Decimal (0.19 = 19%). `null` cuando la regla era de monto fijo. */
  porcentajeAplicado: string | null
  aplicadoEn: string
}

interface Reembolso {
  id: string
  monto: string
  estado: string
  fecha: string
  ordenId: string
  codigoOrden: string
}

interface NotaCredito {
  id: string
  totalFinal: string
  fecha: string
  comentario: string | null
}

interface VentaDetalle {
  id: string
  canal: string
  estado: string
  fecha: string
  creadoEl: string
  totalBruto: string
  totalDescuentos: string
  totalRecargos: string
  totalImpuestos: string
  totalFinal: string
  ventaReferenciaId: string | null
  tipoDocumento: { id: string, codigo: string | null, nombre: string | null } | null
  /** Lo calcula el backend contra el id del tipo de documento, no contra `codigo`. */
  esNotaCredito: boolean
  reembolsos: Reembolso[]
  notasCredito: NotaCredito[]
  detalles: Detalle[]
  descuentos: ReglaCongelada[]
  recargos: ReglaCongelada[]
  impuestos: ReglaCongelada[]
  /**
   * La config con la que se calculó, congelada. `formula` es el orden en que se
   * aplicaron los pasos y es lo que ordena el desglose; los dos `calculo*` son
   * `'base' | 'compuesto'` y explican por qué un mismo porcentaje da montos
   * distintos. `null` en las ventas anteriores al congelado. Las notas de
   * crédito congelan la suya propia, heredada de la venta que corrigen.
   */
  configCalculo: {
    formula: string[]
    calculoDescuentos: string
    calculoRecargos: string
    /** Decimales con los que se calculó, y cómo se redondeó el último. */
    escalaCalculo: number
    modoRedondeo: string
  } | null
  pagos: Pago[]
  customer: { nombre: string; rut?: string } | null
  propina: PropinaVenta | null
}

interface MetodoPago {
  metodoPagoId: string
  nombre: string
  permiteVuelto: boolean
  habilitada: boolean
}

const props = defineProps<{
  ventaId: string | null
}>()

export interface VentaDetallePatch {
  id: string
  estado: string
  montoPagado: string
  saldo: string
}

const emit = defineEmits<{ updated: [VentaDetallePatch] }>()
const open = defineModel<boolean>('open', { required: true })

const config = useRuntimeConfig()
const toast = useToast()
const cajaStore = useCajaStore()
const unidadesStore = useUnidadesMedidaStore()
const { formatMonto, formatFecha, formatPorcentaje } = useFormatters()
const apiUrl = config.public.apiUrl

const venta = ref<VentaDetalle | null>(null)
const metodos = ref<MetodoPago[]>([])
const loading = ref(false)
const abonoOpen = ref(false)
const ncOpen = ref(false)
const anularOpen = ref(false)
const permissionsStore = usePermissionsStore()

const montoPagado = computed(() => {
  if (!venta.value) return '0'
  return venta.value.pagos.reduce((acc, p) => {
    // Preferir aplicaciones tipo venta (excluye propina del saldo de la venta).
    if (p.montoAplicadoVenta != null) {
      return new Decimal(acc).plus(p.montoAplicadoVenta).toString()
    }
    return new Decimal(acc).plus(new Decimal(p.monto)).minus(new Decimal(p.vuelto ?? '0')).toString()
  }, '0')
})

const saldo = computed(() => {
  if (!venta.value) return '0'
  return Decimal.max(0, new Decimal(venta.value.totalFinal).minus(new Decimal(montoPagado.value))).toString()
})

const puedeAbonar = computed(() =>
  !!venta.value && ['pendiente', 'pagada_parcial'].includes(venta.value.estado),
)

// Del backend: `codigo` es nullable y varía por país, así que reconstruirlo acá
// daba un resultado distinto al del listado sobre la misma venta.
const esNotaCredito = computed(() => venta.value?.esNotaCredito === true)

// Máximo emitible: total de la venta menos las NCs ya emitidas (validado también en backend)
const disponibleNC = computed(() => {
  if (!venta.value) return '0'
  const previas = venta.value.notasCredito.reduce(
    (acc, nc) => new Decimal(acc).plus(nc.totalFinal).toString(),
    '0',
  )
  return Decimal.max(0, new Decimal(venta.value.totalFinal).minus(previas)).toString()
})

const puedeCrearNC = computed(() =>
  !!venta.value
  && ['pagada', 'pagada_parcial'].includes(venta.value.estado)
  && !esNotaCredito.value
  && new Decimal(disponibleNC.value).gt(0)
  && permissionsStore.can('Ventas', 'Nota de crédito'),
)

/**
 * Espeja el subconjunto seguro que valida el backend: pendiente, sin pagos y sin
 * documento tributario. El backend es el que manda (el guard vive ahí); esto
 * evita ofrecer un botón que siempre daría 400.
 */
const puedeAnular = computed(() =>
  !!venta.value
  && venta.value.estado === 'pendiente'
  && venta.value.pagos.length === 0
  && !venta.value.tipoDocumento
  && permissionsStore.can('Ventas', 'Anular'),
)

const totalReembolsado = computed(() => {
  if (!venta.value) return '0'
  return venta.value.reembolsos
    .filter(r => r.estado === 'aprobada')
    .reduce((acc, r) => new Decimal(acc).plus(r.monto).toString(), '0')
})

// Derivado de las transacciones de pasarela: NO es un estado de la venta en BD
const leyendaReembolso = computed(() => {
  if (!venta.value) return null
  const total = new Decimal(totalReembolsado.value)
  if (total.lte(0)) return null
  return total.gte(venta.value.totalFinal) ? 'Reembolsada totalmente' : 'Reembolsada parcialmente'
})

function reembolsoColor(estado: string): 'success' | 'error' | 'warning' | 'neutral' {
  const map: Record<string, 'success' | 'error' | 'warning'> = {
    aprobada: 'success',
    rechazada: 'error',
    error: 'warning',
  }
  return map[estado] ?? 'neutral'
}

const { estadoColor, estadoLabel } = useEstadoVenta()

function cantidadDetalleLabel(det: Detalle): string {
  // La unidad que se va a mostrar decide si lleva sufijo: la de presentación si
  // la línea se vendió así, si no la base congelada en el detalle.
  const unidadMostrada = det.cantidadPresentacion && det.unidadCodigoPresentacion
    ? det.unidadCodigoPresentacion
    : det.unidadCodigoBase
  return formatCantidadLinea(
    det.cantidad,
    det.cantidadPresentacion,
    det.unidadCodigoPresentacion,
    unidadesStore.esFraccionaria(unidadMostrada),
    det.unidadCodigoBase,
  )
}

/**
 * Líneas y reglas comparten UNA tabla: cada ítem con su total, y colgando de
 * él, el neto del que partió y las reglas que lo movieron hasta ese total.
 * Estaban en dos tarjetas y eso repetía el nombre del ítem y su total, además
 * de separar las reglas de la línea que explican.
 *
 * El desglose viene **plegado**: una venta de 10 líneas no puede abrirse en 40
 * filas para responder "¿qué se vendió?". Se expande por línea, y solo las que
 * tienen reglas ofrecen el toggle.
 *
 * ⛔ **El monto de la fila del ítem va rotulado `total` en la propia celda.**
 * Sin rótulo, ese número al lado de `Cantidad` y `Valor` invita a leer una
 * multiplicación que **no cierra en el caso normal** —el IVA se suma sobre el
 * precio, así que 1 × $1.500 termina en $1.785—, y con el neto ahí fallaba por
 * desbruteo. Dos versiones de esta tabla murieron por eso, la segunda
 * justamente por haber quitado los rótulos `Precio unit.`/`Total línea` que
 * desambiguaban. El rótulo va en la celda y no en la cabecera porque la columna
 * sirve a dos cosas: totales de línea y montos de regla.
 */
type TipoFila = 'linea' | 'neto' | 'regla' | 'venta'

interface FilaDetalle {
  clave: string
  tipoFila: TipoFila
  /** Nombre del ítem, o de la regla cuando cuelga de uno. */
  concepto: string
  /** Familia de la regla; `null` en las filas de ítem. */
  familia: string | null
  cantidad: string | null
  /** Precio unitario en un ítem; con qué valor aplicó en una regla. */
  valor: string | null
  monto: string | null
  /** Rótulo EN LÍNEA con el monto. Hoy: `Total` en la fila del ítem. */
  rotuloMonto: string | null
  /** `-` en descuentos, `+` en recargos e impuestos, vacío en ítems. */
  signo: string
  /** Presente solo si el piso en cero recortó la regla. */
  recorte: string | null
  /** La regla se evaluó y no aportó nada. Se muestra, atenuada. */
  sinEfecto: boolean
}

/**
 * Orden por defecto para ventas sin `configCalculo`: las anteriores al
 * congelado. Las notas de crédito también lo tienen null, pero ahí es
 * decorativo — no escriben filas de reglas, así que no hay nada que ordenar.
 */
const FORMULA_DEFAULT = ['descuentos', 'recargos', 'impuestos']

const PASO_A_TIPO: Record<string, string> = {
  descuentos: 'Descuento',
  recargos: 'Recargo',
  impuestos: 'Impuesto',
}

/**
 * El código crudo más una frase corta. El código se muestra igual porque es lo
 * que dice Preferencias financieras, que es donde se configura: quien viene a
 * explicar un descuadre tiene que poder cruzar las dos pantallas sin traducir.
 */
const MODO_REDONDEO_LABEL: Record<string, string> = {
  HALF_UP: 'HALF_UP · en empate, hacia arriba',
  HALF_EVEN: 'HALF_EVEN · en empate, al par (bancario)',
  FLOOR: 'FLOOR · siempre hacia abajo',
  CEIL: 'CEIL · siempre hacia arriba',
}

function filaDeRegla(familia: string, r: ReglaCongelada): FilaDetalle {
  // Un `porcentaje_aplicado` null puede ser "era monto fijo" o "era porcentaje
  // y no llegó a aplicar"; `modo` es lo que los distingue. El segundo caso se
  // nombra: un guion al lado de una regla llamada "Solo transferencia 5%" hace
  // dudar de si el dato se perdió, cuando lo que pasó es que no corrió.
  const valor = r.porcentajeAplicado !== null
    ? formatPorcentaje(r.porcentajeAplicado)
    : r.modo === 'monto_fijo' ? 'Monto fijo' : 'No aplicó'

  // Solo los descuentos los topea el piso en cero, y solo cuando pedían más de
  // lo que había disponible.
  const pedido = r.valorSolicitado
  const recorte = pedido && new Decimal(pedido).greaterThan(r.valorAplicado)
    ? `pedía ${formatMonto(pedido)}`
    : null

  return {
    clave: r.id,
    tipoFila: 'regla',
    concepto: r.nombreRegla,
    familia,
    cantidad: null,
    valor,
    monto: r.valorAplicado,
    rotuloMonto: null,
    // El signo lo pone la familia, no el monto: el motor nunca guarda
    // magnitudes negativas. Sin él, un descuento y un recargo del mismo valor
    // se ven idénticos salvo por el color del badge.
    signo: familia === 'Descuento' ? '-' : '+',
    recorte,
    sinEfecto: new Decimal(r.valorAplicado).isZero(),
  }
}

/**
 * Qué líneas tienen el desglose abierto. Se vacía al cargar otra venta: dejarlo
 * con ids de la venta anterior abriría filas que ya no existen.
 */
const expandidas = ref(new Set<string>())

function alternarDesglose(detalleId: string) {
  const abiertas = new Set(expandidas.value)
  if (!abiertas.delete(detalleId)) abiertas.add(detalleId)
  expandidas.value = abiertas
}

/** Una línea sin reglas no tiene nada que desplegar. */
const lineasConReglas = computed<Set<string>>(() => {
  const v = venta.value
  if (!v) return new Set()
  return new Set(
    [...v.descuentos, ...v.recargos, ...v.impuestos]
      .map(r => r.detalleId)
      .filter((id): id is string => id !== null),
  )
})

/** El orden real de los pasos en esta venta, con nombres presentables. */
const formulaVenta = computed<string[]>(
  () => venta.value?.configCalculo?.formula ?? FORMULA_DEFAULT,
)

/**
 * El orden con el que se aplicó cada paso y sobre qué base. Mismo vocabulario
 * que Preferencias financieras ("Sobre monto base" / "En cascada"), porque es
 * ahí donde se configura y donde el lector lo va a reconocer.
 *
 * `base` y `cascada` no son decoración: un recargo del 5% sobre una línea ya
 * descontada da distinto según cuál sea, y el porcentaje congelado es el mismo
 * en los dos casos. Los impuestos no llevan modo —siempre van sobre el
 * acumulado del paso— y una venta sin config no muestra ninguno, en vez de
 * inventar el default.
 */
const ordenPasos = computed(() =>
  formulaVenta.value.map((paso) => {
    const cfg = venta.value?.configCalculo
    const modo = paso === 'descuentos'
      ? cfg?.calculoDescuentos
      : paso === 'recargos' ? cfg?.calculoRecargos : null
    const etiqueta = PASO_A_TIPO[paso] ?? paso
    if (!modo) return etiqueta
    return `${etiqueta} (${modo === 'compuesto' ? 'cascada' : 'base'})`
  }),
)

/**
 * La tabla entera: cada ítem seguido de sus reglas, y al final las de nivel
 * venta, que no cuelgan de ninguna línea (`detalleId` null).
 *
 * ⚠️ Armarla así **descarta** cualquier regla cuyo `detalleId` no esté entre los
 * detalles de la venta: desaparecería de la pantalla sin aviso. Se apoya en que
 * nada soft-borra un `venta_detalles` y en que las tres queries de reglas están
 * scopeadas por `venta_id`, así que ese estado no existe. Si algún día se
 * borran detalles, hay que decidir qué pasa con sus reglas antes que esto.
 */
const filasDetalle = computed<FilaDetalle[]>(() => {
  const v = venta.value
  if (!v) return []

  const porPaso: Record<string, ReglaCongelada[]> = {
    descuentos: v.descuentos,
    recargos: v.recargos,
    impuestos: v.impuestos,
  }

  // Recorre los pasos en el orden de la fórmula y se queda con las reglas de
  // un `detalleId` dado: así cada ítem las lleva en el orden en que corrieron.
  const reglasDe = (detalleId: string | null): FilaDetalle[] =>
    formulaVenta.value.flatMap((paso) => {
      const familia = PASO_A_TIPO[paso]
      if (!familia) return []
      return (porPaso[paso] ?? [])
        .filter(r => r.detalleId === detalleId)
        .map(r => filaDeRegla(familia, r))
    })

  const filas = v.detalles.flatMap<FilaDetalle>((d) => {
    const reglas = reglasDe(d.id)
    const linea: FilaDetalle = {
      clave: d.id,
      tipoFila: 'linea',
      concepto: d.descripcion,
      familia: null,
      cantidad: cantidadDetalleLabel(d),
      valor: d.precioUnitario,
      monto: d.totalLinea,
      rotuloMonto: 'Total',
      signo: '',
      recorte: null,
      sinEfecto: false,
    }
    // Sin reglas no hay nada que expandir: el neto ya es el total.
    if (!reglas.length || !expandidas.value.has(d.id)) return [linea]
    return [
      linea,
      {
        clave: `${d.id}-neto`,
        tipoFila: 'neto',
        concepto: 'Neto',
        familia: null,
        cantidad: null,
        valor: null,
        monto: d.subtotal,
        rotuloMonto: null,
        signo: '',
        recorte: null,
        sinEfecto: false,
      },
      ...reglas,
    ]
  })

  const deVenta = reglasDe(null)
  if (deVenta.length) {
    filas.push({
      clave: 'venta',
      tipoFila: 'venta',
      concepto: 'Toda la venta',
      familia: null,
      cantidad: null,
      valor: null,
      // Sin monto: estas reglas no cierran contra una línea, cierran contra
      // los totales de abajo. Inventar un subtotal acá sería un número nuevo.
      monto: null,
      rotuloMonto: null,
      signo: '',
      recorte: null,
      sinEfecto: false,
    })
    filas.push(...deVenta)
  }

  return filas
})

const detalleColumns: TableColumn<FilaDetalle>[] = [
  { accessorKey: 'concepto', header: 'Concepto' },
  { accessorKey: 'cantidad', header: 'Cantidad', meta: { class: { th: 'text-right', td: 'text-right' } } },
  // "Valor" cubre las dos magnitudes que van en esta columna: el precio
  // unitario de un ítem y el `10,00%` con el que aplicó una regla.
  { accessorKey: 'valor', header: 'Valor', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

function familiaColor(familia: string | null): 'success' | 'warning' | 'neutral' {
  if (familia === 'Descuento') return 'success'
  if (familia === 'Recargo') return 'warning'
  return 'neutral'
}

async function cargar(id: string) {
  loading.value = true
  venta.value = null
  expandidas.value = new Set()
  try {
    const [ventaData, metodosData] = await Promise.all([
      useApiFetch<VentaDetalle>(`${apiUrl}/ventas/${id}`),
      useApiFetch<MetodoPago[]>(`${apiUrl}/metodos-pago`),
    ])
    venta.value = ventaData
    metodos.value = metodosData
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al cargar venta')
    toast.add({ title: msg, color: 'error' })
    open.value = false
  }
  finally {
    loading.value = false
  }
}

watch(
  () => [open.value, props.ventaId] as const,
  ([isOpen, id]) => {
    if (isOpen && id) {
      cargar(id)
      void unidadesStore.ensureLoaded()
    }
    else if (!isOpen) {
      venta.value = null
      abonoOpen.value = false
      ncOpen.value = false
    }
  },
)

function emitPatch() {
  if (!venta.value) return
  emit('updated', {
    id: venta.value.id,
    estado: venta.value.estado,
    montoPagado: montoPagado.value,
    saldo: saldo.value,
  })
}

function onAbonoSuccess(payload: {
  pagos: Pago[]
  venta: { id: string, estado: string, saldo: string }
}) {
  abonoOpen.value = false
  if (!venta.value) return
  venta.value.pagos = [...venta.value.pagos, ...payload.pagos]
  venta.value.estado = payload.venta.estado
  const neto = payload.pagos.reduce(
    (acc, p) => acc.plus(p.monto).minus(p.vuelto ?? '0'),
    new Decimal(0),
  )
  cajaStore.aplicarCobroLocal(neto.toFixed(4), payload.pagos.length)
  emitPatch()
}

function onAnularSuccess(payload: { estado: string }) {
  anularOpen.value = false
  if (!venta.value) return
  venta.value.estado = payload.estado
  emitPatch()
}

function onNcSuccess(payload: {
  id: string
  totalFinal: string
  fecha: string
  comentario: string | null
  devoluciones: Array<{ itemId: string, cantidad: string }>
}) {
  ncOpen.value = false
  if (!venta.value) return
  venta.value.notasCredito = [
    ...venta.value.notasCredito,
    {
      id: payload.id,
      totalFinal: payload.totalFinal,
      fecha: payload.fecha,
      comentario: payload.comentario,
    },
  ]
  for (const d of payload.devoluciones) {
    for (const det of venta.value.detalles) {
      if (det.itemId === d.itemId) {
        det.cantidadDevuelta = new Decimal(det.cantidadDevuelta)
          .plus(d.cantidad)
          .toString()
      }
    }
  }
  emitPatch()
}
</script>

<template>
  <AppDrawer v-model:open="open" width="50%">
    <template #header>
      <div class="flex items-center gap-2">
        <span class="font-semibold text-default">Detalle de venta</span>
        <UBadge
          v-if="venta"
          :color="estadoColor(venta.estado)"
          :label="estadoLabel(venta.estado)"
          variant="subtle"
          size="xs"
        />
        <UBadge
          v-if="esNotaCredito"
          color="info"
          label="Nota de Crédito"
          variant="subtle"
          size="xs"
        />
        <UBadge
          v-if="leyendaReembolso"
          color="warning"
          :label="leyendaReembolso"
          variant="subtle"
          size="xs"
        />
      </div>
    </template>

    <template #body>
      <div v-if="loading" class="py-12 text-center text-muted">
        <UIcon name="i-lucide-loader" class="mx-auto mb-2 h-6 w-6 animate-spin" />
        Cargando venta…
      </div>

      <div v-else-if="venta" class="space-y-4">
        <UCard>
          <template #header>
            <h2 class="text-base font-semibold">
              Información general
            </h2>
          </template>
          <dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt class="text-muted">
                Fecha
              </dt>
              <dd class="font-medium">
                {{ formatFecha(venta.fecha) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Canal
              </dt>
              <dd class="font-medium capitalize">
                {{ venta.canal }}
              </dd>
            </div>
            <div v-if="venta.customer">
              <dt class="text-muted">
                Cliente
              </dt>
              <dd class="font-medium">
                {{ venta.customer.nombre }}
                <span v-if="venta.customer.rut" class="ml-1 text-muted">({{ venta.customer.rut }})</span>
              </dd>
            </div>
          </dl>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h2 class="text-base font-semibold">
                Líneas de venta
              </h2>
              <span v-if="filasDetalle.some(f => f.tipoFila === 'regla')" class="text-xs text-muted">
                Reglas del momento del cobro · orden: {{ ordenPasos.join(' → ') }}
              </span>
            </div>
          </template>
          <UTable :data="filasDetalle" :columns="detalleColumns">
            <template #concepto-cell="{ row }">
              <!-- Las reglas y el cierre cuelgan de su ítem: la sangría es la
                   jerarquía, y el ítem es lo único a la izquierda del todo. -->
              <div
                class="flex items-center gap-2"
                :class="row.original.tipoFila === 'linea' || row.original.tipoFila === 'venta' ? '' : 'pl-6'"
              >
                <UButton
                  v-if="row.original.tipoFila === 'linea' && lineasConReglas.has(row.original.clave)"
                  :icon="expandidas.has(row.original.clave) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                  :aria-label="expandidas.has(row.original.clave) ? `Ocultar el desglose de ${row.original.concepto}` : `Ver el desglose de ${row.original.concepto}`"
                  :aria-expanded="expandidas.has(row.original.clave)"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click="alternarDesglose(row.original.clave)"
                />
                <UBadge
                  v-if="row.original.familia"
                  :color="familiaColor(row.original.familia)"
                  variant="subtle"
                  size="sm"
                >
                  {{ row.original.familia }}
                </UBadge>
                <span
                  :class="[
                    row.original.tipoFila === 'linea' ? 'font-medium' : 'text-sm',
                    row.original.tipoFila === 'neto' ? 'text-muted' : '',
                    row.original.tipoFila === 'venta' ? 'font-medium text-muted' : '',
                    row.original.sinEfecto ? 'text-muted' : '',
                  ]"
                >
                  {{ row.original.concepto }}
                </span>
              </div>
            </template>
            <template #cantidad-cell="{ row }">
              <span v-if="row.original.cantidad" class="font-mono">{{ row.original.cantidad }}</span>
            </template>
            <template #valor-cell="{ row }">
              <span
                v-if="row.original.valor"
                class="font-mono text-sm"
                :class="row.original.sinEfecto ? 'text-muted' : ''"
              >
                {{ row.original.tipoFila === 'linea' ? formatMonto(row.original.valor) : row.original.valor }}
              </span>
            </template>
            <template #monto-cell="{ row }">
              <div v-if="row.original.monto !== null" class="flex flex-col items-end">
                <span class="flex items-baseline gap-1.5">
                  <!-- El rótulo va EN LÍNEA con el número y a su mismo tamaño:
                       es lo único que impide leerlo como el producto de
                       Cantidad × Valor (ver el ⛔ del script). Debajo y en
                       `text-xs text-muted` era más débil que el encabezado
                       `Total línea` que reemplazó, en tamaño, peso y color. -->
                  <!-- `text-highlighted` explícito: el `td` de UTable impone
                       `text-muted` por herencia, así que un span sin color se
                       renderiza atenuado aunque el código no lo diga. -->
                  <span v-if="row.original.rotuloMonto" class="text-sm font-semibold text-highlighted">
                    {{ row.original.rotuloMonto }}
                  </span>
                  <span
                    class="font-mono"
                    :class="[
                      row.original.tipoFila === 'regla' ? 'text-sm' : 'font-medium',
                      row.original.sinEfecto ? 'text-muted' : '',
                    ]"
                  >
                    {{ row.original.signo }}{{ formatMonto(row.original.monto) }}
                  </span>
                </span>
                <span v-if="row.original.recorte" class="text-xs text-warning">
                  {{ row.original.recorte }}
                </span>
              </div>
            </template>
            <template #empty>
              <div class="py-10 text-center text-sm text-muted">
                <UIcon name="i-lucide-inbox" class="mx-auto mb-2 h-8 w-8 opacity-40" />
                Sin líneas de venta.
              </div>
            </template>
          </UTable>
        </UCard>

        <div class="grid gap-4 md:grid-cols-2">
          <UCard>
            <template #header>
              <h2 class="text-base font-semibold">
                Totales
              </h2>
            </template>
            <dl class="space-y-2 text-sm">
              <div class="flex justify-between">
                <dt class="text-muted">
                  Subtotal bruto
                </dt>
                <dd class="font-mono">
                  {{ formatMonto(venta.totalBruto) }}
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-muted">
                  Descuentos
                </dt>
                <dd class="font-mono text-success">
                  -{{ formatMonto(venta.totalDescuentos) }}
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-muted">
                  Recargos
                </dt>
                <dd class="font-mono">
                  {{ formatMonto(venta.totalRecargos) }}
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-muted">
                  Impuestos
                </dt>
                <dd class="font-mono">
                  {{ formatMonto(venta.totalImpuestos) }}
                </dd>
              </div>
              <div class="flex justify-between border-t border-default pt-2 font-semibold">
                <dt>Total final</dt>
                <dd class="font-mono">
                  {{ formatMonto(venta.totalFinal) }}
                </dd>
              </div>
            </dl>

            <!-- Plegable y al pie: la escala y el redondeo solo importan cuando
                 un centavo no cuadra, y son exactamente lo que explica una
                 diferencia de $1 entre lo que el lector suma a mano y lo que
                 muestra la fila. Mismo permiso que el resto del drawer
                 (`Ventas:Leer`): la configuración de cálculo no se trata como
                 información de administración. -->
            <details v-if="venta.configCalculo" class="mt-3 border-t border-default pt-2 text-xs">
              <summary class="cursor-pointer text-muted">
                Cómo se redondeó
              </summary>
              <dl class="mt-2 space-y-1">
                <div class="flex justify-between">
                  <dt class="text-muted">
                    Decimales de cálculo
                  </dt>
                  <dd class="font-mono">
                    {{ venta.configCalculo.escalaCalculo }}
                  </dd>
                </div>
                <div class="flex justify-between">
                  <dt class="text-muted">
                    Redondeo
                  </dt>
                  <dd class="font-mono">
                    {{ MODO_REDONDEO_LABEL[venta.configCalculo.modoRedondeo] ?? venta.configCalculo.modoRedondeo }}
                  </dd>
                </div>
              </dl>
            </details>
          </UCard>

          <UCard v-if="venta.propina">
            <template #header>
              <h2 class="text-base font-semibold">
                Propina
              </h2>
            </template>
            <dl class="space-y-2 text-sm">
              <div class="flex justify-between">
                <dt class="text-muted">
                  % sugerido
                </dt>
                <dd>{{ new Decimal(venta.propina.porcentajeSugerido).mul(100).toFixed(0) }}%</dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-muted">
                  Monto sugerido
                </dt>
                <dd class="font-mono">
                  {{ formatMonto(venta.propina.montoSugerido) }}
                </dd>
              </div>
              <div class="flex justify-between font-semibold">
                <dt>Monto pagado</dt>
                <dd class="font-mono">
                  {{ formatMonto(venta.propina.montoPagado) }}
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-muted">
                  Garzón
                </dt>
                <dd>{{ venta.propina.garzonNombre ?? '—' }}</dd>
              </div>
            </dl>
          </UCard>

          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <h2 class="text-base font-semibold">
                  Pagos
                </h2>
                <NuxtLink
                  v-if="venta.pagos.length"
                  :to="{ path: '/pagos', query: { ventaId: venta.id } }"
                  class="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
                >
                  Ver en Pagos
                  <UIcon name="i-lucide-arrow-right" class="h-3 w-3" />
                </NuxtLink>
              </div>
            </template>

            <div v-if="!venta.pagos.length" class="py-2 text-sm text-muted">
              Sin pagos registrados
            </div>
            <ul v-else class="mb-4 divide-y divide-default text-sm">
              <li
                v-for="(p, i) in venta.pagos"
                :key="p.id"
                class="flex flex-col gap-1 py-2"
              >
                <div class="flex justify-between gap-2">
                  <span class="text-muted">Pago {{ i + 1 }}</span>
                  <span class="font-mono">{{ formatMonto(p.monto) }}</span>
                  <span v-if="p.vuelto && new Decimal(p.vuelto).gt(0)" class="text-xs text-muted">
                    (vuelto: {{ formatMonto(p.vuelto) }})
                  </span>
                  <span class="text-xs text-muted">{{ formatFecha(p.fecha) }}</span>
                </div>
                <p
                  v-if="p.aplicaciones?.length"
                  class="text-xs text-muted"
                >
                  <template v-for="(a, ai) in p.aplicaciones" :key="ai">
                    <span v-if="ai > 0"> · </span>
                    {{ a.tipo }}: {{ formatMonto(a.monto) }}
                  </template>
                </p>
              </li>
            </ul>

            <div class="space-y-1 border-t border-default pt-3 text-sm">
              <div class="flex justify-between">
                <span class="text-muted">Monto pagado</span>
                <span class="font-mono font-medium">{{ formatMonto(montoPagado) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted">Saldo pendiente</span>
                <span class="font-mono font-medium" :class="new Decimal(saldo).gt(0) ? 'text-warning' : ''">
                  {{ formatMonto(saldo) }}
                </span>
              </div>
            </div>
          </UCard>
        </div>

        <UCard v-if="venta.reembolsos.length">
          <template #header>
            <h2 class="text-base font-semibold">
              Reembolsos
            </h2>
          </template>
          <ul class="divide-y divide-default text-sm">
            <li
              v-for="r in venta.reembolsos"
              :key="r.id"
              class="flex items-center justify-between gap-2 py-2"
            >
              <span class="text-muted">{{ formatFecha(r.fecha) }}</span>
              <span class="font-mono">{{ formatMonto(r.monto) }}</span>
              <UBadge :color="reembolsoColor(r.estado)" :label="r.estado" variant="subtle" size="xs" />
              <span class="font-mono text-xs text-muted">{{ r.codigoOrden }}</span>
            </li>
          </ul>
          <div class="mt-3 flex justify-between border-t border-default pt-3 text-sm font-medium">
            <span class="text-muted">Total reembolsado (aprobado)</span>
            <span class="font-mono">{{ formatMonto(totalReembolsado) }}</span>
          </div>
        </UCard>

        <UCard v-if="venta.notasCredito.length || venta.ventaReferenciaId">
          <template #header>
            <h2 class="text-base font-semibold">
              Documentos relacionados
            </h2>
          </template>
          <ul class="divide-y divide-default text-sm">
            <li v-if="venta.ventaReferenciaId" class="py-2">
              <NuxtLink
                :to="{ path: '/ventas', query: { venta: venta.ventaReferenciaId } }"
                class="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                <UIcon name="i-lucide-arrow-left" class="h-3 w-3" />
                Venta original
              </NuxtLink>
            </li>
            <li
              v-for="nc in venta.notasCredito"
              :key="nc.id"
              class="flex items-center justify-between gap-2 py-2"
            >
              <NuxtLink
                :to="{ path: '/ventas', query: { venta: nc.id } }"
                class="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                Nota de crédito
                <UIcon name="i-lucide-arrow-right" class="h-3 w-3" />
              </NuxtLink>
              <span class="font-mono">{{ formatMonto(nc.totalFinal) }}</span>
              <span class="text-xs text-muted">{{ formatFecha(nc.fecha) }}</span>
            </li>
          </ul>
        </UCard>
      </div>

      <div v-else class="py-12 text-center text-muted">
        <UIcon name="i-lucide-triangle-alert" class="mx-auto mb-2 h-8 w-8 opacity-40" />
        No se encontró la venta.
      </div>
    </template>

    <template #actions>
      <UButton
        color="neutral"
        variant="ghost"
        @click="() => { open = false }"
      >
        Cerrar
      </UButton>
      <UButton
        v-if="puedeAnular"
        label="Anular"
        icon="i-lucide-ban"
        color="error"
        variant="outline"
        @click="() => { anularOpen = true }"
      />
      <UButton
        v-if="puedeCrearNC"
        label="Nota de crédito"
        icon="i-lucide-file-minus"
        color="neutral"
        variant="outline"
        @click="() => { ncOpen = true }"
      />
      <UButton
        v-if="puedeAbonar"
        label="Registrar pago"
        icon="i-lucide-plus"
        @click="() => { abonoOpen = true }"
      />
    </template>
  </AppDrawer>

  <PagosAbonoModal
    v-if="venta"
    v-model:open="abonoOpen"
    :venta-id="venta.id"
    :saldo="saldo"
    :metodos="metodos"
    @success="onAbonoSuccess"
  />

  <VentasAnularVentaModal
    v-if="venta"
    v-model:open="anularOpen"
    :venta-id="venta.id"
    @success="onAnularSuccess"
  />

  <VentasNotaCreditoModal
    v-if="venta"
    v-model:open="ncOpen"
    :venta-id="venta.id"
    :disponible="disponibleNC"
    :detalles="venta.detalles"
    @success="onNcSuccess"
  />
</template>
