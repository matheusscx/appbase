<script setup lang="ts">
import type { EstadoLinea, HojaRutaDetalle, LineaHoja } from '~/types/paqueteria'
import { shellUi } from '~/utils/ui-shell'

// Admin-only: el backend va con `TenantAdminGuard` en todo el módulo.
definePageMeta({ middleware: ['auth', 'admin'], layout: 'dashboard' })

const route = useRoute()
const toast = useToast()
const apiUrl = useRuntimeConfig().public.apiUrl
const { formatOficial } = useCurrency()
const { formatFecha } = useFormatters()
const { textoNeto, presentarNeto, rotuloEstadoHoja, colorEstadoHoja, rotuloEstadoLinea, colorEstadoLinea } = usePaqueteria()

const hojaId = String(route.params.id)
const hoja = ref<HojaRutaDetalle | null>(null)
const cargando = ref(true)
const falloCarga = ref<string | null>(null)

// Una escritura a la vez: cada respuesta es la hoja entera, y dos en vuelo podrían llegar
// desordenadas y pisar con la vieja. También es la guarda contra el doble clic.
const escribiendo = ref(false)
const rendirAbierto = ref(false)

const rendida = computed(() => hoja.value?.estado === 'rendida')
const neto = computed(() => hoja.value ? presentarNeto(hoja.value.netoARendir) : null)
const puedeRendir = computed(() =>
  !!hoja.value && !rendida.value && hoja.value.asignados > 0 && hoja.value.enRuta === 0 && !escribiendo.value,
)
const frase = computed(() => hoja.value ? textoNeto(hoja.value.repartidorNombre, hoja.value.netoARendir) : '')

async function cargar() {
  cargando.value = true
  falloCarga.value = null
  try {
    hoja.value = await useApiFetch<HojaRutaDetalle>(`${apiUrl}/hojas-ruta/${hojaId}`)
  }
  catch (e: unknown) {
    falloCarga.value = apiErrorMsg(e, 'No se pudo cargar la hoja de ruta')
  }
  finally {
    cargando.value = false
  }
}

onMounted(cargar)

/**
 * Corre una escritura y se queda con la hoja que devuelve. Si falla, avisa y vuelve a pedir la
 * hoja: el rechazo (otro repartidor se llevó el paquete, la hoja ya estaba rendida) quiere decir
 * que la pantalla estaba desactualizada.
 */
async function escribir(
  ruta: string,
  opts: { method: 'PATCH' | 'POST' | 'DELETE', body?: Record<string, unknown> },
  falloGenerico: string,
): Promise<boolean> {
  if (escribiendo.value || !hoja.value) return false
  escribiendo.value = true
  try {
    hoja.value = await useApiFetch<HojaRutaDetalle>(`${apiUrl}/hojas-ruta/${hojaId}/${ruta}`, opts)
    return true
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, falloGenerico), color: 'error' })
    try {
      hoja.value = await useApiFetch<HojaRutaDetalle>(`${apiUrl}/hojas-ruta/${hojaId}`)
    }
    catch {
      // La hoja que se ve es la última buena; el aviso de arriba ya dijo qué pasó.
    }
    return false
  }
  finally {
    escribiendo.value = false
  }
}

async function marcar(linea: LineaHoja, estado: EstadoLinea) {
  if (linea.estado === estado) return
  await escribir(`paquetes/${linea.paqueteId}`, { method: 'PATCH', body: { estado } }, 'Error al marcar el paquete')
}

async function quitar(linea: LineaHoja) {
  if (await escribir(`paquetes/${linea.paqueteId}`, { method: 'DELETE' }, 'Error al quitar el paquete')) {
    toast.add({ title: `${linea.codigo} salió de la hoja`, color: 'success' })
  }
}

async function entregarTodos() {
  const pendientes = hoja.value?.enRuta ?? 0
  if (await escribir('entregar-todos', { method: 'POST' }, 'Error al marcar los paquetes')) {
    toast.add({ title: `${pendientes} ${pendientes === 1 ? 'paquete marcado' : 'paquetes marcados'} como entregados`, color: 'success' })
  }
}

function abrirRendir() {
  rendirAbierto.value = true
}

function cerrarRendir() {
  rendirAbierto.value = false
}

