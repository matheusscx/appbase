import { test, expect } from '@playwright/test'
import { api, crearProducto, tokenDe, TENANTS, CREDENCIALES } from '../support/api'

/**
 * Cambiar de institución no puede arrastrar datos de la anterior.
 *
 * Es el flujo que el backlog marcaba como **el más valioso de la suite**, y la
 * razón está en dónde vive el riesgo: `tenant_id` sale del token, así que un
 * cambio de institución es un cambio de token, y todo lo que la SPA tenga
 * cacheado de antes —stores de Pinia, listas ya pedidas— sobrevive a ese cambio
 * si alguien no lo limpia. Ninguna prueba unitaria lo cubre: cada una monta un
 * solo tenant.
 *
 * Los dos ítems llevan **el mismo sufijo** a propósito: una sola búsqueda tiene
 * que devolver uno y solo uno en cada institución. Con nombres distintos, "no
 * aparece el de la otra" podría ser simplemente que la búsqueda no lo matcheó.
 *
 * ⚠️ Sin `storageState`: este es el único flujo que necesita hacer el login y la
 * elección de institución a mano, porque son justamente el objeto de la prueba.
 */
test.use({ storageState: { cookies: [], origins: [] } })

const marca = Date.now()
const NOMBRES = {
  restaurante: `Solo Restaurante ${marca}`,
  bodega: `Solo Bodega ${marca}`,
}

test.beforeAll(async ({ request }) => {
  for (const [clave, tenantId] of Object.entries(TENANTS)) {
    const token = await tokenDe(request, tenantId)
    await crearProducto(request, token, {
      nombre: NOMBRES[clave as keyof typeof NOMBRES],
      precioBase: '1000',
    })
    // Control de que el fixture existe donde tiene que existir: si el alta
    // fallara en silencio, "no lo veo en la otra institución" sería trivial.
    const propio = await api<{ data: { nombre: string }[] }>(
      request,
      'get',
      `/items?search=${marca}&pageSize=100`,
      { token },
    )
    expect(propio.data.map((i) => i.nombre)).toEqual([
      NOMBRES[clave as keyof typeof NOMBRES],
    ])
  }
})

async function buscarEnCatalogo(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.goto('/configuracion/items')
  await page
    .getByPlaceholder('Buscar por nombre o descripción...')
    .fill(String(marca))
}

test('cambiar de institución no arrastra el catálogo de la anterior', async ({
  page,
}) => {
  // networkidle: esperar la hidratación de Nuxt antes de tipear, si no el
  // v-model no captura y el submit queda deshabilitado (mismo motivo que
  // `auth.setup.ts`).
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.getByPlaceholder('tu@email.com').fill(CREDENCIALES.email)
  await page.locator('input[type="password"]').first().fill(CREDENCIALES.password)
  await page.locator('button[type="submit"]').first().click()

  await page.waitForURL('**/select-tenant')
  await page.getByRole('button', { name: 'Demo Restaurante' }).click()
  await page.waitForURL((url) => url.pathname === '/')

  await buscarEnCatalogo(page)
  await expect(page.getByText(NOMBRES.restaurante)).toBeVisible()
  await expect(page.getByText(NOMBRES.bodega)).toHaveCount(0)

  // Cambio de institución por donde lo hace un usuario: el menú de la cuenta.
  await page.getByRole('button', { name: /Admin Sistema/ }).click()
  await page.getByRole('menuitem', { name: 'Cambiar Institución' }).click()
  await page.waitForURL('**/select-tenant')
  await page.getByRole('button', { name: 'Demo Bodega' }).click()
  await page.waitForURL((url) => url.pathname === '/')

  // Y el catálogo se dio vuelta entero: ni una fila de la institución anterior.
  await buscarEnCatalogo(page)
  await expect(page.getByText(NOMBRES.bodega)).toBeVisible()
  await expect(page.getByText(NOMBRES.restaurante)).toHaveCount(0)
})
