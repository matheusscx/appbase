import { test, expect, type APIRequestContext } from '@playwright/test'
import { API, api, tokenDe, limpiarItems, TENANTS, CLP } from '../support/api'
import { elegirEnSelector, rondaDePin, valorDelTotal } from '../support/ui'

/**
 * Anular un plato ya despachado a cocina, de punta a punta en un navegador real
 * — spec `2026-09-16-anular-plato-despachado-design.md`, Task 6.
 *
 * Molde: `cuenta-hasta-cobro.spec.ts` (precondiciones por API, el flujo bajo
 * prueba por UI). Flujo: pedir → mandar a cocina → anular como cortesía → ver
 * el aviso bajo la cuenta → el total baja.
 *
 * **La precuenta NO se imprime acá** (QZ Tray): eso lo cubre el unit de
 * `buildPrecuentaTicket`. Este test tampoco cobra — no hace falta caja.
 *
 * **Se anula sin salir de la cuenta**: el gesto aparece en cuanto vuelve el
 * claim. Sin QZ Tray (CI) la impresión falla después del claim y deja un toast
 * de error sobre el que no se afirma; el despacho ya ocurrió igual, y la
 * pantalla lo refleja igual (`docs/features/salones-mesas.md` § *Lo despachado
 * se ve en el acto*).
 */

const PRECIO_BASE = '1000'
/** Afecto + IVA 19%: 1.000 × 1,19 = 1.190 por unidad. */
const TOTAL_2_UNIDADES = '$2.380'
const TOTAL_1_UNIDAD = '$1.190'

/**
 * Se llena de a poco a propósito (ver `cuenta-hasta-cobro.spec.ts`): si el
 * montaje falla a la mitad, el `afterAll` tiene que poder limpiar lo que sí
 * llegó a existir.
 */
const escenario: {
  token?: string
  garzon?: { id: string, pin: string, nombre: string }
  salonNombre?: string
  mesaId?: string
  itemNombre?: string
  itemId?: string
  impresoraId?: string
  categoriaId?: string
  /** La cuenta que abre el test, con 1 unidad todavía viva al terminar — el
   *  `afterAll` la cancela antes de poder dar de baja el ítem. */
  cuentaId?: string
} = {}

test.beforeAll(async ({ request }) => {
  const token = await tokenDe(request, TENANTS.restaurante)
  escenario.token = token
  const marca = Date.now()

  // Garzón PROPIO: la sesión de trabajo es única por garzón, y Ana (la del
  // seed) la comparten varias specs — no se reusa acá.
  const nombreGarzon = `Garzón anular E2E ${marca}`
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

  escenario.salonNombre = `Salón anular E2E ${marca}`
  const salon = await api<{ id: string }>(request, 'post', '/salones', {
    token,
    data: { nombre: escenario.salonNombre },
  })
  const mesa = await api<{ id: string }>(request, 'post', `/salones/${salon.id}/mesas`, {
    token,
    // Al centro del plano: en (0,0) la mesa queda recortada contra el borde
    // del contenedor y el click cae afuera del área visible. Medido.
    data: { nombre: `Mesa ${marca}`, posX: 0.5, posY: 0.5 },
  })
  escenario.mesaId = mesa.id

  // Ruteo a cocina: sin impresora, `reclamarComanda` nunca avanza
  // `cantidad_enviada` (spec § 9, "Líneas sin impresora") y el gesto de
  // anular —que exige lo despachado— no aparece nunca.
  const impresora = await api<{ id: string }>(request, 'post', '/impresoras', {
    token,
    data: {
      nombre: `Cocina anular E2E ${marca}`,
      rol: 'comanda',
      tipoConexion: 'sistema',
      nombreCola: `cola-anular-e2e-${marca}`,
    },
  })
  escenario.impresoraId = impresora.id
  const categoria = await api<{ id: string }>(request, 'post', '/categorias', {
    token,
    data: { nombre: `Cocina anular E2E ${marca}`, impresoraId: impresora.id },
  })
  escenario.categoriaId = categoria.id

  escenario.itemNombre = `Plato anular E2E ${marca}`
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
})

