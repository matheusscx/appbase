// @vitest-environment nuxt
//
// Paquetes: el listado paginado con sus filtros (qué parámetros viajan en la URL), la selección
// para asignar (solo los disponibles), el modal de asignar (qué viaja en el POST y con qué fecha) y
// el drawer de alta/edición (montos vacíos sin valores por defecto, `null` al vaciar, montos
// intocables cuando el paquete ya se rindió).
//
// El mock de `useApiFetch` contesta lo que se le pida, así que cada caso afirma la URL y el body
// de la llamada: un test que solo mira la pantalla pasaría aunque la página no mandara nada.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Paquetes from './index.vue'
import { hoyLocal } from '~/composables/useVigenciaRegla'
import type { PaqueteFila } from '~/types/paqueteria'

const CLP = {
  monedaId: 'clp-1',
  nombre: 'Peso chileno',
  codigoIso: 'CLP',
  simbolo: '$',
  decimales: 0,
  separadorDecimal: ',',
  separadorMiles: '.',
  locale: 'es-CL',
  habilitada: true,
  esOficial: true,
  valorDelDia: null,
}

function paquete(parcial: Partial<PaqueteFila> & { id: string, codigo: string }): PaqueteFila {
  return {
    destinatarioNombre: 'María González',
    destinatarioTelefono: null,
    direccion: 'Av. Los Leones 1234',
    comuna: 'Providencia',
    nota: null,
    remitenteTerceroId: null,
    remitenteNombre: null,
    cobroEnDestino: false,
    precioEnvio: '2500',
    pagoRepartidor: '1000',
    estado: 'disponible',
    hojaRutaId: null,
    repartidorNombre: null,
    bloqueado: false,
    ...parcial,
  }
}

type Llamada = { url: string, method: string, body?: Record<string, unknown> }

let llamadas: Llamada[] = []
let paquetesBackend: PaqueteFila[] = []
let configuracion = { configurada: true, precioEnvioDefecto: '2500', pagoRepartidorDefecto: '1000' }
let diaNegocio: { horaCorte: number, diaNegocioHoy: string } | null = null
let falloAsignar: string | null = null
let falloDelete: string | null = null

const repartidoresBackend = [
  { id: 'r-1', nombre: 'Juan Pérez', telefono: null, activo: true },
  { id: 'r-2', nombre: 'Ana Soto', telefono: null, activo: false },
  { id: 'r-3', nombre: 'Beto Rojas', telefono: null, activo: true },
]

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    const method = opts?.method ?? 'GET'
    llamadas.push({ url, method, body: opts?.body })
    if (url.includes('/paquetes/configuracion')) return Promise.resolve({ ...configuracion })
    if (url.includes('/tenants/me')) {
      return diaNegocio ? Promise.resolve(diaNegocio) : Promise.reject(new Error('sin red'))
    }
    if (url.includes('/repartidores')) return Promise.resolve(repartidoresBackend.map(r => ({ ...r })))
    if (url.includes('/terceros')) {
      return Promise.resolve([
        { id: 't-1', nombre: 'Tienda Sur', nombreLegal: null, activo: true },
        { id: 't-2', nombre: 'Tienda Cerrada', nombreLegal: null, activo: false },
      ])
    }
    if (url.includes('/hojas-ruta/asignar')) {
      if (falloAsignar) return Promise.reject({ data: { message: falloAsignar } })
      return Promise.resolve({ id: 'h-1', lineas: [] })
    }
    if (method === 'POST' && url.includes('/paquetes')) {
      return Promise.resolve(paquete({ id: 'p-nuevo', codigo: String(opts!.body!.codigo) }))
    }
    if (method === 'PATCH') {
      const id = url.split('/').pop()
      const base = paquetesBackend.find(p => p.id === id)!
      return Promise.resolve({ ...base, ...opts!.body })
    }
    if (method === 'DELETE') {
      if (falloDelete) return Promise.reject({ data: { message: falloDelete } })
      const id = url.split('/').pop()
      paquetesBackend = paquetesBackend.filter(p => p.id !== id)
      return Promise.resolve(undefined)
    }
    if (url.includes('/paquetes')) {
      return Promise.resolve({
        data: paquetesBackend.map(p => ({ ...p })),
        meta: { page: 1, pageSize: 15, total: paquetesBackend.length, totalPages: 1 },
      })
    }
    return Promise.resolve([])
  }
})

