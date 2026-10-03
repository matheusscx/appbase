import { test, expect } from '../support/sin-qz-tray'
import {
  abrirCaja,
  api,
  cerrarCaja,
  CLP,
  limpiarItems,
  tokenDe,
  TENANTS,
} from '../support/api'
import { entrarComo } from '../support/ui'

/**
 * El cajero elige qué unidad con número de serie sale, en el POS y en un
 * navegador de verdad
 * (`docs/features/inventario-serializado.md`, § «Quién elige qué unidad con serie sale»).
 *
 * La escena es la que originó el frente: un celular `nuevo` y otro `usado` del
 * mismo producto. Antes el servidor elegía solo (FIFO) y salía el nuevo aunque el
 * cliente se llevara el usado. Acá se vende el USADO y tiene que ser el usado lo
 * que quede en la venta.
 *
 * ⚠️ **Corre como `vendedor@paris.cl`** (rol `Vendedor`: `Ventas:Crear/Leer` e
 * `Items:Leer`), no como admin: es el rol real de quien usa el POS, y con admin un
 * permiso que falte en `GET /items/:id/unidades` —lo que el selector llama— no se
 * vería. Login por pantalla, molde de `reimprimir-boleta-cajera.spec.ts`.
 *
 * ⚠️ **Las precondiciones se montan por API**: el producto serie con sus dos
 * unidades en el local (`PATCH /items/:id/stock`, entrada con `series`) y la caja
 * física de la cajera. El producto es propio: el stock del seed es acumulativo
 * entre corridas y no se repara solo.
 *
 * ⚠️ **La verificación final no es de cliente.** El drawer lee `GET /ventas/:id`,
 * que arma `unidades` desde el movimiento de inventario de la venta
 * (`movimiento_inventario_detalle` → `item_unidad`): lo que muestra salió del
 * servidor, no del carrito.
 */

const PRECIO_BASE = '10000'
/** Lo que la caja espera en efectivo: 10.000 + 19% = 11.900, más la propina sugerida del 10% (1.190). */
const EFECTIVO_ESPERADO = '13090'
const VENDEDOR = { email: 'vendedor@paris.cl', password: 'admin' }

test.use({ storageState: { cookies: [], origins: [] } })

let escenario: {
  tokenAdmin?: string
  tokenVendedor?: string
  cajaId?: string
  itemId?: string
} = {}

test.beforeEach(async ({ request }) => {
  escenario = {}
  // `Vendedor` no tiene `Items:Crear` ni `Eliminar`: sembrar y limpiar el producto
  // es del admin. Lo que corre como la cajera es su caja y su venta.
  escenario.tokenAdmin = await tokenDe(request, TENANTS.restaurante)
  escenario.tokenVendedor = await tokenDe(request, TENANTS.restaurante, VENDEDOR)
  escenario.cajaId = await abrirCaja(request, escenario.tokenVendedor)
})

test.afterEach(async ({ request }) => {
  const { tokenAdmin, tokenVendedor, cajaId, itemId } = escenario
  // Red de seguridad del camino de FALLO: un cajón ocupado deja la corrida
  // siguiente sin poder abrir. Si el test ya cerró la caja, esto es un no-op.
  if (tokenVendedor && cajaId) await cerrarCaja(request, tokenVendedor, cajaId, '0')
  if (tokenAdmin && itemId) await limpiarItems(request, tokenAdmin, [itemId])
})

