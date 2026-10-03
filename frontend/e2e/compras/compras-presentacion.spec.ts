import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { API, api, crearProducto, limpiarItems, tokenDe, TENANTS } from '../support/api'
import { elegirPorPlaceholder, entrarComo } from '../support/ui'

/**
 * Compras, pieza 2 — la unidad de compra por proveedor (spec
 * `docs/superpowers/specs/2026-09-27-compras-unidad-de-compra-design.md` § 6 y § 7). Como el
 * encargado de compras, no como admin: mismo motivo que `compras-por-pantalla.spec.ts` — con
 * admin, un 403 en una ruta que el encargado no tiene no se ve.
 *
 * Qué aporta sobre `backend/test/compras.e2e-spec.ts` y `compras-por-pantalla.spec.ts`: nada de
 * la cuenta (eso ya está probado). Lo que solo se puede romper del lado del navegador: crear
 * "Caja (12)" desde la línea sin salir de la compra, que el selector combinado ofrezca la
 * presentación recién creada, que el lápiz corrija ANTES de confirmar y la línea tome ese
 * contenido (no el que tenía al elegirla), y que la confirmada y el historial se lean en la
 * unidad de la presentación, no en la base.
 *
 * Las precondiciones —producto, proveedor y, en el segundo test, la presentación— se arman por
 * API como admin: crearlas no es de Compras. Los montos ($800, 120 unidades) salen de la misma
 * cuenta que ya fija `useCompras.spec.ts` (10 × Caja(12) a $9.600 → 120 a $800).
 */

// Sin la sesión de admin que guarda `auth.setup.ts`: cada test entra como el encargado.
test.use({ storageState: { cookies: [], origins: [] } })

const ENCARGADO = { email: 'encargado.compras@paris.cl', password: 'admin' }

let escenario: { token?: string, itemIds: string[], proveedorId?: string } = { itemIds: [] }

test.beforeEach(async ({ request }) => {
  escenario = { itemIds: [] }
  escenario.token = await tokenDe(request, TENANTS.restaurante)
})

test.afterEach(async ({ request }) => {
  if (!escenario.token) return
  await limpiarItems(request, escenario.token, escenario.itemIds)
  if (escenario.proveedorId) {
    const res = await request.delete(`${API}/terceros/${escenario.proveedorId}`, {
      headers: { Authorization: `Bearer ${escenario.token}` },
    })
    if (!res.ok()) {
      console.warn(`[e2e] no se pudo dar de baja el proveedor: ${res.status()} ${await res.text()}`)
    }
  }
})

/**
 * Elige en el `USelect` combinado de unidad/presentación de una línea, haciendo pie en su valor
 * ACTUAL (no tiene placeholder: siempre muestra algo, "unidad" apenas se elige el producto).
 */
