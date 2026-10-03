import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import {
  API, api, crearProducto, limpiarItems, tokenDe, TENANTS, abrirCaja, cerrarCaja,
} from '../support/api'
import { elegirEnSelector, entrarComo } from '../support/ui'

/**
 * Compras — la deuda con el proveedor y sus pagos (spec
 * `2026-09-28-compras-deuda-proveedor-design.md` § 12), **como el dueño que
 * paga** (`compras.paga@paris.cl`: Compras Leer/Crear/Actualizar + Pagar +
 * MiCaja).
 *
 * Cubre lo que solo se puede romper del lado del navegador: que "¿la
 * pagaste ya?" arme el pago correcto en el MISMO gesto que confirmar, que el
 * efectivo salga de verdad de la caja física del que paga, y que el reparto
 * de "Por pagar" (la propuesta de `useCompras().proponerReparto`) llegue
 * completo a `POST /compras/pagos`. Las cuentas del servidor (fondeo,
 * recorte, locks) ya están en `backend/test/compras.e2e-spec.ts`.
 *
 * `workers: 1` (playwright.config.ts): los dos tests corren en serie, así
 * que abrir y cerrar la caja de este archivo no compite con otro spec.
 *
 * ⚠️ **El cierre de la caja NO puede depender del contexto del test que la
 * abrió.** Medido (fix round 1): si el test que abre y paga revienta a mitad
 * de camino —un timeout, por ejemplo—, Playwright puede dar de baja su
 * `request`/`page` ANTES de que el `finally` corra, y `cerrarCaja` explota con
 * `Request context disposed` en vez de cerrar nada: la caja queda abierta, y
 * el tenant del seed tiene un solo cajón físico — la corrida siguiente (de
 * este archivo o de cualquier otro que abra caja) no puede ni abrir la suya.
 * Molde: `salones/boleta-al-cobrar.spec.ts` (`beforeAll`/`afterAll` con SU
 * PROPIO `request`, que Playwright arma aparte para cada hook — no es el
 * mismo objeto que el de un test particular, así que un test roto no se lo
 * lleva puesto). La red de seguridad vive en `afterAll`; el test que sí llega
 * al final cierra la caja como parte de su propia aserción (spec § 5.2 —
 * "el efectivo salió de verdad de ESTA caja") y avisa al `afterAll` que ya no
 * hay nada que cerrar.
 */

const PAGA = { email: 'compras.paga@paris.cl', password: 'admin' }

let adminToken: string
let pagaToken: string
let itemIds: string[] = []
let proveedorIds: string[] = []
/** La caja que un test dejó abierta, si `afterAll` tiene que cerrarla. */
let cajaAbiertaId: string | undefined

test.use({ storageState: { cookies: [], origins: [] } })

/**
 * Los tokens se piden UNA vez para todo el archivo, con el `request` propio
 * de `beforeAll` — no el de un test, que puede no llegar a existir si el
 * archivo entero se aborta antes.
 */
test.beforeAll(async ({ request }) => {
  adminToken = await tokenDe(request, TENANTS.restaurante)
  pagaToken = await tokenComo(request, PAGA.email, PAGA.password, TENANTS.restaurante)
})

test.beforeEach(() => {
  itemIds = []
  proveedorIds = []
})

