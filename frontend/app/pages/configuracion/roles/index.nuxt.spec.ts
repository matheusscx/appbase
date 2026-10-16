// @vitest-environment nuxt
//
// Mensajes de error de "Nuevo rol" (auditoría UX 07.10 y 07.2): crear con el
// nombre vacío ya no es un botón que no hace nada, sino un error junto al
// campo; y el rechazo del servidor sale en español, no con el texto crudo del
// validador.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Roles from './index.vue'

let llamadas: { method: string, url: string, body?: Record<string, unknown> }[] = []
let rechazo: unknown = null
let avisos: { title: string }[] = []
// Auditoría UX 07.9 / 07.11: la lista trae cuántas personas tiene cada rol; guardar es UNA llamada.
let roles: Record<string, unknown>[] = []
let fallaPut = false

mockNuxtImport('useToast', () => () => ({ add: (t: { title: string }) => avisos.push(t) }))

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    const method = opts?.method ?? 'GET'
    llamadas.push({ method, url, body: opts?.body })
    if (method === 'POST' && url.endsWith('/roles')) {
      return rechazo ? Promise.reject(rechazo) : Promise.resolve({ id: 'r1', nombre: 'Cajero', descripcion: null, esFijo: false, esSistema: false })
    }
    if (method === 'PUT' && /\/roles\/[^/]+\/permissions$/.test(url)) {
      return fallaPut ? Promise.reject({ data: { message: 'boom' } }) : Promise.resolve(undefined)
    }
    if (method === 'DELETE') return Promise.resolve(undefined)
    if (method === 'GET' && url.endsWith('/roles')) return Promise.resolve(roles)
    if (method === 'GET' && url.endsWith('/roles/modulos-disponibles')) {
      return Promise.resolve([
        { moduloTenantId: 'm1', moduloAppId: 'a1', nombre: 'Ventas', icono: null, permisos: [{ moduloAppPermisoId: 'p1', permisoNombre: 'Leer' }, { moduloAppPermisoId: 'p2', permisoNombre: 'Crear' }] },
        { moduloTenantId: 'm2', moduloAppId: 'a2', nombre: 'Caja', icono: null, permisos: [{ moduloAppPermisoId: 'p3', permisoNombre: 'Leer' }] },
      ])
    }
    if (method === 'GET' && /\/permissions$/.test(url)) return Promise.resolve([{ rolId: 'r1', moduloTenantId: 'm1', moduloAppPermisoId: 'p1' }])
    return Promise.resolve([])
  }
})

