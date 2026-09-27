import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { api, CLP, crearProducto, limpiarItems, tokenDe, TENANTS } from '../support/api'

/**
 * La pantalla de varianza **como el aprobador de inventario** (`aprobador@paris.cl`,
 * rol `Inventario · Aprobación`), no como admin: con admin, un permiso que le
 * falte al rol —el de `/ubicaciones`, el de `/tenants/me`— se tapa solo.
 *
 * **Qué aporta sobre `backend/test/reportes-varianza*.e2e-spec.ts`**, que ya
 * prueban las cuentas: que el rango que arma la pantalla pase el pipe del
 * backend real (los specs de render mockean `useApiFetch`, que contesta 200 a
 * cualquier cosa), que el menú y el índice lleven a la pantalla, y que ninguna
 * llamada de la carga le devuelva un error a este rol.
 *
 * Escenario, armado por API como admin (contar y aplicar no son de este rol):
 * un producto con 40 unidades a $250, contado en 40 y después en 37 en el
 * local. Son 3 unidades sin explicación, $750.
 */

// Sin la sesión de admin que guarda `auth.setup.ts`: entra el aprobador.
test.use({ storageState: { cookies: [], origins: [] } })

const APROBADOR = { email: 'aprobador@paris.cl', password: 'admin' }

let escenario: { token?: string, itemIds: string[] } = { itemIds: [] }

interface Recuento { id: string, lineas: { lineaId: string, itemId: string }[] }

async function contarYAplicar(
  request: APIRequestContext,
  token: string,
  datos: { ubicacionId: string, itemId: string, cantidadContada: string, motivoDiferenciaId: string },
) {
  const { id } = await api<{ id: string }>(request, 'post', '/recuentos', {
    token,
    data: { ubicacionId: datos.ubicacionId, itemIds: [datos.itemId] },
  })
  const detalle = await api<Recuento>(request, 'get', `/recuentos/${id}`, { token })
  const linea = detalle.lineas.find(l => l.itemId === datos.itemId)!
  await api(request, 'patch', `/recuentos/${id}/lineas/${linea.lineaId}`, {
    token,
    data: { cantidadContada: datos.cantidadContada, motivoDiferenciaId: datos.motivoDiferenciaId },
  })
  await api(request, 'post', `/recuentos/${id}/aplicar`, { token })
}

test.beforeEach(async ({ request }) => {
  escenario = { itemIds: [] }
  escenario.token = await tokenDe(request, TENANTS.restaurante)
})

test.afterEach(async ({ request }) => {
  if (!escenario.token) return
  await limpiarItems(request, escenario.token, escenario.itemIds)
})

/** Login por pantalla. Tiene un solo tenant: entra directo, sin elegir. */
async function entrarComoAprobador(page: Page) {
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.getByPlaceholder('tu@email.com').fill(APROBADOR.email)
  await page.locator('input[type="password"]').first().fill(APROBADOR.password)
  const submit = page.locator('button[type="submit"]').first()
  await expect(submit).toBeEnabled()
  await submit.click()
  await page.waitForURL(url => url.pathname === '/')
}

test('el aprobador llega por el menú y ve lo que falta, en cantidad y en plata', async ({ page, request }) => {
  const token = escenario.token!
  const nombre = `E2E varianza ${Date.now()}`

  const ubicaciones = await api<{ id: string, tipo: string }[]>(request, 'get', '/ubicaciones', { token })
  const local = ubicaciones.find(u => u.tipo === 'local')!
  const motivos = await api<{ id: string }[]>(request, 'get', '/motivos-diferencia-inventario', { token })

  const { id: itemId } = await crearProducto(request, token, {
    nombre,
    precioBase: '1000',
    stock: '40',
    costo: '250',
  })
  escenario.itemIds.push(itemId)

  const conteo = { ubicacionId: local.id, itemId, motivoDiferenciaId: motivos[0]!.id }
  await contarYAplicar(request, token, { ...conteo, cantidadContada: '40' })
  await contarYAplicar(request, token, { ...conteo, cantidadContada: '37' })

  // Cualquier respuesta de error de la API durante la navegación es un permiso
  // que le falta al rol o un parámetro que el pipe rechaza.
  const errores: string[] = []
  page.on('response', (res) => {
    if (res.url().includes('/api/') && res.status() >= 400) {
      errores.push(`${res.status()} ${res.url()}`)
    }
  })

  await entrarComoAprobador(page)

  await page.getByRole('link', { name: 'Reportes' }).first().click()
  await page.waitForURL('**/reportes')
  await page.locator('[data-qa="reporte-/reportes/varianza"]').click()
  await page.waitForURL('**/reportes/varianza')

  const fila = page.locator('tbody tr', { hasText: nombre })
  await expect(fila).toBeVisible()
  // 3 unidades sin explicación, valorizadas a $250 = $750.
  await expect(fila).toContainText('$750')
  // «Otros» cierra en cero: se ve, apagado, sin botón de explicación.
  const otros = fila.locator('[data-qa="varianza-otros"]')
  await expect(otros).toHaveClass(/text-muted/)
  await expect(otros.getByRole('button')).toHaveCount(0)

  // El total de arriba llegó con plata: si el resumen hubiera rebotado (rango
  // mal armado, permiso faltante) la tarjeta diría `—`. No se asevera el monto
  // exacto: el total cubre todo el tenant, no solo el producto de este test.
  await expect(page.locator('[data-qa="varianza-total-sinExplicacion"]')).toContainText('$')

  expect(errores, 'ninguna llamada de la carga debe fallar para este rol').toEqual([])
})

