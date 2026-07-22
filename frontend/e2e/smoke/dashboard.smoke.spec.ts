import { test, expect } from '@playwright/test'

// @smoke — subconjunto que corre en cada tarea (README). Prueba el pipeline E2E
// end-to-end: sesión reutilizada (storageState) → dashboard autenticado carga.
test('@smoke el dashboard carga con sesión autenticada', async ({ page }) => {
  await page.goto('/')

  // no redirige a login (la sesión de storageState es válida)
  await expect(page).not.toHaveURL(/\/login/)
  // chrome de la app autenticada
  await expect(page.getByText('Bienvenido')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ventas' })).toBeVisible()
})
