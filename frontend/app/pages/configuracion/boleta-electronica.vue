<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { AmbienteSii, CafPerfil, PerfilFiscal } from '~/composables/usePerfilFiscal'

// Configuración del tenant, no una operación de un módulo: los cuatro endpoints de `/dte` van
// con `TenantAdminGuard`. El menú la muestra solo al superadmin hasta que el sistema emita
// (`configuracion.vue`); la ruta sigue siendo del admin del tenant.
definePageMeta({ middleware: 'admin' })

// Un certificado pesa unos pocos kB y un CAF 2 a 3 kB; el body de la API acepta 100 kB. Un
// archivo más grande que esto no es lo que se pide, y llegar a la API daría un error de
// tamaño sin contexto.
const MAX_BYTES_CERTIFICADO = 75_000
const MAX_BYTES_CAF = 37_000

const config = useRuntimeConfig()
const toast = useToast()
const apiUrl = config.public.apiUrl

const perfil = ref<PerfilFiscal | null>(null)
const cargando = ref(true)
const guardando = ref(false)

const emptyForm = () => ({
  giro: '',
  comuna: '',
  ambiente: undefined as AmbienteSii | undefined,
  fechaResolucion: '',
  numeroResolucion: '',
})
const form = ref(emptyForm())

const ambienteItems: { label: string, value: AmbienteSii }[] = [
  { label: etiquetaAmbiente('certificacion'), value: 'certificacion' },
  { label: etiquetaAmbiente('produccion'), value: 'produccion' },
]

function aplicar(p: PerfilFiscal) {
  perfil.value = p
  const e = p.emisor
  form.value = {
    giro: e?.giro ?? '',
    comuna: e?.comuna ?? '',
    ambiente: e?.ambiente ?? undefined,
    fechaResolucion: e?.fechaResolucion ?? '',
    numeroResolucion: e?.numeroResolucion === null || e?.numeroResolucion === undefined
      ? ''
      : String(e.numeroResolucion),
  }
}

/**
 * `true` si el perfil llegó. Quien acaba de escribir avisa el éxito solo con un `true`: si el
 * re-GET falla, ya salió el aviso rojo de `cargar` y un verde al lado se contradice.
 */
async function cargar(): Promise<boolean> {
  try {
    aplicar(await useApiFetch<PerfilFiscal>(`${apiUrl}/dte/perfil`))
    return true
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al cargar los datos de la boleta electrónica'), color: 'error' })
    return false
  }
  finally {
    cargando.value = false
  }
}

/**
 * Guardar y volver a pedir el perfil: la respuesta del PATCH trae solo los campos tocados y con
 * los nombres del DTO (`ambienteSii`), no la forma del perfil; el perfil completo —con sus
 * `faltantes`— lo arma el servidor.
 */
