<script setup lang="ts">
import { hoyLocal } from '~/composables/useVigenciaRegla'
import { shellUi } from '~/utils/ui-shell'
import type {
  EntregaRepartidorFila,
  HojaRutaFila,
  MedioCobro,
  RendicionDetalle,
  RepartidorFila,
} from '~/types/paqueteria'

// Admin-only: el backend va con `TenantAdminGuard` en todo el módulo.
definePageMeta({ middleware: ['auth', 'admin'], layout: 'dashboard' })

const route = useRoute()
const toast = useToast()
const apiUrl = useRuntimeConfig().public.apiUrl
const { formatOficial } = useCurrency()
const { formatFecha } = useFormatters()
const { presentarSaldo, textoSaldo, presentarNeto, rotuloMedio, fechaCorta } = usePaqueteria()

const MEDIOS: MedioCobro[] = ['efectivo', 'transferencia']
const medioOptions = MEDIOS.map(m => ({ label: rotuloMedio(m), value: m }))

const repartidores = ref<RepartidorFila[]>([])
const repartidorId = ref<string | undefined>(
  typeof route.query.repartidorId === 'string' ? route.query.repartidorId : undefined,
)
const hojas = ref<HojaRutaFila[]>([])
const entregas = ref<EntregaRepartidorFila[]>([])
const elegidas = ref<string[]>([])
const cargando = ref(false)
const falloCarga = ref<string | null>(null)

const repartidorOptions = computed(() =>
  repartidores.value
    .filter(r => r.activo || r.id === repartidorId.value)
    .map(r => ({ label: r.nombre, value: r.id })),
)
const repartidorNombre = computed(() =>
  repartidores.value.find(r => r.id === repartidorId.value)?.nombre ?? 'el repartidor',
)

// ── Hojas y entregas del repartidor ───────────────────────────────────────

// Cada carga o cambio de repartidor invalida a las anteriores que sigan en vuelo.
let secuenciaCarga = 0

/** Una hoja con paquetes en ruta, o sin ninguno, no entra (el servidor la rechazaría con 400). */
const sePuedeRendir = (h: HojaRutaFila) => h.enRuta === 0 && h.asignados > 0

async function cargarEntregas(mia: number) {
  const filas = await useApiFetch<EntregaRepartidorFila[]>(
    `${apiUrl}/entregas-repartidor?repartidorId=${repartidorId.value}&pendientes=true`,
  )
  if (mia === secuenciaCarga) entregas.value = filas
}

async function cargar() {
  const mia = ++secuenciaCarga
  hojas.value = []
  entregas.value = []
  elegidas.value = []
  falloCarga.value = null
  if (!repartidorId.value) {
    cargando.value = false
    return
  }
  cargando.value = true
  try {
    const [filas] = await Promise.all([
      useApiFetch<HojaRutaFila[]>(`${apiUrl}/hojas-ruta?pendientes=true&repartidorId=${repartidorId.value}`),
      cargarEntregas(mia),
    ])
    if (mia !== secuenciaCarga) return
    hojas.value = filas
    // Por defecto entran todas las que se pueden rendir.
    elegidas.value = filas.filter(sePuedeRendir).map(h => h.id)
  }
  catch (e: unknown) {
    if (mia === secuenciaCarga) falloCarga.value = apiErrorMsg(e, 'No se pudieron cargar las hojas del repartidor')
  }
  finally {
    if (mia === secuenciaCarga) cargando.value = false
  }
}

watch(repartidorId, cargar)

function alternar(hoja: HojaRutaFila, marcada: boolean | 'indeterminate') {
  elegidas.value = marcada === true
    ? [...elegidas.value, hoja.id]
    : elegidas.value.filter(id => id !== hoja.id)
}

// ── La previa: se vuelve a pedir al cambiar la selección ──────────────────

const previa = ref<RendicionDetalle | null>(null)
const cargandoPrevia = ref(false)
const falloPrevia = ref<string | null>(null)
// Cada pedido invalida a los anteriores: una respuesta vieja no pisa a la nueva.
let secuenciaPrevia = 0

