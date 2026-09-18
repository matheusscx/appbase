import type { BoletaVentaItem } from '~/utils/ticket-builder'

/**
 * Espejo de `BoletaVenta` (`backend/src/modules/ventas/ventas.service.ts`): el
 * papel de la venta, armado desde `venta_detalles` y sus tablas hijas ya
 * persistidas — no del carrito vivo ni del motor de cálculo. Copiado a mano,
 * mismo criterio que el resto del frontend mientras backend y frontend no
 * comparten workspace.
 *
 * Único lugar de este tipo en el frontend. Hasta el 2026-09-17 estaba
 * duplicado a mano en `useSalones.ts` (cierre de cuenta) y `pos.vue`
 * (`POST /ventas`, como subconjunto) — al sumarse `VentaDetalleDrawer.vue`
 * (`GET /ventas/:id/boleta`, reimpresión) como tercera copia, se extrajo acá
 * siguiendo la regla del repo (duplicar dos veces se tolera, a la tercera se
 * extrae — `CLAUDE.md` § Archivos) y la convención ya usada por
 * `~/types/moneda.ts` / `~/types/usuario-preferencias.ts` para tipos
 * compartidos del frontend. `useSalones.ts` reexporta este tipo para no
 * romper a quien ya lo importaba de ahí.
 *
 * `items` es `BoletaVentaItem[]` (`~/utils/ticket-builder.ts`), el mismo shape
 * que consume `itemsParaBoletaImpresion` — el mapeo compartido al `BoletaItem`
 * del ticket, extraído el mismo día y por la misma regla que este tipo.
 */
export interface BoletaVenta {
  ventaId: string
  fecha: string
  canal: string
  mesa: string | null
  cuentaNumero: number | null
  cajero: string | null
  items: BoletaVentaItem[]
  totales: {
    subtotalNeto: string
    totalDescuentos: string
    totalRecargos: string
    totalImpuestos: string
    totalFinal: string
  }
  impuestos: { nombre: string, tasa: string, monto: string }[]
  promociones: { id: string, nombre: string, monto: string }[]
  customer: { nombre: string, rut: string | null, direccion: string | null } | null
  propina: { monto: string } | null
  pagos: { nombre: string, monto: string }[]
  vuelto: string | null
}
