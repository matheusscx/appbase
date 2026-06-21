import { vi } from 'vitest'
import { ref } from 'vue'

// Stub Nuxt auto-imported globals so unit tests don't need a live Nuxt instance.
// Each useCookie call gets its own independent ref so stores are isolated.
vi.stubGlobal('useCookie', (_name: string, _opts?: unknown) => ref<string | null>(null))

vi.stubGlobal('useRuntimeConfig', () => ({
  apiUrl: undefined,
  public: { apiUrl: 'http://localhost:3000/api' },
}))

vi.stubGlobal('navigateTo', vi.fn())
vi.stubGlobal('$fetch', vi.fn())
