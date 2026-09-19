import { test, expect } from '@playwright/test'
import { api, tokenDe, TENANTS } from '../support/api'

/**
 * Smoke del corte del día de negocio (spec
 * `docs/superpowers/specs/2026-09-18-hora-de-corte-dia-negocio-design.md` § 3.1):
 * cambiar "Fin del día" en Empresa prende `<DiaNegocioNota />` y volver a 00:00
 * la apaga (qué pantallas mira, abajo).
 *
 * Encendido (corte 05:00): verifica la nota en `anulaciones.vue` (le pasa
 * `horaCorte` como prop) y en `ordenes.vue` (nota sin prop, con su propio fetch
 * a `/tenants/me`).
 *
 * Apagado (vuelve a 00:00): verifica la nota SOLO en `anulaciones.vue`. El camino
 * sin prop con corte 0 se cubre solo en el spec unitario de `DiaNegocioNota`.
 *
 * No cubre este smoke: `propinas/index.vue`, `mermas.vue`, `sesiones-garzon.vue`
 * ni `CajaTendencia.vue`. Los últimos tres tienen spec unitario de la nota;
 * `propinas/index.vue` no tiene, en ninguna capa.
 *
 * ⚠️ El selector de "Fin del día" es un `USelect` de Nuxt UI, no un
 * `USelectMenu`: su trigger lleva como nombre accesible la etiqueta del campo
 * ("Fin del día"), no "Show popup" — por eso no reusa `elegirEnSelector` de
 * `support/ui.ts`, que busca el trigger por ese label fijo.
 *
 * El tenant queda en 00:00 pase lo que pase: el `finally` lo restaura por API,
 * sin depender de que la UI siga funcionando si el test se cae a mitad de camino.
 */

async function elegirFinDelDia(
  page: import('@playwright/test').Page,
  etiqueta: '00:00' | '05:00',
): Promise<void> {
  await page.getByRole('combobox', { name: 'Fin del día' }).click()
  await page.getByRole('option', { name: etiqueta, exact: true }).click()
  await page
    .getByRole('button', { name: 'Guardar cambios' })
    .click()
  await expect(page.getByText('Datos de empresa actualizados').first()).toBeVisible()
}

test('cambiar el corte prende y apaga la nota del día de negocio', async ({
  page,
  request,
}) => {
  const token = await tokenDe(request, TENANTS.restaurante)

  try {
    await page.goto('/configuracion/empresa', { waitUntil: 'networkidle' })
    await elegirFinDelDia(page, '05:00')

    await page.goto('/salones/anulaciones')
    await expect(page.getByText('Tu día va de 05:00 a 05:00')).toBeVisible()

    await page.goto('/ordenes')
    await expect(page.getByText('Tu día va de 05:00 a 05:00')).toBeVisible()

    await page.goto('/configuracion/empresa', { waitUntil: 'networkidle' })
    await elegirFinDelDia(page, '00:00')

    await page.goto('/salones/anulaciones')
    await expect(page.getByText('Tu día va de 05:00 a 05:00')).not.toBeVisible()
  }
  finally {
    await api(request, 'patch', '/tenants/me', {
      token,
      data: { horaCorte: 0 },
    })
  }
})
