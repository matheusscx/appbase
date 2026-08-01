import { describe, it, expect, vi, beforeEach } from 'vitest'

// `useRuntimeConfig()` sin import es auto-import de Nuxt: el plugin lo
// reescribe a `import { useRuntimeConfig } from '#app/nuxt'` al transformar,
// así que el stub global de `test.setup.ts` no lo alcanza — hay que mockear
// el módulo virtual (mismo patrón que `useUnidadConversion.spec.ts`).
vi.mock('#app/nuxt', () => ({
  useRuntimeConfig: vi.fn(() => ({
    apiUrl: undefined,
    public: { apiUrl: 'http://localhost:3000/api' },
  })),
}))

const mockApiFetch = vi.fn()
vi.mock('./useApiFetch', () => ({
  useApiFetch: (...args: unknown[]) => mockApiFetch(...args),
}))

// `useFormatters` arrastra `useCurrency`/`useMonedasStore` (Pinia) para el
// formateo de montos, que no pinta acá: se mockea solo `formatFecha`, la
// única función de esa dependencia que usa `formatearBorradoPor`.
vi.mock('./useFormatters', () => ({
  useFormatters: () => ({
    formatFecha: (iso: string | null | undefined) => (iso ? `FECHA(${iso})` : '—'),
  }),
}))

const { usePapelera } = await import('./usePapelera')

describe('usePapelera', () => {
  beforeEach(() => {
    mockApiFetch.mockReset()
  })

  it('el toggle "ver eliminados" arranca apagado', () => {
    const { verEliminados } = usePapelera('items')

    expect(verEliminados.value).toBe(false)
  })

  it('restaurar llama a POST /<recurso>/:id/restaurar', async () => {
    mockApiFetch.mockResolvedValueOnce({})
    const { restaurar } = usePapelera('items')

    await restaurar('item-1')

    expect(mockApiFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/items/item-1/restaurar',
      { method: 'POST' },
    )
  })

  it('usa el recurso de la pantalla que lo instancia, no uno fijo', async () => {
    mockApiFetch.mockResolvedValueOnce({})
    const { restaurar } = usePapelera('categorias')

    await restaurar('cat-1')

    expect(mockApiFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/categorias/cat-1/restaurar',
      { method: 'POST' },
    )
  })

  // El texto del 400 de colisión ("ya existe un/a X activo/a con ese nombre:
  // renómbralo antes de restaurar") es lo que le dice al usuario qué corregir.
  // Si `restaurar` lo atrapara y lo reemplazara por un genérico, la pantalla
  // se queda sin esa información — este test cae si eso pasa.
  it('propaga tal cual el error del backend (400 de colisión de nombre)', async () => {
    const error = {
      data: { message: 'Ya existe una categoría activa con el nombre "Bebidas": renómbrala antes de restaurar' },
    }
    mockApiFetch.mockRejectedValueOnce(error)
    const { restaurar } = usePapelera('categorias')

    await expect(restaurar('cat-1')).rejects.toBe(error)
  })

  it('formatearBorradoPor arma "Eliminado por <nombre> el <fecha>"', () => {
    const { formatearBorradoPor } = usePapelera('items')

    const texto = formatearBorradoPor({
      eliminadoEl: '2026-07-30T12:00:00Z',
      eliminadoPorNombre: 'Ana',
    })

    expect(texto).toBe('Eliminado por Ana el FECHA(2026-07-30T12:00:00Z)')
  })

  it('formatearBorradoPor usa un fallback si no hay nombre de autor', () => {
    // Defensivo por tipado (`eliminadoPorNombre` sigue siendo opcional): ya
    // no es alcanzable en la práctica, porque el backend solo expone lo que
    // borró una persona y los usuarios nunca se borran físicamente (ver el
    // comentario de `formatearBorradoPor`). Por eso el fallback ya no dice
    // "usuario eliminado" — sería una causa concreta que no puede ocurrir.
    const { formatearBorradoPor } = usePapelera('items')

    const texto = formatearBorradoPor({
      eliminadoEl: '2026-07-30T12:00:00Z',
      eliminadoPorNombre: null,
    })

    expect(texto).toBe('Eliminado por usuario desconocido el FECHA(2026-07-30T12:00:00Z)')
  })

  it('formatearBorradoPor devuelve vacío si la fila no está eliminada', () => {
    const { formatearBorradoPor } = usePapelera('items')

    expect(formatearBorradoPor({ eliminadoEl: null })).toBe('')
  })
})
