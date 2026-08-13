<script setup lang="ts">
import type { SolicitudTestigo } from '~/composables/useSalones'
import { shellUi } from '~/utils/ui-shell'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  solicitudes: SolicitudTestigo[]
  /**
   * El PIN que el garzón YA tecleó en el teclado enmascarado
   * (`SalonesGarzonPinModal`, vía `solicitarPin`) para ver estas pendientes.
   * Vacío en modo personal, donde la identidad la prueba el JWT.
   *
   * Llega por prop y **no se vuelve a pedir** (revisión independiente, 2026-08-13):
   * la primera versión tenía un `UInput` de texto plano acá. Era redundante —el
   * garzón acababa de probar ese mismo PIN segundos antes— y además dejaba **el
   * PIN a la vista en un tótem compartido**, justo en la feature cuyo propósito
   * es que quede claro quién dio fe. El proyecto tiene un solo embudo de PIN y
   * enmascara siempre; este componente se alinea.
   */
  pin: string
  /** `true` si la cuenta logueada ES el garzón (tablet personal). Decide si la vía cuenta está disponible. */
  modoPersonal: boolean
}>()

const emit = defineEmits<{
  resuelto: [testigoId: string]
}>()

const salonesApi = useSalones()
const toast = useToast()
const { formatMonto, formatFecha } = useFormatters()

/** Comentario opcional del rechazo, por solicitud. */
const comentarios = reactive(new Map<string, string>())
/** Qué solicitudes tienen abierto el paso de "rechazar con comentario". */
const rechazando = reactive(new Set<string>())
/** Guard de reentrancia por solicitud — mismo patrón que `transfiriendo`/`fusionando`
 *  en `pages/salones/index.vue`. */
const resolviendo = reactive(new Set<string>())
/**
 * El 403 "está vinculado a una cuenta" (`CajaTestigoService.resolver`) NO es un
 * error genérico: es información para el garzón ("firmá desde tu cuenta, no
 * desde el tótem"). Se guarda por solicitud para mostrarse inline, nunca como
 * toast rojo indistinguible de un PIN incorrecto o un fallo de red.
 */
const avisosVinculo = reactive(new Map<string, string>())

function comentario(id: string): string {
  return comentarios.get(id) ?? ''
}

function abrirRechazo(id: string) {
  rechazando.add(id)
}

/**
 * Cancelar el rechazo **borra lo escrito** (revisión independiente,
 * 2026-08-13). Antes solo cerraba el campo: escribir "no vi el conteo",
 * cancelar y después dar fe persistía esa frase como
 * `comentario_garzon` de una firma, y el detalle del cierre mostraba un
 * registro que se contradecía a sí mismo — justo el dato que esta feature
 * existe para hacer confiable.
 */
function cancelarRechazo(id: string) {
  rechazando.delete(id)
  comentarios.delete(id)
}

/**
 * El garzón tiene cuenta propia pero está operando desde otra (el tótem): por
 * diseño, la firma solo vale desde SU cuenta y el PIN no se mira
 * (`CajaTestigoService.resolver`). Se avisa ANTES de intentar, con el dato que
 * ya viene en la solicitud, en vez de dejar que se entere por un 403.
 */
function requiereSuCuenta(solicitud: SolicitudTestigo): boolean {
  return solicitud.garzonVinculado && !props.modoPersonal
}

/**
 * La API no manda número/nombre de caja (`SolicitudPublica` solo trae
 * `cajaId`), así que esta referencia corta es lo único disponible para
 * distinguir dos solicitudes de cajas distintas — mismo patrón que el folio
 * de `pages/propinas/liquidaciones/[id]/imprimir.vue`.
 */
function refCaja(cajaId: string): string {
  return cajaId.slice(0, 8).toUpperCase()
}

