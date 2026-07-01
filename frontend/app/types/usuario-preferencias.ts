export type ColorModePreference = 'light' | 'dark'

export type PageSizePreference = 10 | 15 | 25 | 50

export interface UsuarioPreferenciasUi {
  colorMode?: ColorModePreference
  pageSize?: PageSizePreference
}

export interface UsuarioPreferencias {
  ui?: UsuarioPreferenciasUi
}

export const DEFAULT_PAGE_SIZE: PageSizePreference = 15
export const DEFAULT_COLOR_MODE: ColorModePreference = 'light'

export const COLOR_MODE_OPTIONS: { label: string, value: ColorModePreference }[] = [
  { label: 'Claro', value: 'light' },
  { label: 'Oscuro', value: 'dark' },
]

export const PAGE_SIZE_OPTIONS: { label: string, value: PageSizePreference }[] = [
  { label: '10 filas', value: 10 },
  { label: '15 filas', value: 15 },
  { label: '25 filas', value: 25 },
  { label: '50 filas', value: 50 },
]

export function resolvePageSize(prefs?: UsuarioPreferencias | null): PageSizePreference {
  const value = prefs?.ui?.pageSize
  if (value === 10 || value === 15 || value === 25 || value === 50) return value
  return DEFAULT_PAGE_SIZE
}

export function resolveColorMode(prefs?: UsuarioPreferencias | null): ColorModePreference {
  const value = prefs?.ui?.colorMode as string | undefined
  if (value === 'light' || value === 'dark') return value
  if (value === 'system') return 'dark'
  return DEFAULT_COLOR_MODE
}

export function mergePreferencias(
  current: UsuarioPreferencias | null | undefined,
  patch: UsuarioPreferencias,
): UsuarioPreferencias {
  return {
    ui: {
      ...current?.ui,
      ...patch.ui,
    },
  }
}
