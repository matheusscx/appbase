import { ref } from 'vue'
import { useApiFetch } from './useApiFetch'
import { useFormatters } from './useFormatters'

/** Forma mínima que necesita `formatearBorradoPor`: solo las dos columnas de
 * auditoría que trae cualquier fila de la papelera (`GET ...?incluirEliminados=true`),
 * sin acoplarse a la interfaz completa de cada uno de los 16 recursos. */
export interface FilaPapelera {
  eliminadoEl?: string | null
  eliminadoPorNombre?: string | null
}

/**
 * Estado y acciones de la papelera para UN listado (`recurso` = el path del
 * backend: `items`, `categorias`, etc.). Se instancia una vez por pantalla —
 * a diferencia de un store, el toggle "ver eliminados" no se comparte entre
 * listados distintos.
 */
export function usePapelera(recurso: string) {
  const verEliminados = ref(false)
  const { public: { apiUrl } } = useRuntimeConfig()
  const { formatFecha } = useFormatters()

  /**
   * `POST /<recurso>/:id/restaurar`. Deja que el error del backend suba tal
   * cual (404 "no está en la papelera", 400 de colisión de nombre con el
   * mensaje de qué renombrar): la pantalla lo muestra en el toast sin
   * reemplazarlo por un genérico.
   */
  async function restaurar(id: string): Promise<void> {
    await useApiFetch(`${apiUrl}/${recurso}/${id}/restaurar`, {
      method: 'POST',
    })
  }

  /** "Eliminado por <nombre> el <fecha>". Vacío si la fila no está eliminada. */
  function formatearBorradoPor(fila: FilaPapelera): string {
    if (!fila.eliminadoEl) return ''
    const autor = fila.eliminadoPorNombre ?? 'usuario eliminado'
    return `Eliminado por ${autor} el ${formatFecha(fila.eliminadoEl)}`
  }

  return { verEliminados, restaurar, formatearBorradoPor }
}
