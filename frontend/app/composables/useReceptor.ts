/**
 * El receptor de una venta en la pantalla: el RUT y "qué le falta para cobrar".
 * La regla es del servidor (`VentasService.receptorDeLaVenta`); acá se repite
 * para avisar antes de cobrar, y el servidor la vuelve a exigir.
 *
 * La pantalla no conoce el país: lo dice cada tipo de documento
 * (`GET /tipos-documento`, `receptorCompleto`, `rutChileno` y `umbralIdentidad`).
 */
import Decimal from 'decimal.js'

/** Los largos del SII (Formato DTE v2.5, zona Receptor). Gemelos del DTO. */
export const LARGO_RECEPTOR = {
  nombre: 100,
  giro: 40,
  direccion: 70,
  comuna: 20,
} as const

/**
 * Sin puntos ni espacios, `K` mayúscula, guion antes del DV. Gemela de
 * `normalizarRut` en `backend/src/common/utils/rut.util.ts`.
 */
export function normalizarRut(rut: string): string {
  const limpio = rut.trim().toUpperCase().replace(/[.\s]/g, '').replace(/-/g, '')
  return `${limpio.slice(0, -1)}-${limpio.slice(-1)}`
}

/**
 * Cuerpo entre 100.000 y 99.999.999 y DV módulo 11 (SII, Formato DTE v2.5,
 * campo 50). Gemela de `rutValido` en `backend/src/common/utils/rut.util.ts`:
 * los mismos casos están en las dos specs.
 */
export function rutValido(rut: string): boolean {
  const [cuerpo = '', dv = ''] = normalizarRut(rut).split('-')
  if (!/^\d+$/.test(cuerpo) || !/^[\dK]$/.test(dv)) return false
  const n = Number(cuerpo)
  if (n < 100_000 || n > 99_999_999) return false
  let suma = 0
  let factor = 2
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor
    factor = factor === 7 ? 2 : factor + 1
  }
  const resto = 11 - (suma % 11)
  const esperado = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto)
  return dv === esperado
}

export interface ReglaReceptor {
  /** El tipo exige el receptor tributario completo (la Factura chilena). */
  receptorCompleto: boolean
  /** El RUT que venga se valida con DV módulo 11. */
  rutChileno: boolean
  /**
   * La boleta pasó el umbral de la Res. Ex. SII 44/2025: lleva nombre y RUT de
   * quien paga. Ver `sobreUmbralIdentidad`.
   */
  identidadPagador?: boolean
}

/**
 * ¿El total pasa el umbral sobre el que la boleta lleva nombre y RUT de quien
 * paga? Estricto (la norma dice *"exceda"*) y sobre el total de la venta
 * entera, nunca por pago. Gemela de `faltaIdentidadDelPagador` en
 * `backend/src/modules/ventas/ventas.service.ts`, que lo vuelve a exigir. Sin
 * umbral (otro tipo, otro país) o sin total todavía, no.
 */
export function sobreUmbralIdentidad(
  total: string | null | undefined,
  umbral: string | null | undefined,
): boolean {
  if (!total || !umbral) return false
  return new Decimal(total).gt(umbral)
}

export interface ReceptorEnPantalla {
  nombre: string
  rut: string
  giro: string
  direccion: string
  comuna: string
}

/**
 * Lo primero que le impide cobrar al receptor, en palabras del cajero, o `null`
 * si está listo. Mismo orden que el servidor: lo que falta, después el RUT.
 * Los largos también, porque un tercero precargado puede traer una dirección
 * más larga que la del SII y el campo no la corta. El largo se mide sin
 * `trim`, como el `@MaxLength` del DTO.
 */
export function problemaDelReceptor(c: ReceptorEnPantalla, regla: ReglaReceptor): string | null {
  if (!c.nombre.trim()) return 'Falta el nombre o razón social del cliente'
  if (regla.receptorCompleto) {
    const faltan = ([
      ['RUT', c.rut],
      ['giro', c.giro],
      ['dirección', c.direccion],
      ['comuna', c.comuna],
    ] as const).filter(([, v]) => !v.trim()).map(([campo]) => campo)
    if (faltan.length) return `La factura requiere del cliente: ${faltan.join(', ')}`
  }
  if (regla.identidadPagador && !c.rut.trim()) {
    return 'Una boleta de este monto lleva el RUT de quien paga'
  }
  for (const [campo, etiqueta] of [
    ['nombre', 'La razón social'],
    ['giro', 'El giro'],
    ['direccion', 'La dirección'],
    ['comuna', 'La comuna'],
  ] as const) {
    if (c[campo].length > LARGO_RECEPTOR[campo]) {
      return `${etiqueta} no puede pasar de ${LARGO_RECEPTOR[campo]} caracteres (límite del SII)`
    }
  }
  if (regla.rutChileno && c.rut.trim() && !rutValido(c.rut)) return 'El RUT del cliente no es válido'
  return null
}

/**
 * El receptor que el cajero captura en una nota de crédito cuando la venta no
 * tiene cliente: solo nombre y RUT, lo que el SII exige en la nota (owner,
 * 2026-10-04). Vacío es válido —la nota va a nombre del local—; si viene uno,
 * va el otro. Gemela de `crearNotaCreditoEnTransaccion` en el backend, que la
 * vuelve a exigir.
 */
export function problemaDelReceptorDeNota(
  r: { nombre: string, rut: string },
  rutChileno: boolean,
): string | null {
  const nombre = r.nombre.trim()
  const rut = r.rut.trim()
  if (!nombre && !rut) return null
  if (!nombre) return 'Falta el nombre del cliente'
  if (!rut) return 'Falta el RUT del cliente'
  if (r.nombre.length > LARGO_RECEPTOR.nombre) {
    return `La razón social no puede pasar de ${LARGO_RECEPTOR.nombre} caracteres (límite del SII)`
  }
  if (rutChileno && !rutValido(rut)) return 'El RUT del cliente no es válido'
  return null
}
