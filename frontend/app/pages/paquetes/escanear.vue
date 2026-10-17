<script setup lang="ts">
import { hoyLocal } from '~/composables/useVigenciaRegla'
import { shellUi } from '~/utils/ui-shell'
import type {
  HojaRutaDetalle,
  HojaRutaFila,
  LineaHoja,
  PaqueteFila,
  RepartidorFila,
  RespuestaEscaneo,
  TarifaPagoFila,
} from '~/types/paqueteria'

// Admin-only: el backend va con `TenantAdminGuard` en todo el módulo.
definePageMeta({ middleware: ['auth', 'admin'], layout: 'dashboard' })

/**
 * Lo que se decidió en el momento de escanear. Viaja con el código por la cola: si después se
 * cambia el repartidor, la fecha o el interruptor, lo que ya se escaneó no se re-dirige.
 */
interface Escaneo {
  codigo: string
  repartidorId: string
  fecha: string
  cobroEnDestino: boolean
}

interface Resultado {
  tipo: 'success' | 'warning' | 'error'
  texto: string
  detalle?: string
  // Distingue dos resultados iguales seguidos: cambia el `key` y la franja vuelve a destellar.
  numero: number
}

/** Un escaneo que el servidor rechazó. Queda en la lista hasta que alguien lo descarte. */
interface Rechazo {
  id: number
  codigo: string
  mensaje: string
  hoja: string
}

const toast = useToast()
const apiUrl = useRuntimeConfig().public.apiUrl
const { textoNeto, lineasConCobro, rotuloEstadoLinea, colorEstadoLinea, fechaCorta, opcionesTarifa } = usePaqueteria()
const { formatOficial } = useCurrency()
const { diaNegocioHoy, cargar: cargarDiaNegocio } = useDiaNegocio()

// ── Contexto: repartidor, fecha, cobro en destino ─────────────────────────

const repartidores = ref<RepartidorFila[]>([])
const tarifas = ref<TarifaPagoFila[]>([])
const repartidorId = ref<string | undefined>(undefined)
const fecha = ref(hoyLocal())
// Si el usuario ya eligió una fecha, el día de negocio que llega tarde no se la pisa.
let fechaElegida = false
const cobroEnDestino = ref(false)

const repartidorOptions = computed(() =>
  repartidores.value
    .filter(r => r.activo)
    .map(r => ({ label: r.nombre, value: r.id })),
)

function elegirFecha(valor: string) {
  // El calendario devuelve el eco de lo que se le puso: solo un valor distinto es una elección.
  if (valor === fecha.value) return
  fechaElegida = true
  fecha.value = valor
}

// ── Foco: la pistola tipea sobre el campo, así que el campo no puede perderlo ──

const campo = ref<{ inputRef?: HTMLInputElement | null } | null>(null)
const codigo = ref('')

// Un control que el usuario está operando (lista abierta, calendario, segmento de la fecha) no se
// pisa: el foco vuelve al campo cuando lo cierra.
const OPERANDO = '[data-reka-popper-content-wrapper], [role="dialog"], [data-reka-date-field-segment], [aria-expanded="true"]'
const INTERACTIVO = 'button, a, input, select, textarea, label, [role="switch"], [role="combobox"]'

function enfocar(forzar = false) {
  nextTick(() => {
    if (!forzar && document.activeElement?.closest(OPERANDO)) return
    campo.value?.inputRef?.focus()
  })
}

function alClicEnPantalla(e: MouseEvent) {
  if ((e.target as HTMLElement | null)?.closest(INTERACTIVO)) return
  // Arrastrar para copiar un texto también termina en clic: no se le deshace la selección.
  if (window.getSelection()?.toString()) return
  enfocar()
}

// La lista del repartidor devuelve el foco al botón cuando cierra; el timeout lo deja después.
function alAbrirOCerrarLista(abierta: boolean) {
  if (!abierta) setTimeout(enfocar, 0)
}

// Red de seguridad: si el foco quedó en un botón o en el fondo, la pistola le tipearía a eso (y
// un espacio en un interruptor lo cambiaría). Una tecla imprimible lo trae de vuelta al campo.
function alTeclear(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return
  const activo = document.activeElement as HTMLElement | null
  if (activo?.closest(OPERANDO) || activo?.matches('input, textarea, select') || activo?.isContentEditable) return
  const input = campo.value?.inputRef
  if (input && !input.disabled) input.focus()
}

