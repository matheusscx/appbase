import { test, expect } from '@playwright/test'

// @smoke — la invariante de despliegue, no una pantalla: **el navegador habla
// con un solo origen**. Todo `/api` sale hacia el propio frontend, que reenvía
// al backend (`server/api/[...].ts`, ADR-022).
//
// Por qué existe este test y no alcanza con que el login funcione: el login
// funcionaba en local con la app llamando al backend directo, porque
// `localhost:5173` y `localhost:3000` se diferencian solo en el PUERTO y el
// puerto no cuenta para «sitio». Desplegado son sitios distintos, la cookie
// `SameSite=Lax` no viajaba, y el demo no dejaba entrar. Un test que solo mire
// «¿entró?» pasa en local en los dos mundos: pasaba antes del arreglo y pasa
// después. El que discrimina es éste, que mira ADÓNDE se hablan — y contra el
// código anterior da rojo, porque ahí las llamadas iban a `:3000`.
//
// Corre el login por la UI en vez de reusar `storageState`: la cookie de
// refresh se pone en el login y se usa en `switch-tenant`, así que ese tramo es
// justo el que hay que observar.
test.use({ storageState: { cookies: [], origins: [] } })

test('@smoke el navegador solo habla con el origen del frontend', async ({ page, baseURL }) => {
  const propio = new URL(baseURL!).origin
  const ajenas: string[] = []
  const propias: string[] = []

  // Solo las llamadas a la API. Quedan afuera a propósito las de terceros que
  // no son nuestras: en modo dev, Nuxt UI baja los iconos de `api.iconify.design`
  // en caliente. Es cross-origin y está bien que lo sea —no lleva sesión ni
  // cookie— y meterlo en esta aserción convertiría el test en una lista de
  // permitidos que se pudre. Lo que este test protege es que **nuestra API** no
  // se hable con otro origen.
  page.on('request', (req) => {
    const tipo = req.resourceType()
    if (tipo !== 'fetch' && tipo !== 'xhr') return
    const url = new URL(req.url())
    if (!url.pathname.startsWith('/api')) return
    if (url.origin === propio) propias.push(url.pathname)
    else ajenas.push(`${req.method()} ${req.url()}`)
  })

  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.getByPlaceholder('tu@email.com').fill('admin@sistema.com')
  await page.locator('input[type="password"]').first().fill('admin')
  const submit = page.locator('button[type="submit"]').first()
  await expect(submit).toBeEnabled()
  await submit.click()

  // `switch-tenant` es la llamada que necesita la cookie de refresh: llegar acá
  // ya prueba que viajó.
  await page.waitForURL('**/select-tenant')
  await page.getByRole('button', { name: 'Demo Restaurante' }).click()
  await page.waitForURL((url) => url.pathname === '/')
  await expect(page.getByText('Bienvenido')).toBeVisible()

  expect(ajenas, 'llamadas a la API fuera del origen del frontend').toEqual([])
  // Y que efectivamente hubo llamadas que mirar: si `/api` dejara de usarse el
  // array vacío pasaría por la razón equivocada.
  expect(propias.length, 'llamadas a la API observadas').toBeGreaterThan(0)
})