test.afterEach(async ({ request }) => {
  await limpiarItems(request, adminToken, itemIds)
  for (const id of proveedorIds) {
    const res = await request.delete(`${API}/terceros/${id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    if (!res.ok()) {
      console.warn(`[e2e] no se pudo dar de baja el proveedor: ${res.status()} ${await res.text()}`)
    }
  }
})

/**
 * Red de seguridad de la caja: corre siempre, con un `request` que Playwright
 * arma aparte para este hook (no el de ningún test), así que un test que
 * reventó a mitad de camino —y se llevó puesto SU `request`— no lo afecta.
 * `cerrarCaja` ya es tolerante (spec de `support/api.ts`): si el conteo no
 * cuadra fuerza el cierre igual con un motivo, y si la caja ya está cerrada
 * es un no-op — por eso el monto contado acá es indistinto, nunca se afirma
 * sobre él.
 */
test.afterAll(async ({ request }) => {
  if (!cajaAbiertaId) return
  await cerrarCaja(request, pagaToken, cajaAbiertaId, '0.0000')
  cajaAbiertaId = undefined
})

/** Token con un usuario y contraseña propios (no el admin del seed). */
async function tokenComo(request: APIRequestContext, email: string, password: string, tenantId: string) {
  const inicial = await api<{ access_token: string }>(request, 'post', '/auth/login', {
    data: { email, password },
  })
  const sesion = await api<{ access_token: string }>(request, 'post', '/auth/switch-tenant', {
    token: inicial.access_token, data: { tenantId },
  })
  return sesion.access_token
}

async function crearProveedor(request: APIRequestContext, sello: number, nombre?: string) {
  const proveedor = await api<{ id: string }>(request, 'post', '/terceros', {
    token: adminToken,
    data: { tipo: 'proveedor', nombre: nombre ?? `Proveedor e2e deuda ${sello}` },
  })
  proveedorIds.push(proveedor.id)
  return proveedor
}

async function ubicacionLocal(request: APIRequestContext) {
  const ubicaciones = await api<{ id: string, tipo: string, nombre: string }[]>(
    request, 'get', '/ubicaciones', { token: adminToken },
  )
  return ubicaciones.find(u => u.tipo === 'local')!
}

async function productoVacio(request: APIRequestContext, nombre: string) {
  const producto = await crearProducto(request, adminToken, { nombre, precioBase: '3000', stock: '0' })
  itemIds.push(producto.id)
  return producto
}

/** Una compra confirmada de una línea, con documento "Sin documento" (total = suma de líneas). */
async function compraConfirmada(
  request: APIRequestContext,
  linea: { itemId: string, cantidad: string, precioUnitario: string },
  ubicacionId: string,
  proveedorId: string,
  fechaDocumento = '2026-09-01',
) {
  const tipos = await api<{ id: string, requiereFolio: boolean }[]>(
    request, 'get', '/compras/tipos-documento', { token: adminToken },
  )
  const borrador = await api<{ id: string }>(request, 'post', '/compras', {
    token: adminToken,
    data: {
      proveedorId,
      tipoDocumentoCompraId: tipos.find(t => !t.requiereFolio)!.id,
      fechaDocumento,
      ubicacionId,
      lineas: [{ unidadCodigo: 'unidad', ...linea }],
    },
  })
  await api(request, 'post', `/compras/${borrador.id}/confirmar`, { token: adminToken })
  return borrador.id
}

/** Fondea la caja abierta de `compras.paga` con una entrada manual, para que
 *  el pago en efectivo tenga de dónde salir (`abrirCaja` la abre en $0). */
async function fondearCaja(request: APIRequestContext, cajaId: string, monto: string) {
  await api(request, 'post', `/caja/${cajaId}/movimientos`, {
    token: pagaToken,
    data: { tipo: 'entrada', concepto: 'Fondeo E2E', monto },
  })
}

/**
 * Elige el medio de pago (`elegirEnSelector` de `support/ui.ts`, por su
 * "Show popup"): se acota a la raíz que da el llamador porque el trigger ya
 * muestra un valor (no un placeholder que lo distinga de otros selectores de
 * la misma pantalla).
 */
async function elegirMedio(raiz: Page | Locator, nombre: string) {
  await elegirEnSelector(raiz, nombre)
}

test('recibir la feria y pagarla al contado en un gesto: el efectivo baja en la caja de quien paga', async ({ page, request }) => {
  const sello = Date.now()
  const proveedor = await crearProveedor(request, sello)
  const local = await ubicacionLocal(request)
  const producto = await productoVacio(request, `Feria e2e ${sello}`)

  const cajaId = await abrirCaja(request, pagaToken)
  // El `afterAll` la cierra si este test no llega al final: no depende de
  // ESTE `request` ni de esta `page`, que pueden no sobrevivir a un timeout.
  cajaAbiertaId = cajaId
  await fondearCaja(request, cajaId, '200000')

  await entrarComo(page, PAGA.email, PAGA.password)
  await page.goto('/compras/nueva', { waitUntil: 'networkidle' })

  await page.getByText('A quién se le compró').click()
  await page.keyboard.type(proveedor.nombre)
  await page.getByRole('option', { name: proveedor.nombre }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)

  // "Sin documento" no pide folio: el sujeto de este test es el pago, no el
  // documento (mismo tipo que usa `compraConfirmada` por API en el otro test).
  await page.getByText('Factura, boleta, sin documento…').click()
  await page.getByRole('option', { name: 'Sin documento', exact: true }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)

  await page.getByText('Local o bodega').click()
  await page.getByRole('option', { name: local.nombre, exact: true }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)

  const linea = page.locator('[data-qa="compra-linea"]').first()
  await linea.getByText('Selecciona un producto').click()
  await page.keyboard.type(producto.nombre)
  await page.getByRole('option', { name: producto.nombre }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await linea.locator('input[data-qa="compra-cantidad"]').fill('10')
  const precio = linea.locator('input[data-qa="compra-precio"]')
  await precio.selectText()
  await precio.pressSequentially('1500')

  await page.locator('[data-qa="compra-guardar"]').click()
  await page.waitForURL(/\/compras\/[0-9a-f-]{36}$/)

  // ── Confirmar y pagar en el mismo gesto ──────────────────────────────
  await page.locator('[data-qa="compra-confirmar"]').click()
  await page.getByText('Sí, la pagué').click()
  await elegirMedio(page.locator('[data-qa="compra-pago-seccion"]'), 'Efectivo')
  await page.locator('[data-qa="compra-confirmar-si"]').click()

  const detalle = page.locator('[data-qa="compra-confirmada"]')
  await expect(detalle).toBeVisible()
  await expect(page.locator('[data-qa="compra-pago"]')).toContainText('Pagada')
  await expect(page.locator('[data-qa="compra-pago"]')).toContainText('$15.000')

  // 200.000 fondeados − 15.000 pagados = 185.000: si el cierre cuadra con ese
  // número, el efectivo salió de verdad de ESTA caja (no de otra, ni de
  // ninguna). Esta es la aserción real, con SU propio `request` (el de este
  // test, todavía vivo porque llegamos hasta acá sin reventar).
  const estado = await cerrarCaja(request, pagaToken, cajaId, '185000.0000')
  expect(estado).toBe('cerrada')
  // Ya cerrada: que el `afterAll` no la vuelva a tocar.
  cajaAbiertaId = undefined
})

test('pagar dos compras de un proveedor desde "Por pagar"', async ({ page, request }) => {
  const sello = Date.now()
  const proveedor = await crearProveedor(request, sello, `Don Pedro e2e ${sello}`)
  const local = await ubicacionLocal(request)
  const producto = await productoVacio(request, `Insumo e2e ${sello}`)

  // Dos compras confirmadas, ya con deuda (armadas por API: la precondición,
  // no el sujeto — igual que `compras-por-pantalla.spec.ts`).
  await compraConfirmada(request, { itemId: producto.id, cantidad: '10', precioUnitario: '12000' }, local.id, proveedor.id, '2026-09-01')
  await compraConfirmada(request, { itemId: producto.id, cantidad: '10', precioUnitario: '8000' }, local.id, proveedor.id, '2026-09-15')

  await entrarComo(page, PAGA.email, PAGA.password)
  await page.goto('/compras/por-pagar', { waitUntil: 'networkidle' })

  const filaProveedor = page.locator('[data-qa="por-pagar-proveedores"] tbody tr').filter({ hasText: proveedor.nombre })
  await expect(filaProveedor).toHaveCount(1)
  await expect(filaProveedor).toContainText('$200.000')
  await filaProveedor.click()

  const detalle = page.locator('[data-qa="por-pagar-detalle"]')
  await expect(detalle).toContainText(proveedor.nombre)
  await expect(detalle.locator('[data-qa="por-pagar-compras"] tbody tr')).toHaveCount(2)

  await page.locator('[data-qa="por-pagar-pagar-abrir"]').click()
  const modal = page.locator('[data-qa="pagar-proveedor-modal"]')
  await expect(modal).toBeVisible()

  const montoInput = modal.locator('input[data-qa="pagar-monto"]')
  await montoInput.selectText()
  await montoInput.pressSequentially('200000')
  await elegirMedio(modal, 'Transferencia bancaria')

  // La propuesta reparte las $200.000 entre las dos compras (decisión 2): sin
  // tocar nada más, "Pagar" ya alcanza para cubrirlas enteras.
  await expect(modal.locator('[data-qa="pagar-sobra"]')).toContainText('$0')
  await page.locator('[data-qa="pagar-enviar"]').click()
  await expect(modal).toBeHidden()

  // El detalle se recargó solo: las dos compras ya no aparecen como abiertas.
  // `CrudTable` dibuja el estado vacío como una fila propia ("Sin compras
  // abiertas."), así que la cuenta de filas nunca llega a 0 — se afirma por
  // el texto, no por `toHaveCount(0)`. Y el `tbody`, no el `[data-qa]` a
  // secas: `CrudTable` pasa `$attrs` (con el `data-qa`) tanto a su `UCard`
  // raíz como, explícito, a `UTable` por dentro — dos elementos con el MISMO
  // atributo, y un `locator` sin acotar más es un strict-mode violation
  // (medido). El `tbody` sí resuelve a uno solo: hay un solo `<tbody>` real,
  // sin importar cuántos ancestros compartan el atributo.
  await expect(page.locator('[data-qa="por-pagar-compras"] tbody')).toContainText('Sin compras abiertas.')
})
