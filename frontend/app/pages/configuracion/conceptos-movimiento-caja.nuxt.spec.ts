// @vitest-environment nuxt
//
// Auditoría UX 03.28: el admin arma los conceptos rápidos de los movimientos de caja.
// Se prueba lo observable: la lista, el alta con el cuerpo que viaja al servidor, el
// tipo, el cambio de activo y el borrado con confirmación.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Conceptos from './conceptos-movimiento-caja.vue'

interface Fake {
  id: string
  nombre: string
  tipo: string
  activo: boolean
  eliminadoEl?: string | null
  eliminadoPorNombre?: string | null
}

let backend: Fake[] = []
let llamadas: { url: string, method: string, body?: unknown }[] = []

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    const method = opts?.method ?? 'GET'
    llamadas.push({ url, method, body: opts?.body })
    if (method === 'GET') {
      const todos = url.includes('incluirEliminados=true')
      return Promise.resolve(backend.filter(c => todos || !c.eliminadoEl).map(c => ({ ...c })))
    }
    if (method === 'POST' && url.endsWith('/restaurar')) {
      const id = url.split('/').slice(-2)[0]
      const c = backend.find(x => x.id === id)!
      const nombre = opts?.body?.nombre as string | undefined ?? c.nombre
      if (backend.some(x => !x.eliminadoEl && x.id !== id && x.nombre === nombre)) {
        const e = new Error(`Ya existe un concepto activo con el nombre "${nombre}".`) as Error & { data?: unknown }
        e.data = { message: e.message, nombreSugerido: `${nombre} 2` }
        return Promise.reject(e)
      }
      c.eliminadoEl = null
      c.nombre = nombre
      return Promise.resolve({ ...c })
    }
    if (method === 'POST') {
      const c = { id: 'nuevo', activo: true, ...opts!.body } as Fake
      return Promise.resolve(c)
    }
    if (method === 'PATCH') {
      const c = backend.find(x => url.endsWith(x.id))!
      return Promise.resolve({ ...c, ...opts!.body })
    }
    const c = backend.find(x => url.endsWith(x.id))
    if (c) {
      c.eliminadoEl = '2026-10-17T10:00:00Z'
      c.eliminadoPorNombre = 'admin.paris'
    }
    return Promise.resolve(undefined)
  }
})

beforeEach(() => {
  llamadas = []
  backend = [
    { id: 'a', nombre: 'Compra de insumos', tipo: 'salida', activo: true },
    { id: 'b', nombre: 'Aporte de fondo', tipo: 'entrada', activo: false },
  ]
})

// `AppDrawer` stubeado y `attachTo`: cerrar el drawer real (reka-ui) revienta bajo happy-dom
// con un rechazo no capturado y `vitest run` sale con 1 aunque pasen los tests (molde de
// `impuestos.nuxt.spec.ts` → `montarConDrawerStub`). El `attachTo` hace que el botón
// `type="submit" form="..."` encuentre su formulario por id.
async function montar() {
  const w = await mountSuspended(Conceptos, {
    attachTo: document.body,
    global: {
      stubs: {
        AppDrawer: {
          name: 'AppDrawer',
          props: ['open'],
          template: '<div v-if="open" data-drawer><slot name="header" /><slot name="body" /><slot name="actions" /></div>',
        },
      },
    },
  })
  await new Promise(r => setTimeout(r, 20))
  return w
}

// Puede quedar abierto el drawer de un test anterior: se busca el modal por su título.
const dialogo = () =>
  [...document.body.querySelectorAll('[role="dialog"]')]
    .find(d => d.textContent?.includes('Eliminar concepto')) as HTMLElement | undefined

