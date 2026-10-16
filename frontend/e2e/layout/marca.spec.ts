import { test, expect } from '@playwright/test'

// Identidad de Venka en el tema global (spec 2026-10-13-identidad-venka-en-app §3.1/§3.5).
// Sin sesión: todo se ve en /login.
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('marca Venka', () => {
  test('la pestaña dice Venka', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveTitle(/Venka/)
  })

  test('el botón principal es petróleo', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('button[type="submit"]')).toHaveCSS('background-color', 'rgb(14, 77, 87)')
  })

  test('las fuentes de marca cargan desde la app', async ({ page }) => {
    const externos: string[] = []
    page.on('request', (req) => {
      const { hostname } = new URL(req.url())
      if (hostname === 'fonts.googleapis.com' || hostname === 'fonts.gstatic.com') externos.push(req.url())
    })
    await page.goto('/login')
    // El navegador baja una cara solo cuando algo la usa, y el login todavía no usa
    // Bricolage (`font-display`): se la pide explícita para probar que el archivo que
    // sirve la app existe y parsea, no que alguna pantalla la use.
    await page.evaluate(async () => {
      await document.fonts.load('16px "DM Sans"')
      await document.fonts.load('16px "Bricolage Grotesque"')
      await document.fonts.ready
    })

    // `document.fonts.check` devuelve true aunque la fuente no exista: se mira el estado de cada cara.
    const cargadas = await page.evaluate(() =>
      [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/["']/g, '')))
    expect(cargadas).toContain('DM Sans')
    expect(cargadas).toContain('Bricolage Grotesque')
    expect(externos).toEqual([])
  })
})
