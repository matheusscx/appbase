<script setup lang="ts">
// Nota informativa para pantallas con filtro de fecha: le explica a quien
// filtra "hoy" por qué una venta de la madrugada cuenta en el día anterior
// cuando el tenant tiene un corte configurado (spec § 3.1, sección "Nota
// junto al filtro de fecha"). Con `horaCorte` 0 — el default, "sin corte" —
// el día de negocio coincide con el calendario y no hace falta explicar
// nada, así que no se dibuja nada.
const props = defineProps<{
  /**
   * Cuando la pantalla que la usa YA pidió `/tenants/me` por su cuenta —p. ej.
   * `anulaciones.vue`, que necesita `diaNegocioHoy` para el arranque de sus
   * filtros (Task 5, fix round 1)— pasa acá el valor de ESE fetch y esta nota
   * no hace el suyo propio: sin el prop, dos componentes de la misma pantalla
   * pedían el mismo `GET /tenants/me` por separado. `undefined` (prop no
   * pasado) es la señal de "sin controlar" — a diferencia de `null`, que es
   * un valor legítimo mientras el fetch del dueño todavía no resuelve.
   */
  horaCorte?: number | null
}>()

const propio = useDiaNegocio()

onMounted(() => {
  if (props.horaCorte === undefined) propio.cargar()
})

const horaCorteEfectiva = computed(() =>
  props.horaCorte !== undefined ? props.horaCorte : propio.horaCorte.value,
)

function horaLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}
</script>

<template>
  <p
    v-if="horaCorteEfectiva !== null && horaCorteEfectiva > 0"
    class="text-sm text-muted"
  >
    Tu día va de {{ horaLabel(horaCorteEfectiva) }} a {{ horaLabel(horaCorteEfectiva) }}
  </p>
</template>
