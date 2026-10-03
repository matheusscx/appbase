import { test, expect, type Page } from '@playwright/test'
import { API, api, crearProducto, limpiarItems, tokenDe, TENANTS } from '../support/api'

/**
 * Compras — la deuda con el proveedor, **como el bodeguero**
 * (`encargado.compras@paris.cl`: Compras Leer/Crear/Actualizar/Anular, SIN
 * `Pagar` — spec `2026-09-28-compras-deuda-proveedor-design.md` § 2 decisión
 * 7b, "el bodeguero recibe y el dueño paga").
 *
 * Cubre spec § 12: sin `Pagar` no aparece "¿la pagaste ya?" al confirmar, ni
 * la entrada "Por pagar" en la navegación, ni la insignia de pago del
 * listado; y entrar por URL a `/compras/por-pagar` lo frena el middleware de
 * ruta (pattern frontend § 1.2). El 403 de la API que respalda cada uno de
 * estos escondites ya está cubierto por `backend/test/compras.e2e-spec.ts`
 * (spec § 12: "403 con el rol real del bodeguero").
 *
 * No abre ninguna caja: el bodeguero no paga, así que no hay nada que fondear
 * ni cerrar acá.
 */

const ENCARGADO = { email: 'encargado.compras@paris.cl', password: 'admin' }

test.use({ storageState: { cookies: [], origins: [] } })

/** Login por pantalla. Un solo tenant: entra directo, sin elegir. */
async function entrarComoEncargado(page: Page) {
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.getByPlaceholder('tu@email.com').fill(ENCARGADO.email)
  await page.locator('input[type="password"]').first().fill(ENCARGADO.password)
  const submit = page.locator('button[type="submit"]').first()
  await expect(submit).toBeEnabled()
  await submit.click()
  await page.waitForURL(url => url.pathname === '/')
}

test('la navegación no ofrece "Por pagar"', async ({ page }) => {
  await entrarComoEncargado(page)
  await page.goto('/compras', { waitUntil: 'networkidle' })
  const menu = page.locator('[data-qa="menu-lateral"]')
  // El grupo tiene que estar abierto: cerrado, sus pantallas no se dibujan y el
  // `toHaveCount(0)` de abajo pasaría aunque el rol pudiera pagar.
  await expect(menu.getByRole('button', { name: 'Compras', exact: true }))
    .toHaveAttribute('aria-expanded', 'true')
  // "Recepciones" sí, porque tiene `Leer`.
  await expect(menu.getByRole('link', { name: 'Recepciones', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Por pagar' })).toHaveCount(0)
  // Y ningún grupo sin pantallas: de todo el menú, el bodeguero ve Inicio y Compras.
  await expect(menu.getByRole('button')).toHaveText(['Compras'])
  await expect(menu.getByRole('link')).toHaveText(['Inicio', 'Recepciones'])
})

test('entrar por URL a /compras/por-pagar lo frena el middleware de ruta', async ({ page }) => {
  await entrarComoEncargado(page)
  await page.goto('/compras/por-pagar', { waitUntil: 'networkidle' })
  // El middleware `permiso` redirige a `/ventas` (pattern frontend § 1.2):
  // la pantalla nunca llega a montarse, y ningún dato de pago viaja.
  await page.waitForURL(url => url.pathname === '/ventas')
  await expect(page.locator('[data-qa="por-pagar"]')).toHaveCount(0)
})

test('el listado de compras no lleva insignia de pago ni el filtro de estado de pago', async ({ page }) => {
  await entrarComoEncargado(page)
  await page.goto('/compras', { waitUntil: 'networkidle' })
  await expect(page.locator('[data-qa="compras-filtro-estado-pago"]')).toHaveCount(0)
})

test('confirmar una compra no ofrece "¿la pagaste ya?"', async ({ page, request }) => {
  // Precondición mínima: un proveedor y un producto propios, por API con
  // admin (crear ítems y proveedores no es de Compras — mismo criterio que
  // `compras-por-pantalla.spec.ts`).
  const sello = Date.now()
  const nombreProveedor = `Sin Pagar e2e ${sello}`
  const nombreProducto = `Sin Pagar item ${sello}`
  const token = await tokenDe(request, TENANTS.restaurante)
  const proveedor = await api<{ id: string }>(request, 'post', '/terceros', {
    token, data: { tipo: 'proveedor', nombre: nombreProveedor },
  })
  const producto = await crearProducto(request, token, { nombre: nombreProducto, precioBase: '1000', stock: '0' })

  try {
    await entrarComoEncargado(page)
    await page.goto('/compras/nueva', { waitUntil: 'networkidle' })

    await page.getByText('A quién se le compró').click()
    await page.keyboard.type(nombreProveedor)
    await page.getByRole('option', { name: nombreProveedor }).click()
    await expect(page.getByRole('listbox')).toHaveCount(0)

    // "Sin documento" no pide folio: el sujeto de este test es que no aparezca
    // "¿la pagaste ya?", no el documento.
    await page.getByText('Factura, boleta, sin documento…').click()
    await page.getByRole('option', { name: 'Sin documento', exact: true }).click()
    await expect(page.getByRole('listbox')).toHaveCount(0)

    const ubicaciones = await api<{ id: string, tipo: string, nombre: string }[]>(
      request, 'get', '/ubicaciones', { token },
    )
    const local = ubicaciones.find(u => u.tipo === 'local')!
    await page.getByText('Local o bodega').click()
    await page.getByRole('option', { name: local.nombre, exact: true }).click()
    await expect(page.getByRole('listbox')).toHaveCount(0)

    const linea = page.locator('[data-qa="compra-linea"]').first()
    await linea.getByText('Selecciona un producto').click()
    await page.keyboard.type(nombreProducto)
    await page.getByRole('option', { name: nombreProducto }).click()
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await linea.locator('input[data-qa="compra-cantidad"]').fill('1')
    const precio = linea.locator('input[data-qa="compra-precio"]')
    await precio.selectText()
    await precio.pressSequentially('1000')

    await page.locator('[data-qa="compra-guardar"]').click()
    await page.waitForURL(/\/compras\/[0-9a-f-]{36}$/)

    await page.locator('[data-qa="compra-confirmar"]').click()
    await expect(page.locator('[data-qa="compra-pago-seccion"]')).toHaveCount(0)
    await expect(page.getByText('¿La pagaste ya?')).toHaveCount(0)
  } finally {
    await limpiarItems(request, token, [producto.id])
    await request.delete(`${API}/terceros/${proveedor.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  }
})
