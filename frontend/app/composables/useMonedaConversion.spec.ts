import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'
import type { MonedaTenantApi } from '~/types/moneda'

// useMonedasStore() invoca useRuntimeConfig() en su setup: requiere una app Nuxt real
// (mismo problema que app/stores/monedas.spec.ts). Sin esto, `useMonedaConversion()`
// revienta con "[nuxt] instance unavailable" apenas instancia el store.
vi.mock('#app/nuxt', () => ({
  useRuntimeConfig: vi.fn(() => ({
    public: { apiUrl: 'http://localhost:3000/api' },
  })),
}))

const mockApiFetch = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
  useApiFetch: (...args: unknown[]) => mockApiFetch(...args),
}))

const activeTenantIdRef = ref<string | null>('tenant-1')
vi.mock('~/stores/auth', () => ({
  useAuthStore: () => ({
    get activeTenantId() { return activeTenantIdRef.value },
  }),
}))

const { useMonedasStore } = await import('~/stores/monedas')
const { useMonedaConversion, convertir, resetModoRedondeoTenant } = await import('./useMonedaConversion')

const CLP: MonedaTenantApi = {
  monedaId: 'clp-1',
  nombre: 'Peso Chileno',
  codigoIso: 'CLP',
  simbolo: '$',
  decimales: 0,
  separadorDecimal: ',',
  separadorMiles: '.',
  locale: 'es-CL',
  habilitada: true,
  esOficial: true,
  valorDelDia: null,
}

const USD: MonedaTenantApi = {
  monedaId: 'usd-1',
  nombre: 'Dólar',
  codigoIso: 'USD',
  simbolo: 'US$',
  decimales: 2,
  separadorDecimal: '.',
  separadorMiles: ',',
  locale: 'en-US',
  habilitada: true,
  esOficial: false,
  valorDelDia: '2',
}

describe('convertir (función pura)', () => {
  // El mismo cálculo y el mismo modo que `CalculoPreciosService.convertirAMonedaOficial`
  // (backend): precio × tasa, cuantizado con el modo de redondeo del tenant, NUNCA un
  // `.toFixed()` fijo (ese redondea siempre HALF_UP pase lo que pase la config del tenant).
  it('convierte con el modo de redondeo del tenant, igual que el backend', () => {
    expect(convertir('10.005', '1', { modoRedondeo: 'FLOOR', decimales: 2 })).toBe('10.00')
  })

  it('con HALF_UP redondea hacia arriba en el empate', () => {
    expect(convertir('10.005', '1', { modoRedondeo: 'HALF_UP', decimales: 2 })).toBe('10.01')
  })

  it('con CEIL redondea siempre hacia arriba', () => {
    expect(convertir('10.001', '1', { modoRedondeo: 'CEIL', decimales: 2 })).toBe('10.01')
  })

  it('aplica la tasa antes de cuantizar', () => {
    expect(convertir('100', '1.5', { modoRedondeo: 'HALF_UP', decimales: 4 })).toBe('150.0000')
  })
})

