import { test, expect, type Browser, type Page } from '@playwright/test'
import {
  TENANTS,
  abrirCaja,
  api,
  cerrarCaja,
  crearProducto,
  limpiarItems,
  tokenDe,
} from '../support/api'

/**
 * El dashboard de inicio en un navegador de verdad (spec
 * `2026-09-18-dashboard-inicio-design.md` § 6), con la sesión del admin del seed
 * que deja `auth.setup.ts`.
 *
 * Es la capa que los tests de componente no ven: ahí `useApiFetch` y el router
 * están mockeados, y así pasó en verde una tarjeta `UCard as="NuxtLink"` que
 * renderizaba `<nuxtlink>` sin `href` y no llevaba a ningún lado. Acá se clica.
 *
 * También lo que solo se ve con el backend real detrás: la venta que mueve los
 * números, el usuario sin el permiso del dueño, el tenant sin el módulo (403
 * que oculta sin error), la pestaña oculta y el backend caído.
 *
 * ⚠️ Nada de acá usa a los garzones del seed: la venta es de mostrador, con caja
 * e ítem propios, y la caja se cierra al terminar.
 */

/** La tarjeta, no el link del menú lateral que apunta a la misma ruta. */
function tarjeta(page: Page, href: string, texto: string | RegExp) {
  return page.locator(`a[href="${href}"]`).filter({ hasText: texto })
}

/**
 * Otro usuario u otro tenant, en un contexto limpio: la sesión del proyecto es la
 * del admin en "Demo Restaurante" (`auth.setup.ts`), y acá se entra por el login
 * de la app con las mismas credenciales del seed, sin tocar esa sesión.
 */
async function entrarComo(
  browser: Browser,
  email: string,
  tenant?: string,
): Promise<Page> {
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
    await page.getByRole('button', { name: tenant ?? 'Demo Restaurante' }).click()
  }
  await page.waitForURL(url => url.pathname === '/')
  await expect(page.getByText('Bienvenido')).toBeVisible()
  return page
}

/** Hace que la app vea la pestaña oculta o visible, como al cambiar de pestaña. */
async function pestana(page: Page, estado: 'hidden' | 'visible') {
  await page.evaluate((valor) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => valor,
    })
    document.dispatchEvent(new Event('visibilitychange'))
  }, estado)
}

test('muestra las dos zonas con sus datos', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Ahora' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Hoy' })).toBeVisible()
  await expect(tarjeta(page, '/salones', /mesas ocupadas/)).toBeVisible()
  await expect(tarjeta(page, '/ventas', 'antes de notas de crédito')).toBeVisible()
})

test('las tarjetas llevan a su detalle con un clic', async ({ page }) => {
  await page.goto('/')

  await tarjeta(page, '/salones', /mesas ocupadas/).click()
  await expect(page).toHaveURL(/\/salones$/)

  await page.goto('/')
  await tarjeta(page, '/ventas', 'antes de notas de crédito').click()
  await expect(page).toHaveURL(/\/ventas$/)
})

test('una tarjeta se abre con el teclado', async ({ page }) => {
  await page.goto('/')

  const ventas = tarjeta(page, '/ventas', 'antes de notas de crédito')
  await ventas.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/ventas$/)
})

test('"Actualizar" vuelve a pedir el día del dueño', async ({ page }) => {
  await page.goto('/')
  await expect(tarjeta(page, '/ventas', 'antes de notas de crédito')).toBeVisible()

  const recarga = page.waitForResponse(
    r => r.url().includes('/api/resumen-negocio/hoy') && r.status() === 200,
  )
  await page.getByRole('button', { name: 'Actualizar' }).click()
  await recarga
})

test('la zona "Ahora" se refresca sola al minuto', async ({ page }) => {
  await page.clock.install()
  await page.goto('/')
  await expect(tarjeta(page, '/salones', /mesas ocupadas/)).toBeVisible()

  const refresco = page.waitForResponse(
    r => r.url().includes('/api/salones/ocupacion') && r.status() === 200,
  )
  await page.clock.fastForward('01:00')
  await refresco
})