async function pedirPrevia() {
  const mia = ++secuenciaPrevia
  falloPrevia.value = null
  if (!repartidorId.value || elegidas.value.length === 0) {
    previa.value = null
    cargandoPrevia.value = false
    return
  }
  cargandoPrevia.value = true
  // Forma con comas: la repetida (`hojaIds=a&hojaIds=b`) revienta el largo de la URL pasadas ~20 hojas.
  const ids = [...elegidas.value].sort().join(',')
  try {
    const respuesta = await useApiFetch<RendicionDetalle>(
      `${apiUrl}/rendiciones/previa?repartidorId=${repartidorId.value}&hojaIds=${ids}`,
    )
    if (mia === secuenciaPrevia) previa.value = respuesta
  }
  catch (e: unknown) {
    if (mia !== secuenciaPrevia) return
    previa.value = null
    falloPrevia.value = apiErrorMsg(e, 'No se pudo calcular la rendición')
  }
  finally {
    if (mia === secuenciaPrevia) cargandoPrevia.value = false
  }
}

// `elegidas` se reemplaza entera en cada cambio, así que el watch dispara una vez por cambio.
watch(elegidas, pedirPrevia)

// ── Entregas de plata ─────────────────────────────────────────────────────

const entregaAbierta = ref(false)
const entregaEditandoId = ref<string | null>(null)
const guardandoEntrega = ref(false)
const errorEntrega = ref<string | null>(null)
const entregaForm = ref({ fecha: hoyLocal(), monto: '', medio: 'efectivo' as MedioCobro, nota: '' })
const entregaAnulandoId = ref<string | null>(null)

const entregaIncompleta = computed(() => !entregaForm.value.fecha || !entregaForm.value.monto)

function abrirEntrega(entrega?: EntregaRepartidorFila) {
  errorEntrega.value = null
  entregaEditandoId.value = entrega?.id ?? null
  entregaForm.value = entrega
    ? { fecha: entrega.fecha, monto: entrega.monto, medio: entrega.medio, nota: entrega.nota ?? '' }
    : { fecha: hoyLocal(), monto: '', medio: 'efectivo', nota: '' }
  entregaAbierta.value = true
}

/** Una entrega que cambia mueve el saldo: se recarga la lista y la previa. */
async function refrescarTrasEntrega() {
  await cargarEntregas(secuenciaCarga)
  await pedirPrevia()
}

async function guardarEntrega() {
  if (guardandoEntrega.value || entregaIncompleta.value || !repartidorId.value) return
  guardandoEntrega.value = true
  errorEntrega.value = null
  const f = entregaForm.value
  const nota = f.nota.trim()
  try {
    if (entregaEditandoId.value) {
      await useApiFetch(`${apiUrl}/entregas-repartidor/${entregaEditandoId.value}`, {
        method: 'PATCH',
        body: { fecha: f.fecha, monto: f.monto, medio: f.medio, nota: nota || null },
      })
    }
    else {
      await useApiFetch(`${apiUrl}/entregas-repartidor`, {
        method: 'POST',
        body: {
          repartidorId: repartidorId.value,
          fecha: f.fecha,
          monto: f.monto,
          medio: f.medio,
          ...(nota ? { nota } : {}),
        },
      })
    }
    entregaAbierta.value = false
    toast.add({ title: entregaEditandoId.value ? 'Entrega corregida' : 'Entrega anotada', color: 'success' })
    await refrescarTrasEntrega()
  }
  catch (e: unknown) {
    errorEntrega.value = apiErrorMsg(e, 'No se pudo guardar la entrega')
  }
  finally {
    guardandoEntrega.value = false
  }
}

async function anularEntrega(entrega: EntregaRepartidorFila) {
  if (entregaAnulandoId.value) return
  entregaAnulandoId.value = entrega.id
  try {
    await useApiFetch(`${apiUrl}/entregas-repartidor/${entrega.id}`, { method: 'DELETE' })
    toast.add({ title: 'Entrega anulada', color: 'success' })
    await refrescarTrasEntrega()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'No se pudo anular la entrega'), color: 'error' })
    // Si ya estaba rendida o anulada, la lista que se ve es vieja.
    await refrescarTrasEntrega().catch(() => {})
  }
  finally {
    entregaAnulandoId.value = null
  }
}

// ── Rendir ────────────────────────────────────────────────────────────────

const confirmarAbierto = ref(false)
const rindiendo = ref(false)
const errorRendir = ref<string | null>(null)