describe('useMonedaConversion', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    activeTenantIdRef.value = 'tenant-1'
    mockApiFetch.mockReset()
    mockApiFetch.mockResolvedValue({ modoRedondeo: 'HALF_UP' })
    useMonedasStore().hydrate([CLP, USD], 'tenant-1')
  })

  // 10.000125 × 2 (valorDelDia de USD) = 20.00025 exacto: el quinto decimal es un 5
  // limpio, así que HALF_UP y FLOOR a 4 decimales dan resultados DISTINTOS
  // (20.0003 vs 20.0002) — el caso discriminador para probar que el modo importa.
  //
  // Cada test usa un tenantId propio: el cache de `modoRedondeo` es un singleton a
  // nivel de módulo (mismo patrón que `refreshing` de `useApiFetch.ts`, deliberado —
  // un solo fetch por tenant activo, compartido por todas las instancias del
  // composable), así que reusar el mismo id entre tests haría que el segundo lea el
  // cache que dejó el primero en vez de disparar su propio fetch.
  it('mientras el modoRedondeo del tenant no cargó, usa HALF_UP (mismo default que antes)', () => {
    activeTenantIdRef.value = 'tenant-sin-cargar'
    mockApiFetch.mockReturnValue(new Promise(() => {})) // nunca resuelve en este test
    const { convertirAMonedaOficial } = useMonedaConversion()

    expect(convertirAMonedaOficial('10.000125', 'usd-1')).toBe('20.0003')
  })

  it('una vez cargado el modoRedondeo del tenant, la conversión lo respeta', async () => {
    activeTenantIdRef.value = 'tenant-floor'
    mockApiFetch.mockResolvedValue({ modoRedondeo: 'FLOOR' })
    const { convertirAMonedaOficial } = useMonedaConversion()

    // Deja resolver el fetch en curso antes de convertir.
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(convertirAMonedaOficial('10.000125', 'usd-1')).toBe('20.0002')
  })

  it('sin moneda extranjera devuelve el precio tal cual, sin convertir', () => {
    const { convertirAMonedaOficial } = useMonedaConversion()
    expect(convertirAMonedaOficial('1000', 'clp-1')).toBe('1000')
  })

  // Reproduce EXACTO el bug que encontró la revisión independiente montando el
  // componente real: tenant A resuelve a FLOOR, el usuario cambia a tenant B
  // (`switchTenant` no remonta necesariamente cada composable — la misma instancia
  // puede sobrevivir), y el fetch de B queda en vuelo. Antes del fix,
  // `convertirAMonedaOficial` leía `modoRedondeoTenant.value` sin comparar contra
  // el tenant ACTIVO, así que servía el FLOOR de A a la plata de B. Con
  // `modoRedondeoVigente` comparando el tenantId en cada lectura, mientras el fetch
  // de B no resuelve cae al default, nunca al modo de A.
  it('cambiar de tenant con un fetch en vuelo NO sirve el modo del tenant anterior', async () => {
    activeTenantIdRef.value = 'tenant-A-fuga'
    mockApiFetch.mockResolvedValue({ modoRedondeo: 'FLOOR' })
    const { convertirAMonedaOficial } = useMonedaConversion()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(convertirAMonedaOficial('10.000125', 'usd-1')).toBe('20.0002') // FLOOR de A

    activeTenantIdRef.value = 'tenant-B-fuga'
    mockApiFetch.mockReturnValue(new Promise(() => {})) // el fetch de B nunca resuelve acá
    expect(convertirAMonedaOficial('10.000125', 'usd-1')).toBe('20.0003') // default, NO el FLOOR de A
  })

  // `resetModoRedondeoTenant` fuerza un fetch nuevo incluso para el MISMO tenantId — el
  // caso de un admin que acaba de cambiar su propio modoRedondeo. Su ÚNICO llamador es
  // `preferencias-financieras.vue` (tras el `PUT`).
  //
  // ⚠️ No engancharlo en `auth.ts#clearAuth` ni en `tenant.ts#switchTenant`: se intentó
  // y se revirtió porque rompía otros stores (ciclo de auto-imports; el detalle medido
  // está en el docblock de la función, en `useMonedaConversion.ts`). El cambio de tenant
  // ya lo cubre `modoRedondeoVigente` comparando el tenantId en cada lectura — lo prueba
  // el test de acá arriba.
  it('resetModoRedondeoTenant fuerza un fetch nuevo para el mismo tenant', async () => {
    activeTenantIdRef.value = 'tenant-reset'
    mockApiFetch.mockResolvedValue({ modoRedondeo: 'HALF_UP' })
    const { convertirAMonedaOficial } = useMonedaConversion()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(convertirAMonedaOficial('10.000125', 'usd-1')).toBe('20.0003') // HALF_UP

    resetModoRedondeoTenant()
    mockApiFetch.mockResolvedValue({ modoRedondeo: 'FLOOR' })
    // Justo después del reset, antes de que el fetch nuevo resuelva: default.
    expect(convertirAMonedaOficial('10.000125', 'usd-1')).toBe('20.0003')
    await new Promise(resolve => setTimeout(resolve, 0))
    // Una vez resuelto, el modo nuevo (FLOOR) — ya no el HALF_UP viejo cacheado.
    expect(convertirAMonedaOficial('10.000125', 'usd-1')).toBe('20.0002')
  })
})
