// @vitest-environment nuxt
//
// El modal de "Cargar desde la factura (XML)" (spec compras-xml-dte § 6, tarea
// 4 § 6.1). Lo que este spec fija:
//   1. Cada `POST /compras/dte/lectura` manda EXACTAMENTE `bodyLectura(...)`
//      (el mock de `useApiFetch` contesta 200 a cualquier cosa: se afirma el
//      BODY, no la respuesta — spec § 7).
//   2. Los cinco bloqueos (receptor, nota de crédito/débito, tipo desconocido,
//      ya cargada, 400 de "otro RUT") muestran el mensaje exacto y NO emiten
//      `cargar`.
//   3. El proveedor resuelto solo (uno) emite directo; ambiguo/ninguno pide
//      elegir, y ahí `rutProveedor` del emit es `doc.emisorRut`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import CargarDteModal from './CargarDteModal.vue'
import type { LecturaDteRespuesta } from '~/composables/useDte'

const PROVEEDORES = [
  { id: 'prov-1', nombre: 'Distribuidora Andina', rut: '76543210-3' },
  { id: 'prov-2', nombre: 'Otro Proveedor', rut: null },
]

function xmlDte(opts: {
  tipoDte?: string
  folio?: string
  emisorRut?: string
  receptorRut?: string
  nombreItem?: string
} = {}): string {
  const {
    tipoDte = '33', folio = '1', emisorRut = '76543210-3',
    receptorRut = '76123456-7', nombreItem = 'FANTA 350ML CJ12',
  } = opts
  return `<?xml version="1.0" encoding="ISO-8859-1"?>
<DTE version="1.0">
  <Documento ID="F1">
    <Encabezado>
      <IdDoc><TipoDTE>${tipoDte}</TipoDTE><Folio>${folio}</Folio><FchEmis>2026-09-20</FchEmis></IdDoc>
      <Emisor><RUTEmisor>${emisorRut}</RUTEmisor><RznSoc>Distribuidora Andina Ltda</RznSoc></Emisor>
      <Receptor><RUTRecep>${receptorRut}</RUTRecep></Receptor>
    </Encabezado>
    <Detalle>
      <CdgItem><TpoCodigo>INT1</TpoCodigo><VlrCodigo>FA350-12</VlrCodigo></CdgItem>
      <NmbItem>${nombreItem}</NmbItem>
      <QtyItem>1</QtyItem>
      <UnmdItem>CJ</UnmdItem>
      <PrcItem>8800</PrcItem>
      <MontoItem>8800</MontoItem>
    </Detalle>
  </Documento>
</DTE>`
}

function envioConDosDocumentos(): string {
  return `<?xml version="1.0" encoding="ISO-8859-1"?>
<EnvioDTE xmlns="http://www.sii.cl/SiiDte" version="1.0">
  <SetDTE>
    <DTE><Documento ID="F1">
      <Encabezado>
        <IdDoc><TipoDTE>33</TipoDTE><Folio>1</Folio><FchEmis>2026-09-20</FchEmis></IdDoc>
        <Emisor><RUTEmisor>76543210-3</RUTEmisor><RznSoc>Distribuidora Andina Ltda</RznSoc></Emisor>
        <Receptor><RUTRecep>76123456-7</RUTRecep></Receptor>
      </Encabezado>
      <Detalle><NmbItem>FANTA</NmbItem><QtyItem>1</QtyItem><PrcItem>8800</PrcItem><MontoItem>8800</MontoItem></Detalle>
    </Documento></DTE>
    <DTE><Documento ID="F2">
      <Encabezado>
        <IdDoc><TipoDTE>33</TipoDTE><Folio>2</Folio><FchEmis>2026-09-21</FchEmis></IdDoc>
        <Emisor><RUTEmisor>76543210-3</RUTEmisor><RznSoc>Distribuidora Andina Ltda</RznSoc></Emisor>
        <Receptor><RUTRecep>76123456-7</RUTRecep></Receptor>
      </Encabezado>
      <Detalle><NmbItem>SPRITE</NmbItem><QtyItem>1</QtyItem><PrcItem>8800</PrcItem><MontoItem>8800</MontoItem></Detalle>
    </Documento></DTE>
  </SetDTE>
</EnvioDTE>`
}

function archivo(xml: string): File {
  return new File([xml], 'factura.xml', { type: 'text/xml' })
}

let enviados: { url: string, body?: Record<string, unknown> }[] = []
let respuestaLectura: LecturaDteRespuesta | (() => LecturaDteRespuesta) = {
  receptorEsDelTenant: true,
  proveedor: { id: 'prov-1', nombre: 'Distribuidora Andina' },
  candidatos: [],
  tipoDocumento: { id: 'tipo-33', nombre: 'Factura' },
  compraExistente: null,
  asociaciones: [],
}
let lecturaRechaza: { status: number, message: string } | null = null
let navegaciones: string[] = []

