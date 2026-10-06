import type { Route } from '@playwright/test'
import { test, expect } from '../support/sesion'
import {
  abrirCaja,
  api,
  cerrarCaja,
  CLP,
  crearProducto,
  EFECTIVO,
  limpiarItems,
  tokenDe,
  TENANTS,
} from '../support/api'
import { escribirMonto } from '../support/ui'

/**
 * La nota de crédito —y el reembolso de la pasarela— preguntan si lo devuelto
 * vuelve al stock o se perdió (owner, 2026-08-23), en toda línea que sacó algo
 * del inventario: el producto suelto y también la receta, que antes se trataba
 * como un servicio. Sin respuesta no se confirma, y ninguna viene elegida.
 *
 * Lo que el kardex hace con cada respuesta lo fija el e2e de API
 * (`backend/test/nota-credito-recupera-o-pierde.e2e-spec.ts`); acá, que la
 * pantalla pregunte donde el servidor exige y mande lo que se contestó, con un
 * vistazo al resultado por la API.
 */

/** $1.000 + 19% de IVA. */
const TOTAL_VENTA_API = '1190.0000'

let escenario: { token?: string, cajaId?: string, itemIds: string[] } = {
  itemIds: [],
}

test.beforeEach(async ({ request }) => {
  escenario = { itemIds: [] }
  escenario.token = await tokenDe(request, TENANTS.restaurante)
  escenario.cajaId = await abrirCaja(request, escenario.token)
})

test.afterEach(async ({ request }) => {
  const { token, cajaId, itemIds } = escenario
  if (!token) return
  if (cajaId) await cerrarCaja(request, token, cajaId, '0')
  await limpiarItems(request, token, itemIds)
})

async function venderUno(
  request: Parameters<typeof api>[0],
  token: string,
  itemId: string,
): Promise<string> {
  const tipos = await api<{ id: string, esBoleta: boolean }[]>(request, 'get', '/tipos-documento', { token })
  const venta = await api<{ id: string, estado: string }>(request, 'post', '/ventas', {
    token,
    data: {
      lineas: [{ itemId, cantidad: '1' }],
      pagos: [{ metodoPagoId: EFECTIVO, monto: TOTAL_VENTA_API }],
      tipoDocumentoId: tipos.find(t => t.esBoleta)?.id,
    },
  })
  expect(venta.estado).toBe('pagada')
  return venta.id
}

test('una receta pregunta, sin respuesta no se emite, y "Vuelve al stock" repone su ingrediente', async ({
  page,
  request,
}) => {
  const token = escenario.token!
  const ingrediente = await api<{ id: string }>(request, 'post', '/items', {
    token,
    data: {
      nombre: `RP pan ${Date.now()}`,
      precioBase: '0',
      monedaId: CLP,
      tipo: 'ingrediente',
      unidadMedida: 'unidad',
      stock: '20',
      costo: '200',
    },
  })
  const receta = await api<{ id: string }>(request, 'post', '/items', {
    token,
    data: {
      nombre: `RP hamburguesa ${Date.now()}`,
      precioBase: '1000',
      monedaId: CLP,
      tipo: 'receta',
      clasificacionTributaria: 'afecto',
      ingredientes: [
        { ingredienteItemId: ingrediente.id, cantidad: '1', unidadCodigo: 'unidad', bloqueante: true },
      ],
    },
  })
  // La receta antes que su ingrediente: si no, el ingrediente está en uso y no se borra.
  escenario.itemIds.push(receta.id, ingrediente.id)
  const ventaId = await venderUno(request, token, receta.id)

  await page.goto(`/ventas?venta=${ventaId}`)
  const detalle = page.getByRole('dialog').filter({ hasText: 'Detalle de venta' })
  await detalle.getByRole('button', { name: 'Nota de crédito' }).click()
  const modal = page.getByRole('dialog').filter({ hasText: 'Nota de crédito' })
  const fila = modal.getByTestId(`devolucion-fila-${receta.id}`)

  // La receta pregunta (antes decía "no maneja stock") y no trae nada elegido.
  const vuelve = fila.getByRole('radio', { name: 'Vuelve al stock' })
  const perdio = fila.getByRole('radio', { name: 'Se perdió' })
  await expect(vuelve).not.toBeChecked()
  await expect(perdio).not.toBeChecked()

  await escribirMonto(fila, '1')
  const generar = modal.getByRole('button', { name: 'Generar nota de crédito' })
  await expect(generar).toBeDisabled()
  await expect(modal).toContainText('si vuelve al stock o se perdió')

  await vuelve.click()
  await expect(generar).toBeEnabled()
  const pedido = page.waitForRequest(r => r.url().includes('/notas-credito') && r.method() === 'POST')
  const respuesta = page.waitForResponse(
    r => r.url().includes('/notas-credito') && r.request().method() === 'POST',
  )
  await generar.click()
  const cuerpo = (await pedido).postDataJSON() as { devoluciones: unknown[] }
  expect(cuerpo.devoluciones).toEqual([{ itemId: receta.id, cantidad: '1', stock: 'recupera' }])
  expect((await respuesta).status()).toBe(201)

  // El ingrediente volvió: una entrada `devolucion` en su kardex.
  const movs = await api<{ data: { motivo: string, tipo: string }[] }>(
    request,
    'get',
    `/inventario/movimientos?itemId=${ingrediente.id}&motivo=devolucion`,
    { token },
  )
  expect(movs.data).toEqual([expect.objectContaining({ motivo: 'devolucion', tipo: 'entrada' })])
})

