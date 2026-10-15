<script setup lang="ts">
// La franja de avisos de la boleta electrónica para quien vende (spec
// `2026-10-14-boleta-desde-la-venta` § 8.2): pocos folios, certificado por vencer, boletas
// sin emitir y boletas con problemas en el SII (atrasadas o rechazadas; las con reparos no cuentan). Lee
// `GET /dte/estado-emision` (permiso `Ventas:Crear`: el cajero no puede leer el perfil de
// admin) al montarse, y el POS y el salón llaman `recargar()` después de cada cobro. Con la
// emisión apagada no pinta nada.
//
// Es un aviso, no una condición: si la lectura falla la franja queda como estaba y no
// molesta (el cobro no depende de ella, y la boleta sin emitir ya avisa en su propio toast).

interface EstadoEmision {
  activa: boolean
  avisos: { codigo: 'POCOS_FOLIOS' | 'CERTIFICADO_POR_VENCER', mensaje: string }[]
  sinEmitir: number
  /** Ausente en un backend viejo, durante un deploy. */
  conProblemas?: number
}

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl

const estado = ref<EstadoEmision | null>(null)

async function recargar() {
  try {
    estado.value = await useApiFetch<EstadoEmision>(`${apiUrl}/dte/estado-emision`)
  }
  catch {
    // Se queda con el último estado leído; ver el comentario de arriba.
  }
}

// La cajera no puede hacer nada con un aviso de folios o de certificado: lo que le sirve es a quién
// decírselo. El texto del servidor (`Quedan 40 folios de boleta (39)`) queda como viene.
const AVISA_AL_ENCARGADO = ': avisa al encargado'

const avisos = computed(() => {
  if (!estado.value?.activa) return []
  // El servidor da un `POCOS_FOLIOS` por tipo de boleta (39 y 41): el código solo no es clave.
  const lista = estado.value.avisos.map((a, i) => ({
    clave: `${a.codigo}-${i}`,
    mensaje: `${a.mensaje}${AVISA_AL_ENCARGADO}`,
  }))
  const n = estado.value.sinEmitir
  if (n > 0) {
    lista.push({
      clave: 'SIN_EMITIR',
      mensaje: `${n === 1 ? 'Hay 1 boleta sin emitir' : `Hay ${n} boletas sin emitir`}${AVISA_AL_ENCARGADO}`,
    })
  }
  const p = estado.value.conProblemas ?? 0
  if (p > 0) {
    lista.push({
      clave: 'CON_PROBLEMAS',
      mensaje: `${p === 1 ? 'Hay 1 boleta con problemas en el SII' : `Hay ${p} boletas con problemas en el SII`}${AVISA_AL_ENCARGADO}`,
    })
  }
  return lista
})

onMounted(recargar)

defineExpose({ recargar })
</script>

<template>
  <div v-if="avisos.length" class="flex flex-col gap-2 px-4 pt-4" data-qa="franja-emision">
    <UAlert
      v-for="aviso in avisos"
      :key="aviso.clave"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="aviso.mensaje"
      :data-qa="`aviso-emision-${aviso.clave}`"
    />
  </div>
</template>