/**
 * El aviso de "sin costo" y su link, contra el backend real: que `soloSinCosto`
 * pase el pipe (un campo que el DTO no declare se borra callado y la tabla
 * volvería entera con 200) y que la fila hundida aparezca al filtrar.
 *
 * No se asevera el número exacto: el local del seed puede traer otras filas sin
 * costo. Que el número y las filas coincidan lo fija el e2e de la API
 * (`reportes-varianza-plata.e2e-spec.ts`).
 */
test('el aviso de sin costo filtra la tabla a los que perdieron sin costo', async ({ page, request }) => {
  const token = escenario.token!
  const nombre = `E2E varianza sin costo ${Date.now()}`

  const ubicaciones = await api<{ id: string, tipo: string }[]>(request, 'get', '/ubicaciones', { token })
  const local = ubicaciones.find(u => u.tipo === 'local')!
  const motivos = await api<{ id: string }[]>(request, 'get', '/motivos-diferencia-inventario', { token })

  // Sin `costo`: `crearProducto` pone uno por defecto, y acá es justo lo que falta.
  const { id: itemId } = await api<{ id: string }>(request, 'post', '/items', {
    token,
    data: { nombre, tipo: 'producto', monedaId: CLP, unidadMedida: 'unidad', precioBase: '1000', stock: '40' },
  })
  escenario.itemIds.push(itemId)

  const conteo = { ubicacionId: local.id, itemId, motivoDiferenciaId: motivos[0]!.id }
  await contarYAplicar(request, token, { ...conteo, cantidadContada: '40' })
  await contarYAplicar(request, token, { ...conteo, cantidadContada: '37' })

  const errores: string[] = []
  let avisoDelResumen: number | null = null
  page.on('response', async (res) => {
    if (res.url().includes('/api/') && res.status() >= 400) {
      errores.push(`${res.status()} ${res.url()}`)
    }
    if (res.url().includes('/api/reportes/varianza/resumen?') && res.ok()) {
      avisoDelResumen = ((await res.json()) as { perdiendoSinCosto: number }).perdiendoSinCosto
    }
  })

  await entrarComoAprobador(page)
  await page.goto('/reportes/varianza', { waitUntil: 'networkidle' })

  const aviso = page.locator('[data-qa="varianza-sin-costo"]')
  await expect(aviso).toContainText(/no tienen? costo y pueden? estar perdiendo plata/)
  const link = page.locator('[data-qa="varianza-sin-costo-link"]')

  // Se espera la RESPUESTA del listado filtrado: la fila ya se veía sin filtrar,
  // así que afirmar sobre la tabla sin esperarla pasaba antes de que llegara.
  const filtrada = page.waitForResponse(r =>
    r.url().includes('/api/reportes/varianza?') && r.url().includes('soloSinCosto=true'))
  await link.click()
  const res = await filtrada
  expect(res.status()).toBe(200)
  const cuerpo = await res.json() as { data: { itemId: string, faltaCosto: boolean }[], meta: { total: number } }

  // Si el pipe hubiera borrado el campo, vendría la tabla entera.
  expect(cuerpo.data.every(f => f.faltaCosto)).toBe(true)
  expect(cuerpo.data.some(f => f.itemId === itemId)).toBe(true)
  // El número del aviso es el total que abre su link, con los datos que haya.
  await expect.poll(() => avisoDelResumen).toBe(cuerpo.meta.total)
  await expect(aviso).toContainText(`${cuerpo.meta.total} producto`)

  await expect(link).toHaveText('Ver todos')
  await expect(page.locator('tbody tr', { hasText: nombre })).toContainText('Sin costo')

  expect(errores, 'ninguna llamada de la carga debe fallar para este rol').toEqual([])
})
