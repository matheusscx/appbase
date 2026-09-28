<script setup lang="ts">
import type { DocumentoDte, LecturaDteRespuesta } from '~/composables/useDte'
import { bodyLectura, leerDte, mensajeCompraExistente } from '~/composables/useDte'

/**
 * "Cargar desde la factura (XML)" (spec compras-xml-dte § 6): elegir el
 * archivo, resolver el documento (y cuál, si el envío trae varios) y el
 * proveedor, y frenar en los bloqueos de § 3.1 antes de pre-llenar nada. El
 * lector (bytes → documento) es puro en `useDte.ts`; acá solo se cablea con
 * `POST /compras/dte/lectura`, que resuelve receptor/tipo/folio/proveedor
 * (nunca se decide acá: el servidor tiene el catálogo del tenant).
 */

interface ProveedorOpt { id: string, nombre: string, rut: string | null }

const props = defineProps<{
  proveedores: ProveedorOpt[]
}>()

const emit = defineEmits<{
  cargar: [{ documento: DocumentoDte, lectura: LecturaDteRespuesta, proveedorId: string, rutProveedor: string | null }]
}>()

const open = defineModel<boolean>('open', { required: true })

const { public: { apiUrl } } = useRuntimeConfig()
const { formatFecha } = useFormatters()

type Paso = 'archivo' | 'documentos' | 'proveedor' | 'bloqueado'

const paso = ref<Paso>('archivo')
const errorArchivo = ref<string | null>(null)
const leyendo = ref(false)

const documentos = ref<DocumentoDte[]>([])
const documentoElegido = ref<DocumentoDte | null>(null)

const candidatosProveedor = ref<{ id: string, nombre: string }[]>([])
const sinCoincidenciaRut = ref(false)

const bloqueoMensaje = ref<string | null>(null)
const compraExistenteId = ref<string | null>(null)

const opcionesProveedor = computed(() => {
  const lista = candidatosProveedor.value.length ? candidatosProveedor.value : props.proveedores
  return lista.map(p => ({ label: p.nombre, value: p.id }))
})

watch(open, (v) => {
  if (v) reset()
})

function reset() {
  paso.value = 'archivo'
  errorArchivo.value = null
  leyendo.value = false
  documentos.value = []
  documentoElegido.value = null
  candidatosProveedor.value = []
  sinCoincidenciaRut.value = false
  bloqueoMensaje.value = null
  compraExistenteId.value = null
}

const NOTA_CREDITO_DEBITO = new Set(['56', '61'])

async function onArchivo(valor: File | File[] | null | undefined) {
  const file = Array.isArray(valor) ? (valor[0] ?? null) : (valor ?? null)
  errorArchivo.value = null
  if (!file) return
  leyendo.value = true
  try {
    const bytes = await file.arrayBuffer()
    const resultado = leerDte(bytes)
    if (!resultado.ok) {
      errorArchivo.value = resultado.error
      return
    }
    if (resultado.documentos.length > 1) {
      documentos.value = resultado.documentos
      paso.value = 'documentos'
      return
    }
    await elegirDocumento(resultado.documentos[0]!)
  } finally {
    leyendo.value = false
  }
}

async function elegirDocumento(doc: DocumentoDte) {
  documentoElegido.value = doc
  await leer()
}

/** `proveedorIdElegido` presente = se llamó después de que el encargado eligió
 *  a mano (§ 3.1): distingue el `rutProveedor` del emit y evita volver a
 *  preguntar si esta segunda vuelta también sale ambigua (no debería). */
async function leer(proveedorIdElegido?: string) {
  const doc = documentoElegido.value
  if (!doc) return
  leyendo.value = true
  bloqueoMensaje.value = null
  try {
    const respuesta = await useApiFetch<LecturaDteRespuesta>(
      `${apiUrl}/compras/dte/lectura`,
      { method: 'POST', body: bodyLectura(doc, proveedorIdElegido) },
    )
    procesar(doc, respuesta, proveedorIdElegido)
  } catch (e: unknown) {
    // El 400 de "otro RUT" (y cualquier otro rechazo de la lectura) se
    // muestra tal cual (spec § 7).
    bloqueoMensaje.value = apiErrorMsg(e, 'Error al leer la factura')
    paso.value = 'bloqueado'
  } finally {
    leyendo.value = false
  }
}

function bloquear(mensaje: string) {
  bloqueoMensaje.value = mensaje
  paso.value = 'bloqueado'
}

