// @vitest-environment nuxt
//
// Task 5 (`task-5-brief.md` § Step 1): el selector "Fin del día" de Empresa.
// Lo que este spec fija:
//   1. El form carga `horaCorte` con lo que devuelve `GET /tenants/me`.
//   2. `guardar()` lo manda en el `PATCH` — con un valor que el DTO acepta
//      (entero 0-6, `UpdateMyTenantDto.horaCorte`).
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Empresa from './empresa.vue'

const TENANT = {
  id: 'tenant-1',
  nombre: 'Mi Empresa',
  correo: 'contacto@empresa.cl',
  telefono: null,
  direccion: null,
  provinciaId: 'prov-1',
  horaCorte: 5,
}

/** Lo que viajó en el `PATCH`, para probar qué se guarda. */
let guardado: Record<string, unknown> | null = null

mockNuxtImport('useApiFetch', () => {
  return (url: string, opts?: { method?: string, body?: Record<string, unknown> }) => {
    if (typeof url !== 'string') return Promise.resolve([])
    if (url.includes('/tenants/me') && (opts?.method ?? 'GET') === 'PATCH') {
      guardado = opts?.body ?? null
      return Promise.resolve({ ...TENANT, ...guardado })
    }
    if (url.includes('/tenants/me')) return Promise.resolve(TENANT)
    if (url.includes('/catalog/paises')) return Promise.resolve([])
    if (url.includes('/catalog/provincias')) return Promise.resolve([])
    return Promise.resolve([])
  }
})

async function montar() {
  const wrapper = await mountSuspended(Empresa)
  await new Promise(r => setTimeout(r, 20))
  return wrapper
}

describe('empresa — fin del día', () => {
  beforeEach(() => {
    guardado = null
  })

  it('carga form.horaCorte con lo que devuelve el tenant', async () => {
    const wrapper = await montar()
    const vm = wrapper.vm as unknown as { form: { horaCorte: number } }
    expect(vm.form.horaCorte).toBe(5)
  })

  it('guardar() manda horaCorte en el PATCH', async () => {
    const wrapper = await montar()
    const vm = wrapper.vm as unknown as { guardar: () => Promise<void> }
    await vm.guardar()

    expect(guardado?.horaCorte).toBe(5)
  })
})

// 07.31
describe('empresa — requeridos, país y confirmación del fin del día', () => {
  const espera = (ms = 30) => new Promise(r => setTimeout(r, ms))
  const submit = async (wrapper: Awaited<ReturnType<typeof montar>>) => {
    await wrapper.find('form').trigger('submit')
    await espera(50)
  }
  const escribir = async (wrapper: Awaited<ReturnType<typeof montar>>, placeholder: string, valor: string) => {
    await wrapper.find(`input[placeholder="${placeholder}"]`).setValue(valor)
    await espera()
  }
  const errores = (wrapper: Awaited<ReturnType<typeof montar>>) =>
    wrapper.findAll('[data-slot="error"]').map(e => e.text())
  const dialogo = () => document.body.querySelector('[role="dialog"]')

  beforeEach(() => {
    guardado = null
    document.body.innerHTML = ''
  })

  it('Nombre y Correo se marcan como requeridos', async () => {
    const wrapper = await montar()
    const requeridos = wrapper.findAll('label').filter(l => l.html().includes('after:content'))
    expect(requeridos.map(l => l.text())).toEqual(['Nombre', 'Correo'])
  })

  it('sin nombre no guarda y lo dice junto al campo', async () => {
    const wrapper = await montar()
    await escribir(wrapper, 'Nombre de la empresa', '')
    await submit(wrapper)
    expect(guardado).toBeNull()
    expect(errores(wrapper)).toEqual(['Escribe el nombre de la empresa'])
  })

  it('con un correo mal escrito no guarda y da un ejemplo', async () => {
    const wrapper = await montar()
    await escribir(wrapper, 'contacto@empresa.cl', 'no-es-correo')
    await submit(wrapper)
    expect(guardado).toBeNull()
    expect(errores(wrapper)).toEqual(['Escribe un correo válido, por ejemplo contacto@tulocal.cl'])
  })

  it('"Guardar cambios" está apagado mientras no haya cambios', async () => {
    const wrapper = await montar()
    const boton = () => wrapper.findAll('button').find(b => b.text().includes('Guardar cambios'))!
    expect(boton().attributes('disabled')).toBeDefined()
    await escribir(wrapper, 'Nombre de la empresa', 'Otro nombre')
    expect(boton().attributes('disabled')).toBeUndefined()
  })

  it('el País apagado dice por qué', async () => {
    const wrapper = await montar()
    expect(wrapper.text()).toContain('Lo define tu cuenta; para cambiarlo, escríbenos')
  })

  it('cambiar un dato que no es el fin del día guarda directo', async () => {
    const wrapper = await montar()
    await escribir(wrapper, 'Nombre de la empresa', 'Otro nombre')
    await submit(wrapper)
    expect(guardado?.nombre).toBe('Otro nombre')
    expect(dialogo()).toBeNull()
  })

  it('cambiar el fin del día pide confirmar y dice con qué corte se recalcula', async () => {
    const wrapper = await montar()
    const vm = wrapper.vm as unknown as { form: { horaCorte: number } }
    vm.form.horaCorte = 3
    await espera()
    await submit(wrapper)

    expect(guardado).toBeNull()
    expect(dialogo()?.textContent).toContain('Los reportes pasados se recalcularán con el corte de las 03:00')

    const confirmar = [...dialogo()!.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Cambiar el corte')!
    confirmar.click()
    await espera(50)
    expect(guardado?.horaCorte).toBe(3)
  })
})
