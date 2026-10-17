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

test('el admin ve los nueve grupos en orden y ninguna etiqueta se corta', async ({ page }) => {
  await page.goto('/configuracion/perfil')
  const menu = menuConfiguracion(page)

  await expect(menu.locator('[data-slot="label"]')).toHaveText([
    'Mi cuenta', 'Organización', 'Catálogo', 'Precios', 'Cobros', 'Caja', 'Inventario', 'Restaurante', 'Paquetería',
  ])
  // 28 de siempre (con Conceptos de movimientos, 03.28) + Boleta electrónica, que ve todo admin del tenant (el del e2e lo es; el que no
  // es superadmin, en el test de más abajo) + las 2 de Paquetería, que Paris contrata:
  // `configuracion.nuxt.spec.ts` fija el árbol.
  await expect(menu.getByRole('link')).toHaveCount(31)

  // `truncate` corta con elipsis sin avisar: el texto completo sigue en el DOM, así que
  // un `toHaveText` pasa igual. Lo que delata el corte es el ancho.
  // Contadas antes de medir: sobre un locator vacío `evaluateAll` devuelve `[]` y pasa.
  // Acotadas a los links: el encabezado de cada grupo también lleva un `linkLabel`.
  const etiquetas = menu.locator('[data-slot="link"] [data-slot="linkLabel"]')
  await expect(etiquetas).toHaveCount(31)
  const cortadas = await etiquetas.evaluateAll(els =>
    els.filter(el => el.scrollWidth > el.clientWidth).map(el => el.textContent),
  )
  expect(cortadas).toEqual([])

  await menu.getByRole('link', { name: 'Productos', exact: true }).click()
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
    await expect(menu.getByRole('link')).toHaveText(['Perfil', 'Productos', 'Salones y mesas', 'Garzones', 'Turnos'])
    await expect(menu.locator('[data-slot="separator"]')).toHaveCount(2)
  })
})

test.describe('admin de un comercio, sin ser superadmin', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  // Hasta la boleta desde la venta la entrada era solo del superadmin. El admin del e2e lo es, así que la
  // mitad que importa —el dueño de un local— solo se prueba con `admin.paris`, que es
  // Administrador de Paris y no superadmin.
  test('ve Boleta electrónica en Organización y abre la pantalla', async ({ page }) => {
    await entrarComo(page, 'admin.paris@paris.cl')

    await page.goto('/configuracion/perfil')
    const menu = menuConfiguracion(page)
    // 29 + Paquetería (2): `mis-permisos` le trae `Paquetería:Leer` porque Paris la contrata.
    await expect(menu.getByRole('link')).toHaveCount(31)

    await menu.getByRole('link', { name: 'Boleta electrónica', exact: true }).click()
    await page.waitForURL('**/configuracion/boleta-electronica')
    await expect(page.getByRole('heading', { name: 'Boleta electrónica' })).toBeVisible()
    await expect(page.getByText('Emitir boletas electrónicas', { exact: true })).toBeVisible()
  })
})
