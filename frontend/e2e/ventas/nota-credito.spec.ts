import { test, expect } from '@playwright/test'
import {
  abrirCaja,
  api,
  cerrarCaja,
  crearProducto,
  EFECTIVO,
  limpiarItems,
  tokenDe,
  TENANTS,
} from '../support/api'
import { escribirMonto, valorDeFila } from '../support/ui'

/**
 * Emitir una nota de crédito sobre una venta ya cobrada, por pantalla.
 *
 * Lo que la NC tiene que dejar bien no es un total: es un **vínculo**. Una NC
 * suelta —sin `venta_referencia_id`— es un documento que baja la recaudación sin
 * decir de qué venta salió, que es exactamente lo que la auditoría fiscal no
 * puede permitir. Por eso la aserción central no es el monto sino la referencia.
 *
 * Va **parcial** ($500 sobre $1.190) a propósito: una NC por el total no
 * distinguiría "usó el monto tecleado" de "usó el total de la venta".
 *
 * ⚠️ La venta original se monta por API: cobrarla ya está cubierto en
 * `e2e/ventas/pos.spec.ts`, y repetirlo acá haría que un cambio en el POS
 * rompiera un test de notas de crédito.
 */

const PRECIO = '1000'
/** $1.000 + 19% de IVA. */
const TOTAL_VENTA = '$1.190'
const TOTAL_VENTA_API = '1190.0000'
/** La NC es parcial: no puede confundirse con el total de la venta. */
const MONTO_NC = '500'
const MONTO_NC_API = '500.0000'
/** Lo cobrado menos lo devuelto en efectivo desde la caja. */
const EFECTIVO_TRAS_LA_NC = '690'
/** Código SII de la nota de crédito (`tipos_documento_tributario`). */
const CODIGO_NC = '61'

let escenario: { token?: string; cajaId?: string; itemIds: string[] } = {
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

test('una nota de crédito parcial queda atada a la venta que la originó', async ({
  page,
  request,
}) => {
  const token = escenario.token!

  const producto = await crearProducto(request, token, {
    nombre: `NC ${Date.now()}`,
    precioBase: PRECIO,
  })
  escenario.itemIds.push(producto.id)

  const tipos = await api<{ id: string; nombre: string }[]>(
    request,
    'get',
    '/tipos-documento',
    { token },
  )
  const venta = await api<{ id: string; estado: string }>(
    request,
    'post',
    '/ventas',
    {
      token,
      data: {
        lineas: [{ itemId: producto.id, cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO, monto: TOTAL_VENTA_API }],
        tipoDocumentoId: tipos[0]?.id,
      },
    },
  )
  expect(venta.estado).toBe('pagada')

  // `/ventas?venta=<id>` es la ruta que la propia app usa para abrir el detalle
  // (`pages/ventas/[id].vue` redirige ahí). Elegir la fila en la tabla del
  // listado no está cubierto por este test.
  await page.goto(`/ventas?venta=${venta.id}`)
  const detalle = page.getByRole('dialog').filter({ hasText: 'Detalle de venta' })
  await expect(valorDeFila(detalle, 'Total final')).toHaveText(TOTAL_VENTA)

  await detalle.getByRole('button', { name: 'Nota de crédito' }).click()
  const modal = page.getByRole('dialog').filter({ hasText: 'Nota de crédito' })
  await expect(
    valorDeFila(modal, 'Disponible para nota de crédito'),
  ).toHaveText(TOTAL_VENTA)

  // El monto va anclado a su etiqueta: el modal tiene un segundo campo decimal
  // —la cantidad a devolver al inventario—, así que buscar "el input del modal"
  // es ambiguo.
  const campoMonto = modal.locator(
    'xpath=.//span[normalize-space(text())="Monto"]/following-sibling::*[1]',
  )
  await escribirMonto(campoMonto, MONTO_NC)
  await modal
    .getByRole('checkbox', {
      name: 'Registrar devolución de dinero desde la caja',
    })
    .check()

  const respuesta = page.waitForResponse(
    (r) => r.url().includes('/notas-credito') && r.request().method() === 'POST',
  )
  await modal.getByRole('button', { name: 'Generar nota de crédito' }).click()
  const nc = (await (await respuesta).json()) as { id: string }
  await expect(
    page.getByText('Nota de crédito generada con devolución de dinero').first(),
  ).toBeVisible({ timeout: 15_000 })

  // La aserción que importa: la NC existe como documento propio, con su código
  // tributario, y APUNTA a la venta original.
  const documento = await api<{
    ventaReferenciaId: string | null
    esNotaCredito: boolean
    totalFinal: string
    tipoDocumento: { codigo: string | null } | null
  }>(request, 'get', `/ventas/${nc.id}`, { token })
  expect(documento.esNotaCredito).toBe(true)
  expect(documento.tipoDocumento?.codigo).toBe(CODIGO_NC)
  expect(documento.totalFinal).toBe(MONTO_NC_API)
  expect(documento.ventaReferenciaId).toBe(venta.id)

  // Y la venta original la reconoce como hija: el vínculo se ve desde los dos
  // lados, no solo desde la NC.
  const original = await api<{ notasCredito: { id: string; totalFinal: string }[] }>(
    request,
    'get',
    `/ventas/${venta.id}`,
    { token },
  )
  expect(original.notasCredito).toHaveLength(1)
  expect(original.notasCredito[0]?.id).toBe(nc.id)
  expect(original.notasCredito[0]?.totalFinal).toBe(MONTO_NC_API)

  // La devolución salió del cajón: se cobraron $1.190 y se devolvieron $500.
  expect(
    await cerrarCaja(request, token, escenario.cajaId!, EFECTIVO_TRAS_LA_NC),
  ).toBe('cerrada')
})