onMounted(() => document.addEventListener('keydown', alTeclear))
onBeforeUnmount(() => document.removeEventListener('keydown', alTeclear))

// ── La hoja del día ───────────────────────────────────────────────────────

const hoja = ref<HojaRutaDetalle | null>(null)
const cargandoHoja = ref(false)
// Cada carga o respuesta nueva invalida a las anteriores que sigan en vuelo.
let secuenciaHoja = 0

const repartidorElegido = computed(() =>
  repartidorOptions.value.find(o => o.value === repartidorId.value) ?? null,
)
const hojaRendida = computed(() => hoja.value?.estado === 'rendida')
const puedeEscanear = computed(() => !!repartidorId.value && !!fecha.value && !hojaRendida.value)

const placeholderCampo = computed(() => {
  if (!repartidorId.value) return 'Elige un repartidor'
  if (!fecha.value) return 'Elige la fecha'
  if (hojaRendida.value) return 'La hoja ya está rendida'
  return 'Escanea o tipea el código'
})

async function cargarHoja() {
  const secuencia = ++secuenciaHoja
  hoja.value = null
  cargandoHoja.value = false
  if (!repartidorId.value || !fecha.value) return
  cargandoHoja.value = true
  try {
    const filas = await useApiFetch<HojaRutaFila[]>(
      `${apiUrl}/hojas-ruta?desde=${fecha.value}&hasta=${fecha.value}&repartidorId=${repartidorId.value}`,
    )
    if (secuencia !== secuenciaHoja || !filas[0]) return
    const detalle = await useApiFetch<HojaRutaDetalle>(`${apiUrl}/hojas-ruta/${filas[0].id}`)
    if (secuencia !== secuenciaHoja) return
    hoja.value = detalle
  }
  catch (e: unknown) {
    if (secuencia === secuenciaHoja) {
      toast.add({ title: apiErrorMsg(e, 'Error al cargar la hoja de ruta'), color: 'error' })
    }
  }
  finally {
    if (secuencia === secuenciaHoja) cargandoHoja.value = false
  }
}

watch([repartidorId, fecha], cargarHoja)
watch(puedeEscanear, (puede) => {
  if (puede) enfocar()
})

/** Una respuesta del servidor es la verdad de esa hoja, pero solo se pinta si es la que se está viendo. */
function mostrarHoja(nueva: HojaRutaDetalle) {
  if (nueva.repartidorId !== repartidorId.value || nueva.fecha !== fecha.value) return
  secuenciaHoja++
  cargandoHoja.value = false
  hoja.value = nueva
}

onMounted(async () => {
  try {
    repartidores.value = await useApiFetch<RepartidorFila[]>(`${apiUrl}/repartidores`)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar repartidores'), color: 'error' })
  }
  try {
    tarifas.value = await useApiFetch<TarifaPagoFila[]>(`${apiUrl}/tarifas-pago`)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar las tarifas de pago'), color: 'error' })
  }
  await cargarDiaNegocio()
  if (!fechaElegida && diaNegocioHoy.value) fecha.value = diaNegocioHoy.value
})

// ── Escaneo ───────────────────────────────────────────────────────────────

const ultimo = ref<Resultado | null>(null)
let numeroResultado = 0

// El banner de arriba muestra solo el último resultado y la pistola escanea varias veces por
// segundo: un rechazo se perdería en un parpadeo. Acá queda hasta que se lo descarte.
const rechazados = ref<Rechazo[]>([])
let numeroRechazo = 0

const destinoDe = (nombre: string, f: string) => `Hoja de ${nombre} del ${fechaCorta(f)}`

function nombreDeRepartidor(id: string) {
  return repartidores.value.find(r => r.id === id)?.nombre ?? 'otro repartidor'
}

function descartarRechazo(id: number) {
  rechazados.value = rechazados.value.filter(r => r.id !== id)
}

