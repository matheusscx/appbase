import { test, expect, type Locator } from '@playwright/test'
import { API, api, crearProducto, limpiarItems, tokenDe, TENANTS } from '../support/api'

/**
 * El tipo de un motivo de baja, en la pantalla.
 *
 * **Por qué vive acá y no en el unit.** `app/pages/configuracion/motivos-baja.nuxt.spec.ts`
 * fija los gestos contra un mock de `useApiFetch` que contesta 200 a cualquier cosa. Tres
 * propiedades no las puede aseverar, y las tres son el motivo del frente:
 *
 * 1. Que crear un motivo **pase el DTO real**: `tipo` es obligatorio desde `b5de5227`, y
 *    hasta `40d18937` la pantalla no lo mandaba, así que "Nuevo motivo" devolvía 400 contra
 *    el backend de verdad (una hora del 2026-09-15, entre esos dos commits).
 * 2. Que el campo Tipo se deshabilite por `enUso`, que **lo calcula el backend** con un
 *    `EXISTS` sobre `movimientos_inventario`; el unit lo alimenta con un fixture.
 * 3. Que el selector de Mermas pida `tipo=merma` **al servidor**, y por eso no ofrezca los
 *    motivos que no son merma.
 *
 * ⚠️ **Deja UN residuo irreversible por corrida: el motivo "usado".** Un motivo con un
 * movimiento no se borra (`MotivosBajaService.remove` → 400, que es la regla, y la afirma
 * `backend/test/mermas.e2e-spec.ts`), y el movimiento no se borra nunca: se limpia solo con
 * `./scripts/reset-db.sh`. Los otros dos motivos que siembra este archivo —el de cortesía por
 * API y el que crea la pantalla— no tienen movimientos, así que el `afterAll` los borra. El
 * producto sembrado también se da de baja. En CI la base nace de cero.
 */

const marca = Date.now()
/** Sin la palabra del tipo que se elige adentro: si estuviera, la aserción de la fila la
 *  satisfaría el nombre y el test pasaría igual mandando el tipo por defecto. */
const NUEVO = `Regalo E2E ${marca}`
const USADO = `Usado E2E ${marca}`
const CORTESIA_API = `Cortesia API E2E ${marca}`

let token = ''
let itemId = ''

/**
 * El `UFormField` cuya etiqueta es `etiqueta`, con su control adentro. Mismo gesto que
 * `items-moneda.spec.ts`: el trigger del `USelectMenu` lleva `aria-label="Show popup"`, que
 * gana sobre el `<label for>`, así que no sirve `getByLabel`.
 *
 * ⚠️ El `has` va armado desde la PÁGINA (`raiz.page()`), no desde `raiz`: Playwright lo
 * interpreta relativo al de afuera, así que uno ya acotado queda acotado dos veces y no
 * matchea nada. Medido en el original: 0 contra 1.
 */
function campo(raiz: Locator, etiqueta: RegExp): Locator {
  return raiz
    .locator('[data-slot="root"][data-orientation="vertical"]')
    .filter({ has: raiz.page().locator('label').filter({ hasText: etiqueta }) })
}

test.beforeAll(async ({ request }) => {
  token = await tokenDe(request, TENANTS.restaurante)

  // El motivo del caso 3 nace por API y se "usa" con una merma real: `enUso` sale de los
  // movimientos, así que sin la merma la pantalla lo mostraría editable.
  const usado = await api<{ id: string }>(request, 'post', '/motivos-baja', {
    token,
    data: { nombre: USADO, tipo: 'merma' },
  })

  // Uno de tipo cortesía propio de esta corrida: el caso 4 comprueba el filtro sobre una fila
  // que este archivo creó, y no solo sobre los fijos del seed.
  await api(request, 'post', '/motivos-baja', {
    token,
    data: { nombre: CORTESIA_API, tipo: 'cortesia' },
  })

  const item = await crearProducto(request, token, {
    nombre: `Insumo motivos ${marca}`,
    precioBase: '1000',
  })
  itemId = item.id

  const ubicaciones = await api<{ id: string, tipo: string }[]>(
    request,
    'get',
    '/ubicaciones',
    { token },
  )
  const local = ubicaciones.find(u => u.tipo === 'local')!
  await api(request, 'post', '/mermas', {
    token,
    data: { itemId, ubicacionId: local.id, cantidad: '1', motivoBajaId: usado.id },
  })
})

