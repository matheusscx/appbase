<script setup lang="ts">
// Bloque "Cierres del día" de la zona "Ahora" (spec
// `2026-09-18-dashboard-inicio-design.md` § 3.1 y § 6). El permiso
// (`Cajas:Leer`) lo decide `index.vue`, que solo monta este componente si
// corresponde.
import Decimal from 'decimal.js'

const cajaStore = useCajaStore()
const { formatMonto } = useFormatters()

const { datos, sinConexion, oculto, refrescar } = useRefrescoPeriodico(
  () => cajaStore.cargarResumenDescuadresDia(),
)

/**
 * La diferencia de efectivo de los cierres del día, con su signo en palabras. `efectivoSuma` no es
 * efectivo que se juntó: es la suma de las diferencias (sobrante +, faltante −) de cada cierre
 * (auditoría UX 04.1). Un sobrante también es un cierre que no cuadró, así que ninguno de los dos
 * va en verde de éxito: el faltante en rojo, el sobrante en tono de alerta. Es presentación de la
 * cifra que ya calculó el backend; no se hace ninguna cuenta, solo se le mira el signo.
 */
const diferencia = computed(() => {
  const val = datos.value?.efectivoSuma
  if (val == null) return { texto: '—', clase: 'text-muted' }
  const d = new Decimal(val)
  if (d.isZero()) return { texto: 'sin diferencia', clase: 'text-muted' }
  const monto = formatMonto(d.abs().toString())
  return d.gt(0)
    ? { texto: `sobran ${monto}`, clase: 'text-warning' }
    : { texto: `faltan ${monto}`, clase: 'text-error' }
})

// Con descuadre, el dueño quiere la bandeja de cierres por revisar, no los cajones (04.10).
const destino = computed(() =>
  (datos.value?.conDescuadre ?? 0) > 0 ? '/cajas/pendientes-revision' : '/cajas',
)
</script>

<template>
  <UCard
    v-if="!oculto"
    as="a"
    :href="destino"
    class="cursor-pointer transition hover:ring-2 hover:ring-primary-500"
    @click="seguirEnlaceInterno($event, destino)"
  >
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold text-default">Cierres del día</span>
        <UIcon name="i-lucide-scale" class="text-muted" />
      </div>
    </template>

    <div v-if="datos" class="grid grid-cols-2 gap-x-4 gap-y-3">
      <div>
        <p class="text-xs text-muted">
          Cierres
        </p>
        <p class="text-3xl font-semibold leading-tight text-highlighted">
          {{ datos.cierres }}
        </p>
      </div>
      <div>
        <p class="text-xs text-muted">
          Con descuadre
        </p>
        <p
          class="text-3xl font-semibold leading-tight"
          :class="datos.conDescuadre > 0 ? 'text-warning' : 'text-highlighted'"
        >
          {{ datos.conDescuadre }}
        </p>
      </div>
      <div class="col-span-2">
        <p class="text-xs text-muted">
          Diferencia en efectivo
        </p>
        <p class="text-lg font-semibold" :class="diferencia.clase" data-qa="cierres-diferencia">
          {{ diferencia.texto }}
        </p>
        <p v-if="datos.altoSinRevisar > 0" class="text-sm font-medium text-error" data-qa="cierres-sin-revisar">
          {{ datos.altoSinRevisar }} sin revisar
        </p>
      </div>
    </div>
    <InicioSinDatos v-else :fallo="sinConexion" @reintentar="refrescar" />

    <UAlert
      v-if="sinConexion && datos"
      color="warning"
      variant="subtle"
      icon="i-lucide-wifi-off"
      title="No pudimos actualizar — se vuelve a intentar en el próximo ciclo"
      class="mt-3"
    />
  </UCard>
</template>
