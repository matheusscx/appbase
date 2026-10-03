import type { Locator, Page } from '@playwright/test'
import { test, expect } from '@playwright/test'
import {
  api,
  CLP,
  crearProducto,
  limpiarItems,
  tokenDe,
  TENANTS,
} from '../support/api'

/**
 * El selector de ítems busca en el servidor: el producto 101 se elige buscándolo,
 * se guarda como componente de un combo y vuelve a verse con su nombre al reabrir
 * — Tarea 15 de `docs/superpowers/plans/2026-10-03-catalogo-paginado.md`, spec § 5.
 *
 * Hasta el 2026-10-03 los selectores de la configuración se llenaban con
 * `GET /items?pageSize=100` y filtraban en el cliente: el ítem 101 no existía para
 * la pantalla. `AppItemSelect` busca en el servidor (300 ms tras la última tecla) y
 * resuelve el nombre de lo ya elegido con `GET /items?ids=…`. Lo que ningún unit
 * ve es la cadena entera contra el backend real: buscar → elegir → guardar → que
 * el servidor lo tenga → reabrir con el nombre puesto (y no un id, ni vacío).
 *
 * ⚠️ **Corre como el admin del seed.** `POST /items` y `PATCH /items/:id` piden
 * `Items:Crear`/`Items:Actualizar` (`@RequiresPermiso`), pero ningún rol del seed
 * los tiene sin ser admin (el `Vendedor` solo trae `Items:Leer`).
 *
 * ⚠️ **Los 101 productos son de esta corrida**, con una marca única en el nombre y
 * ceros a la izquierda (`001`…`101`): buscar `<marca> 101` no atrapa a ningún otro.
 * El combo y los productos se dan de baja en `afterAll` aunque el test falle (el
 * combo primero: los productos son sus componentes).
 */

const CANTIDAD = 101
const marca = String(Date.now())
const NOMBRE_COMBO = `ComboSel ${marca}`

const corrida: {
  token?: string
  productos: { id: string, nombre: string }[]
  comboId?: string
} = { productos: [] }

const nombreDe = (n: number) => `SelItems ${marca} ${String(n).padStart(3, '0')}`
const primero = () => corrida.productos[0]!
const el101 = () => corrida.productos[CANTIDAD - 1]!
/** Cómo rotula `items.vue` a un componente vendible: `etiquetaVendible`. */
const rotulo = (p: { nombre: string }) => `${p.nombre} (producto)`

test.beforeAll(async ({ request }) => {
  test.setTimeout(240_000)
  corrida.productos = []
  corrida.token = await tokenDe(request, TENANTS.restaurante)
  const token = corrida.token
  const nombres = Array.from({ length: CANTIDAD }, (_, i) => nombreDe(i + 1))
  for (let i = 0; i < nombres.length; i += 10) {
    const creados = await Promise.allSettled(
      nombres.slice(i, i + 10).map(async nombre => ({
        id: (await crearProducto(request, token, { nombre, precioBase: '1000' })).id,
        nombre,
      })),
    )
    // Se anotan a medida que existen: si una tanda muere a mitad, el `afterAll`
    // tiene que poder dar de baja las que sí se crearon.
    for (const r of creados) {
      if (r.status === 'fulfilled') corrida.productos.push(r.value)
    }
    const fallo = creados.find(r => r.status === 'rejected')
    if (fallo && fallo.status === 'rejected') throw fallo.reason
  }
  // El combo arranca con el 001 como único componente: el test le suma el 101.
  const combo = await api<{ id: string }>(request, 'post', '/items', {
    token,
    data: {
      nombre: NOMBRE_COMBO,
      precioBase: '4000',
      monedaId: CLP,
      tipo: 'combo',
      componentes: [{ componenteItemId: primero().id, cantidad: '1', bloqueante: true }],
    },
  })
  corrida.comboId = combo.id
})

test.afterAll(async ({ request }) => {
  test.setTimeout(240_000)
  if (!corrida.token) return
  // El combo antes que sus componentes.
  await limpiarItems(request, corrida.token, [
    ...(corrida.comboId ? [corrida.comboId] : []),
    ...corrida.productos.map(p => p.id),
  ])
})

/** El `UFormField` cuyo rótulo es `etiqueta` (mismo criterio que `items-moneda.spec.ts`). */
function campo(drawer: Locator, etiqueta: RegExp): Locator {
  return drawer
    .locator('[data-slot="root"][data-orientation="vertical"]')
    .filter({ has: drawer.page().locator('label').filter({ hasText: etiqueta }) })
}

