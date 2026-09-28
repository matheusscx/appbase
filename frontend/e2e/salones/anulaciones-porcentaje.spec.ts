import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { API, api, tokenDe, limpiarItems, abrirCaja, cerrarCaja, TENANTS, CLP } from '../support/api'

/**
 * La columna "% de lo pedido" en `/salones/anulaciones` — Tarea 3 de
 * `2026-09-27-porcentaje-anulaciones-por-garzon.md`. El backend (tareas 1 y 2)
 * ya está probado por `backend/test/salones-anulaciones-porcentaje.e2e-spec.ts`;
 * lo que este spec cubre es lo que solo se puede romper del lado del navegador:
 * que la pantalla lea `porGarzon[i].porcentaje` con `formatPorcentaje` (no el
 * string crudo, no `NaN%`) y que la tabla no rompa el layout a ancho de
 * teléfono (375 px).
 *
 * **Como encargado del salón** (`encargado.salon@paris.cl`: `Salones:Ver
 * todas`, no admin) — con admin el 403 de un permiso ajeno queda tapado.
 *
 * ⚠️ **Por qué el pedido/despacho/anulación van por API y no por clic, a
 * diferencia de `anular-plato.spec.ts`.** Se intentó primero por UI, con
 * `encargado.salon` logueado: `GET /api/items` (el catálogo de
 * `VentasCatalogoGrid`) le devuelve 403 — el rol sembrado `Salones ·
 * Encargado` tiene `Leer/Crear/Actualizar/Operar/Anular/Ver todas` de
 * `Salones`, pero ningún permiso de `Items` (medido: `metodos-pago` y
 * `salones/operacion` sí le resuelven 200 con ese mismo token; `items` no).
 * Con `Operar` agregado específicamente para que este rol "llegue a la mesa"
 * (docblock de `seedRolEncargadoSalon`), no poder ver el catálogo lo deja sin
 * forma de cargar un pedido — un hueco del seed, no de esta pantalla, y
 * `CLAUDE.md` prohíbe tocar el backend/seeder sin pedir permiso primero. Se
 * reporta aparte (ver el informe de la tarea) y este spec arma la escena por
 * API, como ya hacen `cuenta-hasta-cobro.spec.ts` y `anular-plato.spec.ts`
 * con el garzón, el turno, la caja o el ítem: son precondiciones, no el flujo
 * bajo prueba. Lo que SÍ se ejercita por navegador, con el rol real, es lo
 * que la Tarea 3 agrega: la pantalla del reporte.
 *
 * Escena (mismos números que el test 2 del e2e de backend): 2 unidades
 * pedidas, 1 anulada como cortesía → pedido = 2, anulado = 1 → **50,00%**,
 * sin depender del precio exacto del ítem (la razón es la misma con o sin
 * IVA, porque numerador y denominador usan el mismo `precio_unitario`
 * congelado).
 */

test.use({ storageState: { cookies: [], origins: [] } })

const ENCARGADO = { email: 'encargado.salon@paris.cl', password: 'admin' }
const PRECIO_BASE = '1000'
const PORCENTAJE_ESPERADO = '50,00%'

interface CuentaLineaDetalle { id: string, itemId: string, cantidad: string, cantidadEnviada: string }
interface CuentaDetalle { id: string, estado: string, lineas: CuentaLineaDetalle[] }
interface MotivoBaja { id: string, tipo: string }

const escenario: {
  token?: string
  garzon?: { id: string, pin: string, nombre: string }
  salonNombre?: string
  mesaId?: string
  itemNombre?: string
  itemId?: string
  impresoraId?: string
  categoriaId?: string
  cuentaId?: string
  cajaId?: string
} = {}

