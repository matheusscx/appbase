<script setup lang="ts">
import type { Caja } from '~/stores/caja'

/**
 * El encargado cierra la caja de un cajero que se fue, y pide fe del conteo
 * a los garzones en turno. Vive en `pages/cajas/[id].vue` — la pantalla del
 * encargado, no la del dueño (`/mi-caja`).
 *
 * El gate es `usePermisosCrud('Cajas').puedeActualizar` (decisión del owner
 * 2026-08-13: forzar pasa a ser operativo, no exclusivo del admin del
 * tenant) — `caja.controller.ts` resuelve `puedeForzar` a mano
 * (`resolverEscrituraCompartida`, sin `@RequiresPermiso` en la ruta) contra
 * `Cajas:Actualizar`, y `caja.service.ts` rechaza el cierre ajeno si
 * `!puedeForzar`. `puedeActualizar` ya incluye al admin por su primera
 * condición (`esAdmin || can(...)`), así que no hace falta gatear los dos
 * por separado.
 *
 * `usuarioActualId` llega como prop (no `useAuthStore()` acá adentro): así el
 * componente no depende del store de auth para decidir "¿es mi caja?", que es
 * lo único que necesita de él.
 */
const props = defineProps<{ caja: Caja, usuarioActualId: string | undefined }>()

const cajaStore = useCajaStore()
const { puedeActualizar } = usePermisosCrud('Cajas')
const toast = useToast()
const { formatFecha } = useFormatters()
const { listarAbiertas } = useSesionesGarzon()

const drawerOpen = ref(false)
const garzonesEnTurno = ref<{ garzonId: string, garzonNombre: string }[]>([])
const seleccionados = ref<Set<string>>(new Set())
const cargandoGarzones = ref(false)
const solicitando = ref(false)

const esAjenaAbierta = computed(() =>
  puedeActualizar.value
  && props.caja.estado === 'abierta'
  && props.caja.usuarioId !== props.usuarioActualId,
)

// `cerradaPor` lo llena SIEMPRE `enviarConteo` para cualquier caja que llegó a
// `en_conciliacion` o `cerrada`: "forzado" se deriva comparándolo contra el
// dueño, igual que hace el backend (`caja.service.ts` → `cerrar`), en vez de
// un flag aparte que podría contradecir a los datos.
const esForzado = computed(() =>
  !!props.caja.cerradaPor && props.caja.cerradaPor !== props.caja.usuarioId,
)

const mostrarPanelFirma = computed(() =>
  puedeActualizar.value && props.caja.estado === 'en_conciliacion' && esForzado.value,
)

// Presentación, no un campo nuevo: la diferencia de una caja que cerró OTRA
// persona se lee como incidente, no como el faltante del cajero.
const esIncidenteCerrada = computed(() =>
  props.caja.estado === 'cerrada' && esForzado.value,
)

const testigosVivos = computed(
  () =>
    new Set(
      cajaStore.testigos
        .filter(t => t.estado === 'pendiente' || t.estado === 'firmada')
        .map(t => t.garzonId),
    ),
)
// Un garzón con solicitud viva (pendiente o firmada) no vuelve a ofrecerse:
// pedirle fe otra vez chocaría con el índice único del backend (400).
const garzonesDisponibles = computed(() =>
  garzonesEnTurno.value.filter(g => !testigosVivos.value.has(g.garzonId)),
)

/**
 * Las dos cargas van por separado, no en un `Promise.all` (revisión
 * independiente, hallazgo 7): `listarAbiertas` exige `Salones:Leer`, y un
 * tenant sin ese módulo contratado —el minimarket de la spec, §Riesgos— recibe
 * un 403 legítimo. Con las dos juntas, ese 403 se llevaba puesto también el
 * estado de las solicitudes y dejaba un toast de error en cada montaje, cuando
 * la respuesta correcta ya existe en la pantalla: "no hay garzones en turno".
 * El estado de las solicitudes sí es un error de verdad si falla.
 */
async function cargarPanelFirma() {
  cargandoGarzones.value = true
  try {
    try {
      const sesiones = await listarAbiertas()
      garzonesEnTurno.value = sesiones.map(s => ({ garzonId: s.garzonId, garzonNombre: s.garzonNombre }))
    }
    catch {
      garzonesEnTurno.value = []
    }
    try {
      await cajaStore.cargarTestigos(props.caja.id)
    }
    catch {
      toast.add({ title: 'Error al cargar el estado de las solicitudes', color: 'error' })
    }
  }
  finally {
    cargandoGarzones.value = false
  }
}

// Aviso pasivo: se consulta al montar (`immediate`) y cuando el conteo recién
// deja la caja en conciliación dentro de la misma sesión — nunca en un loop.
watch(mostrarPanelFirma, (visible) => {
  if (visible) cargarPanelFirma()
}, { immediate: true })

function toggleSeleccionado(garzonId: string, marcado: boolean) {
  const set = new Set(seleccionados.value)
  if (marcado) set.add(garzonId)
  else set.delete(garzonId)
  seleccionados.value = set
}

async function pedirFirma() {
  if (seleccionados.value.size === 0) return
  solicitando.value = true
  try {
    const garzonIds = [...seleccionados.value]
    await cajaStore.solicitarTestigos(props.caja.id, garzonIds)
    toast.add({
      title: garzonIds.length === 1 ? 'Firma pedida' : `Firma pedida a ${garzonIds.length} garzones`,
      color: 'success',
    })
    seleccionados.value = new Set()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'No se pudo pedir la firma'), color: 'error' })
  }
  finally {
    solicitando.value = false
  }
}

