import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { api, CLP, crearProducto, limpiarItems, tokenDe, TENANTS } from '../support/api'
import { entrarComo } from '../support/ui'

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
 * un producto con 40 unidades a $250, contado en 40 y después en 37. Son 3
 * unidades sin explicación, $750.
 *
 * 📌 **Se cuenta en una bodega del spec, y la pantalla se filtra por ella.** El
 * listado pagina (15 filas), ordena por plata perdida y, con bodegas, arranca
 * en el local: contando ahí, la fila de $750 dependía de cuántas filas de más
 * plata dejaron en ese local otras suites que corrieron sobre la misma base. Es
 * el mismo arreglo que el de compras, que filtra su listado por su proveedor.
 * La bodega tiene un nombre fijo y se reusa entre corridas: los ítems de
 * corridas viejas están dados de baja y el reporte no los lista, y una bodega
 * nueva por corrida llenaría el selector de ubicaciones del tenant.
 */

// Sin la sesión de admin que guarda `auth.setup.ts`: entra el aprobador.
test.use({ storageState: { cookies: [], origins: [] } })

const APROBADOR = { email: 'aprobador@paris.cl', password: 'admin' }

let escenario: { token?: string, itemIds: string[] } = { itemIds: [] }

interface Recuento { id: string, lineas: { lineaId: string, itemId: string }[] }

const BODEGA = 'Bodega varianza Playwright'

/** La bodega del spec, y el nombre del local: es lo que el selector muestra al arrancar. */
async function ubicacionesDelSpec(
  request: APIRequestContext,
  token: string,
): Promise<{ bodegaId: string, localNombre: string }> {
  const ubicaciones = await api<{ id: string, nombre: string, tipo: string }[]>(request, 'get', '/ubicaciones', { token })
  const localNombre = ubicaciones.find(u => u.tipo === 'local')!.nombre
  const existente = ubicaciones.find(u => u.nombre === BODEGA)
  if (existente) return { bodegaId: existente.id, localNombre }
  const { id } = await api<{ id: string }>(request, 'post', '/ubicaciones', {
    token,
    data: { nombre: BODEGA, tipo: 'bodega' },
  })
  return { bodegaId: id, localNombre }
}

/** Las 40 unidades entran a la bodega con `inventario_inicial`, antes del primer conteo. */
async function stockInicialEnBodega(
  request: APIRequestContext,
  token: string,
  datos: { itemId: string, ubicacionId: string, costoUnitario?: string },
) {
  await api(request, 'patch', `/items/${datos.itemId}/stock`, {
    token,
    data: {
      ubicacionId: datos.ubicacionId,
      cantidad: '40',
      tipo: 'entrada',
      motivo: 'inventario_inicial',
      ...(datos.costoUnitario ? { costoUnitario: datos.costoUnitario } : {}),
    },
  })
}

/**
 * Filtra la pantalla por la bodega del spec y espera el listado y el resumen ya
 * filtrados: sin esperarlos, una aserción sobre la tabla o los totales podría
 * correr contra la carga del local, y un error del resumen de la bodega
 * llegaría después de mirar `errores`. Con bodegas, el selector arranca en el
 * local; su etiqueta no está ligada al botón, así que se lo encuentra por el
 * valor que muestra.
 */
async function filtrarPorLaBodega(page: Page, ubicaciones: { bodegaId: string, localNombre: string }) {
  const deLaBodega = (ruta: string) => page.waitForResponse(r =>
    r.url().includes(ruta) && r.url().includes(`ubicacionId=${ubicaciones.bodegaId}`))
  const listado = deLaBodega('/api/reportes/varianza?')
  const resumen = deLaBodega('/api/reportes/varianza/resumen?')
  await page.getByRole('button').filter({ hasText: new RegExp(`^${ubicaciones.localNombre}$`) }).click()
  await page.keyboard.type(BODEGA)
  await page.getByRole('option', { name: BODEGA, exact: true }).click()
  expect((await listado).status()).toBe(200)
  expect((await resumen).status()).toBe(200)
}

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

