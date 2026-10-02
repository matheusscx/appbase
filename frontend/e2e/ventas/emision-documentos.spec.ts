import type { APIRequestContext, Locator, Page } from '@playwright/test'
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
import { elegirEnSelector, escribirMonto, valorDeFila } from '../support/ui'

/**
 * Emisión por venta, en un navegador real: el número del comprobante al cobrar,
 * el aviso del abono con la máquina y "Completar número" del detalle
 * (spec `2026-10-01-emision-por-venta`, § 3.3 a § 3.5; tarea 7 del plan).
 *
 * **Corre como `vendedor@paris.cl`** (rol `Vendedor`: `Ventas:Leer/Crear`,
 * `Pagos:Leer/Crear`, sin `Ventas:Anular` ni módulo `Cajas`), no admin: con admin
 * el 403 de un control mal gateado se tapa. El cobro, el abono y el `PATCH` del
 * número piden justamente esos permisos.
 *
 * **Quién emite lo decide el comercio, no el cajero**: el spec le declara a
 * "Tarjeta de débito" `emisor = 'maquina'` por API como admin, y lo **restaura**
 * al terminar (el seed lo deja en `sistema`). Las precondiciones se montan por
 * API; por pantalla va solo lo que se prueba.
 *
 * **Montos que no son iguales ni 1.** Producto afecto de $10.000 + IVA 19% =
 * $11.900. El cobro mixto es $5.000 en efectivo + $6.900 con la tarjeta: el
 * documento de la máquina tiene que salir por $6.900, no por el total ni por la
 * mitad. La propina se deja en $0 para que lo aplicado a la venta sea lo cobrado.
 *
 * **Nunca vende stock sembrado**: cada test crea su propio producto.
 */

const DEBITO = '550e8400-e29b-41d4-a716-446655440106'
const DEBITO_NOMBRE = 'Tarjeta de débito'
const EFECTIVO_NOMBRE = 'Efectivo'

const PRECIO_NETO = '10000'
const TOTAL = '11900'
const EN_EFECTIVO = '5000'
const CON_TARJETA = '6900'

const VENDEDOR = { email: 'vendedor@paris.cl', password: 'admin' }

test.use({ storageState: { cookies: [], origins: [] } })

interface DocumentoServidor {
  id: string
  ventaId: string
  emisor: string
  claseMaquina: string | null
  numero: string | null
  monto: string
  esDuplicado: boolean
}

interface VentaServidor {
  id: string
  estado: string
  documentos: DocumentoServidor[]
  abonoConMaquinaDuplica: boolean
}

let escenario: {
  tokenAdmin?: string
  tokenVendedor?: string
  cajaId?: string
  emisorOriginal?: string
  itemIds: string[]
} = { itemIds: [] }

async function tokenDeVendedor(request: APIRequestContext): Promise<string> {
  const inicial = await api<{ access_token: string }>(request, 'post', '/auth/login', {
    data: VENDEDOR,
  })
  const sesion = await api<{ access_token: string }>(request, 'post', '/auth/switch-tenant', {
    token: inicial.access_token,
    data: { tenantId: TENANTS.restaurante },
  })
  return sesion.access_token
}

async function entrarComoVendedor(page: Page) {
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.getByPlaceholder('tu@email.com').fill(VENDEDOR.email)
  await page.locator('input[type="password"]').first().fill(VENDEDOR.password)
  const submit = page.locator('button[type="submit"]').first()
  await expect(submit).toBeEnabled()
  await submit.click()
  await page.waitForURL(url => url.pathname === '/')
}

