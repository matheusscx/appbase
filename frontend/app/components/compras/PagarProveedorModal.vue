<script setup lang="ts">
import Decimal from 'decimal.js'
import type { EstadoPagoCompra, PagoProveedorInfo } from '~/composables/useCompras'

/** Espejo de `MedioPagoOpcion` del backend (spec § 5.1). */
interface MedioPagoOpcion {
  id: string
  nombre: string
  esEfectivo: boolean
}

/** Espejo de `PorPagarCompraItem` del backend (spec § 8). */
interface CompraPorPagar {
  id: string
  fechaDocumento: string
  folio: string | null
  tipoDocumentoNombre: string | null
  total: string | null
  totalDocumento: string | null
  fechaVencimiento: string | null
  estadoPago: EstadoPagoCompra
  deuda: string | null
  vencida: boolean
}

interface ProveedorDetalle {
  compras: CompraPorPagar[]
  pagos: PagoProveedorInfo[]
}

/**
 * Pagar a un proveedor (spec § 5.1 y § 10, decisión 2): la propuesta de
 * reparto —saldo a favor primero, después la compra más vieja— editable
 * antes de mandar. `useCompras().proponerReparto` decide la propuesta; el
 * servidor valida el reparto que llega, nunca lo recalcula (spec § 5.1).
 *
 * Se abre desde "Por pagar" (`pages/compras/por-pagar.vue`) con el
 * proveedor completo, y carga sus propias compras/pagos al abrir — así la
 * propuesta parte de datos frescos aunque la lista que abrió el modal
 * llevara un rato en pantalla.
 */
const props = defineProps<{ proveedorId: string, proveedorNombre: string }>()
const emit = defineEmits<{ success: [] }>()
const open = defineModel<boolean>('open', { required: true })

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()
const { formatMonto, formatFecha } = useFormatters()
const { proponerReparto, insigniaPago, compararPorVencimiento } = useCompras()
const intentoCobro = useIntentoCobro()

const cargando = ref(false)
const enviando = ref(false)
const compras = ref<CompraPorPagar[]>([])
const pagos = ref<PagoProveedorInfo[]>([])
const mediosPago = ref<MedioPagoOpcion[]>([])

const monto = ref('')
const medioPagoId = ref('')
const referencia = ref('')
/** `compraId -> monto tipeado`. Vacío no viaja: se filtra al armar el body. */
const repartoMontos = reactive<Record<string, string>>({})
/** Deja de regenerar la propuesta apenas alguien toca una fila a mano
 *  (spec § 10: "editable"). Se resetea cada vez que el modal se abre. */
const repartoTocado = ref(false)

const medioPagoOpts = computed(() => mediosPago.value.map(m => ({ label: m.nombre, value: m.id })))
const medioSeleccionado = computed(() => mediosPago.value.find(m => m.id === medioPagoId.value) ?? null)
const medioEsEfectivo = computed(() => medioSeleccionado.value?.esEfectivo ?? false)

/** Mismo comparador que `proponerReparto`: la más vieja primero. */
const comprasOrdenadas = computed(() => [...compras.value].sort(compararPorVencimiento))

const saldoAFavor = computed(() =>
  pagos.value
    .filter(p => p.estado === 'vigente')
    .reduce((acc, p) => acc.plus(p.sobranteAFavor), new Decimal(0))
    .toString())

async function cargar() {
  cargando.value = true
  try {
    const [detalle, medios] = await Promise.all([
      useApiFetch<ProveedorDetalle>(`${apiUrl}/compras/por-pagar/${props.proveedorId}`),
      useApiFetch<MedioPagoOpcion[]>(`${apiUrl}/compras/medios-pago`),
    ])
    compras.value = detalle.compras
    pagos.value = detalle.pagos
    mediosPago.value = medios
    medioPagoId.value = medios[0]?.id ?? ''
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar lo que se debe'), color: 'error' })
  } finally {
    cargando.value = false
  }
}

watch(open, (v) => {
  if (!v) return
  monto.value = ''
  referencia.value = ''
  for (const k of Object.keys(repartoMontos)) delete repartoMontos[k]
  repartoTocado.value = false
  void cargar()
})

/** Regenera la propuesta mientras nadie tocó una fila a mano. */
watch([monto, saldoAFavor, compras], () => {
  if (repartoTocado.value) return
  const propuesta = proponerReparto(compras.value, saldoAFavor.value, monto.value)
  for (const k of Object.keys(repartoMontos)) delete repartoMontos[k]
  for (const r of propuesta) repartoMontos[r.compraId] = r.monto
})

function editarFila(compraId: string, valor: string) {
  repartoTocado.value = true
  if (valor.trim()) repartoMontos[compraId] = valor
  else delete repartoMontos[compraId]
}

/** Vuelve a la propuesta automática, descartando lo editado a mano. */
function recalcularPropuesta() {
  repartoTocado.value = false
  const propuesta = proponerReparto(compras.value, saldoAFavor.value, monto.value)
  for (const k of Object.keys(repartoMontos)) delete repartoMontos[k]
  for (const r of propuesta) repartoMontos[r.compraId] = r.monto
}

/** El body de `aplicaciones` (spec § 5.1): solo montos > 0, el DTO exige positivo. */
const aplicaciones = computed(() =>
  Object.entries(repartoMontos)
    .filter(([, v]) => {
      try { return new Decimal(v || '0').greaterThan(0) } catch { return false }
    })
    .map(([compraId, montoTexto]) => ({ compraId, monto: montoTexto.trim() })))

const totalRepartido = computed(() =>
  aplicaciones.value.reduce((acc, a) => acc.plus(a.monto), new Decimal(0)))

