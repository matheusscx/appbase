<script setup lang="ts">
import Decimal from 'decimal.js'
import type { ArqueoLinea } from '~/stores/caja'

const props = defineProps<{
  lineas: ArqueoLinea[]
  puedeJustificar?: boolean
  cajaId?: string
}>()

const { formatMonto } = useFormatters()
const cajaStore = useCajaStore()
const toast = useToast()

const saving = ref(false)
const claveDe = (l: ArqueoLinea) => l.metodoPagoId ?? 'EFECTIVO'

function descuadra(l: ArqueoLinea): boolean {
  return l.diferencia != null && !new Decimal(l.diferencia).isZero()
}

// Override admin: solo tiene sentido si hay algo para justificar/corregir.
const habilitarEdicion = computed(() =>
  !!props.puedeJustificar && !!props.cajaId && props.lineas.some(descuadra),
)

// Edición local por clave de línea, pre-cargada con lo ya justificado (permite corregir).
const motivoPorClave = ref<Record<string, string>>({})
const comentarioPorClave = ref<Record<string, string>>({})

function inicializarEdicion() {
  const motivos: Record<string, string> = {}
  const comentarios: Record<string, string> = {}
  for (const l of props.lineas) {
    if (l.motivoDiferenciaId) motivos[claveDe(l)] = l.motivoDiferenciaId
    if (l.comentarioDiferencia) comentarios[claveDe(l)] = l.comentarioDiferencia
  }
  motivoPorClave.value = motivos
  comentarioPorClave.value = comentarios
}

const motivoItems = computed(() =>
  cajaStore.motivos.map(m => ({ label: m.nombre, value: m.id })),
)

onMounted(async () => {
  inicializarEdicion()
  if (props.puedeJustificar) {
    await cajaStore.cargarMotivos(true)
  }
})

watch(() => props.lineas, inicializarEdicion)

function motivoDe(l: ArqueoLinea) {
  return cajaStore.motivos.find(m => m.id === motivoPorClave.value[claveDe(l)])
}

function lineaValida(l: ArqueoLinea): boolean {
  const comentario = (comentarioPorClave.value[claveDe(l)] ?? '').trim()
  // Red de seguridad: sin motivos activos configurados, el comentario es obligatorio.
  if (cajaStore.motivos.length === 0) return !!comentario
  const motivo = motivoDe(l)
  if (!motivo) return false
  if (motivo.requiereComentario && !comentario) return false
  return true
}

const descuadresEditables = computed(() => props.lineas.filter(descuadra))
const guardarHabilitado = computed(() => descuadresEditables.value.every(lineaValida))

async function guardar() {
  if (!props.cajaId || !guardarHabilitado.value) {
    toast.add({ title: 'Completa el motivo (o comentario) de cada diferencia', color: 'warning' })
    return
  }
  saving.value = true
  try {
    const lineasPayload = descuadresEditables.value.map(l => ({
      metodoPagoId: l.metodoPagoId,
      motivoDiferenciaId: motivoPorClave.value[claveDe(l)] || undefined,
      comentarioDiferencia: comentarioPorClave.value[claveDe(l)]?.trim() || undefined,
    }))
    await cajaStore.justificarDiferencias(props.cajaId, lineasPayload)
    // El store no muta su estado en esta acción: se refresca leyendo de nuevo
    // (el padre pasa `lineas` desde `cajaStore.arqueo`, así que se propaga solo).
    await cajaStore.cargarArqueo(props.cajaId)
    toast.add({ title: 'Diferencias justificadas', color: 'success' })
  }
  catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Error al guardar las justificaciones'
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-3">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-muted">
            <th class="py-2 font-medium">
              Método
            </th>
            <th class="py-2 font-medium text-right">
              Esperado
            </th>
            <th class="py-2 font-medium text-right">
              Contado
            </th>
            <th class="py-2 font-medium text-right">
              Diferencia
            </th>
            <th class="py-2 font-medium pl-4">
              Motivo
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in lineas" :key="claveDe(l)" class="border-t border-default">
            <td class="py-2 text-default">
              {{ l.nombre }}
            </td>
            <td class="py-2 text-right text-default">
              {{ l.esperado != null ? formatMonto(l.esperado) : '—' }}
            </td>
            <td class="py-2 text-right text-default">
              {{ l.contado != null ? formatMonto(l.contado) : '—' }}
            </td>
            <td class="py-2 text-right">
              <span
                v-if="l.diferencia != null"
                :class="new Decimal(l.diferencia).gte(0) ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
              >
                {{ formatMonto(l.diferencia) }}
              </span>
              <span v-else class="text-muted">—</span>
            </td>
            <td class="py-2 pl-4 align-top">
              <template v-if="habilitarEdicion && descuadra(l)">
                <div class="space-y-1 min-w-48">
                  <USelect
                    v-if="motivoItems.length"
                    v-model="motivoPorClave[claveDe(l)]"
                    :items="motivoItems"
                    placeholder="Motivo"
                    size="sm"
                    class="w-full"
                  />
                  <p v-else class="text-xs text-warning">
                    Sin motivos activos: comentario obligatorio
                  </p>
                  <UInput
                    v-model="comentarioPorClave[claveDe(l)]"
                    :placeholder="motivoDe(l)?.requiereComentario || !motivoItems.length ? 'Comentario (obligatorio)' : 'Comentario (opcional)'"
                    size="sm"
                    class="w-full"
                  />
                </div>
              </template>
              <template v-else-if="descuadra(l)">
                <span v-if="l.motivoNombre" class="text-default">
                  {{ l.motivoNombre }}
                  <span v-if="l.comentarioDiferencia" class="block text-xs text-muted">{{ l.comentarioDiferencia }}</span>
                </span>
                <span v-else class="text-xs font-medium text-warning">Sin justificar</span>
              </template>
              <span v-else class="text-muted">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="habilitarEdicion" class="flex justify-end">
      <UButton
        :loading="saving"
        :disabled="!guardarHabilitado"
        color="primary"
        icon="i-lucide-save"
        @click="guardar"
      >
        Guardar
      </UButton>
    </div>
  </div>
</template>
