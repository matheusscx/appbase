<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { CambioCompra, CompraDetalle, LineaCompra, PagoProveedorInfo, TotalDocumentoTipo } from '~/composables/useCompras'

/**
 * El detalle de una compra confirmada o anulada (spec § 6): las líneas con
 * *Completar* o *Corregir*, el descuento, el historial a la vista y *Anular*.
 * Cada acción aparece solo con su permiso; el guard del backend es el que
 * manda igual.
 *
 * `totalDocumentoTipo` no viaja en `compra` (es del catálogo de tipos, no de
 * la compra): lo resuelve la página con el mismo tipo que usó para cargar el
 * borrador, y acá solo decide si "Total del documento" tiene sentido en
 * "Corregir total o vencimiento" (spec compras-deuda-proveedor § 6 y § 10).
 */
const props = defineProps<{ compra: CompraDetalle, totalDocumentoTipo: TotalDocumentoTipo }>()
const emit = defineEmits<{ actualizada: [CompraDetalle] }>()

const { formatMonto, formatFecha } = useFormatters()
const {
  faltaAlgunPrecio, etiquetaCambio, cantidadConUnidad, unidadDeLinea, cantidadLineaConfirmada, insigniaPago,
} = useCompras()
const { puedeActualizar } = usePermisosCrud('Compras')
const permissionsStore = usePermissionsStore()
// `Pagar` no es uno de los cuatro CRUD de `usePermisosCrud` (mismo molde que
// `puedeAnular`, acá abajo): los datos de pago (spec § 8, decisión 12) son
// SOLO de quien tiene `Compras:Pagar`, nunca de `Leer` a secas.
const puedePagar = computed(() => permissionsStore.esAdmin || permissionsStore.can('Compras', 'Pagar'))

const confirmada = computed(() => props.compra.estado === 'confirmada')
const puedeCorregir = computed(() => confirmada.value && puedeActualizar.value)
const puedeAnular = computed(() =>
  confirmada.value && (permissionsStore.esAdmin || permissionsStore.can('Compras', 'Anular')),
)
// El descuento se reparte según el valor de cada línea: sin todos los precios
// no hay cómo (el backend responde 400).
const puedeDescontar = computed(() =>
  puedeCorregir.value && !faltaAlgunPrecio(props.compra.lineas),
)
// Los datos de pago solo existen con `Pagar` Y en una compra confirmada
// (spec § 4.1: un borrador o una anulada no deben nada).
const muestraPago = computed(() => confirmada.value && puedePagar.value && props.compra.estadoPago != null)
const insignia = computed(() => muestraPago.value
  ? insigniaPago(
      { estadoPago: props.compra.estadoPago!, deuda: props.compra.deuda ?? null, vencida: props.compra.vencida ?? false },
      formatMonto,
    )
  : null,
)

const corregirDocumentoOpen = ref(false)

const columns = computed<TableColumn<LineaCompra>[]>(() => [
  { accessorKey: 'itemNombre', header: 'Producto' },
  { accessorKey: 'cantidad', header: 'Cantidad', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'precioUnitario', header: 'Precio unitario', meta: { class: { th: 'text-right', td: 'text-right' } } },
  ...(puedeCorregir.value ? [{ id: 'acciones', header: '' }] : []),
])

// ── Modales ───────────────────────────────────────────────────────────────

const lineaEnEdicion = ref<LineaCompra | null>(null)
const corregirOpen = ref(false)
const descuentoOpen = ref(false)
const anularOpen = ref(false)

function abrirCorreccion(linea: LineaCompra) {
  lineaEnEdicion.value = linea
  corregirOpen.value = true
}

// ── Historial ─────────────────────────────────────────────────────────────

const lineaPorId = computed(() =>
  new Map(props.compra.lineas.map(l => [l.id, l])),
)

/** Montos en plata; cantidades con la unidad de su línea; "—" si no había valor. */
function valorCambio(c: CambioCompra, valor: string | null): string {
  if (valor == null) return '—'
  if (c.campo !== 'cantidad') return formatMonto(valor)
  const linea = lineaPorId.value.get(c.compraLineaId)
  return cantidadConUnidad(valor, linea ? unidadDeLinea(linea) : '').trim()
}

const columnsHistorial: TableColumn<CambioCompra>[] = [
  { accessorKey: 'creadoEl', header: 'Cuándo' },
  { accessorKey: 'compraLineaId', header: 'Producto' },
  { accessorKey: 'campo', header: 'Qué' },
  { id: 'valores', header: 'Antes → después' },
  { accessorKey: 'usuarioNombre', header: 'Quién' },
]

