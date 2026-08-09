import { test, expect } from '@playwright/test'
import {
  api,
  crearProducto,
  limpiarItems,
  tokenDe,
  TENANTS,
  CREDENCIALES,
} from '../support/api'

/**
 * Cambiar de institución no puede arrastrar el catálogo de la anterior.
 *
 * **Qué cubre exactamente.** Que el recorrido real —login, elección de
 * institución, catálogo, cambio de institución por el menú, catálogo otra vez—
 * termine mostrando solo los ítems del tenant vigente. El riesgo que ataca es de
 * scoping: `tenant_id` sale del token, así que un cambio de institución es un
 * cambio de token, y la única prueba de que la cadena entera lo respeta es
 * recorrerla. Los unit montan un solo tenant y hablan con HTTP mockeado.
 *
 * **Qué NO cubre, y hay que decirlo.** Que los stores de Pinia se reseteen al
 * cambiar de institución: eso lo cubre `app/stores/tenant.spec.ts` ("resetea
 * permisos y los recarga tras el switch exitoso"). Una versión anterior de este
 * archivo lo reclamaba y era falso —la segunda visita al catálogo se hacía con
 * `page.goto()`, que es recarga dura del navegador y borra cualquier estado en
 * memoria antes de aseverar—. Por eso ahora la segunda visita va **por el menú
 * de la app**: sin recarga de por medio, una lista que quedara cacheada de la
 * institución anterior se vería.
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

/** Lo sembrado por tenant, para poder darlo de baja al terminar. */
const sembrado: { token: string; itemId: string }[] = []

test.beforeAll(async ({ request }) => {
  for (const [clave, tenantId] of Object.entries(TENANTS)) {
    const token = await tokenDe(request, tenantId)
    const item = await crearProducto(request, token, {
      nombre: NOMBRES[clave as keyof typeof NOMBRES],
      precioBase: '1000',
    })
    sembrado.push({ token, itemId: item.id })
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

test.afterAll(async ({ request }) => {
  for (const { token, itemId } of sembrado) {
    await limpiarItems(request, token, [itemId])
  }
})

async function buscar(page: import('@playwright/test').Page): Promise<void> {
  await page
    .getByPlaceholder('Buscar por nombre o descripción...')
    .fill(String(marca))
}

/**
 * Al catálogo **por el menú de la app**, sin recargar. Es la diferencia entre
 * probar el cambio de institución y probar un arranque en frío: un `page.goto()`
 * re-bootstrapea Nuxt entero y se lleva puesto cualquier estado que hubiera
 * quedado de la institución anterior, que es justo lo que hay que poder ver.
 */
async function irAlCatalogoPorElMenu(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.getByRole('link', { name: 'Configuración' }).click()
  await page.getByRole('link', { name: 'Items', exact: true }).click()
  await page.waitForURL('**/configuracion/items')
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

  await irAlCatalogoPorElMenu(page)
  await buscar(page)
  await expect(page.getByText(NOMBRES.restaurante)).toBeVisible()
  await expect(page.getByText(NOMBRES.bodega)).toHaveCount(0)

  // Cambio de institución por donde lo hace un usuario: el menú de la cuenta.
  await page.getByRole('button', { name: /Admin Sistema/ }).click()
  await page.getByRole('menuitem', { name: 'Cambiar Institución' }).click()
  await page.waitForURL('**/select-tenant')
  await page.getByRole('button', { name: 'Demo Bodega' }).click()
  await page.waitForURL((url) => url.pathname === '/')

  // Y el catálogo se dio vuelta entero: ni una fila de la institución anterior.
  await irAlCatalogoPorElMenu(page)
  await buscar(page)
  await expect(page.getByText(NOMBRES.bodega)).toBeVisible()
  await expect(page.getByText(NOMBRES.restaurante)).toHaveCount(0)
})
