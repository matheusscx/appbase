import { test, expect } from '../support/sesion'
import {
  abrirCaja,
  api,
  API,
  cerrarCaja,
  crearProducto,
  limpiarItems,
  EFECTIVO,
  tokenDe,
  TENANTS,
} from '../support/api'

/**
 * Propinas: se liquida el reparto que se vio, y solo después de confirmarlo
 * (auditoría UX 2026-10-16, hallazgo 02.1). Antes "Liquidar período" mandaba las fechas
 * del formulario aunque el reparto en pantalla fuera de otro período, y de un toque.
 *
 * **No liquida.** Liquidar saca las propinas del pool para siempre y el seed es
 * compartido: el spec llega hasta el modal y lo cancela. Lo que se manda al confirmar
 * lo cubre `pages/propinas/index.nuxt.spec.ts`.
 *
 * La propina se siembra por API con una venta del admin en su caja (molde de
 * `reimprimir-boleta-cajera.spec.ts`), así el fondo del día nunca es cero, que apagaría
 * el botón. Una propina sin nadie que la reciba no arma reparto (el preview contesta 400
 * "ningún participante puede recibirlas"): por eso un garzón propio entra a turno hoy
 * (molde de `cuenta-calculo-rechazado.spec.ts`; no se usa a la garzona del seed). El
 * fondo trae además lo que hayan dejado otros specs: se compara la cifra del modal con
 * la de la pantalla, no con un número fijo.
 */

const PRECIO_BASE = '1000'
const PROPINA = '500.0000'
/** Afecto + IVA 19%: 1.000 × 1,19 = 1.190, más $500 de propina. Es lo que la caja espera al cerrar. */
const COBRADO = '1690.0000'

/** `cobrado`: lo que la caja tiene que contar al cerrar; queda en 0 si la venta no llegó a crearse. */
let escenario: {
  token?: string
  cajaId?: string
  itemId?: string
  cobrado?: string
  garzon?: { id: string, pin: string }
} = {}

test.beforeEach(async ({ request }) => {
  escenario = {}
  escenario.token = await tokenDe(request, TENANTS.restaurante)
  escenario.cajaId = await abrirCaja(request, escenario.token)

  const garzon = await api<{ id: string, pin: string }>(request, 'post', '/garzones', {
    token: escenario.token,
    data: { nombre: `Garzón propinas E2E ${Date.now()}` },
  })
  escenario.garzon = garzon
  const turnos = await api<{ id: string, activo: boolean }[]>(request, 'get', '/turnos', { token: escenario.token })
  const turnoId = turnos.find(t => t.activo)?.id
  if (!turnoId) throw new Error('El seed no tiene ningún turno activo')
  await api(request, 'post', '/sesiones-garzon/iniciar', {
    token: escenario.token,
    data: { garzonId: garzon.id, pin: garzon.pin, turnoId },
  })
})

test.afterEach(async ({ request }) => {
  const { token, cajaId, itemId, cobrado, garzon } = escenario
  if (token && cajaId) await cerrarCaja(request, token, cajaId, cobrado ?? '0')
  if (token && itemId) await limpiarItems(request, token, [itemId])
  if (token && garzon) {
    const res = await request.post(`${API}/sesiones-garzon/cerrar`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { garzonId: garzon.id, pin: garzon.pin },
    })
    if (!res.ok()) {
      console.warn(`[e2e] no se pudo cerrar la sesión del garzón ${garzon.id}: ${res.status()} ${await res.text()}`)
    }
  }
})

/** `YYYY-MM-DD` del día anterior, sin pasar por la zona horaria. */
function diaAnterior(fecha: string): string {
  const [y, m, d] = fecha.split('-').map(Number)
  const anterior = new Date(Date.UTC(y!, m! - 1, d! - 1))
  return anterior.toISOString().slice(0, 10)
}

test('cambiar el período apaga "Liquidar período", y liquidar pide confirmar el fondo', async ({ page, request }) => {
  const token = escenario.token!
  const producto = await crearProducto(request, token, {
    nombre: `Propina liquidar E2E ${Date.now()}`,
    precioBase: PRECIO_BASE,
  })
  escenario.itemId = producto.id
  await api(request, 'post', '/ventas', {
    token,
    data: {
      lineas: [{ itemId: producto.id, cantidad: '1' }],
      pagos: [{ metodoPagoId: EFECTIVO, monto: COBRADO }],
      propinaDirecta: { montoPagado: PROPINA, porcentajeSugerido: '0.10' },
    },
  })
  escenario.cobrado = COBRADO
  const { diaNegocioHoy } = await api<{ diaNegocioHoy: string }>(request, 'get', '/tenants/me', { token })

  await page.goto('/propinas')
  const fijarFecha = (qa: string, valor: string) =>
    page.locator(`[data-qa="${qa}"]`).evaluate(
      (el, v) => el.dispatchEvent(new CustomEvent('qa-set-value', { detail: v })),
      valor,
    )
  await fijarFecha('prop-desde', diaNegocioHoy)
  await fijarFecha('prop-hasta', diaNegocioHoy)
  await page.getByRole('button', { name: 'Ver reparto' }).click()

  const fondo = page.getByText('Fondo total del período').locator('xpath=following-sibling::p[1]')
  await expect(fondo).toBeVisible()
  const liquidar = page.getByRole('button', { name: 'Liquidar período' })
  await expect(liquidar).toBeEnabled()

  // Cambiar "Desde" sin volver a calcular: el reparto de la pantalla ya no es el del formulario.
  await fijarFecha('prop-desde', diaAnterior(diaNegocioHoy))
  await expect(page.getByText('vuelve a calcular el reparto para liquidar')).toBeVisible()
  await expect(liquidar).toBeDisabled()

  // Volver al período mostrado lo deja como estaba, sin pedir otro reparto.
  await fijarFecha('prop-desde', diaNegocioHoy)
  await expect(liquidar).toBeEnabled()

  await liquidar.click()
  const dialogo = page.getByRole('dialog').filter({ hasText: 'Liquidar el período' })
  await expect(dialogo).toBeVisible()
  const cifra = (await fondo.textContent())!.trim()
  await expect(dialogo.getByText('Fondo a repartir').locator('xpath=following-sibling::p[1]')).toHaveText(cifra)
  await expect(dialogo.getByRole('button', { name: `Liquidar ${cifra}` })).toBeVisible()

  await dialogo.getByRole('button', { name: 'Cancelar' }).click()
  await expect(dialogo).toBeHidden()
})
