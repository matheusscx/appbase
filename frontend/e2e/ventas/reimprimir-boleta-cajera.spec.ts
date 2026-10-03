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
 * "Reimprimir boleta" para la cajera SIN `Ventas:Anular`, en un navegador real
 * — Tarea 3 de `docs/superpowers/plans/2026-09-30-impresion-quien-opera.md`,
 * gemelo por pantalla del e2e de API `backend/test/boleta-reimpresion.e2e-spec.ts`
 * § *"la cajera con Ventas:Leer (sin Anular): reimprime lo suyo"* (Tarea 2, ya
 * cerrada). Ese archivo prueba el permiso contra la API; este prueba que
 * `VentaDetalleDrawer.vue` (`puedeReimprimir`) no esconde el botón que el
 * backend sí deja pasar.
 *
 * **Corre como `vendedor@paris.cl`** (rol `Vendedor`: `Ventas:Leer/Crear`, SIN
 * `Ventas:Anular` — `seedVendedorPermisosCaja`), no admin: con admin el botón
 * siempre aparece por `Ventas:Anular` y no se vería el camino angosto de
 * `puedeReimprimir` (la venta es de SU caja física, que sigue `abierta`).
 * Login por pantalla, molde de `anulaciones-porcentaje.spec.ts` /
 * `anular-plato.spec.ts` (`test.use({ storageState: ... })` vacío).
 *
 * **La venta se arma por API**, con el propio token de la cajera —igual que
 * `nota-credito.spec.ts`—: cobrarla por POS ya lo cubre `pos.spec.ts`, y el
 * `cajaId` de la venta lo deriva el servidor de la caja ABIERTA del usuario
 * del token (`VentasService.crear` → `cajaService.findActiva`), así que
 * autenticar el POST como la cajera es lo que ata la venta a SU caja sin
 * mandar ningún id a mano (invariante 1: `tenant_id`/dueño salen del token).
 *
 * **No se clickea Cobrar del POS**: entrar directo por `/ventas?venta=<id>`,
 * la misma ruta que usa la propia app para abrir el detalle
 * (`pages/ventas/[id].vue` redirige ahí, ver `nota-credito.spec.ts`).
 *
 * ⚠️ Clickear el botón no es cosmético: `puedeReimprimir` podría mostrarlo y
 * que `GET /ventas/:id/boleta` igual rebote (un botón que siempre 403 no es
 * mejor que ningún botón). La aserción que importa es esa respuesta, no la
 * sola visibilidad.
 *
 * ⚠️ **Dependencia con la sesión en paralelo (VentaDetalleDrawer.vue).** Este
 * test navega DIRECTO a `/ventas?venta=<id>` (`page.goto`, sin pasar antes
 * por `pos.vue`/`mi-caja`/`salones`, que sí cargan `cajaStore.activa`).
 * `puedeReimprimir` lee `cajaStore.activa` pero no lo carga, así que sin que
 * alguna pantalla lo haga, el botón no aparecería aunque la caja esté
 * abierta — mismo hueco que `NotaCreditoModal.vue` ya resuelve llamando
 * `cajaStore.cargarActiva()` al abrirse. Al escribir este test, `pages/ventas/
 * index.vue` (la otra sesión, en paralelo) ya está agregando esa misma
 * llamada en su propio `onMounted` (molde de `salones/index.vue`) — no se
 * toca acá, queda fuera de alcance de la Tarea 4.
 */

const PRECIO_BASE = '1000'
/** Afecto + IVA 19%: 1.000 × 1,19 = 1.190. */
const TOTAL_VENTA_API = '1190.0000'

const VENDEDOR = { email: 'vendedor@paris.cl', password: 'admin' }

test.use({ storageState: { cookies: [], origins: [] } })

let escenario: { tokenAdmin?: string, tokenVendedor?: string, cajaId?: string, itemId?: string } = {}

test.beforeEach(async ({ request }) => {
  escenario = {}
  // `Vendedor` (`seedVendedorPermisosCaja`) solo tiene `Items:Leer`, no
  // `Items:Crear`/`Eliminar`: sembrar y limpiar el producto es del admin,
  // igual que en `pos.spec.ts`/`nota-credito.spec.ts` — lo que corre como la
  // cajera es solo su caja y su venta.
  escenario.tokenAdmin = await tokenDe(request, TENANTS.restaurante)
  escenario.tokenVendedor = await tokenDe(request, TENANTS.restaurante, VENDEDOR)
  escenario.cajaId = await abrirCaja(request, escenario.tokenVendedor)
})

test.afterEach(async ({ request }) => {
  const { tokenAdmin, tokenVendedor, cajaId, itemId } = escenario
  if (tokenVendedor && cajaId) await cerrarCaja(request, tokenVendedor, cajaId, '0')
  if (tokenAdmin && itemId) await limpiarItems(request, tokenAdmin, [itemId])
})

test('la cajera ve "Reimprimir boleta" en una venta de su propia caja abierta, y el clic trae la boleta', async ({
  page,
  request,
}) => {
  const tokenVendedor = escenario.tokenVendedor!

  const producto = await crearProducto(request, escenario.tokenAdmin!, {
    nombre: `Reimpresión cajera E2E ${Date.now()}`,
    precioBase: PRECIO_BASE,
  })
  escenario.itemId = producto.id

  const venta = await api<{ id: string, estado: string }>(request, 'post', '/ventas', {
    token: tokenVendedor,
    data: {
      lineas: [{ itemId: producto.id, cantidad: '1' }],
      pagos: [{ metodoPagoId: EFECTIVO, monto: TOTAL_VENTA_API }],
    },
  })
  expect(venta.estado).toBe('pagada')

  await entrarComo(page, VENDEDOR.email, VENDEDOR.password)
  await page.goto(`/ventas?venta=${venta.id}`)

  const detalle = page.getByRole('dialog').filter({ hasText: 'Detalle de venta' })
  const botonReimprimir = detalle.getByRole('button', { name: 'Reimprimir boleta' })
  await expect(botonReimprimir).toBeVisible()

  const boletaRes = page.waitForResponse(
    res => res.url().includes(`/ventas/${venta.id}/boleta`) && res.request().method() === 'GET',
  )
  await botonReimprimir.click()
  expect((await boletaRes).status()).toBe(200)

  // Y la caja de la cajera la espera: la venta salió de SU cajón, cerrarlo
  // en $1.190 —lo cobrado, nada más— cuadra.
  expect(await cerrarCaja(request, tokenVendedor, escenario.cajaId!, '1190')).toBe('cerrada')
  escenario.cajaId = undefined // Ya cerrada: que el `afterEach` no repita el conteo.
})