test.afterAll(async ({ request }) => {
  const { token, garzon, itemId, categoriaId, impresoraId, cuentaId } = escenario
  if (!token) return
  const auth = { Authorization: `Bearer ${token}` }

  // La cuenta del test queda con 1 unidad viva y despachada: `DELETE /items/:id`
  // rechaza mientras esté pedido en una cuenta abierta. Se cancela con motivo
  // (hay algo despachado) ANTES de dar de baja el ítem, si no el 400 de la
  // cancelación se lleva puesto el resto de la limpieza.
  if (cuentaId) {
    const motivos = await request.get(`${API}/motivos-baja?soloActivas=true`, { headers: auth })
    const motivoId = motivos.ok()
      ? ((await motivos.json()) as { id: string, tipo: string }[]).find(m => m.tipo === 'cortesia')?.id
      : undefined
    const res = motivoId
      ? await request.post(`${API}/cuentas/${cuentaId}/cancelar-con-motivo`, {
          headers: auth,
          data: { motivoBajaId: motivoId },
        })
      : undefined
    if (!res?.ok()) {
      console.warn(
        `[e2e] no se pudo cancelar la cuenta ${cuentaId}: ${res?.status()} ${res ? await res.text() : 'sin motivo de cortesía activo'}`,
      )
    }
  }

  if (itemId) await limpiarItems(request, token, [itemId])

  // El salón y la mesa quedan (viven en su propia lista, filtrada por nombre
  // exacto — mismo criterio que `cuenta-hasta-cobro.spec.ts`). La impresora y
  // la categoría propias sí se limpian: a diferencia del salón, aparecen en
  // selectores que otras pantallas cargan enteros.
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

// `rondaDePin` y `valorDelTotal` viven en `../support/ui`: se extrajeron ahí al
// tercer uso (este archivo era la segunda duplicación, junto con
// `cuenta-hasta-cobro.spec.ts`; `boleta-al-cobrar.spec.ts` fue la tercera).

test('pide, manda a cocina, anula como cortesía y el aviso aparece con el total ya abajo', async ({
  page,
  request,
}) => {
  const garzon = escenario.garzon!
  await page.goto('/salones')

  // 1. El salón propio. Explícito aunque la pantalla preseleccione uno: cuál
  //    queda primero depende del orden de la lista.
  await elegirEnSelector(page, escenario.salonNombre!)

  // 2. La mesa del plano, por el hook de test que el componente ya expone.
  await page.locator(`[data-qa="mesa-${escenario.mesaId}"]`).click()

  // 3. Nueva cuenta → identificarse.
  await page.getByRole('button', { name: 'Nueva cuenta' }).click()
  await rondaDePin(page, garzon)

  // 4. Dos unidades del mismo plato: dos clics sobre la misma card del
  //    catálogo (el merge de `agregarLinea` suma `cantidad`).
  const card = page.getByText(escenario.itemNombre!, { exact: true })
  await card.click()
  await card.click()
  await expect(valorDelTotal(page)).toHaveText(TOTAL_2_UNIDADES)

  // 5. Mandar a cocina: espera la respuesta del claim (no el toast, que
  //    depende de si QZ Tray está arriba) para saber que el servidor ya
  //    avanzó `cantidad_enviada`.
  const reclamo = page.waitForResponse(
    res => res.url().includes('/comanda/reclamar') && res.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Enviar a cocina' }).click()
  await reclamo

  // 6. Anular 1 de las 2 unidades despachadas, como cortesía.
  await page
    .getByRole('button', { name: 'Anular (cortesía, merma o no se llegó a hacer)' })
    .click()
  const modalAnular = page.getByRole('dialog').filter({ hasText: 'Anular plato' })
  await expect(modalAnular).toBeVisible()
  await modalAnular.getByRole('spinbutton').fill('1')
  await elegirEnSelector(modalAnular, 'Cortesía de la casa (Cortesía)')
  await modalAnular.getByRole('button', { name: 'Anular', exact: true }).click()

  // 7. El toast de éxito…
  await expect(page.getByText('Plato anulado').first()).toBeVisible()

  // 8. …el aviso debajo de la cuenta, con la palabra del owner (spec § 5):
  //    "{cantidad} {plato} anulado — {tipo}, autorizó {usuario}".
  await expect(
    page.getByText(`1 ${escenario.itemNombre} anulado — Cortesía, autorizó Admin`),
  ).toBeVisible()

  // 9. Y el total bajó exactamente lo anulado: de 2 unidades a 1.
  await expect(valorDelTotal(page)).toHaveText(TOTAL_1_UNIDAD)

  // Verificación que no es de cliente: el servidor también quedó con una sola
  // unidad viva y la anulación trazada.
  const cuentas = await api<{
    id: string
    lineas: { cantidad: string, cantidadEnviada: string }[]
    anulaciones: { cantidad: string, motivoTipo: string }[]
  }[]>(request, 'get', `/mesas/${escenario.mesaId}/cuentas`, { token: escenario.token })
  expect(cuentas).toHaveLength(1)
  // Para el `afterAll`: sin esto la cuenta queda abierta para siempre y el
  // ítem nunca se puede dar de baja.
  escenario.cuentaId = cuentas[0]!.id
  expect(cuentas[0]!.lineas).toHaveLength(1)
  expect(cuentas[0]!.lineas[0]!.cantidad).toBe('1.0000')
  expect(cuentas[0]!.lineas[0]!.cantidadEnviada).toBe('1.0000')
  expect(cuentas[0]!.anulaciones).toHaveLength(1)
  expect(cuentas[0]!.anulaciones[0]!.cantidad).toBe('1.0000')
  expect(cuentas[0]!.anulaciones[0]!.motivoTipo).toBe('cortesia')
})
