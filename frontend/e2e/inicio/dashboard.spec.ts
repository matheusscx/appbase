import type { Browser, Page } from '@playwright/test'
import { test, expect } from '../support/sesion'
import Decimal from 'decimal.js'
import {
  API,
  EFECTIVO,
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

/** Lo único que este spec lee de `GET /resumen-negocio/hoy`. */
interface ResumenHoy {
  ventas: { vendidoDesglose: { bruto: string, notasCredito: string } }
}

/**
 * La tarjeta, no el link del menú lateral que apunta a la misma ruta. El texto
 * que la distingue de "Por cobrar" (que también va a `/ventas`) es un rótulo que
 * solo tiene la de ventas: "Ticket promedio".
 */
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
  await expect(tarjeta(page, '/ventas', 'Ticket promedio')).toBeVisible()
})

test('las tarjetas llevan a su detalle con un clic', async ({ page }) => {
  await page.goto('/')

  await tarjeta(page, '/salones', /mesas ocupadas/).click()
  await expect(page).toHaveURL(/\/salones$/)

  await page.goto('/')
  await tarjeta(page, '/ventas', 'Ticket promedio').click()
  await expect(page).toHaveURL(/\/ventas$/)
})

test('una tarjeta se abre con el teclado', async ({ page }) => {
  await page.goto('/')

  const ventas = tarjeta(page, '/ventas', 'Ticket promedio')
  await ventas.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/ventas$/)
})

test('"Actualizar" vuelve a pedir el día del dueño', async ({ page }) => {
  await page.goto('/')
  await expect(tarjeta(page, '/ventas', 'Ticket promedio')).toBeVisible()

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
    const ventas = tarjeta(page, '/ventas', 'Ticket promedio')
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

test.describe('quien no es admin pero tiene "Resumen del negocio: Leer"', () => {
  // El `beforeAll` arma un rol y se lo presta a una cuenta del seed; el `afterAll`
  // lo deshace. La suite corre con `workers: 1` (`playwright.config.ts`), así que
  // ese armado ocurre una sola vez.

  /**
   * La cuenta del seed que presta el escenario: `Compras:Leer` y nada más, y
   * ningún otro spec de navegador entra con ella. Contraseña del seed, igual que
   * las de `entrarComo`.
   */
  const CORREO = 'compras.lectura@paris.cl'

  let adminToken: string
  let rolId: string | undefined
  let usuarioId: string | undefined

  test.beforeAll(async ({ request }) => {
    adminToken = await tokenDe(request, TENANTS.restaurante)
    const auth = { Authorization: `Bearer ${adminToken}` }

    // Los ids del módulo y del permiso se buscan por nombre, como el e2e de la
    // API: ninguno se escribe a mano.
    const modulos = await api<
      {
        nombre: string
        moduloTenantId: string
        permisos: { permisoNombre: string, moduloAppPermisoId: string }[]
      }[]
    >(request, 'get', '/roles/modulos-disponibles', { token: adminToken })
    const resumen = modulos.find(m => m.nombre === 'Resumen del negocio')
    const leer = resumen?.permisos.find(p => p.permisoNombre === 'Leer')
    if (!resumen || !leer) throw new Error('El seed no trae "Resumen del negocio: Leer"')

    const rol = await api<{ id: string }>(request, 'post', '/roles', {
      token: adminToken,
      data: { nombre: `E2E solo Resumen ${Date.now()}` },
    })
    rolId = rol.id
    const permisos = await request.put(
      `${API}/roles/${rolId}/modules/${resumen.moduloTenantId}/permissions`,
      { headers: auth, data: { moduloAppPermisoIds: [leer.moduloAppPermisoId] } },
    )
    if (!permisos.ok()) throw new Error(`PUT permisos → ${permisos.status()}: ${await permisos.text()}`)

    // Una cuenta nueva no puede entrar con contraseña desde acá: su alta manda un
    // link de invitación por correo y el token no sale por la API. Se le suma el
    // rol a una cuenta del seed y se lo saca al terminar.
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

  test('ve en la tarjeta de ventas lo que restó una nota de crédito', async ({ browser, request }) => {
    const MONTO_NC = '1234'
    const notasDeHoy = async () =>
      (await api<ResumenHoy>(request, 'get', '/resumen-negocio/hoy', { token: adminToken }))
        .ventas.vendidoDesglose.notasCredito

    let page: Page | undefined
    let cajaId: string | undefined
    let item: { id: string } | undefined
    let totalVenta: string | undefined
    try {
      page = await entrarComo(browser, CORREO)
      cajaId = await abrirCaja(request, adminToken)
      item = await crearProducto(request, adminToken, {
        nombre: `Inicio NC E2E ${Date.now()}`,
        precioBase: '7350',
      })
      const ventas = tarjeta(page, '/ventas', 'Ticket promedio')
      await expect(ventas).toBeVisible()

      // El día puede traer notas de crédito de corridas anteriores: lo que se
      // afirma es cuánto SUBIÓ, no que haya alguna.
      const antes = await notasDeHoy()

      // La venta se crea y se cobra entera por API; la NC es parcial para que su
      // monto no se confunda con el total.
      const venta = await api<{ id: string, totalFinal: string }>(request, 'post', '/ventas', {
        token: adminToken,
        data: { lineas: [{ itemId: item.id, cantidad: '2' }] },
      })
      totalVenta = venta.totalFinal
      const abono = await api<{ pagos: { id: string }[] }>(request, 'post', '/pagos', {
        token: adminToken,
        data: { ventaId: venta.id, pagos: [{ metodoPagoId: EFECTIVO, monto: venta.totalFinal }] },
      })
      // Toda nota declara por dónde vuelve la plata: acá, por el efectivo cobrado.
      await api(request, 'post', `/ventas/${venta.id}/notas-credito`, {
        token: adminToken,
        data: { monto: MONTO_NC, devolucion: { pagoId: abono.pagos[0].id } },
      })

      const despues = await notasDeHoy()
      expect(new Decimal(despues).minus(antes).toFixed(0)).toBe(MONTO_NC)

      await page.getByRole('button', { name: 'Actualizar' }).click()
      // La línea muestra lo que dice el backend, no solo "alguna nota": CLP sin
      // decimales y miles con ".". El lookahead evita que "−$1.234" calce con un
      // número más largo.
      const esperado = new Decimal(despues).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
      await expect(ventas).toContainText(
        new RegExp(`notas de crédito −\\$${esperado.replace(/\./g, '\\.')}(?![\\d.])`),
      )
    }
    finally {
      if (cajaId) await cerrarCaja(request, adminToken, cajaId, totalVenta ?? '0')
      if (item) await limpiarItems(request, adminToken, [item.id])
      await page?.context().close()
    }
  })
})
