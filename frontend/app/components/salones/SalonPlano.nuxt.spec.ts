// @vitest-environment nuxt
//
// Auditoría UX 02.11 y 07.18: las mesas eran `div` con `@click` y `@dblclick`,
// sin rol, sin `tabindex` y sin nombre. Con teclado o lector de pantalla no se
// podía abrir una mesa en el salón ni editarla en la configuración.
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import SalonPlano from './SalonPlano.vue'
import type { MesaResumen } from '~/composables/useSalones'

function mesa(over: Partial<MesaResumen> = {}): MesaResumen {
  return {
    id: 'm1', nombre: 'Mesa 1', posX: '0.3', posY: '0.3', forma: 'cuadrada',
    tamano: 'mediana', cuentasAbiertas: 0, ocupada: false, ...over,
  } as MesaResumen
}

async function montar(mesas: MesaResumen[], editable = false) {
  return mountSuspended(SalonPlano, { props: { mesas, editable } })
}

describe('SalonPlano — las mesas se operan con teclado', () => {
  it('cada mesa es un botón con Tab y un nombre que dice su estado', async () => {
    const w = await montar([
      mesa(),
      mesa({ id: 'm2', nombre: 'Mesa 2', ocupada: true, cuentasAbiertas: 1 }),
      mesa({ id: 'm3', nombre: 'Mesa 3', ocupada: true, cuentasAbiertas: 3 }),
    ])
    const m1 = w.find('[data-qa="mesa-m1"]')
    expect(m1.attributes('role')).toBe('button')
    expect(m1.attributes('tabindex')).toBe('0')
    expect(m1.attributes('aria-label')).toBe('Mesa 1, libre')
    expect(w.find('[data-qa="mesa-m2"]').attributes('aria-label')).toBe('Mesa 2, ocupada, 1 cuenta abierta')
    expect(w.find('[data-qa="mesa-m3"]').attributes('aria-label')).toBe('Mesa 3, ocupada, 3 cuentas abiertas')
  })

  it('Enter y Espacio seleccionan la mesa en el salón', async () => {
    const m = mesa()
    const w = await montar([m])
    const el = w.find('[data-qa="mesa-m1"]')
    await el.trigger('keydown', { key: 'Enter' })
    await el.trigger('keydown', { key: ' ' })
    expect(w.emitted('select')).toHaveLength(2)
    expect(w.emitted('edit')).toBeUndefined()
  })

  it('en edición, Enter abre la edición de la mesa (el doble clic no existe con teclado)', async () => {
    const w = await montar([mesa()], true)
    await w.find('[data-qa="mesa-m1"]').trigger('keydown', { key: 'Enter' })
    expect(w.emitted('edit')).toHaveLength(1)
    expect(w.emitted('select')).toBeUndefined()
  })
})
