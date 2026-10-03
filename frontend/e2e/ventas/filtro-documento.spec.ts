import type { APIRequestContext, Locator, Page } from '@playwright/test'
import Decimal from 'decimal.js'
import { test, expect } from '../support/sin-qz-tray'
import {
  abrirCaja,
  api,
  cerrarCaja,
  crearProducto,
  limpiarItems,
  EFECTIVO,
  tokenDe,
  TENANTS,
} from '../support/api'
import { entrarComo } from '../support/ui'

/**
 * El filtro "Documento" de `/ventas`, en un navegador real (spec
 * `2026-10-01-emision-por-venta`, § 3.7; tarea 12 del plan): elegir un valor en el
 * selector pide `GET /ventas?documento=…` y la lista muestra solo lo que ese valor
 * deja pasar, con el badge de la columna "Documento" de cada fila.
 *
 * **Corre como `vendedor@paris.cl`** (rol `Vendedor`: `Ventas:Leer/Crear`, sin
 * `Ventas:Anular`), no admin: con admin el 403 de un control mal gateado se tapa.
 *
 * **Quién emite lo decide el comercio**: el spec le declara a "Tarjeta de débito"
 * `emisor = 'nadie'` por API como admin (lo cobrado con ella queda "sin documento")
 * y lo **restaura** en el `afterEach`, antes que nada más: el seed lo deja en `sistema` y
 * otras suites leen ese emisor. Las precondiciones se montan por API; por pantalla
 * va solo el filtro.
 *
 * **Acotado a lo propio.** La cajera ve solo las ventas de sus cajas, pero en su
 * listado puede haber otras ventas `nadie` y `sistema` de corridas anteriores, así que mirar "la primera
 * fila" no prueba nada. Cada venta lleva un **total único** (el precio del ítem
 * sale del reloj) y la fila se ubica por ese total; además se afirma sobre los ids
 * que viajan en la respuesta del filtro (su primera página: la cajera solo ve sus ventas, y las
 * recién creadas van arriba).
 *
 * **Nunca vende stock sembrado**: crea sus propios productos.
 */

const DEBITO = '550e8400-e29b-41d4-a716-446655440106'
const VENDEDOR = { email: 'vendedor@paris.cl', password: 'admin' }

test.use({ storageState: { cookies: [], origins: [] } })

interface VentaServidor {
  id: string
  estado: string
  totalFinal: string
}

let escenario: {
  tokenAdmin?: string
  tokenVendedor?: string
  cajaId?: string
  emisorOriginal?: string
  itemIds: string[]
} = { itemIds: [] }

test.beforeEach(async ({ request }) => {
  escenario = { itemIds: [] }
  escenario.tokenAdmin = await tokenDe(request, TENANTS.restaurante)
  escenario.tokenVendedor = await tokenDe(request, TENANTS.restaurante, VENDEDOR)

  // Se guarda lo que había para devolverlo (la base del seed es compartida).
  // Si el PATCH que lo cambia falla a medias, el `afterEach` igual restaura.
  const metodos = await api<{ metodoPagoId: string, emisor: string }[]>(
    request, 'get', '/metodos-pago', { token: escenario.tokenAdmin },
  )
  escenario.emisorOriginal = metodos.find(m => m.metodoPagoId === DEBITO)?.emisor
  await api(request, 'patch', `/metodos-pago/${DEBITO}`, {
    token: escenario.tokenAdmin,
    data: { emisor: 'nadie' },
  })

  escenario.cajaId = await abrirCaja(request, escenario.tokenVendedor)
})

test.afterEach(async ({ request }) => {
  const { tokenAdmin, tokenVendedor, cajaId, emisorOriginal, itemIds } = escenario
  // Restaurar va primero: una suite que deja el débito en `nadie` le cambia los
  // documentos a todas las que cobren con él después, y el cierre de caja de
  // abajo puede lanzar.
  if (tokenAdmin) {
    await api(request, 'patch', `/metodos-pago/${DEBITO}`, {
      token: tokenAdmin,
      data: { emisor: emisorOriginal ?? 'sistema' },
    })
  }
  if (tokenVendedor && cajaId) await cerrarCaja(request, tokenVendedor, cajaId, '0')
  if (tokenAdmin) await limpiarItems(request, tokenAdmin, itemIds)
})

/** Un producto con un precio que ninguna otra suite usa (sale del reloj). */
async function sembrarProducto(request: APIRequestContext, nombre: string, precioNeto: number) {
  const item = await crearProducto(request, escenario.tokenAdmin!, {
    nombre: `${nombre} ${Date.now()}`,
    precioBase: String(precioNeto),
  })
  escenario.itemIds.push(item.id)
  return item
}

/**
 * Una venta armada por API como la cajera, cobrada **entera** con un medio: sin
 * saldo, el estado no entra en lo que se prueba. El neto es múltiplo de 100, así
 * que neto + IVA 19% da un total entero que se conoce sin preguntarle al servidor.
 */
