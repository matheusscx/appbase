import { test, expect } from '../support/sin-qz-tray'
import { API, api, tokenDe, limpiarItems, TENANTS, CLP } from '../support/api'
import { elegirEnSelector, entrarComo } from '../support/ui'

/**
 * "Cambiar unidades" en una línea del salón ya despachada, en un navegador real:
 * las unidades que la línea tiene están en la mesa, así que el selector las
 * muestra marcadas y no deja desmarcarlas; se pueden agregar otras (owner,
 * 2026-10-03, `docs/features/salones-mesas.md`, fila de `actualizarLinea`).
 * Antes se podía cambiar el celular despachado por otro, y el que estaba en la
 * mesa volvía a ofrecerse en el POS.
 *
 * ⚠️ **Las precondiciones se montan por API** (molde de `anular-plato.spec.ts`):
 * garzón propio, salón, mesa, impresora y categoría de cocina —sin impresora el
 * claim no avanza `cantidad_enviada`—, el producto con dos celulares, la cuenta
 * con el usado pedido y despachado. Lo que se ejercita por pantalla es el
 * selector sobre la línea despachada.
 *
 * **Corre como `encargado.salon@paris.cl`** (no admin), igual que
 * `anular-plato.spec.ts`: el selector pide `Items:Leer`, y con admin un 403 de
 * un permiso ajeno quedaría tapado.
 */

test.use({ storageState: { cookies: [], origins: [] } })

const ENCARGADO = { email: 'encargado.salon@paris.cl', password: 'admin' }

/**
 * Se llena de a poco a propósito: si el montaje falla a la mitad, el `afterAll`
 * tiene que poder limpiar lo que sí llegó a existir.
 */
const escenario: {
  token?: string
  garzon?: { id: string, pin: string }
  salonNombre?: string
  mesaId?: string
  itemId?: string
  impresoraId?: string
  categoriaId?: string
  cuentaId?: string
  cuentaNumero?: number
  usado?: { id: string, serie: string }
  nuevo?: { id: string, serie: string }
} = {}

test.beforeAll(async ({ request }) => {
  const token = await tokenDe(request, TENANTS.restaurante)
  escenario.token = token
  const marca = Date.now()

  const garzon = await api<{ id: string, pin: string }>(request, 'post', '/garzones', {
    token,
    data: { nombre: `Garzón serie despachada E2E ${marca}` },
  })
  escenario.garzon = garzon
  const turnos = await api<{ id: string, activo: boolean }[]>(request, 'get', '/turnos', { token })
  const turnoId = turnos.find(t => t.activo)?.id
  if (!turnoId) throw new Error('El seed no tiene ningún turno activo')
  await api(request, 'post', '/sesiones-garzon/iniciar', {
    token,
    data: { garzonId: garzon.id, pin: garzon.pin, turnoId },
  })

  escenario.salonNombre = `Salón serie despachada E2E ${marca}`
  const salon = await api<{ id: string }>(request, 'post', '/salones', {
    token,
    data: { nombre: escenario.salonNombre },
  })
  // Al centro del plano: en (0,0) la mesa queda recortada y el click cae afuera.
  const mesa = await api<{ id: string }>(request, 'post', `/salones/${salon.id}/mesas`, {
    token,
    data: { nombre: `Mesa ${marca}`, posX: 0.5, posY: 0.5 },
  })
  escenario.mesaId = mesa.id

  const impresora = await api<{ id: string }>(request, 'post', '/impresoras', {
    token,
    data: {
      nombre: `Cocina serie E2E ${marca}`,
      rol: 'comanda',
      tipoConexion: 'sistema',
      nombreCola: `cola-serie-e2e-${marca}`,
    },
  })
  escenario.impresoraId = impresora.id
  const categoria = await api<{ id: string }>(request, 'post', '/categorias', {
    token,
    data: { nombre: `Cocina serie E2E ${marca}`, impresoraId: impresora.id },
  })
  escenario.categoriaId = categoria.id

  const item = await api<{ id: string }>(request, 'post', '/items', {
    token,
    data: {
      nombre: `Celular despachado E2E ${marca}`,
      tipo: 'producto',
      precioBase: '10000',
      monedaId: CLP,
      unidadMedida: 'unidad',
      modoInventario: 'serie',
      categoriaId: categoria.id,
    },
  })
  escenario.itemId = item.id
  const ubicaciones = await api<{ id: string, tipo: string }[]>(request, 'get', '/ubicaciones', { token })
  const local = ubicaciones.find(u => u.tipo === 'local')!
  await api(request, 'patch', `/items/${item.id}/stock`, {
    token,
    data: {
      tipo: 'entrada',
      motivo: 'inventario_inicial',
      ubicacionId: local.id,
      cantidad: '2',
      series: [
        { serie: `IMEI-USADO-${marca}`, condicion: 'usado' },
        { serie: `IMEI-NUEVO-${marca}`, condicion: 'nuevo' },
      ],
    },
  })
  const unidades = await api<{ id: string, serie: string, condicion: string }[]>(
    request, 'get', `/items/${item.id}/unidades`, { token },
  )
  escenario.usado = unidades.find(u => u.condicion === 'usado')!
  escenario.nuevo = unidades.find(u => u.condicion === 'nuevo')!

  const cuenta = await api<{ id: string, numero: number }>(request, 'post', `/mesas/${mesa.id}/cuentas`, {
    token,
    data: { garzonId: garzon.id, pin: garzon.pin },
  })
  escenario.cuentaId = cuenta.id
  escenario.cuentaNumero = cuenta.numero
  await api(request, 'post', `/cuentas/${cuenta.id}/lineas`, {
    token,
    data: { itemId: item.id, cantidad: '1', unidadIds: [escenario.usado.id] },
  })
  await api(request, 'post', `/cuentas/${cuenta.id}/comanda/reclamar`, { token, data: {} })
})