const saldo = computed(() => previa.value ? presentarSaldo(previa.value.totales.saldo) : null)
const puedeRendir = computed(() =>
  !!previa.value && elegidas.value.length > 0 && !cargandoPrevia.value && !rindiendo.value,
)

function cerrarConfirmar() {
  confirmarAbierto.value = false
}

function cerrarEntrega() {
  entregaAbierta.value = false
}

function abrirConfirmar() {
  errorRendir.value = null
  confirmarAbierto.value = true
}

/**
 * Rinde las hojas elegidas. El servidor toma TODAS las entregas de plata pendientes del
 * repartidor en este momento, así que el monto final puede diferir de la previa si alguien anotó
 * una en el medio: la pantalla que sigue muestra lo que devuelve el POST, no la previa.
 */
async function rendir() {
  if (!puedeRendir.value || !repartidorId.value) return
  rindiendo.value = true
  errorRendir.value = null
  try {
    const rendicion = await useApiFetch<RendicionDetalle>(`${apiUrl}/rendiciones`, {
      method: 'POST',
      body: { repartidorId: repartidorId.value, hojaIds: [...elegidas.value] },
    })
    confirmarAbierto.value = false
    toast.add({ title: 'Rendición cerrada', color: 'success' })
    await navigateTo(`/paquetes/rendiciones/${rendicion.id}`)
  }
  catch (e: unknown) {
    // El 400 queda en la pantalla: casi siempre es que la lista que se ve ya cambió.
    errorRendir.value = apiErrorMsg(e, 'No se pudo rendir')
    confirmarAbierto.value = false
  }
  finally {
    rindiendo.value = false
  }
}

