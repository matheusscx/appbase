<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { CambioCompra, CompraDetalle, LineaCompra } from '~/composables/useCompras'

/**
 * El detalle de una compra confirmada o anulada (spec § 6): las líneas con
 * *Completar* o *Corregir*, el descuento, el historial a la vista y *Anular*.
 * Cada acción aparece solo con su permiso; el guard del backend es el que
 * manda igual.
 */
const props = defineProps<{ compra: CompraDetalle }>()
const emit = defineEmits<{ actualizada: [CompraDetalle] }>()

const { formatMonto, formatFecha } = useFormatters()
const { faltaAlgunPrecio, etiquetaCambio, cantidadConUnidad } = useCompras()
const { puedeActualizar } = usePermisosCrud('Compras')
const permissionsStore = usePermissionsStore()

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
  return cantidadConUnidad(valor, lineaPorId.value.get(c.compraLineaId)?.unidadCodigo ?? '').trim()
}

const columnsHistorial: TableColumn<CambioCompra>[] = [
  { accessorKey: 'creadoEl', header: 'Cuándo' },
  { accessorKey: 'compraLineaId', header: 'Producto' },
  { accessorKey: 'campo', header: 'Qué' },
  { id: 'valores', header: 'Antes → después' },
  { accessorKey: 'usuarioNombre', header: 'Quién' },
]
</script>

<template>
  <div class="space-y-6" data-qa="compra-confirmada">
    <dl class="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
      <div><dt class="text-muted">Proveedor</dt><dd>{{ compra.proveedorNombre || '—' }}</dd></div>
      <div><dt class="text-muted">Fecha del documento</dt><dd>{{ formatFecha(compra.fechaDocumento) }}</dd></div>
      <div><dt class="text-muted">Entró a</dt><dd>{{ compra.ubicacionNombre || '—' }}</dd></div>
    </dl>

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
        <span class="tabular-nums">{{ cantidadConUnidad(row.original.cantidad, row.original.unidadCodigo) }}</span>
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

    <ComprasCorregirLineaModal
      v-if="lineaEnEdicion"
      v-model:open="corregirOpen"
      :compra-id="compra.id"
      :ubicacion-id="compra.ubicacionId"
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
