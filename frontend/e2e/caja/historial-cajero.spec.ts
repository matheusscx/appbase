import type { APIRequestContext, Page } from '@playwright/test'
import { test, expect } from '../support/sin-qz-tray'
import { api, API, cerrarCaja, tokenDe, TENANTS } from '../support/api'
import { entrarComo, escribirMonto } from '../support/ui'

/**
 * El historial de cajas es de supervisión (owner, 2026-09-29): el cajero deja de
 * ver sus turnos cerrados y el supervisor los sigue viendo.
 *
 * Corre con los roles reales, no con el admin, que tiene `Cajas:Leer` por el rol
 * fijo y taparía el 403:
 * - cajero: `vendedor@paris.cl` (`MiCaja`, sin `Cajas`);
 * - supervisor: `supervisor@paris.cl` (`Cajas:Leer` a secas).
 *
 * El tenant corre en **modo ciego** mientras dura cada test: es el caso en que la
 * revelación del cierre antes navegaba al detalle de la caja cerrada, que ahora
 * es 403 para el cajero. La revelación pasa a una tarjeta de `/mi-caja`, con lo
 * que devolvió el cierre (decisión de la orquestadora, 2026-10-08).
 *
 * Cada test abre la caja del cajero por API sobre un cajón propio, y el
 * `afterEach` la cierra, borra el cajón y devuelve el modo ciego a como estaba.
 */
const CAJERO = { email: 'vendedor@paris.cl', password: 'admin' }
const SUPERVISOR = { email: 'supervisor@paris.cl', password: 'admin' }
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', password: 'admin' }
const SALDO = '10000'
const MENSAJE_403 = 'El historial de cajas es solo para supervisión'

test.use({ storageState: { cookies: [], origins: [] } })

let escenario: {
  tokenAdmin?: string
  tokenCajero?: string
  ciegoAntes?: boolean
  cajonId?: string
  cajonNombre?: string
  cajaId?: string
} = {}

async function abrirCajaDelCajero(request: APIRequestContext): Promise<string> {
  const caja = await api<{ id: string }>(request, 'post', '/caja/abrir', {
    token: escenario.tokenCajero,
    data: { cajonId: escenario.cajonId, saldoInicial: SALDO, comentario: 'Apertura E2E historial' },
  })
  escenario.cajaId = caja.id
  return caja.id
}

/** `api()` no tiene PUT, y la config del modo ciego es un PUT. */
async function ponerCiego(request: APIRequestContext, valor: boolean): Promise<void> {
  const res = await request.put(`${API}/caja/arqueo-ciego`, {
    headers: { Authorization: `Bearer ${escenario.tokenAdmin}` },
    data: { arqueoCiego: valor },
  })
  expect(res.status()).toBe(200)
}

/** La tarjeta con lo que reveló el cierre, en `/mi-caja`. */
const tarjetaResultado = (page: Page) => page.locator('[data-qa="resultado-cierre"]')

test.beforeEach(async ({ request }) => {
  escenario = {}
  escenario.tokenAdmin = await tokenDe(request, TENANTS.restaurante)
  escenario.tokenCajero = await tokenDe(request, TENANTS.restaurante, CAJERO)

  const { arqueoCiego } = await api<{ arqueoCiego: boolean }>(request, 'get', '/caja/arqueo-ciego', {
    token: escenario.tokenAdmin,
  })
  escenario.ciegoAntes = arqueoCiego
  await ponerCiego(request, true)

  escenario.cajonNombre = `E2E historial ${Date.now()}`
  const cajon = await api<{ id: string }>(request, 'post', '/cajones', {
    token: escenario.tokenAdmin,
    data: { nombre: escenario.cajonNombre },
  })
  escenario.cajonId = cajon.id
})

test.afterEach(async ({ request }) => {
  const { tokenAdmin, tokenCajero, cajaId, cajonId, ciegoAntes } = escenario
  if (tokenCajero && cajaId) await cerrarCaja(request, tokenCajero, cajaId, SALDO)
  if (tokenAdmin && cajonId) {
    await request.delete(`${API}/cajones/${cajonId}`, {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    })
  }
  if (tokenAdmin && ciegoAntes !== undefined) await ponerCiego(request, ciegoAntes)
})

