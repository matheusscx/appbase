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
    // El placeholder de Nuxt UI (`text-dimmed`) mide 2,63:1 sobre blanco; `text-muted` mide
    // 4,76:1 (auditoría UX 08.19).
    input: { slots: { base: 'placeholder:text-muted' } },
    textarea: { slots: { base: 'placeholder:text-muted' } },
    // El control de un campo de formulario llena el ancho que le dan (auditoría UX 07.7): los
    // `UInput` medían 167 px en un panel de 640. Solo los que están dentro de un `UFormField`;
    // un filtro suelto de una barra conserva su ancho.
    formField: {
      slots: { container: 'relative [&>*]:w-full' },
    },
    // Área táctil de 44 px en los interruptores sin agrandar el dibujo (auditoría UX 07.26): un
    // pseudo-elemento transparente centrado sobre el botón. La casilla queda afuera: su botón lleva
    // `overflow-hidden` (recorta el área) y sobre el contenedor el área recibía el toque sin marcar.
    switch: {
      slots: { base: 'relative after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[\'\']' },
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
