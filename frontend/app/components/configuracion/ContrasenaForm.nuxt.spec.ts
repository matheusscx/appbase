// @vitest-environment nuxt
//
// 08.2: en Cambiar contraseña, "no coinciden" y "muy corta" se marcan junto al
// campo y se detectan antes de llamar al servidor.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import ContrasenaForm from './ContrasenaForm.vue'

let enviados: unknown[] = []

mockNuxtImport('useToast', () => () => ({ add: () => {} }))
mockNuxtImport('useApiFetch', () => (_url: string, opts?: { body?: unknown }) => {
  enviados.push(opts?.body)
  return Promise.resolve({ message: 'ok' })
})

async function llenar(wrapper: Awaited<ReturnType<typeof mountSuspended>>, actual: string, nueva: string, confirmar: string) {
  const inputs = wrapper.findAll('input')
  await inputs[0]!.setValue(actual)
  await inputs[1]!.setValue(nueva)
  await inputs[2]!.setValue(confirmar)
  await wrapper.find('form').trigger('submit')
  await new Promise(r => setTimeout(r, 20))
}

describe('ContrasenaForm', () => {
  beforeEach(() => { enviados = [] })

  it('contraseñas distintas: lo marca en "Confirmar" y no manda nada', async () => {
    const wrapper = await mountSuspended(ContrasenaForm)
    await llenar(wrapper, 'actual-123', 'nueva-1234', 'nueva-9999')

    expect(enviados).toHaveLength(0)
    expect(wrapper.findAll('[data-slot="error"]').map(e => e.text())).toEqual(['Las contraseñas no coinciden'])
  })

  it('nueva de menos de 8: lo marca en "Nueva contraseña"', async () => {
    const wrapper = await mountSuspended(ContrasenaForm)
    await llenar(wrapper, 'actual-123', 'corta', 'corta')

    expect(enviados).toHaveLength(0)
    expect(wrapper.findAll('[data-slot="error"]').map(e => e.text())).toEqual(['Usa al menos 8 caracteres'])
  })

  it('falta la actual: la marca', async () => {
    const wrapper = await mountSuspended(ContrasenaForm)
    await llenar(wrapper, '', 'nueva-1234', 'nueva-1234')

    expect(enviados).toHaveLength(0)
    expect(wrapper.findAll('[data-slot="error"]').map(e => e.text())).toEqual(['Escribe tu contraseña actual'])
  })
})
