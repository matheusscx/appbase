// @vitest-environment nuxt
//
// Alta de un proveedor en plena carga de una compra (auditoría UX 06.11, owner 2026-10-16):
// quien carga compras lo crea sin tener el módulo Terceros. Lo que fija: el nombre es
// obligatorio y se dice junto al campo, el body es el angosto de `POST /compras/proveedores`
// (sin `tipo` ni `tenantId`), el plazo viaja como número y el proveedor creado sale por el evento.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import CrearProveedorModal from './CrearProveedorModal.vue'

const llamadas: { url: string, method?: string, body?: unknown }[] = []
let avisos: { title: string, color?: string }[] = []
let respuesta: () => Promise<unknown> = () => Promise.resolve({ id: 'prov-nuevo', nombre: 'Frutas del Sur', rut: null, plazoPagoDias: null })

mockNuxtImport('useToast', () => () => ({ add: (t: { title: string, color?: string }) => avisos.push(t) }))
mockNuxtImport('useApiFetch', () => (url: string, opts?: { method?: string, body?: unknown }) => {
  llamadas.push({ url: url.split('/api').pop()!, method: opts?.method, body: opts?.body })
  return respuesta()
})

async function abrir() {
  const wrapper = await mountSuspended(CrearProveedorModal, { props: { open: true } })
  await wrapper.setProps({ open: false })
  await wrapper.setProps({ open: true })
  await new Promise(r => setTimeout(r, 30))
  return wrapper
}

const campo = (qa: string) => document.body.querySelector<HTMLInputElement>(`input[data-qa="${qa}"]`)!
async function tipear(qa: string, valor: string) {
  const el = campo(qa)
  el.value = valor
  el.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 0))
}
const crear = () => document.body.querySelector<HTMLButtonElement>('[data-qa="proveedor-crear"]')!

beforeEach(() => {
  document.body.innerHTML = ''
  llamadas.length = 0
  avisos = []
  respuesta = () => Promise.resolve({ id: 'prov-nuevo', nombre: 'Frutas del Sur', rut: null, plazoPagoDias: null })
})

describe('CrearProveedorModal', () => {
  it('sin nombre no envía y lo dice junto al campo', async () => {
    await abrir()
    crear().click()
    await new Promise(r => setTimeout(r, 20))
    expect(llamadas).toHaveLength(0)
    expect(document.body.textContent).toContain('Escribe el nombre del proveedor')
  })

  it('manda solo el contrato angosto: nombre recortado, RUT y plazo si se escribieron', async () => {
    const wrapper = await abrir()
    await tipear('proveedor-nombre', '  Frutas del Sur ')
    await tipear('proveedor-rut', '76.123.456-7')
    await tipear('proveedor-plazo', '15')
    crear().click()
    await new Promise(r => setTimeout(r, 20))
    expect(llamadas).toEqual([{
      url: '/compras/proveedores',
      method: 'POST',
      body: { nombre: 'Frutas del Sur', rut: '76.123.456-7', plazoPagoDias: 15 },
    }])
    expect(wrapper.emitted('creado')![0]![0]).toMatchObject({ id: 'prov-nuevo' })
    expect(avisos.map(a => a.title)).toContain('Proveedor creado')
  })

  it('RUT y plazo vacíos no viajan', async () => {
    await abrir()
    await tipear('proveedor-nombre', 'Frutas del Sur')
    crear().click()
    await new Promise(r => setTimeout(r, 20))
    expect(llamadas[0]!.body).toEqual({ nombre: 'Frutas del Sur' })
  })

  it('si el servidor rechaza, avisa y no emite creado', async () => {
    respuesta = () => Promise.reject({ status: 403, statusCode: 403, data: { message: 'No tienes permiso para esta acción' } })
    const wrapper = await abrir()
    await tipear('proveedor-nombre', 'Frutas del Sur')
    crear().click()
    await new Promise(r => setTimeout(r, 20))
    expect(wrapper.emitted('creado')).toBeUndefined()
    expect(avisos.at(-1)!.color).toBe('error')
  })
})
