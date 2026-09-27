import { test, expect, type Page } from '@playwright/test'
import { API } from '../support/api'

/**
 * Si el login no puede meter al usuario en su empresa, se lo dice.
 *
 * Con un solo tenant, el login encadena `my-tenants` y el `switch-tenant`
 * automático. Si cualquiera de los dos fallaba, el error quedaba en un store que
 * ninguna pantalla leía: medido el 2026-09-27, con el switch en 500 el login se
 * quedaba quieto sin mensaje, y con `my-tenants` en 500 mandaba a `/no-tenant`
 * ("Tu cuenta no pertenece a ninguna empresa") — falso. La entrada por Google
 * quedaba girando en "Iniciando sesión…", y volver a entrar con el token sin
 * tenant cargaba el panel con "Trabajando en —". La salida de los tres es la
 * misma, decidida por el owner: volver al login con el aviso.
 *
 * El 500 se fuerza interceptando la respuesta en el navegador: es la única forma
 * de hacer fallar ese endpoint sin tocar el backend compartido.
 *
 * ⚠️ Sin `storageState` y con `admin.paris`, que tiene **un** tenant: el usuario
 * del resto de la suite tiene dos y va a la pantalla de elegir, que es otro camino.
 */
test.use({ storageState: { cookies: [], origins: [] } })

const EMAIL = 'admin.paris@paris.cl'
const PASSWORD = 'admin'

async function fallar(page: Page, ruta: string) {
  await page.route(`**/api/auth/${ruta}`, r =>
    r.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 500, message: 'Internal server error' }),
    }),
  )
}

async function entrar(page: Page) {
  // networkidle: esperar la hidratación antes de tipear (ver auth.setup.ts).
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.getByPlaceholder('tu@email.com').fill(EMAIL)
  await page.locator('input[type="password"]').first().fill(PASSWORD)
  await page.locator('button[type="submit"]').first().click()
}

test('login: si falla el switch automático, avisa y se queda en /login', async ({ page }) => {
  await fallar(page, 'switch-tenant')
  await entrar(page)

  await expect(page.getByText('Internal server error')).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
})

test('login: si falla my-tenants, avisa en vez de decir que no tiene empresa', async ({ page }) => {
  await fallar(page, 'my-tenants')
  await entrar(page)

  await expect(page.getByText('Internal server error')).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByText('Sin acceso a empresas')).toHaveCount(0)
})

test('callback de Google: si falla el switch, vuelve al login con el aviso', async ({ page, request }) => {
  // El token de `/auth/login` tiene la misma forma que el que emite el callback
  // de Google (`tenant_id: null`): así se llega a la pantalla sin pasar por OAuth.
  const res = await request.post(`${API}/auth/login`, { data: { email: EMAIL, password: PASSWORD } })
  expect(res.ok()).toBeTruthy()
  const { access_token } = await res.json() as { access_token: string }
  await fallar(page, 'switch-tenant')

  await page.goto(`/auth/callback?token=${access_token}`)

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByText('Internal server error')).toBeVisible()
})

test('middleware: con un token sin tenant y el switch fallando, vuelve al login con el aviso', async ({ page, request }) => {
  // Se llega con la cookie puesta a mano, sin pasar por el login: así la única
  // pantalla que puede avisar es la que decide el middleware.
  const res = await request.post(`${API}/auth/login`, { data: { email: EMAIL, password: PASSWORD } })
  expect(res.ok()).toBeTruthy()
  const { access_token } = await res.json() as { access_token: string }
  await page.context().addCookies([{ name: 'access_token', value: access_token, url: process.env.E2E_BASE_URL! }])
  await fallar(page, 'switch-tenant')

  await page.goto('/')

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByText('Internal server error')).toBeVisible()
  await expect(page.getByText('Trabajando en')).toHaveCount(0)
})
