import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('#app/nuxt', () => ({
  useNuxtApp: vi.fn(),
  useRuntimeConfig: vi.fn(() => ({ public: { apiUrl: '/api' } })),
  defineNuxtPlugin: vi.fn(),
  definePayloadPlugin: vi.fn(),
  defineAppConfig: vi.fn(),
  tryUseNuxtApp: vi.fn(),
}))

vi.mock('#app/composables/router', () => ({
  navigateTo: vi.fn(),
  useRoute: vi.fn(),
  useRouter: vi.fn(),
  abortNavigation: vi.fn(),
  addRouteMiddleware: vi.fn(),
  defineNuxtRouteMiddleware: vi.fn(),
  setPageLayout: vi.fn(),
}))

const store = { token: 'viejo', setToken: vi.fn(), clearAuth: vi.fn() }
vi.mock('~/stores/auth', () => ({ useAuthStore: () => store }))

vi.stubGlobal('$fetch', vi.fn())

import { navigateTo } from '#app/composables/router'
import { useApiFetch } from './useApiFetch'

const $fetchMock = vi.mocked($fetch as unknown as (...args: unknown[]) => Promise<unknown>)

function errorHttp(status: number, message = `HTTP ${status}`) {
  return Object.assign(new Error(message), { status, data: { message } })
}

/** Programa las respuestas en orden: la de la ruta, la del refresh, la del reintento. */
function responder(...respuestas: (unknown | Error)[]) {
  for (const r of respuestas) {
    if (r instanceof Error) $fetchMock.mockRejectedValueOnce(r)
    else $fetchMock.mockResolvedValueOnce(r)
  }
}

describe('useApiFetch ante un 401', () => {
  beforeEach(() => {
    $fetchMock.mockReset()
    store.setToken.mockReset()
    store.clearAuth.mockReset()
    vi.mocked(navigateTo).mockReset()
  })

  it('refresca y reintenta', async () => {
    responder(errorHttp(401), { access_token: 'nuevo' }, { ok: true })
    await expect(useApiFetch('/api/x')).resolves.toEqual({ ok: true })
    expect(store.setToken).toHaveBeenCalledWith('nuevo')
  })

  it('si el refresh no sirve, cierra la sesión y manda al login', async () => {
    responder(errorHttp(401), errorHttp(401))
    await expect(useApiFetch('/api/x')).rejects.toMatchObject({ status: 401 })
    expect(store.clearAuth).toHaveBeenCalled()
    expect(navigateTo).toHaveBeenCalledWith('/login')
  })

  // ADR-032: un 429 es "espera", no "tu sesión no vale". Cerrarla sacaría al
  // cajero a mitad de una venta por un límite que se vacía solo en un minuto.
  it('si el refresh choca el límite, NO cierra la sesión: llega el aviso del 429', async () => {
    responder(errorHttp(401), errorHttp(429, 'Demasiadas solicitudes seguidas. Espera 30 segundos y vuelve a intentar.'))
    await expect(useApiFetch('/api/x')).rejects.toMatchObject({
      status: 429,
      data: { message: 'Demasiadas solicitudes seguidas. Espera 30 segundos y vuelve a intentar.' },
    })
    expect(store.clearAuth).not.toHaveBeenCalled()
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('si el reintento choca el límite, tampoco', async () => {
    responder(errorHttp(401), { access_token: 'nuevo' }, errorHttp(429))
    await expect(useApiFetch('/api/x')).rejects.toMatchObject({ status: 429 })
    expect(store.clearAuth).not.toHaveBeenCalled()
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('un 429 directo no intenta refrescar', async () => {
    responder(errorHttp(429))
    await expect(useApiFetch('/api/x')).rejects.toMatchObject({ status: 429 })
    expect($fetchMock).toHaveBeenCalledTimes(1)
  })
})