test.afterAll(async ({ request }) => {
  const { token, garzon, itemId, categoriaId, impresoraId, cuentaId } = escenario
  if (!token) return
  const auth = { Authorization: `Bearer ${token}` }

  // La cuenta queda con algo despachado y el ítem no se puede dar de baja con una
  // cuenta abierta que lo tenga. "No elaborado" cancela aunque la línea quede
  // despachada a medias (merma o cortesía pedirían anular primero), y libera las
  // unidades sin mover stock.
  if (cuentaId) {
    const motivos = await request.get(`${API}/motivos-baja?soloActivas=true`, { headers: auth })
    const motivoId = motivos.ok()
      ? ((await motivos.json()) as { id: string, tipo: string }[]).find(m => m.tipo === 'no_elaborado')?.id
      : undefined
    const res = motivoId
      ? await request.post(`${API}/cuentas/${cuentaId}/cancelar-con-motivo`, {
          headers: auth,
          data: { motivoBajaId: motivoId },
        })
      : undefined
    if (!res?.ok()) {
      console.warn(
        `[e2e] no se pudo cancelar la cuenta ${cuentaId}: ${res?.status()} ${res ? await res.text() : 'sin motivo "no elaborado" activo'}`,
      )
    }
  }

  if (itemId) await limpiarItems(request, token, [itemId])
  if (categoriaId) {
    const res = await request.delete(`${API}/categorias/${categoriaId}`, { headers: auth })
    if (!res.ok()) {
      console.warn(`[e2e] no se pudo dar de baja la categoría ${categoriaId}: ${res.status()} ${await res.text()}`)
    }
  }
  if (impresoraId) {
    const res = await request.delete(`${API}/impresoras/${impresoraId}`, { headers: auth })
    if (!res.ok()) {
      console.warn(`[e2e] no se pudo dar de baja la impresora ${impresoraId}: ${res.status()} ${await res.text()}`)
    }
  }
  if (garzon) {
    const res = await request.post(`${API}/sesiones-garzon/cerrar`, {
      headers: auth,
      data: { garzonId: garzon.id, pin: garzon.pin },
    })
    if (!res.ok()) {
      console.warn(`[e2e] no se pudo cerrar la sesión del garzón ${garzon.id}: ${res.status()} ${await res.text()}`)
    }
  }
})

test('en una línea despachada el celular que está en la mesa no se desmarca, y se puede agregar otro', async ({
  page,
  request,
}) => {
  const usado = escenario.usado!
  const nuevo = escenario.nuevo!

  await entrarComo(page, ENCARGADO.email, ENCARGADO.password)
  await page.goto('/salones')
  await elegirEnSelector(page, escenario.salonNombre!)
  await page.locator(`[data-qa="mesa-${escenario.mesaId}"]`).click()
  await page.getByText(`Cuenta ${escenario.cuentaNumero}`, { exact: true }).click()

  await page.getByRole('button', { name: 'Cambiar unidades' }).click()
  const selector = page.getByRole('dialog').filter({ hasText: 'Elegir unidades' })
  await expect(selector).toBeVisible()
  await expect(selector.locator('[data-qa="unidades-fijas-aviso"]')).toContainText('anulala')

  // El usado está en la mesa: marcado y sin poder desmarcarse.
  const checkUsado = selector.locator(`[data-qa="unidad-fila"][data-serie="${usado.serie}"]`).getByRole('checkbox')
  await expect(checkUsado).toBeChecked()
  await expect(checkUsado).toBeDisabled()

  // Agregar el nuevo sí.
  const respuesta = page.waitForResponse(
    r => r.url().includes(`/lineas/`) && r.request().method() === 'PATCH',
  )
  await selector.locator(`[data-qa="unidad-fila"][data-serie="${nuevo.serie}"]`).getByRole('checkbox').click()
  await selector.getByRole('button', { name: 'Confirmar (2)' }).click()
  expect((await respuesta).status()).toBe(200)
  await expect(selector).toBeHidden()

  const series = page.locator('[data-qa="series-linea"]')
  await expect(series).toContainText(usado.serie)
  await expect(series).toContainText(nuevo.serie)

  // ⚠️ Lo que no es de cliente: la línea guardó las dos.
  const cuentas = await api<{ id: string, lineas: { unidades: { id: string }[] }[] }[]>(
    request, 'get', `/mesas/${escenario.mesaId}/cuentas`, { token: escenario.token },
  )
  const linea = cuentas.find(c => c.id === escenario.cuentaId)!.lineas[0]!
  expect(linea.unidades.map(u => u.id).sort()).toEqual([usado.id, nuevo.id].sort())
})
