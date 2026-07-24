<script setup lang="ts">
import Decimal from 'decimal.js'
import type { ArqueoLinea } from '~/stores/caja'

const props = defineProps<{ cajaId: string }>()
const open = defineModel<boolean>('open', { required: true })

const cajaStore = useCajaStore()
const toast = useToast()
const { formatMonto } = useFormatters()

const saving = ref(false)
const loading = ref(false)
// Contado por clave de línea (metodoPagoId ?? 'EFECTIVO').
const contado = ref<Record<string, string>>({})

const claveDe = (l: ArqueoLinea) => l.metodoPagoId ?? 'EFECTIVO'

const obligatorias = computed(() =>
  cajaStore.arqueo.filter(l => l.esEfectivo || l.requiereConteo),
)
const informativas = computed(() =>
  cajaStore.arqueo.filter(l => !l.esEfectivo && !l.requiereConteo),
)

function diferenciaDe(l: ArqueoLinea): Decimal | null {
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

watch(open, async (isOpen) => {
  if (!isOpen) {
    contado.value = {}
    return
  }
  loading.value = true
  try {
    await cajaStore.cargarArqueo(props.cajaId)
  }
  finally {
    loading.value = false
  }
})

async function cerrarCaja() {
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
    await cajaStore.cerrar(props.cajaId, { lineas, comentario: comentario.value || undefined })
    toast.add({ title: 'Caja cerrada correctamente', color: 'success' })
    open.value = false
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Error al cerrar la caja'
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    saving.value = false
  }
}

const comentario = ref('')
watch(open, (isOpen) => { if (!isOpen) comentario.value = '' })
</script>

<template>
  <AppDrawer v-model:open="open" width="md">
    <template #header>
      <span class="font-semibold text-default">Cerrar caja</span>
    </template>

    <template #body>
      <div v-if="loading" class="py-8 text-center text-muted text-sm">
        Cargando arqueo…
      </div>
      <UForm
        v-else
        id="caja-cierre-form"
        :state="contado"
        class="space-y-6"
        @submit="cerrarCaja"
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
              <span class="text-muted">Esperado {{ formatMonto(l.esperado) }}</span>
            </div>
            <MoneyInput
              :model-value="contado[claveDe(l)] ?? ''"
              oficial
              class="w-full"
              @update:model-value="(v: string) => { contado[claveDe(l)] = v }"
            />
            <div class="flex justify-between text-sm font-semibold">
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
        :disabled="loading || !obligatoriasCompletas"
      >
        Confirmar cierre
      </UButton>
    </template>
  </AppDrawer>
</template>
