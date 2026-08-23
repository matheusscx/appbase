<script setup lang="ts">
import Decimal from 'decimal.js'
import type { ArqueoLinea, NivelDescuadre } from '~/stores/caja'

const props = defineProps<{
  cajaId: string
  resumir?: boolean
  /** Cierre forzado (el encargado cierra la caja de OTRO cajero): la fase 2 exige firma o comentario. */
  forzado?: boolean
  /** Adónde navegar tras cerrar con éxito, sin la barra final. Por defecto `/mi-caja` (el dueño). */
  redirectBase?: string
}>()
const open = defineModel<boolean>('open', { required: true })

const cajaStore = useCajaStore()
const toast = useToast()
const { formatMonto } = useFormatters()

const fase = ref<'conteo' | 'conciliacion'>('conteo')
const saving = ref(false)
const loading = ref(false)

// Fase 1 (conteo): contado por clave de línea (metodoPagoId ?? 'EFECTIVO').
const contado = ref<Record<string, string>>({})
const comentario = ref('')

// Fase 2 (conciliación): motivo/comentario de diferencia por clave de línea.
const motivoPorClave = ref<Record<string, string>>({})
const comentarioJustificacionPorClave = ref<Record<string, string>>({})

// Nivel del descuadre que informó la fase 1. `null` mientras no se envió el
// conteo. NO se recalcula en el cliente: el umbral es config del tenant y el
// nivel lo congela el backend con el arqueo — recomputarlo acá sería una
// segunda fuente de verdad que se puede desincronizar de la que se persistió.
const nivelDescuadre = ref<NivelDescuadre | null>(null)
// Texto libre del cajero. Siempre opcional: ningún nivel bloquea el cierre.
const explicacionDescuadre = ref('')

const claveDe = (l: ArqueoLinea) => l.metodoPagoId ?? 'EFECTIVO'

const ciego = computed(() => cajaStore.arqueoCiego)

const motivoItems = computed(() =>
  cajaStore.motivos.map(m => ({ label: m.nombre, value: m.id })),
)

function resetEstadoLocal() {
  contado.value = {}
  comentario.value = ''
  motivoPorClave.value = {}
  comentarioJustificacionPorClave.value = {}
  nivelDescuadre.value = null
  explicacionDescuadre.value = ''
  fase.value = 'conteo'
}

/**
 * `immediate` porque el drawer puede **montarse con `open` ya en `true`**, y en
 * ese caso un `watch` normal no corre nunca: se quedaba dibujando su estado
 * inicial —fase 1, conteo en blanco— sobre una caja que ya no está `abierta`.
 *
 * Medido en el smoke de navegador del cierre forzado: al enviar el conteo, el
 * store adelanta `detalle.estado` a `en_conciliacion` ANTES de recargar el
 * detalle, así que por un tick la caja no es ni "ajena abierta" ni "forzada con
 * panel" —`cerradaPor` todavía no llegó— y el `v-if` que monta este drawer se
 * apaga y se vuelve a encender. El encargado quedaba mirando un formulario de
 * conteo vacío para una caja ya contada, y "Enviar conteo" habría fallado.
 * Cerrar y reabrir lo arreglaba, que es exactamente la firma de este problema.
 */
