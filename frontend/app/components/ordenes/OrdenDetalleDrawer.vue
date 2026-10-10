<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import Decimal from 'decimal.js'
import type { LineaDeclarada } from '~/composables/useDevolucionInventario'
import {
  colorEstadoTransaccion,
  esPagadaSinVenta,
  esRefundSinNota,
  esSinConfirmar,
  etiquetaEstadoTransaccion,
} from '~/composables/useReembolsoPasarela'

interface TransaccionOrden {
  transaccionId: string
  tipo: string
  estado: string
  monto: string | null
  codigoAutorizacion: string | null
  codigoRespuesta: string | null
  fechaTransaccion: string
  /** La corrección que dejó el REFUND; `null` si su nota falló. */
  correccionVentaId: string | null
  /** Lo que pidió el reembolso (lo precarga "Generar nota"), o `null`. */
  devoluciones: LineaDeclarada[] | null
}

interface OrdenDetalle {
  ordenId: string
  codigoOrden: string
  pagadorRef: string | null
  referenciaExterna: string | null
  ventaId: string | null
  descripcion: string
  monto: string
  moneda: string
  estado: string
  origen: string
  creadoEl: string
  /** Por qué el comprador pagó y la venta no se creó; `null` si no pasó. */
  motivoSinVenta: string | null
  transacciones: TransaccionOrden[]
}

const props = defineProps<{
  ordenId: string | null
}>()

const emit = defineEmits<{ updated: [{ ordenId: string, estado: string }] }>()
const open = defineModel<boolean>('open', { required: true })

const config = useRuntimeConfig()
const toast = useToast()
const { formatMonto, formatFecha } = useFormatters()
const permissionsStore = usePermissionsStore()
const apiUrl = config.public.apiUrl

const orden = ref<OrdenDetalle | null>(null)
const loading = ref(false)
const reembolsoOpen = ref(false)
const generarNotaOpen = ref(false)
const generarNotaDe = ref<TransaccionOrden | null>(null)

const disponibleReembolso = computed(() => {
  if (!orden.value) return '0'
  const reembolsado = orden.value.transacciones
    .filter((t) => t.tipo === 'REFUND' && t.estado === 'aprobada')
    .reduce((acc, t) => acc.plus(new Decimal(t.monto ?? '0')), new Decimal(0))
  return Decimal.max(0, new Decimal(orden.value.monto).minus(reembolsado)).toString()
})

// El reembolso que quedó sin confirmar (como mucho uno por orden, ADR-029).
const reembolsoSinConfirmar = computed(() =>
  orden.value?.transacciones.find(t => t.tipo === 'REFUND' && esSinConfirmar(t.estado)) ?? null,
)

function onSinConfirmarResuelto() {
  recargarOrden()
}

// "Generar nota" (owner, 2026-10-02): el REFUND aprobado cuya nota falló se
// marca en el historial y, con el permiso de reembolsar, se repara desde acá.
const puedeGenerarNota = computed(() => permissionsStore.can('Pasarelas', 'Reembolsar'))

function sinNota(t: TransaccionOrden): boolean {
  return esRefundSinNota(t, orden.value?.ventaId ?? null)
}

function abrirGenerarNota(t: TransaccionOrden) {
  generarNotaDe.value = t
  generarNotaOpen.value = true
}

function recargarOrden() {
  if (!orden.value) return
  const id = orden.value.ordenId
  cargar(id).then(() => {
    if (orden.value) emit('updated', { ordenId: id, estado: orden.value.estado })
  })
}

const puedeReembolsar = computed(() =>
  !!orden.value
  && ['pagada', 'conciliada', 'reembolsada'].includes(orden.value.estado)
  && new Decimal(disponibleReembolso.value).gt(0)
  && permissionsStore.can('Pasarelas', 'Reembolsar'),
)

const estadoColor: Record<string, 'success' | 'error' | 'warning' | 'neutral' | 'info'> = {
  creada: 'neutral',
  en_proceso: 'warning',
  procesando: 'warning',
  pagada: 'success',
  pendiente: 'warning',
  conciliada: 'success',
  fallida: 'error',
  expirada: 'neutral',
  reembolsada: 'info',
}

const estadoLabels: Record<string, string> = {
  creada: 'Creada',
  en_proceso: 'En proceso',
  procesando: 'Procesando',
  pagada: 'Pagada',
  pendiente: 'Pendiente',
  conciliada: 'Conciliada',
  fallida: 'Fallida',
  expirada: 'Expirada',
  reembolsada: 'Reembolsada',
}

function estadoLabel(estado: string): string {
  return estadoLabels[estado] ?? estado
}

const tipoLabels: Record<string, string> = {
  AUTHORIZATION: 'Autorización',
  REFUND: 'Reembolso',
}

function tipoLabel(tipo: string): string {
  return tipoLabels[tipo] ?? tipo
}

