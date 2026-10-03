import { test, expect, type Page } from '@playwright/test'

/**
 * El menú lateral agrupado por módulo (`composables/useMenuLateral.ts`, docs/patterns/frontend.md
 * § 1), en navegador real. El gate de cada pantalla, rol por rol, lo cubre el test unitario del
 * composable; acá va lo que solo se ve con el componente montado: que un grupo cerrado no dibuja
 * sus pantallas, que el grupo de la pantalla actual se abre aunque los permisos lleguen después
 * del montaje, y cómo se navega con el lateral colapsado y en celular.
 *
 * El bodeguero (sin `Compras:Pagar`) está en `compras/compras-deuda-proveedor-bodeguero.spec.ts`,
 * que ya entra como él.
 */

/** Las 26 pantallas del menú plano anterior: agrupar no puede perder ni duplicar ninguna. */
const PANTALLAS = [
  '/', '/mi-caja', '/cajas',
  '/ventas/pos', '/ventas', '/pagos', '/ordenes',
  '/propinas',
  '/salones', '/sesiones-garzon', '/salones/anulaciones',
  '/tienda', '/tienda/suscripciones', '/tienda/medios-pago',
  '/suscripciones', '/terceros',
  '/inventario', '/inventario/recuentos', '/inventario/traslados', '/mermas',
  '/inventario/stock-minimo', '/desfases',
  '/compras', '/compras/por-pagar',
  '/reportes', '/admin',
]

const GRUPOS = ['Ventas', 'Salones', 'Tienda Online', 'Inventario', 'Compras']

function menuLateral(page: Page) {
  return page.locator('[data-qa="menu-lateral"]')
}

/** Login por pantalla con un usuario del seed. Todos los de acá tienen un solo tenant. */
async function entrarComo(page: Page, email: string) {
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.getByPlaceholder('tu@email.com').fill(email)
  await page.locator('input[type="password"]').first().fill('admin')
  const submit = page.locator('button[type="submit"]').first()
  await expect(submit).toBeEnabled()
  await submit.click()
  await page.waitForURL(url => url.pathname === '/')
}

test('el admin llega a cada pantalla del menú anterior, y a cada una una sola vez', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  const menu = menuLateral(page)

  for (const grupo of GRUPOS) {
    const boton = menu.getByRole('button', { name: grupo, exact: true })
    await boton.click()
    await expect(boton).toHaveAttribute('aria-expanded', 'true')
  }
  // Desplegado, el grupo solo abre: su `to` (la primera pantalla) es para el modo colapsado.
  expect(new URL(page.url()).pathname).toBe('/')

  const hrefs = await menu.getByRole('link').evaluateAll(
    links => links.map(link => link.getAttribute('href')),
  )
  // Ordenado y no como conjunto: así falla tanto la pantalla que falta como la que quedó
  // repetida en dos grupos (un Set la escondería).
  expect([...hrefs].sort()).toEqual([...PANTALLAS].sort())
})

test('entrar a una pantalla desde una tarjeta del Inicio abre su grupo', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  const menu = menuLateral(page)
  const ventas = menu.getByRole('button', { name: 'Ventas', exact: true })
  await expect(ventas).toHaveAttribute('aria-expanded', 'false')

  // La tarjeta de ventas del Inicio: "Ticket promedio" la distingue de "Por cobrar", que
  // también va a `/ventas` (inicio/dashboard.spec.ts).
  await page.locator('a[href="/ventas"]').filter({ hasText: 'Ticket promedio' }).click()
  await page.waitForURL(url => url.pathname === '/ventas')

  await expect(ventas).toHaveAttribute('aria-expanded', 'true')
  await expect(menu.getByRole('link', { name: 'Historial', exact: true }))
    .toHaveAttribute('aria-current', 'page')
})