test.beforeEach(async ({ request }) => {
  escenario = { itemIds: [] }
  escenario.tokenAdmin = await tokenDe(request, TENANTS.restaurante)
  escenario.tokenVendedor = await tokenDeVendedor(request)

  // Quién emite lo declara el comercio: el débito pasa a la máquina. Se guarda lo
  // que había para devolverlo (la base del seed es compartida entre las suites).
  const metodos = await api<{ metodoPagoId: string, emisor: string }[]>(
    request, 'get', '/metodos-pago', { token: escenario.tokenAdmin },
  )
  escenario.emisorOriginal = metodos.find(m => m.metodoPagoId === DEBITO)?.emisor
  await api(request, 'patch', `/metodos-pago/${DEBITO}`, {
    token: escenario.tokenAdmin,
    data: { emisor: 'maquina' },
  })

  escenario.cajaId = await abrirCaja(request, escenario.tokenVendedor)
})

test.afterEach(async ({ request }) => {
  const { tokenAdmin, tokenVendedor, cajaId, emisorOriginal, itemIds } = escenario
  if (tokenVendedor && cajaId) await cerrarCaja(request, tokenVendedor, cajaId, '0')
  if (tokenAdmin) {
    // Restaurar es parte del test: una suite que deja el débito en la máquina
    // le cambia los documentos a todas las que cobren después.
    await api(request, 'patch', `/metodos-pago/${DEBITO}`, {
      token: tokenAdmin,
      data: { emisor: emisorOriginal ?? 'sistema' },
    })
    await limpiarItems(request, tokenAdmin, itemIds)
  }
})

async function sembrarProducto(request: APIRequestContext, nombre: string) {
  const item = await crearProducto(request, escenario.tokenAdmin!, {
    nombre: `${nombre} ${Date.now()}`,
    precioBase: PRECIO_NETO,
  })
  escenario.itemIds.push(item.id)
  return item
}

/** Una venta armada por API como la cajera: su caja abierta, sus permisos. */
async function ventaPorApi(
  request: APIRequestContext,
  itemId: string,
  pagos: { metodoPagoId: string, monto: string }[],
): Promise<VentaServidor> {
  const creada = await api<{ id: string }>(request, 'post', '/ventas', {
    token: escenario.tokenVendedor,
    data: { lineas: [{ itemId, cantidad: '1' }], pagos },
  })
  // El `POST` devuelve la venta recién armada; los documentos salen del detalle.
  return api<VentaServidor>(request, 'get', `/ventas/${creada.id}`, {
    token: escenario.tokenVendedor,
  })
}

function detalleDe(page: Page): Locator {
  return page.getByRole('dialog').filter({ hasText: 'Detalle de venta' })
}

function filaDePago(cobro: Locator, indice: number): Locator {
  return cobro.locator(`[data-qa="pago-${indice}"]`)
}

