import { test, expect, type Page, type Route } from '@playwright/test'
import {
  abrirCaja,
  API,
  api,
  cerrarCaja,
  crearProducto,
  limpiarItems,
  tokenDe,
  TENANTS,
} from '../support/api'
import { elegirEnSelector, rondaDePin } from '../support/ui'

/**
 * Un cobro que se repite no se registra dos veces
 * (`docs/adr/026-idempotencia-de-cobros.md`).
 *
 * La escena del spec, en un navegador de verdad: el cajero confirma, la venta
 * **entra** en el servidor, pero la respuesta no llega —se cortó internet— y la
 * pantalla dice que no se pudo. El cajero vuelve a confirmar. Tiene que ver el
 * éxito con el aviso de que ya había entrado, y la caja tiene que esperar UN
 * cobro, no dos.
 *
 * ⚠️ **La única forma honesta de fabricar "entró pero no volvió"** es dejar
 * pasar el request al backend y cortarle la respuesta al navegador
 * (`route.fetch()` + `route.abort()`). Un mock que rechace sin llegar al
 * servidor probaría la otra mitad: un reintento de algo que nunca entró.
 *
 * ⚠️ **La prueba de plata no es el toast**, que es de cliente: es que la caja
 * cierre `cerrada` contando lo de UN cobro. Con dos ventas el esperado sería el
 * doble y el conteo no cuadraría.
 */

/** $1.000 afecto + 19% = $1.190; más la propina sugerida del 10% ($119). */
const PRECIO_BASE = '1000'
const EFECTIVO_DE_UN_COBRO = '1309'
const AVISO = 'Este cobro ya había entrado, no se registró dos veces'

let escenario: { token?: string, cajaId?: string, itemIds: string[] } = { itemIds: [] }

test.beforeEach(async ({ request }) => {
  escenario = { itemIds: [] }
  escenario.token = await tokenDe(request, TENANTS.restaurante)
  escenario.cajaId = await abrirCaja(request, escenario.token)
})

test.afterEach(async ({ request }) => {
  const { token, cajaId, itemIds } = escenario
  if (!token) return
  // Red de seguridad del camino de fallo; si el test llegó al final ya cerró.
  if (cajaId) await cerrarCaja(request, token, cajaId, '0')
  await limpiarItems(request, token, itemIds)
})

/**
 * Cuánto se espera al primer `POST` antes de dar el paso por no ocurrido.
 * **Tiene que ser bastante menos que el timeout de test de Playwright** (30 s,
 * el default: `playwright.config.ts` no lo toca). Si el genérico gana la
 * carrera, el mensaje de abajo no se lee nunca y vuelve el diagnóstico que
 * esto viene a arreglar. Diez segundos sobran: el `POST` sale del click que el
 * test acaba de hacer.
 */
const ESPERA_DEL_PRIMER_POST = 10_000

/**
 * El primer request a `patron` llega al backend y el navegador no ve la
 * respuesta. Devuelve el body que el servidor contestó, para comparar con el
 * del reintento.
 *
 * Si ese `POST` nunca llega, la espera corta sola diciendo cuál fue el paso que
 * no ocurrió: sin esto el test moría en el timeout genérico de Playwright, que
 * señala la línea del `await` y no el click que no disparó nada.
 */
async function cortarLaPrimeraRespuesta(page: Page, patron: string) {
  let cortado = false
  let avisarLlegada!: (body: Promise<Record<string, unknown>>) => void
  // Se espera la LLEGADA, no se lee una variable: en el salón el `POST` de
  // cierre sale recién después del PIN y del flush de pendientes, así que en
  // el momento en que el test termina de tipear todavía no pasó por acá.
  const llegada = new Promise<Promise<Record<string, unknown>>>((r) => {
    avisarLlegada = r
  })
  await page.route(patron, async (route: Route) => {
    if (route.request().method() !== 'POST' || cortado) return route.continue()
    cortado = true
    const body = route.fetch().then(r => r.json() as Promise<Record<string, unknown>>)
    avisarLlegada(body)
    await body
    await route.abort('internetdisconnected')
  })
  return async () => {
    let temporizador: ReturnType<typeof setTimeout>
    const seColgo = new Promise<never>((_, rechazar) => {
      temporizador = setTimeout(
        () => rechazar(new Error(
          `El primer POST a ${patron} nunca llegó al servidor `
          + `(${ESPERA_DEL_PRIMER_POST} ms). El corte no se llegó a fabricar: `
          + 'el paso que falló es el de antes —el click que tenía que disparar '
          + 'el cobro—, no la idempotencia.',
        )),
        ESPERA_DEL_PRIMER_POST,
      )
    })
    try {
      return await Promise.race([llegada.then(body => body), seColgo])
    }
    finally {
      clearTimeout(temporizador!)
    }
  }
}

