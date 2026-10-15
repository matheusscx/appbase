import { test, expect } from '@playwright/test'
import { entrarComo } from '../support/ui'

/**
 * La tarjeta "Boletas con observaciones del SII" de `/configuracion/boleta-electronica`, como el
 * dueño de un local (`admin.paris@paris.cl`: Administrador del tenant, no superadmin, igual que
 * `emision-boletas.spec.ts`).
 *
 * ⚠️ Playwright no llega a la base: la respuesta de `GET /dte/boletas-con-problemas` va simulada
 * con `page.route`. Lo que se prueba acá es lo que la pantalla pinta con esa forma; el contrato
 * real (qué boleta cae en qué grupo, el motivo) lo fija el e2e de la API en `backend/test/`.
 */

const ADMIN_PARIS = { email: 'admin.paris@paris.cl', password: 'admin' }

test.use({ storageState: { cookies: [], origins: [] } })

const fila = (over: Record<string, unknown>) => ({
  documentoId: 'doc',
  ventaId: null,
  tipo: 39,
  folio: 1,
  emitidaEl: '2026-10-13T15:00:00.000Z',
  monto: '11900',
  motivo: null,
  ...over,
})

test('la tarjeta muestra los tres grupos con su texto fijo y el motivo de cada boleta', async ({ page }) => {
  await page.route('**/api/dte/boletas-con-problemas', route => route.fulfill({
    json: {
      atrasadas: [fila({ documentoId: 'doc-a', folio: 9001, motivo: 'El SII todavía no la acusa' })],
      rechazadas: [fila({ documentoId: 'doc-r', folio: 9002, tipo: 41, motivo: 'El SII la rechazó por el RUT del emisor' })],
      conReparos: [fila({ documentoId: 'doc-c', folio: 9003, motivo: 'La comuna del emisor no coincide' })],
    },
  }))

  await entrarComo(page, ADMIN_PARIS.email, ADMIN_PARIS.password)
  await page.goto('/configuracion/boleta-electronica')

  const tarjeta = page.locator('[data-qa="boletas-con-problemas"]')
  await expect(tarjeta).toContainText('Boletas con observaciones del SII')

  const atrasadas = tarjeta.locator('[data-qa="grupo-atrasadas"]')
  await expect(atrasadas).toContainText('Atrasadas')
  await expect(atrasadas).toContainText('El sistema la sigue enviando; no tienes que hacer nada. Si pasa de un día, escribe a soporte con el folio.')
  await expect(atrasadas).toContainText('El SII todavía no la acusa')

  const rechazadas = tarjeta.locator('[data-qa="grupo-rechazadas"]')
  await expect(rechazadas).toContainText('Rechazadas')
  await expect(rechazadas).toContainText('No la vuelvas a emitir: escribe a soporte con el folio.')
  await expect(rechazadas).toContainText('El SII la rechazó por el RUT del emisor')

  const conReparos = tarjeta.locator('[data-qa="grupo-con-reparos"]')
  await expect(conReparos).toContainText('Con reparos (últimos 30 días)')
  await expect(conReparos).toContainText('Es válida. Revisa el aviso del SII para corregirlo en las próximas boletas.')
  await expect(conReparos).toContainText('La comuna del emisor no coincide')

  await expect(tarjeta.locator('[data-qa="sin-observaciones"]')).toHaveCount(0)
})
