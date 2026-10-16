/**
 * ¿Este clic sobre un `<a href>` lo tiene que resolver el navegador (pestaña
 * nueva, ventana, descarga) y no el router?
 *
 * Una tarjeta enlazada que hace `@click.prevent` + `navigateTo` navega sin
 * recargar, pero se come Cmd/Ctrl+clic y el clic medio. Con este chequeo la
 * tarjeta sigue siendo SPA en el clic simple y un enlace normal en el resto.
 */
export function debeSeguirElNavegador(e: MouseEvent): boolean {
  return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
}

/** Handler del `@click` de una tarjeta `<a href>`: SPA salvo clic con modificador. */
export function seguirEnlaceInterno(e: MouseEvent, destino: string) {
  if (debeSeguirElNavegador(e)) return
  e.preventDefault()
  return navigateTo(destino)
}
