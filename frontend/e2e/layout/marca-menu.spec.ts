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
