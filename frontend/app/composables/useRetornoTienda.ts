/** Lo que devuelve `GET /online/orden/:id` en `estado`: los de `pasarela_ordenes.estado`
 *  (`backend/src/modules/pasarela/entities/pasarela-orden.entity.ts`) más
 *  `pagada_sin_venta`, que el backend arma para la app (`estadoParaLaApp`). */
export type EstadoOrdenTienda =
  | 'creada' | 'en_proceso' | 'procesando' | 'pagada' | 'pagada_sin_venta'
  | 'pendiente' | 'conciliada' | 'fallida' | 'expirada' | 'reembolsada'

export type VistaRetorno = 'aprobada' | 'sin_venta' | 'devuelto' | 'rechazada' | 'pendiente' | 'error'

export interface ResultadoRetorno {
  vista: VistaRetorno
  /** Vaciar el carrito: solo cuando el cargo existe. Lleno invita a pagar dos veces. */
  limpiaCarrito: boolean
}

const RESULTADO: Record<EstadoOrdenTienda, ResultadoRetorno> = {
  pagada: { vista: 'aprobada', limpiaCarrito: true },
  conciliada: { vista: 'aprobada', limpiaCarrito: true },
  // Se cobró y la venta no se pudo crear: no decir "registrada" (el admin ya
  // tiene el aviso en `/ordenes`).
  pagada_sin_venta: { vista: 'sin_venta', limpiaCarrito: true },
  // Se cobró y el local devolvió el cargo (puede pasar mientras se crea la
  // venta). No es un rechazo: lleno invitaría a pagar de nuevo lo devuelto.
  reembolsada: { vista: 'devuelto', limpiaCarrito: true },
  pendiente: { vista: 'pendiente', limpiaCarrito: false },
  // Sin resolver: el retorno todavía confirma (`procesando`) o no llegó a
  // empezar (`en_proceso`, `creada`), y el cargo pudo salir. Decirle "rechazado"
  // invitaba a pagar de nuevo (pendientes.md § 2, resuelto el 2026-10-11).
  en_proceso: { vista: 'pendiente', limpiaCarrito: false },
  procesando: { vista: 'pendiente', limpiaCarrito: false },
  creada: { vista: 'pendiente', limpiaCarrito: false },
  fallida: { vista: 'rechazada', limpiaCarrito: false },
  expirada: { vista: 'rechazada', limpiaCarrito: false },
}

/**
 * Qué ve el comprador al volver de Webpay, según el estado real de la orden.
 *
 * El mapa es un `Record<EstadoOrdenTienda, …>` completo: sumar un estado a la
 * unión no compila hasta darle vista. Y un estado que el backend mande sin que
 * este front lo conozca cae a `error` ("No pudimos verificar el pago"), nunca a
 * "rechazado": antes la rama final de la página mandaba ahí todo lo no listado,
 * y así una orden sin resolver le decía al comprador que reintentara.
 */
export function useRetornoTienda() {
  function resolverRetorno(estado: string): ResultadoRetorno {
    return (RESULTADO as Record<string, ResultadoRetorno | undefined>)[estado]
      ?? { vista: 'error', limpiaCarrito: false }
  }

  return { resolverRetorno }
}
