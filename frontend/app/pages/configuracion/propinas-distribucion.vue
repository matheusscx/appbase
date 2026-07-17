<script setup lang="ts">
import Decimal from 'decimal.js'
import type { Garzon } from '~/composables/useGarzones'
import type {
  BaseVentasGrupo,
  CriterioDistribucion,
  DistribucionPublica,
  GrupoDistribucion,
  ManualModo,
} from '~/composables/usePropinaDistribucion'
import {
  porcentajeDecimalAHumano,
  porcentajeHumanoADecimal,
} from '~/composables/usePropina'

const toast = useToast()
const { formatPorcentaje } = useFormatters()
const permissionsStore = usePermissionsStore()
const api = usePropinaDistribucion()
const garzonesApi = useGarzones()

const puedeConfigurar = computed(
  () => permissionsStore.esAdmin || permissionsStore.can('Propinas', 'Configurar'),
)

const loading = ref(false)
const saving = ref(false)
const version = ref(0)
const porcentajeSugeridoHumano = ref('10')
const grupos = ref<GrupoDistribucion[]>([])
const garzones = ref<Garzon[]>([])

const tipoOptions = [
  { label: 'Garzón', value: 'garzon' },
  { label: 'Cocina', value: 'cocina' },
  { label: 'Barra', value: 'barra' },
]

const criterioOptions = [
  { label: 'Partes iguales', value: 'PARTES_IGUALES' },
  { label: 'Ventas netas', value: 'VENTAS_NETAS' },
  { label: 'Horas trabajadas', value: 'HORAS_TRABAJADAS' },
  { label: 'Cantidad de cuentas', value: 'CANTIDAD_CUENTAS' },
  { label: 'Manual', value: 'MANUAL' },
]

const baseVentasOptions = [
  { label: 'Total final', value: 'TOTAL_FINAL' },
  { label: 'Base sin impuestos', value: 'BASE_SIN_IMPUESTOS' },
]

const manualModoOptions = [
  { label: 'Pesos relativos', value: 'PESOS' },
  { label: 'Montos en liquidación', value: 'MONTOS' },
]

function grupoVacio(orden: number): GrupoDistribucion {
  return {
    tipoGarzon: 'garzon',
    nombre: 'Garzones',
    porcentaje: '1',
    criterio: 'PARTES_IGUALES',
    baseVentas: 'TOTAL_FINAL',
    manualModo: null,
    activo: true,
    orden,
    pesos: [],
  }
}

function aplicarRespuesta(data: DistribucionPublica) {
  version.value = data.version
  porcentajeSugeridoHumano.value = porcentajeDecimalAHumano(
    data.porcentajeSugerido ?? '0.10',
  )
  grupos.value = data.grupos.map(g => ({
    id: g.id,
    tipoGarzon: g.tipoGarzon,
    nombre: g.nombre,
    porcentaje: g.porcentaje,
    criterio: g.criterio,
    baseVentas: g.baseVentas ?? 'TOTAL_FINAL',
    manualModo: g.manualModo,
    activo: g.activo,
    orden: g.orden,
    pesos: (g.pesos ?? []).map(p => ({ ...p })),
  }))
}

