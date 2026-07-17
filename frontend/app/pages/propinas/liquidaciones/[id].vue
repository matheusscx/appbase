<script setup lang="ts">
import type {
  LiquidacionDetalle,
  LiquidacionGrupo,
  LiquidacionParticipante,
} from '~/composables/usePropinaLiquidaciones'
import type { Garzon } from '~/composables/useGarzones'

definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const route = useRoute()
const toast = useToast()
const api = usePropinaLiquidaciones()
const garzonesApi = useGarzones()
const permissionsStore = usePermissionsStore()
const { formatMonto, formatFecha, formatPorcentaje } = useFormatters()

const id = computed(() => String(route.params.id))
const liquidacion = ref<LiquidacionDetalle | null>(null)
const garzones = ref<Garzon[]>([])
const loading = ref(false)
const saving = ref(false)
const motivoAnulacion = ref('')
const motivos = reactive<Record<string, string>>({})
const montos = reactive<Record<string, string>>({})
const pesos = reactive<Record<string, string>>({})

const puedeLiquidar = computed(
  () => permissionsStore.esAdmin || permissionsStore.can('Propinas', 'Liquidar'),
)

const esBorrador = computed(() => liquidacion.value?.estado === 'borrador')
const esConfirmada = computed(() => liquidacion.value?.estado === 'confirmada')

function estadoColor(estado: string): 'neutral' | 'success' | 'error' | 'warning' {
  const map: Record<string, 'neutral' | 'success' | 'error' | 'warning'> = {
    borrador: 'warning',
    confirmada: 'success',
    anulada: 'error',
  }
  return map[estado] ?? 'neutral'
}

function estadoLabel(estado: string): string {
  const map: Record<string, string> = {
    borrador: 'Borrador',
    confirmada: 'Confirmada',
    anulada: 'Anulada',
  }
  return map[estado] ?? estado
}

function criterioLabel(criterio: string): string {
  const map: Record<string, string> = {
    PARTES_IGUALES: 'Partes iguales',
    VENTAS_NETAS: 'Ventas netas',
    HORAS_TRABAJADAS: 'Horas trabajadas',
    CANTIDAD_CUENTAS: 'Cantidad de cuentas',
    MANUAL: 'Manual',
  }
  return map[criterio] ?? criterio
}

function garzonNombre(garzonId: string): string {
  return garzones.value.find(g => g.id === garzonId)?.nombre ?? garzonId
}

function participantesGrupo(grupo: LiquidacionGrupo): LiquidacionParticipante[] {
  return liquidacion.value?.participantes.filter(p => p.grupoId === grupo.id) ?? []
}

