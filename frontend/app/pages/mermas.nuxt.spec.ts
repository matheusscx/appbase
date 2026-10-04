// @vitest-environment nuxt
//
// Frente de bodegas y traslados: la merma pasa a decir DÓNDE ocurrió. Lo que
// este spec fija:
//   1. Con una sola ubicación (solo local) el selector no se dibuja, y el
//      cliente completa `ubicacionId` con el local igual.
//   2. Con una bodega, el selector se dibuja y lo que el usuario elige viaja
//      en el body de `POST /mermas`.
//   3. Cambiar de ubicación con la cantidad ya tipeada la limpia — mismo
//      criterio que el ajuste de costo con la unidad/el producto.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Mermas from './mermas.vue'

const LOCAL = { id: 'local-1', nombre: 'Local', tipo: 'local', activo: true }
const BODEGA = { id: 'bodega-1', nombre: 'Bodega centro', tipo: 'bodega', activo: true }

const HARINA = {
  id: 'item-harina',
  nombre: 'Harina',
  costoActual: '1500.0000',
  unidadMedida: 'kg',
  modoInventario: 'cantidad',
}
const CELULAR = {
  id: 'item-celular',
  nombre: 'Celular X',
  costoActual: '90000.0000',
  unidadMedida: 'unidad',
  modoInventario: 'serie',
}
const MOTIVO = { id: 'motivo-1', nombre: 'Vencimiento', esDevolucion: false }
/** La causa fija de la nota de crédito: se filtra por ella, no se registra a mano. */
const DEVOLUCION = { id: 'motivo-devolucion', nombre: 'Devolución', esDevolucion: true }

/** Ubicaciones que devuelve `GET /ubicaciones` en cada test. */
let ubicacionesBackend: typeof LOCAL[] = [LOCAL]
let mermasEnviadas: Record<string, unknown>[] = []
/** Filas que devuelve `GET /mermas` (el listado) — Task 4: el badge de
 *  anulación en mesa se prueba montando filas con `deAnulacion` en true y
 *  en false. */
let mermasListado: Record<string, unknown>[] = []
/** Última URL con la que se pidieron los motivos — Task 4: tiene que llevar
 *  `tipo=merma` además del `soloActivas=true` de siempre; el filtro de
 *  pantalla no alcanza (el servidor es el que manda), pero sin esto
 *  "Cortesía de la casa" aparecería en el selector de Mermas. */
let motivosUrlSolicitada = ''
/** Con esto en `true`, pedir los motivos de la comida del personal falla. */
let motivosPersonalFallan = false
/** Task 5: corte del día de negocio que devuelve `GET /tenants/me` — 0 por
 *  defecto (sin corte, la `DiaNegocioNota` no se dibuja). */
