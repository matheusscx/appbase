<script setup lang="ts">
// Bloque "Cajas" de la zona "Ahora" (spec `2026-09-18-dashboard-inicio-design.md`
// § 3.1 y § 6). Sin montos: el modo ciego ya decide quién ve el esperado, y el
// dashboard no lo repite (mismo criterio que `CajaCajonesGrid.vue`). El permiso
// (`Cajas:Leer`) lo decide `index.vue`, que solo monta este componente si
// corresponde.
import type { CajonEstado } from '~/stores/caja'

type CajonAbierto = CajonEstado & { sesion: NonNullable<CajonEstado['sesion']> }

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl
const { formatHora } = useFormatters()

const { datos, actualizadoEl, sinConexion, oculto } = useRefrescoPeriodico(
  () => useApiFetch<CajonEstado[]>(`${apiUrl}/caja/cajones-estado`),
)

const abiertos = computed<CajonAbierto[]>(() =>
  (datos.value ?? []).filter((c): c is CajonAbierto => c.sesion !== null),
)
</script>

<template>
  <UCard
    v-if="!oculto"
    as="a"
    href="/cajas"
    class="cursor-pointer transition hover:ring-2 hover:ring-primary-500"
    @click.prevent="navigateTo('/cajas')"
  >
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold text-default">Cajas</span>
        <UIcon name="i-lucide-banknote" class="text-muted" />
      </div>
    </template>

    <div v-if="datos">
      <p v-if="abiertos.length === 0" class="text-sm text-muted">
        Ninguna caja abierta.
      </p>
      <ul v-else class="space-y-1">
        <li
          v-for="cajon in abiertos"
          :key="cajon.cajonId"
          class="flex items-center justify-between gap-2 text-sm"
        >
          <span class="text-default truncate">{{ cajon.nombre }}</span>
          <span class="text-muted truncate">{{ cajon.sesion.usuarioNombre }}</span>
        </li>
      </ul>
    </div>
    <p v-else class="text-sm text-muted">
      Cargando…
    </p>

    <UAlert
      v-if="sinConexion"
      color="warning"
      variant="subtle"
      icon="i-lucide-wifi-off"
      title="Sin conexión — se reintenta en el próximo ciclo"
      class="mt-3"
    />

    <template #footer>
      <p class="text-xs text-muted">
        Actualizado {{ formatHora(actualizadoEl) }}
      </p>
    </template>
  </UCard>
</template>
