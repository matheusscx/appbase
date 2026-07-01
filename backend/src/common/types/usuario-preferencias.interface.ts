export type ColorModePreference = 'system' | 'light' | 'dark';

export type PageSizePreference = 10 | 15 | 25 | 50;

export interface UsuarioPreferenciasUi {
  colorMode?: ColorModePreference;
  pageSize?: PageSizePreference;
}

export interface UsuarioPreferencias {
  ui?: UsuarioPreferenciasUi;
}

export const DEFAULT_USUARIO_PREFERENCIAS: UsuarioPreferencias = {
  ui: {
    colorMode: 'system',
    pageSize: 15,
  },
};

export const ALLOWED_PAGE_SIZES: PageSizePreference[] = [10, 15, 25, 50];