async function rendir() {
  if (!puedeRendir.value) return
  const ok = await escribir('rendir', { method: 'POST' }, 'Error al rendir la hoja')
  rendirAbierto.value = false
  if (ok) toast.add({ title: 'Hoja rendida', color: 'success' })
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Hoja de ruta" />
    </template>

    <template #body>
      <div class="mx-auto w-full max-w-4xl space-y-6" data-qa="hoja-pantalla">
        <UButton
          to="/paquetes/rutas"
          label="Rutas"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="link"
          class="-ml-2.5"
        />

        <UAlert
          v-if="falloCarga"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="falloCarga"
          data-qa="hoja-error"
        />

        <p v-else-if="cargando" class="py-10 text-center text-sm text-muted">
          Cargando la hoja…
        </p>

        <template v-else-if="hoja">
          <div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div class="space-y-1">
              <h1 class="text-2xl font-semibold text-highlighted" data-qa="hoja-titulo">
                {{ hoja.repartidorNombre }}
              </h1>
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                <p class="text-sm text-muted">
                  Hoja del {{ formatFecha(hoja.fecha) }}
                </p>
                <UBadge
                  :label="rotuloEstadoHoja(hoja.estado)"
                  :color="colorEstadoHoja(hoja.estado)"
                  variant="subtle"
                  size="sm"
                />
              </div>
              <p v-if="rendida" class="text-sm text-default" data-qa="hoja-rendida">
                Rendida el {{ formatFecha(hoja.rendidaEl) }}
              </p>
            </div>

            <div v-if="!rendida" class="flex flex-wrap items-center justify-end gap-2">
              <UButton
                label="Marcar todos entregados"
                icon="i-lucide-check-check"
                color="neutral"
                variant="outline"
                :disabled="hoja.enRuta === 0 || escribiendo"
                data-qa="hoja-entregar-todos"
                @click="entregarTodos"
              />
              <UButton
                label="Rendir"
                icon="i-lucide-handshake"
                :disabled="!puedeRendir"
                data-qa="hoja-rendir"
                @click="abrirRendir"
              />
            </div>
          </div>

          <p v-if="!rendida && hoja.enRuta > 0" class="text-sm text-muted" data-qa="hoja-rendir-bloqueo">
            Quedan {{ hoja.enRuta }} en ruta: márcalos como entregados o no entregados para poder rendir.
          </p>

          <section class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]" aria-label="Totales de la hoja">
            <div class="rounded-lg border border-default bg-elevated p-5" data-qa="hoja-neto">
              <p class="text-sm text-muted">
                {{ hoja.enRuta > 0 ? 'Neto parcial' : 'Neto a rendir' }}
              </p>
              <p
                class="mt-1 text-3xl font-semibold tabular-nums"
                :class="neto?.negativo ? 'text-error' : 'text-highlighted'"
                data-qa="hoja-neto-monto"
              >
                {{ neto?.texto }}
              </p>
              <p class="mt-2 text-sm" :class="neto?.negativo ? 'text-error' : 'text-default'" data-qa="hoja-neto-texto">
                {{ frase }}
              </p>
              <p v-if="hoja.enRuta > 0" class="mt-1 text-sm text-muted">
                Cuenta solo lo entregado hasta ahora.
              </p>
            </div>

            <dl class="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-default p-5 sm:grid-cols-3">
              <div>
                <dt class="text-sm text-muted">
                  Asignados
                </dt>
                <dd class="text-lg font-semibold tabular-nums text-highlighted" data-qa="hoja-asignados">
                  {{ hoja.asignados }}
                </dd>
              </div>
              <div>
                <dt class="text-sm text-muted">
                  En ruta
                </dt>
                <dd class="text-lg font-semibold tabular-nums text-highlighted" data-qa="hoja-en-ruta">
                  {{ hoja.enRuta }}
                </dd>
              </div>
              <div>
                <dt class="text-sm text-muted">
                  Entregados
                </dt>
                <dd class="text-lg font-semibold tabular-nums text-highlighted" data-qa="hoja-entregados">
                  {{ hoja.entregados }}
                </dd>
              </div>
              <div>
                <dt class="text-sm text-muted">
                  Cobrado en destino
                </dt>
                <dd class="text-lg font-semibold tabular-nums text-highlighted" data-qa="hoja-cobrado">
                  {{ formatOficial(hoja.montoCobradoDestino) }}
                </dd>
                <dd class="text-xs tabular-nums text-muted">
                  {{ hoja.cobroDestino }} {{ hoja.cobroDestino === 1 ? 'paquete' : 'paquetes' }}
                </dd>
              </div>
              <div>
                <dt class="text-sm text-muted">
                  Pago al repartidor
                </dt>
                <dd class="text-lg font-semibold tabular-nums text-highlighted" data-qa="hoja-pago">
                  {{ formatOficial(hoja.montoPagoRepartidor) }}
                </dd>
              </div>
              <div>
                <dt class="text-sm text-muted">
                  Total general
                </dt>
                <dd class="text-lg font-semibold tabular-nums text-highlighted" data-qa="hoja-total-general">
                  {{ formatOficial(hoja.montoTotalGeneral) }}
                </dd>
              </div>
            </dl>
          </section>

          <ul
            v-if="hoja.lineas.length"
            class="divide-y divide-default rounded-lg border border-default"
            data-qa="hoja-lineas"
          >
            <li
              v-for="linea in hoja.lineas"
              :key="linea.paqueteId"
              class="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3"
              :data-qa="`hoja-linea-${linea.codigo}`"
            >
              <div class="min-w-0 flex-1 basis-56">
                <p class="font-mono text-base font-semibold text-highlighted">
                  {{ linea.codigo }}
                </p>
                <p v-if="linea.destinatarioNombre" class="truncate text-sm text-default">
                  {{ linea.destinatarioNombre }}
                </p>
                <p v-if="linea.direccion" class="truncate text-sm text-muted">
                  {{ linea.direccion }}<template v-if="linea.comuna">, {{ linea.comuna }}</template>
                </p>
                <p class="text-xs tabular-nums text-muted">
                  Envío {{ formatOficial(linea.precioEnvio) }} · {{ linea.pagoEstimado ? 'Pago estimado' : 'Pago' }}
                  <span :data-qa="`hoja-linea-pago-${linea.codigo}`">{{ formatOficial(linea.pagoRepartidor) }}</span>
                  <template v-if="linea.tarifaPagoNombre">
                    · Tarifa <span :data-qa="`hoja-linea-tarifa-${linea.codigo}`">{{ linea.tarifaPagoNombre }}</span>
                  </template>
                </p>
                <UBadge
                  v-if="linea.cobroEnDestino"
                  label="Cobra en destino"
                  color="warning"
                  variant="subtle"
                  size="sm"
                  class="mt-1"
                />
              </div>

              <UBadge
                v-if="rendida"
                :label="rotuloEstadoLinea(linea.estado)"
                :color="colorEstadoLinea(linea.estado)"
                variant="subtle"
              />

              <template v-else>
                <UFieldGroup :aria-label="`Estado de ${linea.codigo}`">
                  <UButton
                    label="Entregado"
                    color="success"
                    :variant="linea.estado === 'entregado' ? 'solid' : 'outline'"
                    :aria-pressed="linea.estado === 'entregado'"
                    :disabled="escribiendo"
                    :data-qa="`hoja-linea-${linea.codigo}-entregado`"
                    @click="marcar(linea, 'entregado')"
                  />
                  <UButton
                    label="No entregado"
                    color="warning"
                    :variant="linea.estado === 'no_entregado' ? 'solid' : 'outline'"
                    :aria-pressed="linea.estado === 'no_entregado'"
                    :disabled="escribiendo"
                    :data-qa="`hoja-linea-${linea.codigo}-no-entregado`"
                    @click="marcar(linea, 'no_entregado')"
                  />
                  <UButton
                    label="En ruta"
                    color="info"
                    :variant="linea.estado === 'en_ruta' ? 'solid' : 'outline'"
                    :aria-pressed="linea.estado === 'en_ruta'"
                    :disabled="escribiendo"
                    :data-qa="`hoja-linea-${linea.codigo}-en-ruta`"
                    @click="marcar(linea, 'en_ruta')"
                  />
                </UFieldGroup>
                <UButton
                  v-if="linea.estado === 'en_ruta'"
                  label="Quitar"
                  icon="i-lucide-x"
                  color="error"
                  variant="ghost"
                  size="sm"
                  :disabled="escribiendo"
                  :aria-label="`Quitar ${linea.codigo} de la hoja`"
                  :data-qa="`hoja-linea-quitar-${linea.codigo}`"
                  @click="quitar(linea)"
                />
              </template>
            </li>
          </ul>

          <p
            v-else
            class="rounded-lg border border-dashed border-default p-8 text-center text-sm text-muted"
            data-qa="hoja-vacia"
          >
            Esta hoja no tiene paquetes.
          </p>
        </template>
      </div>
    </template>
  </UDashboardPanel>

  <UModal v-model:open="rendirAbierto" title="Rendir la hoja" :ui="shellUi.modal">
    <template #body>
      <div class="space-y-3" data-qa="hoja-rendir-modal">
        <p
          class="text-lg font-semibold"
          :class="neto?.negativo ? 'text-error' : 'text-highlighted'"
          data-qa="hoja-rendir-texto"
        >
          {{ frase }}
        </p>
        <p class="text-sm text-muted">
          Al rendir se cierra la hoja: no se podrán cambiar los paquetes ni los montos.
        </p>
      </div>
    </template>
    <template #footer>
      <AppModalFooter>
        <UButton color="neutral" variant="ghost" :disabled="escribiendo" @click="cerrarRendir">
          Cancelar
        </UButton>
        <UButton
          :loading="escribiendo"
          :disabled="!puedeRendir && !escribiendo"
          data-qa="hoja-rendir-confirmar"
          @click="rendir"
        >
          Rendir
        </UButton>
      </AppModalFooter>
    </template>
  </UModal>
</template>
