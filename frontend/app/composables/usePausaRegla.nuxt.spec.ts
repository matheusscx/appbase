// @vitest-environment nuxt
//
// Auditoría UX 07.12: pausar una regla sin ítems asociados guarda al instante; el toast trae
// "Deshacer" en descuentos y recargos. Impuestos (fiscal, frente aparte) no cambia: sin "Deshacer".
import { describe, it, expect, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { ref } from 'vue'
import { usePausaRegla } from './usePausaRegla'

interface Toast { title?: string, actions?: { label: string, onClick: () => void }[] }
let toasts: Toast[] = []
let patches: { url: string, body: unknown }[] = []

mockNuxtImport('useToast', () => () => ({ add: (t: Toast) => { toasts.push(t) } }))
mockNuxtImport('useApiFetch', () => (url: string, opts?: { method?: string, body?: unknown }) => {
  if (opts?.method === 'PATCH') {
    patches.push({ url, body: opts.body })
    return Promise.resolve({})
  }
  return Promise.resolve({ nivel: 'linea', items: [] })
})

const regla = () => ({ id: 'r1', nombre: 'Black Friday', activo: true })

describe('usePausaRegla — Deshacer', () => {
  beforeEach(() => {
    toasts = []
    patches = []
  })

  it('con deshacer, pausar avisa con "Deshacer" y tocarlo reactiva la regla', async () => {
    const lista = ref([regla()])
    const { toggleActivo } = usePausaRegla('descuentos', 'Descuento', lista, { deshacer: true })

    await toggleActivo(lista.value[0]!)
    expect(patches.map(p => p.body)).toEqual([{ activo: false }])
    expect(toasts.at(-1)?.actions?.[0]?.label).toBe('Deshacer')

    toasts.at(-1)!.actions![0]!.onClick()
    await new Promise(r => setTimeout(r, 0))
    expect(patches.map(p => p.body)).toEqual([{ activo: false }, { activo: true }])
    expect(lista.value[0]!.activo).toBe(true)
  })

  it('sin la opción (impuestos) el toast no trae acciones', async () => {
    const lista = ref([regla()])
    const { toggleActivo } = usePausaRegla('impuestos', 'Impuesto', lista)

    await toggleActivo(lista.value[0]!)
    expect(toasts.at(-1)?.actions).toBeUndefined()
  })
})
