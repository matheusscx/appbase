import { test, expect } from '@playwright/test'

// @smoke — subconjunto que corre en cada tarea (README). Prueba el pipeline E2E
// end-to-end: sesión reutilizada (storageState) → dashboard autenticado carga.
test('@smoke el dashboard carga con sesión autenticada', async ({ page }) => {
  await page.goto('/')

  // no redirige a login (la sesión de storageState es válida)
  await expect(page).not.toHaveURL(/\/login/)
  // chrome de la app autenticada
  await expect(page.getByText('Bienvenido')).toBeVisible()
  // El grupo "Ventas" del menú lateral: prueba el chrome autenticado —un menú armado
  // con el usuario de la sesión—, no solo que la página respondió. Es un botón (abre
  // el grupo), no un link como las tarjetas del dashboard.
  await expect(
    page.locator('[data-qa="menu-lateral"]').getByRole('button', { name: 'Ventas', exact: true }),
  ).toBeVisible()
})
