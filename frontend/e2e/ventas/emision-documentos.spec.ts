import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { test, expect } from '../support/sin-qz-tray'
import {
  abrirCaja,
  api,
  API,
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
  pagoId: string | null
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

/**
 * Un rol propio con `Ventas:Leer` + `Ventas:Nota de crédito`, asignado a la
 * vendedora mientras dura el test. No existe en el seed: el rol `Vendedor` no
 * puede emitir notas, y probar la pantalla como admin taparía el 403 de un
 * control mal gateado. Devuelve cómo deshacerlo (se saca de la cuenta y se da de
 * baja el rol), que va en el `finally`: la base del seed es compartida.
 */
async function darNotaDeCreditoALaVendedora(
  request: APIRequestContext,
  tokenAdmin: string,
): Promise<() => Promise<void>> {
  const modulos = await api<{
    moduloTenantId: string
    nombre: string
    permisos: { moduloAppPermisoId: string, permisoNombre: string }[]
  }[]>(request, 'get', '/roles/modulos-disponibles', { token: tokenAdmin })
  const ventas = modulos.find(m => m.nombre === 'Ventas')!
  const idsPermisos = ['Leer', 'Nota de crédito'].map(
    nombre => ventas.permisos.find(p => p.permisoNombre === nombre)!.moduloAppPermisoId,
  )
  const rol = await api<{ id: string }>(request, 'post', '/roles', {
    token: tokenAdmin,
    data: { nombre: `E2E Ventas NC ${Date.now()}` },
  })
  const put = await request.put(
    `${API}/roles/${rol.id}/modules/${ventas.moduloTenantId}/permissions`,
    {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
      data: { moduloAppPermisoIds: idsPermisos },
    },
  )
  expect(put.ok()).toBe(true)
  const miembros = await api<{ usuarioId: string, correo: string }[]>(
    request, 'get', '/tenants/members', { token: tokenAdmin },
  )
  const usuarioId = miembros.find(m => m.correo === VENDEDOR.email)!.usuarioId
  await api(request, 'post', `/roles/${rol.id}/users`, {
    token: tokenAdmin,
    data: { usuarioId },
  })
  return async () => {
    const headers = { Authorization: `Bearer ${tokenAdmin}` }
    await request.delete(`${API}/roles/${rol.id}/users/${usuarioId}`, { headers })
    await request.delete(`${API}/roles/${rol.id}`, { headers })
  }
}

test('nota de crédito por la tarjeta de un pago mixto, como un rol con Ventas:Nota de crédito: corrige el voucher y no saca plata de la caja', async ({
  page,
  request,
}) => {
  const quitarRol = await darNotaDeCreditoALaVendedora(request, escenario.tokenAdmin!)
  try {
    const producto = await sembrarProducto(request, 'Emisión NC tarjeta')
    // $5.000 en efectivo (boleta del sistema) + $6.900 con la tarjeta (voucher).
    const venta = await ventaPorApi(request, producto.id, [
      { metodoPagoId: EFECTIVO, monto: EN_EFECTIVO },
      { metodoPagoId: DEBITO, monto: CON_TARJETA },
    ])
    const voucher = venta.documentos.find(d => d.emisor === 'maquina')!

    await entrarComoVendedor(page)
    await page.goto(`/ventas?venta=${venta.id}`)
    await detalleDe(page).getByRole('button', { name: 'Nota de crédito' }).click()
    const modal = page.getByRole('dialog').filter({ hasText: 'Generar nota de crédito' })

    // Una opción por pago, con el medio y lo que cubrió. Hay dos: no viene
    // ninguna elegida (un default movería plata de la caja sin que se decida) y
    // sin "No vuelve plata" porque la venta está pagada.
    // El rótulo de cada opción (medio · lo que cubrió) es el nombre accesible del radio.
    const efectivo = modal.getByRole('radio', { name: 'Efectivo · $5.000' })
    const tarjeta = modal.getByRole('radio', { name: 'Tarjeta de débito · $6.900' })
    await expect(efectivo).toHaveCount(1)
    await expect(tarjeta).toHaveCount(1)
    await expect(modal.getByRole('radio', { name: /No vuelve plata/ })).toHaveCount(0)
    await expect(efectivo).not.toBeChecked()
    await expect(tarjeta).not.toBeChecked()
    const generar = modal.getByRole('button', { name: 'Generar nota de crédito' })
    await expect(generar).toBeDisabled()

    await tarjeta.check()
    await expect(modal.locator('[data-qa="registro-que-queda"]')).toContainText(
      'nota de crédito de la máquina',
    )
    await expect(generar).toBeEnabled()

    const campoMonto = modal.locator(
      'xpath=.//span[normalize-space(text())="Monto"]/following-sibling::*[1]',
    )
    await escribirMonto(campoMonto, '1500')
    const pedido = page.waitForRequest(
      r => r.url().includes('/notas-credito') && r.method() === 'POST',
    )
    const respuesta = page.waitForResponse(
      r => r.url().includes('/notas-credito') && r.request().method() === 'POST',
    )
    await generar.click()
    const cuerpo = (await pedido).postDataJSON() as Record<string, unknown>
    // El pago de la tarjeta (el voucher cubre ese pago), y nada más.
    expect(cuerpo.devolucion).toEqual({ pagoId: voucher.pagoId })
    expect(cuerpo).not.toHaveProperty('devolverDinero')
    const nc = (await (await respuesta).json()) as { id: string, movimientoCajaId: string | null }
    expect(nc.movimientoCajaId).toBeNull()
    await expect(page.getByText('Nota de crédito generada').first()).toBeVisible({ timeout: 15_000 })

    // Del lado del servidor: la corrección lleva su propio documento, de la
    // máquina y sin número, y apunta al voucher (no a la boleta del sistema).
    const corregida = await api<{
      esCorreccion: boolean
      esNotaCredito: boolean
      documentos: (DocumentoServidor & { documentoCorregidoId: string | null })[]
    }>(request, 'get', `/ventas/${nc.id}`, { token: escenario.tokenVendedor })
    expect(corregida.esCorreccion).toBe(true)
    expect(corregida.esNotaCredito).toBe(true)
    expect(corregida.documentos).toHaveLength(1)
    expect(corregida.documentos[0]).toMatchObject({
      emisor: 'maquina',
      numero: null,
      monto: '1500.0000',
      documentoCorregidoId: voucher.id,
    })

    // Sin salida de caja: la caja cierra con lo cobrado en efectivo.
    expect(await cerrarCaja(request, escenario.tokenVendedor!, escenario.cajaId!, EN_EFECTIVO))
      .toBe('cerrada')
    escenario.cajaId = undefined
  }
  finally {
    await quitarRol()
  }
})