test.describe('entrar directo (F5) con un rol del tenant', () => {
  // No con el admin del e2e: es superadmin, y `can()` lo deja pasar sin esperar los permisos,
  // así que su menú ya está completo al montarse. Medido el 2026-10-02: un mutante que abría el
  // grupo con `defaultOpen` pasó como admin y lo cazó el bodeguero. Con un rol del tenant el
  // menú se monta vacío y los grupos aparecen cuando llegan los permisos.
  test.use({ storageState: { cookies: [], origins: [] } })

  for (const caso of [
    { correo: 'aprobador@paris.cl', ruta: '/inventario/recuentos', grupo: 'Inventario', pantalla: 'Recuentos', hermana: 'Stock' },
    { correo: 'vendedor@paris.cl', ruta: '/ventas/pos', grupo: 'Ventas', pantalla: 'Punto de venta', hermana: 'Historial' },
  ]) {
    test(`${caso.ruta} abre ${caso.grupo} y marca solo ${caso.pantalla}`, async ({ page }) => {
      await entrarComo(page, caso.correo)
      await page.goto(caso.ruta, { waitUntil: 'networkidle' })
      const menu = menuLateral(page)

      // El único grupo abierto es el de la pantalla.
      await expect(menu.locator('button[aria-expanded="true"]')).toHaveText([caso.grupo])
      await expect(menu.getByRole('link', { name: caso.pantalla, exact: true }))
        .toHaveAttribute('aria-current', 'page')
      // La "raíz" del grupo (`/inventario`, `/ventas`) es una ruta hermana, no la madre:
      // no se marca también.
      await expect(menu.getByRole('link', { name: caso.hermana, exact: true }))
        .not.toHaveAttribute('aria-current', 'page')
    })
  }
})

test('navegar a otro grupo no cierra el que estaba abierto', async ({ page }) => {
  await page.goto('/inventario', { waitUntil: 'networkidle' })
  const menu = menuLateral(page)

  await menu.getByRole('button', { name: 'Compras', exact: true }).click()
  await menu.getByRole('link', { name: 'Recepciones', exact: true }).click()
  await page.waitForURL(url => url.pathname === '/compras')

  await expect(menu.getByRole('button', { name: 'Inventario', exact: true }))
    .toHaveAttribute('aria-expanded', 'true')
  const compras = menu.getByRole('button', { name: 'Compras', exact: true })
  await expect(compras).toHaveAttribute('aria-expanded', 'true')

  // Cerrarlo con un clic llega al estado del menú (el `v-model`), aunque sea el grupo de la
  // pantalla actual: si el clic no le escribiera, el grupo controlado seguiría abierto.
  await compras.click()
  await expect(compras).toHaveAttribute('aria-expanded', 'false')
})

test('con el lateral colapsado, el ícono del grupo muestra sus pantallas', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Colapsar barra lateral' }).click()

  // Colapsado, el grupo es un link a su primera pantalla (sin nombre visible); al pasar el
  // mouse, el popover lista el resto.
  await menuLateral(page).locator('a[href="/inventario"]').hover()
  const recuentos = page.getByRole('link', { name: 'Recuentos', exact: true })
  await expect(recuentos).toBeVisible()
  await recuentos.click()

  await page.waitForURL(url => url.pathname === '/inventario/recuentos')
})

test.describe('en celular', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('el panel abre con el grupo actual desplegado y se cierra al elegir una pantalla', async ({ page }) => {
    await page.goto('/inventario/recuentos', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Abrir barra lateral' }).click()

    const panel = page.getByRole('dialog')
    const menu = panel.locator('[data-qa="menu-lateral"]')
    await expect(menu.getByRole('button', { name: 'Inventario', exact: true }))
      .toHaveAttribute('aria-expanded', 'true')

    await menu.getByRole('link', { name: 'Traslados', exact: true }).click()

    await page.waitForURL(url => url.pathname === '/inventario/traslados')
    await expect(panel).toBeHidden()
  })
})