test('POS: confirmar de nuevo después de un corte no crea otra venta', async ({ page, request }) => {
  const token = escenario.token!
  const item = await crearProducto(request, token, {
    nombre: `Cobro repetido POS ${Date.now()}`,
    precioBase: PRECIO_BASE,
  })
  escenario.itemIds.push(item.id)

  const respuestaDelPrimero = await cortarLaPrimeraRespuesta(page, '**/api/ventas')
  await page.goto('/ventas/pos')
  await page.locator(`[data-qa="item-catalogo-${item.id}"]`).click()
  await page.getByRole('button', { name: 'Cobrar', exact: true }).click()
  const cobro = page.getByRole('dialog').filter({ hasText: 'Cobrar venta' })

  // 1. El primer Confirmar: entra en el servidor, pero el navegador ve un error.
  await cobro.getByRole('button', { name: 'Confirmar venta' }).click()
  const primera = await respuestaDelPrimero()
  await expect(page.getByText('Venta pagada')).toHaveCount(0)

  // 2. El cajero vuelve a confirmar sobre el mismo carrito.
  const reintento = page.waitForResponse(
    r => r.url().endsWith('/ventas') && r.request().method() === 'POST',
  )
  await cobro.getByRole('button', { name: 'Confirmar venta' }).click()
  const segunda = (await (await reintento).json()) as Record<string, unknown>

  // 3. Es la misma venta, reproducida, y el cajero lo lee.
  expect(segunda.id).toBe(primera.id)
  expect(segunda.repetida).toBe(true)
  await expect(page.getByText(AVISO).first()).toBeVisible({ timeout: 15_000 })

  // 4. La plata: la caja espera UN cobro.
  expect(await cerrarCaja(request, token, escenario.cajaId!, EFECTIVO_DE_UN_COBRO)).toBe('cerrada')
})

test('Salón: volver a cobrar una mesa después de un corte reproduce el cierre, no "La cuenta no está abierta"', async ({
  page,
  request,
}) => {
  const token = escenario.token!
  const marca = Date.now()

  // Garzón, sesión, salón y mesa propios: la sesión es única por garzón.
  const nombreGarzon = `Garzón cobro repetido ${marca}`
  const garzon = await api<{ id: string, pin: string }>(request, 'post', '/garzones', {
    token,
    data: { nombre: nombreGarzon },
  })
  const turnos = await api<{ id: string, activo: boolean }[]>(request, 'get', '/turnos', { token })
  const turnoId = turnos.find(t => t.activo)?.id
  if (!turnoId) throw new Error('El seed no tiene ningún turno activo')
  await api(request, 'post', '/sesiones-garzon/iniciar', {
    token,
    data: { garzonId: garzon.id, pin: garzon.pin, turnoId },
  })
  try {
    const salonNombre = `Salón cobro repetido ${marca}`
    const salon = await api<{ id: string }>(request, 'post', '/salones', {
      token,
      data: { nombre: salonNombre },
    })
    const mesa = await api<{ id: string }>(request, 'post', `/salones/${salon.id}/mesas`, {
      token,
      data: { nombre: `Mesa ${marca}`, posX: 0.5, posY: 0.5 },
    })
    const itemNombre = `Plato cobro repetido ${marca}`
    const item = await crearProducto(request, token, { nombre: itemNombre, precioBase: PRECIO_BASE })
    escenario.itemIds.push(item.id)
    const conPin = { pin: garzon.pin, nombre: nombreGarzon }

    const respuestaDelPrimero = await cortarLaPrimeraRespuesta(page, '**/api/cuentas/*/cerrar')
    await page.goto('/salones')
    await elegirEnSelector(page, salonNombre)
    await page.locator(`[data-qa="mesa-${mesa.id}"]`).click()
    await page.getByRole('button', { name: 'Nueva cuenta' }).click()
    await rondaDePin(page, conPin)
    await page.getByText(itemNombre, { exact: true }).click()

    // 1. El primer cierre entra en el servidor; el navegador ve un error.
    await page.getByRole('button', { name: 'Cerrar y cobrar' }).click()
    const cobro = page.getByRole('dialog').filter({ hasText: 'Cobrar venta' })
    await cobro.getByRole('button', { name: 'Confirmar venta' }).click()
    await rondaDePin(page, conPin)
    const primera = await respuestaDelPrimero()

    // 2. El garzón vuelve a cobrar la misma cuenta.
    const reintento = page.waitForResponse(
      r => /\/cuentas\/[^/]+\/cerrar$/.test(r.url()) && r.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Cerrar y cobrar' }).click()
    await cobro.getByRole('button', { name: 'Confirmar venta' }).click()
    await rondaDePin(page, conPin)
    const respuesta = await reintento
    expect(respuesta.status(), 'reproduce, no rebota con "La cuenta no está abierta"').toBe(201)
    const segunda = (await respuesta.json()) as Record<string, unknown>

    // 3. El mismo cierre, reproducido, y el garzón lo lee.
    expect(segunda.ventaId).toBe(primera.ventaId)
    expect(segunda.repetida).toBe(true)
    await expect(page.getByText(AVISO).first()).toBeVisible({ timeout: 15_000 })

    // 4. La plata: la caja espera UN cobro.
    expect(await cerrarCaja(request, token, escenario.cajaId!, EFECTIVO_DE_UN_COBRO)).toBe('cerrada')
  }
  finally {
    await request.post(`${API}/sesiones-garzon/cerrar`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { garzonId: garzon.id, pin: garzon.pin },
    })
  }
})
