export const HEADER_IDEMPOTENCIA = 'Idempotency-Key'
export const AVISO_COBRO_REPETIDO = 'Este cobro ya había entrado, no se registró dos veces'

/**
 * Una clave por ámbito y por pestaña. A nivel de módulo a propósito: el abono
 * se hace en un modal, y cerrarlo y reabrirlo para la misma venta después de
 * un corte tiene que seguir siendo el mismo intento.
 */
const claves = new Map<string, string>()

/**
 * Un cobro que se repite no se registra dos veces
 * (`docs/adr/026-idempotencia-de-cobros.md`).
 *
 * El backend exige una `Idempotency-Key` por **intento de cobro** en
 * `POST /ventas`, `POST /cuentas/:id/cerrar` y `POST /pagos`. Con la misma
 * clave, el reintento reproduce lo que ya entró (`repetida: true`); con otros
 * datos, responde 422 con la venta.
 *
 * El intento **nace** con el primer Confirmar, **se mantiene** ante cualquier
 * error y ante cualquier edición del carrito o de los pagos —si se regenerara
 * al editar, cambiar tarjeta por efectivo después de un corte sacaría una
 * segunda venta—, y **muere** solo con `terminar()`: cuando el cobro sale
 * bien (también por reproducción) o cuando el carrito se vacía.
 *
 * ⛔ Nunca reintenta sola: el que vuelve a confirmar es el cajero (decisión
 * del owner, 2026-09-11).
 *
 * Se crea en el setup (usa `useToast`, que no se puede llamar después de un
 * `await`) y el **ámbito** —qué es "el carrito" en cada pantalla— viaja en
 * cada llamada: `'pos'`, `'tienda'`, `cuenta:<id>` en el salón,
 * `abono:<ventaId>` en el abono. Así el salón usa la cuenta que congeló el
 * cobro, no la que esté en pantalla cuando vuelve el `POST`.
 */
export function useIntentoCobro() {
  const toast = useToast()

  function clave(ambito: string): string {
    let actual = claves.get(ambito)
    if (!actual) {
      actual = crypto.randomUUID()
      claves.set(ambito, actual)
    }
    return actual
  }

  return {
    /** Las opciones `headers` del `POST` que cobra. */
    cabecera: (ambito: string): Record<string, string> => ({
      [HEADER_IDEMPOTENCIA]: clave(ambito),
    }),

    /** El intento terminó (éxito o carrito vacío): el próximo cobro es otro. */
    terminar: (ambito: string): void => {
      claves.delete(ambito)
    },

    /**
     * El cobro ya había entrado y el backend lo reprodujo: el flujo de éxito
     * sigue igual —boleta incluida, porque la primera respuesta se perdió—, y
     * esto le avisa al cajero que no hace falta volver a pasar la tarjeta.
     */
    avisarSiRepetido: (respuesta: { repetida?: boolean }): void => {
      if (respuesta.repetida === true)
        toast.add({ title: AVISO_COBRO_REPETIDO, color: 'warning' })
    },

    /**
     * Si el error es el 422 de "este cobro ya se registró con otros datos",
     * muestra el mensaje del backend con *Ver venta* y devuelve `true`: la
     * pantalla no limpia nada, la decisión es del cajero. Cualquier otro error
     * devuelve `false` y lo maneja la pantalla como siempre.
     *
     * **El aviso cierra el intento** (owner, 2026-09-19): el cajero ya vio que
     * la primera entró, así que el Confirmar siguiente —cobrar de nuevo en
     * efectivo, o después de anular la primera— es una venta nueva, sin
     * rearmar el carrito. Con la clave viva, cada Confirmar volvería a chocar
     * con la venta de antes.
     */
    mostrarSiCobroConOtrosDatos: (error: unknown, ambito: string): boolean => {
      const e = error as { status?: number, data?: { ventaId?: unknown } }
      const ventaId = e?.data?.ventaId
      if (e?.status !== 422 || typeof ventaId !== 'string' || !ventaId) return false
      claves.delete(ambito)
      toast.add({
        title: apiErrorMsg(error, 'Este cobro ya se había registrado con otros datos'),
        color: 'error',
        actions: [
          {
            label: 'Ver venta',
            color: 'neutral',
            variant: 'outline',
            onClick: (ev?: Event) => {
              ev?.stopPropagation()
              void navigateTo({ path: '/ventas', query: { venta: ventaId } })
            },
          },
        ],
      })
      return true
    },
  }
}
