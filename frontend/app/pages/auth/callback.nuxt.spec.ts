// @vitest-environment nuxt
//
// Auditoría UX 08.22: "Iniciando sesión…" usa el mismo estado de carga que las
// demás pantallas del ingreso (marco con logo e indicador), no una pantalla aparte.
import { describe, it, expect, vi } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import Callback from './callback.vue'

mockNuxtImport('navigateTo', () => vi.fn())

describe('auth/callback', () => {
  it('muestra el logo y el estado de carga del marco', async () => {
    const w = await mountSuspended(Callback)
    expect(w.find('img[alt="Venka"]').exists()).toBe(true)
    expect(w.find('[role="status"]').text()).toContain('Iniciando sesión')
  })
})
