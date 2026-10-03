import { test, expect } from '../support/sin-qz-tray'
import {
  abrirCaja,
  api,
  API,
  cerrarCaja,
  CLP,
  limpiarItems,
  tokenDe,
  TENANTS,
} from '../support/api'
import { elegirEnSelector, rondaDePin, valorDelTotal } from '../support/ui'

/**
 * Salones con un producto de número de serie, en un navegador de verdad: el
 * garzón elige qué unidad pide la mesa y esa es la que sale al cobrar
 * (`docs/features/inventario-serializado.md`, § «Quién elige qué unidad con serie sale»).
 *
 * La escena es la del POS (`ventas/venta-serie.spec.ts`) pero por la otra puerta:
 * un celular `usado` ingresado primero y uno `nuevo` después, y esta vez se pide el
 * NUEVO —que NO es el más antiguo—. Con el FIFO de antes habría salido el usado,
 * así que el caso fija que la unidad elegida en el selector viaja en la línea de la
 * cuenta, se muestra ahí, y es la que el cierre vende.
 *
 * ⚠️ **Las precondiciones se montan por API**, igual que `cuenta-hasta-cobro.spec.ts`
 * (garzón, turno, salón, mesa, caja). Lo que se ejercita por pantalla es el flujo
 * bajo prueba: abrir la cuenta, agregar el producto eligiendo la unidad, cobrar.
 *
 * ⚠️ **Garzón propio**, nunca Ana del seed: la sesión de trabajo es única por
 * garzón y compartirla hace que las specs de salones se pisen.
 *
 * ⚠️ **La verificación final no es de cliente**: el id de la venta sale de la
 * respuesta del `POST .../cerrar` y las series, de `GET /ventas/:id`, que las
 * arma desde el movimiento de inventario de esa venta.
 */

const PRECIO_BASE = '10000'
/** 10.000 + 19% = 11.900 (ADR-018). */
const TOTAL_CON_IVA = '$11.900'
/** Lo que la caja espera en efectivo: la venta + la propina sugerida del 10% (1.190). */
const EFECTIVO_ESPERADO = '13090'

/**
 * Lo que el `beforeAll` fue creando. Se llena de a poco a propósito: si el
 * montaje falla a la mitad, el `afterAll` tiene que poder cerrar lo que sí llegó
 * a existir (un garzón en turno o una caja abierta dejan sin arrancar la
 * corrida siguiente).
 */
const escenario: {
  token?: string
  garzon?: { id: string, pin: string, nombre: string }
  salonNombre?: string
  mesaId?: string
  itemNombre?: string
  itemId?: string
  serieNueva?: string
  serieUsada?: string
  cajaId?: string
} = {}

test.beforeAll(async ({ request }) => {
  const token = await tokenDe(request, TENANTS.restaurante)
  escenario.token = token
  const marca = Date.now()

  const nombreGarzon = `Garzón salón serie E2E ${marca}`
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

  escenario.salonNombre = `Salón serie E2E ${marca}`
  const salon = await api<{ id: string }>(request, 'post', '/salones', {
    token,
    data: { nombre: escenario.salonNombre },
  })
  // Al centro del plano: en (0,0) la mesa queda recortada contra el borde y el
  // click cae fuera del área visible (medido en `cuenta-hasta-cobro.spec.ts`).
  const mesa = await api<{ id: string }>(request, 'post', `/salones/${salon.id}/mesas`, {
    token,
    data: { nombre: `Mesa serie ${marca}`, posX: 0.5, posY: 0.5 },
  })
  escenario.mesaId = mesa.id

  // Producto serie propio, con una unidad nueva y otra usada en el local.
  escenario.itemNombre = `Celular salón serie E2E ${marca}`
  escenario.serieNueva = `IMEI-NUEVO-${marca}`
  escenario.serieUsada = `IMEI-USADO-${marca}`
  const item = await api<{ id: string }>(request, 'post', '/items', {
    token,
    data: {
      nombre: escenario.itemNombre,
      tipo: 'producto',
      precioBase: PRECIO_BASE,
      monedaId: CLP,
      unidadMedida: 'unidad',
      modoInventario: 'serie',
    },
  })
  escenario.itemId = item.id
  const ubicaciones = await api<{ id: string, tipo: string }[]>(
    request, 'get', '/ubicaciones', { token },
  )
  const local = ubicaciones.find(u => u.tipo === 'local')!
  // Dos entradas separadas, la USADA primero: cada una tiene su propio `creado_el`
  // y el FIFO de antes (`creado_el ASC`) sacaba la usada, así que pedir la NUEVA
  // solo pasa si la elección del garzón manda. En una sola entrada con las dos
  // series el `creado_el` sería idéntico y el caso no distinguiría nada.
  for (const [serie, condicion] of [
    [escenario.serieUsada, 'usado'],
    [escenario.serieNueva, 'nuevo'],
  ] as const) {
    await api(request, 'patch', `/items/${item.id}/stock`, {
      token,
      data: {
        tipo: 'entrada',
        motivo: 'inventario_inicial',
        ubicacionId: local.id,
        cantidad: '1',
        series: [{ serie, condicion }],
      },
    })
  }

  // El cobro del salón es canal físico: exige caja abierta del usuario que cobra,
  // que acá es el mismo con el que está logueado el navegador.
  escenario.cajaId = await abrirCaja(request, token)
})

