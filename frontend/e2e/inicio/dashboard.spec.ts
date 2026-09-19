import { test, expect, type Page } from '@playwright/test'

/**
 * El dashboard de inicio en un navegador de verdad (spec
 * `2026-09-18-dashboard-inicio-design.md` § 6), con la sesión del admin del seed
 * que deja `auth.setup.ts`.
 *
 * Es la capa que los tests de componente no ven: ahí `useApiFetch` y el router
 * están mockeados, y así pasó en verde una tarjeta `UCard as="NuxtLink"` que
 * renderizaba `<nuxtlink>` sin `href` y no llevaba a ningún lado. Acá se clica.
 *
 * Los permisos por bloque, el 403 que oculta y el "sin reintento" ya los cubren
 * los e2e de API y los `*.nuxt.spec.ts`: este spec no los repite.
 */

/** La tarjeta, no el link del menú lateral que apunta a la misma ruta. */
function tarjeta(page: Page, href: string, texto: string | RegExp) {
  return page.locator(`a[href="${href}"]`).filter({ hasText: texto })
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