const transaccionColumns: TableColumn<TransaccionOrden>[] = [
  { accessorKey: 'fechaTransaccion', header: 'Fecha' },
  { accessorKey: 'tipo', header: 'Tipo' },
  { accessorKey: 'estado', header: 'Estado' },
  { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'codigoAutorizacion', header: 'Cód. autorización' },
  { id: 'nota', header: '' },
]

async function cargar(id: string) {
  loading.value = true
  orden.value = null
  try {
    orden.value = await useApiFetch<OrdenDetalle>(`${apiUrl}/pasarela/admin/ordenes/${id}`)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar la orden'), color: 'error' })
    open.value = false
  }
  finally {
    loading.value = false
  }
}

watch(
  () => [open.value, props.ordenId] as const,
  ([isOpen, id]) => {
    if (isOpen && id) cargar(id)
    else if (!isOpen) {
      orden.value = null
      reembolsoOpen.value = false
      generarNotaOpen.value = false
    }
  },
)

function onReembolsoSuccess(payload: {
  ordenId: string
  estado: string
  reembolsoAprobado?: boolean
  notaCreditoId?: string
  reembolso?: Omit<TransaccionOrden, 'correccionVentaId' | 'devoluciones'>
}) {
  reembolsoOpen.value = false
  if (!orden.value) return
  // Salió pero sin nota (su corrección falló): la marca y lo que "Generar
  // nota" precarga los trae la orden, no la respuesta del reembolso.
  if (payload.reembolsoAprobado && !payload.notaCreditoId && orden.value.ventaId) {
    recargarOrden()
    return
  }
  orden.value.estado = payload.estado
  const reembolso = payload.reembolso
    ? { ...payload.reembolso, correccionVentaId: payload.notaCreditoId ?? null, devoluciones: null }
    : null
  if (reembolso) {
    // Un reintento reproducido o aclarado trae un REFUND que ya está en la
    // lista (quizás "sin confirmar"): se reemplaza, no se suma otra fila.
    const otras = orden.value.transacciones.filter(t => t.transaccionId !== reembolso.transaccionId)
    orden.value.transacciones = [...otras, reembolso]
  }
  emit('updated', { ordenId: payload.ordenId, estado: payload.estado })
}
</script>

