// @vitest-environment nuxt
//
// Ver `RecetasDesfasesPanel.nuxt.spec.ts` para por qué el entorno va por
// archivo. Acá el objetivo es distinto: los tres permisos de `terceros` son
// SEPARADOS en el backend, y el modo de falla es colapsarlos —esconderle el
// botón de editar a quien solo tiene `Actualizar`, por ejemplo—. Eso no lo ve
// ningún test de lógica: hay que renderizar.
import { describe, it, expect } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Terceros from './terceros.vue'

let esAdmin = false
let permisos: string[] = []

mockNuxtImport('usePermissionsStore', () => {
  return () => ({
    get esAdmin() { return esAdmin },
    can: (modulo: string, permiso: string) => permisos.includes(`${modulo}:${permiso}`),
  })
})

const TERCERO = {
  id: 't-1',
  tipo: 'proveedor',
  nombre: 'Distribuidora Sur',
  rut: null,
  nombreLegal: null,
  rutFiscal: null,
  correo: null,
  telefono: null,
  activo: true,
}

mockNuxtImport('useApiFetch', () => {
  return () => Promise.resolve([TERCERO])
})

/** Los botones de fila son solo icono: se identifican por su `title`/icono. */
async function montar() {
  const wrapper = await mountSuspended(Terceros)
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

function tieneBoton(wrapper: Awaited<ReturnType<typeof montar>>, texto: string) {
  return wrapper.findAll('button').some(b => b.text().includes(texto))
}

/**
 * Por `title`, no por la clase del icono: el icono lo renderiza `UIcon` en un
 * hijo y en el entorno de test no siempre resuelve, así que consultarlo ataría
 * el test al bundle de iconos en vez de al control.
 */
function cuentaPorTitulo(
  wrapper: Awaited<ReturnType<typeof montar>>,
  title: string,
) {
  return wrapper.findAll(`[title="${title}"]`).length
}

describe('terceros — cada control con el permiso de SU endpoint', () => {
  it('solo lectura: ni crear, ni editar, ni eliminar', async () => {
    esAdmin = false
    permisos = ['Terceros:Leer']

    const wrapper = await montar()

    expect(tieneBoton(wrapper, 'Nuevo tercero')).toBe(false)
    expect(cuentaPorTitulo(wrapper, 'Editar')).toBe(0)
    expect(cuentaPorTitulo(wrapper, 'Eliminar')).toBe(0)
    // La tabla sigue cargando: el gate es de escritura, no de lectura.
    expect(wrapper.text()).toContain('Distribuidora Sur')
  })

  it('solo `Crear`: aparece el alta y NADA más', async () => {
    esAdmin = false
    permisos = ['Terceros:Leer', 'Terceros:Crear']

    const wrapper = await montar()

    expect(tieneBoton(wrapper, 'Nuevo tercero')).toBe(true)
    expect(cuentaPorTitulo(wrapper, 'Editar')).toBe(0)
    expect(cuentaPorTitulo(wrapper, 'Eliminar')).toBe(0)
  })

  it('solo `Actualizar`: aparece editar SIN aparecer crear ni eliminar', async () => {
    // El caso que un `puedeEscribir` único se comería: los tres permisos son
    // distintos en el backend y hay roles que tienen uno solo.
    esAdmin = false
    permisos = ['Terceros:Leer', 'Terceros:Actualizar']

    const wrapper = await montar()

    expect(tieneBoton(wrapper, 'Nuevo tercero')).toBe(false)
    expect(cuentaPorTitulo(wrapper, 'Editar')).toBeGreaterThan(0)
    expect(cuentaPorTitulo(wrapper, 'Eliminar')).toBe(0)
  })

  it('solo `Eliminar`: aparece la papelera y nada más', async () => {
    esAdmin = false
    permisos = ['Terceros:Leer', 'Terceros:Eliminar']

    const wrapper = await montar()

    expect(tieneBoton(wrapper, 'Nuevo tercero')).toBe(false)
    expect(cuentaPorTitulo(wrapper, 'Editar')).toBe(0)
    expect(cuentaPorTitulo(wrapper, 'Eliminar')).toBeGreaterThan(0)
  })

  it('el admin del tenant ve los tres sin permisos listados', async () => {
    esAdmin = true
    permisos = []

    const wrapper = await montar()

    expect(tieneBoton(wrapper, 'Nuevo tercero')).toBe(true)
    expect(cuentaPorTitulo(wrapper, 'Editar')).toBeGreaterThan(0)
    expect(cuentaPorTitulo(wrapper, 'Eliminar')).toBeGreaterThan(0)
  })
})
