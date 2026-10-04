import { test, expect, type Route } from '@playwright/test'
import {
  abrirCaja,
  api,
  cerrarCaja,
  crearProducto,
  limpiarItems,
  tokenDe,
  TENANTS,
} from '../support/api'

/**
 * La nota de crédito "por el pago" dice por qué ofrece menos cuando un reembolso
 * por Transbank quedó sin confirmar (decisión del owner, 2026-10-04): ese
 * reembolso pudo haber devuelto la plata, el backend ya lo descontó del tope de
 * la opción y la pantalla lo explica.
 *
 * ⚠️ **El descuento se inyecta en la respuesta real del detalle; no se fabrica en
 * la base.** Un REFUND sin confirmar sale de una orden cobrada por Transbank y de
 * una llamada que no contestó, y el stack no tiene doble del proveedor. Lo que el
 * servidor descuenta, y que la nota de más rebota, lo fija el e2e de API
 * (`backend/test/pasarela-reembolso.e2e-spec.ts`, "un REFUND sin confirmar gasta
 * el tope por pago de la nota del POS"). Acá se prueba lo que pinta el navegador
 * con lo que el servidor publica, por eso el test no emite la nota: el servidor
 * real no tiene el descuento y la aceptaría.
 */

const DEBITO = '550e8400-e29b-41d4-a716-446655440106'
/** $10.000 + 19% de IVA. */
const TOTAL_VENTA_API = '11900.0000'
/** Lo que el backend publicaría con $1.900 en un reembolso sin confirmar. */
const QUEDA_API = '10000.0000'
const SIN_CONFIRMAR_API = '1900.0000'

let escenario: { token?: string; cajaId?: string; itemIds: string[] } = {
  itemIds: [],
}

test.beforeEach(async ({ request }) => {
  escenario = { itemIds: [] }
  escenario.token = await tokenDe(request, TENANTS.restaurante)
  escenario.cajaId = await abrirCaja(request, escenario.token)
})

test.afterEach(async ({ request }) => {
  const { token, cajaId, itemIds } = escenario
  if (!token) return
  if (cajaId) await cerrarCaja(request, token, cajaId, '0')
  await limpiarItems(request, token, itemIds)
})

test('la opción del pago ofrece lo que queda y dice cuánto está en un reembolso por Transbank sin confirmar', async ({
  page,
  request,
}) => {
  const token = escenario.token!
  const producto = await crearProducto(request, token, {
    nombre: `NC sin confirmar ${Date.now()}`,
    precioBase: '10000',
  })
  escenario.itemIds.push(producto.id)
  const tipos = await api<{ id: string; esBoleta: boolean }[]>(
    request,
    'get',
    '/tipos-documento',
    { token },
  )
  const venta = await api<{ id: string; estado: string }>(request, 'post', '/ventas', {
    token,
    data: {
      lineas: [{ itemId: producto.id, cantidad: '1' }],
      pagos: [{ metodoPagoId: DEBITO, monto: TOTAL_VENTA_API }],
      tipoDocumentoId: tipos.find(t => t.esBoleta)?.id,
    },
  })
  expect(venta.estado).toBe('pagada')

  let inyectado = false
  await page.route(`**/api/ventas/${venta.id}*`, async (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const respuesta = await route.fetch()
    const cuerpo = (await respuesta.json()) as {
      opcionesDevolucion?: { sinPlata: boolean, monto: string, sinConfirmar: string | null }[]
    }
    // Lo que publica hoy, sin descuento: el campo existe y viene en null.
    const pago = cuerpo.opcionesDevolucion?.find(o => !o.sinPlata)
    if (pago) {
      expect(pago).toMatchObject({ monto: TOTAL_VENTA_API, sinConfirmar: null })
      pago.monto = QUEDA_API
      pago.sinConfirmar = SIN_CONFIRMAR_API
      inyectado = true
    }
    await route.fulfill({ response: respuesta, json: cuerpo })
  })

  await page.goto(`/ventas?venta=${venta.id}`)
  const detalle = page.getByRole('dialog').filter({ hasText: 'Detalle de venta' })
  await detalle.getByRole('button', { name: 'Nota de crédito' }).click()
  const modal = page.getByRole('dialog').filter({ hasText: 'Nota de crédito' })
  expect(inyectado).toBe(true)

  const opcion = modal.getByRole('radio', { name: /Tarjeta de débito/ })
  // Una sola forma de devolver: viene elegida, con lo que queda en el rótulo.
  await expect(opcion).toBeChecked()
  await expect(opcion).toHaveAccessibleName(/\$10\.000/)
  await expect(modal.locator('[data-qa="por-donde-vuelve"]')).toContainText(
    '$1.900 en un reembolso por Transbank sin confirmar.',
  )
})