<template>
  <AppDrawer v-model:open="open" width="50%">
    <template #header>
      <div class="flex items-center gap-2">
        <span class="font-semibold text-default">Detalle de orden</span>
        <UBadge
          v-if="orden && esPagadaSinVenta(orden)"
          color="warning"
          label="Pagada sin venta"
          variant="subtle"
          size="xs"
        />
        <UBadge
          v-else-if="orden"
          :color="estadoColor[orden.estado] ?? 'neutral'"
          :label="estadoLabel(orden.estado)"
          variant="subtle"
          size="xs"
        />
      </div>
    </template>

    <template #body>
      <div v-if="loading" class="py-12 text-center text-muted">
        <UIcon name="i-lucide-loader" class="mx-auto mb-2 h-6 w-6 animate-spin" />
        Cargando orden…
      </div>

      <div v-else-if="orden" class="space-y-4">
        <UAlert
          v-if="esPagadaSinVenta(orden)"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="El comprador pagó y la venta no se registró"
          :description="`Motivo: ${orden.motivoSinVenta}. Devolvé el cargo con Reembolsar, o registrá la venta a mano y comunicate con el comprador.`"
          data-qa="orden-sin-venta-motivo"
        />
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
                {{ formatFecha(orden.creadoEl) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Origen
              </dt>
              <dd class="font-medium capitalize">
                {{ orden.origen === 'api' ? 'API externa' : 'Interno' }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Código de orden
              </dt>
              <dd class="font-mono text-xs font-medium">
                {{ orden.codigoOrden }}
              </dd>
            </div>
            <div v-if="orden.origen === 'api' && orden.referenciaExterna">
              <dt class="text-muted">
                Referencia externa
              </dt>
              <dd class="font-medium">
                {{ orden.referenciaExterna }}
              </dd>
            </div>
            <div v-if="orden.pagadorRef">
              <dt class="text-muted">
                Pagador
              </dt>
              <dd class="font-medium">
                {{ orden.pagadorRef }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Descripción
              </dt>
              <dd class="font-medium">
                {{ orden.descripcion }}
              </dd>
            </div>
          </dl>
        </UCard>

        <UCard v-if="orden.ventaId">
          <template #header>
            <h2 class="text-base font-semibold">
              Registros relacionados
            </h2>
          </template>
          <div class="flex flex-col gap-2">
            <NuxtLink
              :to="{ path: '/ventas', query: { venta: orden.ventaId } }"
              class="group flex items-center gap-3 rounded-lg border border-default p-3 transition-colors hover:bg-elevated"
            >
              <span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-elevated text-highlighted transition-colors group-hover:bg-default">
                <UIcon name="i-lucide-file-text" class="size-5" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-medium text-default">Venta generada</span>
                <span class="block text-xs text-muted">Ver el detalle de la venta</span>
              </span>
              <UIcon
                name="i-lucide-chevron-right"
                class="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-highlighted"
              />
            </NuxtLink>

            <NuxtLink
              :to="{ path: '/pagos', query: { ventaId: orden.ventaId } }"
              class="group flex items-center gap-3 rounded-lg border border-default p-3 transition-colors hover:bg-elevated"
            >
              <span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-elevated text-highlighted transition-colors group-hover:bg-default">
                <UIcon name="i-lucide-credit-card" class="size-5" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-medium text-default">Pagos de la venta</span>
                <span class="block text-xs text-muted">Ver los pagos registrados</span>
              </span>
              <UIcon
                name="i-lucide-chevron-right"
                class="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-highlighted"
              />
            </NuxtLink>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold">
                Monto
              </h2>
              <span class="font-mono text-lg font-semibold">{{ formatMonto(orden.monto) }}</span>
            </div>
          </template>
          <p class="text-sm text-muted">
            Moneda: {{ orden.moneda }}
          </p>
        </UCard>

        <OrdenesReembolsoSinConfirmar
          v-if="reembolsoSinConfirmar && permissionsStore.can('Pasarelas', 'Reembolsar')"
          :key="reembolsoSinConfirmar.transaccionId"
          :orden-id="orden.ordenId"
          :transaccion-id="reembolsoSinConfirmar.transaccionId"
          :monto="reembolsoSinConfirmar.monto"
          @resuelto="onSinConfirmarResuelto"
        />

        <UCard>
          <template #header>
            <h2 class="text-base font-semibold">
              Historial de transacciones
            </h2>
          </template>
          <UTable :data="orden.transacciones" :columns="transaccionColumns">
            <template #fechaTransaccion-cell="{ row }">
              <span class="whitespace-nowrap">{{ formatFecha(row.original.fechaTransaccion) }}</span>
            </template>
            <template #tipo-cell="{ row }">
              {{ tipoLabel(row.original.tipo) }}
            </template>
            <template #estado-cell="{ row }">
              <div class="flex flex-wrap items-center gap-1">
                <UBadge :color="colorEstadoTransaccion(row.original.estado)" :label="etiquetaEstadoTransaccion(row.original.estado)" variant="subtle" size="sm" />
                <UBadge
                  v-if="sinNota(row.original)"
                  color="warning"
                  variant="outline"
                  size="sm"
                  icon="i-lucide-file-warning"
                  label="Sin nota de crédito"
                />
              </div>
            </template>
            <template #nota-cell="{ row }">
              <UButton
                v-if="sinNota(row.original) && puedeGenerarNota"
                label="Generar nota"
                icon="i-lucide-file-plus"
                size="xs"
                color="warning"
                variant="subtle"
                @click="abrirGenerarNota(row.original)"
              />
            </template>
            <template #monto-cell="{ row }">
              <span class="font-mono">{{ row.original.monto ? formatMonto(row.original.monto) : '—' }}</span>
            </template>
            <template #codigoAutorizacion-cell="{ row }">
              <span class="font-mono text-xs text-muted">{{ row.original.codigoAutorizacion ?? '—' }}</span>
            </template>
            <template #empty>
              <div class="py-10 text-center text-sm text-muted">
                <UIcon name="i-lucide-inbox" class="mx-auto mb-2 h-8 w-8 opacity-40" />
                Sin transacciones registradas.
              </div>
            </template>
          </UTable>
        </UCard>
      </div>

      <div v-else class="py-12 text-center text-muted">
        <UIcon name="i-lucide-triangle-alert" class="mx-auto mb-2 h-8 w-8 opacity-40" />
        No se encontró la orden.
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
        v-if="puedeReembolsar"
        label="Reembolsar"
        icon="i-lucide-undo-2"
        color="error"
        variant="subtle"
        @click="() => { reembolsoOpen = true }"
      />
    </template>
  </AppDrawer>

  <OrdenesReembolsoModal
    v-if="orden"
    v-model:open="reembolsoOpen"
    :orden-id="orden.ordenId"
    :disponible="disponibleReembolso"
    :venta-id="orden.ventaId"
    @success="onReembolsoSuccess"
    @otros-datos="() => orden && cargar(orden.ordenId)"
  />

  <OrdenesGenerarNotaModal
    v-if="orden?.ventaId && generarNotaDe"
    v-model:open="generarNotaOpen"
    :orden-id="orden.ordenId"
    :transaccion-id="generarNotaDe.transaccionId"
    :monto="generarNotaDe.monto ?? '0'"
    :venta-id="orden.ventaId"
    :devoluciones="generarNotaDe.devoluciones"
    @success="recargarOrden"
    @recargar="recargarOrden"
  />
</template>