const ESTADO_COLOR: Record<string, 'success' | 'error' | 'warning' | 'neutral'> = {
  firmada: 'success',
  rechazada: 'error',
  pendiente: 'warning',
  cancelada: 'neutral',
  caducada: 'neutral',
}
const ESTADO_LABEL: Record<string, string> = {
  firmada: 'Firmada',
  rechazada: 'Rechazada',
  pendiente: 'Pendiente',
  cancelada: 'Cancelada',
  caducada: 'Caducada',
}
</script>

<template>
  <div class="w-full space-y-6">
    <UCard v-if="esAjenaAbierta">
      <template #header>
        <h3 class="text-sm font-semibold text-default">
          Caja de otro cajero
        </h3>
      </template>
      <div class="space-y-3">
        <p class="text-sm text-default">
          Esta caja es de <span class="font-medium">{{ caja.usuarioNombre ?? 'otro usuario' }}</span>,
          abierta desde {{ formatFecha(caja.fechaApertura) }}.
        </p>
        <p class="text-sm text-muted">
          Si el cajero ya no está, podés cerrarla vos con el conteo a ciegas. Si nadie firma como
          testigo, vas a tener que explicar qué pasó.
        </p>
        <UButton
          data-qa="cerrar-caja-ajena"
          color="error"
          variant="soft"
          icon="i-lucide-lock"
          @click="() => { drawerOpen = true }"
        >
          Cerrar por el cajero
        </UButton>
      </div>
    </UCard>

    <template v-if="mostrarPanelFirma">
      <UCard data-qa="panel-pedir-firma">
        <template #header>
          <h3 class="text-sm font-semibold text-default">
            Pedir firma
          </h3>
        </template>

        <div class="space-y-4">
          <div v-if="cargandoGarzones" class="py-4 text-center text-sm text-muted">
            Cargando garzones en turno…
          </div>
          <template v-else>
            <p class="text-sm text-muted">
              {{ garzonesEnTurno.length === 0
                ? 'No hay garzones en turno ahora mismo.'
                : `${garzonesEnTurno.length} ${garzonesEnTurno.length === 1 ? 'garzón en turno' : 'garzones en turno'}` }}
            </p>

            <p v-if="garzonesEnTurno.length === 0" class="text-sm text-warning">
              Sin nadie en turno, vas a tener que explicar por qué se cerró sin testigo.
            </p>

            <div v-else-if="garzonesDisponibles.length > 0" class="space-y-2">
              <UCheckbox
                v-for="g in garzonesDisponibles"
                :key="g.garzonId"
                :model-value="seleccionados.has(g.garzonId)"
                :label="g.garzonNombre"
                @update:model-value="(v) => toggleSeleccionado(g.garzonId, !!v)"
              />
              <UButton
                data-qa="pedir-firma"
                color="primary"
                variant="soft"
                :loading="solicitando"
                :disabled="seleccionados.size === 0"
                @click="pedirFirma"
              >
                Pedir firma
              </UButton>
            </div>
            <p v-else class="text-sm text-muted">
              Ya se le pidió fe a todos los garzones en turno.
            </p>
          </template>
        </div>
      </UCard>

      <UCard data-qa="panel-solicitudes">
        <template #header>
          <h3 class="text-sm font-semibold text-default">
            Solicitudes
          </h3>
        </template>

        <p v-if="cajaStore.testigos.length === 0" class="text-sm text-muted">
          Todavía no se le pidió fe a nadie.
        </p>
        <ul v-else class="divide-y divide-default">
          <li
            v-for="t in cajaStore.testigos"
            :key="t.id"
            class="flex items-center justify-between gap-3 py-2 text-sm"
          >
            <div>
              <p class="font-medium text-default">{{ t.garzonNombre }}</p>
              <p class="text-xs text-muted">
                {{ formatFecha(t.resueltaEl ?? t.solicitadaEl) }}
              </p>
              <p v-if="t.estado === 'rechazada' && t.comentarioGarzon" class="text-xs text-muted mt-0.5">
                “{{ t.comentarioGarzon }}”
              </p>
            </div>
            <UBadge :color="ESTADO_COLOR[t.estado] ?? 'neutral'" variant="subtle">
              {{ ESTADO_LABEL[t.estado] ?? t.estado }}
            </UBadge>
          </li>
        </ul>
      </UCard>

      <div class="flex justify-end">
        <UButton
          data-qa="continuar-conciliacion"
          color="warning"
          variant="solid"
          icon="i-lucide-scale"
          @click="() => { drawerOpen = true }"
        >
          Continuar conciliación
        </UButton>
      </div>
    </template>

    <UAlert
      v-if="esIncidenteCerrada"
      color="neutral"
      variant="soft"
      icon="i-lucide-info"
      title="Cierre forzado"
    >
      <template #description>
        A esta caja la cerró otra persona, no {{ caja.usuarioNombre ?? 'quien la abrió' }}: la
        diferencia es un incidente del cierre, no necesariamente un faltante del cajero.
      </template>
    </UAlert>

    <CajaCierreDrawer
      v-if="esAjenaAbierta || mostrarPanelFirma"
      v-model:open="drawerOpen"
      :caja-id="caja.id"
      :resumir="caja.estado === 'en_conciliacion'"
      forzado
      redirect-base="/cajas"
    />
  </div>
</template>
