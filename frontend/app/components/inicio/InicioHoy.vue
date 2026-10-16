<script setup lang="ts">
// Zona "Hoy" del dashboard de inicio (spec `2026-09-18-dashboard-inicio-design.md`
// § 3.2 y § 6). El permiso (`Resumen del negocio:Leer`) lo decide `index.vue`,
// que solo monta este componente si corresponde — acá no se repite el chequeo.
// A diferencia de "Ahora" (`useRefrescoPeriodico`, `docs/patterns/frontend.md`
// §17), esta zona carga UNA sola vez al montar y tiene un botón "Actualizar"
// manual: sin `setInterval` (spec § 6, "'Hoy' carga una vez"). El 403 esconde
// la zona ENTERA sin aviso de error — mismo criterio que `useRefrescoPeriodico`
// documenta (un módulo no contratado, no una falla), leído a mano acá porque
// ese composable trae también el ciclo automático que esta zona no usa.
import type { ResumenNegocioHoy } from '~/types/resumen-negocio'

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl
const toast = useToast()

const datos = ref<ResumenNegocioHoy | null>(null)
const cargando = ref(false)
const oculto = ref(false)
/** La carga falló: sin datos no se queda en "Cargando…", ofrece reintentar (04.7). */
const fallo = ref(false)

async function cargar(): Promise<void> {
  cargando.value = true
  try {
    datos.value = await useApiFetch<ResumenNegocioHoy>(`${apiUrl}/resumen-negocio/hoy`)
    fallo.value = false
  }
  catch (e: unknown) {
    const status = (e as { status?: number })?.status
      ?? (e as { response?: { status?: number } })?.response?.status
    if (status === 403) {
      oculto.value = true
      return
    }
    fallo.value = true
    // Sin datos, el aviso es el propio bloque ("No pudimos cargar…" + Reintentar); un toast que se va solo sumaba ruido.
    if (datos.value) toast.add({ title: apiErrorMsg(e, 'Error al actualizar el resumen de hoy'), color: 'error' })
  }
  finally {
    cargando.value = false
  }
}

// Carga al invocarse, no `onMounted` — mismo criterio que `useRefrescoPeriodico`
// (se prueba con un spec plano, sin depender de un hook de ciclo de vida).
void cargar()
</script>

<template>
  <section v-if="!oculto" class="space-y-3">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-sm font-medium text-muted">
        Hoy
      </h3>
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-lucide-refresh-cw"
        :loading="cargando"
        @click="cargar"
      >
        Actualizar
      </UButton>
    </div>

    <div v-if="datos" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <InicioVentas class="lg:col-span-2" :ventas="datos.ventas" :fecha="datos.fecha" />
      <InicioPorCobrar :por-cobrar="datos.porCobrar" />
      <InicioPerdidas :perdidas="datos.perdidas" />
      <InicioMasVendidos class="lg:col-span-4" :mas-vendidos="datos.masVendidos" />
    </div>
    <InicioSinDatos v-else :fallo="fallo" @reintentar="cargar" />
  </section>
</template>