test('un producto que "Se perdió" sale como merma "Devolución", también en el kardex', async ({ page, request }) => {
  const token = escenario.token!
  const nombre = `RP botella ${Date.now()}`
  // Costo 400 (el de `crearProducto`): la merma de 1 vale $400 al costo con que salió.
  const producto = await crearProducto(request, token, {
    nombre,
    precioBase: '1000',
  })
  escenario.itemIds.push(producto.id)
  const ventaId = await venderUno(request, token, producto.id)

  await page.goto(`/ventas?venta=${ventaId}`)
  const detalle = page.getByRole('dialog').filter({ hasText: 'Detalle de venta' })
  await detalle.getByRole('button', { name: 'Nota de crédito' }).click()
  const modal = page.getByRole('dialog').filter({ hasText: 'Nota de crédito' })
  const fila = modal.getByTestId(`devolucion-fila-${producto.id}`)

  await escribirMonto(fila, '1')
  await fila.getByRole('radio', { name: 'Se perdió' }).click()
  await expect(fila).toContainText('Sale como merma «Devolución»')
  const respuesta = page.waitForResponse(
    r => r.url().includes('/notas-credito') && r.request().method() === 'POST',
  )
  await modal.getByRole('button', { name: 'Generar nota de crédito' }).click()
  expect((await respuesta).status()).toBe(201)

  const mermas = await api<{ data: { motivoBajaNombre: string }[] }>(
    request,
    'get',
    `/mermas?itemId=${producto.id}`,
    { token },
  )
  expect(mermas.data.map(m => m.motivoBajaNombre)).toEqual(['Devolución'])

  // En el kardex es una merma como cualquier otra: "Merma · Devolución", en rojo
  // (frente del kardex, 2026-10-04: solo la cortesía y la comida del personal no
  // son pérdida).
  await page.goto('/inventario')
  const filaKardex = page.getByRole('row', { name: new RegExp(nombre) })
    .filter({ hasText: 'Merma · Devolución' })
  await expect(filaKardex).toBeVisible()
  await expect(filaKardex.getByText('$400', { exact: true })).toHaveClass(/text-error/)
})

/**
 * El reembolso de la pasarela hace la misma pregunta. El stack no tiene doble de
 * Transbank y una orden pagada solo nace de un cobro real, así que la orden se
 * inyecta en las respuestas de `/pasarela/admin/ordenes` —ligada a una venta
 * real, cuyas líneas y su `devolucionStock` sí vienen del servidor— y el POST
 * del reembolso se intercepta: lo que se prueba es la pantalla y el body. Que el
 * servidor rebote la línea sin respuesta antes del proveedor lo fija
 * `backend/test/pasarela-reembolso.e2e-spec.ts`.
 */
test('el reembolso de una orden pregunta lo mismo y manda la respuesta', async ({ page, request }) => {
  const token = escenario.token!
  const producto = await crearProducto(request, token, {
    nombre: `RP reembolso ${Date.now()}`,
    precioBase: '1000',
  })
  escenario.itemIds.push(producto.id)
  const ventaId = await venderUno(request, token, producto.id)

  const ORDEN = 'orden-e2e-recupera-o-pierde'
  const orden = {
    ordenId: ORDEN,
    codigoOrden: 'E2E-RP',
    pagadorRef: null,
    referenciaExterna: null,
    ventaId,
    descripcion: 'Orden E2E',
    monto: TOTAL_VENTA_API,
    moneda: 'CLP',
    estado: 'pagada',
    origen: 'tienda',
    creadoEl: new Date().toISOString(),
    transacciones: [{
      transaccionId: 'tx-auth',
      tipo: 'AUTHORIZATION',
      estado: 'aprobada',
      monto: TOTAL_VENTA_API,
      codigoAutorizacion: '1213',
      codigoRespuesta: '0',
      fechaTransaccion: new Date().toISOString(),
    }],
  }
  let cuerpoReembolso: Record<string, unknown> | null = null
  await page.route('**/api/pasarela/admin/ordenes**', async (route: Route) => {
    const url = route.request().url()
    if (route.request().method() === 'POST' && url.endsWith(`/ordenes/${ORDEN}/reembolsos`)) {
      cuerpoReembolso = route.request().postDataJSON() as Record<string, unknown>
      return route.fulfill({ json: { ...orden, estado: 'reembolsada', reembolsoAprobado: true } })
    }
    if (url.includes(`/ordenes/${ORDEN}`)) return route.fulfill({ json: orden })
    return route.fulfill({
      json: { data: [orden], meta: { page: 1, pageSize: 15, total: 1, totalPages: 1 } },
    })
  })

  await page.goto('/ordenes')
  await page.getByText('E2E-RP').click()
  await page.getByRole('button', { name: 'Reembolsar' }).click()
  const modal = page.getByRole('dialog').filter({ hasText: 'Confirmar reembolso' })
  const fila = modal.getByTestId(`devolucion-fila-${producto.id}`)
  await escribirMonto(fila, '1')

  const confirmar = modal.getByRole('button', { name: 'Confirmar reembolso' })
  await expect(confirmar).toBeDisabled()
  await fila.getByRole('radio', { name: 'Vuelve al stock' }).click()
  await expect(confirmar).toBeEnabled()
  await confirmar.click()

  await expect.poll(() => cuerpoReembolso).not.toBeNull()
  expect(cuerpoReembolso!.devoluciones).toEqual([
    { itemId: producto.id, cantidad: '1', stock: 'recupera' },
  ])
})
