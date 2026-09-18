import { test, expect } from '@playwright/test'
import { API, api, tokenDe, limpiarItems, abrirCaja, cerrarCaja, TENANTS, CLP } from '../support/api'
import { elegirEnSelector, rondaDePin, valorDelTotal } from '../support/ui'

/**
 * El caso que se perdía hasta el 2026-09-17, en un navegador de verdad —spec
 * `docs/superpowers/specs/2026-09-17-boleta-desde-la-venta-design.md`, Task 6.
 *
 * Hasta esa fecha, `cerrarCuentaConPin` (`frontend/app/pages/salones/index.vue`)
 * rearmaba la boleta recalculando la cuenta **activa** en el momento en que el
 * cierre volvía del servidor. Si el garzón se metía en otra cuenta mientras el
 * sistema guardaba, ese recálculo dejaba de describir la cuenta que se estaba
 * cobrando: la venta se generaba igual, pero salía *"Venta generada, pero no se
 * pudo generar la boleta"* — cobrado, y el cliente sin papel, sin segunda
 * oportunidad (ningún camino reimprimía una venta pasada).
 *
 * Desde el commit `5e868546`, la boleta sale de la propia respuesta del
 * `POST /cuentas/:id/cerrar` (`armarBoleta`, sobre la venta ya persistida): ya
 * no depende de en qué cuenta esté parado el garzón cuando el cierre vuelve.
 *
 * **Molde:** `cuenta-hasta-cobro.spec.ts` (el cobro con PIN, `:280-300` de ese
 * archivo al momento de escribir esto). El flujo acá agrega el paso que faltaba:
 * navegar a OTRA cuenta mientras el cierre de la primera todavía viaja.
 *
 * ⚠️ **Lo que este test puede probar y lo que no.** No hay QZ Tray en el e2e,
 * así que el papel no se imprime y no se afirma nada sobre su contenido — eso
 * ya lo cubren los unit de `buildBoletaTicket` y de
 * `pages/salones/index.nuxt.spec.ts`. Lo que sí se prueba, y es exactamente el
 * bug: que el camino **no vuelve a quedarse sin boleta** cuando el garzón se
 * mueve durante el cierre. La prueba de que "sin boleta" ya no pasa es la
 * AUSENCIA del aviso — no la presencia de un ticket, que acá no existe.
 *
 * ⚠️ **La ventana de la carrera se fuerza, no se espera.** `page.route`
 * intercepta el `POST .../cerrar` y demora la respuesta un rato fijo: tiempo de
 * sobra para salir de la cuenta y entrar a otra ANTES de que el cierre
 * resuelva. Sin esto, la carrera existe pero es de milisegundos y el test
 * pasaría por casualidad la mitad de las veces, contra el código viejo Y el
 * nuevo — no sirve como red.
 */

const TENANT_DEMO_RESTAURANTE = TENANTS.restaurante

/** Precio base del ítem del test. Todo lo demás se deriva de acá (ADR-018: IVA 19%). */
const PRECIO_BASE = '1000'
const TOTAL_CON_IVA = '$1.190'
/** Con la propina sugerida del 10%: 1.190 + 119. */
const TOTAL_CON_PROPINA = '$1.309'
const EFECTIVO_ESPERADO = '1309'

const AVISO_SIN_BOLETA = 'Venta generada, pero no se pudo generar la boleta'

/**
 * Se llena de a poco a propósito (ver `cuenta-hasta-cobro.spec.ts`): si el
 * montaje falla a la mitad, el `afterAll` cierra lo que sí llegó a existir.
 */
const escenario: {
  token?: string
  garzon?: { id: string, pin: string, nombre: string }
  salonNombre?: string
  mesaId?: string
  itemNombre?: string
  itemId?: string
  cajaId?: string
  /** La cuenta que YA existe antes de que el test entre a la mesa: el destino
   *  de "navegar a otra cuenta" mientras se cobra la que el test abre por UI. */
  cuentaBId?: string
  cuentaBNumero?: number
} = {}