test('el aprobador llega por el menú y ve lo que falta, en cantidad y en plata', async ({ page, request }) => {
  const token = escenario.token!
  const nombre = `E2E varianza ${Date.now()}`

  const ubicaciones = await ubicacionesDelSpec(request, token)
  const { bodegaId } = ubicaciones
  const motivos = await api<{ id: string }[]>(request, 'get', '/motivos-diferencia-inventario', { token })

  const { id: itemId } = await crearProducto(request, token, {
    nombre,
    precioBase: '1000',
    stock: '0',
    costo: '250',
  })
  escenario.itemIds.push(itemId)
  await stockInicialEnBodega(request, token, { itemId, ubicacionId: bodegaId, costoUnitario: '250' })

  const conteo = { ubicacionId: bodegaId, itemId, motivoDiferenciaId: motivos[0]!.id }
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

  await entrarComo(page, APROBADOR.email, APROBADOR.password)

  await page.getByRole('link', { name: 'Reportes' }).first().click()
  await page.waitForURL('**/reportes')
  await page.locator('[data-qa="reporte-/reportes/varianza"]').click()
  await page.waitForURL('**/reportes/varianza')
  await filtrarPorLaBodega(page, ubicaciones)

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
  // exacto: el total cubre la bodega entera, no solo el producto de este test.
  await expect(page.locator('[data-qa="varianza-total-sinExplicacion"]')).toContainText('$')

  expect(errores, 'ninguna llamada de la carga debe fallar para este rol').toEqual([])
})

/**
 * El aviso de "sin costo" y su link, contra el backend real: que `soloSinCosto`
 * pase el pipe (un campo que el DTO no declare se borra callado y la tabla
 * volvería entera con 200) y que la fila hundida aparezca al filtrar.
 *
 * No se asevera el número exacto: la bodega del spec puede traer otras filas sin
 * costo, de una corrida anterior que no llegó a limpiar. Que el número y las
 * filas coincidan lo fija el e2e de la API (`reportes-varianza-plata.e2e-spec.ts`).
 */
test('el aviso de sin costo filtra la tabla a los que perdieron sin costo', async ({ page, request }) => {
  const token = escenario.token!
  const nombre = `E2E varianza sin costo ${Date.now()}`

  const ubicaciones = await ubicacionesDelSpec(request, token)
  const { bodegaId } = ubicaciones
  const motivos = await api<{ id: string }[]>(request, 'get', '/motivos-diferencia-inventario', { token })

  // Sin `costo`: `crearProducto` pone uno por defecto, y acá es justo lo que falta.
  const { id: itemId } = await api<{ id: string }>(request, 'post', '/items', {
    token,
    data: { nombre, tipo: 'producto', monedaId: CLP, unidadMedida: 'unidad', precioBase: '1000', stock: '0' },
  })
  escenario.itemIds.push(itemId)
  await stockInicialEnBodega(request, token, { itemId, ubicacionId: bodegaId })

  const conteo = { ubicacionId: bodegaId, itemId, motivoDiferenciaId: motivos[0]!.id }
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

  await entrarComo(page, APROBADOR.email, APROBADOR.password)
  await page.goto('/reportes/varianza', { waitUntil: 'networkidle' })
  await filtrarPorLaBodega(page, ubicaciones)

  const aviso = page.locator('[data-qa="varianza-sin-costo"]')
  await expect(aviso).toContainText(/no tienen? costo y pueden? estar perdiendo plata/)
  const link = page.locator('[data-qa="varianza-sin-costo-link"]')

  // Se espera la RESPUESTA del listado filtrado: la fila ya se veía sin filtrar,
  // así que afirmar sobre la tabla sin esperarla pasaba antes de que llegara.
  const filtrada = page.waitForResponse(r =>
    r.url().includes('/api/reportes/varianza?') && r.url().includes('soloSinCosto=true')
    && r.url().includes(`ubicacionId=${bodegaId}`))
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
