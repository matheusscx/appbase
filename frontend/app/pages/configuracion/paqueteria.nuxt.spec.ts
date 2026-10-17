// @vitest-environment nuxt
//
// Configuración de Paquetería: el precio de envío por defecto (el aviso mientras no hay valores y
// el PUT con un solo monto, como string) y las tarifas de pago al repartidor (crear, editar,
// marcar por defecto, desactivar, eliminar, y que el 400 del backend quede a la vista).
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Paqueteria from './paqueteria.vue'

interface Llamada { url: string, method: string, body?: Record<string, unknown> }
interface Tarifa { id: string, nombre: string, monto: string, esDefecto: boolean, activa: boolean }

let llamadas: Llamada[] = []
let configurada = true
let tarifas: Tarifa[] = []
// Mensaje con el que el backend rechaza el próximo PATCH/DELETE de una tarifa.
let rechazo: string | null = null

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    const method = opts?.method ?? 'GET'
    llamadas.push({ url, method, body: opts?.body })
    if (url.includes('/tarifas-pago')) {
      if (method !== 'GET' && rechazo) return Promise.reject({ data: { message: rechazo } })
      if (method === 'POST') {
        const nueva = { id: 't-nueva', esDefecto: false, activa: true, ...opts!.body } as Tarifa
        tarifas = [...tarifas, nueva]
        return Promise.resolve(nueva)
      }
      if (method === 'PATCH') {
        const id = url.split('/').pop()
        tarifas = tarifas.map(t => t.id === id ? { ...t, ...opts!.body } : t)
        return Promise.resolve(tarifas.find(t => t.id === id))
      }
      if (method === 'DELETE') {
        const id = url.split('/').pop()
        tarifas = tarifas.filter(t => t.id !== id)
        return Promise.resolve(undefined)
      }
      return Promise.resolve(tarifas.map(t => ({ ...t })))
    }
    if (method === 'PUT') {
      return Promise.resolve({ configurada: true, ...opts!.body })
    }
    return Promise.resolve({ configurada, precioEnvioDefecto: '1500' })
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

// El de la tarifa es el segundo: el primero es el precio de envío de arriba.
const montoTarifa = (w: Wrapper) => w.findAllComponents({ name: 'MoneyInput' }).at(-1)!
const escrituras = () => llamadas.filter(l => l.method !== 'GET')
const formPrecio = (w: Wrapper) => w.findAll('form').find(f => f.attributes('id') !== 'tarifa-form')!

beforeEach(() => {
  document.body.innerHTML = ''
  llamadas = []
  configurada = true
  rechazo = null
  tarifas = [
    { id: 't-auto', nombre: 'Auto', monto: '1900', esDefecto: true, activa: true },
    { id: 't-moto', nombre: 'Moto', monto: '1000', esDefecto: false, activa: true },
  ]
})

describe('configuracion/paqueteria: precio de envío por defecto', () => {
  it('sin configurar avisa que no se puede escanear, y no lo dice una vez guardada', async () => {
    configurada = false
    const wrapper = await montar()

    expect(wrapper.text()).toContain('Hasta que guardes el precio de envío y haya una tarifa de pago por defecto')

    await formPrecio(wrapper).trigger('submit')
    await esperar()

    expect(llamadas.some(l => l.method === 'PUT')).toBe(true)
    expect(wrapper.text()).not.toContain('Hasta que guardes')

    wrapper.unmount()
  })

  it('ya configurada no muestra el aviso', async () => {
    const wrapper = await montar()

    expect(wrapper.text()).not.toContain('Hasta que guardes')

    wrapper.unmount()
  })

  it('el pago al repartidor ya no se configura acá: el PUT lleva solo el precio, como string', async () => {
    const wrapper = await montar()

    expect(wrapper.find('[data-qa="paqueteria-pago-repartidor"]').exists()).toBe(false)
    await formPrecio(wrapper).trigger('submit')
    await esperar()

    const put = llamadas.find(l => l.method === 'PUT')
    expect(put?.url).toMatch(/\/paquetes\/configuracion$/)
    expect(put?.body).toEqual({ precioEnvioDefecto: '1500' })

    wrapper.unmount()
  })
})