let horaCorteBackend = 0
/** Cada `GET /mermas` que se pidió, para afirmar el filtro de producto. */
let mermasUrls: string[] = []
/** Cada `GET /items?...` (búsqueda del selector). */
let busquedasItems: string[] = []

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return true },
    can: () => true,
  })
})

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    if (typeof url !== 'string') return Promise.resolve({ data: [], meta: {} })
    if (url.includes('/ubicaciones')) return Promise.resolve(ubicacionesBackend)
    if (url.includes('/tenants/me')) {
      return Promise.resolve({ horaCorte: horaCorteBackend, diaNegocioHoy: '2026-09-18' })
    }
    if (opts?.method === 'POST' && url.includes('/mermas')) {
      mermasEnviadas.push({ ...(opts.body ?? {}) })
      return Promise.resolve({
        costoPerdido: '100.0000',
        motivoBajaNombre: MOTIVO.nombre,
        merma: { id: 'mov-1', itemId: HARINA.id, cantidad: '1', costoUnitario: '100', costoPerdido: '100.0000', motivoBajaId: MOTIVO.id, motivoBajaNombre: MOTIVO.nombre, comentario: null, creadoEl: new Date().toISOString(), usuarioNombre: null, unidadMedida: 'kg', monedaId: 'clp-1', itemEliminado: false },
      })
    }
    if (url.includes('/mermas') && opts?.method !== 'POST') {
      mermasUrls.push(url)
      return Promise.resolve({
        data: mermasListado,
        meta: { page: 1, pageSize: 15, total: mermasListado.length, totalPages: 1 },
      })
    }
    // `ids=` (resolver los elegidos) y búsqueda (el selector con búsqueda en el servidor).
    if (url.includes('/items?ids=')) {
      return Promise.resolve({ data: [HARINA, CELULAR], meta: { page: 1, pageSize: 100, total: 2, totalPages: 1 } })
    }
    if (url.includes('/items?')) {
      busquedasItems.push(url)
      return Promise.resolve({ data: [HARINA, CELULAR], meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 } })
    }
    if (url.includes('/motivos-baja')) {
      motivosUrlSolicitada = url
      if (motivosPersonalFallan && url.includes('tipo=consumo_personal')) {
        return Promise.reject(new Error('sin red'))
      }
      return Promise.resolve([MOTIVO, DEVOLUCION])
    }
    // `useUnidadesMedidaStore.ensureLoaded()` espera un ARRAY, no el shape
    // paginado del catch-all de abajo — sin esto `unidades.value.find` revienta.
    if (url.includes('/catalog/unidades-medida')) return Promise.resolve([])
    return Promise.resolve({ data: [], meta: { page: 1, pageSize: 15, total: 0, totalPages: 0 } })
  }
})