async function resolver(solicitud: SolicitudTestigo, firma: boolean) {
  if (resolviendo.has(solicitud.id) || requiereSuCuenta(solicitud)) return

  resolviendo.add(solicitud.id)
  avisosVinculo.delete(solicitud.id)
  try {
    const texto = comentario(solicitud.id).trim()
    await salonesApi.resolverTestigo(solicitud.id, {
      firma,
      // Vinculado → la identidad la prueba el JWT y el PIN ni se mira.
      ...(solicitud.garzonVinculado ? {} : { pin: props.pin }),
      // El comentario es del RECHAZO: no viaja con una firma ni aunque haya
      // quedado texto de un rechazo que se abrió y se canceló.
      ...(!firma && texto ? { comentario: texto } : {}),
    })
    toast.add({
      title: firma ? 'Diste fe del conteo' : 'Rechazaste la solicitud',
      color: firma ? 'success' : 'neutral',
    })
    rechazando.delete(solicitud.id)
    comentarios.delete(solicitud.id)
    emit('resuelto', solicitud.id)
  }
  catch (e: unknown) {
    const msg = apiErrorMsg(e, firma ? 'No se pudo firmar' : 'No se pudo rechazar')
    // El garzón vinculado que intenta resolver desde OTRA cuenta (típicamente
    // el tótem, tras identificarse solo con PIN para ver sus pendientes)
    // recibe este 403 exacto — es la información que necesita, no un error
    // genérico indistinguible de un PIN mal tecleado.
    if (msg.includes('vinculado a una cuenta')) {
      avisosVinculo.set(solicitud.id, msg)
    }
    else {
      toast.add({ title: msg, color: 'error' })
    }
  }
  finally {
    resolviendo.delete(solicitud.id)
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Te pidieron dar fe de un cierre"
    description="Es lo contado en el conteo. Si algo no coincide, rechazá con un comentario."
    :ui="shellUi.modal"
  >
    <template #body>
      <div v-if="props.solicitudes.length === 0" class="py-6 text-center text-sm text-muted">
        No tenés ninguna firma pendiente.
      </div>

      <div v-else class="space-y-6">
        <div
          v-for="solicitud in props.solicitudes"
          :key="solicitud.id"
          class="space-y-3 rounded-lg border border-default p-4"
        >
          <div class="flex items-center justify-between">
            <p class="font-medium text-default">Caja {{ refCaja(solicitud.cajaId) }}</p>
            <span class="text-xs text-muted">
              Pendiente desde {{ formatFecha(solicitud.solicitadaEl) }}
            </span>
          </div>

          <!-- Lo contado, línea por línea. NUNCA lo esperado: eso es lo que
               hace que dar fe signifique algo. -->
          <ul class="divide-y divide-default">
            <li
              v-for="linea in solicitud.lineas"
              :key="linea.metodoPagoId ?? 'efectivo'"
              class="flex items-center justify-between py-1.5 text-sm"
            >
              <span class="flex items-center gap-1.5 text-default">
                <UIcon
                  :name="linea.esEfectivo ? 'i-lucide-banknote' : 'i-lucide-credit-card'"
                  class="size-4 text-muted"
                />
                {{ linea.nombre }}
              </span>
              <span class="font-medium text-default">
                {{ linea.contado != null ? formatMonto(linea.contado) : '—' }}
              </span>
            </li>
          </ul>

          <UAlert
            v-if="requiereSuCuenta(solicitud)"
            color="warning"
            variant="subtle"
            icon="i-lucide-info"
            title="Tenés que firmar desde tu cuenta"
            description="Este garzón está vinculado a una cuenta: la firma vale desde ahí, no desde un dispositivo compartido."
          />
          <UAlert
            v-else-if="avisosVinculo.get(solicitud.id)"
            color="warning"
            variant="subtle"
            icon="i-lucide-info"
            :description="avisosVinculo.get(solicitud.id)"
          />

          <UFormField v-if="rechazando.has(solicitud.id)" label="Comentario (opcional)">
            <UTextarea
              :model-value="comentario(solicitud.id)"
              aria-label="Comentario del rechazo"
              placeholder="¿Por qué rechazás?"
              @update:model-value="(v: string | number) => comentarios.set(solicitud.id, String(v))"
            />
          </UFormField>

          <div class="flex flex-wrap justify-end gap-2">
            <template v-if="!rechazando.has(solicitud.id)">
              <UButton
                color="neutral"
                variant="ghost"
                @click="abrirRechazo(solicitud.id)"
              >
                Rechazar
              </UButton>
              <UButton
                icon="i-lucide-check"
                :disabled="requiereSuCuenta(solicitud)"
                :loading="resolviendo.has(solicitud.id)"
                @click="resolver(solicitud, true)"
              >
                Dar fe
              </UButton>
            </template>
            <template v-else>
              <UButton
                color="neutral"
                variant="ghost"
                :disabled="resolviendo.has(solicitud.id)"
                @click="cancelarRechazo(solicitud.id)"
              >
                Cancelar
              </UButton>
              <UButton
                color="error"
                variant="soft"
                :disabled="requiereSuCuenta(solicitud)"
                :loading="resolviendo.has(solicitud.id)"
                @click="resolver(solicitud, false)"
              >
                Confirmar rechazo
              </UButton>
            </template>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
