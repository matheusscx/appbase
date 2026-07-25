<script setup lang="ts">
import Decimal from 'decimal.js'
import type { ArqueoLinea } from '~/stores/caja'

const props = defineProps<{ cajaId: string, resumir?: boolean }>()
const open = defineModel<boolean>('open', { required: true })

const cajaStore = useCajaStore()
const toast = useToast()
const { formatMonto } = useFormatters()

const fase = ref<'conteo' | 'conciliacion'>('conteo')
const saving = ref(false)
const loading = ref(false)

// Fase 1 (conteo): contado por clave de línea (metodoPagoId ?? 'EFECTIVO').
const contado = ref<Record<string, string>>({})
const comentario = ref('')

// Fase 2 (conciliación): motivo/comentario de diferencia por clave de línea.
const motivoPorClave = ref<Record<string, string>>({})
const comentarioJustificacionPorClave = ref<Record<string, string>>({})

const claveDe = (l: ArqueoLinea) => l.metodoPagoId ?? 'EFECTIVO'

const ciego = computed(() => cajaStore.arqueoCiego)

const motivoItems = computed(() =>
  cajaStore.motivos.map(m => ({ label: m.nombre, value: m.id })),
)

function resetEstadoLocal() {
  contado.value = {}
  comentario.value = ''
  motivoPorClave.value = {}
  comentarioJustificacionPorClave.value = {}
  fase.value = 'conteo'
}

watch(open, async (isOpen) => {
  if (!isOpen) {
    resetEstadoLocal()
    return
  }
  loading.value = true
  try {
    // Retomar: prop explícita o, si no viene, la propia caja activa ya está
    // `en_conciliacion` (caso típico: se cerró el drawer y se reabre después).
    const debeResumir = props.resumir ?? cajaStore.activa?.estado === 'en_conciliacion'
    if (debeResumir) {
      fase.value = 'conciliacion'
      await Promise.all([
        cajaStore.cargarArqueo(props.cajaId),
        cajaStore.cargarMotivos(true),
      ])
    }
    else {
      fase.value = 'conteo'
      await cajaStore.cargarArqueo(props.cajaId)
    }
  }
  finally {
    loading.value = false
  }
})

// --- Fase 1: conteo ---

const obligatorias = computed(() =>
  cajaStore.arqueo.filter(l => l.esEfectivo || l.requiereConteo),
)
const informativas = computed(() =>
  cajaStore.arqueo.filter(l => !l.esEfectivo && !l.requiereConteo),
)

function diferenciaDe(l: ArqueoLinea): Decimal | null {
  if (l.esperado == null) return null
  const c = contado.value[claveDe(l)]
  if (!c) return null
  try {
    return new Decimal(c).minus(l.esperado)
  }
  catch {
    return null
  }
}

const obligatoriasCompletas = computed(() =>
  obligatorias.value.every(l => !!contado.value[claveDe(l)]),
)

/** Común a ambas fases: toast + cierre del drawer + revelación en el detalle. */
async function finalizarExito(arqueoResultante: ArqueoLinea[]) {
  const efectivo = arqueoResultante.find(l => l.esEfectivo)
  const dif = efectivo?.diferencia ?? '0'
  toast.add({
    title: 'Caja cerrada',
    description: `Diferencia de efectivo: ${formatMonto(dif)}`,
    color: new Decimal(dif).gte(0) ? 'success' : 'error',
  })
  open.value = false
  if (ciego.value) {
    // Revelación: el arqueo se muestra en el detalle. Desde POS, navigateTo
    // remonta /mi-caja/[id] y su onMounted recarga todo; si ya se está ahí,
    // es una navegación al mismo destino (no-op).
    await navigateTo(`/mi-caja/${props.cajaId}`)
  }
}

