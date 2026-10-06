import type { Page } from '@playwright/test'
import { test, expect } from '../support/sesion'
import { entrarComo } from '../support/ui'

/**
 * El menú de Configuración agrupado, montado en el navegador.
 *
 * `app/pages/configuracion.nuxt.spec.ts` fija el árbol y el gate de cada entrada con un
 * store mockeado. Acá va lo que solo se ve con la app real: que el rol del tenant —cuyos
 * permisos llegan después de montar el menú, a diferencia del admin del e2e, que es
 * superadmin y pasa `can()` sin esperarlos— vea sus grupos tras un F5, y que con el ancho
 * de la columna ninguna etiqueta se corte.
 */

/** El `<nav>` de Configuración, no el del menú lateral: es el único con un link "Perfil". */
function menuConfiguracion(page: Page) {
  return page.locator('nav').filter({ has: page.getByRole('link', { name: 'Perfil', exact: true }) })
}

test('el admin ve los ocho grupos en orden y ninguna etiqueta se corta', async ({ page }) => {
  await page.goto('/configuracion/perfil')
  const menu = menuConfiguracion(page)

  await expect(menu.locator('[data-slot="label"]')).toHaveText([
    'Mi cuenta', 'Organización', 'Catálogo', 'Precios', 'Cobros', 'Caja', 'Inventario', 'Restaurante',
  ])
  await expect(menu.getByRole('link')).toHaveCount(27)

  // `truncate` corta con elipsis sin avisar: el texto completo sigue en el DOM, así que
  // un `toHaveText` pasa igual. Lo que delata el corte es el ancho.
  // Contadas antes de medir: sobre un locator vacío `evaluateAll` devuelve `[]` y pasa.
  // Acotadas a los links: el encabezado de cada grupo también lleva un `linkLabel`.
  const etiquetas = menu.locator('[data-slot="link"] [data-slot="linkLabel"]')
  await expect(etiquetas).toHaveCount(27)
  const cortadas = await etiquetas.evaluateAll(els =>
    els.filter(el => el.scrollWidth > el.clientWidth).map(el => el.textContent),
  )
  expect(cortadas).toEqual([])

  await menu.getByRole('link', { name: 'Items', exact: true }).click()
  await page.waitForURL('**/configuracion/items')
})

test.describe('rol del tenant con permisos parciales', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('el encargado del salón ve Perfil, Items y su grupo, aun después de un F5', async ({ page }) => {
    await entrarComo(page, 'encargado.salon@paris.cl')

    // Entrada en frío: el menú se monta antes de que lleguen los permisos.
    await page.goto('/configuracion/perfil')
    const menu = menuConfiguracion(page)

    await expect(menu.locator('[data-slot="label"]')).toHaveText(['Mi cuenta', 'Catálogo', 'Restaurante'])
    await expect(menu.getByRole('link')).toHaveText(['Perfil', 'Items', 'Salones', 'Garzones', 'Turnos'])
    await expect(menu.locator('[data-slot="separator"]')).toHaveCount(2)
  })
})