describe('configuracion/paqueteria: tarifas de pago', () => {
  const abrirNueva = async (w: Wrapper) => {
    await w.find('[data-qa="tarifa-nueva"]').trigger('click')
    await esperar()
  }
  const enviarTarifa = async (w: Wrapper) => {
    await w.find('form#tarifa-form').trigger('submit')
    await esperar(40)
  }

  it('lista las tarifas con su monto y marca la por defecto', async () => {
    const wrapper = await montar()

    expect(wrapper.text()).toContain('Auto')
    expect(wrapper.text()).toContain('$1.900')
    expect(wrapper.text()).toContain('$1.000')
    expect(wrapper.find('[data-qa="tarifa-defecto-Auto"]').exists()).toBe(true)
    expect(wrapper.find('[data-qa="tarifa-defecto-Moto"]').exists()).toBe(false)

    wrapper.unmount()
  })

  it('crear manda { nombre, monto } recortado y vuelve a pedir la lista', async () => {
    const wrapper = await montar()
    await abrirNueva(wrapper)

    const guardar = () => wrapper.findAll('button').find(b => b.text() === 'Crear')!
    expect(guardar().attributes('disabled')).toBeDefined()
    await wrapper.find('input[placeholder="Moto"]').setValue('  Colina ')
    await emitir(montoTarifa(wrapper), '2500')
    expect(guardar().attributes('disabled')).toBeUndefined()
    await enviarTarifa(wrapper)

    const post = llamadas.find(l => l.method === 'POST')
    expect(post?.url).toMatch(/\/tarifas-pago$/)
    expect(post?.body).toEqual({ nombre: 'Colina', monto: '2500' })
    expect(wrapper.text()).toContain('Colina')

    wrapper.unmount()
  })

  it('editar precarga la fila y manda PATCH con nombre y monto', async () => {
    const wrapper = await montar()

    await wrapper.find('[aria-label="Editar Moto"]').trigger('click')
    await esperar()
    expect((wrapper.find('input[placeholder="Moto"]').element as HTMLInputElement).value).toBe('Moto')
    expect(montoTarifa(wrapper).props('modelValue')).toBe('1000')
    await emitir(montoTarifa(wrapper), '1200')
    await enviarTarifa(wrapper)

    const patch = llamadas.find(l => l.method === 'PATCH')
    expect(patch?.url).toMatch(/\/tarifas-pago\/t-moto$/)
    expect(patch?.body).toEqual({ nombre: 'Moto', monto: '1200' })

    wrapper.unmount()
  })

  it('«Hacer por defecto» manda { esDefecto: true } y la marca se muda', async () => {
    const wrapper = await montar()

    expect(wrapper.find('[data-qa="tarifa-hacer-defecto-Auto"]').exists()).toBe(false)
    await wrapper.find('[data-qa="tarifa-hacer-defecto-Moto"]').trigger('click')
    await esperar(40)

    const patch = llamadas.find(l => l.method === 'PATCH')
    expect(patch?.url).toMatch(/\/tarifas-pago\/t-moto$/)
    expect(patch?.body).toEqual({ esDefecto: true })
    // El mock del backend no quita la marca a la anterior: la pantalla pide la lista de nuevo.
    expect(llamadas.filter(l => l.method === 'GET' && /\/tarifas-pago$/.test(l.url)).length).toBeGreaterThan(1)

    wrapper.unmount()
  })

  it('el interruptor desactiva con { activa: false } y reactiva con { activa: true }', async () => {
    const wrapper = await montar()

    await wrapper.find('button[aria-label="Activa: Moto"]').trigger('click')
    await esperar(40)
    expect(wrapper.find('button[aria-label="Activa: Moto"]').attributes('aria-checked')).toBe('false')
    await wrapper.find('button[aria-label="Activa: Moto"]').trigger('click')
    await esperar(40)

    expect(escrituras().map(l => l.body)).toEqual([{ activa: false }, { activa: true }])

    wrapper.unmount()
  })

  it('desactivar la por defecto: el 400 del backend queda a la vista y la tarifa sigue activa', async () => {
    rechazo = 'La tarifa por defecto no se puede desactivar: elige otra primero.'
    const wrapper = await montar()

    await wrapper.find('button[aria-label="Activa: Auto"]').trigger('click')
    await esperar(40)

    expect(wrapper.find('[data-qa="tarifa-error"]').text()).toContain(rechazo)
    expect(wrapper.find('button[aria-label="Activa: Auto"]').attributes('aria-checked')).toBe('true')

    wrapper.unmount()
  })

  it('eliminar una tarifa en uso deja el modal abierto con el motivo del backend', async () => {
    rechazo = 'La tarifa está en uso: desactívala en vez de eliminarla.'
    const wrapper = await montar()

    await wrapper.find('[aria-label="Eliminar Moto"]').trigger('click')
    await esperar(30)
    const confirmar = [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Eliminar')!
    confirmar.click()
    await esperar(40)

    expect(document.body.querySelector('[data-qa="tarifa-error-eliminar"]')?.textContent).toContain(rechazo)
    expect(wrapper.text()).toContain('Moto')

    wrapper.unmount()
  })

  it('eliminar una tarifa libre manda DELETE y la saca de la lista', async () => {
    const wrapper = await montar()

    await wrapper.find('[aria-label="Eliminar Moto"]').trigger('click')
    await esperar(30)
    ;[...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Eliminar')!.click()
    await esperar(40)

    const del = llamadas.find(l => l.method === 'DELETE')
    expect(del?.url).toMatch(/\/tarifas-pago\/t-moto$/)
    expect(wrapper.find('[aria-label="Editar Moto"]').exists()).toBe(false)

    wrapper.unmount()
  })
})