const AppDrawerStub = {
  name: 'AppDrawer',
  props: ['open'],
  template: `
    <div v-if="open" role="dialog">
      <slot name="header" />
      <slot name="body" />
      <slot name="actions" />
    </div>
  `,
}

async function esperar(ms = 20) {
  await new Promise(r => setTimeout(r, ms))
}

async function montar() {
  const wrapper = await mountSuspended(Paquetes, {
    attachTo: document.body,
    global: { stubs: { AppDrawer: AppDrawerStub } },
  })
  useMonedasStore().hydrate([CLP], 'tenant-1')
  await esperar(30)
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof montar>>

const getsPaquetes = () => llamadas.filter(l =>
  l.method === 'GET' && /\/paquetes\?/.test(l.url),
)
const ultimoGet = () => new URL(getsPaquetes().at(-1)!.url, 'http://x').searchParams

const checkbox = (w: Wrapper, codigo: string) => w.find(`button[aria-label="Seleccionar ${codigo}"]`)
const botonAsignar = (w: Wrapper) => w.find('[data-qa="paquetes-asignar"]')

function selectConOpcion(w: Wrapper, valor: string) {
  const select = w.findAllComponents({ name: 'USelectMenu' }).find((s) => {
    const items = (s.props('items') ?? []) as { value: string }[]
    return Array.isArray(items) && items.some(i => i?.value === valor)
  })
  expect(select, `USelectMenu con la opción "${valor}"`).toBeTruthy()
  return select!
}

async function emitir(comp: { vm: { $emit: (e: string, v: unknown) => void } }, valor: unknown) {
  comp.vm.$emit('update:modelValue', valor)
  await esperar(0)
}

async function abrirModalAsignar(w: Wrapper) {
  await checkbox(w, 'PQ-1').trigger('click')
  await checkbox(w, 'PQ-2').trigger('click')
  await botonAsignar(w).trigger('click')
  await esperar(30)
}

const botonConfirmar = () =>
  document.body.querySelector<HTMLButtonElement>('[data-qa="paquetes-asignar-confirmar"]')!

beforeEach(() => {
  document.body.innerHTML = ''
  llamadas = []
  paquetesBackend = [
    paquete({ id: 'p-1', codigo: 'PQ-1' }),
    paquete({ id: 'p-2', codigo: 'PQ-2', destinatarioNombre: null, direccion: null }),
    paquete({ id: 'p-3', codigo: 'PQ-3', estado: 'en_ruta', repartidorNombre: 'Juan Pérez' }),
    paquete({ id: 'p-4', codigo: 'PQ-4', estado: 'entregado', bloqueado: true, cobroEnDestino: true }),
  ]
  configuracion = { configurada: true, precioEnvioDefecto: '2500', pagoRepartidorDefecto: '1000' }
  diaNegocio = { horaCorte: 3, diaNegocioHoy: '2026-10-14' }
  falloAsignar = null
  falloDelete = null
})

describe('paquetes: listado y filtros', () => {
  it('pide la primera página sin filtros y pinta las filas con su estado y el aviso de por completar', async () => {
    const wrapper = await montar()

    const params = ultimoGet()
    expect(params.get('page')).toBe('1')
    expect(params.has('estado')).toBe(false)
    expect(params.has('cobroEnDestino')).toBe(false)
    expect(params.has('porCompletar')).toBe(false)
    expect(params.has('q')).toBe(false)

    const texto = wrapper.text()
    expect(texto).toContain('PQ-1')
    expect(texto).toContain('Disponible')
    expect(texto).toContain('En ruta')
    expect(texto).toContain('Juan Pérez')
    expect(texto).toContain('Entregado')
    // Solo PQ-2 (sin destinatario ni dirección) lleva el aviso.
    expect(wrapper.findAll('[class*="warning"]').filter(b => b.text() === 'Por completar')).toHaveLength(1)

    wrapper.unmount()
  })

  it('cada filtro manda su parámetro y volver a "todos" lo quita', async () => {
    const wrapper = await montar()

    await emitir(selectConOpcion(wrapper, 'en_ruta'), 'en_ruta')
    await esperar(30)
    expect(ultimoGet().get('estado')).toBe('en_ruta')

    await emitir(selectConOpcion(wrapper, 'si'), 'si')
    await esperar(30)
    expect(ultimoGet().get('cobroEnDestino')).toBe('true')
    await emitir(selectConOpcion(wrapper, 'no'), 'no')
    await esperar(30)
    expect(ultimoGet().get('cobroEnDestino')).toBe('false')

    await wrapper.find('[data-qa="paquetes-filtro-por-completar"]').trigger('click')
    await esperar(30)
    expect(ultimoGet().get('porCompletar')).toBe('true')

    await emitir(selectConOpcion(wrapper, 'en_ruta'), 'todos')
    await esperar(30)
    expect(ultimoGet().has('estado')).toBe(false)
    // Los otros dos siguen vigentes.
    expect(ultimoGet().get('cobroEnDestino')).toBe('false')
    expect(ultimoGet().get('porCompletar')).toBe('true')

    wrapper.unmount()
  })

  it('la búsqueda espera a que se deje de tipear y manda `q` recortado', async () => {
    const wrapper = await montar()
    const antes = getsPaquetes().length

    await wrapper.find('[data-qa="paquetes-buscar"]').setValue(' PQ-2 ')
    await esperar(100)
    expect(getsPaquetes()).toHaveLength(antes)

    await esperar(300)
    expect(getsPaquetes()).toHaveLength(antes + 1)
    expect(ultimoGet().get('q')).toBe('PQ-2')

    wrapper.unmount()
  })

  it('solo los disponibles tienen el botón de eliminar', async () => {
    const wrapper = await montar()

    // Disponibles: PQ-1 y PQ-2.
    expect(wrapper.findAll('[title="Eliminar"]')).toHaveLength(2)

    wrapper.unmount()
  })

  it('eliminar manda DELETE al paquete y vuelve a pedir la lista; el 400 queda a la vista en el modal', async () => {
    const wrapper = await montar()
    falloDelete = 'El paquete PQ-1 ya salió en una hoja de ruta: no se puede eliminar.'

    await wrapper.findAll('[title="Eliminar"]')[0]!.trigger('click')
    await esperar()
    const confirmar = () => [...document.body.querySelectorAll('button')]
      .find(b => b.textContent?.trim() === 'Eliminar')!
    confirmar().click()
    await esperar(50)

    expect(llamadas.find(l => l.method === 'DELETE')?.url).toMatch(/\/paquetes\/p-1$/)
    expect(document.body.textContent).toContain(falloDelete)

    falloDelete = null
    const getsAntes = getsPaquetes().length
    confirmar().click()
    await esperar(50)

    expect(getsPaquetes().length).toBe(getsAntes + 1)
    expect(wrapper.text()).not.toContain('PQ-1')

    wrapper.unmount()
  })
})

describe('paquetes: asignar a repartidor', () => {
  it('sin tildar nada el botón está deshabilitado; con dos disponibles se habilita', async () => {
    const wrapper = await montar()
    expect(botonAsignar(wrapper).attributes('disabled')).toBeDefined()

    await checkbox(wrapper, 'PQ-1').trigger('click')
    await checkbox(wrapper, 'PQ-2').trigger('click')

    expect(botonAsignar(wrapper).attributes('disabled')).toBeUndefined()
    expect(botonAsignar(wrapper).text()).toContain('(2)')

    wrapper.unmount()
  })

  it('un paquete en ruta o entregado no se puede tildar', async () => {
    const wrapper = await montar()

    expect(checkbox(wrapper, 'PQ-3').attributes('disabled')).toBeDefined()
    expect(checkbox(wrapper, 'PQ-4').attributes('disabled')).toBeDefined()
    await checkbox(wrapper, 'PQ-3').trigger('click')
    await checkbox(wrapper, 'PQ-4').trigger('click')

    expect(botonAsignar(wrapper).attributes('disabled')).toBeDefined()

    wrapper.unmount()
  })

  it('el selector de repartidor solo ofrece los activos', async () => {
    const wrapper = await montar()
    await abrirModalAsignar(wrapper)

    const select = selectConOpcion(wrapper, 'r-1')
    const items = select.props('items') as { label: string, value: string }[]
    expect(items.map(i => i.label)).toEqual(['Juan Pérez', 'Beto Rojas'])

    wrapper.unmount()
  })

  it('manda POST /hojas-ruta/asignar con repartidor, el día de negocio y los ids; después recarga la lista', async () => {
    const wrapper = await montar()
    await abrirModalAsignar(wrapper)

    // La fecha por defecto es el día de negocio del servidor (con corte, distinto del calendario).
    expect(wrapper.findComponent({ name: 'AppDateInput' }).props('modelValue')).toBe('2026-10-14')
    // El botón espera al repartidor.
    expect(botonConfirmar().disabled).toBe(true)
    await emitir(selectConOpcion(wrapper, 'r-1'), 'r-1')
    expect(document.body.textContent).toContain('Vas a asignar 2 paquetes a Juan Pérez para el 14-10')

    // El backend deja de ver esos dos como disponibles.
    paquetesBackend = paquetesBackend.map(p => ['p-1', 'p-2'].includes(p.id) ? { ...p, estado: 'en_ruta' } : p)
    const getsAntes = getsPaquetes().length
    botonConfirmar().click()
    await esperar(50)

    const post = llamadas.find(l => l.method === 'POST' && l.url.includes('/hojas-ruta/asignar'))
    expect(post?.body).toEqual({
      repartidorId: 'r-1',
      fecha: '2026-10-14',
      paqueteIds: ['p-1', 'p-2'],
    })
    expect(getsPaquetes().length).toBe(getsAntes + 1)
    // Con la lista nueva ya no queda nada tildado.
    expect(botonAsignar(wrapper).attributes('disabled')).toBeDefined()

    wrapper.unmount()
  })

  it('si el día de negocio no cargó, la fecha por defecto es la de hoy del calendario', async () => {
    diaNegocio = null
    const wrapper = await montar()
    await abrirModalAsignar(wrapper)

    expect(wrapper.findComponent({ name: 'AppDateInput' }).props('modelValue')).toBe(hoyLocal())
    await emitir(selectConOpcion(wrapper, 'r-3'), 'r-3')
    botonConfirmar().click()
    await esperar(50)

    const post = llamadas.find(l => l.method === 'POST' && l.url.includes('/hojas-ruta/asignar'))
    expect(post?.body).toEqual({ repartidorId: 'r-3', fecha: hoyLocal(), paqueteIds: ['p-1', 'p-2'] })

    wrapper.unmount()
  })

  it('si el backend rechaza, el motivo queda en el modal y la lista se vuelve a pedir', async () => {
    falloAsignar = 'No se asignó ninguno: PQ-2 ya no está disponible.'
    const wrapper = await montar()
    await abrirModalAsignar(wrapper)
    await emitir(selectConOpcion(wrapper, 'r-1'), 'r-1')
    const getsAntes = getsPaquetes().length

    botonConfirmar().click()
    await esperar(50)

    expect(document.body.textContent).toContain(falloAsignar)
    expect(getsPaquetes().length).toBe(getsAntes + 1)

    wrapper.unmount()
  })
})

describe('paquetes: alta y edición', () => {
  const montos = (w: Wrapper) => w.findAllComponents({ name: 'MoneyInput' })

  async function abrirNuevo(w: Wrapper) {
    await w.find('[data-qa="paquetes-nuevo"]').trigger('click')
    await esperar()
  }

  const enviar = async (w: Wrapper) => {
    await w.find('form#paquete-form').trigger('submit')
    await esperar(40)
  }

  it('sin valores por defecto, Nuevo paquete abre el drawer con el aviso y los montos vacíos, y no deja crear sin ellos', async () => {
    configuracion = { configurada: false, precioEnvioDefecto: '0', pagoRepartidorDefecto: '0' }
    const wrapper = await montar()

    await abrirNuevo(wrapper)

    expect(wrapper.find('[data-qa="paquete-sin-configurar"]').exists()).toBe(true)
    expect(montos(wrapper).map(m => m.props('modelValue'))).toEqual(['', ''])
    const crear = () => wrapper.findAll('button').find(b => b.text() === 'Crear')!
    await wrapper.find('input[placeholder="Lo que lee la pistola"]').setValue('PQ-9')
    expect(crear().attributes('disabled')).toBeDefined()

    await emitir(montos(wrapper)[0]!, '3000')
    await emitir(montos(wrapper)[1]!, '1200')
    expect(crear().attributes('disabled')).toBeUndefined()
    await enviar(wrapper)

    const post = llamadas.find(l => l.method === 'POST' && /\/paquetes$/.test(l.url))
    // Sin nulos ni cadenas vacías: lo que no se completó no viaja.
    expect(post?.body).toEqual({
      codigo: 'PQ-9',
      cobroEnDestino: false,
      precioEnvio: '3000',
      pagoRepartidor: '1200',
    })

    wrapper.unmount()
  })

  it('con valores por defecto, el alta los trae precargados y sin aviso', async () => {
    const wrapper = await montar()

    await abrirNuevo(wrapper)

    expect(wrapper.find('[data-qa="paquete-sin-configurar"]').exists()).toBe(false)
    expect(montos(wrapper).map(m => m.props('modelValue'))).toEqual(['2500', '1000'])

    await wrapper.find('input[placeholder="Lo que lee la pistola"]').setValue(' PQ-10 ')
    await wrapper.find('input[placeholder="María González"]').setValue(' Pedro ')
    await enviar(wrapper)

    const post = llamadas.find(l => l.method === 'POST' && /\/paquetes$/.test(l.url))
    expect(post?.body).toEqual({
      codigo: 'PQ-10',
      destinatarioNombre: 'Pedro',
      cobroEnDestino: false,
      precioEnvio: '2500',
      pagoRepartidor: '1000',
    })

    wrapper.unmount()
  })

  it('el remitente ofrece solo terceros activos', async () => {
    const wrapper = await montar()
    await abrirNuevo(wrapper)

    const select = selectConOpcion(wrapper, 't-1')
    expect((select.props('items') as { value: string }[]).map(i => i.value)).toEqual(['t-1'])

    wrapper.unmount()
  })

  it('vaciar un campo opcional al editar manda `null`, no una cadena vacía', async () => {
    const wrapper = await montar()
    const getsAntes = getsPaquetes().length

    await wrapper.findAll('[title="Editar"]')[0]!.trigger('click')
    await esperar()
    expect((wrapper.find('input[placeholder="Av. Los Leones 1234, depto 5"]').element as HTMLInputElement).value)
      .toBe('Av. Los Leones 1234')
    await wrapper.find('input[placeholder="Av. Los Leones 1234, depto 5"]').setValue('')
    await enviar(wrapper)

    const patch = llamadas.find(l => l.method === 'PATCH')
    expect(patch?.url).toMatch(/\/paquetes\/p-1$/)
    expect(patch?.body).toEqual({
      codigo: 'PQ-1',
      destinatarioNombre: 'María González',
      destinatarioTelefono: null,
      direccion: null,
      comuna: 'Providencia',
      nota: null,
      cobroEnDestino: false,
      precioEnvio: '2500',
      pagoRepartidor: '1000',
    })
    // La respuesta se mergea en la fila: sin segundo GET.
    expect(getsPaquetes()).toHaveLength(getsAntes)

    wrapper.unmount()
  })

  describe('remitente al editar', () => {
    beforeEach(() => {
      // El remitente t-2 se pausó después de crear el paquete: ya no está entre los terceros activos.
      paquetesBackend[0] = paquete({
        id: 'p-1', codigo: 'PQ-1', direccion: null, remitenteTerceroId: 't-2', remitenteNombre: 'Tienda Cerrada',
      })
    })

    it('si no se toca, el remitente no viaja: un remitente pausado no impide completar la dirección', async () => {
      const wrapper = await montar()

      await wrapper.findAll('[title="Editar"]')[0]!.trigger('click')
      await esperar()
      await wrapper.find('input[placeholder="Av. Los Leones 1234, depto 5"]').setValue('Alameda 100')
      await enviar(wrapper)

      const patch = llamadas.find(l => l.method === 'PATCH')
      expect(patch?.url).toMatch(/\/paquetes\/p-1$/)
      expect(patch?.body).toMatchObject({ direccion: 'Alameda 100' })
      expect(patch?.body).not.toHaveProperty('remitenteTerceroId')

      wrapper.unmount()
    })

    it('si se quita, manda `remitenteTerceroId: null`', async () => {
      const wrapper = await montar()

      await wrapper.findAll('[title="Editar"]')[0]!.trigger('click')
      await esperar()
      await emitir(selectConOpcion(wrapper, 't-2'), undefined)
      await enviar(wrapper)

      expect(llamadas.find(l => l.method === 'PATCH')?.body).toHaveProperty('remitenteTerceroId', null)

      wrapper.unmount()
    })

    it('si se elige otro, manda su id', async () => {
      const wrapper = await montar()

      await wrapper.findAll('[title="Editar"]')[0]!.trigger('click')
      await esperar()
      await emitir(selectConOpcion(wrapper, 't-2'), 't-1')
      await enviar(wrapper)

      expect(llamadas.find(l => l.method === 'PATCH')?.body).toHaveProperty('remitenteTerceroId', 't-1')

      wrapper.unmount()
    })
  })

  it('un paquete ya rendido deja los montos y el cobro deshabilitados, avisa y no los manda', async () => {
    const wrapper = await montar()

    await wrapper.findAll('[title="Editar"]')[3]!.trigger('click')
    await esperar()

    expect(wrapper.find('[data-qa="paquete-bloqueado"]').text()).toBe('Ya se rindió: los montos no se pueden cambiar.')
    expect(montos(wrapper).map(m => m.props('disabled'))).toEqual([true, true])
    expect(wrapper.find('button[aria-label="Cobro en destino"]').attributes('disabled')).toBeDefined()

    await wrapper.find('input[placeholder="María González"]').setValue('Pedro')
    await enviar(wrapper)

    const patch = llamadas.find(l => l.method === 'PATCH')
    expect(patch?.url).toMatch(/\/paquetes\/p-4$/)
    expect(patch?.body).toMatchObject({ destinatarioNombre: 'Pedro' })
    expect(patch?.body).not.toHaveProperty('precioEnvio')
    expect(patch?.body).not.toHaveProperty('pagoRepartidor')
    expect(patch?.body).not.toHaveProperty('cobroEnDestino')

    wrapper.unmount()
  })
})
