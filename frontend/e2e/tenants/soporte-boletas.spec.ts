import { test, expect } from '../support/sesion'

/**
 * El panel de soporte de `/admin`: las boletas atrasadas y rechazadas de todos los locales. Entra
 * el usuario por defecto de la suite (`admin@sistema.com`), que es superadmin.
 *
 * ⚠️ Playwright no llega a la base: la respuesta de `GET /admin/dte/boletas-con-problemas` va
 * simulada con `page.route`. Lo que se prueba acá es lo que la pantalla pinta con esa forma; el
 * contrato real (qué boleta cae en cada grupo, de qué local) lo fija el e2e de la API en `backend/test/`.
 */

const fila = (over: Record<string, unknown>) => ({
  documentoId: 'doc',
  tenantId: 'tenant',
  tenant: 'Local',
  razonSocial: 'Local SpA',
  ambiente: 'produccion',
  tipo: 39,
  folio: 1,
  emitidaEl: '2026-10-13T15:00:00.000Z',
  grupo: 'atrasada',
  intentos: 2,
  ultimoError: null,
  detalleSii: null,
  ...over,
})

test('el panel de soporte muestra las boletas de dos locales y despliega el detalle de una', async ({ page }) => {
  await page.route('**/api/admin/dte/boletas-con-problemas', route => route.fulfill({
    json: [
      fila({ documentoId: 'doc-a', tenantId: 'tenant-a', tenant: 'Almacén Norte', folio: 7001, grupo: 'atrasada' }),
      fila({
        documentoId: 'doc-r',
        tenantId: 'tenant-r',
        tenant: 'Restaurante Sur',
        folio: 7002,
        tipo: 41,
        grupo: 'rechazada',
        ultimoError: 'El SII rechazó el sobre',
        detalleSii: { estado: 'RCH', glosa: 'Folio repetido en el sobre' },
      }),
    ],
  }))

  await page.goto('/admin')

  const tarjeta = page.locator('[data-qa="soporte-boletas"]')
  await expect(tarjeta).toContainText('Boletas con problemas en el SII')

  const filas = tarjeta.locator('tbody tr')
  await expect(filas).toHaveCount(2)
  await expect(filas.nth(0)).toContainText('Almacén Norte')
  await expect(filas.nth(0)).toContainText('7001')
  await expect(filas.nth(0)).toContainText('Atrasada')
  await expect(filas.nth(1)).toContainText('Restaurante Sur')
  await expect(filas.nth(1)).toContainText('7002')
  await expect(filas.nth(1)).toContainText('Rechazada')

  // Cerrada: el detalle no se ve hasta desplegar la fila.
  await expect(tarjeta.locator('[data-qa="soporte-detalle"]')).toHaveCount(0)

  await filas.nth(1).locator('[data-qa="soporte-desplegar"]').click()

  const detalle = tarjeta.locator('[data-qa="soporte-detalle"]')
  await expect(detalle).toContainText('El SII rechazó el sobre')
  await expect(detalle.locator('pre')).toContainText('Folio repetido en el sobre')
  await expect(tarjeta.locator('[data-qa="soporte-sin-problemas"]')).toHaveCount(0)
})