test.beforeAll(async ({ request }) => {
  const token = await tokenDe(request, TENANT_DEMO_RESTAURANTE)
  escenario.token = token
  const marca = Date.now()

  // Garzón PROPIO: la sesión de trabajo es única por garzón y Ana (la del
  // seed) la comparten varias specs — no se reusa acá.
  const nombreGarzon = `Garzón boleta E2E ${marca}`
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

  escenario.salonNombre = `Salón boleta E2E ${marca}`
  const salon = await api<{ id: string }>(request, 'post', '/salones', {
    token,
    data: { nombre: escenario.salonNombre },
  })
  const mesa = await api<{ id: string }>(request, 'post', `/salones/${salon.id}/mesas`, {
    token,
    // Al centro del plano: en (0,0) la mesa queda recortada contra el borde
    // del contenedor y el click cae afuera del área visible. Medido (ver
    // `cuenta-hasta-cobro.spec.ts`).
    data: { nombre: `Mesa ${marca}`, posX: 0.5, posY: 0.5 },
  })
  escenario.mesaId = mesa.id

  escenario.itemNombre = `Plato boleta E2E ${marca}`
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
    },
  })
  escenario.itemId = item.id

  // La cuenta "de al lado": se abre por API, antes de que el navegador entre a
  // la mesa, para que la tarjeta ya esté en el listado — no hace falta
  // clickear dos veces "Nueva cuenta" para tener a dónde navegar. Queda vacía
  // y abierta durante todo el test; el `afterAll` la cancela.
  const cuentaB = await api<{ id: string, numero: number }>(
    request,
    'post',
    `/mesas/${mesa.id}/cuentas`,
    { token, data: { garzonId: garzon.id, pin: garzon.pin } },
  )
  escenario.cuentaBId = cuentaB.id
  escenario.cuentaBNumero = cuentaB.numero

  escenario.cajaId = await abrirCaja(request, token)
})

test.afterAll(async ({ request }) => {
  const { token, cajaId, garzon, itemId, mesaId } = escenario
  if (!token) return
  const auth = { Authorization: `Bearer ${token}` }

  // Red de seguridad: cancela cualquier cuenta que haya quedado abierta en la
  // mesa —la B, que el flujo nunca cierra, y la A si el test murió antes de
  // cobrarla—. Sin items despachados a cocina, `cancelar` no pide motivo.
  if (mesaId) {
    const cuentas = await request.get(`${API}/mesas/${mesaId}/cuentas`, { headers: auth })
    if (cuentas.ok()) {
      for (const cuenta of (await cuentas.json()) as { id: string }[]) {
        const res = await request.post(`${API}/cuentas/${cuenta.id}/cancelar`, { headers: auth })
        if (!res.ok()) {
          console.warn(`[e2e] no se pudo cancelar la cuenta ${cuenta.id}: ${res.status()} ${await res.text()}`)
        }
      }
    }
  }

  if (itemId) await limpiarItems(request, token, [itemId])

  if (cajaId) {
    // Red de seguridad del camino de FALLO: si el test llegó al final, ya
    // cerró la caja y esto es un no-op (ver `cerrarCaja`).
    await cerrarCaja(request, token, cajaId, EFECTIVO_ESPERADO)
  }

  if (garzon) {
    await request.post(`${API}/sesiones-garzon/cerrar`, {
      headers: auth,
      data: { garzonId: garzon.id, pin: garzon.pin },
    })
  }
})

