import { test, expect } from '../support/sin-qz-tray'
import {
  abrirCaja,
  api,
  API,
  cerrarCaja,
  crearProducto,
  limpiarItems,
  tokenDe,
  TENANTS,
} from '../support/api'
import { entrarComo, valorDeFila } from '../support/ui'

/**
 * Una venta PENDIENTE admite una nota de crédito "No vuelve plata" — Tarea 15
 * del frente de emisión (`docs/PRODUCTO.md` § 10).
 *
 * La escena del dueño: una distribuidora factura en otro sistema
 * (`facturador = 'externo'`), vende $119.000 a 30 días y el cliente devuelve todo.
 * Anular no sirve (el documento ya está hecho) y antes la nota tampoco, porque
 * exigía una venta pagada: callejón sin salida. Ahora la venta pendiente ofrece
 * "Nota de crédito", y el modal solo "No vuelve plata" —no hay pago por el que
 * vuelva plata—. La deuda baja a 0 y la venta queda pagada.
 *
 * **Corre como `vendedor@paris.cl` + un rol propio con `Ventas:Nota de crédito`**,
 * no como admin: con admin el botón aparecería por cualquier permiso y no se vería
 * que la pantalla pide el de nota de crédito (el `Vendedor` del seed no lo tiene).
 * El rol se crea por API, se suma al vendedor y se da de baja al terminar. La venta
 * la hace la propia cajera (la ve por ser de su caja), y el facturador del tenant se
 * pone en `externo` y se devuelve a `sistema` en el `afterEach`.
 *
 * El spec de API gemelo es `backend/test/venta-correcciones.e2e-spec.ts`
 * ("una venta pendiente admite solo la nota «no vuelve plata»").
 */

const PRECIO_BASE = '100000'
/** 100.000 + 19% de IVA. */
const TOTAL_VENTA = '$119.000'

const VENDEDOR = { email: 'vendedor@paris.cl', password: 'admin' }

test.use({ storageState: { cookies: [], origins: [] } })

interface ModuloDisponible {
  moduloTenantId: string
  nombre: string
  permisos: { moduloAppPermisoId: string, permisoNombre: string }[]
}

let escenario: {
  tokenAdmin?: string
  tokenVendedor?: string
  cajaId?: string
  itemId?: string
  rolId?: string
  vendedorId?: string
} = {}

test.beforeEach(async ({ request }) => {
  escenario = {}
  const tokenAdmin = await tokenDe(request, TENANTS.restaurante)
  escenario.tokenAdmin = tokenAdmin
  const auth = { Authorization: `Bearer ${tokenAdmin}` }

  // Un rol propio con SOLO `Ventas:Nota de crédito`, sumado al vendedor: el resto de
  // lo que necesita (leer, crear, su caja) ya lo trae su rol `Vendedor`.
  const modulos = await api<ModuloDisponible[]>(request, 'get', '/roles/modulos-disponibles', {
    token: tokenAdmin,
  })
  const ventas = modulos.find(m => m.nombre === 'Ventas')!
  const notaCredito = ventas.permisos.find(p => p.permisoNombre === 'Nota de crédito')!
  const rol = await api<{ id: string }>(request, 'post', '/roles', {
    token: tokenAdmin,
    data: { nombre: `E2E NC pendiente ${Date.now()}` },
  })
  escenario.rolId = rol.id
  const permisos = await request.put(
    `${API}/roles/${rol.id}/modules/${ventas.moduloTenantId}/permissions`,
    { headers: auth, data: { moduloAppPermisoIds: [notaCredito.moduloAppPermisoId] } },
  )
  expect(permisos.ok()).toBe(true)
  const miembros = await api<{ usuarioId: string, correo: string }[]>(
    request,
    'get',
    '/tenants/members',
    { token: tokenAdmin },
  )
  escenario.vendedorId = miembros.find(m => m.correo === VENDEDOR.email)!.usuarioId
  await api(request, 'post', `/roles/${rol.id}/users`, {
    token: tokenAdmin,
    data: { usuarioId: escenario.vendedorId },
  })

  await api(request, 'patch', '/tenants/me', {
    token: tokenAdmin,
    data: { facturador: 'externo' },
  })

  escenario.tokenVendedor = await tokenDe(request, TENANTS.restaurante, VENDEDOR)
  escenario.cajaId = await abrirCaja(request, escenario.tokenVendedor)
})

