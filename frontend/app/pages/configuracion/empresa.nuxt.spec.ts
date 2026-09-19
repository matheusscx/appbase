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