const disponible = computed(() => {
  const m = (() => { try { return new Decimal(monto.value || '0') } catch { return new Decimal(0) } })()
  return new Decimal(saldoAFavor.value).plus(m)
})

/** Lo que no se reparte queda a favor (spec § 10): nunca negativo en pantalla. */
const sobraAFavor = computed(() => {
  const resto = disponible.value.minus(totalRepartido.value)
  return resto.greaterThan(0) ? resto.toString() : '0'
})

const montoEsValido = computed(() => {
  try { return new Decimal(monto.value || '0').greaterThanOrEqualTo(0) } catch { return false }
})
const montoEsPositivo = computed(() => {
  try { return new Decimal(monto.value || '0').greaterThan(0) } catch { return false }
})
/** `monto` 0 con aplicaciones es "usar el saldo a favor" (spec § 5.1, decisión 5). */
const puedeEnviar = computed(() =>
  montoEsValido.value
  && (!montoEsPositivo.value || !!medioPagoId.value)
  && (montoEsPositivo.value || aplicaciones.value.length > 0)
  && totalRepartido.value.lessThanOrEqualTo(disponible.value))

async function enviar() {
  if (!puedeEnviar.value || enviando.value) return
  enviando.value = true
  const ambito = `pago-proveedor:${props.proveedorId}`
  try {
    const body: Record<string, unknown> = {
      proveedorId: props.proveedorId,
      monto: monto.value.trim() || '0',
      aplicaciones: aplicaciones.value,
    }
    if (montoEsPositivo.value) body.metodoPagoId = medioPagoId.value
    if (referencia.value.trim()) body.referencia = referencia.value.trim()

    const res = await useApiFetch<PagoProveedorInfo & { repetida?: true }>(
      `${apiUrl}/compras/pagos`,
      { method: 'POST', body, headers: intentoCobro.cabecera(ambito) },
    )
    intentoCobro.terminar(ambito)
    intentoCobro.avisarSiRepetido(res)
    toast.add({ title: 'Pago registrado', color: 'success' })
    open.value = false
    emit('success')
  } catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al registrar el pago'), color: 'error' })
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="`Pagar a ${proveedorNombre}`" :ui="shellUi.modal">
    <template #body>
      <div class="flex flex-col gap-4" data-qa="pagar-proveedor-modal">
        <p v-if="cargando" class="text-sm text-muted">
          Cargando…
        </p>
        <template v-else>
          <div v-if="new Decimal(saldoAFavor).greaterThan(0)" class="text-sm text-muted" data-qa="pagar-saldo-favor">
            Saldo a favor: <span class="tabular-nums font-medium text-highlighted">{{ formatMonto(saldoAFavor) }}</span>
          </div>

          <UFormField label="Monto a pagar">
            <MoneyInput v-model="monto" oficial class="w-full" data-qa="pagar-monto" />
          </UFormField>
          <UFormField v-if="montoEsPositivo" label="Medio de pago">
            <USelectMenu
              v-model="medioPagoId"
              :items="medioPagoOpts"
              value-key="value"
              label-key="label"
              class="w-full"
              data-qa="pagar-medio"
            />
          </UFormField>
          <p v-if="medioEsEfectivo" class="text-xs text-muted" data-qa="pagar-aviso-efectivo">
            Sale de tu caja física abierta: si no tenés una, abrila antes de pagar.
          </p>
          <UFormField label="Referencia (opcional)">
            <UInput v-model="referencia" class="w-full" data-qa="pagar-referencia" />
          </UFormField>

          <div v-if="comprasOrdenadas.length" class="space-y-2">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-medium text-default">
                Reparto propuesto
              </h3>
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                label="Recalcular propuesta"
                data-qa="pagar-recalcular"
                @click="recalcularPropuesta"
              />
            </div>
            <ul class="divide-y divide-default text-sm">
              <li
                v-for="c in comprasOrdenadas"
                :key="c.id"
                class="flex flex-wrap items-center justify-between gap-2 py-2"
                :data-qa="`pagar-fila-${c.id}`"
              >
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="truncate">
                      {{ c.tipoDocumentoNombre }}<template v-if="c.folio"> {{ c.folio }}</template>
                    </span>
                    <UBadge
                      :label="insigniaPago({ estadoPago: c.estadoPago, deuda: c.deuda, vencida: c.vencida }, formatMonto).label"
                      :color="insigniaPago({ estadoPago: c.estadoPago, deuda: c.deuda, vencida: c.vencida }, formatMonto).color"
                      variant="subtle"
                      size="sm"
                    />
                  </div>
                  <p class="text-xs text-muted">
                    Vence {{ c.fechaVencimiento ? formatFecha(c.fechaVencimiento) : '—' }}
                    · Debe {{ c.deuda != null ? formatMonto(c.deuda) : 'al menos lo que se sepa del total' }}
                  </p>
                </div>
                <MoneyInput
                  :model-value="repartoMontos[c.id] ?? ''"
                  oficial
                  class="w-32"
                  :data-qa="`pagar-fila-monto-${c.id}`"
                  @update:model-value="(v: string) => editarFila(c.id, v)"
                />
              </li>
            </ul>
          </div>
          <p v-else class="text-sm text-muted" data-qa="pagar-sin-compras">
            Este proveedor no tiene compras abiertas.
          </p>

          <p class="text-sm text-muted" data-qa="pagar-sobra">
            Lo que no se reparte queda a favor del proveedor: <span class="tabular-nums font-medium text-highlighted">{{ formatMonto(sobraAFavor) }}</span>
          </p>
        </template>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="() => { open = false }" />
        <UButton
          label="Pagar"
          color="primary"
          :loading="enviando"
          :disabled="!puedeEnviar"
          data-qa="pagar-enviar"
          @click="enviar"
        />
      </div>
    </template>
  </UModal>
</template>