async function ventaPorApi(
  request: APIRequestContext,
  itemId: string,
  precioNeto: number,
  metodoPagoId: string,
): Promise<VentaServidor> {
  const total = new Decimal(precioNeto).times('1.19').toString()
  const creada = await api<{ id: string }>(request, 'post', '/ventas', {
    token: escenario.tokenVendedor,
    data: {
      lineas: [{ itemId, cantidad: '1' }],
      pagos: [{ metodoPagoId, monto: total }],
    },
  })
  const venta = await api<VentaServidor>(request, 'get', `/ventas/${creada.id}`, {
    token: escenario.tokenVendedor,
  })
  expect(venta.estado).toBe('pagada')
  expect(Number(venta.totalFinal)).toBe(Number(total))
  return venta
}

/** `23800.0000` → `$23.800`, como lo pinta la tabla (`formatMonto`, CLP sin decimales). */
function comoSeVe(totalFinal: string): string {
  const entero = String(Math.trunc(Number(totalFinal)))
  return `$${entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
}

function filaDe(page: Page, venta: VentaServidor): Locator {
  return page.locator('tbody tr').filter({ hasText: comoSeVe(venta.totalFinal) })
}

test('filtro "Documento": "Sin documento" deja la venta sin documentar y saca la del sistema, y "Del sistema" al revés', async ({
  page,
  request,
}) => {
  // Netos distintos y fuera de lo que usan las otras suites: el total de cada
  // venta (neto + IVA 19%) la identifica en la tabla.
  const base = 20000 + 100 * (Date.now() % 500)
  const productoSin = await sembrarProducto(request, 'Filtro sin documento', base)
  const productoSis = await sembrarProducto(request, 'Filtro del sistema', base + 2000)

  // Cobrada con la tarjeta, que el comercio declaró `nadie`: no hay documento.
  const sinDocumento = await ventaPorApi(request, productoSin.id, base, DEBITO)
  // Cobrada en efectivo (del sistema): la boleta queda armada.
  const delSistema = await ventaPorApi(request, productoSis.id, base + 2000, EFECTIVO)
  expect(comoSeVe(sinDocumento.totalFinal)).not.toBe(comoSeVe(delSistema.totalFinal))

  await entrarComo(page, VENDEDOR.email, VENDEDOR.password)
  await page.goto('/ventas')
  const filtro = page.getByRole('combobox').filter({ hasText: 'Documento' })

  // Sin filtro, las dos están: la lista abre sobre lo más nuevo, que son las mías.
  await expect(filaDe(page, sinDocumento)).toHaveCount(1)
  await expect(filaDe(page, delSistema)).toHaveCount(1)
  await expect(filaDe(page, sinDocumento).locator('td').filter({ hasText: 'Sin documento' }))
    .toHaveCount(1)
  await expect(filaDe(page, delSistema).locator('td').filter({ hasText: /^Sistema$/ }))
    .toHaveCount(1)

  // "Sin documento": la `nadie` se queda, con su badge de aviso; la del sistema sale.
  const pedidoSin = page.waitForResponse(
    r => r.url().includes('/ventas?') && r.url().includes('documento=sin_documento'),
  )
  await filtro.click()
  await page.getByRole('option', { name: 'Sin documento', exact: true }).click()
  const idsSin = (((await (await pedidoSin).json()) as { data: { id: string }[] }).data)
    .map(v => v.id)
  expect(idsSin).toContain(sinDocumento.id)
  expect(idsSin).not.toContain(delSistema.id)
  await expect(filaDe(page, sinDocumento)).toHaveCount(1)
  await expect(filaDe(page, delSistema)).toHaveCount(0)
  await expect(filaDe(page, sinDocumento).locator('td').filter({ hasText: 'Sin documento' }))
    .toHaveCount(1)

  // "Del sistema": al revés. La que no tiene documento ya no entra.
  const pedidoSis = page.waitForResponse(
    r => r.url().includes('/ventas?') && r.url().includes('documento=sistema'),
  )
  await filtro.click()
  await page.getByRole('option', { name: 'Del sistema', exact: true }).click()
  const idsSis = (((await (await pedidoSis).json()) as { data: { id: string }[] }).data)
    .map(v => v.id)
  expect(idsSis).toContain(delSistema.id)
  expect(idsSis).not.toContain(sinDocumento.id)
  await expect(filaDe(page, delSistema)).toHaveCount(1)
  await expect(filaDe(page, sinDocumento)).toHaveCount(0)
  await expect(filaDe(page, delSistema).locator('td').filter({ hasText: /^Sistema$/ }))
    .toHaveCount(1)

  // Limpiar filtros vuelve a pedir sin `documento`: las dos de nuevo.
  const pedidoLimpio = page.waitForRequest(
    r => r.url().includes('/ventas?') && !r.url().includes('documento='),
  )
  await page.getByRole('button', { name: 'Limpiar filtros' }).click()
  await pedidoLimpio
  await expect(filaDe(page, sinDocumento)).toHaveCount(1)
  await expect(filaDe(page, delSistema)).toHaveCount(1)

  // La caja cierra con lo cobrado en efectivo (la venta de la tarjeta no entra).
  expect(await cerrarCaja(
    request, escenario.tokenVendedor!, escenario.cajaId!,
    String(Math.trunc(Number(delSistema.totalFinal))),
  )).toBe('cerrada')
  escenario.cajaId = undefined
})
