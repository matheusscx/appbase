import { test, expect, type Page } from '@playwright/test'
import { API, api, crearProducto, limpiarItems, tokenDe, TENANTS } from '../support/api'

/**
 * El detalle de una compra confirmada, por pantalla (spec compras § 6): completar
 * el precio que faltaba, cargar el descuento y anularla.
 *
 * La compra se arma y se confirma por API: recibirla ya está cubierto en el
 * e2e de la API, y lo que se ejercita acá es lo que la pantalla hace con una
 * confirmada. Las cuentas del costo también las cubre el e2e de la API; acá
 * alcanza con que cada acción viaje y la pantalla la refleje.
 */

let escenario: { token?: string, itemIds: string[], proveedorId?: string } = { itemIds: [] }

test.beforeEach(async ({ request }) => {
  escenario = { itemIds: [] }
  escenario.token = await tokenDe(request, TENANTS.restaurante)
})

test.afterEach(async ({ request }) => {
  if (!escenario.token) return
  await limpiarItems(request, escenario.token, escenario.itemIds)
  // El proveedor también: si no, cada corrida deja uno más en el tenant demo
  // (el mismo motivo que `limpiarItems`). La compra anulada queda: es su estado
  // final, y nunca se borra (spec § 4.5).
  if (escenario.proveedorId) {
    const res = await request.delete(`${API}/terceros/${escenario.proveedorId}`, {
      headers: { Authorization: `Bearer ${escenario.token}` },
    })
    if (!res.ok()) {
      console.warn(`[e2e] no se pudo dar de baja el proveedor: ${res.status()} ${await res.text()}`)
    }
  }
})

/** Tipea en un `MoneyInput` tecla por tecla (maska ignora `fill`). */
async function escribirEn(page: Page, qa: string, valor: string) {
  const input = page.locator(`input[data-qa="${qa}"]`)
  await input.selectText()
  await input.pressSequentially(valor)
}

test('completar el precio, cargar el descuento y anular una compra confirmada', async ({ page, request }) => {
  const token = escenario.token!
  const producto = await crearProducto(request, token, {
    nombre: `Tomate compras e2e ${Date.now()}`,
    precioBase: '2000',
    stock: '0',
  })
  escenario.itemIds.push(producto.id)

  const proveedor = await api<{ id: string }>(request, 'post', '/terceros', {
    token,
    data: { tipo: 'proveedor', nombre: `Distribuidora e2e ${Date.now()}` },
  })
  escenario.proveedorId = proveedor.id
  const tipos = await api<{ id: string, requiereFolio: boolean }[]>(
    request, 'get', '/compras/tipos-documento', { token },
  )
  const ubicaciones = await api<{ id: string, tipo: string }[]>(
    request, 'get', '/ubicaciones', { token },
  )
  const borrador = await api<{ id: string, lineas: { id: string }[] }>(
    request, 'post', '/compras', {
      token,
      data: {
        proveedorId: proveedor.id,
        tipoDocumentoCompraId: tipos.find(t => !t.requiereFolio)!.id,
        fechaDocumento: '2026-09-15',
        ubicacionId: ubicaciones.find(u => u.tipo === 'local')!.id,
        lineas: [{ itemId: producto.id, cantidad: '10', unidadCodigo: 'unidad' }],
      },
    },
  )
  await api(request, 'post', `/compras/${borrador.id}/confirmar`, { token })
  const lineaId = borrador.lineas[0]!.id

  await page.goto(`/compras/${borrador.id}`, { waitUntil: 'networkidle' })
  const detalle = page.locator('[data-qa="compra-confirmada"]')
  await expect(detalle).toBeVisible()
  await expect(detalle.getByText('Falta costo')).toBeVisible()

  // Completar el precio que faltaba.
  await page.locator(`[data-qa="compra-corregir-${lineaId}"]`).click()
  const dialogo = page.getByRole('dialog')
  await expect(dialogo).toContainText('Completar el precio')
  await escribirEn(page, 'corregir-precio', '1500')
  await page.locator('[data-qa="corregir-enviar"]').click()
  await expect(dialogo).toHaveCount(0)
  await expect(detalle.getByText('Falta costo')).toHaveCount(0)
  await expect(page.locator('[data-qa="compra-historial"]')).toContainText('Precio')

  // El descuento, que ahora sí se ofrece: todas las líneas tienen precio.
  await page.locator('[data-qa="compra-descuento-abrir"]').click()
  await escribirEn(page, 'descuento-nuevo', '1000')
  await page.locator('[data-qa="descuento-enviar"]').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('[data-qa="compra-descuento-vigente"]')).toBeVisible()
  await expect(page.locator('[data-qa="compra-historial"]')).toContainText('Descuento al total')

  // Anular: frena, dice qué sale, y sin motivo no deja.
  await page.locator('[data-qa="compra-anular-abrir"]').click()
  await expect(page.locator('[data-qa="anular-compra-resumen"]')).toContainText('10 unidad')
  const anular = page.locator('[data-qa="anular-compra-si"]')
  await expect(anular).toBeDisabled()
  await page.locator('[data-qa="anular-compra-motivo"]').fill('Factura cargada dos veces')
  await anular.click()
  await expect(page.locator('[data-qa="compra-anulada-motivo"]')).toContainText('Factura cargada dos veces')
  await expect(page.locator('[data-qa="compra-anular-abrir"]')).toHaveCount(0)
})
