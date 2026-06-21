import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'

// Mock the virtual module paths that Nuxt uses for auto-imports.
// These are resolved by Nuxt's Vite plugins in the real app but need
// explicit mocking in unit tests that run outside a Nuxt context.
vi.mock('#app/nuxt', () => ({
  useNuxtApp: vi.fn(),
  useRuntimeConfig: vi.fn(() => ({
    apiUrl: undefined,
    public: { apiUrl: 'http://localhost:3000/api' },
  })),
  defineNuxtPlugin: vi.fn(),
  definePayloadPlugin: vi.fn(),
  defineAppConfig: vi.fn(),
  tryUseNuxtApp: vi.fn(),
}))

vi.mock('#app/composables/cookie', () => ({
  useCookie: vi.fn((_name: string, _opts?: unknown) => ref<string | null>(null)),
  refreshCookie: vi.fn(),
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

vi.stubGlobal('$fetch', vi.fn())

import { useAuthStore } from './auth'

// Token de prueba con tenant_id y es_superadmin
const makeToken = (payload: object) => {
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `header.${body}.sig`
}

describe('useAuthStore — computed claims', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('activeTenantId es null cuando token tiene tenant_id: null', () => {
    const store = useAuthStore()
    store.setToken(makeToken({ sub: 'u1', email: 'a@b.com', tenant_id: null, es_superadmin: false, iat: 0, exp: 9999 }))
    expect(store.activeTenantId).toBeNull()
  })

  it('activeTenantId devuelve el UUID cuando está en el token', () => {
    const store = useAuthStore()
    store.setToken(makeToken({ sub: 'u1', email: 'a@b.com', tenant_id: 'abc-123', es_superadmin: false, iat: 0, exp: 9999 }))
    expect(store.activeTenantId).toBe('abc-123')
  })

  it('isSuperadmin es true cuando es_superadmin está en el token', () => {
    const store = useAuthStore()
    store.setToken(makeToken({ sub: 'u1', email: 'a@b.com', tenant_id: null, es_superadmin: true, iat: 0, exp: 9999 }))
    expect(store.isSuperadmin).toBe(true)
  })

  it('isSuperadmin es false cuando no hay token', () => {
    const store = useAuthStore()
    expect(store.isSuperadmin).toBe(false)
  })

  it('activeTenantId es null cuando no hay token', () => {
    const store = useAuthStore()
    expect(store.activeTenantId).toBeNull()
  })
})
