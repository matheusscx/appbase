import type { Page } from '@playwright/test'
import { test, expect } from '../support/sin-qz-tray'
import {
  abrirCaja,
  api,
  cerrarCaja,
  crearProducto,
  limpiarItems,
  tokenDe,
  TENANTS,
} from '../support/api'

/**
 * La Factura en el POS exige el receptor que pide el SII (Formato DTE v2.5,
 * zona Receptor): RUT válido, razón social, giro, dirección y comuna. Lo que
 * agrega sobre `useReceptor.spec.ts` y los e2e de API es la cadena: que la
 * pantalla tome la regla del tipo que devuelve el servidor, frene el botón con
 * un receptor incompleto o un RUT malo, y que lo que congela el servidor sea lo
 * que el cajero tipeó (normalizado).
 *
 * Las precondiciones (caja e ítem) se montan por API, como en `pos.spec.ts`.
 */

let escenario: { token?: string, cajaId?: string, itemIds: string[] } = { itemIds: [] }

test.beforeEach(async ({ request }) => {
  escenario = { itemIds: [] }
  escenario.token = await tokenDe(request, TENANTS.restaurante)
  escenario.cajaId = await abrirCaja(request, escenario.token)
})

test.afterEach(async ({ request }) => {
  const { token, cajaId, itemIds } = escenario
  if (!token) return
  if (cajaId) await cerrarCaja(request, token, cajaId, '0')
  await limpiarItems(request, token, itemIds)
})

/**
 * Los campos del formulario arrancan `readonly` y lo pierden al recibir el foco
 * (truco contra el autocompletado del navegador): `fill` sobre un readonly
 * espera para siempre, así que primero se hace click.
 */
async function escribir(page: Page, placeholder: string, valor: string) {
  const campo = page.getByPlaceholder(placeholder, { exact: true })
  await campo.click()
  await campo.fill(valor)
}

interface VentaServidor {
  tipoDocumento: { codigo: string | null } | null
  customer: Record<string, string | null> | null
}

test('la factura no se cobra sin el receptor completo ni con un RUT malo, y congela lo tipeado', async ({ page, request }) => {
  const token = escenario.token!
  const item = await crearProducto(request, token, {
    nombre: `POS factura ${Date.now()}`,
    precioBase: '1000',
  })
  escenario.itemIds.push(item.id)

  await page.goto('/ventas/pos')
  await page.locator(`[data-qa="item-catalogo-${item.id}"]`).click()

  // Elegir la Factura abre solo el formulario del cliente (es `customer_requerido`).
  await page.getByRole('combobox').filter({ hasText: 'Boleta de Venta' }).click()
  await page.getByRole('option', { name: 'Factura Electrónica' }).click()
  await expect(page.getByText('Datos del cliente').first()).toBeVisible()

  const cobrar = page.getByRole('button', { name: 'Cobrar', exact: true })
  // Con el drawer abierto el fondo queda `aria-hidden` (es modal) y `getByRole`
  // no ve el botón: para mirar su estado sin cerrarlo, un locator CSS.
  const cobrarDetras = page.locator('button').filter({ hasText: /^\s*Cobrar\s*$/ })

  // 1. Solo el nombre: la factura no se cobra.
  await escribir(page, 'Nombre o razón social', 'Constructora Los Andes SpA')
  await expect(cobrarDetras).toBeDisabled()

  // 2. Todo completo pero con el DV equivocado: el campo lo avisa y sigue frenado.
  await escribir(page, '12.345.678-5', '76.543.210-5')
  await escribir(page, 'Actividad del cliente, abreviada', 'Construcción de obras menores')
  await escribir(page, 'Calle y número', 'Av. Matta 1234')
  await escribir(page, 'Comuna', 'Santiago')
  await expect(page.getByText('RUT inválido')).toBeVisible()
  await expect(cobrarDetras).toBeDisabled()

  // 3. Con el RUT bien, se habilita.
  await escribir(page, '12.345.678-5', '76.543.210-3')
  await expect(page.getByText('RUT inválido')).toHaveCount(0)
  await page.getByRole('button', { name: 'Listo' }).click()
  await expect(cobrar).toBeEnabled()

  await cobrar.click()
  const cobro = page.getByRole('dialog').filter({ hasText: 'Cobrar venta' })
  const respuesta = page.waitForResponse(
    r => r.url().endsWith('/ventas') && r.request().method() === 'POST',
  )
  await cobro.getByRole('button', { name: 'Confirmar venta' }).click()
  const res = await respuesta
  expect(res.status()).toBe(201)
  const ventaId = ((await res.json()) as { id: string }).id

  // 4. Lo que quedó congelado en el servidor: el RUT normalizado y el resto tal
  //    cual lo tipeó el cajero.
  const venta = await api<VentaServidor>(request, 'get', `/ventas/${ventaId}`, { token })
  expect(venta.tipoDocumento?.codigo).toBe('33')
  expect(venta.customer).toMatchObject({
    nombre: 'Constructora Los Andes SpA',
    rut: '76543210-3',
    giro: 'Construcción de obras menores',
    direccion: 'Av. Matta 1234',
    comuna: 'Santiago',
  })
})
