/** Presets de ancho para paneles laterales (`AppDrawer`, `direction="right"|"left"`). */
export const DRAWER_WIDTH_PRESETS = {
  xs: '25%',
  sm: '33%',
  md: '50%',
  lg: '75%',
  xl: '90%',
  full: 'calc(100% - 2rem)',
} as const

export type DrawerWidthPreset = keyof typeof DRAWER_WIDTH_PRESETS

/** Preset (`md`) o valor CSS: `50%`, `75%`, `28rem`, `480px`. */
export type DrawerWidth = DrawerWidthPreset | `${number}%` | `${number}rem` | `${number}px`

const CUSTOM_WIDTH_PATTERN = /^(\d+(\.\d+)?)(%|rem|px)$/

export function resolveDrawerWidth(width: DrawerWidth = 'md'): string {
  if (width in DRAWER_WIDTH_PRESETS) {
    return DRAWER_WIDTH_PRESETS[width as DrawerWidthPreset]
  }
  if (CUSTOM_WIDTH_PATTERN.test(width)) {
    return width
  }
  throw new Error(`Ancho de drawer inválido: ${width}`)
}