onMounted(async () => {
  try {
    repartidores.value = await useApiFetch<RepartidorFila[]>(`${apiUrl}/repartidores`)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar los repartidores'), color: 'error' })
  }
  await cargar()
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Nueva rendición" />
    </template>

    <template #body>
      <div class="mx-auto w-full max-w-4xl space-y-6" data-qa="nueva-pantalla">
        <UButton
          to="/paquetes/rendiciones"
          label="Rendiciones"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="link"
          class="-ml-2.5"
        />

        <CrudPageHeader
          title="Rendir a un repartidor"
          description="Elegí las hojas que entran en la cuenta: un día, varios o la semana entera."
        />

        <UFormField label="Repartidor" class="w-full sm:w-72">
          <USelectMenu
            v-model="repartidorId"
            :items="repartidorOptions"
            value-key="value"
            :search-input="false"
            placeholder="Elegí un repartidor"
            class="w-full"
            aria-label="Repartidor"
            data-qa="nueva-repartidor"
          />
        </UFormField>

        <UAlert
          v-if="falloCarga"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="falloCarga"
          data-qa="nueva-error-carga"
        />

        <p v-else-if="cargando" class="py-10 text-center text-sm text-muted">
          Cargando las hojas…
        </p>

        <p
          v-else-if="!repartidorId"
          class="rounded-lg border border-dashed border-default p-8 text-center text-sm text-muted"
          data-qa="nueva-sin-repartidor"
        >
          Elegí un repartidor para ver lo que tiene sin rendir.
        </p>

        <template v-else>
          <section class="space-y-3" aria-labelledby="nueva-hojas-titulo">
            <h2 id="nueva-hojas-titulo" class="text-base font-semibold text-highlighted">
              Hojas sin rendir
            </h2>

            <ul
              v-if="hojas.length"
              class="divide-y divide-default rounded-lg border border-default"
              data-qa="nueva-hojas"
            >
              <li v-for="h in hojas" :key="h.id" class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <UCheckbox
                  :model-value="elegidas.includes(h.id)"
                  :disabled="!sePuedeRendir(h)"
                  :label="`Hoja del ${formatFecha(h.fecha)}`"
                  :aria-label="`Incluir la hoja del ${formatFecha(h.fecha)}`"
                  class="min-w-44"
                  :data-qa="`nueva-hoja-${h.id}`"
                  @update:model-value="alternar(h, $event)"
                />
                <p class="flex-1 basis-48 text-sm tabular-nums text-muted">
                  {{ h.entregados }} {{ h.entregados === 1 ? 'entregado' : 'entregados' }} ·
                  {{ presentarNeto(h.netoARendir).texto }}
                </p>
                <p
                  v-if="!sePuedeRendir(h)"
                  class="text-sm text-warning"
                  :data-qa="`nueva-hoja-bloqueo-${h.id}`"
                >
                  <template v-if="h.asignados === 0">
                    No tiene paquetes: no hay nada que rendir.
                  </template>
                  <template v-else>
                    Tiene {{ h.enRuta }} en ruta: marcalos para poder incluirla.
                  </template>
                </p>
              </li>
            </ul>
            <p
              v-else
              class="rounded-lg border border-dashed border-default p-8 text-center text-sm text-muted"
              data-qa="nueva-sin-hojas"
            >
              {{ repartidorNombre }} no tiene hojas sin rendir.
            </p>
          </section>

          <section class="space-y-3" aria-labelledby="nueva-entregas-titulo">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h2 id="nueva-entregas-titulo" class="text-base font-semibold text-highlighted">
                Plata que ya entregó
              </h2>
              <UButton
                label="Anotar entrega"
                icon="i-lucide-plus"
                color="neutral"
                variant="outline"
                data-qa="nueva-entrega-anotar"
                @click="abrirEntrega()"
              />
            </div>
            <p class="text-sm text-muted">
              Entran todas las pendientes de {{ repartidorNombre }}, sin importar el día.
            </p>

            <ul
              v-if="entregas.length"
              class="divide-y divide-default rounded-lg border border-default"
              data-qa="nueva-entregas"
            >
              <li
                v-for="e in entregas"
                :key="e.id"
                class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
                :data-qa="`nueva-entrega-${e.id}`"
              >
                <div class="min-w-0 flex-1 basis-48">
                  <p class="font-medium tabular-nums text-highlighted">
                    {{ formatOficial(e.monto) }}
                    <span class="text-sm font-normal text-muted">· {{ rotuloMedio(e.medio) }} · {{ fechaCorta(e.fecha) }}</span>
                  </p>
                  <p v-if="e.nota" class="truncate text-sm text-muted">
                    {{ e.nota }}
                  </p>
                </div>
                <UButton
                  label="Corregir"
                  icon="i-lucide-pencil"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  :data-qa="`nueva-entrega-corregir-${e.id}`"
                  @click="abrirEntrega(e)"
                />
                <UButton
                  label="Anular"
                  icon="i-lucide-x"
                  color="error"
                  variant="ghost"
                  size="sm"
                  :loading="entregaAnulandoId === e.id"
                  :disabled="!!entregaAnulandoId"
                  :data-qa="`nueva-entrega-anular-${e.id}`"
                  @click="anularEntrega(e)"
                />
              </li>
            </ul>
            <p v-else class="text-sm text-muted" data-qa="nueva-sin-entregas">
              No hay entregas de plata pendientes.
            </p>
          </section>

          <section
            class="space-y-3 rounded-lg border border-default bg-elevated p-5"
            aria-label="Totales de la rendición"
            data-qa="nueva-totales"
          >
            <UAlert
              v-if="falloPrevia"
              color="error"
              variant="subtle"
              icon="i-lucide-circle-alert"
              :title="falloPrevia"
              data-qa="nueva-error-previa"
            />
            <p v-else-if="!previa" class="text-sm text-muted" data-qa="nueva-totales-vacio">
              {{ cargandoPrevia ? 'Calculando…' : 'Elegí al menos una hoja para ver el total.' }}
            </p>
            <template v-else>
              <p
                class="text-3xl font-semibold tabular-nums"
                :class="saldo?.negativo ? 'text-error' : 'text-highlighted'"
                data-qa="nueva-saldo"
              >
                {{ textoSaldo(previa.totales.saldo) }}
              </p>
              <dl class="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                <div>
                  <dt class="text-sm text-muted">
                    Entregados
                  </dt>
                  <dd class="font-semibold tabular-nums text-highlighted" data-qa="nueva-total-entregados">
                    {{ previa.totales.entregados }}
                  </dd>
                </div>
                <div>
                  <dt class="text-sm text-muted">
                    Pago al repartidor
                  </dt>
                  <dd class="font-semibold tabular-nums text-highlighted" data-qa="nueva-total-pago">
                    {{ formatOficial(previa.totales.montoPagoRepartidor) }}
                  </dd>
                </div>
                <div>
                  <dt class="text-sm text-muted">
                    Cobrado en destino
                  </dt>
                  <dd class="font-semibold tabular-nums text-highlighted" data-qa="nueva-total-cobrado">
                    {{ formatOficial(previa.totales.montoCobradoDestino) }}
                  </dd>
                  <dd class="text-xs tabular-nums text-muted">
                    {{ formatOficial(previa.totales.montoCobradoEfectivo) }} efectivo ·
                    {{ formatOficial(previa.totales.montoCobradoTransferencia) }} transferencia
                  </dd>
                </div>
                <div>
                  <dt class="text-sm text-muted">
                    Entregado a cuenta
                  </dt>
                  <dd class="font-semibold tabular-nums text-highlighted" data-qa="nueva-total-entregado">
                    {{ formatOficial(previa.totales.montoEntregadoACuenta) }}
                  </dd>
                </div>
              </dl>
            </template>
          </section>

          <UAlert
            v-if="errorRendir"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="errorRendir"
            description="Revisá las hojas y las entregas de la lista: pueden haber cambiado."
            data-qa="nueva-error-rendir"
          />

          <div class="flex justify-end">
            <UButton
              label="Rendir"
              icon="i-lucide-handshake"
              :disabled="!puedeRendir"
              data-qa="nueva-rendir"
              @click="abrirConfirmar"
            />
          </div>
        </template>
      </div>
    </template>
  </UDashboardPanel>

  <UModal v-model:open="confirmarAbierto" title="Rendir las hojas" :ui="shellUi.modal">
    <template #body>
      <div class="space-y-3" data-qa="nueva-confirmar-modal">
        <p
          class="text-lg font-semibold"
          :class="saldo?.negativo ? 'text-error' : 'text-highlighted'"
          data-qa="nueva-confirmar-texto"
        >
          {{ previa ? textoSaldo(previa.totales.saldo) : '' }}
        </p>
        <p class="text-sm text-muted">
          Se cierran {{ elegidas.length }} {{ elegidas.length === 1 ? 'hoja' : 'hojas' }} y entran las entregas de plata pendientes. Después no se pueden cambiar.
        </p>
      </div>
    </template>
    <template #footer>
      <AppModalFooter>
        <UButton color="neutral" variant="ghost" :disabled="rindiendo" @click="cerrarConfirmar">
          Cancelar
        </UButton>
        <UButton :loading="rindiendo" :disabled="!puedeRendir && !rindiendo" data-qa="nueva-confirmar" @click="rendir">
          Rendir
        </UButton>
      </AppModalFooter>
    </template>
  </UModal>

  <UModal
    v-model:open="entregaAbierta"
    :title="entregaEditandoId ? 'Corregir la entrega' : 'Anotar una entrega de plata'"
    :description="`Lo que ${repartidorNombre} dejó en la oficina.`"
    :ui="shellUi.modal"
  >
    <template #body>
      <form id="entrega-form" class="space-y-4" data-qa="nueva-entrega-form" @submit.prevent="guardarEntrega">
        <UFormField label="Día" required>
          <AppDateInput v-model="entregaForm.fecha" qa="nueva-entrega-fecha" />
        </UFormField>
        <UFormField label="Monto" required>
          <MoneyInput v-model="entregaForm.monto" oficial class="w-48" data-qa="nueva-entrega-monto" />
        </UFormField>
        <UFormField label="Cómo lo entregó">
          <USelect v-model="entregaForm.medio" :items="medioOptions" class="w-48" data-qa="nueva-entrega-medio" />
        </UFormField>
        <UFormField label="Nota">
          <UInput v-model="entregaForm.nota" maxlength="500" class="w-full" data-qa="nueva-entrega-nota" />
        </UFormField>
        <UAlert
          v-if="errorEntrega"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="errorEntrega"
          data-qa="nueva-entrega-error"
        />
      </form>
    </template>
    <template #footer>
      <AppModalFooter>
        <UButton color="neutral" variant="ghost" :disabled="guardandoEntrega" @click="cerrarEntrega">
          Cancelar
        </UButton>
        <UButton
          type="submit"
          form="entrega-form"
          :loading="guardandoEntrega"
          :disabled="entregaIncompleta"
          data-qa="nueva-entrega-guardar"
        >
          {{ entregaEditandoId ? 'Guardar' : 'Anotar' }}
        </UButton>
      </AppModalFooter>
    </template>
  </UModal>
</template>
