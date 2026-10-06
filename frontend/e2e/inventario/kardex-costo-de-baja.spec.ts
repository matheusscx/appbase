import { test, expect } from '../support/sesion'
import { api, crearProducto, limpiarItems, tokenDe, TENANTS } from '../support/api'

/**
 * El kardex no llama pérdida a lo que no lo es (spec
 * `2026-10-04-kardex-costo-de-baja-design.md` § 3.2).
 *
 * **Por qué vive acá y no solo en el unit.** `app/pages/inventario/index.nuxt.spec.ts` pinta
 * filas que el mock trae con `motivoBajaTipo` puesto. Lo que solo el backend real puede decir
 * es que `GET /inventario/movimientos` lo trae: la merma y la comida del personal escriben las
 * dos `motivo = 'merma'`, y sin el tipo la pantalla las pintaría igual.
 *
 * El mismo par de bajas fija también el filtro por tipo (spec
 * `2026-10-06-kardex-filtro-por-tipo-de-baja-design.md` § 3.3): que el backend real separe la
 * merma de la comida del personal aunque las dos escriban `motivo = 'merma'`. La cortesía solo
 * entra anulando en mesa; ese caso lo cubre el e2e de API (`mermas.e2e-spec.ts`).
 *
 * ⚠️ **Deja dos residuos irreversibles por corrida: los dos movimientos de baja** (el kardex no
 * se borra; se limpia con `./scripts/reset-db.sh`). El producto se da de baja en el `afterAll`.
 */

const marca = Date.now()
const PRODUCTO = `Bebida kardex-baja E2E ${marca}`
const MOTIVO_PERSONAL = 'Comida del personal (dentro del local)'

let token = ''
let itemId = ''

test.beforeAll(async ({ request }) => {
  token = await tokenDe(request, TENANTS.restaurante)

  // Costo 400 por unidad: la merma de 1 vale $400 y la comida del personal de 2, $800.
  const item = await crearProducto(request, token, { nombre: PRODUCTO, precioBase: '1500', costo: '400' })
  itemId = item.id

  const [personal] = await api<{ id: string }[]>(
    request, 'get', '/motivos-baja?soloActivas=true&tipo=consumo_personal', { token },
  )
  const merma = (await api<{ id: string, nombre: string }[]>(
    request, 'get', '/motivos-baja?soloActivas=true&tipo=merma', { token },
  )).find(m => m.nombre === 'Vencimiento')
  const ubicaciones = await api<{ id: string, tipo: string }[]>(request, 'get', '/ubicaciones', { token })
  const local = ubicaciones.find(u => u.tipo === 'local')!
  await api(request, 'post', '/mermas', {
    token,
    data: { itemId, ubicacionId: local.id, cantidad: '1', motivoBajaId: merma!.id },
  })
  await api(request, 'post', '/mermas', {
    token,
    data: { itemId, ubicacionId: local.id, cantidad: '2', motivoBajaId: personal!.id },
  })
})

test.afterAll(async ({ request }) => {
  await limpiarItems(request, token, [itemId])
})

test('la merma se pinta como pérdida y la comida del personal no, cada una con su tipo', async ({ page }) => {
  await page.goto('/inventario')

  await expect(page.getByRole('columnheader', { name: 'Costo de la baja' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Costo perdido' })).toHaveCount(0)

  const filaMerma = page.getByRole('row', { name: new RegExp(PRODUCTO) })
    .filter({ hasText: 'Merma · Vencimiento' })
  await expect(filaMerma).toBeVisible()
  await expect(filaMerma.getByText('$400', { exact: true })).toHaveClass(/text-error/)

  const filaPersonal = page.getByRole('row', { name: new RegExp(PRODUCTO) })
    .filter({ hasText: `Comida del personal · ${MOTIVO_PERSONAL}` })
  await expect(filaPersonal).toBeVisible()
  await expect(filaPersonal.getByText('$800', { exact: true })).not.toHaveClass(/text-error/)
})

test('el filtro de motivo separa la merma de la comida del personal, y "Bajas (todas)" las trae juntas', async ({ page }) => {
  await page.goto('/inventario')

  const filasDelProducto = page.getByRole('row', { name: new RegExp(PRODUCTO) })
  const merma = filasDelProducto.filter({ hasText: 'Merma · Vencimiento' })
  const personal = filasDelProducto.filter({ hasText: `Comida del personal · ${MOTIVO_PERSONAL}` })
  // El trigger del USelectMenu es un botón que muestra la opción elegida: se lo encuentra por la
  // vigente en cada paso, con el texto entero (el molde de `reportes/varianza.spec.ts`, pero sin
  // armar un RegExp: los paréntesis de "Bajas (todas)" serían un grupo y no matchearían).
  let vigente = 'Todos los motivos'
  async function elegir(opcion: string) {
    await page.getByRole('button').filter({ has: page.getByText(vigente, { exact: true }) }).click()
    await page.getByRole('option', { name: opcion, exact: true }).click()
    vigente = opcion
  }

  await elegir('Comida del personal')
  await expect(personal).toBeVisible()
  await expect(merma).toHaveCount(0)

  await elegir('Merma')
  await expect(merma).toBeVisible()
  await expect(personal).toHaveCount(0)

  await elegir('Bajas (todas)')
  await expect(merma).toBeVisible()
  await expect(personal).toBeVisible()

  // Y de vuelta desde "Bajas (todas)": ejerce el locator con paréntesis en el texto vigente.
  await elegir('Comida del personal')
  await expect(merma).toHaveCount(0)
  await expect(personal).toBeVisible()
})
