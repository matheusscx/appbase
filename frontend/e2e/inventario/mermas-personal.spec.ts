import { test, expect, type Locator } from '@playwright/test'
import { api, crearProducto, limpiarItems, tokenDe, TENANTS } from '../support/api'

/**
 * La comida del personal en la pantalla de Mermas (spec
 * `2026-10-04-comida-del-personal-design.md` § 3.3; owner, "Mesa y Mermas").
 *
 * **Por qué vive acá y no solo en el unit.** `app/pages/mermas.nuxt.spec.ts` fija que la
 * pantalla PIDE `?tipo=consumo_personal`, contra un mock que contesta lo que sea. Lo que
 * solo el backend real puede decir es que con ese pedido la fila de personal aparece, y que
 * sin él —la vista de Mermas— no aparece: es lo que separa el gasto del personal de la
 * pérdida. Y que el selector de la vista de personal reciba del servidor el motivo fijo
 * sembrado y no los de merma.
 *
 * ⚠️ **Deja UN residuo irreversible por corrida: el movimiento de personal** (el kardex no
 * se borra; se limpia con `./scripts/reset-db.sh`). El producto se da de baja en el
 * `afterAll`, y la fila sigue listada con el badge "Eliminado", que es la regla del listado.
 */

const marca = Date.now()
const PRODUCTO = `Bebida personal E2E ${marca}`
const MOTIVO_PERSONAL = 'Comida del personal (dentro del local)'

let token = ''
let itemId = ''

/** Mismo gesto que `configuracion/motivos-baja.spec.ts` (ver el porqué allá). */
function campo(raiz: Locator, etiqueta: RegExp): Locator {
  return raiz
    .locator('[data-slot="root"][data-orientation="vertical"]')
    .filter({ has: raiz.page().locator('label').filter({ hasText: etiqueta }) })
}

test.beforeAll(async ({ request }) => {
  token = await tokenDe(request, TENANTS.restaurante)

  const item = await crearProducto(request, token, { nombre: PRODUCTO, precioBase: '1500' })
  itemId = item.id

  const [personal] = await api<{ id: string }[]>(
    request,
    'get',
    '/motivos-baja?soloActivas=true&tipo=consumo_personal',
    { token },
  )
  const ubicaciones = await api<{ id: string, tipo: string }[]>(request, 'get', '/ubicaciones', { token })
  const local = ubicaciones.find(u => u.tipo === 'local')!
  await api(request, 'post', '/mermas', {
    token,
    data: { itemId, ubicacionId: local.id, cantidad: '1', motivoBajaId: personal!.id },
  })
})

test.afterAll(async ({ request }) => {
  await limpiarItems(request, token, [itemId])
})

test('la comida del personal se lista en su vista y no entre las mermas', async ({ page }) => {
  await page.goto('/mermas')

  // Vista de Mermas (la de siempre): la fila de personal no es pérdida y no está.
  await expect(page.getByRole('columnheader', { name: 'Costo perdido' })).toBeVisible()
  await expect(page.getByRole('row', { name: new RegExp(PRODUCTO) })).toHaveCount(0)

  await page.getByRole('tab', { name: 'Comida del personal' }).click()

  const fila = page.getByRole('row', { name: new RegExp(PRODUCTO) })
  await expect(fila).toBeVisible()
  await expect(fila).toContainText(MOTIVO_PERSONAL)
  await expect(page.getByRole('columnheader', { name: 'Costo perdido' })).toHaveCount(0)
})

test('el formulario de la vista de personal ofrece su motivo, no los de merma, y avisa qué no entra', async ({ page }) => {
  await page.goto('/mermas')
  await page.getByRole('tab', { name: 'Comida del personal' }).click()
  await page.getByRole('button', { name: 'Registrar comida del personal' }).click()

  const drawer = page.getByRole('dialog')
  await expect(drawer).toContainText('regístralo como cortesía')

  await campo(drawer, /^Motivo$/).getByRole('button', { name: 'Show popup' }).click()
  await expect(page.getByRole('option', { name: MOTIVO_PERSONAL, exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Vencimiento', exact: true })).toHaveCount(0)
})
