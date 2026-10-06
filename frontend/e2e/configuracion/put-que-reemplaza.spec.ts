import type { Page } from '@playwright/test'
import { test, expect } from '../support/sesion'
import { api, tokenDe, TENANTS } from '../support/api'

/**
 * Las dos pantallas que guardan con un `PUT` que reemplaza la config entera.
 *
 * **Por qué vive acá y no en el unit.** Desde el 2026-10-04 el backend rechaza con 400 un
 * campo omitido en esos `PUT` (`baseVentas`, `activo`, `orden` y `pesos` de cada grupo de
 * propinas; `promosAcumulanDescuentos` de las preferencias), en vez de escribir el default.
 * Los `.nuxt.spec.ts` corren contra un mock de `useApiFetch` que contesta 200 a cualquier
 * body, así que no pueden ver que la pantalla deje de pasar el DTO real. Pasó: la de
 * propinas mandaba `pesos: undefined` —que el JSON omite— en todo grupo que no fuera
 * MANUAL con pesos, y con la regla nueva el guardado del seed daba 400.
 *
 * Guardar sin tocar nada reenvía lo mismo que había: el test no deja estado distinto (la
 * versión de la distribución sube en uno, que no se lee en ningún otro spec).
 */

let token = ''

/** El PUT da de baja los grupos y los vuelve a crear: el `id` cambia siempre. */
function sinId(grupos: object[]) {
  return grupos.map(({ id: _id, ...resto }: { id?: string }) => resto)
}

test.beforeAll(async ({ request }) => {
  token = await tokenDe(request, TENANTS.restaurante)
})

/** Hace click en Guardar y devuelve el body que salió y el status que volvió. */
async function guardar(page: Page, ruta: string) {
  const respuesta = page.waitForResponse(
    r => r.url().endsWith(ruta) && r.request().method() === 'PUT',
  )
  await page.getByRole('button', { name: 'Guardar' }).click()
  const r = await respuesta
  return {
    status: r.status(),
    body: r.request().postDataJSON() as Record<string, unknown>,
  }
}

test('distribución de propinas: guardar sin cambios pasa el DTO y no mueve nada', async ({ page, request }) => {
  const antes = await api<{ grupos: object[] }>(request, 'get', '/propinas/distribucion', { token })
  // El caso que rompía es un grupo que no es MANUAL con pesos: el seed lo tiene.
  expect(antes.grupos.some(g => (g as { criterio: string }).criterio !== 'MANUAL')).toBe(true)

  await page.goto('/configuracion/propinas-distribucion')
  await expect(page.getByRole('button', { name: 'Guardar' })).toBeEnabled()

  const { status, body } = await guardar(page, '/propinas/distribucion')
  expect(status).toBe(200)
  for (const grupo of body.grupos as Record<string, unknown>[]) {
    expect(Object.keys(grupo)).toEqual(
      expect.arrayContaining(['baseVentas', 'activo', 'orden', 'pesos']),
    )
  }
  await expect(page.getByText('Distribución guardada', { exact: true })).toBeVisible()

  const despues = await api<{ grupos: object[] }>(request, 'get', '/propinas/distribucion', { token })
  expect(sinId(despues.grupos)).toEqual(sinId(antes.grupos))
})

test('preferencias financieras: guardar sin cambios pasa el DTO y no mueve nada', async ({ page, request }) => {
  const antes = await api<object>(request, 'get', '/tenants/preferencias-financieras', { token })

  await page.goto('/configuracion/preferencias-financieras')
  await expect(page.getByText('Promociones y descuentos')).toBeVisible()

  const { status, body } = await guardar(page, '/tenants/preferencias-financieras')
  expect(status).toBe(200)
  expect(body).toHaveProperty('promosAcumulanDescuentos')
  await expect(page.getByText('Preferencias actualizadas', { exact: true })).toBeVisible()

  const despues = await api<object>(request, 'get', '/tenants/preferencias-financieras', { token })
  expect(despues).toEqual(antes)
})