/** Deja el listado filtrado al combo de la corrida y devuelve su lápiz. */
async function lapizDelCombo(page: Page): Promise<Locator> {
  await page.goto('/configuracion/items')
  await page.getByPlaceholder('Buscar por nombre o descripción...').fill(marca)
  const fila = page.locator('tr').filter({ hasText: NOMBRE_COMBO })
  await expect(fila).toHaveCount(1)
  return fila.getByTitle('Editar')
}

/** Abre el combo en el drawer; el selector de componentes ya resolvió sus nombres. */
async function abrirCombo(page: Page): Promise<Locator> {
  const editar = await lapizDelCombo(page)
  await editar.click()
  const drawer = page.getByRole('dialog')
  await expect(drawer).toBeVisible()
  return drawer
}

const triggerDe = (drawer: Locator, idx: number) =>
  campo(drawer, /^Item$/).nth(idx).getByRole('button', { name: 'Show popup' })

test('el producto 101 se elige buscándolo, se guarda en el combo y reabre con su nombre', async ({ page, request }) => {
  test.setTimeout(120_000)
  const producto = el101()

  // ── Abrir el combo: el 001 (el que ya tenía) se ve con su nombre ────────────
  let drawer = await abrirCombo(page)
  await expect(campo(drawer, /^Item$/)).toHaveCount(1)
  await expect(triggerDe(drawer, 0)).toContainText(rotulo(primero()))

  // ── Sumar un componente y buscar el 101 en el servidor ──────────────────────
  await drawer.getByRole('button', { name: 'Agregar componente' }).click()
  await expect(campo(drawer, /^Item$/)).toHaveCount(2)
  await triggerDe(drawer, 1).click()

  const termino = `${marca} 101`
  const busqueda = page.waitForResponse(
    r => r.request().method() === 'GET'
      && r.url().includes('/items?')
      && new URL(r.url()).searchParams.get('search') === termino,
  )
  await page.keyboard.type(termino)
  const respuesta = await busqueda
  expect(respuesta.status()).toBe(200)
  // Lo pide con página de 20 (el selector), no con el tope de 100 de antes.
  expect(new URL(respuesta.url()).searchParams.get('pageSize')).toBe('20')

  // Sin esperar de más: la opción llega con la respuesta. Y es la única (el 101).
  const opcion = page.getByRole('option', { name: rotulo(producto), exact: true })
  await expect(opcion).toBeVisible()
  await expect(page.getByRole('option')).toHaveCount(1)
  await opcion.click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(triggerDe(drawer, 1)).toContainText(rotulo(producto))

  // ── Guardar ─────────────────────────────────────────────────────────────────
  const guardado = page.waitForResponse(
    r => r.request().method() === 'PATCH' && r.url().endsWith(`/items/${corrida.comboId}`),
  )
  await drawer.getByRole('button', { name: 'Guardar cambios' }).click()
  expect((await guardado).status()).toBe(200)
  await expect(drawer).toBeHidden()

  // ── El servidor lo tiene: la pantalla no es la prueba ───────────────────────
  const combo = await api<{ componentes: { componenteItemId: string }[] }>(
    request,
    'get',
    `/items/${corrida.comboId}`,
    { token: corrida.token },
  )
  expect(combo.componentes.map(c => c.componenteItemId).sort())
    .toEqual([primero().id, producto.id].sort())

  // ── Reabrir desde cero: recarga, así el nombre sale de `?ids=…` y no del caché ─
  const pedidoDeNombres = page.waitForResponse(
    r => r.request().method() === 'GET'
      && r.url().includes('/items?')
      && (new URL(r.url()).searchParams.get('ids') ?? '').includes(producto.id),
  )
  drawer = await abrirCombo(page)
  expect((await pedidoDeNombres).status()).toBe(200)

  await expect(campo(drawer, /^Item$/)).toHaveCount(2)
  // El nombre, no un id ni un trigger vacío.
  const triggers = [triggerDe(drawer, 0), triggerDe(drawer, 1)]
  const textos = await Promise.all(triggers.map(t => t.innerText()))
  expect(textos.map(t => t.trim()).sort())
    .toEqual([rotulo(primero()), rotulo(producto)].sort())
  for (const t of textos) expect(t).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
})