test.afterAll(async ({ request }) => {
  const { token, cajaId, garzon, itemId } = escenario
  if (!token) return
  // El ítem se da de baja (soft delete por API): el catálogo del tenant es
  // compartido y un producto por corrida termina empujando fuera de la pantalla a
  // los reales. El salón y la mesa quedan: se eligen por nombre exacto.
  if (itemId) await limpiarItems(request, token, [itemId])
  // Red de seguridad del camino de FALLO: si el test llegó al final esto no hace
  // nada; si murió antes, deja el cajón libre para la corrida siguiente.
  if (cajaId) await cerrarCaja(request, token, cajaId, '0')
  if (garzon) {
    await request.post(`${API}/sesiones-garzon/cerrar`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { garzonId: garzon.id, pin: garzon.pin },
    })
  }
})

test('el garzón pide el celular eligiendo la unidad nueva: la línea la muestra y la venta sale con esa serie', async ({
  page,
  request,
}) => {
  const garzon = escenario.garzon!
  const serieNueva = escenario.serieNueva!
  const serieUsada = escenario.serieUsada!
  await page.goto('/salones')

  // 1. Salón propio, mesa, nueva cuenta e identificación (idéntico a
  //    `cuenta-hasta-cobro.spec.ts`).
  await elegirEnSelector(page, escenario.salonNombre!)
  await page.locator(`[data-qa="mesa-${escenario.mesaId}"]`).click()
  await page.getByRole('button', { name: 'Nueva cuenta' }).click()
  await rondaDePin(page, garzon)

  // 2. Tocar el producto abre el selector en vez de agregarlo directo.
  await page.getByText(escenario.itemNombre!, { exact: true }).click()
  const selector = page.getByRole('dialog').filter({ hasText: 'Elegir unidades' })
  await expect(selector).toBeVisible()

  // 3. Las dos unidades con su condición; se elige la NUEVA.
  const filaNueva = selector.locator(`[data-qa="unidad-fila"][data-serie="${serieNueva}"]`)
  const filaUsada = selector.locator(`[data-qa="unidad-fila"][data-serie="${serieUsada}"]`)
  await expect(filaNueva).toContainText('Nuevo')
  await expect(filaUsada).toContainText('Usado')
  await filaNueva.getByRole('checkbox').click()
  await selector.getByRole('button', { name: 'Confirmar (1)' }).click()
  await expect(selector).toBeHidden()

  // 4. La línea de la cuenta lleva la serie elegida —y solo esa— y deja reabrir el
  //    selector en lugar de tipear la cantidad. El total sale de la regla:
  //    $10.000 afecto + 19%.
  const series = page.locator('[data-qa="series-linea"]')
  await expect(series).toContainText(serieNueva)
  await expect(series).not.toContainText(serieUsada)
  await expect(page.getByRole('button', { name: 'Cambiar unidades' })).toBeVisible()
  await expect(valorDelTotal(page)).toHaveText(TOTAL_CON_IVA)

  // 5. Cobrar. El PIN se pide DESPUÉS de confirmar, como en `cuenta-hasta-cobro`.
  await page.getByRole('button', { name: 'Cerrar y cobrar' }).click()
  const cobro = page.getByRole('dialog').filter({ hasText: 'Cobrar venta' })
  const respuesta = page.waitForResponse(
    r => /\/cuentas\/[^/]+\/cerrar$/.test(r.url()) && r.request().method() === 'POST',
  )
  await cobro.getByRole('button', { name: 'Confirmar venta' }).click()
  await rondaDePin(page, garzon)
  const cierre = await respuesta
  expect(cierre.status()).toBe(201)
  const { ventaId } = (await cierre.json()) as { ventaId: string }
  await expect(
    page.getByText('Cuenta cerrada — propina registrada').first(),
  ).toBeVisible({ timeout: 15_000 })

  // 6. ⚠️ Lo que no es de cliente: la venta que armó el cierre vendió la unidad
  //    de la línea, no otra.
  const venta = await api<{
    estado: string
    detalles: { itemId: string, unidades?: { serie: string, condicion: string }[] }[]
  }>(request, 'get', `/ventas/${ventaId}`, { token: escenario.token })
  expect(venta.estado).toBe('pagada')
  const linea = venta.detalles.find(d => d.itemId === escenario.itemId)
  expect(linea?.unidades).toEqual([{ serie: serieNueva, condicion: 'nuevo' }])

  // 7. La caja espera exactamente lo cobrado (venta + propina): `cerrada` solo sale
  //    si el conteo cuadra con lo que el servidor calculó. Se cierra con el monto
  //    real y no con 0 para no dejar un cierre con diferencia.
  expect(await cerrarCaja(request, escenario.token!, escenario.cajaId!, EFECTIVO_ESPERADO))
    .toBe('cerrada')
  escenario.cajaId = undefined // Ya cerrada: que el `afterAll` no repita el conteo.
})