async function cargar() {
  loading.value = true
  try {
    const [dist, gz] = await Promise.all([
      api.obtener(),
      garzonesApi.listar(),
    ])
    aplicarRespuesta(dist)
    garzones.value = gz.filter(g => g.activo)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar distribución'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

onMounted(cargar)

const sumaActivos = computed(() => {
  try {
    return grupos.value
      .filter(g => g.activo)
      .reduce((acc, g) => acc.plus(g.porcentaje || '0'), new Decimal(0))
  }
  catch {
    return new Decimal(NaN)
  }
})

const sumaEsCien = computed(() => {
  try {
    return sumaActivos.value.equals(1)
  }
  catch {
    return false
  }
})

function garzonesDeTipo(tipo: string) {
  return garzones.value
    .filter(g => g.tipo === tipo)
    .map(g => ({ label: g.nombre, value: g.id }))
}

function agregarGrupo() {
  grupos.value = [...grupos.value, grupoVacio(grupos.value.length)]
}

function quitarGrupo(index: number) {
  grupos.value = grupos.value.filter((_, i) => i !== index)
}

function onCriterioChange(g: GrupoDistribucion, criterio: CriterioDistribucion) {
  g.criterio = criterio
  if (criterio === 'MANUAL') {
    g.manualModo = g.manualModo ?? 'PESOS'
  }
  else {
    g.manualModo = null
    g.pesos = []
  }
}

function onManualModoChange(g: GrupoDistribucion, modo: ManualModo) {
  g.manualModo = modo
  if (modo === 'MONTOS') g.pesos = []
}

function agregarPeso(g: GrupoDistribucion) {
  const opciones = garzonesDeTipo(g.tipoGarzon)
  const usado = new Set(g.pesos.map(p => p.garzonId))
  const libre = opciones.find(o => !usado.has(o.value))
  g.pesos = [...g.pesos, { garzonId: libre?.value ?? '', peso: '1' }]
}

function quitarPeso(g: GrupoDistribucion, index: number) {
  g.pesos = g.pesos.filter((_, i) => i !== index)
}

async function guardar() {
  if (!puedeConfigurar.value || !sumaEsCien.value) return
  saving.value = true
  try {
    const body = {
      porcentajeSugerido: porcentajeHumanoADecimal(porcentajeSugeridoHumano.value),
      grupos: grupos.value.map((g, i) => ({
        tipoGarzon: g.tipoGarzon,
        nombre: g.nombre,
        porcentaje: g.porcentaje,
        criterio: g.criterio,
        baseVentas: g.baseVentas as BaseVentasGrupo,
        manualModo: g.criterio === 'MANUAL' ? g.manualModo : null,
        activo: g.activo,
        orden: i,
        pesos:
          g.criterio === 'MANUAL' && g.manualModo === 'PESOS'
            ? g.pesos.filter(p => p.garzonId)
            : undefined,
      })),
    }
    const saved = await api.reemplazar(body)
    aplicarRespuesta(saved)
    toast.add({ title: 'Distribución guardada', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <CrudPageHeader
      title="Distribución de propinas"
      description="Configura la propina sugerida al cerrar mesas y cómo se reparte el pool entre grupos."
    >
      <template #actions>
        <UBadge
          v-if="version"
          color="neutral"
          variant="subtle"
        >
          v{{ version }}
        </UBadge>
      </template>
    </CrudPageHeader>

    <div
      v-if="loading"
      class="py-12 text-center text-sm text-muted"
    >
      Cargando…
    </div>

    <template v-else>
      <UCard>
        <UFormField
          label="Propina sugerida (%)"
          hint="Porcentaje que se prellena al cerrar una cuenta de mesa. El cajero puede editarlo."
        >
          <UInput
            v-model="porcentajeSugeridoHumano"
            inputmode="decimal"
            class="w-32"
            :disabled="!puedeConfigurar"
            data-qa="propina-sugerida-pct"
          />
        </UFormField>
      </UCard>

      <div class="space-y-4">
        <div
          v-for="(g, index) in grupos"
          :key="g.id ?? `nuevo-${index}`"
          class="rounded-lg border border-default bg-default p-4 space-y-3"
        >
          <div class="flex items-center justify-between gap-2">
            <p class="text-sm font-semibold text-default">
              Grupo {{ index + 1 }}
            </p>
            <div class="flex items-center gap-2">
              <UFormField label="Activo">
                <USwitch
                  v-model="g.activo"
                  :disabled="!puedeConfigurar"
                />
              </UFormField>
              <UButton
                v-if="puedeConfigurar && grupos.length > 1"
                icon="i-lucide-trash-2"
                color="neutral"
                variant="ghost"
                size="sm"
                @click="quitarGrupo(index)"
              />
            </div>
          </div>

          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <UFormField label="Tipo" required>
              <USelect
                v-model="g.tipoGarzon"
                :items="tipoOptions"
                value-key="value"
                :disabled="!puedeConfigurar"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Nombre" required>
              <UInput
                v-model="g.nombre"
                :disabled="!puedeConfigurar"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Porcentaje (decimal)" required>
              <UInput
                v-model="g.porcentaje"
                inputmode="decimal"
                placeholder="0.80"
                :disabled="!puedeConfigurar"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Criterio" required>
              <USelect
                :model-value="g.criterio"
                :items="criterioOptions"
                value-key="value"
                :disabled="!puedeConfigurar"
                class="w-full"
                @update:model-value="(v: CriterioDistribucion) => onCriterioChange(g, v)"
              />
            </UFormField>
            <UFormField
              v-if="g.criterio === 'VENTAS_NETAS'"
              label="Base de ventas"
            >
              <USelect
                v-model="g.baseVentas"
                :items="baseVentasOptions"
                value-key="value"
                :disabled="!puedeConfigurar"
                class="w-full"
              />
            </UFormField>
            <UFormField
              v-if="g.criterio === 'MANUAL'"
              label="Modo manual"
              required
            >
              <USelect
                :model-value="g.manualModo ?? 'PESOS'"
                :items="manualModoOptions"
                value-key="value"
                :disabled="!puedeConfigurar"
                class="w-full"
                @update:model-value="(v: ManualModo) => onManualModoChange(g, v)"
              />
            </UFormField>
          </div>

          <div
            v-if="g.criterio === 'MANUAL' && g.manualModo === 'PESOS'"
            class="space-y-2 border-t border-default pt-3"
          >
            <div class="flex items-center justify-between">
              <p class="text-sm font-medium text-default">
                Pesos por garzón
              </p>
              <UButton
                v-if="puedeConfigurar"
                size="xs"
                variant="soft"
                icon="i-lucide-plus"
                @click="agregarPeso(g)"
              >
                Peso
              </UButton>
            </div>
            <div
              v-for="(p, pi) in g.pesos"
              :key="pi"
              class="flex flex-wrap items-end gap-2"
            >
              <UFormField label="Garzón" class="min-w-48 flex-1">
                <USelect
                  v-model="p.garzonId"
                  :items="garzonesDeTipo(g.tipoGarzon)"
                  value-key="value"
                  :disabled="!puedeConfigurar"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Peso" class="w-28">
                <UInput
                  v-model="p.peso"
                  inputmode="decimal"
                  :disabled="!puedeConfigurar"
                />
              </UFormField>
              <UButton
                v-if="puedeConfigurar"
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="sm"
                @click="quitarPeso(g, pi)"
              />
            </div>
            <p
              v-if="!g.pesos.length"
              class="text-xs text-muted"
            >
              Sin pesos: en la liquidación se pedirán o se usará partes iguales según E3.
            </p>
          </div>
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4">
        <div class="space-y-1">
          <p class="text-sm text-muted">
            Suma de activos:
            <span
              class="font-medium"
              :class="sumaEsCien ? 'text-default' : 'text-error'"
            >
              {{ formatPorcentaje(sumaActivos.isNaN() ? null : sumaActivos.toString()) }}
            </span>
            <span v-if="!sumaEsCien" class="text-error">
              (debe ser 100%)
            </span>
          </p>
          <UButton
            v-if="puedeConfigurar"
            size="sm"
            color="neutral"
            variant="ghost"
            icon="i-lucide-plus"
            @click="agregarGrupo"
          >
            Agregar grupo
          </UButton>
        </div>
        <UButton
          v-if="puedeConfigurar"
          :loading="saving"
          :disabled="!sumaEsCien || saving"
          @click="guardar"
        >
          Guardar
        </UButton>
      </div>
    </template>
  </div>
</template>
