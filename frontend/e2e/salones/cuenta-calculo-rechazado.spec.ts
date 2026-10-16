import { test, expect } from '../support/sin-qz-tray'
import { API, api, tokenDe, limpiarItems, TENANTS, CLP } from '../support/api'
import { elegirEnSelector, entrarComo, rondaDePin, valorDelTotal } from '../support/ui'

/**
 * Cuando el servidor no puede calcular la cuenta, la pantalla dice por qué
 * arriba de las líneas y no muestra un total que ya no es el de la cuenta
 * (owner, 2026-10-11). Hasta esa fecha cada línea dibujaba `—` sin explicación.
 *
 * El 400 es real, del motor: un producto de $73.456.789.012.345 cabe de a uno y
 * no de a dos (el techo es $100.000.000.000.000, el mismo caso que
 * `motor-monto-no-cabe.e2e-spec.ts` del backend). La línea que falló no se
 * marca: el 400 trae solo el mensaje, sin decir qué línea es.
 *
 * Molde: `anular-plato.spec.ts`. Las precondiciones van por API y el flujo por
 * UI. **Corre como `encargado.salon@paris.cl`**, no como admin, con un garzón
 * propio: la sesión es única por garzón, y la de Ana la comparten otros specs.
 *
 * El salón y la mesa quedan, igual que en el molde: viven en su propia lista,
 * filtrada por nombre exacto.
 */

test.use({ storageState: { cookies: [], origins: [] } })

const ENCARGADO = { email: 'encargado.salon@paris.cl', password: 'admin' }

/** Cabe de a uno; de a dos da 146.913.578.024.690, sobre el techo. */
const PRECIO_AL_TOPE = '73456789012345'

const escenario: {
  token?: string
  garzon?: { id: string, pin: string, nombre: string }
  salonNombre?: string
  mesaId?: string
  productoNombre?: string
  bebidaNombre?: string
  itemIds: string[]
} = { itemIds: [] }

test.beforeAll(async ({ request }) => {
  const token = await tokenDe(request, TENANTS.restaurante)
  escenario.token = token
  const marca = Date.now()

  const nombreGarzon = `Garzón cálculo E2E ${marca}`
  const garzon = await api<{ id: string, pin: string }>(request, 'post', '/garzones', {
    token,
    data: { nombre: nombreGarzon },
  })
  escenario.garzon = { ...garzon, nombre: nombreGarzon }

  const turnos = await api<{ id: string, activo: boolean }[]>(request, 'get', '/turnos', { token })
  const turnoId = turnos.find(t => t.activo)?.id
  if (!turnoId) throw new Error('El seed no tiene ningún turno activo')
  await api(request, 'post', '/sesiones-garzon/iniciar', {
    token,
    data: { garzonId: garzon.id, pin: garzon.pin, turnoId },
  })

  escenario.salonNombre = `Salón cálculo E2E ${marca}`
  const salon = await api<{ id: string }>(request, 'post', '/salones', {
    token,
    data: { nombre: escenario.salonNombre },
  })
  const mesa = await api<{ id: string }>(request, 'post', `/salones/${salon.id}/mesas`, {
    token,
    data: { nombre: `Mesa ${marca}`, posX: 0.5, posY: 0.5 },
  })
  escenario.mesaId = mesa.id

  // Exentos: con IVA el primer monto que no cabe sería otro y el mensaje
  // dependería de la tasa del país.
  escenario.productoNombre = `Producto al tope E2E ${marca}`
  const producto = await api<{ id: string }>(request, 'post', '/items', {
    token,
    data: {
      nombre: escenario.productoNombre,
      tipo: 'producto',
      clasificacionTributaria: 'exento',
      precioBase: PRECIO_AL_TOPE,
      monedaId: CLP,
      unidadMedida: 'unidad',
      stock: '10',
      costo: '100',
    },
  })
  escenario.itemIds.push(producto.id)

  // Producto y no servicio: el catálogo del salón ofrece solo productos,
  // recetas y combos.
  escenario.bebidaNombre = `Bebida cálculo E2E ${marca}`
  const bebida = await api<{ id: string }>(request, 'post', '/items', {
    token,
    data: {
      nombre: escenario.bebidaNombre,
      tipo: 'producto',
      clasificacionTributaria: 'exento',
      precioBase: '1490',
      monedaId: CLP,
      unidadMedida: 'unidad',
      stock: '10',
      costo: '100',
    },
  })
  escenario.itemIds.push(bebida.id)
})

