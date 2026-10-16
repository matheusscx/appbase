import { test, expect } from '../support/sesion'

// Identidad de Venka en el menú lateral y el encabezado (spec 2026-10-13-identidad-venka-en-app
// §3.4). Con sesión del admin: va aparte de `marca.spec.ts`, que corre sin sesión.
// Es el mismo tenant que elige `auth.setup.ts`.
const TENANT = process.env.E2E_TENANT ?? 'Demo Restaurante'

test.describe('marca Venka con sesión', () => {
  test('el menú lateral es petróleo y lleva el logo', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    const lateral = page.locator('div[data-slot="root"][data-collapsed]')
    await expect(lateral).toHaveCSS('background-color', 'rgb(14, 77, 87)')

    const logo = lateral.locator('img[alt="Venka"]')
    await expect(logo).toBeVisible()
    await expect(logo).toHaveAttribute('src', '/marca/venka-negativo.svg')
    await expect(lateral.getByText(TENANT, { exact: true })).toBeVisible()
  })

  test('los links del menú se leen claros sobre petróleo y el activo lleva la marca menta', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    const menu = page.locator('[data-qa="menu-lateral"]')

    // Guarda de la reasignación de tokens `--ui-*` de `sobrePetroleo` (layouts/dashboard.vue):
    // sin ella el texto inactivo vuelve al gris del tema y se pierde sobre el fondo petróleo.
    const inactivo = menu.locator('a:not([aria-current="page"])').first()
    await expect(inactivo).toBeVisible()
    await expect(inactivo).toHaveCSS('color', 'rgb(217, 236, 239)')

    // La sección activa lleva la marca menta (`bg-menta`, #7FD8C3) pegada al borde.
    const activo = menu.locator('a[aria-current="page"]')
    await expect(activo).toHaveCount(1)
    const marca = await activo.locator('span[aria-hidden="true"]').first()
      .evaluate(el => getComputedStyle(el).backgroundColor)
    expect(marca).toBe('rgb(127, 216, 195)')
  })

  test('colapsado muestra el sello', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Colapsar barra lateral' }).click()
    await expect(page.locator('img[src="/marca/venka-sello.svg"]')).toBeVisible()
    await expect(page.locator('img[src="/marca/venka-negativo.svg"]')).toBeHidden()
  })

  test('el título de la pantalla va con la letra de marca', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    const titulo = page.locator('[data-slot="title"]').first()
    await expect(titulo).toBeVisible()
    const familia = await titulo.evaluate(el => getComputedStyle(el).fontFamily)
    expect(familia.startsWith('"Bricolage Grotesque"')).toBe(true)
  })
})