watch(open, async (isOpen) => {
  if (!isOpen) {
    resetEstadoLocal()
    return
  }
  loading.value = true
  try {
    // Retomar: prop explícita o, si no viene, la propia caja activa ya está
    // `en_conciliacion` (caso típico: se cerró el drawer y se reabre después).
    const debeResumir = props.resumir ?? cajaStore.activa?.estado === 'en_conciliacion'
    if (debeResumir) {
      fase.value = 'conciliacion'
      const cargas = [
        cajaStore.cargarArqueo(props.cajaId),
        cajaStore.cargarMotivos(true),
        // El detalle trae `nivelDescuadre`, congelado por la fase 1. Sin esto,
        // cerrar el drawer y retomar la conciliación más tarde perdía el aviso
        // del umbral: el ref local se resetea, y el nivel no se puede
        // recalcular en el cliente (el umbral es config del tenant).
        cajaStore.cargarDetalle(props.cajaId),
      ]
      // Solo el cierre forzado exige firma o comentario (fase 2, más abajo):
      // sin esto la primera apertura directa en conciliación vería `testigos`
      // vacío del montaje anterior y gatearía con datos viejos.
      //
      // Si la carga de testigos falla, el drawer NO se cae: `cargarTestigos`
      // ya vació el array, así que el gate degrada hacia el lado seguro —se
      // pide la explicación— en vez de habilitar el cierre con datos que no
      // se pudieron leer.
      if (props.forzado) {
        cargas.push(cajaStore.cargarTestigos(props.cajaId).catch(() => {}))
      }
      await Promise.all(cargas)
      if (cajaStore.detalle?.id === props.cajaId) {
        nivelDescuadre.value = cajaStore.detalle.nivelDescuadre ?? null
        explicacionDescuadre.value = cajaStore.detalle.explicacionDescuadre ?? ''
      }
    }
    else {
      fase.value = 'conteo'
      await cajaStore.cargarArqueo(props.cajaId)
    }
  }
  finally {
    loading.value = false
  }
}, { immediate: true })

// --- Fase 1: conteo ---

const obligatorias = computed(() =>
  cajaStore.arqueo.filter(l => l.esEfectivo || l.requiereConteo),
)
const informativas = computed(() =>
  cajaStore.arqueo.filter(l => !l.esEfectivo && !l.requiereConteo),
)

function diferenciaDe(l: ArqueoLinea): Decimal | null {
  if (l.esperado == null) return null
  const c = contado.value[claveDe(l)]
  if (!c) return null
  try {
    return new Decimal(c).minus(l.esperado)
  }
  catch {
    return null
  }
}

const obligatoriasCompletas = computed(() =>
  obligatorias.value.every(l => !!contado.value[claveDe(l)]),
)

/** Común a ambas fases: toast + cierre del drawer + revelación en el detalle. */
async function finalizarExito(arqueoResultante: ArqueoLinea[]) {
  const efectivo = arqueoResultante.find(l => l.esEfectivo)
  const dif = efectivo?.diferencia ?? '0'
  toast.add({
    title: 'Caja cerrada',
    description: `Diferencia de efectivo: ${formatMonto(dif)}`,
    color: new Decimal(dif).gte(0) ? 'success' : 'error',
  })
  open.value = false
  if (ciego.value) {
    // Revelación: el arqueo se muestra en el detalle. Desde POS, navigateTo
    // remonta /mi-caja/[id] (o /cajas/[id] para el encargado, vía `redirectBase`)
    // y su onMounted recarga todo; si ya se está ahí, es una navegación al
    // mismo destino (no-op).
    await navigateTo(`${props.redirectBase ?? '/mi-caja'}/${props.cajaId}`)
  }
}

async function enviarConteo() {
  if (!obligatoriasCompletas.value) {
    toast.add({ title: 'Completa el conteo de las líneas obligatorias', color: 'warning' })
    return
  }
  saving.value = true
  try {
    const lineas = Object.entries(contado.value)
      .filter(([, v]) => v !== '')
      .map(([clave, montoContado]) => ({
        metodoPagoId: clave === 'EFECTIVO' ? null : clave,
        montoContado,
      }))
    const res = await cajaStore.enviarConteo(props.cajaId, { lineas, comentario: comentario.value || undefined })
    nivelDescuadre.value = res.nivelDescuadre

    if (res.estado === 'en_conciliacion') {
      const cargas = [cajaStore.cargarMotivos(true)]
      // El cierre forzado recién queda registrado en el backend acá (`cerradaPor`,
      // `comentarioCierre`): recargar el detalle es lo único que trae esos campos
      // a `cajaStore.detalle` dentro de la MISMA sesión del drawer, sin lo cual el
      // panel de "pedir firma" (que depende de ellos) no aparecería hasta un F5.
      if (props.forzado) {
        cargas.push(cajaStore.cargarDetalle(props.cajaId), cajaStore.cargarTestigos(props.cajaId))
      }
      await Promise.all(cargas)
      fase.value = 'conciliacion'
      toast.add({ title: 'Conteo registrado: hay diferencias por conciliar', color: 'warning' })
      return
    }

    await finalizarExito(res.arqueo)
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al registrar el conteo')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    saving.value = false
  }
}

