/**
 * El motivo que acompaña a un botón apagado por falta de permiso (auditoría UX 07.22): antes el
 * botón desaparecía y el dueño que delegó a un encargado veía una pantalla "rota". Es UX, no
 * seguridad: el candado es el guard del backend (invariante 6).
 */
export function motivoSinPermiso(permiso: 'Crear' | 'Actualizar' | 'Eliminar', modulo: string): string {
  return `Necesitas el permiso ${permiso} en ${modulo}`
}
