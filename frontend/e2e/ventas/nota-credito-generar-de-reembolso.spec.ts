import { randomUUID } from 'node:crypto'
import type { Route } from '@playwright/test'
import { test, expect } from '../support/sesion'
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
 * "Generar nota" (owner, 2026-10-02): en el historial de la orden, el reembolso
 * aprobado que quedó sin nota de crédito aparece marcado, y el botón abre la
 * nota con lo que declaró el reembolso ya cargado —"¿vuelve al stock o se
 * perdió?" incluido—.
 *
 * ⚠️ **La orden se inyecta; la venta es real.** Un REFUND sin nota sale de una
 * orden cobrada por Transbank y de una nota que falló, y el stack no tiene doble
 * del proveedor. Lo que hace el servidor —la nota por el monto del REFUND, sin
 * llamar a Transbank, una por intento, 409/422, la regla de las líneas— lo fija
 * el e2e de API (`backend/test/pasarela-generar-nota.e2e-spec.ts`). Acá se
 * prueba lo que pinta el navegador con lo que el servidor publica y lo que
 * manda: las líneas salen del detalle REAL de la venta, y el POST se responde
 * como lo haría el servidor (la orden no existe en la base).
 */

const DEBITO = '550e8400-e29b-41d4-a716-446655440106'
/** $10.000 + 19% de IVA. */
const TOTAL_VENTA_API = '11900.0000'

let escenario: { token?: string, cajaId?: string, itemIds: string[] } = {
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

test('el reembolso sin nota se marca, y "Generar nota" la emite con lo que declaró el reembolso', async ({
  page,
  request,
}) => {
  const token = escenario.token!
  const producto = await crearProducto(request, token, {
    nombre: `GN botella ${Date.now()}`,
    precioBase: '10000',
  })
  escenario.itemIds.push(producto.id)
  const tipos = await api<{ id: string, esBoleta: boolean }[]>(request, 'get', '/tipos-documento', { token })
  const venta = await api<{ id: string, estado: string }>(request, 'post', '/ventas', {
    token,
    data: {
      lineas: [{ itemId: producto.id, cantidad: '1' }],
      pagos: [{ metodoPagoId: DEBITO, monto: TOTAL_VENTA_API }],
      tipoDocumentoId: tipos.find(t => t.esBoleta)?.id,
    },
  })
  expect(venta.estado).toBe('pagada')

  const ordenId = randomUUID()
  const refundId = randomUUID()
  const declarado = [{ itemId: producto.id, cantidad: '1', stock: 'pierde' }]
  let notaId: string | null = null
  const orden = () => ({
    ordenId,
    codigoOrden: 'OGNE2E',
    pagadorRef: null,
    referenciaExterna: null,
    ventaId: venta.id,
    descripcion: `Compra online GN ${ordenId.slice(0, 8)}`,
    monto: '11900',
    moneda: 'CLP',
    estado: 'reembolsada',
    origen: 'interno',
    creadoEl: new Date().toISOString(),
  })
  await page.route('**/api/pasarela/admin/ordenes?*', (route: Route) =>
    route.fulfill({
      json: { data: [orden()], meta: { total: 1, page: 1, pageSize: 20, totalPages: 1 } },
    }),
  )
  await page.route(`**/api/pasarela/admin/ordenes/${ordenId}`, (route: Route) =>
    route.fulfill({
      json: {
        ...orden(),
        transacciones: [
          {
            transaccionId: refundId,
            tipo: 'REFUND',
            estado: 'aprobada',
            monto: '11900.000000',
            codigoAutorizacion: 'AUT',
            codigoRespuesta: '0',
            fechaTransaccion: new Date().toISOString(),
            correccionVentaId: notaId,
            devoluciones: declarado,
          },
        ],
      },
    }),
  )
  let cuerpo: unknown = null
  let clave: string | undefined
  await page.route(`**/api/pasarela/admin/ordenes/${ordenId}/reembolsos/${refundId}/nota`, (route: Route) => {
    cuerpo = route.request().postDataJSON()
    clave = route.request().headers()['idempotency-key']
    notaId = randomUUID()
    return route.fulfill({ status: 201, json: { ...orden(), notaCreditoId: notaId } })
  })

  await page.goto('/ordenes')
  await page.getByText(orden().descripcion).click()
  const drawer = page.getByRole('dialog').filter({ hasText: 'Detalle de orden' })
  await expect(drawer).toContainText('Sin nota de crédito')
  await drawer.getByRole('button', { name: 'Generar nota' }).click()

  const modal = page.getByRole('dialog').filter({ hasText: 'Generar nota de crédito' })
  await expect(modal).toContainText('ya volvió por Transbank')
  // Lo que declaró el reembolso, precargado desde la venta real.
  const fila = modal.getByTestId(`devolucion-fila-${producto.id}`)
  await expect(fila.getByRole('textbox')).toHaveValue('1')
  await expect(fila.getByRole('radio', { name: 'Se perdió' })).toBeChecked()

  await modal.getByRole('button', { name: 'Generar nota', exact: true }).click()
  // `.first()`: el toast pinta el texto dos veces (su título y el `role="alert"`
  // que anuncia el lector de pantalla), y en strict mode eso es un error (CI).
  await expect(page.getByText('Nota de crédito generada').first()).toBeVisible()
  expect(cuerpo).toEqual({ devoluciones: declarado })
  expect(clave).toMatch(/^[0-9a-f-]{36}$/)
  // La orden se recargó: el reembolso ya tiene su nota y deja de estar marcado.
  await expect(drawer).not.toContainText('Sin nota de crédito')
  await expect(drawer.getByRole('button', { name: 'Generar nota' })).toHaveCount(0)
})
