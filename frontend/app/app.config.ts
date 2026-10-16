// Nuxt 4 lee el app.config de `app/` (srcDir); el `frontend/app.config.ts` de la raíz
// no se carga (medido: `ui.colors.primary` salía en `green`).
// Objeto plano y no `defineAppConfig`: es solo una identidad para tipar, y los specs
// que mockean `#app/nuxt` (MoneyInput.spec) rompen al evaluar este archivo si la usa.
export default {
  ui: {
    colors: {
      primary: 'venka',
      neutral: 'slate',
    },
  },
}