test('el cajero elige la unidad usada: queda en el carrito y la venta sale con esa serie', async ({
  page,
  request,
}) => {
  const token = escenario.tokenAdmin!
  const marca = Date.now()
  const nombre = `Celular POS serie E2E ${marca}`
  const serieNueva = `IMEI-NUEVO-${marca}`
  const serieUsada = `IMEI-USADO-${marca}`

  // 1. Producto serie propio, con una unidad nueva y otra usada en el local.
  const item = await api<{ id: string }>(request, 'post', '/items', {
    token,
    data: {
      nombre,
      tipo: 'producto',
      precioBase: PRECIO_BASE,
      monedaId: CLP,
      unidadMedida: 'unidad',
      modoInventario: 'serie',
    },
  })
  escenario.itemId = item.id

  const ubicaciones = await api<{ id: string, tipo: string }[]>(
    request, 'get', '/ubicaciones', { token },
  )
  const local = ubicaciones.find(u => u.tipo === 'local')!
  // Dos entradas separadas, la NUEVA primero: cada una tiene su propio `creado_el`.
  // En una sola entrada con las dos series el `creado_el` es idéntico (el default es
  // el inicio de la transacción) y el FIFO de antes (`creado_el ASC`) quedaba en un
  // empate: con la nueva más antigua, FIFO sacaría la nueva y vender la USADA solo
  // pasa si la elección del cajero manda.
  for (const [serie, condicion] of [
    [serieNueva, 'nuevo'],
    [serieUsada, 'usado'],
  ] as const) {
    await api(request, 'patch', `/items/${item.id}/stock`, {
      token,
      data: {
        tipo: 'entrada',
        motivo: 'inventario_inicial',
        ubicacionId: local.id,
        cantidad: '1',
        series: [{ serie, condicion }],
      },
    })
  }

  await entrarComo(page, VENDEDOR.email, VENDEDOR.password)
  await page.goto('/ventas/pos')

  // 2. Tocar el producto abre el selector, no lo agrega al carrito.
  await page.locator(`[data-qa="item-catalogo-${item.id}"]`).click()
  const selector = page.getByRole('dialog').filter({ hasText: 'Elegir unidades' })
  await expect(selector).toBeVisible()

  // 3. Lista las dos con su condición. Las filas se ubican por el hook de test
  //    del componente, anclado a la serie.
  const filaNueva = selector.locator(`[data-qa="unidad-fila"][data-serie="${serieNueva}"]`)
  const filaUsada = selector.locator(`[data-qa="unidad-fila"][data-serie="${serieUsada}"]`)
  await expect(filaNueva).toContainText('Nuevo')
  await expect(filaUsada).toContainText('Usado')

  // 4. Elegir la USADA. Hasta marcarla no hay nada que confirmar.
  await expect(selector.getByRole('button', { name: 'Confirmar (0)' })).toBeDisabled()
  await filaUsada.getByRole('checkbox').click()
  await selector.getByRole('button', { name: 'Confirmar (1)' }).click()
  await expect(selector).toBeHidden()

  // 5. El carrito muestra la serie elegida —y solo esa— y deja reabrir el selector.
  const series = page.locator('[data-qa="series-linea"]')
  await expect(series).toContainText(serieUsada)
  await expect(series).not.toContainText(serieNueva)
  await expect(page.getByRole('button', { name: 'Cambiar unidades' })).toBeVisible()

  // 6. Cobrar. El id de la venta se toma de la respuesta del POST, no de "la
  //    última del listado": con otra corrida en el medio verificaría la de otro.
  await page.getByRole('button', { name: 'Cobrar', exact: true }).click()
  const cobro = page.getByRole('dialog').filter({ hasText: 'Cobrar venta' })
  const respuesta = page.waitForResponse(
    r => r.url().endsWith('/ventas') && r.request().method() === 'POST',
  )
  await cobro.getByRole('button', { name: 'Confirmar venta' }).click()
  const crear = await respuesta
  expect(crear.status()).toBe(201)
  const ventaId = ((await crear.json()) as { id: string }).id

  // 7. Plazo propio: entre el aviso y el carrito vacío se intenta imprimir la
  //    boleta, y esa espera sola agota los 5 s por defecto.
  await expect(page.getByText('Venta pagada').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Agregá ítems desde el catálogo.')).toBeVisible({
    timeout: 15_000,
  })

  // 8. Lo que quedó del lado del servidor: el detalle de la venta dice cuál unidad
  //    salió. Por la propia ruta que usa la app para abrir el drawer.
  await page.goto(`/ventas?venta=${ventaId}`)
  const detalle = page.getByRole('dialog').filter({ hasText: 'Detalle de venta' })
  await expect(detalle).toContainText(`Serie ${serieUsada}`)
  await expect(detalle).toContainText(/Serie IMEI-USADO-\d+\s*·\s*Usado/)
  await expect(detalle).not.toContainText(serieNueva)
  // 9. Y la caja de la cajera espera exactamente lo cobrado: `cerrada` solo sale si
  //    el conteo cuadra con lo que el servidor calculó, venta + propina. Se cierra
  //    con el monto real (y no con 0) para no dejar un cierre con diferencia.
  expect(await cerrarCaja(request, escenario.tokenVendedor!, escenario.cajaId!, EFECTIVO_ESPERADO))
    .toBe('cerrada')
  escenario.cajaId = undefined // Ya cerrada: que el `afterEach` no repita el conteo.
})
