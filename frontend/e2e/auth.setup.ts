import { test as setup, expect } from '@playwright/test'

// Login vía UI una vez → guarda la sesión (storageState) y la reutilizan todos los
// tests. Credenciales del seed de dev (admin@sistema.com / admin) — no son secretos
// reales. admin@sistema.com pertenece a >1 tenant → hay pantalla de selección.
const authFile = 'e2e/.auth/paris.json'
const EMAIL = process.env.E2E_EMAIL ?? 'admin@sistema.com'
const PASSWORD = process.env.E2E_PASSWORD ?? 'admin'
const TENANT = process.env.E2E_TENANT ?? 'Paris'

setup('autenticar y elegir tenant', async ({ page }) => {
  // networkidle: esperar la hidratación de Nuxt antes de tipear, si no el v-model
  // no captura y el form queda inválido (botón submit deshabilitado).
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.getByPlaceholder('tu@email.com').fill(EMAIL)
  await page.locator('input[type="password"]').first().fill(PASSWORD)

  const submit = page.locator('button[type="submit"]').first()
  await expect(submit).toBeEnabled()
  await submit.click()

  await page.waitForURL('**/select-tenant')
  await page.getByRole('button', { name: TENANT }).click()

  await page.waitForURL((url) => url.pathname === '/')
  await expect(page.getByText('Bienvenido')).toBeVisible()

  await page.context().storageState({ path: authFile })
})
