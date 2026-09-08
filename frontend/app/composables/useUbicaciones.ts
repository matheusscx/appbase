export interface Ubicacion {
  id: string
  nombre: string
  tipo: 'local' | 'bodega'
  activo: boolean
}

/**
 * Las ubicaciones del tenant, para los selectores de inventario.
 *
 * `hayBodegas` es la que gobierna la regla del frente de bodegas
 * (`docs/features/bodegas-y-traslados.md`, «Frontend»): mientras exista una
 * sola ubicación, **el selector no se dibuja** (escondido, no deshabilitado) y
 * el `ubicacionId` lo completa el cliente con el local. Sin esto, el tenant
 * que nunca va a tener una bodega paga un campo obligatorio que siempre dice
 * lo mismo, en cuatro pantallas: mermas (Tarea 10), recuentos (Tarea 11), el
 * ajuste de stock / la entrada por compra (Tarea 12) y traslados (Tarea 13).
 *
 * `useState`, no un `ref` local: las cuatro pantallas comparten la misma
 * carga — sin esto cada una dispara su propio `GET /ubicaciones` al montarse.
 *
 * `GET /ubicaciones` sin `soloActivas`: una bodega desactivada (pero no
 * borrada) puede seguir teniendo stock físico, y una merma, un recuento o un
 * ajuste sobre lo que hay ahí es un evento real — desactivarla no es
 * eliminarla (mismo criterio que ya usa `TrasladosService` para el ORIGEN de
 * un traslado). El filtro que sí aplica siempre es el de borrado, que trae el
 * endpoint por default.
 */
export function useUbicaciones() {
  const apiUrl = useRuntimeConfig().public.apiUrl

  const ubicaciones = useState<Ubicacion[]>('ubicaciones', () => [])

  const local = computed(() => ubicaciones.value.find(u => u.tipo === 'local') ?? null)
  const hayBodegas = computed(() => ubicaciones.value.some(u => u.tipo === 'bodega'))

  const cargar = async () => {
    ubicaciones.value = await useApiFetch<Ubicacion[]>(`${apiUrl}/ubicaciones`)
  }

  return { ubicaciones, local, hayBodegas, cargar }
}
