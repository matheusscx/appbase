import { randomUUID } from 'node:crypto'
import { test, expect, type Browser, type Page, type APIRequestContext } from '@playwright/test'
import { API, TENANTS, api, crearProducto, limpiarItems, tokenDe } from '../support/api'

/**
 * El aviso de stock bajo en un navegador de verdad (`docs/features/aviso-stock-bajo.md`),
 * **con los roles reales del seed y nunca con admin**: con admin cada control
 * aparece, y el que le falta a un rol no se ve.
 *
 * - `aprobador@paris.cl` — `Inventario: Leer + Actualizar`, sin `Crear`: carga el
 *   mínimo, ve la marca y ve DÓNDE hay mercadería, pero sin botón de traslado.
 * - `contador@paris.cl` — `Inventario: Leer + Crear`, sin `Actualizar`: no puede
 *   tocar el mínimo, y sí tiene el botón, que abre el traslado con la bodega como
 *   destino (no el local, que es lo que el traslado precargado pone si no se le
 *   dice otra cosa).
 *
 * Y la palanca contra el ruido que no se deduce de la pantalla: desactivar una
 * bodega apaga sus avisos en el inicio sin perder el mínimo cargado.
 *
 * Las precondiciones (producto, bodega) se arman por API como admin: crear
 * ítems y ubicaciones no es lo que se prueba acá.
 */

test.use({ storageState: { cookies: [], origins: [] } })

const SELLO = `E2E stock mínimo ${randomUUID().slice(0, 8)}`

let escenario: { token?: string, itemIds: string[], bodegaId?: string } = { itemIds: [] }

async function entrarComo(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    storageState: { cookies: [], origins: [] },
  })
  const page = await context.newPage()
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.getByPlaceholder('tu@email.com').fill(email)
  await page.locator('input[type="password"]').first().fill('admin')
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL(url => url.pathname === '/')
  return page
}

async function setActivo(request: APIRequestContext, activo: boolean) {
  await api(request, 'patch', `/ubicaciones/${escenario.bodegaId}`, {
    token: escenario.token,
    data: { activo },
  })
}

/** La fila del producto en la bodega, filtrando la tabla por el sello de la corrida. */
async function filaEnLaBodega(page: Page, nombreBodega: string) {
  await page.goto(`/inventario/stock-minimo`, { waitUntil: 'networkidle' })
  await page.getByPlaceholder('Buscar producto').fill(SELLO)
  const fila = page.locator('tr').filter({ hasText: SELLO }).filter({ hasText: nombreBodega })
  await expect(fila).toHaveCount(1)
  return fila
}

test.beforeEach(async ({ request }) => {
  escenario = { itemIds: [] }
  escenario.token = await tokenDe(request, TENANTS.restaurante)
})

test.afterEach(async ({ request }) => {
  if (!escenario.token) return
  const headers = { Authorization: `Bearer ${escenario.token}` }
  for (const itemId of escenario.itemIds) {
    if (!escenario.bodegaId) break
    await request.put(`${API}/inventario/stock-minimo/${itemId}/${escenario.bodegaId}`, {
      headers,
      data: { minimo: null },
    })
  }
  await limpiarItems(request, escenario.token, escenario.itemIds)
  if (escenario.bodegaId) {
    const res = await request.delete(`${API}/ubicaciones/${escenario.bodegaId}`, { headers })
    if (!res.ok()) console.warn(`[e2e] no se pudo borrar la bodega: ${res.status()} ${await res.text()}`)
  }
})

test('cargar el mínimo, verlo en la marca y en el inicio, y trasladar según el rol', async ({ browser, request }) => {
  const nombreBodega = `${SELLO} barra`
  escenario.bodegaId = (await api<{ id: string }>(request, 'post', '/ubicaciones', {
    token: escenario.token,
    data: { nombre: nombreBodega, tipo: 'bodega' },
  })).id
  // 10 en el local, 0 en la bodega.
  const { id: itemId } = await crearProducto(request, escenario.token!, {
    nombre: `${SELLO} cerveza`,
    precioBase: '2000',
    stock: '10',
  })
  escenario.itemIds.push(itemId)

  // ── El aprobador carga el mínimo ──────────────────────────────────────
  const aprobador = await entrarComo(browser, 'aprobador@paris.cl')
  let fila = await filaEnLaBodega(aprobador, nombreBodega)
  const input = fila.locator(`input[data-qa="minimo-${itemId}-${escenario.bodegaId}"]`)
  await input.fill('6')
  const guardado = aprobador.waitForResponse(r =>
    r.url().includes(`/inventario/stock-minimo/${itemId}/`) && r.request().method() === 'PUT')
  await input.press('Enter')
  expect((await guardado).status()).toBe(200)

  await expect(fila.locator('[data-qa="marca-bajo-minimo"]')).toBeVisible()
  // Sin `Crear`: se le dice dónde hay, sin botón.
  await expect(fila.locator('[data-qa="trasladar"]')).toHaveCount(0)
  await expect(fila.locator('[data-qa="hay-en-otra-ubicacion"]')).toContainText('10')

  // El bloque del inicio lo cuenta, agrupado en la bodega.
  await aprobador.goto('/', { waitUntil: 'networkidle' })
  const bloque = aprobador.locator('a[href="/inventario/stock-minimo?soloBajoMinimo=true"]')
  await expect(bloque).toBeVisible()
  await expect(bloque.locator('[data-qa="stock-bajo-ubicacion"]').filter({ hasText: nombreBodega }))
    .toContainText('1')

  // ── El contador: sin editar el mínimo, con el traslado ────────────────
  const contador = await entrarComo(browser, 'contador@paris.cl')
  fila = await filaEnLaBodega(contador, nombreBodega)
  await expect(fila.locator('input[data-qa^="minimo-"]')).toHaveCount(0)
  await fila.locator('[data-qa="trasladar"]').click()

  await contador.waitForURL(url => url.pathname === '/inventario/traslados')
  const url = new URL(contador.url())
  expect(url.searchParams.get('destinoId')).toBe(escenario.bodegaId)
  expect(url.searchParams.get('cantidad')).toBe('6')
  // El drawer abre con la bodega como destino, no con el local.
  const drawer = contador.getByRole('dialog')
  await expect(drawer).toBeVisible()
  await expect(drawer).toContainText(nombreBodega)

  // ── La palanca: desactivar la bodega la apaga en el inicio ────────────
  await setActivo(request, false)
  await aprobador.goto('/', { waitUntil: 'networkidle' })
  await expect(aprobador.locator('[data-qa="stock-bajo-ubicacion"]').filter({ hasText: nombreBodega }))
    .toHaveCount(0)
  // …y reactivarla la devuelve con el mínimo de antes.
  await setActivo(request, true)
  fila = await filaEnLaBodega(aprobador, nombreBodega)
  await expect(fila.locator(`input[data-qa="minimo-${itemId}-${escenario.bodegaId}"]`)).toHaveValue(/^6/)
  await expect(fila.locator('[data-qa="marca-bajo-minimo"]')).toBeVisible()
})