async function enviarConteo() {
  if (!obligatoriasCompletas.value) {
    toast.add({ title: 'Completa el conteo de las líneas obligatorias', color: 'warning' })
    return
  }
  saving.value = true
  try {
    const lineas = Object.entries(contado.value)
      .filter(([, v]) => v !== '')
      .map(([clave, montoContado]) => ({
        metodoPagoId: clave === 'EFECTIVO' ? null : clave,
        montoContado,
      }))
    const res = await cajaStore.enviarConteo(props.cajaId, { lineas, comentario: comentario.value || undefined })

    if (res.estado === 'en_conciliacion') {
      await cajaStore.cargarMotivos(true)
      fase.value = 'conciliacion'
      toast.add({ title: 'Conteo registrado: hay diferencias por conciliar', color: 'warning' })
      return
    }

    await finalizarExito(res.arqueo)
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Error al registrar el conteo'
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    saving.value = false
  }
}

// --- Fase 2: conciliación ---

const descuadres = computed(() =>
  cajaStore.arqueo.filter(l => l.diferencia != null && !new Decimal(l.diferencia).isZero()),
)

function motivoDe(l: ArqueoLinea) {
  return cajaStore.motivos.find(m => m.id === motivoPorClave.value[claveDe(l)])
}

function lineaJustificada(l: ArqueoLinea): boolean {
  const comentarioTexto = (comentarioJustificacionPorClave.value[claveDe(l)] ?? '').trim()
  // Red de seguridad: sin motivos activos configurados, el comentario es obligatorio.
  if (cajaStore.motivos.length === 0) return !!comentarioTexto
  const motivo = motivoDe(l)
  if (!motivo) return false
  if (motivo.requiereComentario && !comentarioTexto) return false
  return true
}

const conciliacionCompleta = computed(() => descuadres.value.every(lineaJustificada))