function publicar(resultado: Omit<Resultado, 'numero'>) {
  ultimo.value = { ...resultado, numero: ++numeroResultado }
}

async function enviar(escaneo: Escaneo) {
  try {
    const r = await useApiFetch<RespuestaEscaneo>(`${apiUrl}/hojas-ruta/escanear`, {
      method: 'POST',
      body: {
        repartidorId: escaneo.repartidorId,
        fecha: escaneo.fecha,
        codigo: escaneo.codigo,
        cobroEnDestino: escaneo.cobroEnDestino,
      },
    })
    const texto = {
      asignado_nuevo: `${r.codigo} · nuevo, asignado`,
      asignado: `${r.codigo} · asignado`,
      ya_escaneado: `${r.codigo} · ya estaba en la hoja`,
    }[r.resultado]
    // Siempre dice a qué hoja fue: la pistola puede haber tipeado en el campo de la fecha y, si
    // cambió, los escaneos siguientes salen para otro día; así se ve en el primero.
    publicar({
      tipo: r.resultado === 'ya_escaneado' ? 'warning' : 'success',
      texto,
      detalle: destinoDe(r.hoja.repartidorNombre, r.hoja.fecha),
    })
    mostrarHoja(r.hoja)
  }
  catch (e: unknown) {
    const mensaje = apiErrorMsg(e, 'No se pudo escanear')
    const codigoEscaneado = escaneo.codigo.trim()
    const hojaDestino = destinoDe(nombreDeRepartidor(escaneo.repartidorId), escaneo.fecha)
    publicar({
      tipo: 'error',
      texto: mensaje,
      detalle: `Código escaneado: ${codigoEscaneado}. ${hojaDestino}.`,
    })
    rechazados.value = [
      { id: ++numeroRechazo, codigo: codigoEscaneado, mensaje, hoja: hojaDestino },
      ...rechazados.value,
    ]
    // La cola cuenta este escaneo como fallido y sigue con el próximo.
    throw e
  }
  finally {
    enfocar()
  }
}

const { encolar, pendientes } = useColaEscaneo<Escaneo>(enviar)

function alEnter() {
  const valor = codigo.value
  codigo.value = ''
  if (!valor.trim() || !repartidorId.value || !fecha.value) return
  encolar({
    codigo: valor,
    repartidorId: repartidorId.value,
    fecha: fecha.value,
    cobroEnDestino: cobroEnDestino.value,
  })
}

// ── Filas de la hoja ──────────────────────────────────────────────────────

const enCambio = ref<Set<string>>(new Set())

function marcarEnCambio(paqueteId: string, activo: boolean) {
  const siguiente = new Set(enCambio.value)
  if (activo) siguiente.add(paqueteId)
  else siguiente.delete(paqueteId)
  enCambio.value = siguiente
}

function ponerCobro(hojaId: string, paqueteId: string, valor: boolean) {
  if (hoja.value?.id !== hojaId) return
  hoja.value = {
    ...hoja.value,
    lineas: hoja.value.lineas.map(l => l.paqueteId === paqueteId ? { ...l, cobroEnDestino: valor } : l),
  }
}

const lineaEditable = (l: LineaHoja) => l.estado === 'en_ruta' && !hojaRendida.value

async function alternarCobro(linea: LineaHoja, nuevo: boolean) {
  const actual = hoja.value
  if (!actual || !lineaEditable(linea) || enCambio.value.has(linea.paqueteId)) return
  marcarEnCambio(linea.paqueteId, true)
  const previo = linea.cobroEnDestino
  ponerCobro(actual.id, linea.paqueteId, nuevo)
  try {
    const guardado = await useApiFetch<PaqueteFila>(`${apiUrl}/paquetes/${linea.paqueteId}`, {
      method: 'PATCH',
      body: { cobroEnDestino: nuevo },
    })
    ponerCobro(actual.id, linea.paqueteId, guardado.cobroEnDestino)
  }
  catch (e: unknown) {
    ponerCobro(actual.id, linea.paqueteId, previo)
    toast.add({ title: apiErrorMsg(e, 'Error al cambiar el cobro en destino'), color: 'error' })
  }
  finally {
    marcarEnCambio(linea.paqueteId, false)
    enfocar()
  }
}

