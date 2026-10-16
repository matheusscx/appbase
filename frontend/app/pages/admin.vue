<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { AmbienteSii, BoletaConProblemaSoporte } from '~/composables/usePerfilFiscal'

// `auth.ts` (línea 27-31) trae su propio branch para `/admin`: exige
// `isSuperadmin` y redirige a `/` si no lo es. `middleware: 'admin'` NO sirve
// acá — chequea `esAdmin` (admin del tenant activo), un eje distinto al
// superadmin, y contra el store equivocado.
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const filas = ref<BoletaConProblemaSoporte[]>([])
const cargando = ref(true)
/** Una lectura fallida no es "ningún local tiene problemas": sin esto el panel diría que todo está bien. */
const errorLectura = ref(false)
/** Qué filas están desplegadas, por índice de fila (la clave que usa `UTable`). */
const expandido = ref<Record<string, boolean>>({})

async function cargar() {
  try {
    filas.value = await useApiFetch<BoletaConProblemaSoporte[]>(`${apiUrl}/admin/dte/boletas-con-problemas`)
    errorLectura.value = false
    expandido.value = {}
  }
  catch (e: unknown) {
    errorLectura.value = true
    toast.add({ title: apiErrorMsg(e, 'Error al cargar las boletas con problemas'), color: 'error' })
  }
  finally {
    cargando.value = false
  }
}

onMounted(() => { void cargar() })

const columnas: TableColumn<BoletaConProblemaSoporte>[] = [
  { id: 'desplegar', header: '' },
  { accessorKey: 'tenant', header: 'Local' },
  { id: 'razonSocial', header: 'Razón social' },
  { id: 'ambiente', header: 'Ambiente' },
  { id: 'tipo', header: 'Tipo' },
  { accessorKey: 'folio', header: 'Folio' },
  { id: 'emitida', header: 'Emitida' },
  { id: 'estado', header: 'Estado' },
  { accessorKey: 'intentos', header: 'Intentos', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

/** El SII manda el detalle sin forma fija: se muestra tal cual, indentado, para quien lo lee. */
const textoDetalle = (detalle: unknown) => JSON.stringify(detalle, null, 2)
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Administración" />
    </template>

    <template #body>
      <UCard data-qa="soporte-boletas">
        <template #header>
          <h3 class="font-semibold text-default">
            Boletas con problemas en el SII
          </h3>
          <p class="text-sm text-muted">
            Atrasadas y rechazadas de todos los locales.
          </p>
        </template>

        <UTable v-if="filas.length" v-model:expanded="expandido" :data="filas" :columns="columnas">
          <template #desplegar-cell="{ row }">
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              square
              aria-label="Ver detalle"
              data-qa="soporte-desplegar"
              icon="i-lucide-chevron-down"
              :ui="{ leadingIcon: ['transition-transform', row.getIsExpanded() ? 'duration-200 rotate-180' : ''] }"
              @click="row.toggleExpanded()"
            />
          </template>
          <template #tenant-cell="{ row }">
            <div class="flex items-center gap-2">
              <span>{{ row.original.tenant }}</span>
              <UBadge
                v-if="row.original.tenantDadoDeBaja"
                label="Dado de baja"
                color="neutral"
                variant="subtle"
                size="sm"
                data-qa="soporte-local-de-baja"
              />
            </div>
          </template>
          <template #razonSocial-cell="{ row }">
            {{ row.original.razonSocial ?? '—' }}
          </template>
          <template #ambiente-cell="{ row }">
            {{ etiquetaAmbiente(row.original.ambiente as AmbienteSii) ?? row.original.ambiente }}
          </template>
          <template #tipo-cell="{ row }">
            {{ etiquetaTipoCorta(row.original.tipo) }}
          </template>
          <template #emitida-cell="{ row }">
            {{ formatoFecha(row.original.emitidaEl) }}
          </template>
          <template #estado-cell="{ row }">
            <UBadge
              :label="etiquetaGrupoSoporte(row.original.grupo).label"
              :color="etiquetaGrupoSoporte(row.original.grupo).color"
              variant="subtle"
            />
          </template>
          <template #expanded="{ row }">
            <div class="space-y-2 p-2 text-sm" data-qa="soporte-detalle">
              <p v-if="row.original.ultimoError" class="text-default">
                <span class="font-medium">Último error:</span> {{ row.original.ultimoError }}
              </p>
              <p v-if="row.original.envioEstadoSii" class="text-default" data-qa="soporte-envio-estado">
                <span class="font-medium">Estado del envío en el SII:</span> {{ row.original.envioEstadoSii }}
              </p>
              <p v-if="row.original.envioUltimoError" class="text-default" data-qa="soporte-envio-error">
                <span class="font-medium">Último error del envío:</span> {{ row.original.envioUltimoError }}
              </p>
              <pre
                v-if="row.original.detalleSii !== null && row.original.detalleSii !== undefined"
                class="overflow-x-auto rounded-md bg-elevated p-3 text-xs text-default"
              >{{ textoDetalle(row.original.detalleSii) }}</pre>
              <p v-else class="text-muted">
                Sin detalle del SII.
              </p>
            </div>
          </template>
        </UTable>

        <p
          v-else-if="errorLectura"
          class="py-6 text-center text-sm text-muted"
          data-qa="soporte-error"
        >
          No se pudo leer el estado de las boletas en el SII.
        </p>
        <p
          v-else-if="!cargando"
          class="py-6 text-center text-sm text-muted"
          data-qa="soporte-sin-problemas"
        >
          Ningún local tiene boletas con problemas.
        </p>
      </UCard>
    </template>
  </UDashboardPanel>
</template>
