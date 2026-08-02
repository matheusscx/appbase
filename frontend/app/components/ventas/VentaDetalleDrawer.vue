<script setup lang="ts">
import Decimal from 'decimal.js'
import type { TableColumn } from '@nuxt/ui'
import { formatCantidadTicket } from '~/utils/cantidad-presentacion'

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
   * aplicaron los pasos y es lo que ordena el desglose. `null` en las ventas
   * anteriores al congelado y en las notas de crédito.
   */
  configCalculo: { formula: string[] } | null
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
  if (det.cantidadPresentacion && det.unidadCodigoPresentacion) {
    return formatCantidadTicket(det.cantidadPresentacion, det.unidadCodigoPresentacion, unidadesStore.esFraccionaria(det.unidadCodigoPresentacion))
  }
  return det.cantidad
}

const detalleColumns: TableColumn<Detalle>[] = [
  { accessorKey: 'descripcion', header: 'Descripción' },
  { accessorKey: 'cantidad', header: 'Cantidad', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'precioUnitario', header: 'Precio unit.', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'totalLinea', header: 'Total línea', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

/**
 * El desglose se agrupa **por línea** y dentro de cada una sigue el orden de la
 * fórmula del tenant, porque es como el motor lo aplicó: sobre el neto de la
 * línea se encadenan los pasos y cada uno opera sobre el acumulado del
 * anterior. Listarlo por familia —todos los descuentos, después todos los
 * recargos— describe la venta pero no el cálculo, y deja al lector armando de
 * memoria a qué ítem pertenecía cada fila.
 */
interface ReglaAplicadaFila {
  tipo: string
  nombre: string
  /** Con qué valor aplicó: "10,00%" o "Monto fijo". */
  expresion: string
  monto: string
  /** Presente solo si el piso en cero recortó la regla. */
  recorte: string | null
  /** La regla se evaluó y no aportó nada. Se muestra, atenuada. */
  sinEfecto: boolean
}

interface GrupoReglas {
  clave: string
  titulo: string
  /** El total de la línea, para cerrar la cuenta de su propio bloque. */
  total: string | null
  filas: ReglaAplicadaFila[]
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

function filaDeRegla(tipo: string, r: ReglaCongelada): ReglaAplicadaFila {
  // Un `porcentaje_aplicado` null puede ser "era monto fijo" o "era porcentaje
  // y no llegó a aplicar"; `modo` es lo que los distingue. El segundo caso se
  // nombra: un guion al lado de una regla llamada "Solo transferencia 5%" hace
  // dudar de si el dato se perdió, cuando lo que pasó es que no corrió.
  const expresion = r.porcentajeAplicado !== null
    ? formatPorcentaje(r.porcentajeAplicado)
    : r.modo === 'monto_fijo' ? 'Monto fijo' : 'No aplicó'

  // Solo los descuentos los topea el piso en cero, y solo cuando pedían más de
  // lo que había disponible.
  const pedido = r.valorSolicitado
  const recorte = pedido && new Decimal(pedido).greaterThan(r.valorAplicado)
    ? `pedía ${formatMonto(pedido)}`
    : null

  return {
    tipo,
    nombre: r.nombreRegla,
    expresion,
    monto: r.valorAplicado,
    recorte,
    sinEfecto: new Decimal(r.valorAplicado).isZero(),
  }
}

/** El orden real de los pasos en esta venta, con nombres presentables. */
const formulaVenta = computed<string[]>(
  () => venta.value?.configCalculo?.formula ?? FORMULA_DEFAULT,
)

const ordenPasos = computed(() => formulaVenta.value.map(p => PASO_A_TIPO[p] ?? p))

/**
 * Un bloque por línea —en el orden en que se vendieron— y uno final para las
 * reglas de nivel venta, que no pertenecen a ninguna línea (`detalleId` null).
 * Los bloques sin reglas no se dibujan.
 *
 * ⚠️ Agrupar así **descarta** cualquier regla cuyo `detalleId` no esté entre los
 * detalles de la venta: desaparecería de la pantalla sin aviso. Se apoya en que
 * nada soft-borra un `venta_detalles` y en que las tres queries de reglas están
 * scopeadas por `venta_id`, así que ese estado no existe. Si algún día se
 * borran detalles, hay que decidir qué pasa con sus reglas antes que esto.
 */
const gruposDeReglas = computed<GrupoReglas[]>(() => {
  const v = venta.value
  if (!v) return []

  const porPaso: Record<string, ReglaCongelada[]> = {
    descuentos: v.descuentos,
    recargos: v.recargos,
    impuestos: v.impuestos,
  }

  // Recorre los pasos en el orden de la fórmula y se queda con las reglas de
  // un `detalleId` dado: así cada bloque queda en el orden en que se aplicó.
  const filasDe = (detalleId: string | null): ReglaAplicadaFila[] =>
    formulaVenta.value.flatMap((paso) => {
      const tipo = PASO_A_TIPO[paso]
      if (!tipo) return []
      return (porPaso[paso] ?? [])
        .filter(r => r.detalleId === detalleId)
        .map(r => filaDeRegla(tipo, r))
    })

  const grupos: GrupoReglas[] = v.detalles.map(d => ({
    clave: d.id,
    titulo: d.descripcion,
    total: d.totalLinea,
    filas: filasDe(d.id),
  }))

  grupos.push({
    clave: 'venta',
    titulo: 'Toda la venta',
    total: null,
    filas: filasDe(null),
  })

  return grupos.filter(g => g.filas.length > 0)
})

const reglaColumns: TableColumn<ReglaAplicadaFila>[] = [
  { accessorKey: 'tipo', header: 'Tipo' },
  { accessorKey: 'nombre', header: 'Regla' },
  { accessorKey: 'expresion', header: 'Valor', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

function tipoReglaColor(tipo: string): 'success' | 'warning' | 'neutral' {
  if (tipo === 'Descuento') return 'success'
  if (tipo === 'Recargo') return 'warning'
  return 'neutral'
}

async function cargar(id: string) {
  loading.value = true
  venta.value = null
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
            <h2 class="text-base font-semibold">
              Líneas de venta
            </h2>
          </template>
          <UTable :data="venta.detalles" :columns="detalleColumns">
            <template #cantidad-cell="{ row }">
              <span class="font-mono">{{ cantidadDetalleLabel(row.original) }}</span>
            </template>
            <template #precioUnitario-cell="{ row }">
              <span class="font-mono">{{ formatMonto(row.original.precioUnitario) }}</span>
            </template>
            <template #totalLinea-cell="{ row }">
              <span class="font-mono">{{ formatMonto(row.original.totalLinea) }}</span>
            </template>
            <template #empty>
              <div class="py-10 text-center text-sm text-muted">
                <UIcon name="i-lucide-inbox" class="mx-auto mb-2 h-8 w-8 opacity-40" />
                Sin líneas de venta.
              </div>
            </template>
          </UTable>
        </UCard>

        <UCard v-if="gruposDeReglas.length">
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h2 class="text-base font-semibold">
                Reglas aplicadas
              </h2>
              <span class="text-xs text-muted">
                Valores del momento del cobro · orden: {{ ordenPasos.join(' → ') }}
              </span>
            </div>
          </template>

          <div class="space-y-6">
            <section v-for="grupo in gruposDeReglas" :key="grupo.clave">
              <div class="mb-1 flex items-baseline justify-between gap-2 border-b border-default pb-1">
                <h3 class="text-sm font-medium">
                  {{ grupo.titulo }}
                </h3>
                <span v-if="grupo.total" class="font-mono text-sm text-muted">
                  {{ formatMonto(grupo.total) }}
                </span>
              </div>
              <UTable :data="grupo.filas" :columns="reglaColumns">
                <template #tipo-cell="{ row }">
                  <UBadge
                    :color="tipoReglaColor(row.original.tipo)"
                    variant="subtle"
                    size="sm"
                  >
                    {{ row.original.tipo }}
                  </UBadge>
                </template>
                <template #nombre-cell="{ row }">
                  <span :class="row.original.sinEfecto ? 'text-muted' : ''">
                    {{ row.original.nombre }}
                  </span>
                </template>
                <template #expresion-cell="{ row }">
                  <span class="font-mono" :class="row.original.sinEfecto ? 'text-muted' : ''">
                    {{ row.original.expresion }}
                  </span>
                </template>
                <template #monto-cell="{ row }">
                  <div class="flex flex-col items-end">
                    <span class="font-mono" :class="row.original.sinEfecto ? 'text-muted' : ''">
                      {{ formatMonto(row.original.monto) }}
                    </span>
                    <span v-if="row.original.recorte" class="text-xs text-warning">
                      {{ row.original.recorte }}
                    </span>
                  </div>
                </template>
              </UTable>
            </section>
          </div>
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