async function montar() {
  const wrapper = await mountSuspended(Roles, {
    attachTo: document.body,
    global: {
      stubs: {
        AppDrawer: {
          name: 'AppDrawer',
          props: ['open'],
          template: '<div v-if="open" role="dialog"><slot name="header" /><slot name="body" /><slot name="actions" /></div>',
        },
      },
    },
  })
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

async function abrirNuevo(wrapper: Awaited<ReturnType<typeof montar>>) {
  await wrapper.findAll('button').find(b => b.text().includes('Nuevo rol'))!.trigger('click')
  await new Promise(r => setTimeout(r, 30))
}

async function crear(wrapper: Awaited<ReturnType<typeof montar>>) {
  await wrapper.findAll('button').find(b => b.text().trim() === 'Crear')!.trigger('click')
  await new Promise(r => setTimeout(r, 30))
}

describe('roles — Nuevo rol', () => {
  beforeEach(() => {
    llamadas = []
    avisos = []
    rechazo = null
    roles = []
    fallaPut = false
  })

  it('Crear con el nombre vacío marca el campo y no manda nada', async () => {
    const wrapper = await montar()
    await abrirNuevo(wrapper)
    await crear(wrapper)

    expect(llamadas.some(l => l.method === 'POST')).toBe(false)
    expect(wrapper.findAll('[data-slot="error"]').map(e => e.text())).toEqual(['Escribe un nombre para el rol'])
    wrapper.unmount()
  })

  it('al escribir el nombre, el error se va', async () => {
    const wrapper = await montar()
    await abrirNuevo(wrapper)
    await crear(wrapper)
    await wrapper.find('input[placeholder="Ej: Cajero"]').setValue('Cajero')

    expect(wrapper.find('[data-slot="error"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('un rechazo del validador sale en español y marca el nombre', async () => {
    rechazo = { data: { message: ['nombre must be longer than or equal to 3 characters'] } }
    const wrapper = await montar()
    await abrirNuevo(wrapper)
    await wrapper.find('input[placeholder="Ej: Cajero"]').setValue('Ca')
    await crear(wrapper)

    expect(avisos.map(a => a.title)).toEqual(['Nombre: mínimo 3 caracteres'])
    expect(wrapper.find('[data-slot="error"]').text()).toBe('Mínimo 3 caracteres')
    wrapper.unmount()
  })
})

// Lote 4 (07.1): una descripción larga empujaba lápiz y basurero fuera de la tarjeta.
describe('roles — forma de la tabla', () => {
  it('la descripción se acota y las acciones quedan fijas a la derecha', async () => {
    const wrapper = await montar()
    const th = wrapper.findAll('th').find(t => t.text() === 'Descripción')
    expect(th?.classes()).toContain('max-w-xs')
    expect(th?.classes()).toContain('truncate')
    expect(wrapper.findAll('th[data-pinned="right"]')).toHaveLength(1)
  })
})

const VENDEDOR = { id: 'r1', nombre: 'Vendedor', descripcion: null, esFijo: false, esSistema: false, cantidadUsuarios: 3 }
const ADMIN = { id: 'r0', nombre: 'Administrador', descripcion: null, esFijo: true, esSistema: false, cantidadUsuarios: 1 }

async function esperar() { await new Promise(r => setTimeout(r, 40)) }
const botonDe = (nombre: string) => document.body.querySelector<HTMLButtonElement>(`button[aria-label="${nombre}"]`)

describe('roles — eliminar (07.9)', () => {
  beforeEach(() => {
    llamadas = []; avisos = []; rechazo = null; fallaPut = false
    roles = [ADMIN, VENDEDOR]
  })

  it('abre un modal de la app (no el confirm del navegador) con cuántas personas lo tienen', async () => {
    const original = window.confirm
    let confirmLlamado = false
    window.confirm = () => { confirmLlamado = true; return true }
    const wrapper = await montar()
    botonDe('Eliminar rol Vendedor')!.click()
    await esperar()

    expect(confirmLlamado).toBe(false)
    expect(document.body.textContent).toContain('Vendedor')
    expect(document.body.textContent).toContain('3 personas lo tienen y perderán sus permisos')
    expect(llamadas.some(l => l.method === 'DELETE')).toBe(false)
    window.confirm = original
    wrapper.unmount()
  })

  it('con una sola persona habla en singular', async () => {
    roles = [{ ...VENDEDOR, cantidadUsuarios: 1 }]
    const wrapper = await montar()
    botonDe('Eliminar rol Vendedor')!.click()
    await esperar()

    expect(document.body.textContent).toContain('1 persona lo tiene y perderá sus permisos')
    wrapper.unmount()
  })

  it('si nadie lo tiene, lo dice', async () => {
    roles = [{ ...VENDEDOR, cantidadUsuarios: 0 }]
    const wrapper = await montar()
    botonDe('Eliminar rol Vendedor')!.click()
    await esperar()

    expect(document.body.textContent).toContain('nadie lo tiene')
    wrapper.unmount()
  })

  it('confirmar manda el DELETE y quita la fila', async () => {
    const wrapper = await montar()
    botonDe('Eliminar rol Vendedor')!.click()
    await esperar()
    const confirmar = [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Eliminar')!
    confirmar.click()
    await esperar()

    expect(llamadas.some(l => l.method === 'DELETE' && l.url.endsWith('/roles/r1'))).toBe(true)
    wrapper.unmount()
  })

  it('el basurero de un rol fijo está apagado y dice por qué', async () => {
    const wrapper = await montar()
    const b = botonDe('Eliminar rol Administrador')!
    expect(b.disabled).toBe(true)
    expect(b.title).toBe('Es un rol fijo, no se elimina')
    wrapper.unmount()
  })
})

describe('roles — guardar permisos (07.11)', () => {
  beforeEach(() => {
    llamadas = []; avisos = []; rechazo = null; fallaPut = false
    roles = [VENDEDOR]
  })

  async function abrirYGuardar(wrapper: Awaited<ReturnType<typeof montar>>) {
    botonDe('Editar rol Vendedor')!.click()
    await esperar()
    await wrapper.findAll('button').find(b => b.text().trim() === 'Guardar')!.trigger('click')
    await esperar()
  }

  it('manda UNA sola llamada con todos los módulos, no un PUT por módulo', async () => {
    const wrapper = await montar()
    await abrirYGuardar(wrapper)

    const puts = llamadas.filter(l => l.method === 'PUT')
    expect(puts).toHaveLength(1)
    expect(puts[0]!.url.endsWith('/roles/r1/permissions')).toBe(true)
    expect(puts[0]!.body).toEqual({
      modulos: [
        { moduloTenantId: 'm1', moduloAppPermisoIds: ['p1'] },
        { moduloTenantId: 'm2', moduloAppPermisoIds: [] },
      ],
    })
    wrapper.unmount()
  })

  it('si falla, avisa y vuelve a leer los permisos que el servidor tiene', async () => {
    fallaPut = true
    const wrapper = await montar()
    botonDe('Editar rol Vendedor')!.click()
    await esperar()
    const lecturasAntes = llamadas.filter(l => l.method === 'GET' && l.url.endsWith('/roles/r1/permissions')).length
    await wrapper.findAll('button').find(b => b.text().trim() === 'Guardar')!.trigger('click')
    await esperar()

    expect(avisos.some(a => a.title.length > 0)).toBe(true)
    const lecturasDespues = llamadas.filter(l => l.method === 'GET' && l.url.endsWith('/roles/r1/permissions')).length
    expect(lecturasDespues).toBe(lecturasAntes + 1)
    wrapper.unmount()
  })
})

describe('roles — rol fijo (07.24)', () => {
  beforeEach(() => {
    llamadas = []; avisos = []; rechazo = null; fallaPut = false
    roles = [ADMIN]
  })

  it('muestra la lista de permisos con las casillas deshabilitadas', async () => {
    const wrapper = await montar()
    botonDe('Editar rol Administrador')!.click()
    await esperar()

    expect(document.body.textContent).toContain('Ventas')
    const casillas = [...document.body.querySelectorAll<HTMLElement>('[role="checkbox"]')]
    expect(casillas).toHaveLength(3)
    // Administrador tiene acceso a todo lo contratado: todas marcadas, ninguna tocable.
    expect(casillas.every(c => c.getAttribute('aria-checked') === 'true' && c.hasAttribute('disabled'))).toBe(true)
    expect(wrapper.find('button[type="submit"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
