import type { Browser, Page } from '@playwright/test'
import { test, expect } from '../support/sesion'
import { API, TENANTS, api, tokenDe } from '../support/api'

/**
 * El aviso al admin de la orden pagada sin venta (pendientes.md § 3, D), en un
 * navegador de verdad y con alguien que NO es admin: el admin tiene todo y tapa
 * un permiso mal puesto. La cuenta es del seed y solo tiene Compras; acá se le
 * presta un rol con `Pasarelas: Leer` y nada más, y se le saca al terminar.
 *
 * Una orden pagada sin venta no se puede fabricar desde el navegador: hace falta
 * que Webpay apruebe y que el retorno no pueda crear la venta. Eso lo cubre el
 * e2e de la API con el proveedor falso (`backend/test/tienda-dos-ahoras`). Acá se
 * fija lo que solo se ve con el navegador: que la tarjeta muestra el número que
 * da el backend, que se clica y que `/ordenes` llega con el filtro puesto.
 */

const CORREO = 'compras.correccion@paris.cl'

interface Listado { meta: { total: number } }

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
  await page.waitForURL(url => url.pathname !== '/login')
  if (new URL(page.url()).pathname === '/select-tenant') {
    await page.getByRole('button', { name: 'Demo Restaurante' }).click()
  }
  await page.waitForURL(url => url.pathname === '/')
  await expect(page.getByText('Bienvenido')).toBeVisible()
  return page
}

test.describe('"Pagos sin venta" con solo "Pasarelas: Leer"', () => {
  let adminToken: string
  let rolId: string | undefined
  let usuarioId: string | undefined

  test.beforeAll(async ({ request }) => {
    adminToken = await tokenDe(request, TENANTS.restaurante)
    const auth = { Authorization: `Bearer ${adminToken}` }

    const modulos = await api<
      {
        nombre: string
        moduloTenantId: string
        permisos: { permisoNombre: string, moduloAppPermisoId: string }[]
      }[]
    >(request, 'get', '/roles/modulos-disponibles', { token: adminToken })
    const pasarelas = modulos.find(m => m.nombre === 'Pasarelas')
    const leer = pasarelas?.permisos.find(p => p.permisoNombre === 'Leer')
    if (!pasarelas || !leer) throw new Error('El seed no trae "Pasarelas: Leer" en Demo Restaurante')

    const rol = await api<{ id: string }>(request, 'post', '/roles', {
      token: adminToken,
      data: { nombre: `E2E solo Pasarelas ${Date.now()}` },
    })
    rolId = rol.id
    const permisos = await request.put(
      `${API}/roles/${rolId}/modules/${pasarelas.moduloTenantId}/permissions`,
      { headers: auth, data: { moduloAppPermisoIds: [leer.moduloAppPermisoId] } },
    )
    if (!permisos.ok()) throw new Error(`PUT permisos → ${permisos.status()}: ${await permisos.text()}`)

    const miembros = await api<{ usuarioId: string, correo: string }[]>(
      request,
      'get',
      '/tenants/members',
      { token: adminToken },
    )
    usuarioId = miembros.find(m => m.correo === CORREO)?.usuarioId
    if (!usuarioId) throw new Error(`${CORREO} no es miembro de Demo Restaurante`)
    await api(request, 'post', `/roles/${rolId}/users`, {
      token: adminToken,
      data: { usuarioId },
    })
  })

  test.afterAll(async ({ request }) => {
    const auth = { Authorization: `Bearer ${adminToken}` }
    // No asevera: corre aunque el `beforeAll` haya llegado a la mitad.
    if (rolId && usuarioId) {
      await request.delete(`${API}/roles/${rolId}/users/${usuarioId}`, { headers: auth })
    }
    if (rolId) await request.delete(`${API}/roles/${rolId}`, { headers: auth })
  })

  test('la tarjeta da el número del backend y lleva a /ordenes filtrado', async ({ browser, request }) => {
    // Cuántas hay lo dice el backend: otras corridas pueden haber dejado alguna.
    const { meta } = await api<Listado>(
      request,
      'get',
      '/pasarela/admin/ordenes?sinVenta=true&pageSize=1',
      { token: adminToken },
    )

    const page = await entrarComo(browser, CORREO)
    const tarjeta = page.locator('a[href="/ordenes?sinVenta=true"]').filter({ hasText: 'Pagos sin venta' })
    await expect(tarjeta).toBeVisible()
    if (meta.total === 0) {
      await expect(tarjeta.getByText('Ningún pago online sin venta.')).toBeVisible()
    }
    else {
      await expect(tarjeta.locator('[data-qa="pagos-sin-venta-total"]')).toContainText(String(meta.total))
    }

    const listado = page.waitForResponse(
      r => r.url().includes('/api/pasarela/admin/ordenes') && r.url().includes('sinVenta=true'),
    )
    await tarjeta.click()
    await expect(page).toHaveURL(/\/ordenes\?sinVenta=true$/)
    expect((await listado).status()).toBe(200)
    // El filtro llega puesto desde la URL (el selector lo muestra), y lo que
    // lista es solo lo sin venta.
    await expect(page.getByText('Pagada sin venta', { exact: true }).first()).toBeVisible()
    if (meta.total === 0) {
      await expect(page.getByText('Ninguna orden coincide con los filtros.')).toBeVisible()
    }
    else {
      const filas = page.locator('tbody tr')
      await expect(page.locator('[data-qa="orden-sin-venta"]')).toHaveCount(await filas.count())
    }
  })
})