async function confirmarCierre() {
  if (!conciliacionCompleta.value) {
    toast.add({ title: 'Completa el motivo (o comentario) de cada diferencia', color: 'warning' })
    return
  }
  saving.value = true
  try {
    const lineas = descuadres.value.map(l => ({
      metodoPagoId: l.metodoPagoId,
      motivoDiferenciaId: motivoPorClave.value[claveDe(l)] || undefined,
      comentarioDiferencia: comentarioJustificacionPorClave.value[claveDe(l)]?.trim() || undefined,
    }))
    const res = await cajaStore.cerrar(props.cajaId, { lineas })
    await finalizarExito(res.arqueo)
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Error al confirmar el cierre'
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <AppDrawer v-model:open="open" width="md">
    <template #header>
      <span class="font-semibold text-default">
        {{ fase === 'conteo' ? 'Cerrar caja' : 'Conciliar diferencias' }}
      </span>
    </template>

    <template #body>
      <div v-if="loading" class="py-8 text-center text-muted text-sm">
        Cargando arqueo…
      </div>

      <UForm
        v-else-if="fase === 'conteo'"
        id="caja-cierre-form"
        :state="contado"
        class="space-y-6"
        @submit="enviarConteo"
      >
        <!-- A conciliar (obligatorias): efectivo primero -->
        <div class="space-y-3">
          <p class="text-xs font-semibold uppercase text-muted">A conciliar</p>
          <div
            v-for="l in obligatorias"
            :key="claveDe(l)"
            class="rounded-lg bg-muted p-3 space-y-2"
          >
            <div class="flex justify-between text-sm">
              <span class="font-medium text-default">{{ l.nombre }}</span>
              <span v-if="l.esperado != null" class="text-muted">Esperado {{ formatMonto(l.esperado) }}</span>
            </div>
            <MoneyInput
              :model-value="contado[claveDe(l)] ?? ''"
              oficial
              class="w-full"
              @update:model-value="(v: string) => { contado[claveDe(l)] = v }"
            />
            <div v-if="l.esperado != null" class="flex justify-between text-sm font-semibold">
              <span class="text-default">Diferencia</span>
              <span
                v-if="diferenciaDe(l) !== null"
                :class="diferenciaDe(l)!.gte(0) ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
              >
                {{ diferenciaDe(l)!.gte(0) ? '+' : '' }}{{ formatMonto(diferenciaDe(l)!) }}
              </span>
              <span v-else class="text-muted">—</span>
            </div>
          </div>
        </div>

        <!-- Informativas (opcionales) -->
        <div v-if="informativas.length" class="space-y-3">
          <p class="text-xs font-semibold uppercase text-muted">Informativas (opcional)</p>
          <div
            v-for="l in informativas"
            :key="claveDe(l)"
            class="rounded-lg border border-default p-3 space-y-2"
          >
            <div class="flex justify-between text-sm">
              <span class="font-medium text-default">{{ l.nombre }}</span>
              <span class="text-muted">Esperado {{ formatMonto(l.esperado) }}</span>
            </div>
            <MoneyInput
              :model-value="contado[claveDe(l)] ?? ''"
              oficial
              class="w-full"
              @update:model-value="(v: string) => { contado[claveDe(l)] = v }"
            />
            <div v-if="diferenciaDe(l) !== null" class="flex justify-between text-sm">
              <span class="text-muted">Diferencia</span>
              <span :class="diferenciaDe(l)!.gte(0) ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'">
                {{ diferenciaDe(l)!.gte(0) ? '+' : '' }}{{ formatMonto(diferenciaDe(l)!) }}
              </span>
            </div>
          </div>
        </div>

        <UFormField label="Comentario de cierre">
          <UInput v-model="comentario" placeholder="Observaciones del cierre (opcional)" class="w-full" />
        </UFormField>
      </UForm>

      <UForm
        v-else
        id="caja-cierre-form"
        :state="motivoPorClave"
        class="space-y-6"
        @submit="confirmarCierre"
      >
        <p class="text-sm text-muted">
          El conteo no cuadró. Justificá cada diferencia para confirmar el cierre.
        </p>

        <div class="space-y-3">
          <div
            v-for="l in cajaStore.arqueo"
            :key="claveDe(l)"
            class="rounded-lg p-3 space-y-2"
            :class="l.diferencia != null && !new Decimal(l.diferencia).isZero() ? 'bg-muted' : 'border border-default'"
          >
            <div class="flex justify-between text-sm">
              <span class="font-medium text-default">{{ l.nombre }}</span>
              <span class="text-muted">
                Esperado {{ l.esperado != null ? formatMonto(l.esperado) : '—' }}
                · Contado {{ l.contado != null ? formatMonto(l.contado) : '—' }}
              </span>
            </div>
            <div class="flex justify-between text-sm font-semibold">
              <span class="text-default">Diferencia</span>
              <span
                v-if="l.diferencia != null"
                :class="new Decimal(l.diferencia).gte(0) ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
              >
                {{ new Decimal(l.diferencia).gte(0) ? '+' : '' }}{{ formatMonto(l.diferencia) }}
              </span>
              <span v-else class="text-muted">—</span>
            </div>

            <template v-if="l.diferencia != null && !new Decimal(l.diferencia).isZero()">
              <USelect
                v-if="motivoItems.length"
                v-model="motivoPorClave[claveDe(l)]"
                :items="motivoItems"
                placeholder="Motivo de la diferencia"
                class="w-full"
              />
              <p v-else class="text-xs text-warning">
                No hay motivos activos configurados: describí la diferencia en el comentario.
              </p>
              <UInput
                v-model="comentarioJustificacionPorClave[claveDe(l)]"
                :placeholder="motivoDe(l)?.requiereComentario || !motivoItems.length ? 'Comentario (obligatorio)' : 'Comentario (opcional)'"
                class="w-full"
              />
            </template>
          </div>
        </div>
      </UForm>
    </template>

    <template #actions>
      <UButton color="neutral" variant="ghost" @click="() => { open = false }">
        Cancelar
      </UButton>
      <UButton
        type="submit"
        form="caja-cierre-form"
        color="error"
        icon="i-lucide-lock"
        :loading="saving"
        :disabled="loading || (fase === 'conteo' ? !obligatoriasCompletas : !conciliacionCompleta)"
      >
        {{ fase === 'conteo' ? 'Enviar conteo' : 'Confirmar cierre' }}
      </UButton>
    </template>
  </AppDrawer>
</template>