test('cobro mixto: efectivo y tarjeta con número — el documento de la máquina sale por lo de la tarjeta', async ({
  page,
  request,
}) => {
  const producto = await sembrarProducto(request, 'Emisión mixto')
  await entrarComoVendedor(page)
  await page.goto('/ventas/pos')
  await page.locator(`[data-qa="item-catalogo-${producto.id}"]`).click()
  await expect(valorDeFila(page, 'Total')).toHaveText('$11.900')

  await page.getByRole('button', { name: 'Cobrar', exact: true }).click()
  const cobro = page.getByRole('dialog').filter({ hasText: 'Cobrar venta' })

  // Sin propina: lo aplicado a la venta es lo cobrado.
  await escribirMonto(
    cobro.locator('xpath=//span[normalize-space(text())="Propina"]/following-sibling::*[1]'),
    '0',
  )
  await expect(valorDeFila(cobro, 'Total a pagar')).toHaveText('$11.900')

  // El medio por defecto es efectivo (del sistema): no hay nada que numerar.
  await expect(selectorDe(filaDePago(cobro, 0))).toContainText(EFECTIVO_NOMBRE)
  await expect(cobro.getByPlaceholder('N° del comprobante')).toHaveCount(0)
  await escribirMonto(filaDePago(cobro, 0), EN_EFECTIVO)

  // El resto, con la tarjeta: ahora sí aparecen el número y la clase, y solo ahí.
  await cobro.getByRole('button', { name: 'Agregar pago' }).click()
  await elegirEnSelector(filaDePago(cobro, 1).locator('xpath=./div[1]'), DEBITO_NOMBRE)
  await expect(cobro.getByPlaceholder('N° del comprobante')).toHaveCount(1)
  await expect(filaDePago(cobro, 0).getByPlaceholder('N° del comprobante')).toHaveCount(0)
  await filaDePago(cobro, 1).getByPlaceholder('N° del comprobante').fill('445566')
  // La clase es opcional y su selector lleva nombre propio (no el 'Show popup' por
  // defecto de Reka), así que no pasa por `elegirEnSelector`.
  const clase = filaDePago(cobro, 1).getByRole('button', { name: 'Clase del comprobante de la máquina' })
  await clase.click()
  await page.getByRole('option', { name: 'Es voucher', exact: true }).click()
  await expect(clase).toContainText('Es voucher')

  const pedido = page.waitForRequest(
    r => r.url().endsWith('/ventas') && r.method() === 'POST',
  )
  const respuesta = page.waitForResponse(
    r => r.url().endsWith('/ventas') && r.request().method() === 'POST',
  )
  await cobro.getByRole('button', { name: 'Confirmar venta' }).click()
  const body = (await pedido).postDataJSON() as { pagos: Record<string, unknown>[] }
  const ventaId = ((await (await respuesta).json()) as { id: string }).id

  // Lo que viajó: el número y la clase solo en el pago de la tarjeta, y nada que
  // diga quién emite (eso es del servidor).
  expect(body.pagos).toHaveLength(2)
  expect(body.pagos[0]).not.toHaveProperty('numeroDocumento')
  expect(body.pagos[1]).toMatchObject({
    metodoPagoId: DEBITO,
    monto: CON_TARJETA,
    numeroDocumento: '445566',
    claseDocumento: 'voucher',
  })
  expect(JSON.stringify(body)).not.toMatch(/emisor/i)

  // Del lado del servidor: dos documentos, el de la máquina por $6.900 con su
  // número y su clase, y el del sistema por los $5.000 en efectivo.
  const venta = await api<VentaServidor>(request, 'get', `/ventas/${ventaId}`, {
    token: escenario.tokenVendedor,
  })
  const maquina = venta.documentos.find(d => d.emisor === 'maquina')
  const sistema = venta.documentos.find(d => d.emisor === 'sistema')
  expect(venta.documentos).toHaveLength(2)
  expect(maquina).toMatchObject({ monto: '6900.0000', numero: '445566', claseMaquina: 'voucher' })
  expect(sistema?.monto).toBe('5000.0000')

  // Y el detalle de la venta lo muestra, como la cajera.
  await page.goto(`/ventas?venta=${ventaId}`)
  const documentos = detalleDe(page).locator('[data-qa="documentos"]')
  await expect(documentos).toContainText('La máquina · Voucher')
  await expect(documentos).toContainText('N° 445566')
  await expect(documentos).toContainText('El sistema · Boleta')
  await expect(documentos).toContainText('Armado, sin enviar al SII')

  expect(await cerrarCaja(request, escenario.tokenVendedor!, escenario.cajaId!, EN_EFECTIVO))
    .toBe('cerrada')
  escenario.cajaId = undefined
})

/** El selector de método de una fila de pago, para leerlo. */
function selectorDe(fila: Locator): Locator {
  return fila.locator('xpath=./div[1]').getByRole('button', { name: 'Show popup' })
}