mockNuxtImport('navigateTo', () => (to: string) => { navegaciones.push(to) })

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    if (typeof url === 'string' && url.endsWith('/compras/dte/lectura')) {
      enviados.push({ url, body: opts?.body })
      if (lecturaRechaza) {
        const err = new Error('x') as Error & { data?: unknown, status?: number }
        err.data = { message: lecturaRechaza.message }
        err.status = lecturaRechaza.status
        return Promise.reject(err)
      }
      const r = typeof respuestaLectura === 'function' ? respuestaLectura() : respuestaLectura
      return Promise.resolve(r)
    }
    return Promise.resolve([])
  }
})

async function montar() {
  const wrapper = await mountSuspended(CargarDteModal, {
    props: { open: true, proveedores: PROVEEDORES },
    attachTo: document.body,
  })
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof montar>>

async function subir(wrapper: Wrapper, file: File) {
  const upload = wrapper.findComponent({ name: 'UFileUpload' })
  expect(upload.exists(), 'UFileUpload').toBe(true)
  await upload.vm.$emit('update:modelValue', file)
  await new Promise(r => setTimeout(r, 30))
}

/** `UModal` teletransporta el `#body`/`#footer` fuera del wrapper (mismo caso
 *  que el modal de confirmar en `compras-carga.nuxt.spec.ts`): el texto y los
 *  botones se buscan en `document.body`, no en `wrapper`. */
function bodyText(): string {
  return document.body.textContent ?? ''
}

function bodyFind(selector: string): HTMLElement | null {
  return document.body.querySelector(selector)
}

beforeEach(() => {
  document.body.innerHTML = ''
  enviados = []
  lecturaRechaza = null
  navegaciones = []
  respuestaLectura = {
    receptorEsDelTenant: true,
    proveedor: { id: 'prov-1', nombre: 'Distribuidora Andina' },
    candidatos: [],
    tipoDocumento: { id: 'tipo-33', nombre: 'Factura' },
    compraExistente: null,
    asociaciones: [],
  }
})

describe('CargarDteModal — lectura y bloqueos', () => {
  it('con proveedor resuelto (uno): emite cargar con ese proveedorId y rutProveedor null', async () => {
    const wrapper = await montar()
    await subir(wrapper, archivo(xmlDte()))

    expect(enviados).toHaveLength(1)
    expect(enviados[0]!.url).toContain('/compras/dte/lectura')
    expect(enviados[0]!.body).toEqual({
      emisorRut: '76543210-3',
      receptorRut: '76123456-7',
      tipoDte: '33',
      folio: '1',
      claves: ['CODIGO:INT1:FA350-12'],
    })

    const emitido = wrapper.emitted('cargar')
    expect(emitido).toHaveLength(1)
    const payload = emitido![0]![0] as Record<string, unknown>
    expect(payload.proveedorId).toBe('prov-1')
    expect(payload.rutProveedor).toBeNull()
    wrapper.unmount()
  })

  it('receptor de otra empresa: bloquea con el mensaje exacto y no emite', async () => {
    respuestaLectura = { ...respuestaLectura as LecturaDteRespuesta, receptorEsDelTenant: false }
    const wrapper = await montar()
    await subir(wrapper, archivo(xmlDte({ receptorRut: '77.111.222-3' })))

    expect(bodyText()).toContain(
      'Esta factura es para el RUT 77.111.222-3, que no es una razón social de tu empresa',
    )
    expect(wrapper.emitted('cargar')).toBeUndefined()
    wrapper.unmount()
  })

  it('tipo 61 (nota de crédito): "Las notas de crédito y débito no se cargan acá", sin emitir', async () => {
    respuestaLectura = { ...respuestaLectura as LecturaDteRespuesta, tipoDocumento: null }
    const wrapper = await montar()
    await subir(wrapper, archivo(xmlDte({ tipoDte: '61' })))

    expect(bodyText()).toContain('Las notas de crédito y débito no se cargan acá')
    expect(wrapper.emitted('cargar')).toBeUndefined()
    wrapper.unmount()
  })

  it('un tipo sin fila (no es 56/61): "Este tipo de documento no se carga como compra"', async () => {
    respuestaLectura = { ...respuestaLectura as LecturaDteRespuesta, tipoDocumento: null }
    const wrapper = await montar()
    await subir(wrapper, archivo(xmlDte({ tipoDte: '46' })))

    expect(bodyText()).toContain('Este tipo de documento no se carga como compra')
    expect(wrapper.emitted('cargar')).toBeUndefined()
    wrapper.unmount()
  })

  it('folio ya cargado (confirmada): "ya está cargada" con fecha y botón Abrir que navega', async () => {
    respuestaLectura = {
      ...respuestaLectura as LecturaDteRespuesta,
      compraExistente: { id: 'compra-9', estado: 'confirmada', confirmadoEl: '2026-09-22' },
    }
    const wrapper = await montar()
    await subir(wrapper, archivo(xmlDte()))

    expect(bodyText()).toContain('Esta factura ya está cargada (confirmada el')
    expect(wrapper.emitted('cargar')).toBeUndefined()

    ;(bodyFind('[data-qa="cargar-dte-abrir"]') as HTMLButtonElement).click()
    expect(navegaciones).toEqual(['/compras/compra-9'])
    wrapper.unmount()
  })

  it('archivo que no es un DTE: error inline, sin llamar a la API', async () => {
    const wrapper = await montar()
    await subir(wrapper, archivo('<xml>no es un dte</xml>'))

    expect(bodyText()).toContain('Este archivo no es una factura electrónica del SII')
    expect(enviados).toHaveLength(0)
    wrapper.unmount()
  })

  it('un envío con varios documentos: pide elegir cuál, y lee recién al elegir', async () => {
    const wrapper = await montar()
    await subir(wrapper, archivo(envioConDosDocumentos()))

    expect(enviados).toHaveLength(0)
    expect(bodyFind('[data-qa="cargar-dte-documento-1"]')).not.toBeNull()

    ;(bodyFind('[data-qa="cargar-dte-documento-1"]') as HTMLButtonElement).click()
    await new Promise(r => setTimeout(r, 20))

    expect(enviados).toHaveLength(1)
    expect(enviados[0]!.body!.folio).toBe('2')
    wrapper.unmount()
  })
})

describe('CargarDteModal — proveedor ambiguo o ausente', () => {
  it('ningún proveedor calza: lista TODOS, avisa el RUT no encontrado, y al elegir reintenta con proveedorId', async () => {
    respuestaLectura = { ...respuestaLectura as LecturaDteRespuesta, proveedor: null, candidatos: [] }
    const wrapper = await montar()
    await subir(wrapper, archivo(xmlDte({ emisorRut: '11.111.111-1' })))

    expect(enviados).toHaveLength(1) // el primer intento, sin proveedorId
    expect(enviados[0]!.body).not.toHaveProperty('proveedorId')
    expect(bodyFind('[data-qa="cargar-dte-sin-rut"]')!.textContent)
      .toContain('No encontramos el RUT 11.111.111-1. Si el proveedor no existe, pedile a quien tenga el módulo Terceros que lo cree')

    // Segunda vuelta: ya con proveedor resuelto y sin ambigüedad.
    respuestaLectura = { ...respuestaLectura as LecturaDteRespuesta, proveedor: { id: 'prov-2', nombre: 'Otro Proveedor' } }
    const select = wrapper.findComponent({ name: 'USelectMenu' })
    await select.vm.$emit('update:modelValue', 'prov-2')
    await new Promise(r => setTimeout(r, 20))

    expect(enviados).toHaveLength(2)
    expect(enviados[1]!.body).toMatchObject({ proveedorId: 'prov-2' })

    const payload = wrapper.emitted('cargar')![0]![0] as Record<string, unknown>
    expect(payload.proveedorId).toBe('prov-2')
    // Elegido a mano: el RUT del emisor se ofrece para guardar (spec § 5.2).
    expect(payload.rutProveedor).toBe('11.111.111-1')
    wrapper.unmount()
  })

  it('más de un proveedor con el mismo RUT: la lista son los candidatos, no todos', async () => {
    respuestaLectura = {
      ...respuestaLectura as LecturaDteRespuesta,
      proveedor: null,
      candidatos: [{ id: 'prov-1', nombre: 'Distribuidora Andina' }, { id: 'prov-3', nombre: 'Andina Sucursal Sur' }],
    }
    const wrapper = await montar()
    await subir(wrapper, archivo(xmlDte()))

    expect(bodyFind('[data-qa="cargar-dte-sin-rut"]')).toBeNull()
    const select = wrapper.findComponent({ name: 'USelectMenu' })
    const items = (select.props('items') ?? []) as { value: string }[]
    expect(items.map(i => i.value).sort()).toEqual(['prov-1', 'prov-3'])
    wrapper.unmount()
  })

  it('el 400 de "otro RUT" al elegir a mano se muestra tal cual, sin emitir', async () => {
    respuestaLectura = { ...respuestaLectura as LecturaDteRespuesta, proveedor: null, candidatos: [] }
    const wrapper = await montar()
    await subir(wrapper, archivo(xmlDte()))

    lecturaRechaza = { status: 400, message: 'El proveedor tiene otro RUT registrado' }
    const select = wrapper.findComponent({ name: 'USelectMenu' })
    await select.vm.$emit('update:modelValue', 'prov-2')
    await new Promise(r => setTimeout(r, 20))

    expect(bodyText()).toContain('El proveedor tiene otro RUT registrado')
    expect(wrapper.emitted('cargar')).toBeUndefined()
    wrapper.unmount()
  })
})