test('cajero desde /mi-caja: cierra a ciegas, ve el resultado una vez y no vuelve a su caja cerrada', async ({ page }) => {
  const cajaId = await abrirCajaDelCajero(page.request)
  await entrarComo(page, CAJERO.email, CAJERO.password)

  // 1. Su caja de hoy la sigue viendo y operando, sin link al historial.
  await page.goto('/mi-caja')
  await page.waitForURL(`**/mi-caja/${cajaId}`)
  await expect(page.getByText('Saldo inicial').first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ver historial' })).toHaveCount(0)

  // 2. Cuenta a ciegas lo que había: cuadra y se cierra en el mismo paso.
  await page.getByRole('button', { name: 'Cerrar caja' }).click()
  const cierre = page.getByRole('dialog').filter({ hasText: 'Cerrar caja' })
  const efectivo = cierre.locator('[data-qa="arqueo-EFECTIVO"]')
  await expect(efectivo).not.toContainText('Esperado')
  await escribirMonto(efectivo, SALDO)
  await cierre.getByRole('button', { name: 'Enviar conteo' }).click()

  // 3. La revelación: vuelve a /mi-caja con el resultado en la tarjeta.
  await page.waitForURL(url => url.pathname === '/mi-caja')
  await expect(tarjetaResultado(page)).toContainText('Cuadró')
  await expect(page.getByRole('link', { name: 'Ver historial' })).toHaveCount(0)
  escenario.cajaId = undefined // ya cerrada

  // 4. "Listo" la descarta.
  await tarjetaResultado(page).getByRole('button', { name: 'Listo' }).click()
  await expect(tarjetaResultado(page)).toHaveCount(0)

  // 5. Su caja cerrada ya es historial: por URL, el backend la rechaza y la
  //    pantalla lo dice y lo devuelve a /mi-caja.
  await page.goto(`/mi-caja/${cajaId}`)
  // El toast aparece dos veces en el DOM (el aviso y la región de notificaciones).
  await expect(page.getByText(MENSAJE_403).first()).toBeVisible()
  await page.waitForURL(url => url.pathname === '/mi-caja')

  // 6. Y el historial por URL lo saca la ruta (le falta `Cajas:Leer`).
  await page.goto('/mi-caja/historial')
  await page.waitForURL(url => url.pathname !== '/mi-caja/historial')
})

test('cajero desde el POS: cierra a ciegas con un faltante, ve la diferencia en la tarjeta, y un F5 lo deja sin caja abierta', async ({ page }) => {
  await abrirCajaDelCajero(page.request)
  await entrarComo(page, CAJERO.email, CAJERO.password)

  await page.goto('/ventas/pos')
  await page.getByRole('button', { name: 'Caja abierta' }).click()
  await page.getByRole('menuitem', { name: 'Cerrar caja' }).click()
  const cierre = page.getByRole('dialog').filter({ hasText: 'Cerrar caja' })
  const efectivo = cierre.locator('[data-qa="arqueo-EFECTIVO"]')
  await expect(efectivo).not.toContainText('Esperado')
  await escribirMonto(efectivo, '9000')
  await cierre.getByRole('button', { name: 'Enviar conteo' }).click()

  // Faltan $1.000: concilia en el mismo drawer y confirma.
  const conciliacion = page.getByRole('dialog').filter({ hasText: 'Conciliar diferencias' })
  await conciliacion.locator('[data-qa="arqueo-EFECTIVO"]').getByRole('combobox').click()
  await page.getByRole('option').first().click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await conciliacion.getByRole('button', { name: 'Confirmar cierre' }).click()

  await page.waitForURL(url => url.pathname === '/mi-caja')
  await expect(tarjetaResultado(page)).toContainText('Diferencia -$1.000')
  escenario.cajaId = undefined

  // El resultado vive en memoria: una recarga no lo trae de vuelta, y la
  // pantalla queda en "sin caja abierta" con el cajón libre para abrir.
  await page.reload()
  await expect(page.getByText(escenario.cajonNombre!)).toBeVisible()
  await expect(tarjetaResultado(page)).toHaveCount(0)
})

test('logout con la tarjeta en pantalla: el que entra después en ese navegador no la ve', async ({ page }) => {
  await abrirCajaDelCajero(page.request)
  await entrarComo(page, CAJERO.email, CAJERO.password)

  await page.goto('/ventas/pos')
  await page.getByRole('button', { name: 'Caja abierta' }).click()
  await page.getByRole('menuitem', { name: 'Cerrar caja' }).click()
  const cierre = page.getByRole('dialog').filter({ hasText: 'Cerrar caja' })
  await escribirMonto(cierre.locator('[data-qa="arqueo-EFECTIVO"]'), SALDO)
  await cierre.getByRole('button', { name: 'Enviar conteo' }).click()
  await page.waitForURL(url => url.pathname === '/mi-caja')
  await expect(tarjetaResultado(page)).toBeVisible()
  escenario.cajaId = undefined

  // Logout y login de otra persona SIN recargar: el store sobrevive a la
  // navegación de la SPA, así que lo único que puede vaciarlo es el logout.
  const yo = await api<{ nombre: string }>(page.request, 'get', '/auth/me', { token: escenario.tokenCajero })
  await page.getByRole('button').filter({ hasText: yo.nombre }).first().click()
  await page.getByRole('menuitem', { name: 'Cerrar Sesión' }).click()
  await page.waitForURL(url => url.pathname === '/login')
  await page.getByPlaceholder('tu@email.com').fill(ADMIN_PARIS.email)
  await page.locator('input[type="password"]').first().fill(ADMIN_PARIS.password)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL(url => url.pathname === '/')

  await page.getByRole('link', { name: 'Mi caja' }).first().click()
  await page.waitForURL(url => url.pathname.startsWith('/mi-caja'))
  await expect(page.getByText('Gestión de caja física del turno actual.')).toBeVisible()
  await expect(tarjetaResultado(page)).toHaveCount(0)
})

test('supervisor: sigue viendo el turno cerrado del cajero en el historial y en su detalle', async ({ page, request }) => {
  const cajaId = await abrirCajaDelCajero(request)
  expect(await cerrarCaja(request, escenario.tokenCajero!, cajaId, SALDO)).toBe('cerrada')
  escenario.cajaId = undefined

  await entrarComo(page, SUPERVISOR.email, SUPERVISOR.password)
  await page.goto(`/cajas/historial?cajonId=${escenario.cajonId}`)
  // Cada fila del historial es clickeable: su rol es `button`, no `row`.
  const fila = page.locator('tbody tr').filter({ hasText: escenario.cajonNombre! })
  await expect(fila).toHaveCount(1)
  await fila.click()
  await page.waitForURL(`**/cajas/${cajaId}`)
  await expect(page.getByText('Arqueo del cierre')).toBeVisible()
})