async function elegirUnidadDeLinea(linea: Locator, valorActual: string, opcion: string) {
  const page = linea.page()
  await linea.getByText(valorActual, { exact: true }).click()
  await page.getByRole('option', { name: opcion, exact: true }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
}

/** Tipea en un `MoneyInput` tecla por tecla (maska ignora `fill`). */
async function escribirEn(raiz: Page | Locator, qa: string, valor: string) {
  const input = raiz.locator(`input[data-qa="${qa}"]`)
  await input.selectText()
  await input.pressSequentially(valor)
}

/** Un proveedor propio del test; el `afterEach` lo da de baja. */
async function crearProveedor(request: APIRequestContext, sello: number) {
  const nombre = `Distribuidora presentación e2e ${sello}`
  const proveedor = await api<{ id: string }>(request, 'post', '/terceros', {
    token: escenario.token!,
    data: { tipo: 'proveedor', nombre },
  })
  escenario.proveedorId = proveedor.id
  return { id: proveedor.id, nombre }
}

/** El local del tenant: único por tenant, se lee del listado por `tipo`, no por posición. */
async function ubicacionLocal(request: APIRequestContext) {
  const ubicaciones = await api<{ id: string, tipo: string, nombre: string }[]>(
    request, 'get', '/ubicaciones', { token: escenario.token! },
  )
  return ubicaciones.find(u => u.tipo === 'local')!
}

/** Un producto en `unidad`, sin stock previo, propio del test. */
async function productoLata(request: APIRequestContext, nombre: string) {
  const producto = await crearProducto(request, escenario.token!, { nombre, precioBase: '1000', stock: '0' })
  escenario.itemIds.push(producto.id)
  return { id: producto.id, nombre }
}

async function crearPresentacion(
  request: APIRequestContext,
  proveedorId: string,
  itemId: string,
  contenido: string,
) {
  return api<{ id: string }>(request, 'post', '/compras/presentaciones', {
    token: escenario.token!,
    data: { proveedorId, itemId, nombre: 'Caja', contenido, unidadCodigo: 'unidad' },
  })
}

/** Lo que quedó del lado del servidor. */
async function stockYCosto(request: APIRequestContext, itemId: string) {
  const item = await api<{ stock: string, costoActual: string | null }>(
    request, 'get', `/items/${itemId}`, { token: escenario.token! },
  )
  return { stock: item.stock, costo: item.costoActual }
}

test('crear "Caja (12)" desde la línea, confirmar 10 cajas y corregir en cajas', async ({ page, request }) => {
  const sello = Date.now()
  const proveedor = await crearProveedor(request, sello)
  const local = await ubicacionLocal(request)
  const producto = await productoLata(request, `Coca-Cola lata e2e ${sello}`)

  await entrarComo(page, ENCARGADO.email, ENCARGADO.password)
  await page.goto('/compras/nueva', { waitUntil: 'networkidle' })

  await elegirPorPlaceholder(page, 'A quién se le compró', proveedor.nombre, { buscar: true })
  await elegirPorPlaceholder(page, 'Factura, boleta, sin documento…', 'Factura', { exacta: true })
  await page.locator('input[data-qa="compra-folio"]').fill(`E2E-${sello}`)
  await elegirPorPlaceholder(page, 'Local o bodega', local.nombre, { exacta: true })

  const linea = page.locator('[data-qa="compra-linea"]').nth(0)
  await elegirPorPlaceholder(linea, 'Selecciona un producto', producto.nombre, { buscar: true })

  // Unidad → "+ Nueva presentación…" → Caja / 12 → Guardar. El selector queda en "Caja (12)".
  await elegirUnidadDeLinea(linea, 'unidad', '+ Nueva presentación…')
  const modalPresentacion = page.getByRole('dialog')
  await expect(modalPresentacion).toContainText('Nueva presentación')
  await modalPresentacion.locator('[data-qa="presentacion-nombre"]').fill('Caja')
  await modalPresentacion.locator('[data-qa="presentacion-contenido"]').fill('12')
  await modalPresentacion.locator('[data-qa="presentacion-guardar"]').click()
  await expect(modalPresentacion).toHaveCount(0)
  await expect(linea.getByText('Caja (12)', { exact: true })).toBeVisible()

  // Cantidad 10, precio 9600: la línea dice "= 120 unidad".
  await linea.locator('input[data-qa="compra-cantidad"]').fill('10')
  await escribirEn(linea, 'compra-precio', '9600')
  await expect(linea.locator('[data-qa="compra-cuenta-presentacion"]')).toContainText('= 120 unidad')

  // La Factura es `total_documento = 'obligatorio'`: sin este campo,
  // confirmar es 400. 10 × $9.600.
  await escribirEn(page, 'compra-total-documento', '96000')

  // Confirmar.
  await page.locator('[data-qa="compra-confirmar"]').click()
  const resumen = page.locator('[data-qa="compra-confirmar-resumen"]')
  await expect(resumen).toContainText(`Entran 1 línea a ${local.nombre}`)
  await page.locator('[data-qa="compra-confirmar-si"]').click()

  // La confirmada dice "10 Caja (12) · 120 unidad".
  const detalle = page.locator('[data-qa="compra-confirmada"]')
  await expect(detalle).toBeVisible()
  const filaLinea = detalle.getByRole('row').filter({ hasText: producto.nombre }).filter({ hasNotText: '→' })
  await expect(filaLinea).toContainText('10 Caja (12)')
  await expect(filaLinea).toContainText('120 unidad')

  // Corregir la línea: el campo dice "Cantidad (Caja (12))"; bajar a 8.
  await page.locator('[data-qa^="compra-corregir-"]').click()
  const modalCorregir = page.getByRole('dialog')
  await expect(modalCorregir).toContainText('Corregir la línea')
  await expect(modalCorregir).toContainText('Cantidad (Caja (12))')
  await escribirEn(modalCorregir, 'corregir-cantidad', '8')
  await page.locator('[data-qa="corregir-enviar"]').click()
  await expect(modalCorregir).toHaveCount(0)

  // El historial: "10 → 8 Caja (12)".
  await expect(page.locator('[data-qa="compra-historial"]')).toContainText('10 Caja (12) → 8 Caja (12)')

  // Por API: 120 − 24 (10 → 8 cajas de 12) = 96, y el costo por unidad sigue en $800.
  expect(await stockYCosto(request, producto.id)).toEqual({ stock: '96.0000', costo: '800.0000' })
})

test('el lápiz corrige 24 → 12 antes de confirmar y el borrador toma el 12', async ({ page, request }) => {
  const sello = Date.now()
  const proveedor = await crearProveedor(request, sello)
  const local = await ubicacionLocal(request)
  const producto = await productoLata(request, `Coca-Cola lata e2e ${sello}`)
  await crearPresentacion(request, proveedor.id, producto.id, '24')

  await entrarComo(page, ENCARGADO.email, ENCARGADO.password)
  await page.goto('/compras/nueva', { waitUntil: 'networkidle' })

  await elegirPorPlaceholder(page, 'A quién se le compró', proveedor.nombre, { buscar: true })
  await elegirPorPlaceholder(page, 'Factura, boleta, sin documento…', 'Factura', { exacta: true })
  await page.locator('input[data-qa="compra-folio"]').fill(`E2E-${sello}`)
  await elegirPorPlaceholder(page, 'Local o bodega', local.nombre, { exacta: true })

  const linea = page.locator('[data-qa="compra-linea"]').nth(0)
  await elegirPorPlaceholder(linea, 'Selecciona un producto', producto.nombre, { buscar: true })
  // La presentación creada por API ya está en el selector: "Caja (24)".
  await elegirUnidadDeLinea(linea, 'unidad', 'Caja (24)')

  await linea.locator('input[data-qa="compra-cantidad"]').fill('10')
  await escribirEn(linea, 'compra-precio', '9600')
  await expect(linea.locator('[data-qa="compra-cuenta-presentacion"]')).toContainText('= 240 unidad')

  // El lápiz: corrige el contenido a 12 ANTES de confirmar.
  await linea.locator('[data-qa^="compra-presentacion-editar-"]').click()
  const modalPresentacion = page.getByRole('dialog')
  await expect(modalPresentacion).toContainText('Corregir presentación')
  const contenido = modalPresentacion.locator('[data-qa="presentacion-contenido"]')
  await contenido.fill('')
  await contenido.fill('12')
  await modalPresentacion.locator('[data-qa="presentacion-guardar"]').click()
  await expect(modalPresentacion).toHaveCount(0)

  // La cuenta pasa a "= 120 unidad": el borrador toma el contenido del día, no el que tenía al elegirla.
  await expect(linea.locator('[data-qa="compra-cuenta-presentacion"]')).toContainText('= 120 unidad')

  // La Factura es `total_documento = 'obligatorio'`: sin este campo,
  // confirmar es 400. 10 × $9.600.
  await escribirEn(page, 'compra-total-documento', '96000')

  await page.locator('[data-qa="compra-confirmar"]').click()
  await page.locator('[data-qa="compra-confirmar-si"]').click()
  await expect(page.locator('[data-qa="compra-confirmada"]')).toBeVisible()

  // Por API: 120, no 240.
  expect((await stockYCosto(request, producto.id)).stock).toBe('120.0000')
})