test('"Actualizar" trae la venta que se hizo después de abrir el inicio', async ({ page, request }) => {
  const token = await tokenDe(request, TENANTS.restaurante)
  const cajaId = await abrirCaja(request, token)
  const item = await crearProducto(request, token, {
    nombre: `Inicio E2E ${Date.now()}`,
    precioBase: '7350',
  })
  let ventaId: string | undefined
  try {
    await page.goto('/')
    const ventas = tarjeta(page, '/ventas', 'antes de notas de crédito')
    await expect(ventas).toBeVisible()
    const antes = await ventas.innerText()

    // Pendiente y sin documento: es lo único que se puede anular al final.
    const venta = await api<{ id: string }>(request, 'post', '/ventas', {
      token,
      data: { lineas: [{ itemId: item.id, cantidad: '2' }] },
    })
    ventaId = venta.id

    await page.getByRole('button', { name: 'Actualizar' }).click()
    await expect(ventas).not.toHaveText(antes)
  }
  finally {
    if (ventaId) {
      await api(request, 'post', `/ventas/${ventaId}/anular`, {
        token,
        data: { motivo: 'Limpieza del e2e del dashboard' },
      })
    }
    await cerrarCaja(request, token, cajaId, '0.0000')
    await limpiarItems(request, token, [item.id])
  }
})

test('con la pestaña oculta no pide nada, y al volver pide una vez', async ({ page }) => {
  await page.clock.install()
  await page.goto('/')
  await expect(tarjeta(page, '/salones', /mesas ocupadas/)).toBeVisible()

  let pedidos = 0
  page.on('request', (r) => {
    if (r.url().includes('/api/salones/ocupacion')) pedidos++
  })

  await pestana(page, 'hidden')
  await page.clock.fastForward('03:00')
  expect(pedidos).toBe(0)

  const alVolver = page.waitForResponse(r => r.url().includes('/api/salones/ocupacion'))
  await pestana(page, 'visible')
  await alVolver
  expect(pedidos).toBe(1)
})

test('sin conexión avisa y conserva el último dato', async ({ page }) => {
  await page.clock.install()
  await page.goto('/')
  const salon = tarjeta(page, '/salones', /mesas ocupadas/)
  await expect(salon).toBeVisible()
  const dato = await salon.getByText(/mesas ocupadas/).innerText()

  await page.route('**/api/salones/ocupacion', route => route.abort())
  const fallo = page.waitForEvent('requestfailed', r => r.url().includes('/api/salones/ocupacion'))
  await page.clock.fastForward('01:00')
  await fallo

  await expect(salon.getByText(/Sin conexión/)).toBeVisible()
  await expect(salon.getByText(dato)).toBeVisible()
})

test('el encargado de salón ve el turno y no el día del dueño', async ({ browser }) => {
  const page = await entrarComo(browser, 'encargado.salon@paris.cl')
  try {
    await expect(page.getByRole('heading', { name: 'Ahora' })).toBeVisible()
    await expect(tarjeta(page, '/salones', /mesas ocupadas/)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Hoy' })).toHaveCount(0)
  }
  finally {
    await page.context().close()
  }
})

test('en un tenant sin el módulo, "Hoy" no aparece y no hay error', async ({ browser }) => {
  const page = await entrarComo(browser, 'admin@sistema.com', 'Demo Bodega')
  try {
    // El admin pasa el filtro del frontend (`esAdmin`), el backend contesta 403
    // y la zona se oculta. Se recarga con el listener ya puesto: la primera
    // carga pudo haber respondido antes de que el test empezara a escuchar.
    const respuesta = page.waitForResponse(r => r.url().includes('/api/resumen-negocio/hoy'))
    await page.reload()
    expect((await respuesta).status()).toBe(403)
    await expect(page.getByRole('heading', { name: 'Hoy' })).toHaveCount(0)
    await expect(page.getByText(/Sin conexión|Error/)).toHaveCount(0)
  }
  finally {
    await page.context().close()
  }
})