test('cobra una cuenta habiendo navegado a otra mientras el cierre viajaba, y la boleta no se pierde', async ({
  page,
  request,
}) => {
  const garzon = escenario.garzon!
  await page.goto('/salones')

  // 1. El salón y la mesa propios.
  await elegirEnSelector(page, escenario.salonNombre!)
  await page.locator(`[data-qa="mesa-${escenario.mesaId}"]`).click()

  // 2. La cuenta B ya está ahí (se abrió por API en el `beforeAll`): es la
  //    tarjeta a la que este test se va a mover mientras cobra la otra.
  const tarjetaCuentaB = page.getByText(`Cuenta ${escenario.cuentaBNumero}`, { exact: true })
  await expect(tarjetaCuentaB).toBeVisible()

  // 3. Nueva cuenta (la A) → identificarse → pedir el producto.
  await page.getByRole('button', { name: 'Nueva cuenta' }).click()
  await rondaDePin(page, garzon)
  await page.getByText(escenario.itemNombre!, { exact: true }).click()
  await expect(valorDelTotal(page)).toHaveText(TOTAL_CON_IVA)

  // 4. Abrir el cobro y confirmar el total con la propina sugerida.
  await page.getByRole('button', { name: 'Cerrar y cobrar' }).click()
  const cobro = page.getByRole('dialog').filter({ hasText: 'Cobrar venta' })
  await expect(cobro).toContainText(TOTAL_CON_PROPINA)

  // 5. Retener la respuesta del cierre: la ventana en la que el garzón puede
  //    moverse de cuenta "mientras el sistema guarda" (commit `5e868546`), sin
  //    dejarla a la suerte de la latencia real. Se registra DESPUÉS de leer el
  //    total del modal —ese cálculo no es lo que se está demorando— y se saca
  //    apenas se navega, para no demorar de más lo que sigue.
  let soltar!: () => void
  const retenido = new Promise<void>((r) => { soltar = r })
  await page.route('**/api/cuentas/*/cerrar', async (route) => {
    await retenido
    await route.continue()
  })

  await cobro.getByRole('button', { name: 'Confirmar venta' }).click()
  await rondaDePin(page, garzon)

  // 6. Con el cierre todavía retenido: salir de la cuenta A y entrar a la B.
  //    Es el gesto que el bug necesitaba — "el garzón se metía en otra cuenta
  //    mientras el sistema guardaba" — forzado en vez de esperado.
  await page.getByRole('button', { name: 'Cuentas' }).click()
  await tarjetaCuentaB.click()
  await expect(page.getByText(`— Cuenta ${escenario.cuentaBNumero}`)).toBeVisible()

  // 7. Soltar el cierre y dejar que termine. Sin `unroute`: una vez resuelta
  //    `retenido` para siempre, cualquier request futura por esta ruta la cruza
  //    sin demora — no hace falta sacar el interceptor, y sacarlo mientras el
  //    que ya está en vuelo todavía no llamó a `continue()` lo deja huérfano
  //    (`route.continue: Route is already handled!`, medido).
  soltar()

  // 8. El cobro salió — prueba positiva de que el `POST` completó, no un
  //    supuesto de tiempo— y el aviso de "sin boleta" nunca aparece.
  await expect(
    page.getByText('Cuenta cerrada — propina registrada').first(),
  ).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(AVISO_SIN_BOLETA)).toHaveCount(0)

  // 9. Y no se lo expulsa de donde está: sigue parado en la cuenta B, ajena al
  //    cierre de la A que acaba de terminar por detrás.
  await expect(page.getByRole('button', { name: 'Cuentas' })).toBeVisible()
  await expect(page.getByText(`— Cuenta ${escenario.cuentaBNumero}`)).toBeVisible()

  // 10. La prueba que no es de cliente: la cuenta A quedó cerrada de verdad
  //     (la venta se generó) y la B, intacta —el gesto de "irse a otra cuenta"
  //     no le hizo nada a la que solo se estaba mirando de paso—.
  const cuentasAbiertas = await api<{ id: string, numero: number }[]>(
    request,
    'get',
    `/mesas/${escenario.mesaId}/cuentas`,
    { token: escenario.token },
  )
  expect(cuentasAbiertas.map(c => c.id)).toEqual([escenario.cuentaBId])

  // 11. Y la caja espera exactamente lo cobrado — mismo criterio que
  //     `cuenta-hasta-cobro.spec.ts`: sin esto, una pantalla que no muestre el
  //     aviso pero haya cobrado mal pasaría en verde igual.
  const estado = await cerrarCaja(request, escenario.token!, escenario.cajaId!, EFECTIVO_ESPERADO)
  expect(estado).toBe('cerrada')
  escenario.cajaId = undefined // Ya cerrada: que el `afterAll` no repita el conteo.
})