// --- Fase 2: conciliación ---

const descuadres = computed(() =>
  cajaStore.arqueo.filter(l => l.diferencia != null && !new Decimal(l.diferencia).isZero()),
)

function motivoDe(l: ArqueoLinea) {
  return cajaStore.motivos.find(m => m.id === motivoPorClave.value[claveDe(l)])
}

function lineaJustificada(l: ArqueoLinea): boolean {
  const comentarioTexto = (comentarioJustificacionPorClave.value[claveDe(l)] ?? '').trim()
  // Red de seguridad: sin motivos activos configurados, el comentario es obligatorio.
  if (cajaStore.motivos.length === 0) return !!comentarioTexto
  const motivo = motivoDe(l)
  if (!motivo) return false
  if (motivo.requiereComentario && !comentarioTexto) return false
  return true
}

// ¿Alguien ya dio fe de este conteo? Solo importa en un cierre forzado.
const hayFirmaAlguna = computed(() => cajaStore.testigos.some(t => t.estado === 'firmada'))

// El comentario de la fase 1 ya cuenta como explicación (decisión del owner,
// `caja.service.ts` → `cerrar`): si `enviarConteo` ya dejó uno persistido en
// `caja.comentarioCierre`, no hay que pedirlo de nuevo. Sale de `cajaStore.detalle`
// (no del `comentario` local, que se resetea al cerrar el drawer) porque es lo
// único que sigue vivo si el encargado cierra el drawer y retoma más tarde.
const comentarioPrevio = computed(() =>
  cajaStore.detalle?.id === props.cajaId ? cajaStore.detalle.comentarioCierre : null,
)

// Cierre forzado + nadie firmó + sin comentario previo de fase 1: la fase 2
// no se completa sin que ACÁ se explique qué pasó — el backend (`cerrar`) ya
// lo exige con un 400; esto evita que el botón se habilite y el 400 sea la
// única forma de enterarse.
const requiereComentarioSinTestigo = computed(() =>
  !!props.forzado && !hayFirmaAlguna.value && !comentarioPrevio.value?.trim(),
)

const conciliacionCompleta = computed(() =>
  descuadres.value.every(lineaJustificada)
  && (!requiereComentarioSinTestigo.value || !!comentario.value.trim()),
)