// ── Pagos (spec § 8 y § 10, solo con `Pagar`) ───────────────────────────────

const columnsPagos: TableColumn<PagoProveedorInfo>[] = [
  { accessorKey: 'fecha', header: 'Fecha' },
  { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'metodoPagoNombre', header: 'Medio' },
  { accessorKey: 'referencia', header: 'Referencia' },
  { accessorKey: 'estado', header: 'Estado' },
]
</script>

<template>
  <div class="space-y-6" data-qa="compra-confirmada">
    <dl class="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
      <div><dt class="text-muted">Proveedor</dt><dd>{{ compra.proveedorNombre || '—' }}</dd></div>
      <div><dt class="text-muted">Fecha del documento</dt><dd>{{ formatFecha(compra.fechaDocumento) }}</dd></div>
      <div><dt class="text-muted">Entró a</dt><dd>{{ compra.ubicacionNombre || '—' }}</dd></div>
      <div v-if="totalDocumentoTipo !== 'suma_lineas'" data-qa="compra-documento-total">
        <dt class="text-muted">Total del documento</dt>
        <dd>{{ compra.totalDocumento != null ? formatMonto(compra.totalDocumento) : '—' }}</dd>
      </div>
      <div data-qa="compra-documento-vencimiento">
        <dt class="text-muted">Vence el</dt>
        <dd>{{ compra.fechaVencimiento ? formatFecha(compra.fechaVencimiento) : '—' }}</dd>
      </div>
    </dl>

    <div v-if="puedeCorregir" class="flex justify-end">
      <UButton
        size="xs"
        variant="soft"
        color="neutral"
        label="Corregir total o vencimiento"
        data-qa="compra-documento-corregir-abrir"
        @click="() => { corregirDocumentoOpen = true }"
      />
    </div>

    <UAlert
      v-if="compra.estado === 'anulada'"
      color="error"
      variant="subtle"
      icon="i-lucide-ban"
      title="Compra anulada"
      :description="compra.motivoAnulacion ?? undefined"
      data-qa="compra-anulada-motivo"
    />

    <CrudTable :data="compra.lineas" :columns="columns">
      <template #itemNombre-cell="{ row }">
        {{ row.original.itemNombre || '—' }}
      </template>
      <template #cantidad-cell="{ row }">
        <span class="tabular-nums">{{ cantidadLineaConfirmada(row.original) }}</span>
      </template>
      <template #precioUnitario-cell="{ row }">
        <span v-if="row.original.precioUnitario != null" class="tabular-nums">
          {{ formatMonto(row.original.precioUnitario) }}
        </span>
        <UBadge v-else label="Falta costo" color="warning" variant="subtle" />
      </template>
      <template #acciones-cell="{ row }">
        <div class="flex justify-end">
          <UButton
            size="xs"
            variant="soft"
            :color="row.original.precioUnitario == null ? 'warning' : 'neutral'"
            :label="row.original.precioUnitario == null ? 'Completar' : 'Corregir'"
            :data-qa="`compra-corregir-${row.original.id}`"
            @click="abrirCorreccion(row.original)"
          />
        </div>
      </template>
    </CrudTable>

    <div class="flex flex-col items-end gap-2 text-sm">
      <div v-if="compra.descuentoTotal != null" class="flex items-center gap-3">
        <span class="text-muted">Descuento al total</span>
        <span class="tabular-nums" data-qa="compra-descuento-vigente">− {{ formatMonto(compra.descuentoTotal) }}</span>
      </div>
      <div class="flex items-center gap-3 font-medium">
        <span>Total</span>
        <span class="tabular-nums">{{ compra.total != null ? formatMonto(compra.total) : '—' }}</span>
      </div>
      <UButton
        v-if="puedeDescontar"
        size="xs"
        variant="soft"
        color="neutral"
        :label="compra.descuentoTotal != null ? 'Cambiar el descuento' : 'Cargar descuento'"
        data-qa="compra-descuento-abrir"
        @click="() => { descuentoOpen = true }"
      />
    </div>

    <div class="space-y-2">
      <h3 class="text-sm font-medium text-default">
        Historial de correcciones
      </h3>
      <p v-if="!compra.cambios.length" class="text-sm text-muted" data-qa="compra-historial-vacio">
        Sin correcciones.
      </p>
      <div v-else data-qa="compra-historial">
        <!-- El `data-qa` en un div propio: `CrudTable` lo pasa también a su
             tabla interna, y un selector que encuentra dos elementos no sirve. -->
        <CrudTable :data="compra.cambios" :columns="columnsHistorial">
          <template #creadoEl-cell="{ row }">
            {{ formatFecha(row.original.creadoEl) }}
          </template>
          <template #compraLineaId-cell="{ row }">
            {{ lineaPorId.get(row.original.compraLineaId)?.itemNombre ?? '—' }}
          </template>
          <template #campo-cell="{ row }">
            {{ etiquetaCambio(row.original.campo) }}
          </template>
          <template #valores-cell="{ row }">
            <span class="tabular-nums">
              {{ valorCambio(row.original, row.original.valorAnterior) }} → {{ valorCambio(row.original, row.original.valorNuevo) }}
            </span>
          </template>
          <template #usuarioNombre-cell="{ row }">
            {{ row.original.usuarioNombre || '—' }}
          </template>
        </CrudTable>
      </div>
    </div>

    <!-- Solo con `Pagar` (spec § 8, decisión 12): quien no lo tiene no
         recibe `estadoPago` en la respuesta, y esta sección ni se evalúa. -->
    <div v-if="muestraPago" class="space-y-3" data-qa="compra-pago">
      <h3 class="text-sm font-medium text-default">
        Pago
      </h3>
      <dl class="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
        <div>
          <dt class="text-muted">Pagado</dt>
          <dd class="tabular-nums">{{ formatMonto(compra.aplicado ?? '0') }}</dd>
        </div>
        <div>
          <dt class="text-muted">Deuda</dt>
          <dd class="tabular-nums">{{ compra.deuda != null ? formatMonto(compra.deuda) : '—' }}</dd>
        </div>
        <div>
          <dt class="text-muted">Estado</dt>
          <dd><UBadge v-if="insignia" :label="insignia.label" :color="insignia.color" variant="subtle" /></dd>
        </div>
      </dl>
      <p v-if="!compra.pagos?.length" class="text-sm text-muted" data-qa="compra-pagos-vacio">
        Sin pagos registrados.
      </p>
      <CrudTable v-else :data="compra.pagos" :columns="columnsPagos" data-qa="compra-pagos-tabla">
        <template #fecha-cell="{ row }">
          {{ row.original.fecha ? formatFecha(row.original.fecha) : '—' }}
        </template>
        <template #monto-cell="{ row }">
          <span class="tabular-nums">{{ formatMonto(row.original.monto) }}</span>
        </template>
        <template #metodoPagoNombre-cell="{ row }">
          {{ row.original.metodoPagoNombre || '—' }}
        </template>
        <template #referencia-cell="{ row }">
          {{ row.original.referencia || '—' }}
        </template>
        <template #estado-cell="{ row }">
          <UBadge
            :label="row.original.estado === 'anulado' ? 'Anulado' : 'Vigente'"
            :color="row.original.estado === 'anulado' ? 'error' : 'success'"
            variant="subtle"
          />
        </template>
      </CrudTable>
    </div>

    <div v-if="puedeAnular" class="flex justify-end">
      <UButton
        color="error"
        variant="soft"
        icon="i-lucide-ban"
        label="Anular compra"
        data-qa="compra-anular-abrir"
        @click="() => { anularOpen = true }"
      />
    </div>

    <ComprasCorregirDocumentoModal
      v-model:open="corregirDocumentoOpen"
      :compra-id="compra.id"
      :total-documento-tipo="totalDocumentoTipo"
      :total-documento-actual="compra.totalDocumento"
      :fecha-vencimiento-actual="compra.fechaVencimiento"
      @success="(c: CompraDetalle) => emit('actualizada', c)"
    />
    <ComprasCorregirLineaModal
      v-if="lineaEnEdicion"
      v-model:open="corregirOpen"
      :compra-id="compra.id"
      :linea="lineaEnEdicion"
      @success="(c: CompraDetalle) => emit('actualizada', c)"
    />
    <ComprasDescuentoModal
      v-model:open="descuentoOpen"
      :compra-id="compra.id"
      :descuento-actual="compra.descuentoTotal"
      @success="(c: CompraDetalle) => emit('actualizada', c)"
    />
    <ComprasAnularCompraModal
      v-model:open="anularOpen"
      :compra-id="compra.id"
      :ubicacion-nombre="compra.ubicacionNombre"
      :lineas="compra.lineas"
      @success="(c: CompraDetalle) => emit('actualizada', c)"
    />
  </div>
</template>
