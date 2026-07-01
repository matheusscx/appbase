import {
  ALLOWED_PAGE_SIZES,
  DEFAULT_USUARIO_PREFERENCIAS,
  type ColorModePreference,
  type PageSizePreference,
  type UsuarioPreferencias,
} from '../types/usuario-preferencias.interface';

const ALLOWED_COLOR_MODES: ColorModePreference[] = ['system', 'light', 'dark'];

export function normalizeUsuarioPreferencias(
  raw: UsuarioPreferencias | null | undefined,
): UsuarioPreferencias {
  const colorMode = raw?.ui?.colorMode;
  const pageSize = raw?.ui?.pageSize;

  return {
    ui: {
      colorMode: ALLOWED_COLOR_MODES.includes(colorMode as ColorModePreference)
        ? colorMode
        : DEFAULT_USUARIO_PREFERENCIAS.ui!.colorMode,
      pageSize: ALLOWED_PAGE_SIZES.includes(pageSize as PageSizePreference)
        ? pageSize
        : DEFAULT_USUARIO_PREFERENCIAS.ui!.pageSize,
    },
  };
}

export function mergeUsuarioPreferencias(
  current: UsuarioPreferencias | null | undefined,
  patch: UsuarioPreferencias,
): UsuarioPreferencias {
  return normalizeUsuarioPreferencias({
    ui: {
      ...current?.ui,
      ...patch.ui,
    },
  });
}