test.beforeAll(async ({ request }) => {
  // Precondiciones por API, como admin: garzón, turno, salón, mesa, ruteo a
  // cocina, ítem, pedido, despacho, anulación y cierre — ver el docblock del
  // archivo sobre por qué esta escena no se arma clicando.
  const token = await tokenDe(request, TENANTS.restaurante)
  escenario.token = token
  const marca = Date.now()

  const nombreGarzon = `Garzón % anulaciones E2E ${marca}`
  const garzon = await api<{ id: string, pin: string }>(request, 'post', '/garzones', {
    token,
    data: { nombre: nombreGarzon },
  })
  escenario.garzon = { ...garzon, nombre: nombreGarzon }

  const turnos = await api<{ id: string, activo: boolean }[]>(request, 'get', '/turnos', { token })
  const turnoId = turnos.find(t => t.activo)?.id
  if (!turnoId) throw new Error('El seed no tiene ningún turno activo')
  await api(request, 'post', '/sesiones-garzon/iniciar', {
    token,
    data: { garzonId: garzon.id, pin: garzon.pin, turnoId },
  })

  escenario.salonNombre = `Salón % anulaciones E2E ${marca}`
  const salon = await api<{ id: string }>(request, 'post', '/salones', {
    token,
    data: { nombre: escenario.salonNombre },
  })
  const mesa = await api<{ id: string }>(request, 'post', `/salones/${salon.id}/mesas`, {
    token,
    data: { nombre: `Mesa ${marca}`, posX: 0.5, posY: 0.5 },
  })
  escenario.mesaId = mesa.id

  // Ruteo a cocina: sin impresora, `reclamarComanda` nunca avanza
  // `cantidadEnviada` y el "despachado" que la anulación exige no existe.
  const impresora = await api<{ id: string }>(request, 'post', '/impresoras', {
    token,
    data: {
      nombre: `Cocina % anulaciones E2E ${marca}`,
      rol: 'comanda',
      tipoConexion: 'sistema',
      nombreCola: `cola-pct-anulaciones-e2e-${marca}`,
    },
  })
  escenario.impresoraId = impresora.id
  const categoria = await api<{ id: string }>(request, 'post', '/categorias', {
    token,
    data: { nombre: `Cocina % anulaciones E2E ${marca}`, impresoraId: impresora.id },
  })
  escenario.categoriaId = categoria.id

  escenario.itemNombre = `Plato % anulaciones E2E ${marca}`
  const item = await api<{ id: string }>(request, 'post', '/items', {
    token,
    data: {
      nombre: escenario.itemNombre,
      tipo: 'producto',
      precioBase: PRECIO_BASE,
      monedaId: CLP,
      unidadMedida: 'unidad',
      stock: '10',
      costo: '400',
      categoriaId: categoria.id,
    },
  })
  escenario.itemId = item.id

  // Pedir 2 unidades, despachar, anular 1 como cortesía, cerrar — mismos
  // pasos y misma razón (pedido 2, anulado 1 → 50%) que el test 2 de
  // `backend/test/salones-anulaciones-porcentaje.e2e-spec.ts`.
  const cuenta = await api<CuentaDetalle>(request, 'post', `/mesas/${mesa.id}/cuentas`, {
    token,
    data: { garzonId: garzon.id, pin: garzon.pin },
  })
  escenario.cuentaId = cuenta.id

  const cuentaConLinea = await api<CuentaDetalle>(request, 'post', `/cuentas/${cuenta.id}/lineas`, {
    token,
    data: { itemId: item.id, cantidad: '2' },
  })
  const lineaId = cuentaConLinea.lineas.find(l => l.itemId === item.id)!.id

  await api(request, 'post', `/cuentas/${cuenta.id}/comanda/reclamar`, { token, data: {} })

  const motivos = await api<MotivoBaja[]>(request, 'get', '/motivos-baja', { token })
  const motivoCortesiaId = motivos.find(m => m.tipo === 'cortesia')?.id
  if (!motivoCortesiaId) throw new Error('El seed no tiene ningún motivo de baja tipo cortesía')
  await api<CuentaDetalle>(request, 'post', `/cuentas/${cuenta.id}/lineas/${lineaId}/anular`, {
    token,
    data: { cantidad: '1', motivoBajaId: motivoCortesiaId },
  })

  // Cerrar una cuenta genera una venta `canal='fisico'`, que exige caja
  // abierta del usuario que cobra — acá el mismo admin. Caja propia del spec
  // (mismo criterio que `cuenta-hasta-cobro.spec.ts`), cerrada en `afterAll`.
  escenario.cajaId = await abrirCaja(request, token)

  const cierre = await request.post(`${API}/cuentas/${cuenta.id}/cerrar`, {
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() },
    data: { garzonId: garzon.id, pin: garzon.pin, pagos: [] },
  })
  if (!cierre.ok()) {
    throw new Error(`POST cerrar → ${cierre.status()}: ${await cierre.text()}`)
  }
})

test.afterAll(async ({ request }) => {
  const { token, garzon, itemId, categoriaId, impresoraId, cajaId } = escenario
  if (!token) return
  const auth = { Authorization: `Bearer ${token}` }

  // La cuenta ya quedó cerrada por el `beforeAll` (con `ventaId`): nada que
  // cancelar. El salón y la mesa quedan (viven en su propia lista, filtrada
  // por nombre exacto — mismo criterio que el resto de `frontend/e2e/salones/`).
  // La caja sí se cierra: sin pago (`pagos: []`), lo que el servidor calculó
  // que corresponde al cajón es $0.
  if (cajaId) await cerrarCaja(request, token, cajaId, '0')

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

/** Login por pantalla, como el encargado del salón. Un solo tenant: entra directo. */
async function entrarComoEncargado(page: Page) {
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.getByPlaceholder('tu@email.com').fill(ENCARGADO.email)
  await page.locator('input[type="password"]').first().fill(ENCARGADO.password)
  const submit = page.locator('button[type="submit"]').first()
  await expect(submit).toBeEnabled()
  await submit.click()
  await page.waitForURL(url => url.pathname === '/')
}

test('@smoke la fila del garzón en "Por garzón" muestra el % de lo pedido, y a 375 px no rompe el layout', async ({ page }) => {
  const garzon = escenario.garzon!

  await entrarComoEncargado(page)

  await page.goto('/salones/anulaciones')
  await expect(page.getByText('% de lo pedido')).toBeVisible()

  // Acotado a la tabla "Por garzón": el garzón del spec también aparece en el
  // detalle de abajo (una fila por anulación), y un `tbody tr` sin acotar
  // matchea las dos — la tabla del resumen es la PRIMERA de la pantalla.
  const tablaPorGarzon = page.locator('table').first()
  const filaGarzon = tablaPorGarzon.locator('tbody tr', { hasText: garzon.nombre })
  await expect(filaGarzon).toBeVisible()
  await expect(filaGarzon).toContainText(PORCENTAJE_ESPERADO)

  // A ancho de teléfono, la tabla no rompe el layout: sigue mostrando la fila
  // y el documento no scrollea horizontal (el scroll propio de la tabla, si
  // lo hay, queda ADENTRO de su contenedor).
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(filaGarzon).toBeVisible()
  await expect(filaGarzon).toContainText(PORCENTAJE_ESPERADO)
  const overflowHorizontal = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  expect(overflowHorizontal, 'la página no debería scrollear horizontalmente a 375 px').toBe(false)
})
