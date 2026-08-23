<script setup lang="ts">
import Decimal from 'decimal.js'
import type { TableColumn } from '@nuxt/ui'
import type { CierrePendienteRevision, ResumenDescuadresDia } from '~/stores/caja'

const cajaStore = useCajaStore()
const permisos = usePermissionsStore()
const toast = useToast()
const { formatMonto, formatFecha } = useFormatters()

const filas = ref<CierrePendienteRevision[]>([])
const resumen = ref<ResumenDescuadresDia | null>(null)
const loading = ref(false)
const fallo = ref(false)
const marcando = ref<string | null>(null)

/**
 * Esconder el botón NO es el control —lo es el guard de `Cajas:Actualizar` en
 * el backend—, pero ofrecer una acción que va a rebotar con 403 es peor que no
 * ofrecerla. El supervisor con solo `Cajas:Leer` ve la bandeja y no marca.
 */
const puedeMarcar = computed(
  () => permisos.esAdmin || permisos.can('Cajas', 'Actualizar'),
)

async function cargar() {
  loading.value = true
  fallo.value = false
  try {
    const [pendientes, delDia] = await Promise.all([
      cajaStore.cargarPendientesRevision(),
      cajaStore.cargarResumenDescuadresDia(),
    ])
    filas.value = pendientes
    resumen.value = delDia
  }
  catch (e: unknown) {
    // Mismo criterio que la tendencia: en una pantalla de control, "no pude
    // cargar" no se puede leer como "no hay nada pendiente". La lista se vacía
    // y el cartel lo dice — mejor sin datos que con datos que mienten.
    filas.value = []
    resumen.value = null
    fallo.value = true
    toast.add({ title: apiErrorMsg(e, 'Error al cargar los pendientes'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

onMounted(cargar)

async function marcarVisto(cajaId: string) {
  marcando.value = cajaId
  try {
    await cajaStore.marcarRevisado(cajaId)
    toast.add({ title: 'Cierre marcado como revisado', color: 'success' })
    await cargar()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'No se pudo marcar como revisado'), color: 'error' })
  }
  finally {
    marcando.value = null
  }
}

const columns: TableColumn<CierrePendienteRevision>[] = [
  { accessorKey: 'fechaCierre', header: 'Cierre' },
  { accessorKey: 'usuarioNombre', header: 'Cajero' },
  { accessorKey: 'cajonNombre', header: 'Cajón' },
  { accessorKey: 'peorDiferencia', header: 'Mayor diferencia', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'explicacionDescuadre', header: 'Qué dijo el cajero' },
  { accessorKey: 'acciones', header: '' },
]

/** El signo del efectivo del turno; la magnitud que disparó va en otra columna. */
function claseMonto(val: string | null): string {
  if (val == null) return 'text-muted'
  const d = new Decimal(val)
  if (d.isZero()) return 'text-muted'
  return d.gt(0)
    ? 'text-green-600 dark:text-green-400'
    : 'text-red-600 dark:text-red-400'
}
</script>

<template>
  <div class="w-full space-y-6">
    <!-- Resumen del día. Es lo que reemplaza al correo diario mientras el
         envío programado siga siendo trabajo futuro: la jornada de un vistazo
         al abrir la pantalla. -->
    <UCard v-if="resumen" data-qa="resumen-descuadres-dia">
      <template #header>
        <div class="flex items-baseline justify-between gap-2">
          <span class="font-semibold text-default">Hoy</span>
          <span class="text-xs text-muted">{{ formatFecha(resumen.fecha) }}</span>
        </div>
      </template>
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <div>
          <p class="text-xs text-muted">Cierres</p>
          <p class="text-lg font-semibold text-default">{{ resumen.cierres }}</p>
        </div>
        <div>
          <p class="text-xs text-muted">Con diferencia</p>
          <p class="text-lg font-semibold text-default">{{ resumen.conDescuadre }}</p>
        </div>
        <div>
          <p class="text-xs text-muted">Nivel aviso</p>
          <p class="text-lg font-semibold text-warning">{{ resumen.nivelAviso }}</p>
        </div>
        <div>
          <p class="text-xs text-muted">Nivel alto</p>
          <p class="text-lg font-semibold text-error">{{ resumen.nivelAlto }}</p>
        </div>
        <div>
          <p class="text-xs text-muted">Efectivo del día</p>
          <p class="text-lg font-semibold font-mono" :class="claseMonto(resumen.efectivoSuma)">
            {{ formatMonto(resumen.efectivoSuma) }}
          </p>
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <div class="space-y-3">
          <p class="text-sm text-muted">
            Cierres cuya diferencia superó el <strong>límite alto</strong> del local y que
            todavía nadie revisó. El cierre nunca se frenó: el cajero cerró y se fue, y
            esto es el rastro que queda para que alguien lo mire.
          </p>
          <p class="text-sm text-muted">
            Marcar visto registra <strong>quién</strong> revisó y <strong>cuándo</strong>,
            y saca el cierre de esta lista. Los umbrales se configuran en
            <ULink to="/configuracion/preferencias-financieras" class="text-highlighted">
              Preferencias financieras
            </ULink>.
          </p>
        </div>
      </template>

      <UTable :data="filas" :columns="columns" :loading="loading">
        <template #fechaCierre-cell="{ row }">
          <div class="space-y-0.5">
            <p class="text-sm text-default">
              {{ formatFecha(row.original.fechaCierre ?? row.original.fechaApertura) }}
            </p>
            <div class="flex gap-1">
              <UBadge v-if="row.original.forzado" color="warning" variant="subtle" size="sm">
                Cierre forzado
              </UBadge>
              <UBadge
                v-if="row.original.estado === 'en_conciliacion'"
                color="neutral"
                variant="subtle"
                size="sm"
              >
                Sin finalizar
              </UBadge>
            </div>
          </div>
        </template>

        <template #peorDiferencia-cell="{ row }">
          <div class="space-y-0.5">
            <p class="font-mono font-semibold text-error">
              {{ formatMonto(row.original.peorDiferencia) }}
            </p>
            <p class="text-xs text-muted font-mono" :class="claseMonto(row.original.diferencia)">
              Efectivo {{ row.original.diferencia != null ? formatMonto(row.original.diferencia) : '—' }}
            </p>
          </div>
        </template>

        <template #explicacionDescuadre-cell="{ row }">
          <p v-if="row.original.explicacionDescuadre" class="text-sm text-default max-w-xs">
            {{ row.original.explicacionDescuadre }}
          </p>
          <p v-else-if="row.original.comentarioCierre" class="text-sm text-muted max-w-xs">
            {{ row.original.comentarioCierre }}
          </p>
          <p v-else class="text-sm text-muted italic">
            No dejó explicación
          </p>
        </template>

        <template #acciones-cell="{ row }">
          <div class="flex justify-end gap-2">
            <UButton
              :to="`/cajas/${row.original.cajaId}`"
              variant="ghost"
              color="neutral"
              size="sm"
              icon="i-lucide-eye"
              label="Ver cierre"
            />
            <UButton
              v-if="puedeMarcar"
              size="sm"
              color="primary"
              icon="i-lucide-check"
              label="Marcar visto"
              :loading="marcando === row.original.cajaId"
              :data-qa="`marcar-visto-${row.original.cajaId}`"
              @click="marcarVisto(row.original.cajaId)"
            />
          </div>
        </template>

        <template #empty>
          <div v-if="fallo" class="py-10 text-center text-sm text-error">
            No se pudo cargar la bandeja. Volvé a intentar — esto no significa que
            no haya cierres pendientes.
          </div>
          <div v-else-if="loading" class="py-10 text-center text-sm text-muted">
            Cargando…
          </div>
          <!-- Recién con la carga terminada se puede afirmar que no hay nada. -->
          <div v-else class="py-10 text-center text-sm text-muted">
            No hay cierres pendientes de revisar.
          </div>
        </template>
      </UTable>
    </UCard>
  </div>
</template>