async function cargar() {
  loading.value = true
  try {
    const [detalle, gz] = await Promise.all([
      api.detalle(id.value),
      garzonesApi.listar(),
    ])
    aplicarDetalle(detalle)
    garzones.value = gz
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar liquidación'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function aplicarDetalle(detalle: LiquidacionDetalle) {
  liquidacion.value = detalle
  for (const p of detalle.participantes) {
    pesos[p.id] = p.pesoManual ?? ''
    montos[p.id] = p.monto
    motivos[p.id] = p.motivoAjuste ?? ''
  }
}

async function actualizarParticipante(p: LiquidacionParticipante, patch: Partial<LiquidacionParticipante>) {
  if (!liquidacion.value) return
  saving.value = true
  try {
    const updated = await api.actualizar(liquidacion.value.id, {
      participantes: [{
        id: p.id,
        incluido: patch.incluido,
        motivoAjuste: motivos[p.id],
        pesoManual: (patch.pesoManual ?? pesos[p.id]) || undefined,
        monto: (patch.monto ?? montos[p.id]) || undefined,
        ajusteMotivoMonto: patch.ajusteMotivoMonto,
      }],
    })
    aplicarDetalle(updated)
    toast.add({ title: 'Liquidación recalculada', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al actualizar participante'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function actualizarConfig() {
  if (!liquidacion.value) return
  saving.value = true
  try {
    const updated = await api.actualizarConfig(liquidacion.value.id)
    aplicarDetalle(updated)
    toast.add({ title: 'Snapshot actualizado desde configuración vigente', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al actualizar configuración'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function confirmar() {
  if (!liquidacion.value) return
  saving.value = true
  try {
    aplicarDetalle(await api.confirmar(liquidacion.value.id))
    toast.add({ title: 'Liquidación confirmada', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al confirmar liquidación'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

async function anular() {
  if (!liquidacion.value || !motivoAnulacion.value.trim()) {
    toast.add({ title: 'Ingresa un motivo de anulación', color: 'warning' })
    return
  }
  saving.value = true
  try {
    aplicarDetalle(await api.anular(liquidacion.value.id, { motivo: motivoAnulacion.value }))
    toast.add({ title: 'Liquidación anulada', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al anular liquidación'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

onMounted(cargar)
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Detalle liquidación" />
    </template>

    <template #body>
      <div v-if="loading" class="py-12 text-center text-sm text-muted">
        <UIcon name="i-lucide-loader" class="size-6 animate-spin mx-auto mb-2" />
        Cargando liquidación…
      </div>

      <div v-else-if="liquidacion" class="space-y-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div class="flex items-center gap-2">
              <h1 class="text-xl font-semibold text-default">
                Liquidación de propinas
              </h1>
              <UBadge :color="estadoColor(liquidacion.estado)" variant="subtle">
                {{ estadoLabel(liquidacion.estado) }}
              </UBadge>
            </div>
            <p class="text-sm text-muted">
              {{ formatFecha(liquidacion.fechaDesde) }} → {{ formatFecha(liquidacion.fechaHasta) }}
            </p>
          </div>

          <div class="flex flex-wrap gap-2">
            <UButton
              v-if="esBorrador && puedeLiquidar"
              variant="outline"
              icon="i-lucide-refresh-cw"
              label="Actualizar config"
              :loading="saving"
              @click="actualizarConfig"
            />
            <UButton
              v-if="esBorrador && puedeLiquidar"
              icon="i-lucide-check"
              label="Confirmar"
              :loading="saving"
              @click="confirmar"
            />
          </div>
        </div>

        <div class="grid gap-4 md:grid-cols-4">
          <UCard>
            <p class="text-sm text-muted">Pool total</p>
            <p class="text-2xl font-semibold text-default">
              {{ formatMonto(liquidacion.poolTotal, liquidacion.monedaId) }}
            </p>
          </UCard>
          <UCard>
            <p class="text-sm text-muted">Config</p>
            <p class="text-2xl font-semibold text-default">
              v{{ liquidacion.configuracionVersion }}
            </p>
          </UCard>
          <UCard>
            <p class="text-sm text-muted">Fuentes</p>
            <p class="text-2xl font-semibold text-default">
              {{ liquidacion.fuentes.length }}
            </p>
          </UCard>
          <UCard>
            <p class="text-sm text-muted">Participantes</p>
            <p class="text-2xl font-semibold text-default">
              {{ liquidacion.participantes.filter(p => p.incluido).length }}
            </p>
          </UCard>
        </div>

        <UAlert
          v-for="warning in liquidacion.advertencias"
          :key="warning"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="warning"
        />

        <div class="space-y-4">
          <UCard
            v-for="grupo in liquidacion.grupos"
            :key="grupo.id"
          >
            <template #header>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p class="font-medium text-default">
                    {{ grupo.nombre }}
                  </p>
                  <p class="text-sm text-muted">
                    {{ formatPorcentaje(grupo.porcentaje) }} · {{ criterioLabel(grupo.criterio) }}
                    <span v-if="grupo.manualModo">· {{ grupo.manualModo }}</span>
                  </p>
                </div>
                <p class="font-semibold text-default">
                  {{ formatMonto(grupo.montoGrupo, liquidacion.monedaId) }}
                </p>
              </div>
            </template>

            <div class="space-y-3">
              <div
                v-for="p in participantesGrupo(grupo)"
                :key="p.id"
                class="rounded-lg border border-default p-3"
              >
                <div class="grid gap-3 lg:grid-cols-[1fr_120px_120px_120px_160px] lg:items-center">
                  <div>
                    <p class="font-medium text-default">
                      {{ garzonNombre(p.garzonId) }}
                    </p>
                    <p class="text-xs text-muted">
                      {{ p.origen === 'sugerido' ? 'Sugerido' : 'Agregado manual' }}
                      <span v-if="!p.incluido">· Excluido</span>
                    </p>
                  </div>

                  <div class="text-sm">
                    <p class="text-muted">Horas</p>
                    <p class="text-default">{{ p.horas }}</p>
                  </div>
                  <div class="text-sm">
                    <p class="text-muted">Ventas</p>
                    <p class="text-default">{{ formatMonto(p.ventasBase, liquidacion.monedaId) }}</p>
                  </div>
                  <div class="text-sm">
                    <p class="text-muted">Monto</p>
                    <p class="font-medium text-default">{{ formatMonto(p.monto, liquidacion.monedaId) }}</p>
                  </div>

                  <div v-if="esBorrador && puedeLiquidar" class="space-y-2">
                    <UInput
                      v-model="motivos[p.id]"
                      size="sm"
                      placeholder="Motivo ajuste"
                    />
                    <div v-if="grupo.criterio === 'MANUAL' && grupo.manualModo === 'PESOS'" class="flex gap-2">
                      <UInput
                        v-model="pesos[p.id]"
                        size="sm"
                        inputmode="decimal"
                        placeholder="Peso"
                      />
                      <UButton
                        size="sm"
                        variant="outline"
                        icon="i-lucide-save"
                        :loading="saving"
                        @click="actualizarParticipante(p, { pesoManual: pesos[p.id] })"
                      />
                    </div>
                    <div v-else-if="grupo.criterio === 'MANUAL' && grupo.manualModo === 'MONTOS'" class="flex gap-2">
                      <UInput
                        v-model="montos[p.id]"
                        size="sm"
                        inputmode="decimal"
                        placeholder="Monto"
                      />
                      <UButton
                        size="sm"
                        variant="outline"
                        icon="i-lucide-save"
                        :loading="saving"
                        @click="actualizarParticipante(p, { monto: montos[p.id], ajusteMotivoMonto: motivos[p.id] })"
                      />
                    </div>
                    <UButton
                      size="sm"
                      class="w-full justify-center"
                      :variant="p.incluido ? 'outline' : 'solid'"
                      :color="p.incluido ? 'neutral' : 'primary'"
                      :label="p.incluido ? 'Excluir' : 'Incluir'"
                      :loading="saving"
                      @click="actualizarParticipante(p, { incluido: !p.incluido })"
                    />
                  </div>
                </div>
              </div>
            </div>
          </UCard>
        </div>

        <UCard v-if="esConfirmada && puedeLiquidar">
          <template #header>
            <span class="font-medium text-default">Anular liquidación</span>
          </template>
          <div class="flex flex-col gap-3 md:flex-row">
            <UInput
              v-model="motivoAnulacion"
              class="flex-1"
              placeholder="Motivo de anulación"
            />
            <UButton
              color="error"
              variant="outline"
              icon="i-lucide-ban"
              label="Anular"
              :loading="saving"
              @click="anular"
            />
          </div>
        </UCard>

        <UCard>
          <template #header>
            <span class="font-medium text-default">Eventos</span>
          </template>
          <div class="space-y-2">
            <div
              v-for="evento in liquidacion.eventos"
              :key="evento.id"
              class="flex items-center justify-between gap-3 text-sm"
            >
              <span class="text-default">{{ evento.tipo }}</span>
              <span class="text-muted">{{ formatFecha(evento.creadoEl) }}</span>
            </div>
            <p v-if="liquidacion.eventos.length === 0" class="text-sm text-muted">
              Sin eventos registrados.
            </p>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