test('abono con tarjeta sobre una deuda ya documentada: avisa el voucher duplicado y no bloquea', async ({
  page,
  request,
}) => {
  const producto = await sembrarProducto(request, 'Emisión abono')
  // Pagó $5.000 en efectivo: queda debiendo $6.900, y esa deuda ya está
  // documentada (E1) — por eso un voucher de la máquina la duplicaría.
  const venta = await ventaPorApi(request, producto.id, [{ metodoPagoId: EFECTIVO, monto: EN_EFECTIVO }])
  expect(venta.estado).toBe('pagada_parcial')

  await entrarComoVendedor(page)
  await page.goto(`/ventas?venta=${venta.id}`)
  await detalleDe(page).getByRole('button', { name: 'Registrar pago' }).click()
  const abono = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Registrar pago' }) })

  const AVISO = 'Esta venta ya tiene su boleta. El voucher de este pago también vale como boleta y la duplica. El cobro sigue, y queda marcado para que el contador lo corrija.'
  // Con efectivo (del sistema) no hay nada que avisar.
  await expect(abono.getByText(AVISO)).toHaveCount(0)
  await elegirEnSelector(abono, DEBITO_NOMBRE)
  await expect(abono.getByText(AVISO)).toBeVisible()

  // El aviso no bloquea: se puede tipear el número y confirmar.
  await abono.getByPlaceholder('N° del comprobante').fill('99887')
  const pedido = page.waitForRequest(r => r.url().endsWith('/pagos') && r.method() === 'POST')
  await abono.getByRole('button', { name: 'Confirmar pago' }).click()
  const body = (await pedido).postDataJSON() as { pagos: Record<string, unknown>[] }
  expect(body.pagos).toEqual([
    { metodoPagoId: DEBITO, monto: CON_TARJETA, numeroDocumento: '99887' },
  ])

  // El pago quedó, y su documento duplicado marcado para el contador.
  const marca = detalleDe(page).locator('[data-qa="documentos"]')
  await expect(marca).toContainText('Duplicado — para el contador', { timeout: 15_000 })
  await expect(marca).toContainText('N° 99887')
  const despues = await api<VentaServidor>(request, 'get', `/ventas/${venta.id}`, {
    token: escenario.tokenVendedor,
  })
  expect(despues.estado).toBe('pagada')
  expect(despues.documentos.filter(d => d.emisor === 'maquina' && d.esDuplicado)).toHaveLength(1)

  expect(await cerrarCaja(request, escenario.tokenVendedor!, escenario.cajaId!, EN_EFECTIVO))
    .toBe('cerrada')
  escenario.cajaId = undefined
})

test('completar el número de la máquina desde el detalle: el PATCH va con la venta del documento', async ({
  page,
  request,
}) => {
  const producto = await sembrarProducto(request, 'Emisión completar')
  // Todo con la tarjeta y sin número: el voucher queda "sin número".
  const venta = await ventaPorApi(request, producto.id, [{ metodoPagoId: DEBITO, monto: TOTAL }])
  const sinNumero = venta.documentos.find(d => d.emisor === 'maquina')
  expect(sinNumero?.numero).toBeNull()

  await entrarComoVendedor(page)
  await page.goto(`/ventas?venta=${venta.id}`)
  const fila = detalleDe(page).locator(`[data-qa="documento-${sinNumero!.id}"]`)
  await expect(fila).toContainText('Sin número')

  await fila.getByRole('button', { name: 'Completar número' }).click()
  await fila.getByPlaceholder('N° del comprobante').fill('123456')
  const respuesta = page.waitForResponse(
    r => r.url().includes(`/ventas/${sinNumero!.ventaId}/documentos/${sinNumero!.id}`)
      && r.request().method() === 'PATCH',
  )
  await fila.getByRole('button', { name: 'Guardar número' }).click()
  expect((await respuesta).status()).toBe(200)

  await expect(fila).toContainText('N° 123456')
  await expect(fila.getByRole('button', { name: 'Completar número' })).toHaveCount(0)
  const despues = await api<VentaServidor>(request, 'get', `/ventas/${venta.id}`, {
    token: escenario.tokenVendedor,
  })
  expect(despues.documentos.find(d => d.id === sinNumero!.id)?.numero).toBe('123456')

  expect(await cerrarCaja(request, escenario.tokenVendedor!, escenario.cajaId!, '0'))
    .toBe('cerrada')
  escenario.cajaId = undefined
})
