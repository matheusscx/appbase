// Nuxt 4 lee el app.config de `app/` (srcDir): este es el único.
// Objeto plano y no `defineAppConfig`: es solo una identidad para tipar, y los specs
// que mockean `#app/nuxt` (MoneyInput.spec) rompen al evaluar este archivo si la usa.
export default {
  ui: {
    colors: {
      primary: 'venka',
      neutral: 'slate',
      // Escalas en `assets/css/main.css` (auditoría UX 00.8).
      success: 'exito',
      warning: 'alerta',
      error: 'peligro',
    },
    // Ninguna insignia por debajo de 12 px (owner, 2026-10-16, auditoría UX 01.17 y 05.17):
    // `xs` y `sm` venían en 8 y 10 px. Se conserva su relleno compacto.
    badge: {
      variants: {
        size: {
          xs: { base: 'text-xs/4' },
          sm: { base: 'text-xs/4' },
        },
      },
    },
  },
}