test.afterEach(async ({ request }) => {
  const { tokenAdmin, tokenVendedor, cajaId, itemId, rolId, vendedorId } = escenario
  if (tokenVendedor && cajaId) await cerrarCaja(request, tokenVendedor, cajaId, '0')
  if (!tokenAdmin) return
  const auth = { Authorization: `Bearer ${tokenAdmin}` }
  await api(request, 'patch', '/tenants/me', {
    token: tokenAdmin,
    data: { facturador: 'sistema' },
  })
  if (rolId && vendedorId) {
    await request.delete(`${API}/roles/${rolId}/users/${vendedorId}`, { headers: auth })
  }
  if (rolId) await request.delete(`${API}/roles/${rolId}`, { headers: auth })
  if (itemId) await limpiarItems(request, tokenAdmin, [itemId])
})

test('la cajera con permiso de nota de crédito devuelve toda una venta pendiente "sin plata" y la deuda queda en 0', async ({
  page,
  request,
}) => {
  const producto = await crearProducto(request, escenario.tokenAdmin!, {
    nombre: `NC pendiente E2E ${Date.now()}`,
    precioBase: PRECIO_BASE,
  })
  escenario.itemId = producto.id

  // Vendida a 30 días: sin pagos, queda pendiente con su documento externo.
  const venta = await api<{ id: string, estado: string, totalFinal: string }>(
    request,
    'post',
    '/ventas',
    {
      token: escenario.tokenVendedor,
      data: { lineas: [{ itemId: producto.id, cantidad: '1' }] },
    },
  )
  expect(venta.estado).toBe('pendiente')
  expect(venta.totalFinal).toBe('119000.0000')

  await entrarComo(page, VENDEDOR.email, VENDEDOR.password)
  await page.goto(`/ventas?venta=${venta.id}`)
  const detalle = page.getByRole('dialog').filter({ hasText: 'Detalle de venta' })
  await expect(valorDeFila(detalle, 'Saldo pendiente')).toContainText(TOTAL_VENTA)

  // La pendiente ofrece la nota, y el modal solo "No vuelve plata" (viene elegida:
  // no hay otra forma de devolver, y no hay pago por el que vuelva plata).
  await detalle.getByRole('button', { name: 'Nota de crédito' }).click()
  const modal = page.getByRole('dialog').filter({ hasText: 'Nota de crédito' })
  await expect(valorDeFila(modal, 'Disponible para nota de crédito')).toHaveText(TOTAL_VENTA)
  await expect(modal.getByRole('radio')).toHaveCount(1)
  await expect(modal.getByRole('radio', { name: /No vuelve plata/ })).toBeChecked()

  const pedido = page.waitForRequest(
    r => r.url().includes('/notas-credito') && r.method() === 'POST',
  )
  const respuesta = page.waitForResponse(
    r => r.url().includes('/notas-credito') && r.request().method() === 'POST',
  )
  await modal.getByRole('button', { name: 'Generar nota de crédito' }).click()
  // El cliente manda "sin plata": nunca un pago ni el documento.
  const cuerpo = (await pedido).postDataJSON() as Record<string, unknown>
  expect(cuerpo.devolucion).toEqual({ sinPlata: true })
  expect((await respuesta).status()).toBe(201)

  // La deuda bajó a 0 y la venta quedó pagada; sin "Registrar pago".
  await page.goto('/ventas')
  await page.goto(`/ventas?venta=${venta.id}`)
  const despues = page.getByRole('dialog').filter({ hasText: 'Detalle de venta' })
  await expect(despues.getByText('Pagada', { exact: true })).toBeVisible()
  await expect(valorDeFila(despues, 'Saldo pendiente')).toContainText('$0')
  await expect(despues.getByRole('button', { name: 'Registrar pago' })).toHaveCount(0)
})
