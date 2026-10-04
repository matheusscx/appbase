import { test, expect } from '../support/sin-qz-tray'
import { API, api, tokenDe, limpiarItems, abrirCaja, cerrarCaja, TENANTS, CLP } from '../support/api'
import { elegirEnSelector, rondaDePin } from '../support/ui'

/**
 * Una boleta de más de 135 UF lleva el nombre y el RUT de quien paga (Res. Ex.
 * SII 44/2025). Salones no tiene formulario de cliente: el modal de cobro los
 * pide solo cuando el total de la cuenta pasa el umbral (owner, 2026-10-04).
 * Lo que agrega sobre `pages/salones/index.nuxt.spec.ts` (que fija el umbral y
 * el body con `setProps`) es escribir en los campos del modal de verdad y que
 * el servidor congele lo tipeado.
 *
 * **Molde:** `boleta-al-cobrar.spec.ts` (garzón, salón y mesa propios, caja por API).
 */

const escenario: {
  token?: string
  garzon?: { id: string, pin: string, nombre: string }
  salonNombre?: string
  mesaId?: string
  itemNombre?: string
  itemId?: string
  cajaId?: string
} = {}

test.beforeAll(async ({ request }) => {
  const token = await tokenDe(request, TENANTS.restaurante)
  escenario.token = token
  const marca = Date.now()

  // Garzón PROPIO: la sesión de trabajo es única por garzón.
  const nombreGarzon = `Garzón umbral E2E ${marca}`
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

  escenario.salonNombre = `Salón umbral E2E ${marca}`
  const salon = await api<{ id: string }>(request, 'post', '/salones', {
    token,
    data: { nombre: escenario.salonNombre },
  })
  const mesa = await api<{ id: string }>(request, 'post', `/salones/${salon.id}/mesas`, {
    token,
    data: { nombre: `Mesa ${marca}`, posX: 0.5, posY: 0.5 },
  })
  escenario.mesaId = mesa.id

  // $6.000.000 neto: $7.140.000 con IVA, sobre el umbral de 2025 y el de 2026.
  escenario.itemNombre = `Banquete umbral E2E ${marca}`
  const item = await api<{ id: string }>(request, 'post', '/items', {
    token,
    data: {
      nombre: escenario.itemNombre,
      tipo: 'producto',
      precioBase: '6000000',
      monedaId: CLP,
      unidadMedida: 'unidad',
      stock: '10',
      costo: '400',
    },
  })
  escenario.itemId = item.id

  escenario.cajaId = await abrirCaja(request, token)
})

test.afterAll(async ({ request }) => {
  const { token, cajaId, garzon, itemId, mesaId } = escenario
  if (!token) return
  const auth = { Authorization: `Bearer ${token}` }

  // Si el test murió antes de cobrar, la cuenta quedó abierta en la mesa.
  if (mesaId) {
    const cuentas = await request.get(`${API}/mesas/${mesaId}/cuentas`, { headers: auth })
    if (cuentas.ok()) {
      for (const cuenta of (await cuentas.json()) as { id: string }[]) {
        await request.post(`${API}/cuentas/${cuenta.id}/cancelar`, { headers: auth })
      }
    }
  }
  if (itemId) await limpiarItems(request, token, [itemId])
  // El conteo descuadra (se cobró en efectivo) y el helper lo resuelve con un motivo.
  if (cajaId) await cerrarCaja(request, token, cajaId, '0')
  if (garzon) {
    await request.post(`${API}/sesiones-garzon/cerrar`, {
      headers: auth,
      data: { garzonId: garzon.id, pin: garzon.pin },
    })
  }
})

test('sobre el umbral el cobro de la mesa pide nombre y RUT de quien paga, y el cierre los congela', async ({
  page,
  request,
}) => {
  const garzon = escenario.garzon!
  await page.goto('/salones')
  await elegirEnSelector(page, escenario.salonNombre!)
  await page.locator(`[data-qa="mesa-${escenario.mesaId}"]`).click()

  await page.getByRole('button', { name: 'Nueva cuenta' }).click()
  await rondaDePin(page, garzon)
  await page.getByText(escenario.itemNombre!, { exact: true }).click()

  await page.getByRole('button', { name: 'Cerrar y cobrar' }).click()
  const cobro = page.getByRole('dialog').filter({ hasText: 'Cobrar venta' })
  await expect(cobro.locator('[data-qa="pagador"]')).toBeVisible()
  const confirmar = cobro.getByRole('button', { name: 'Confirmar venta' })
  await expect(confirmar).toBeDisabled()

  // El atributo puede caer en el `input` o en su contenedor: se cubren las dos.
  const campo = (qa: string) =>
    cobro.locator(`input[data-qa="${qa}"], [data-qa="${qa}"] input`).first()

  await campo('pagador-nombre').fill('Juana Pérez Soto')
  await expect(confirmar).toBeDisabled()
  await campo('pagador-rut').fill('12.345.678-9')
  await expect(cobro.getByText('RUT inválido')).toBeVisible()
  await expect(confirmar).toBeDisabled()
  await campo('pagador-rut').fill('12.345.678-5')
  await expect(confirmar).toBeEnabled()

  const respuesta = page.waitForResponse(
    r => /\/cuentas\/[^/]+\/cerrar$/.test(r.url()) && r.request().method() === 'POST',
  )
  await confirmar.click()
  await rondaDePin(page, garzon)
  const res = await respuesta
  expect(res.status()).toBe(201)
  const ventaId = ((await res.json()) as { ventaId: string }).ventaId

  const venta = await api<{ customer: Record<string, string | null> | null }>(
    request,
    'get',
    `/ventas/${ventaId}`,
    { token: escenario.token },
  )
  expect(venta.customer).toMatchObject({ nombre: 'Juana Pérez Soto', rut: '12345678-5' })
})
