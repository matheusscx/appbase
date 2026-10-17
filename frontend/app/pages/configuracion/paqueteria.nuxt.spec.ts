// @vitest-environment nuxt
//
// Configuración de Paquetería: las dos tablas de tarifas, la de envío (lo que se cobra) y la de
// pago al repartidor, con el mismo CRUD (crear, editar, marcar por defecto, desactivar, eliminar,
// y que el 400 del backend quede a la vista), y el aviso mientras falta una tarifa por defecto.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Paqueteria from './paqueteria.vue'

interface Llamada { url: string, method: string, body?: Record<string, unknown> }
interface Tarifa { id: string, nombre: string, monto: string, esDefecto: boolean, activa: boolean }

let llamadas: Llamada[] = []
let listas: Record<'pago' | 'envio', Tarifa[]> = { pago: [], envio: [] }
// Mensaje con el que el backend rechaza el próximo PATCH/DELETE de una tarifa.
let rechazo: string | null = null

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    const method = opts?.method ?? 'GET'
    llamadas.push({ url, method, body: opts?.body })
    const clave = url.includes('/tarifas-envio') ? 'envio' : 'pago'
    if (method !== 'GET' && rechazo) return Promise.reject({ data: { message: rechazo } })
    if (method === 'POST') {
      const nueva = { id: 't-nueva', esDefecto: false, activa: true, ...opts!.body } as Tarifa
      listas[clave] = [...listas[clave], nueva]
      return Promise.resolve(nueva)
    }
    if (method === 'PATCH') {
      const id = url.split('/').pop()
      listas[clave] = listas[clave].map(t => t.id === id ? { ...t, ...opts!.body } : t)
      return Promise.resolve(listas[clave].find(t => t.id === id))
    }
    if (method === 'DELETE') {
      const id = url.split('/').pop()
      listas[clave] = listas[clave].filter(t => t.id !== id)
      return Promise.resolve(undefined)
    }
    return Promise.resolve(listas[clave].map(t => ({ ...t })))
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
  const wrapper = await mountSuspended(Paqueteria, {
    attachTo: document.body,
    global: { stubs: { AppDrawer: AppDrawerStub } },
  })
  useMonedasStore().hydrate([{
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
  }], 'tenant-1')
  await esperar(30)
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof montar>>

async function emitir(comp: { vm: { $emit: (e: string, v: unknown) => void } }, valor: unknown) {
  comp.vm.$emit('update:modelValue', valor)
  await esperar(0)
}

const escrituras = () => llamadas.filter(l => l.method !== 'GET')

beforeEach(() => {
  document.body.innerHTML = ''
  llamadas = []
  rechazo = null
  listas = {
    pago: [
      { id: 't-auto', nombre: 'Auto', monto: '1900', esDefecto: true, activa: true },
      { id: 't-moto', nombre: 'Moto', monto: '1000', esDefecto: false, activa: true },
    ],
    envio: [
      { id: 'e-est', nombre: 'Estándar', monto: '3000', esDefecto: true, activa: true },
      { id: 'e-pri', nombre: 'Prioritario', monto: '5000', esDefecto: false, activa: true },
    ],
  }
})

describe('configuracion/paqueteria: aviso de configuración', () => {
  it('sin tarifa de envío por defecto avisa que no se puede escanear', async () => {
    listas.envio = []
    const wrapper = await montar()

    expect(wrapper.text()).toContain('Hasta que haya una tarifa de envío y una tarifa de pago por defecto')

    wrapper.unmount()
  })

  it('sin tarifa de pago por defecto también avisa', async () => {
    listas.pago = []
    const wrapper = await montar()

    expect(wrapper.find('[data-qa="paqueteria-sin-configurar"]').exists()).toBe(true)

    wrapper.unmount()
  })

  it('con las dos por defecto no muestra el aviso, y ya no hay formulario de precio', async () => {
    const wrapper = await montar()

    expect(wrapper.find('[data-qa="paqueteria-sin-configurar"]').exists()).toBe(false)
    expect(wrapper.find('[data-qa="paqueteria-precio-envio"]').exists()).toBe(false)
    expect(llamadas.some(l => l.url.includes('/paquetes/configuracion'))).toBe(false)

    wrapper.unmount()
  })

  it('la tabla de envío va arriba de la de pago', async () => {
    const wrapper = await montar()

    const texto = wrapper.text()
    expect(texto.indexOf('Tarifas de envío')).toBeGreaterThan(-1)
    expect(texto.indexOf('Tarifas de envío')).toBeLessThan(texto.indexOf('Tarifas de pago'))

    wrapper.unmount()
  })
})

const casos = [
  {
    nombre: 'envío', clave: 'envio' as const, ruta: 'tarifas-envio', qa: 'tarifa-envio', formId: 'tarifa-envio-form',
    placeholder: 'Estándar', defecto: 'Estándar', otra: 'Prioritario', otraId: 'e-pri', defectoId: 'e-est',
    montoOtra: '5000', montoNuevo: '8000',
  },
  {
    nombre: 'pago', clave: 'pago' as const, ruta: 'tarifas-pago', qa: 'tarifa', formId: 'tarifa-form',
    placeholder: 'Moto', defecto: 'Auto', otra: 'Moto', otraId: 't-moto', defectoId: 't-auto',
    montoOtra: '1000', montoNuevo: '2500',
  },
]