test.afterAll(async ({ request }) => {
  const { token, garzon, mesaId, itemIds } = escenario
  if (!token) return
  const auth = { Authorization: `Bearer ${token}` }

  // La cuenta queda abierta y sin nada despachado: se cancela sin motivo. Va
  // antes de dar de baja los ítems, que se rechaza mientras estén pedidos.
  if (mesaId) {
    const cuentas = await request.get(`${API}/mesas/${mesaId}/cuentas`, { headers: auth })
    for (const c of cuentas.ok() ? (await cuentas.json()) as { id: string }[] : []) {
      const res = await request.post(`${API}/cuentas/${c.id}/cancelar`, { headers: auth, data: {} })
      if (!res.ok()) {
        console.warn(`[e2e] no se pudo cancelar la cuenta ${c.id}: ${res.status()} ${await res.text()}`)
      }
    }
  }

  if (itemIds.length) await limpiarItems(request, token, itemIds)

  if (garzon) {
    const res = await request.post(`${API}/sesiones-garzon/cerrar`, {
      headers: auth,
      data: { garzonId: garzon.id, pin: garzon.pin },
    })
    if (!res.ok()) {
      console.warn(`[e2e] no se pudo cerrar la sesión del garzón ${garzon.id}: ${res.status()} ${await res.text()}`)
    }
  }
})

test('la cuenta que el servidor no puede calcular dice por qué arriba de las líneas', async ({ page }) => {
  await entrarComo(page, ENCARGADO.email, ENCARGADO.password)
  await page.goto('/salones')
  await elegirEnSelector(page, escenario.salonNombre!)
  await page.locator(`[data-qa="mesa-${escenario.mesaId}"]`).click()
  await page.getByRole('button', { name: 'Nueva cuenta' }).click()
  await rondaDePin(page, escenario.garzon!)

  const aviso = page.locator('[data-qa="aviso-calculo-cuenta"]')

  // 1. Lo que cabe se calcula: sin aviso, y el total es el de la cuenta.
  await page.getByText(escenario.bebidaNombre!, { exact: true }).click()
  // La card del catálogo (`span`), no la línea de la cuenta (`p`): después del
  // primer clic el nombre está en las dos y el segundo clic sería ambiguo.
  const producto = page.getByText(escenario.productoNombre!, { exact: true }).and(page.locator('span'))
  await producto.click()
  await expect(valorDelTotal(page)).toHaveText('$73.456.789.013.835')
  await expect(aviso).toHaveCount(0)

  // 2. La segunda unidad no cabe. El motor dice por qué, y eso se lee arriba
  //    de las líneas. El total no queda en el de una unidad.
  await producto.click()
  await expect(aviso).toBeVisible()
  await expect(aviso).toContainText('No se pudo calcular la cuenta')
  await expect(aviso).toContainText(
    `«${escenario.productoNombre}» da $146.913.578.024.690, y el sistema no puede guardar montos de $100.000.000.000.000 o más: revisá el precio y la cantidad` // el mensaje sale del motor de precios (backend), todavía en voseo,
  )
  await expect(valorDelTotal(page)).toHaveText('—')

  // 3. Quitar la línea que no cabe: la cuenta se calcula y el aviso se va.
  //    Es la segunda línea, porque la cuenta las ordena por cuándo se pidieron.
  await page.getByTitle('Quitar', { exact: true }).nth(1).click()
  await expect(aviso).toHaveCount(0)
  await expect(valorDelTotal(page)).toHaveText('$1.490')
})
