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
import { entrarComo, valorDeFila } from '../support/ui'

/**
 * Una nota "No vuelve plata" que cubre toda la deuda: la venta pasa a pagada y
 * "Registrar pago" desaparece del detalle — tarea 14 del frente de emisión
 * (`docs/PRODUCTO.md` § 10, "un abono cobra solo lo que de verdad se debe").
 *
 * Sin esto el cliente podía pagar dos veces lo que ya se le había perdonado. El
 * saldo y el botón los decide el BACKEND (`saldo`/`puedeAbonar` de
 * `GET /ventas/:id`, una sola expresión en `saldo-venta.ts`): la pantalla no resta
 * ni mira el estado, y eso es lo que se mide acá, en un navegador.
 *
 * **Corre como `vendedor@paris.cl`** (`Ventas:Leer/Crear` y `Pagos`, sin
 * `Nota de crédito`), no como admin: es la cajera la que abre la venta y a la que
 * "Registrar pago" no tiene que seguir ofreciéndosele. La nota la emite el admin
 * por API —quien tiene el permiso—. Login por pantalla, molde de
 * `reimprimir-boleta-cajera.spec.ts`.
 *
 * Ítem propio (se da de baja al terminar) y sin tocar el emisor de ningún medio:
 * el efectivo del seed es `sistema`, y la deuda queda documentada con la boleta
 * del sistema, que es lo que "no vuelve plata" corrige.
 */

const PRECIO_BASE = '1000'
/** Afecto + IVA 19%: 1.000 × 1,19 = 1.190. */
const ABONO_INICIAL = '600'
const EFECTIVO_COBRADO = '600'
/** 1.190 − 600: lo que se debe y lo que la nota perdona entero. */
const DEUDA = '590'

const VENDEDOR = { email: 'vendedor@paris.cl', password: 'admin' }

test.use({ storageState: { cookies: [], origins: [] } })

let escenario: { tokenAdmin?: string, tokenVendedor?: string, cajaId?: string, itemId?: string } = {}

test.beforeEach(async ({ request }) => {
  escenario = {}
  escenario.tokenAdmin = await tokenDe(request, TENANTS.restaurante)
  escenario.tokenVendedor = await tokenDe(request, TENANTS.restaurante, VENDEDOR)
  escenario.cajaId = await abrirCaja(request, escenario.tokenVendedor)
})

test.afterEach(async ({ request }) => {
  const { tokenAdmin, tokenVendedor, cajaId, itemId } = escenario
  if (tokenVendedor && cajaId) await cerrarCaja(request, tokenVendedor, cajaId, '0')
  if (tokenAdmin && itemId) await limpiarItems(request, tokenAdmin, [itemId])
})

test('después de una nota "No vuelve plata" que cubre la deuda, la venta queda pagada y no se ofrece "Registrar pago"', async ({
  page,
  request,
}) => {
  const producto = await crearProducto(request, escenario.tokenAdmin!, {
    nombre: `No vuelve plata E2E ${Date.now()}`,
    precioBase: PRECIO_BASE,
  })
  escenario.itemId = producto.id

  // Una venta con deuda: 600 de 1.190 en efectivo.
  const venta = await api<{ id: string, estado: string }>(request, 'post', '/ventas', {
    token: escenario.tokenVendedor,
    data: {
      lineas: [{ itemId: producto.id, cantidad: '1' }],
      pagos: [{ metodoPagoId: EFECTIVO, monto: ABONO_INICIAL }],
    },
  })
  expect(venta.estado).toBe('pagada_parcial')

  await entrarComo(page, VENDEDOR.email, VENDEDOR.password)
  await page.goto(`/ventas?venta=${venta.id}`)
  const detalle = page.getByRole('dialog').filter({ hasText: 'Detalle de venta' })

  // Antes: debe 590 y se puede registrar un pago.
  await expect(valorDeFila(detalle, 'Saldo pendiente')).toContainText(DEUDA)
  await expect(detalle.getByRole('button', { name: 'Registrar pago' })).toBeVisible()

  // El encargado perdona toda la deuda: "No vuelve plata" por los 590.
  await api(request, 'post', `/ventas/${venta.id}/notas-credito`, {
    token: escenario.tokenAdmin,
    data: {
      monto: `${DEUDA}.0000`,
      comentario: 'Perdón de la deuda (e2e)',
      devolucion: { sinPlata: true },
    },
  })

  // La cajera vuelve a abrir la venta: ya no debe nada, está pagada, y el botón no está.
  await page.goto('/ventas')
  await page.goto(`/ventas?venta=${venta.id}`)
  const detalleDespues = page.getByRole('dialog').filter({ hasText: 'Detalle de venta' })
  await expect(detalleDespues.getByText('Pagada', { exact: true })).toBeVisible()
  await expect(valorDeFila(detalleDespues, 'Saldo pendiente')).toContainText('$0')
  await expect(detalleDespues.getByRole('button', { name: 'Registrar pago' })).toHaveCount(0)

  // Y el backend lo rechaza igual: el botón escondido no es la única defensa.
  const abono = await request.post(`${API}/pagos`, {
    headers: {
      Authorization: `Bearer ${escenario.tokenVendedor}`,
      'Idempotency-Key': crypto.randomUUID(),
    },
    data: { ventaId: venta.id, pagos: [{ metodoPagoId: EFECTIVO, monto: '400' }] },
  })
  expect(abono.status()).toBe(400)

  // La caja de la cajera cuadra con lo cobrado de verdad (600): no entró ningún abono.
  expect(await cerrarCaja(request, escenario.tokenVendedor!, escenario.cajaId!, EFECTIVO_COBRADO)).toBe('cerrada')
  escenario.cajaId = undefined
})