async function guardar() {
  guardando.value = true
  try {
    const f = form.value
    const body: Record<string, unknown> = {
      giro: f.giro.trim(),
      comuna: f.comuna.trim(),
    }
    // Ninguno de estos acepta null: omitirlos es "no tocar".
    if (f.ambiente) body.ambienteSii = f.ambiente
    if (f.fechaResolucion) body.fechaResolucion = f.fechaResolucion
    if (f.numeroResolucion !== '') body.numeroResolucion = Number(f.numeroResolucion)
    await useApiFetch(`${apiUrl}/dte/perfil`, { method: 'PATCH', body })
    if (await cargar()) toast.add({ title: 'Datos de la empresa guardados', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al guardar'), color: 'error' })
  }
  finally {
    guardando.value = false
  }
}

// ── Certificado ──────────────────────────────────────────────────────────────

const certOpen = ref(false)
const certArchivo = ref<File | null>(null)
const certClave = ref('')
const certError = ref<string | null>(null)
const certSubiendo = ref(false)

// La clave no sobrevive al modal: ni cerrado ni cancelado.
watch(certOpen, (open) => {
  if (open) return
  certArchivo.value = null
  certClave.value = ''
  certError.value = null
})

function elegirArchivo(e: Event): File | null {
  return (e.target as HTMLInputElement).files?.[0] ?? null
}

async function subirCertificado() {
  const file = certArchivo.value
  if (!file) {
    certError.value = 'Elige el archivo del certificado (.pfx o .p12)'
    return
  }
  if (file.size > MAX_BYTES_CERTIFICADO) {
    certError.value = 'El archivo es demasiado grande para ser un certificado digital'
    return
  }
  certSubiendo.value = true
  certError.value = null
  try {
    await useApiFetch(`${apiUrl}/dte/certificado`, {
      method: 'POST',
      body: { pfxBase64: await archivoABase64(file), clave: certClave.value },
    })
    certOpen.value = false
    if (await cargar()) toast.add({ title: 'Certificado cargado', color: 'success' })
  }
  catch (e: unknown) {
    certError.value = apiErrorMsg(e, 'No se pudo cargar el certificado')
  }
  finally {
    certSubiendo.value = false
  }
}

// ── Folios (CAF) ─────────────────────────────────────────────────────────────

const cafOpen = ref(false)
const cafArchivo = ref<File | null>(null)
const cafError = ref<string | null>(null)
const cafSubiendo = ref(false)

watch(cafOpen, (open) => {
  if (open) return
  cafArchivo.value = null
  cafError.value = null
})

async function subirCaf() {
  const file = cafArchivo.value
  if (!file) {
    cafError.value = 'Elige el archivo de folios (.xml) que descargaste del SII'
    return
  }
  if (file.size > MAX_BYTES_CAF) {
    cafError.value = 'El archivo es demasiado grande para ser un archivo de folios'
    return
  }
  cafSubiendo.value = true
  cafError.value = null
  try {
    await useApiFetch(`${apiUrl}/dte/cafs`, {
      method: 'POST',
      body: { xmlBase64: await archivoABase64(file) },
    })
    cafOpen.value = false
    if (await cargar()) toast.add({ title: 'Folios cargados', color: 'success' })
  }
  catch (e: unknown) {
    cafError.value = apiErrorMsg(e, 'No se pudieron cargar los folios')
  }
  finally {
    cafSubiendo.value = false
  }
}

const borrarOpen = ref(false)
const borrarCaf = ref<CafPerfil | null>(null)
const borrando = ref(false)

function pedirBorrar(caf: CafPerfil) {
  borrarCaf.value = caf
  borrarOpen.value = true
}

async function confirmarBorrar() {
  const caf = borrarCaf.value
  if (!caf) return
  borrando.value = true
  try {
    await useApiFetch(`${apiUrl}/dte/cafs/${caf.id}`, { method: 'DELETE' })
    borrarOpen.value = false
    if (await cargar()) toast.add({ title: 'Folios borrados', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'No se pudieron borrar los folios'), color: 'error' })
    borrarOpen.value = false
  }
  finally {
    borrando.value = false
  }
}

const avisosCertificado = computed(() =>
  (perfil.value?.avisos ?? []).filter(a => a.codigo === 'CERTIFICADO_POR_VENCER'),
)
const avisosFolios = computed(() =>
  (perfil.value?.avisos ?? []).filter(a => a.codigo === 'POCOS_FOLIOS'),
)

/** Un CAF de otro ambiente no sirve para emitir en el que está elegido. */
function otroAmbiente(caf: CafPerfil): boolean {
  const ambiente = perfil.value?.emisor?.ambiente
  return !!ambiente && caf.ambiente !== ambiente
}

const columns: TableColumn<CafPerfil>[] = [
  { id: 'tipo', header: 'Tipo' },
  { id: 'rango', header: 'Rango' },
  { accessorKey: 'usados', header: 'Usados' },
  { accessorKey: 'restantes', header: 'Restantes' },
  { id: 'ambiente', header: 'Ambiente' },
  { id: 'autorizacion', header: 'Autorizado' },
  { id: 'acciones', header: '', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

onMounted(cargar)
</script>

<template>
  <div class="space-y-6 max-w-4xl">
    <CrudPageHeader
      title="Boleta electrónica"
      description="Lo que el SII pide para que tu empresa pueda emitir boletas: sus datos, el certificado digital y los folios."
    />

    <div
      v-if="cargando"
      class="py-8 text-center text-sm text-muted"
    >
      Cargando…
    </div>

    <template v-else-if="perfil">
      <UAlert
        v-if="perfil.faltantes.length"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Para emitir boletas falta:"
        data-qa="faltantes"
      >
        <template #description>
          <ul class="list-disc pl-5 space-y-1">
            <li v-for="f in perfil.faltantes" :key="f.codigo + f.mensaje">
              {{ f.mensaje }}
            </li>
          </ul>
        </template>
      </UAlert>
      <UAlert
        v-else
        color="success"
        variant="subtle"
        icon="i-lucide-circle-check"
        title="Lista para emitir"
        data-qa="lista"
      />

      <UCard>
        <template #header>
          <h3 class="font-semibold text-default">
            Empresa que emite
          </h3>
        </template>

        <div v-if="!perfil.emisor" class="space-y-3">
          <p class="text-sm text-muted">
            Marca una razón social como preferida: es la empresa que emite las boletas.
          </p>
          <UButton
            to="/configuracion/razones-sociales"
            color="neutral"
            variant="outline"
            icon="i-lucide-file-text"
          >
            Ir a Razones sociales
          </UButton>
        </div>

        <UForm
          v-else
          :state="form"
          class="space-y-4"
          @submit="guardar"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0 text-sm">
              <p class="font-medium text-default truncate">
                {{ perfil.emisor.nombre }}
              </p>
              <p class="text-muted">
                RUT: {{ perfil.emisor.rut }}
              </p>
              <p class="text-muted truncate">
                {{ perfil.emisor.direccion || 'Sin dirección' }}
              </p>
            </div>
            <UButton
              to="/configuracion/razones-sociales"
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-square-pen"
            >
              Cambiar en Razones sociales
            </UButton>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="Giro" help="La actividad de la empresa, como figura en el SII.">
              <UInput v-model="form.giro" class="w-full" placeholder="Venta de alimentos" />
            </UFormField>
            <UFormField label="Comuna">
              <UInput v-model="form.comuna" class="w-full" placeholder="Providencia" />
            </UFormField>
            <UFormField label="Ambiente" help="Certificación es para pruebas con el SII; producción emite boletas de verdad.">
              <USelect
                v-model="form.ambiente"
                :items="ambienteItems"
                class="w-full"
                placeholder="Elegir ambiente"
              />
            </UFormField>
            <UFormField label="Fecha de la resolución del SII">
              <AppDateInput v-model="form.fechaResolucion" qa="fecha-resolucion" />
            </UFormField>
            <UFormField label="Número de la resolución" help="En certificación es 0.">
              <!-- `type="number"` entrega un number (o '' si se vacía), no el texto: se guarda
                   siempre como texto, que es lo que el `v-model` declara. -->
              <UInput
                :model-value="form.numeroResolucion"
                type="number"
                min="0"
                class="w-full"
                placeholder="0"
                @update:model-value="(v: string | number | undefined) => { form.numeroResolucion = String(v ?? '') }"
              />
            </UFormField>
          </div>

          <div class="flex justify-end">
            <UButton
              type="submit"
              :loading="guardando"
            >
              Guardar cambios
            </UButton>
          </div>
        </UForm>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-4">
            <h3 class="font-semibold text-default">
              Certificado digital
            </h3>
            <UButton
              icon="i-lucide-upload"
              :disabled="!perfil.emisor"
              @click="() => { certOpen = true }"
            >
              Subir certificado
            </UButton>
          </div>
        </template>

        <div class="space-y-3">
          <UAlert
            v-for="a in avisosCertificado"
            :key="a.codigo"
            color="warning"
            variant="subtle"
            icon="i-lucide-clock-alert"
            :title="a.mensaje"
          />
          <dl v-if="perfil.certificado" class="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt class="text-muted">
                Firmante
              </dt>
              <dd class="text-default">
                {{ perfil.certificado.nombreFirmante }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                RUT del firmante
              </dt>
              <dd class="text-default">
                {{ perfil.certificado.rutFirmante }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Vence el
              </dt>
              <dd class="text-default">
                {{ formatoFecha(perfil.certificado.venceEl) }}
              </dd>
            </div>
          </dl>
          <p v-else class="text-sm text-muted">
            {{ perfil.emisor ? 'Todavía no hay un certificado cargado.' : 'Primero marca la razón social que emite.' }}
          </p>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-4">
            <h3 class="font-semibold text-default">
              Folios (CAF)
            </h3>
            <UButton
              icon="i-lucide-upload"
              :disabled="!perfil.emisor"
              @click="() => { cafOpen = true }"
            >
              Subir CAF
            </UButton>
          </div>
        </template>

        <div class="space-y-3">
          <UAlert
            v-for="a in avisosFolios"
            :key="a.mensaje"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="a.mensaje"
          />
          <UTable :data="perfil.cafs" :columns="columns">
            <template #tipo-cell="{ row }">
              {{ etiquetaTipoBoleta(row.original.tipo) }}
            </template>
            <template #rango-cell="{ row }">
              {{ row.original.desde }} – {{ row.original.hasta }}
            </template>
            <template #ambiente-cell="{ row }">
              <div class="flex items-center gap-2">
                <span>{{ etiquetaAmbiente(row.original.ambiente) }}</span>
                <UBadge
                  v-if="otroAmbiente(row.original)"
                  color="warning"
                  variant="subtle"
                  size="sm"
                >
                  otro ambiente
                </UBadge>
              </div>
            </template>
            <template #autorizacion-cell="{ row }">
              {{ formatoFecha(row.original.fechaAutorizacion) }}
            </template>
            <template #acciones-cell="{ row }">
              <UButton
                v-if="row.original.borrable"
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                aria-label="Borrar"
                @click="pedirBorrar(row.original)"
              >
                Borrar
              </UButton>
            </template>
            <template #empty>
              <div class="py-6 text-center text-sm text-muted">
                No hay folios cargados.
              </div>
            </template>
          </UTable>
        </div>
      </UCard>
    </template>

    <UModal v-model:open="certOpen" title="Subir certificado digital" :ui="shellUi.modal">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Archivo del certificado" help="Un archivo .pfx o .p12.">
            <UInput
              type="file"
              accept=".pfx,.p12"
              class="w-full"
              data-qa="archivo-certificado"
              @change="certArchivo = elegirArchivo($event)"
            />
          </UFormField>
          <UFormField label="Clave del certificado">
            <UInput
              v-model="certClave"
              type="password"
              autocomplete="off"
              class="w-full"
            />
          </UFormField>
          <UAlert
            v-if="certError"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="certError"
            data-qa="error-certificado"
          />
        </div>
      </template>
      <template #footer>
        <AppModalFooter>
          <UButton color="neutral" variant="ghost" @click="() => { certOpen = false }">
            Cancelar
          </UButton>
          <UButton :loading="certSubiendo" @click="subirCertificado">
            Subir
          </UButton>
        </AppModalFooter>
      </template>
    </UModal>

    <UModal v-model:open="cafOpen" title="Subir folios (CAF)" :ui="shellUi.modal">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Archivo de folios" help="El archivo .xml que descargaste del SII.">
            <UInput
              type="file"
              accept=".xml"
              class="w-full"
              data-qa="archivo-caf"
              @change="cafArchivo = elegirArchivo($event)"
            />
          </UFormField>
          <UAlert
            v-if="cafError"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="cafError"
            data-qa="error-caf"
          />
        </div>
      </template>
      <template #footer>
        <AppModalFooter>
          <UButton color="neutral" variant="ghost" @click="() => { cafOpen = false }">
            Cancelar
          </UButton>
          <UButton :loading="cafSubiendo" @click="subirCaf">
            Subir
          </UButton>
        </AppModalFooter>
      </template>
    </UModal>

    <CrudModal
      v-model:open="borrarOpen"
      title="Borrar folios"
      :message="borrarCaf
        ? `¿Borrar los folios ${borrarCaf.desde} a ${borrarCaf.hasta} de ${etiquetaTipoBoleta(borrarCaf.tipo)}? Todavía no se usó ninguno; si los necesitas, vuelve a subir el archivo.`
        : ''"
      confirm-label="Borrar"
      :loading="borrando"
      @confirm="confirmarBorrar"
    />
  </div>
</template>