function procesar(doc: DocumentoDte, respuesta: LecturaDteRespuesta, proveedorIdElegido?: string) {
  if (!respuesta.receptorEsDelTenant) {
    bloquear(`Esta factura es para el RUT ${doc.receptorRut}, que no es una razón social de tu empresa`)
    return
  }
  if (!respuesta.tipoDocumento) {
    bloquear(
      NOTA_CREDITO_DEBITO.has(doc.tipoDte)
        ? 'Las notas de crédito y débito no se cargan acá'
        : 'Este tipo de documento no se carga como compra',
    )
    return
  }
  if (respuesta.compraExistente) {
    compraExistenteId.value = respuesta.compraExistente.id
    bloquear(mensajeCompraExistente(respuesta.compraExistente, formatFecha))
    return
  }
  // Ya se llamó con un proveedor elegido a mano: si llegó hasta acá, quedó
  // resuelto (el backend ya validó el RUT contra ese proveedor).
  if (proveedorIdElegido) {
    emitirCarga(doc, respuesta, proveedorIdElegido, doc.emisorRut)
    return
  }
  if (respuesta.proveedor) {
    emitirCarga(doc, respuesta, respuesta.proveedor.id, null)
    return
  }
  candidatosProveedor.value = respuesta.candidatos
  sinCoincidenciaRut.value = respuesta.candidatos.length === 0
  paso.value = 'proveedor'
}

function emitirCarga(
  documento: DocumentoDte,
  lectura: LecturaDteRespuesta,
  proveedorId: string,
  rutProveedor: string | null,
) {
  emit('cargar', { documento, lectura, proveedorId, rutProveedor })
  open.value = false
}

async function onElegirProveedor(id: string) {
  await leer(id)
}

function abrirCompraExistente() {
  if (compraExistenteId.value) navigateTo(`/compras/${compraExistenteId.value}`)
}
</script>

<template>
  <UModal v-model:open="open" title="Cargar desde la factura (XML)">
    <template #body>
      <div class="flex flex-col gap-4" data-qa="cargar-dte-modal">
        <template v-if="paso === 'archivo'">
          <UFormField label="Archivo XML de la factura" :error="errorArchivo ?? undefined">
            <UFileUpload
              accept=".xml,text/xml,application/xml"
              label="Arrastrá o elegí el XML"
              description="Hasta 2 MB"
              data-qa="cargar-dte-archivo"
              @update:model-value="onArchivo"
            />
          </UFormField>
          <p v-if="leyendo" class="text-sm text-muted">
            Leyendo…
          </p>
        </template>

        <template v-else-if="paso === 'documentos'">
          <p class="text-sm text-default">
            El archivo trae varios documentos: elegí cuál cargar.
          </p>
          <ul class="divide-y divide-default">
            <li v-for="(doc, i) in documentos" :key="i">
              <button
                type="button"
                class="w-full text-left py-2 text-sm text-default"
                :data-qa="`cargar-dte-documento-${i}`"
                @click="elegirDocumento(doc)"
              >
                {{ doc.tipoDte }} N° {{ doc.folio }} · {{ doc.emisorRazonSocial }}
              </button>
            </li>
          </ul>
        </template>

        <template v-else-if="paso === 'proveedor'">
          <p v-if="sinCoincidenciaRut" class="text-sm text-muted" data-qa="cargar-dte-sin-rut">
            No encontramos el RUT {{ documentoElegido?.emisorRut }}. Si el proveedor no existe,
            pedile a quien tenga el módulo Terceros que lo cree
          </p>
          <UFormField label="¿Qué proveedor es?">
            <USelectMenu
              :items="opcionesProveedor"
              value-key="value"
              searchable
              placeholder="Elegí el proveedor"
              class="w-full"
              data-qa="cargar-dte-proveedor"
              @update:model-value="onElegirProveedor"
            />
          </UFormField>
          <p v-if="leyendo" class="text-sm text-muted">
            Leyendo…
          </p>
        </template>

        <template v-else-if="paso === 'bloqueado'">
          <p class="text-sm text-default" data-qa="cargar-dte-bloqueo">
            {{ bloqueoMensaje }}
          </p>
          <UButton
            v-if="compraExistenteId"
            variant="soft"
            color="neutral"
            data-qa="cargar-dte-abrir"
            @click="abrirCompraExistente"
          >
            Abrir
          </UButton>
        </template>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton variant="ghost" color="neutral" @click="() => { open = false }">
          Cancelar
        </UButton>
      </div>
    </template>
  </UModal>
</template>