async function montar() {
  const wrapper = await mountSuspended(Mermas, {
    attachTo: document.body,
    global: {
      stubs: {
        AppDrawer: {
          name: 'AppDrawer',
          props: ['open'],
          template: `
            <div v-if="open" role="dialog">
              <slot name="header" />
              <slot name="body" />
              <slot name="actions" />
            </div>
          `,
        },
      },
    },
  })
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof montar>>

/**
 * La página tiene DOS selects de motivo con las mismas opciones: el filtro del listado
 * (que suma "todos") y el del formulario del drawer. Sin `sinValor: 'todos'`
 * el `.find()` se queda con el PRIMERO —el filtro— y el test termina
 * emitiendo sobre el select equivocado: `form.itemId` nunca se completa, el
 * guard de `registrar()` corta en silencio (el toast no se ve: no hay
 * `<UNotifications>` montado en este test aislado) y no sale ningún POST.
 */
function selectConOpcion(wrapper: Wrapper, valor: string, sinValor?: string) {
  const select = wrapper.findAllComponents({ name: 'USelectMenu' }).find((s) => {
    const items = (s.props('items') ?? []) as { value: string }[]
    if (!Array.isArray(items)) return false
    if (sinValor && items.some(i => i?.value === sinValor)) return false
    return items.some(i => i?.value === valor)
  })
  expect(select, `USelectMenu con la opción "${valor}" (sin "${sinValor}")`).toBeTruthy()
  return select!
}

/** Los dos `AppItemSelect`: el de filtro (con `clear`) y el del formulario. Su `USelectMenu` no trae
 * opciones hasta abrirse, así que se identifican por la prop y no por las opciones. */
function selectorProducto(w: Wrapper, deFiltro: boolean) {
  const sel = w.findAllComponents({ name: 'AppItemSelect' }).find(c => c.props('clear') === deFiltro)
  expect(sel, deFiltro ? 'selector de filtro' : 'selector del formulario').toBeTruthy()
  return sel!.findComponent({ name: 'USelectMenu' })
}

/** Elige el producto del formulario como el usuario: abre el menú (la búsqueda llena el caché) y emite. */
async function elegirProducto(w: Wrapper, id: string) {
  const menu = selectorProducto(w, false)
  menu.vm.$emit('update:open', true)
  await new Promise(r => setTimeout(r, 20))
  menu.vm.$emit('update:modelValue', id)
  await new Promise(r => setTimeout(r, 20))
}
const selectMotivo = (w: Wrapper) => selectConOpcion(w, MOTIVO.id, 'todos')

async function emitir(comp: ReturnType<typeof selectConOpcion>, valor: string) {
  comp.vm.$emit('update:modelValue', valor)
  await new Promise(r => setTimeout(r, 20))
}

async function abrirDrawer(wrapper: Wrapper) {
  const boton = wrapper.findAll('button').find(b => b.text().includes('Registrar merma'))
  expect(boton, 'botón "Registrar merma"').toBeTruthy()
  await boton!.trigger('click')
  await new Promise(r => setTimeout(r, 20))
}

async function enviar(wrapper: Wrapper) {
  const boton = wrapper.findAllComponents({ name: 'UButton' })
    .find(b => b.text().trim() === 'Registrar' && b.props('type') === 'submit')
  expect(boton, 'botón submit del drawer').toBeTruthy()
  await boton!.trigger('click')
  await new Promise(r => setTimeout(r, 250))
}

describe('mermas — selector de ubicación', () => {
  beforeEach(() => {
    mermasEnviadas = []
    mermasUrls = []
    busquedasItems = []
    motivosUrlSolicitada = ''
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
  })

  it('con una sola ubicación, el selector NO se dibuja y el body manda el local igual', async () => {
    ubicacionesBackend = [LOCAL]
    const wrapper = await montar()
    await abrirDrawer(wrapper)

    // Sin bodegas, ningún USelectMenu ofrece la opción del local como
    // "ubicación a elegir" — el único lugar donde live el id del local es en
    // el body, completado por el cliente.
    const conUbicacion = wrapper.findAllComponents({ name: 'USelectMenu' }).find((s) => {
      const items = (s.props('items') ?? []) as { value: string }[]
      return Array.isArray(items) && items.some(i => i?.value === LOCAL.id)
    })
    expect(conUbicacion).toBeUndefined()

    await elegirProducto(wrapper, HARINA.id)
    await wrapper.find('input[inputmode="decimal"]').setValue('2')
    await emitir(selectMotivo(wrapper), MOTIVO.id)
    await enviar(wrapper)

    expect(mermasEnviadas).toHaveLength(1)
    expect(mermasEnviadas[0]).toMatchObject({ ubicacionId: LOCAL.id, itemId: HARINA.id })
    wrapper.unmount()
  })

  it('con una bodega, el selector se dibuja y lo elegido viaja en el body', async () => {
    ubicacionesBackend = [LOCAL, BODEGA]
    const wrapper = await montar()
    await abrirDrawer(wrapper)

    await emitir(selectConOpcion(wrapper, BODEGA.id), BODEGA.id)
    await elegirProducto(wrapper, HARINA.id)
    await wrapper.find('input[inputmode="decimal"]').setValue('3')
    await emitir(selectMotivo(wrapper), MOTIVO.id)
    await enviar(wrapper)

    expect(mermasEnviadas).toHaveLength(1)
    expect(mermasEnviadas[0]).toMatchObject({ ubicacionId: BODEGA.id })
    wrapper.unmount()
  })

  it('cambiar de ubicación con la cantidad ya tipeada la limpia', async () => {
    ubicacionesBackend = [LOCAL, BODEGA]
    const wrapper = await montar()
    await abrirDrawer(wrapper)

    await emitir(selectConOpcion(wrapper, LOCAL.id), LOCAL.id)
    const cantidadInput = wrapper.find('input[inputmode="decimal"]')
    await cantidadInput.setValue('7')
    expect((wrapper.find('input[inputmode="decimal"]').element as HTMLInputElement).value).toBe('7')

    await emitir(selectConOpcion(wrapper, BODEGA.id), BODEGA.id)

    // Si sobreviviera, sería una cantidad tipeada mirando el stock del local
    // aplicada como si fuera de la bodega — un número que nadie tecleó ahí.
    expect((wrapper.find('input[inputmode="decimal"]').element as HTMLInputElement).value).toBe('')
    wrapper.unmount()
  })
})

// El backend rechaza la merma de un producto con serie (400): la pantalla lo avisa al
// elegirlo y no deja registrar, en vez de dejar que el usuario descubra el error al enviar.
describe('mermas — producto con número de serie', () => {
  beforeEach(() => {
    mermasEnviadas = []
    mermasUrls = []
    busquedasItems = []
    motivosUrlSolicitada = ''
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
  })

  const botonRegistrar = (w: Wrapper) => w.findAllComponents({ name: 'UButton' })
    .find(b => b.text().trim() === 'Registrar' && b.props('type') === 'submit')!

  const AVISO = 'tiene número de serie: dalo de baja desde Ajuste de stock, eligiendo la unidad'

  it('al elegirlo, avisa nombrándolo y deshabilita Registrar', async () => {
    ubicacionesBackend = [LOCAL]
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    expect(wrapper.text()).not.toContain(AVISO)
    expect(botonRegistrar(wrapper).props('disabled')).toBeFalsy()

    await elegirProducto(wrapper, CELULAR.id)

    expect(wrapper.text()).toContain(`«${CELULAR.nombre}» ${AVISO}`)
    expect(botonRegistrar(wrapper).props('disabled')).toBe(true)
    wrapper.unmount()
  })

  it('no registra aunque el resto del formulario esté completo', async () => {
    ubicacionesBackend = [LOCAL]
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    await elegirProducto(wrapper, CELULAR.id)
    await wrapper.find('input[inputmode="decimal"]').setValue('1')
    await emitir(selectMotivo(wrapper), MOTIVO.id)
    await enviar(wrapper)

    expect(mermasEnviadas).toHaveLength(0)
    wrapper.unmount()
  })

  it('enviar el formulario por el submit (Enter) tampoco registra, sin depender del botón deshabilitado', async () => {
    ubicacionesBackend = [LOCAL]
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    await elegirProducto(wrapper, CELULAR.id)
    await wrapper.find('input[inputmode="decimal"]').setValue('1')
    await emitir(selectMotivo(wrapper), MOTIVO.id)

    await wrapper.find('form#merma-form').trigger('submit')
    await new Promise(r => setTimeout(r, 250))

    expect(mermasEnviadas).toHaveLength(0)
    wrapper.unmount()
  })

  it('volver a un producto sin serie quita el aviso y habilita Registrar', async () => {
    ubicacionesBackend = [LOCAL]
    const wrapper = await montar()
    await abrirDrawer(wrapper)
    await elegirProducto(wrapper, CELULAR.id)
    await elegirProducto(wrapper, HARINA.id)

    expect(wrapper.text()).not.toContain(AVISO)
    expect(botonRegistrar(wrapper).props('disabled')).toBeFalsy()
    wrapper.unmount()
  })
})

// El filtro de producto: vacío = todos (con `clear`), no una opción "Todos" con un valor inventado.
describe('mermas — filtro de producto', () => {
  beforeEach(() => {
    mermasEnviadas = []
    mermasUrls = []
    busquedasItems = []
    motivosUrlSolicitada = ''
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
  })

  it('vacío no manda itemId; elegir uno lo manda; limpiar vuelve a no mandarlo', async () => {
    ubicacionesBackend = [LOCAL]
    const wrapper = await montar()
    await new Promise(r => setTimeout(r, 50))
    expect(mermasUrls.length).toBeGreaterThan(0)
    expect(mermasUrls.every(u => !u.includes('itemId'))).toBe(true)

    const filtro = selectorProducto(wrapper, true)
    filtro.vm.$emit('update:open', true)
    await new Promise(r => setTimeout(r, 20))
    expect(busquedasItems).toHaveLength(1)
    const params = new URL(busquedasItems[0]!, 'http://x').searchParams
    expect(params.get('tipo')).toBe('producto,ingrediente')
    expect(params.has('activo')).toBe(false)

    mermasUrls = []
    filtro.vm.$emit('update:modelValue', HARINA.id)
    await new Promise(r => setTimeout(r, 60))
    expect(mermasUrls.some(u => u.includes(`itemId=${HARINA.id}`))).toBe(true)

    mermasUrls = []
    filtro.vm.$emit('update:modelValue', null)
    await new Promise(r => setTimeout(r, 60))
    expect(mermasUrls.length).toBeGreaterThan(0)
    expect(mermasUrls.every(u => !u.includes('itemId'))).toBe(true)
    wrapper.unmount()
  })
})

// Task 4: Mermas solo ofrece motivos de tipo `merma` (§4.4 del design). El
// filtro de pantalla no reemplaza el 400 del servidor, pero sin él
// "Cortesía de la casa" aparecería en este selector.
describe('mermas — filtro de motivos', () => {
  beforeEach(() => {
    mermasEnviadas = []
    mermasUrls = []
    busquedasItems = []
    motivosUrlSolicitada = ''
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
  })

  it('la URL que carga los motivos incluye tipo=merma y soloActivas=true', async () => {
    ubicacionesBackend = [LOCAL]
    const wrapper = await montar()

    expect(motivosUrlSolicitada).toContain('tipo=merma')
    expect(motivosUrlSolicitada).toContain('soloActivas=true')

    wrapper.unmount()
  })

  it('"Devolución" se puede filtrar pero no registrar a mano: la deja la nota de crédito', async () => {
    ubicacionesBackend = [LOCAL]
    const wrapper = await montar()
    // El filtro del listado (con "todos") la ofrece.
    expect(selectConOpcion(wrapper, DEVOLUCION.id).exists()).toBe(true)

    await abrirDrawer(wrapper)
    const delFormulario = selectMotivo(wrapper)
    const valores = (delFormulario.props('items') as { value: string }[]).map(i => i.value)
    expect(valores).toContain(MOTIVO.id)
    expect(valores).not.toContain(DEVOLUCION.id)
    wrapper.unmount()
  })
})

// Task 4 (spec § 5.2): `deAnulacion` nace de anular un plato en mesa
// (`cuenta_linea_anulacion_id IS NOT NULL`). El badge "Anulación en mesa"
// hace visible que ese plato quemado también está en el reporte de
// Anulaciones — tiene que aparecer solo en la fila con `deAnulacion: true`.
describe('mermas — badge de anulación en mesa', () => {
  const filaConAnulacion = {
    id: 'mov-anulacion',
    itemId: HARINA.id,
    itemNombre: 'Harina',
    cantidad: '1.0000',
    costoUnitario: '100.0000',
    costoPerdido: '100.0000',
    motivoBajaId: MOTIVO.id,
    motivoBajaNombre: 'Motivo con anulación',
    comentario: null,
    creadoEl: new Date().toISOString(),
    usuarioNombre: null,
    unidadMedida: 'kg',
    monedaId: 'clp-1',
    itemEliminado: false,
    deAnulacion: true,
  }
  const filaSinAnulacion = {
    ...filaConAnulacion,
    id: 'mov-bodega',
    motivoBajaNombre: 'Motivo sin anulación',
    deAnulacion: false,
  }

  beforeEach(() => {
    ubicacionesBackend = [LOCAL]
    mermasListado = [filaConAnulacion, filaSinAnulacion]
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
  })

  it('el badge "Anulación en mesa" aparece solo en la fila con deAnulacion:true', async () => {
    const wrapper = await montar()

    const filas = wrapper.findAll('tbody tr')
    expect(filas).toHaveLength(2)

    const conAnulacion = filas.find(f => f.text().includes('Motivo con anulación'))
    const sinAnulacion = filas.find(f => f.text().includes('Motivo sin anulación'))
    expect(conAnulacion, 'fila con deAnulacion:true').toBeTruthy()
    expect(sinAnulacion, 'fila con deAnulacion:false').toBeTruthy()

    expect(conAnulacion!.text()).toContain('Anulación en mesa')
    expect(sinAnulacion!.text()).not.toContain('Anulación en mesa')

    wrapper.unmount()
  })
})

// Task 5: la nota del día de negocio, debajo de la fila de filtros de fecha.
describe('mermas — nota del día de negocio', () => {
  beforeEach(() => {
    ubicacionesBackend = [LOCAL]
    mermasListado = []
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
  })

  it('con corte configurado, muestra "Tu día va de HH:00 a HH:00"', async () => {
    horaCorteBackend = 5
    const wrapper = await montar()

    expect(wrapper.text()).toContain('Tu día va de 05:00 a 05:00')
    wrapper.unmount()
  })

  it('sin corte (0), no muestra la nota', async () => {
    horaCorteBackend = 0
    const wrapper = await montar()

    expect(wrapper.text()).not.toContain('Tu día va de')
    wrapper.unmount()
  })
})

// Spec 2026-10-04-comida-del-personal § 3.3 (owner, "Mesa y Mermas"): la comida
// del personal se registra acá para el producto suelto, pero se ve aparte. La
// vista decide el `?tipo=` del listado, qué motivos pide al servidor, los
// textos y que el costo no se llame pérdida.
describe('mermas — vista de comida del personal', () => {
  beforeEach(() => {
    ubicacionesBackend = [LOCAL]
    mermasListado = [{
      id: 'mov-personal',
      itemId: HARINA.id,
      itemNombre: HARINA.nombre,
      cantidad: '1.0000',
      costoUnitario: '1500.0000',
      costoPerdido: '1500.0000',
      motivoBajaId: 'motivo-personal',
      motivoBajaNombre: 'Comida del personal (dentro del local)',
      comentario: null,
      creadoEl: new Date().toISOString(),
      usuarioNombre: null,
      unidadMedida: 'kg',
      monedaId: 'clp-1',
      itemEliminado: false,
      deAnulacion: false,
    }]
    mermasUrls = []
    motivosUrlSolicitada = ''
    motivosPersonalFallan = false
    document.body.querySelectorAll('[role="dialog"]').forEach(n => n.remove())
  })

  // Revisión independiente (H1): el servidor acepta los dos tipos, así que un
  // motivo de merma ofrecido en la vista de personal se registraría como merma
  // y se pintaría en la lista equivocada.
  it('si fallan los motivos de la otra vista, no quedan ofrecidos los de la anterior', async () => {
    motivosPersonalFallan = true
    const wrapper = await montar()
    // El filtro del listado ofrece el motivo de merma al arrancar.
    expect(selectConOpcion(wrapper, MOTIVO.id).exists()).toBe(true)

    wrapper.findComponent({ name: 'UTabs' }).vm.$emit('update:modelValue', 'consumo_personal')
    await new Promise(r => setTimeout(r, 50))

    const ofreceVencimiento = wrapper.findAllComponents({ name: 'USelectMenu' }).some(s =>
      ((s.props('items') ?? []) as { value: string }[]).some?.(i => i?.value === MOTIVO.id))
    expect(ofreceVencimiento).toBe(false)
    wrapper.unmount()
  })

  it('arranca en Mermas: pide tipo=merma al listado y a los motivos', async () => {
    const wrapper = await montar()

    expect(mermasUrls.at(-1)).toContain('tipo=merma')
    expect(motivosUrlSolicitada).toContain('tipo=merma')
    expect(wrapper.text()).toContain('Costo perdido')
    wrapper.unmount()
  })

  it('al cambiar a Comida del personal pide su tipo, cambia los textos y el costo deja de ser pérdida', async () => {
    const wrapper = await montar()

    wrapper.findComponent({ name: 'UTabs' }).vm.$emit('update:modelValue', 'consumo_personal')
    await new Promise(r => setTimeout(r, 50))

    expect(mermasUrls.at(-1)).toContain('tipo=consumo_personal')
    expect(motivosUrlSolicitada).toContain('tipo=consumo_personal')
    expect(wrapper.text()).toContain('Registrar comida del personal')
    expect(wrapper.text()).not.toContain('Costo perdido')
    // La celda del costo existe y no se pinta como pérdida.
    const celdaCosto = wrapper.findAll('td span.font-medium')
    expect(celdaCosto.length).toBeGreaterThan(0)
    expect(celdaCosto.every(c => !c.classes().includes('text-error'))).toBe(true)

    const boton = wrapper.findAll('button').find(b => b.text().includes('Registrar comida del personal'))
    await boton!.trigger('click')
    await new Promise(r => setTimeout(r, 20))
    expect(document.body.textContent).toContain('Si se lo lleva, o si lo consume el dueño, regístralo como cortesía')
    wrapper.unmount()
  })
})