describe.each(casos)('configuracion/paqueteria: tarifas de $nombre', (c) => {
  const abrirNueva = async (w: Wrapper) => {
    await w.find(`[data-qa="${c.qa}-nueva"]`).trigger('click')
    await esperar()
  }
  const enviarTarifa = async (w: Wrapper) => {
    await w.find(`form#${c.formId}`).trigger('submit')
    await esperar(40)
  }
  const monto = (w: Wrapper) => w.findComponent({ name: 'MoneyInput' })
  const urlLista = new RegExp(`/${c.ruta}$`)
  const urlFila = new RegExp(`/${c.ruta}/${c.otraId}$`)

  it('lista las tarifas con su monto y marca la por defecto', async () => {
    const wrapper = await montar()

    expect(wrapper.text()).toContain(c.defecto)
    expect(wrapper.text()).toContain(c.otra)
    expect(wrapper.find(`[data-qa="${c.qa}-defecto-${c.defecto}"]`).exists()).toBe(true)
    expect(wrapper.find(`[data-qa="${c.qa}-defecto-${c.otra}"]`).exists()).toBe(false)

    wrapper.unmount()
  })

  it('crear manda { nombre, monto } recortado y vuelve a pedir la lista', async () => {
    const wrapper = await montar()
    await abrirNueva(wrapper)

    const guardar = () => wrapper.findAll('button').find(b => b.text() === 'Crear')!
    expect(guardar().attributes('disabled')).toBeDefined()
    await wrapper.find(`input[placeholder="${c.placeholder}"]`).setValue('  Colina ')
    await emitir(monto(wrapper), c.montoNuevo)
    expect(guardar().attributes('disabled')).toBeUndefined()
    await enviarTarifa(wrapper)

    const post = llamadas.find(l => l.method === 'POST')
    expect(post?.url).toMatch(urlLista)
    expect(post?.body).toEqual({ nombre: 'Colina', monto: c.montoNuevo })
    expect(wrapper.text()).toContain('Colina')

    wrapper.unmount()
  })

  it('editar precarga la fila y manda PATCH con nombre y monto', async () => {
    const wrapper = await montar()

    await wrapper.find(`[aria-label="Editar ${c.otra}"]`).trigger('click')
    await esperar()
    expect((wrapper.find(`input[placeholder="${c.placeholder}"]`).element as HTMLInputElement).value).toBe(c.otra)
    expect(monto(wrapper).props('modelValue')).toBe(c.montoOtra)
    await emitir(monto(wrapper), '1200')
    await enviarTarifa(wrapper)

    const patch = llamadas.find(l => l.method === 'PATCH')
    expect(patch?.url).toMatch(urlFila)
    expect(patch?.body).toEqual({ nombre: c.otra, monto: '1200' })

    wrapper.unmount()
  })

  it('«Hacer por defecto» manda { esDefecto: true } y la marca se muda', async () => {
    const wrapper = await montar()

    expect(wrapper.find(`[data-qa="${c.qa}-hacer-defecto-${c.defecto}"]`).exists()).toBe(false)
    await wrapper.find(`[data-qa="${c.qa}-hacer-defecto-${c.otra}"]`).trigger('click')
    await esperar(40)

    const patch = llamadas.find(l => l.method === 'PATCH')
    expect(patch?.url).toMatch(urlFila)
    expect(patch?.body).toEqual({ esDefecto: true })
    // El mock del backend no quita la marca a la anterior: la pantalla pide la lista de nuevo.
    expect(llamadas.filter(l => l.method === 'GET' && urlLista.test(l.url)).length).toBeGreaterThan(1)

    wrapper.unmount()
  })

  it('el interruptor desactiva con { activa: false } y reactiva con { activa: true }', async () => {
    const wrapper = await montar()
    const boton = () => wrapper.find(`button[aria-label="Activa: ${c.otra}"]`)

    await boton().trigger('click')
    await esperar(40)
    expect(boton().attributes('aria-checked')).toBe('false')
    await boton().trigger('click')
    await esperar(40)

    expect(escrituras().map(l => l.body)).toEqual([{ activa: false }, { activa: true }])

    wrapper.unmount()
  })

  it('desactivar la por defecto: el 400 del backend queda a la vista y la tarifa sigue activa', async () => {
    rechazo = 'La tarifa por defecto no se puede desactivar: elige otra primero.'
    const wrapper = await montar()

    await wrapper.find(`button[aria-label="Activa: ${c.defecto}"]`).trigger('click')
    await esperar(40)

    expect(wrapper.find(`[data-qa="${c.qa}-error"]`).text()).toContain(rechazo)
    expect(wrapper.find(`button[aria-label="Activa: ${c.defecto}"]`).attributes('aria-checked')).toBe('true')

    wrapper.unmount()
  })

  it('eliminar una tarifa en uso deja el modal abierto con el motivo del backend', async () => {
    rechazo = 'La tarifa está en uso: desactívala en vez de eliminarla.'
    const wrapper = await montar()

    await wrapper.find(`[aria-label="Eliminar ${c.otra}"]`).trigger('click')
    await esperar(30)
    const confirmar = [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Eliminar')!
    confirmar.click()
    await esperar(40)

    expect(document.body.querySelector(`[data-qa="${c.qa}-error-eliminar"]`)?.textContent).toContain(rechazo)
    expect(wrapper.text()).toContain(c.otra)

    wrapper.unmount()
  })

  it('eliminar una tarifa libre manda DELETE y la saca de la lista', async () => {
    const wrapper = await montar()

    await wrapper.find(`[aria-label="Eliminar ${c.otra}"]`).trigger('click')
    await esperar(30)
    ;[...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Eliminar')!.click()
    await esperar(40)

    const del = llamadas.find(l => l.method === 'DELETE')
    expect(del?.url).toMatch(urlFila)
    expect(wrapper.find(`[aria-label="Editar ${c.otra}"]`).exists()).toBe(false)

    wrapper.unmount()
  })
})
