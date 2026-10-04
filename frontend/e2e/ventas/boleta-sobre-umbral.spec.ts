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
 * Una boleta de más de 135 UF lleva el nombre y el RUT de quien paga (Res. Ex.
 * SII 44/2025, art. 92 ter del Código Tributario). Lo que agrega sobre los specs
 * de componente y el e2e de API es la cadena en el navegador: que la pantalla
 * tome el umbral que devuelve `GET /tipos-documento`, abra sola el formulario
 * del cliente cuando el total lo pasa, no deje cobrar sin RUT y que el servidor
 * congele lo que el cajero tipeó.
 *
 * Las precondiciones (caja e ítem) se montan por API, como en `factura-receptor.spec.ts`.
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

/** Los campos arrancan `readonly` y lo pierden al recibir el foco: primero click. */
async function escribir(page: Page, placeholder: string, valor: string) {
  const campo = page.getByPlaceholder(placeholder, { exact: true })
  await campo.click()
  await campo.fill(valor)
}

interface VentaServidor {
  customer: Record<string, string | null> | null
}

test('sobre el umbral la boleta pide nombre y RUT de quien paga, y congela lo tipeado', async ({ page, request }) => {
  const token = escenario.token!
  // $6.000.000 pasa el umbral de 2025 y el de 2026.
  const item = await crearProducto(request, token, {
    nombre: `POS sobre umbral ${Date.now()}`,
    precioBase: '6000000',
  })
  escenario.itemIds.push(item.id)

  await page.goto('/ventas/pos')
  await page.locator(`[data-qa="item-catalogo-${item.id}"]`).click()

  // Con la boleta y el total sobre el umbral, el formulario del cliente se abre solo:
  // el drawer, no el botón "Agregar datos del cliente", que está siempre.
  await expect(page.getByRole('dialog').filter({ hasText: 'Datos del cliente' })).toBeVisible()
  await expect(page.getByPlaceholder('12.345.678-5', { exact: true })).toBeVisible()
  await expect(page.locator('[data-qa="aviso-identidad-pagador"]')).toContainText('nombre y el RUT de quien paga')

  // Con el drawer abierto el fondo queda `aria-hidden`: el botón se mira por CSS.
  const cobrarDetras = page.locator('button').filter({ hasText: /^\s*Cobrar\s*$/ })
  await expect(cobrarDetras).toBeDisabled()

  // Solo el nombre: no se cobra.
  await escribir(page, 'Nombre o razón social', 'Juana Pérez Soto')
  await expect(cobrarDetras).toBeDisabled()

  // Con el RUT, se habilita.
  await escribir(page, '12.345.678-5', '12.345.678-5')
  await page.getByRole('button', { name: 'Listo' }).click()
  const cobrar = page.getByRole('button', { name: 'Cobrar', exact: true })
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

  const venta = await api<VentaServidor>(request, 'get', `/ventas/${ventaId}`, { token })
  expect(venta.customer).toMatchObject({ nombre: 'Juana Pérez Soto', rut: '12345678-5' })
})