async function confirmarCierre() {
  if (!conciliacionCompleta.value) {
    toast.add({
      title: requiereComentarioSinTestigo.value && !comentario.value.trim()
        ? 'Nadie firmó como testigo: explicá qué pasó para poder cerrar'
        : 'Completa el motivo (o comentario) de cada diferencia',
      color: 'warning',
    })
    return
  }
  saving.value = true
  try {
    const lineas = descuadres.value.map(l => ({
      metodoPagoId: l.metodoPagoId,
      motivoDiferenciaId: motivoPorClave.value[claveDe(l)] || undefined,
      comentarioDiferencia: comentarioJustificacionPorClave.value[claveDe(l)]?.trim() || undefined,
    }))
    const res = await cajaStore.cerrar(props.cajaId, {
      lineas,
      comentario: comentario.value.trim() || undefined,
      explicacionDescuadre: explicacionDescuadre.value.trim() || undefined,
    })
    await finalizarExito(res.arqueo)
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, 'Error al confirmar el cierre')
    toast.add({ title: msg, color: 'error' })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <AppDrawer v-model:open="open" width="md">
    <template #header>
      <span class="font-semibold text-default">
        {{ fase === 'conteo' ? 'Cerrar caja' : 'Conciliar diferencias' }}
      </span>
    </template>

    <template #body>
      <div v-if="loading" class="py-8 text-center text-muted text-sm">
        Cargando arqueo…
      </div>

      <UForm
        v-else-if="fase === 'conteo'"
        id="caja-cierre-form"
        :state="contado"
        class="space-y-6"
        @submit="enviarConteo"
      >
        <!-- A conciliar (obligatorias): efectivo primero -->
        <div class="space-y-3">
          <p class="text-xs font-semibold uppercase text-muted">A conciliar</p>
          <div
            v-for="l in obligatorias"
            :key="claveDe(l)"
            :data-qa="`arqueo-${claveDe(l)}`"
            class="rounded-lg bg-muted p-3 space-y-2"
          >
            <div class="flex justify-between text-sm">
              <span class="font-medium text-default">{{ l.nombre }}</span>
              <span v-if="l.esperado != null" class="text-muted">Esperado {{ formatMonto(l.esperado) }}</span>
            </div>
            <MoneyInput
              :model-value="contado[claveDe(l)] ?? ''"
              oficial
              class="w-full"
              @update:model-value="(v: string) => { contado[claveDe(l)] = v }"
            />
            <div v-if="l.esperado != null" class="flex justify-between text-sm font-semibold">
              <span class="text-default">Diferencia</span>
              <span
                v-if="diferenciaDe(l) !== null"
                :class="diferenciaDe(l)!.gte(0) ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
              >
                {{ diferenciaDe(l)!.gte(0) ? '+' : '' }}{{ formatMonto(diferenciaDe(l)!) }}
              </span>
              <span v-else class="text-muted">—</span>
            </div>
          </div>
        </div>

        <!-- Informativas (opcionales) -->
        <div v-if="informativas.length" class="space-y-3">
          <p class="text-xs font-semibold uppercase text-muted">Informativas (opcional)</p>
          <div
            v-for="l in informativas"
            :key="claveDe(l)"
            class="rounded-lg border border-default p-3 space-y-2"
          >
            <div class="flex justify-between text-sm">
              <span class="font-medium text-default">{{ l.nombre }}</span>
              <span class="text-muted">Esperado {{ formatMonto(l.esperado) }}</span>
            </div>
            <MoneyInput
              :model-value="contado[claveDe(l)] ?? ''"
              oficial
              class="w-full"
              @update:model-value="(v: string) => { contado[claveDe(l)] = v }"
            />
            <div v-if="diferenciaDe(l) !== null" class="flex justify-between text-sm">
              <span class="text-muted">Diferencia</span>
              <span :class="diferenciaDe(l)!.gte(0) ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'">
                {{ diferenciaDe(l)!.gte(0) ? '+' : '' }}{{ formatMonto(diferenciaDe(l)!) }}
              </span>
            </div>
          </div>
        </div>

        <UFormField label="Comentario de cierre">
          <UInput v-model="comentario" placeholder="Observaciones del cierre (opcional)" class="w-full" />
        </UFormField>
      </UForm>

      <UForm
        v-else
        id="caja-cierre-form"
        :state="motivoPorClave"
        class="space-y-6"
        @submit="confirmarCierre"
      >
        <p v-if="descuadres.length > 0" class="text-sm text-muted">
          El conteo no cuadró. Justificá cada diferencia para confirmar el cierre.
        </p>
        <p v-else-if="props.forzado" class="text-sm text-muted">
          El conteo cuadró. Es un cierre forzado: pedile firma a un garzón en turno o explicá qué pasó.
        </p>

        <!-- Aviso del umbral. No hay botón que frene: el cajero confirma y
             cierra igual (owner, 2026-08-23). El texto dice qué va a pasar
             después, que es lo único que cambia entre los dos niveles. -->
        <template v-if="nivelDescuadre === 'aviso' || nivelDescuadre === 'alto'">
          <UAlert
            :color="nivelDescuadre === 'alto' ? 'error' : 'warning'"
            variant="soft"
            :icon="nivelDescuadre === 'alto' ? 'i-lucide-siren' : 'i-lucide-triangle-alert'"
            :title="nivelDescuadre === 'alto'
              ? 'La diferencia superó el límite del local'
              : 'La diferencia es más grande de lo habitual'"
            :description="nivelDescuadre === 'alto'
              ? 'Podés cerrar igual. Tu cierre le va a quedar al encargado para revisar; contá acá qué pasó y lo revisa con tu explicación al lado.'
              : 'Podés cerrar igual. Si querés, dejá una nota de qué pasó.'"
            :data-qa="`cierre-umbral-${nivelDescuadre}`"
          />
          <UFormField label="¿Qué pasó?" data-qa="cierre-explicacion-descuadre">
            <UTextarea
              v-model="explicacionDescuadre"
              :rows="2"
              :maxlength="1000"
              placeholder="Ej: le di vuelto de más a un cliente, faltó registrar una compra de insumos…"
              class="w-full"
            />
          </UFormField>
        </template>

        <template v-if="requiereComentarioSinTestigo">
          <UAlert
            color="warning"
            variant="soft"
            icon="i-lucide-shield-alert"
            title="Nadie firmó como testigo"
            description="Sin una firma, hace falta explicar qué pasó para poder cerrar."
          />
          <UFormField label="Comentario (obligatorio: nadie firmó)" data-qa="cierre-comentario-sin-testigo">
            <UInput v-model="comentario" placeholder="¿Qué pasó con el testigo?" class="w-full" />
          </UFormField>
        </template>

        <div class="space-y-3">
          <div
            v-for="l in cajaStore.arqueo"
            :key="claveDe(l)"
            :data-qa="`arqueo-${claveDe(l)}`"
            class="rounded-lg p-3 space-y-2"
            :class="l.diferencia != null && !new Decimal(l.diferencia).isZero() ? 'bg-muted' : 'border border-default'"
          >
            <div class="flex justify-between text-sm">
              <span class="font-medium text-default">{{ l.nombre }}</span>
              <span class="text-muted">
                Esperado {{ l.esperado != null ? formatMonto(l.esperado) : '—' }}
                · Contado {{ l.contado != null ? formatMonto(l.contado) : '—' }}
              </span>
            </div>
            <div class="flex justify-between text-sm font-semibold">
              <span class="text-default">Diferencia</span>
              <span
                v-if="l.diferencia != null"
                :class="new Decimal(l.diferencia).gte(0) ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
              >
                {{ new Decimal(l.diferencia).gte(0) ? '+' : '' }}{{ formatMonto(l.diferencia) }}
              </span>
              <span v-else class="text-muted">—</span>
            </div>

            <template v-if="l.diferencia != null && !new Decimal(l.diferencia).isZero()">
              <USelect
                v-if="motivoItems.length"
                v-model="motivoPorClave[claveDe(l)]"
                :items="motivoItems"
                placeholder="Motivo de la diferencia"
                class="w-full"
              />
              <p v-else class="text-xs text-warning">
                No hay motivos activos configurados: describí la diferencia en el comentario.
              </p>
              <UInput
                v-model="comentarioJustificacionPorClave[claveDe(l)]"
                :placeholder="motivoDe(l)?.requiereComentario || !motivoItems.length ? 'Comentario (obligatorio)' : 'Comentario (opcional)'"
                class="w-full"
              />
            </template>
          </div>
        </div>
      </UForm>
    </template>

    <template #actions>
      <UButton color="neutral" variant="ghost" @click="() => { open = false }">
        Cancelar
      </UButton>
      <UButton
        type="submit"
        form="caja-cierre-form"
        color="error"
        icon="i-lucide-lock"
        :loading="saving"
        :disabled="loading || (fase === 'conteo' ? !obligatoriasCompletas : !conciliacionCompleta)"
      >
        {{ fase === 'conteo' ? 'Enviar conteo' : 'Confirmar cierre' }}
      </UButton>
    </template>
  </AppDrawer>
</template>