test.afterAll(async ({ request }) => {
  await limpiarItems(request, token, [itemId])

  // Los dos motivos sin movimientos se borran por API; el "usado" no puede (400 por su merma).
  // `api()` solo expone get/post/patch, así que el DELETE va crudo, igual que `limpiarItems`.
  const motivos = await api<{ id: string, nombre: string }[]>(request, 'get', '/motivos-baja', { token })
  for (const nombre of [NUEVO, CORTESIA_API]) {
    const fila = motivos.find(m => m.nombre === nombre)
    if (!fila) continue
    const res = await request.delete(`${API}/motivos-baja/${fila.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    // Mismo criterio que `limpiarItems`: no asevera —un fallo de limpieza no debe tapar el
    // del test, ni cortar el borrado del que sigue— pero tampoco calla.
    if (!res.ok()) {
      console.warn(`limpieza de ${fila.nombre} → ${res.status()}: ${await res.text()}`)
    }
  }
})

test('el catálogo pinta el tipo de cada motivo', async ({ page }) => {
  await page.goto('/configuracion/motivos-baja')

  await expect(page.getByRole('columnheader', { name: 'Tipo' })).toBeVisible()

  // "Merma" NO está en "Vencimiento": si se cayera el pintado del tipo, esta aserción muere.
  // (Con "Cortesía de la casa" o "No se llegó a hacer" no serviría: su etiqueta de tipo está
  // contenida en su propio nombre, así que la fila la satisface sin pintar nada.)
  //
  // ⚠️ Anclado a la fila del FIJO (`^Vencimiento Fija`): una base local con corridas viejas
  // encima tiene motivos custom con "Vencimiento" adentro del nombre —`papelera.e2e-spec.ts`
  // crea uno y lo deja vivo—, y un `/Vencimiento/` suelto matchea dos filas y explota por
  // strict mode. Medido acá. El ancla depende del badge "Fija" del `#nombre-cell`: si ese
  // texto cambia, esto falla con "resolved to 0 elements", que es ruidoso pero despista.
  await expect(page.getByRole('row', { name: /^Vencimiento Fija/ })).toContainText('Merma')

  // Y que los dos fijos del frente existan, que es cosa del seed, no del pintado.
  await expect(page.getByRole('row', { name: /Cortesía de la casa/ })).toBeVisible()
  await expect(page.getByRole('row', { name: /No se llegó a hacer/ })).toBeVisible()
})

test('crear un motivo eligiendo su tipo lo guarda (el DTO exige tipo)', async ({ page }) => {
  await page.goto('/configuracion/motivos-baja')
  await page.getByRole('button', { name: 'Nuevo motivo' }).click()

  const drawer = page.getByRole('dialog')
  await drawer.getByPlaceholder(/Rotura/).fill(NUEVO)
  // Un tipo DISTINTO del default del formulario (`merma`), y el nombre del motivo no lleva
  // esa palabra: si la pantalla mandara siempre el default, la fila diría "Merma" y la
  // aserción de abajo fallaría.
  await drawer.getByRole('combobox', { name: /Tipo/ }).click()
  await page.getByRole('option', { name: 'Cortesía', exact: true }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await drawer.getByRole('button', { name: /Crear|Guardar/ }).click()

  // Sin `tipo` en el body esto era un 400 y la fila nunca aparecía.
  await expect(page.getByRole('row', { name: new RegExp(NUEVO) })).toContainText('Cortesía')
})

test('el tipo de un motivo ya usado no se puede cambiar, y la pantalla dice por qué', async ({ page }) => {
  await page.goto('/configuracion/motivos-baja')

  await page.getByRole('row', { name: new RegExp(USADO) }).getByTitle('Editar').click()

  const drawer = page.getByRole('dialog')
  await expect(drawer.getByRole('combobox', { name: /Tipo/ })).toBeDisabled()
  await expect(drawer).toContainText(/ya se usó/i)
})

test('el selector de Mermas no ofrece los motivos que no son merma', async ({ page }) => {
  await page.goto('/mermas')
  await page.getByRole('button', { name: /Registrar merma/i }).click()

  const drawer = page.getByRole('dialog')
  // Por etiqueta y no por posición: si la pantalla suma un campo debajo, un `.last()` abriría
  // otro popup y las dos aserciones de ausencia pasarían vacías.
  await campo(drawer, /^Motivo$/).getByRole('button', { name: 'Show popup' }).click()

  // El backend filtra por `tipo=merma`: ni los fijos que no son merma ni el que creó este
  // archivo por API llegan a la lista.
  await expect(page.getByRole('option', { name: 'Vencimiento', exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: CORTESIA_API, exact: true })).toHaveCount(0)
  await expect(page.getByRole('option', { name: 'Cortesía de la casa', exact: true })).toHaveCount(0)
  await expect(page.getByRole('option', { name: 'No se llegó a hacer', exact: true })).toHaveCount(0)
})