async function quitar(linea: LineaHoja) {
  const actual = hoja.value
  if (!actual || !lineaEditable(linea) || enCambio.value.has(linea.paqueteId)) return
  marcarEnCambio(linea.paqueteId, true)
  try {
    const nueva = await useApiFetch<HojaRutaDetalle>(
      `${apiUrl}/hojas-ruta/${actual.id}/paquetes/${linea.paqueteId}`,
      { method: 'DELETE' },
    )
    mostrarHoja(nueva)
    toast.add({ title: `${linea.codigo} salió de la hoja`, color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al quitar el paquete'), color: 'error' })
  }
  finally {
    marcarEnCambio(linea.paqueteId, false)
    enfocar()
  }
}

// ── Montos de un paquete (override de los valores por defecto) ────────────

// Se editan en un modal con botón, no en la fila: un campo de monto con el foco recibiría lo que
// tipee la pistola. Enter no guarda; solo el botón.
const montosAbierto = ref(false)
const montosLinea = ref<LineaHoja | null>(null)
// `tarifaPagoId` null = «Según repartidor»: el servidor resuelve la tarifa al pagar.
const montosForm = ref({ precioEnvio: '', tarifaPagoId: null as string | null })
const guardandoMontos = ref(false)
const errorMontos = ref<string | null>(null)

const montosEditables = computed(() => !!hoja.value && !hojaRendida.value)

// Lo que se paga si el paquete no tiene tarifa propia: la del repartidor (aunque se haya
// desactivado: el servidor la sigue pagando, `tarifa-resuelta.ts`), o la por defecto.
const tarifaHeredada = computed(() => {
  const propiaId = repartidores.value.find(r => r.id === repartidorId.value)?.tarifaPagoId
  const propia = propiaId ? tarifas.value.find(t => t.id === propiaId) : undefined
  return propia ?? tarifas.value.find(t => t.esDefecto && t.activa) ?? null
})
const tarifaOptions = computed(() =>
  opcionesTarifa(tarifas.value, tarifaHeredada.value, montosForm.value.tarifaPagoId),
)

function abrirMontos(linea: LineaHoja) {
  if (!montosEditables.value) return
  montosLinea.value = linea
  // La propia del paquete, no la resuelta (`tarifaPagoId`): preseleccionar la resuelta fijaría
  // como propia una que era heredada del repartidor.
  montosForm.value = { precioEnvio: linea.precioEnvio, tarifaPagoId: linea.tarifaPaqueteId }
  errorMontos.value = null
  montosAbierto.value = true
}

function cerrarMontos() {
  montosAbierto.value = false
}

// Al cerrar, reka le devuelve el foco al botón que abrió el modal (medido en el navegador: le
// ganaba a un `after:leave`). Se le previene y el foco vuelve al campo, para la pistola.
function alCerrarModalMontos(e: Event) {
  e.preventDefault()
  enfocar(true)
}

async function guardarMontos() {
  const actual = hoja.value
  const linea = montosLinea.value
  const { precioEnvio, tarifaPagoId } = montosForm.value
  if (!actual || !linea || guardandoMontos.value || !precioEnvio) return
  guardandoMontos.value = true
  errorMontos.value = null
  marcarEnCambio(linea.paqueteId, true)
  try {
    await useApiFetch<PaqueteFila>(`${apiUrl}/paquetes/${linea.paqueteId}`, {
      method: 'PATCH',
      body: { precioEnvio, tarifaPagoId },
    })
    toast.add({ title: `Montos de ${linea.codigo} guardados`, color: 'success' })
    cerrarMontos()
  }
  catch (e: unknown) {
    errorMontos.value = apiErrorMsg(e, 'No se pudieron guardar los montos')
    return
  }
  finally {
    guardandoMontos.value = false
    marcarEnCambio(linea.paqueteId, false)
  }
  // El precio, la tarifa y el pago de la línea y los totales los resuelve el servidor (la regla
  // paquete → repartidor → por defecto vive solo en el backend): la hoja se vuelve a leer siempre.
  // Si mientras tanto llegó una hoja más nueva (un escaneo de la cola), esta foto ya es vieja.
  const secuencia = secuenciaHoja
  try {
    const releida = await useApiFetch<HojaRutaDetalle>(`${apiUrl}/hojas-ruta/${actual.id}`)
    if (secuencia === secuenciaHoja) mostrarHoja(releida)
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Los montos se guardaron, pero no se pudo actualizar la hoja'), color: 'warning' })
  }
}

// ── Totales de la hoja ────────────────────────────────────────────────────

const conCobro = computed(() => hoja.value ? lineasConCobro(hoja.value.lineas) : 0)

// El neto del servidor suma solo lo entregado: con paquetes todavía en ruta es un número parcial
// que se leería como el de la rendición. Se muestra recién cuando no queda ninguno en ruta.
const textoResumenNeto = computed(() =>
  hoja.value && hoja.value.entregados > 0 && hoja.value.enRuta === 0
    ? textoNeto(hoja.value.repartidorNombre, hoja.value.netoARendir)
    : null,
)

const iconoResultado = {
  success: 'i-lucide-circle-check',
  warning: 'i-lucide-check-check',
  error: 'i-lucide-circle-x',
} as const
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Escanear" />
    </template>

    <template #body>
      <div class="mx-auto w-full max-w-4xl space-y-6" data-qa="escanear-pantalla" @click="alClicEnPantalla">
        <div class="flex flex-wrap items-end gap-x-4 gap-y-3">
          <UFormField label="Repartidor" class="w-full sm:w-64">
            <USelectMenu
              v-model="repartidorId"
              :items="repartidorOptions"
              value-key="value"
              :search-input="false"
              placeholder="Elige un repartidor"
              class="w-full"
              aria-label="Repartidor"
              data-qa="escanear-repartidor"
              @update:open="alAbrirOCerrarLista"
            />
          </UFormField>
          <UFormField label="Fecha de la hoja" class="w-44" @keydown.enter="enfocar(true)">
            <AppDateInput
              :model-value="fecha"
              qa="escanear-fecha"
              @update:model-value="elegirFecha"
            />
          </UFormField>
          <USwitch
            v-model="cobroEnDestino"
            label="Cobro en destino"
            description="Para los paquetes nuevos; los que ya existían conservan el suyo."
            class="pb-1.5"
            data-qa="escanear-cobro"
            @update:model-value="enfocar()"
          />
        </div>

        <UAlert
          v-if="repartidores.length && !repartidorOptions.length"
          color="warning"
          variant="subtle"
          icon="i-lucide-user-x"
          title="No hay repartidores activos. Activa o crea uno en Configuración > Repartidores."
        />

        <UInput
          ref="campo"
          v-model="codigo"
          icon="i-lucide-scan-barcode"
          size="xl"
          class="w-full"
          :ui="{ base: 'h-16 text-2xl font-mono' }"
          :placeholder="placeholderCampo"
          :disabled="!puedeEscanear"
          autofocus
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          aria-label="Código del paquete"
          data-qa="escanear-codigo"
          @keydown.enter.prevent="alEnter"
        />

        <div role="status" aria-live="polite" class="space-y-2">
          <UAlert
            v-if="ultimo"
            :key="ultimo.numero"
            :color="ultimo.tipo"
            variant="solid"
            :icon="iconoResultado[ultimo.tipo]"
            :title="ultimo.texto"
            :description="ultimo.detalle"
            :ui="{
              root: 'resultado-escaneo items-center gap-4 p-5',
              icon: 'size-10',
              title: ultimo.tipo === 'error' ? 'text-2xl font-semibold' : 'text-3xl font-semibold font-mono break-all',
              description: 'text-base',
            }"
            :data-qa="`escanear-resultado-${ultimo.tipo}`"
          />
          <UAlert
            v-else
            color="neutral"
            variant="subtle"
            icon="i-lucide-scan-barcode"
            title="Listo para escanear"
            description="Cada código que lea la pistola se suma a la hoja de ruta del repartidor."
            :ui="{ root: 'items-center gap-4 p-5', icon: 'size-10', title: 'text-xl font-semibold' }"
            data-qa="escanear-resultado-vacio"
          />
          <p v-if="pendientes > 0" class="text-sm text-muted" data-qa="escanear-pendientes">
            Procesando {{ pendientes }}…
          </p>

          <section
            v-if="rechazados.length"
            class="rounded-lg border border-error"
            aria-label="Escaneos rechazados"
            data-qa="escanear-rechazados"
          >
            <div class="flex items-center justify-between gap-3 px-4 py-2">
              <h2 class="font-semibold text-error">
                Rechazados ({{ rechazados.length }})
              </h2>
              <UButton
                label="Limpiar"
                color="neutral"
                variant="ghost"
                size="sm"
                data-qa="escanear-rechazados-limpiar"
                @click="rechazados = []"
              />
            </div>
            <ul class="divide-y divide-default border-t border-default">
              <li
                v-for="rechazo in rechazados"
                :key="rechazo.id"
                class="flex items-start gap-3 px-4 py-3"
                data-qa="escanear-rechazado"
              >
                <div class="min-w-0 flex-1">
                  <p class="font-mono text-base font-semibold text-highlighted">
                    {{ rechazo.codigo }}
                  </p>
                  <p class="text-sm text-default">
                    {{ rechazo.mensaje }}
                  </p>
                  <p class="text-sm text-muted">
                    {{ rechazo.hoja }}
                  </p>
                </div>
                <UButton
                  icon="i-lucide-x"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  :aria-label="`Descartar el rechazo de ${rechazo.codigo}`"
                  data-qa="escanear-rechazado-descartar"
                  @click="descartarRechazo(rechazo.id)"
                />
              </li>
            </ul>
          </section>
        </div>

        <section class="space-y-4" aria-label="Hoja de ruta">
          <div
            v-if="!repartidorId"
            class="rounded-lg border border-dashed border-default p-8 text-center text-sm text-muted"
          >
            Elige un repartidor para ver y armar su hoja de ruta.
          </div>

          <template v-else>
            <div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <div>
                <h2 class="text-lg font-semibold text-highlighted">
                  Hoja de {{ repartidorElegido?.label }} del {{ fechaCorta(fecha) }}
                </h2>
                <p v-if="textoResumenNeto" class="text-sm text-muted" data-qa="escanear-neto">
                  {{ textoResumenNeto }}
                </p>
              </div>
              <div v-if="hoja" class="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <p class="text-2xl font-semibold tabular-nums text-highlighted" data-qa="escanear-asignados">
                  {{ hoja.asignados }} asignados
                </p>
                <p class="text-base tabular-nums text-muted" data-qa="escanear-con-cobro">
                  {{ conCobro }} a cobrar en destino
                </p>
              </div>
            </div>

            <UAlert
              v-if="hojaRendida"
              color="info"
              variant="subtle"
              icon="i-lucide-lock"
              title="Esta hoja ya está rendida: no se pueden agregar ni cambiar paquetes."
              data-qa="escanear-rendida"
            />

            <ul
              v-if="hoja?.lineas.length"
              class="divide-y divide-default rounded-lg border border-default"
              data-qa="escanear-lineas"
            >
              <li
                v-for="linea in hoja.lineas"
                :key="linea.paqueteId"
                class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
                :data-qa="`escanear-linea-${linea.codigo}`"
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
                  <p v-if="!linea.destinatarioNombre && !linea.direccion" class="text-sm text-muted">
                    Sin datos del destinatario todavía
                  </p>
                </div>
                <div class="flex items-center gap-1">
                  <dl class="grid grid-cols-[auto_auto] gap-x-2 text-sm">
                    <dt class="text-muted">
                      Envío
                    </dt>
                    <dd
                      class="text-right font-medium tabular-nums text-highlighted"
                      :data-qa="`escanear-linea-envio-${linea.codigo}`"
                    >
                      {{ formatOficial(linea.precioEnvio) }}
                    </dd>
                    <dt class="text-muted">
                      {{ linea.pagoEstimado ? 'Pago estimado' : 'Pago' }}
                    </dt>
                    <dd
                      class="text-right font-medium tabular-nums text-highlighted"
                      :data-qa="`escanear-linea-pago-${linea.codigo}`"
                    >
                      {{ formatOficial(linea.pagoRepartidor) }}
                    </dd>
                    <dt class="text-muted">
                      Tarifa
                    </dt>
                    <dd
                      class="text-right text-default"
                      :data-qa="`escanear-linea-tarifa-${linea.codigo}`"
                    >
                      {{ linea.tarifaPagoNombre ?? 'Sin tarifa' }}
                    </dd>
                  </dl>
                  <UButton
                    v-if="montosEditables"
                    icon="i-lucide-pencil"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :disabled="enCambio.has(linea.paqueteId)"
                    :aria-label="`Editar montos de ${linea.codigo}`"
                    :data-qa="`escanear-linea-montos-${linea.codigo}`"
                    @click="abrirMontos(linea)"
                  />
                </div>
                <UBadge
                  v-if="linea.estado !== 'en_ruta'"
                  :label="rotuloEstadoLinea(linea.estado)"
                  :color="colorEstadoLinea(linea.estado)"
                  variant="subtle"
                />
                <USwitch
                  :model-value="linea.cobroEnDestino"
                  label="Cobra en destino"
                  :disabled="!lineaEditable(linea) || enCambio.has(linea.paqueteId)"
                  :aria-label="`Cobro en destino de ${linea.codigo}`"
                  :data-qa="`escanear-linea-cobro-${linea.codigo}`"
                  @update:model-value="(v: boolean) => alternarCobro(linea, v)"
                />
                <UButton
                  v-if="lineaEditable(linea)"
                  label="Quitar"
                  icon="i-lucide-x"
                  color="error"
                  variant="ghost"
                  size="sm"
                  :disabled="enCambio.has(linea.paqueteId)"
                  :aria-label="`Quitar ${linea.codigo} de la hoja`"
                  :data-qa="`escanear-linea-quitar-${linea.codigo}`"
                  @click="quitar(linea)"
                />
              </li>
            </ul>

            <p
              v-else-if="!cargandoHoja"
              class="rounded-lg border border-dashed border-default p-8 text-center text-sm text-muted"
              data-qa="escanear-hoja-vacia"
            >
              Esta hoja todavía no tiene paquetes. Escanea el primero.
            </p>
          </template>
        </section>
      </div>
    </template>
  </UDashboardPanel>

  <UModal
    v-model:open="montosAbierto"
    :title="montosLinea ? `Montos de ${montosLinea.codigo}` : 'Montos del paquete'"
    description="Reemplazan los valores por defecto solo para este paquete."
    :ui="shellUi.modal"
    :content="{ onCloseAutoFocus: alCerrarModalMontos }"
  >
    <template #body>
      <div class="space-y-4" data-qa="escanear-montos-modal">
        <UFormField label="Precio de envío" description="Lo que se cobra por este envío.">
          <MoneyInput
            v-model="montosForm.precioEnvio"
            oficial
            class="w-48"
            data-qa="escanear-montos-envio"
          />
        </UFormField>
        <UFormField label="Tarifa de pago" description="Lo que se le paga al repartidor si lo entrega.">
          <USelect
            v-model="montosForm.tarifaPagoId"
            :items="tarifaOptions"
            :placeholder="tarifaOptions[0]?.label"
            class="w-full"
            data-qa="escanear-montos-tarifa"
          />
        </UFormField>
        <UAlert
          v-if="errorMontos"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-x"
          :title="errorMontos"
          data-qa="escanear-montos-error"
        />
      </div>
    </template>
    <template #footer>
      <AppModalFooter>
        <UButton color="neutral" variant="ghost" :disabled="guardandoMontos" @click="cerrarMontos">
          Cancelar
        </UButton>
        <UButton
          :loading="guardandoMontos"
          :disabled="!montosForm.precioEnvio"
          data-qa="escanear-montos-guardar"
          @click="guardarMontos"
        >
          Guardar montos
        </UButton>
      </AppModalFooter>
    </template>
  </UModal>
</template>

<style scoped>
/* Cada resultado nuevo destella una vez: dos "ya estaba en la hoja" seguidos se notan como dos. */
@keyframes destello-resultado {
  from {
    opacity: 0.35;
    transform: scale(0.985);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.resultado-escaneo {
  animation: destello-resultado 160ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .resultado-escaneo {
    animation: none;
  }
}
</style>