describe('configuración → conceptos de movimientos', () => {
  it('lista cada concepto con a qué movimientos se ofrece', async () => {
    const w = await montar()
    const filas = w.findAll('tbody tr').map(tr => tr.text())
    expect(filas).toHaveLength(2)
    expect(filas[0]).toContain('Compra de insumos')
    expect(filas[0]).toContain('Solo salidas')
    expect(filas[1]).toContain('Aporte de fondo')
    expect(filas[1]).toContain('Solo entradas')
  })

  it('crea un concepto con nombre sin espacios sobrantes y tipo ambos por defecto', async () => {
    const w = await montar()
    await w.findAll('button').find(b => b.text() === 'Nuevo concepto')!.trigger('click')
    await new Promise(r => setTimeout(r, 20))
    const input = document.body.querySelector('input[placeholder="Ej: Compra de insumos"]') as HTMLInputElement
    input.value = '  Retiro de efectivo '
    input.dispatchEvent(new Event('input'))
    await new Promise(r => setTimeout(r, 20))
    const crear = [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Crear')!
    crear.click()
    await new Promise(r => setTimeout(r, 50))
    const post = llamadas.find(l => l.method === 'POST')!
    expect(post.url).toContain('/conceptos-movimiento-caja')
    expect(post.body).toEqual({ nombre: 'Retiro de efectivo', tipo: 'ambos', activo: true })
    expect(w.text()).toContain('Retiro de efectivo')
  })

  it('el interruptor cambia solo activo', async () => {
    const w = await montar()
    await w.find('[aria-label="Activo: Aporte de fondo"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))
    const patch = llamadas.find(l => l.method === 'PATCH')!
    expect(patch.url).toContain('/conceptos-movimiento-caja/b')
    expect(patch.body).toEqual({ activo: true })
  })

  it('eliminar pide confirmación y saca la fila', async () => {
    const w = await montar()
    await w.find('[aria-label="Eliminar concepto Compra de insumos"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))
    expect(llamadas.some(l => l.method === 'DELETE')).toBe(false)
    const d = dialogo()
    expect(d).toBeTruthy()
    const ok = [...d!.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Eliminar')!
    ok.click()
    await new Promise(r => setTimeout(r, 50))
    expect(llamadas.find(l => l.method === 'DELETE')?.url).toContain('/conceptos-movimiento-caja/a')
    expect(w.text()).not.toContain('Compra de insumos')
  })

  it('Ver eliminados pide la papelera y muestra lo borrado con su autor y Restaurar', async () => {
    backend.push({ id: 'z', nombre: 'Viejo', tipo: 'ambos', activo: true, eliminadoEl: '2026-10-17T10:00:00Z', eliminadoPorNombre: 'admin.paris' })
    const w = await montar()
    expect(w.text()).not.toContain('Viejo')
    await w.find('[aria-label="Ver eliminados"]').trigger('click')
    await new Promise(r => setTimeout(r, 50))
    expect(llamadas.some(l => l.method === 'GET' && l.url.includes('incluirEliminados=true'))).toBe(true)
    const fila = w.findAll('tbody tr').find(tr => tr.text().includes('Viejo'))!
    expect(fila.text()).toContain('Eliminado')
    expect(fila.text()).toContain('admin.paris')
    expect(fila.find('[aria-label^="Editar"]').exists()).toBe(false)
    expect(fila.findAll('button').some(b => b.text() === 'Restaurar')).toBe(true)
  })

  it('Restaurar pide confirmación y revive la fila', async () => {
    backend.push({ id: 'z', nombre: 'Viejo', tipo: 'ambos', activo: true, eliminadoEl: '2026-10-17T10:00:00Z', eliminadoPorNombre: 'admin.paris' })
    const w = await montar()
    await w.find('[aria-label="Ver eliminados"]').trigger('click')
    await new Promise(r => setTimeout(r, 50))
    await w.findAll('button').find(b => b.text() === 'Restaurar')!.trigger('click')
    await new Promise(r => setTimeout(r, 20))
    expect(llamadas.some(l => l.method === 'POST')).toBe(false)
    await confirmar('Restaurar')
    expect(llamadas.find(l => l.method === 'POST')?.url).toContain('/conceptos-movimiento-caja/z/restaurar')
    const fila = w.findAll('tbody tr').find(tr => tr.text().includes('Viejo'))!
    expect(fila.text()).not.toContain('Eliminado por')
  })

  it('si el nombre está tomado abre un segundo paso con el nombre libre y reintenta con él', async () => {
    backend.push({ id: 'z', nombre: 'Cambio', tipo: 'ambos', activo: true, eliminadoEl: '2026-10-17T10:00:00Z', eliminadoPorNombre: 'admin.paris' })
    backend.push({ id: 'v', nombre: 'Cambio', tipo: 'ambos', activo: true })
    const w = await montar()
    await w.find('[aria-label="Ver eliminados"]').trigger('click')
    await new Promise(r => setTimeout(r, 50))
    await w.findAll('button').find(b => b.text() === 'Restaurar')!.trigger('click')
    await new Promise(r => setTimeout(r, 20))
    await confirmar('Restaurar')
    const d = [...document.body.querySelectorAll('[role="dialog"]')]
      .find(x => x.textContent?.includes('No se puede restaurar con ese nombre'))
    expect(d).toBeTruthy()
    expect((d!.querySelector('input') as HTMLInputElement).value).toBe('Cambio 2')
    await confirmar('Restaurar')
    const posts = llamadas.filter(l => l.method === 'POST')
    expect(posts).toHaveLength(2)
    expect(posts[1]!.body).toEqual({ nombre: 'Cambio 2' })
    expect(w.findAll('tbody tr').map(tr => tr.text()).some(t => t.includes('Cambio 2'))).toBe(true)
  })

  it('con la papelera abierta, eliminar deja la fila como eliminada en vez de sacarla', async () => {
    const w = await montar()
    await w.find('[aria-label="Ver eliminados"]').trigger('click')
    await new Promise(r => setTimeout(r, 50))
    await w.find('[aria-label="Eliminar concepto Compra de insumos"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))
    await confirmar('Eliminar')
    const fila = w.findAll('tbody tr').find(tr => tr.text().includes('Compra de insumos'))!
    expect(fila.text()).toContain('Eliminado')
  })
})

async function confirmar(texto: string) {
  const d = [...document.body.querySelectorAll('[role="dialog"]')].reverse()
    .find(x => [...x.querySelectorAll('button')].some(b => b.textContent?.trim() === texto && !b.hasAttribute('data-row')))
  const boton = [...d!.querySelectorAll('button')].find(b => b.textContent?.trim() === texto)!
  boton.click()
  await new Promise(r => setTimeout(r, 50))
}
