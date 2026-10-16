import { test, expect, type Page, type Response } from '@playwright/test'
import { entrarComo } from '../support/ui'

/**
 * El admin de un tenant ve y abre solo los módulos que su tenant contrató (owner, 2026-10-15):
 * el frontend ya no tiene atajo `esAdmin ||` en los gates por módulo, y el backend le contesta
 * 403 en los demás. `admin@paquetes.cl` es el admin de "Demo Gestión de Paquetes", que contrató
 * solo Paquetería, y **no es superadmin**: el admin del resto de los e2e lo es, y a él `can` le
 * da `true` en todo, así que no ve este caso (memoria "probar pantallas con el rol real").
 *
 * Los unitarios ejercen lo mismo con `mis-permisos` mockeado; esto lo prueba contra el
 * `mis-permisos` real del backend.
 */

test.use({ storageState: { cookies: [], origins: [] } })

const ADMIN = 'admin@paquetes.cl'

/** Las respuestas 403 de la API que lleguen mientras corre `accion`. */
async function rechazosDurante(page: Page, accion: () => Promise<void>): Promise<string[]> {
  const rechazos: string[] = []
  const anotar = (r: Response) => {
    if (r.url().includes('/api/') && r.status() === 403) rechazos.push(new URL(r.url()).pathname)
  }
  page.on('response', anotar)
  try {
    await accion()
  }
  finally {
    page.off('response', anotar)
  }
  return rechazos
}

test('Inicio no pide nada de un módulo que el tenant no contrató: ninguna respuesta 403', async ({ page }) => {
  // Desde el login, que ya aterriza en Inicio, y otra vez con la página recargada: la primera
  // carga monta el layout y los bloques con los permisos recién llegados.
  let permisosCargados: string[] | null = null
  const rechazos = await rechazosDurante(page, async () => {
    await entrarComo(page, ADMIN)
    await page.waitForLoadState('networkidle')
    const misPermisos = page.waitForResponse(r => r.url().includes('/api/rbac/mis-permisos'))
    await page.reload({ waitUntil: 'networkidle' })
    const respuesta = await misPermisos
    expect(respuesta.status()).toBe(200)
    permisosCargados = await respuesta.json() as string[]
  })

  // Anclas positivas: sin ellas, una lista vacía también saldría de unos permisos que no
  // cargaron (sin permisos no se monta ningún bloque y no hay nada que rechazar).
  expect(permisosCargados).toContain('Paquetería:Leer')
  await expect(page.locator('[data-qa="menu-lateral"]').getByRole('button', { name: 'Paquetería', exact: true }))
    .toBeVisible()
  // Con el atajo viejo, acá llegaban seis 403: salón, cajas, cierres, stock bajo, pagos web y
  // el resumen del día (medido corriendo este test contra el código anterior).
  expect(rechazos).toEqual([])
})

test('una pantalla de un módulo no contratado rebota a Inicio con el aviso', async ({ page }) => {
  await entrarComo(page, ADMIN)

  for (const { url, aviso } of [
    { url: '/cajas', aviso: 'No tenés acceso al módulo Cajas' },
    { url: '/compras/por-pagar', aviso: 'No tenés acceso al módulo Compras (pagar)' },
  ]) {
    const rechazos = await rechazosDurante(page, async () => {
      await page.goto(url, { waitUntil: 'networkidle' })
      await page.waitForURL(u => u.pathname === '/')
      // `exact`: el aviso está dos veces, en la región `aria-live` y en el título del toast.
      await expect(page.getByText(aviso, { exact: true })).toBeVisible()
    })
    // El middleware corta antes de montar: la pantalla no llega a pedir nada.
    expect(rechazos, url).toEqual([])
  }
})

test('Configuración muestra lo de admin y Paquetería, no los módulos que no contrató', async ({ page }) => {
  await entrarComo(page, ADMIN)
  await page.goto('/configuracion/perfil', { waitUntil: 'networkidle' })

  // Ancla positiva: sin ella, las ausencias de abajo pasarían con el menú sin cargar.
  await expect(page.locator('a[href="/configuracion/empresa"]')).toBeVisible()
  await expect(page.locator('a[href="/configuracion/repartidores"]')).toBeVisible()
  for (const ruta of ['/configuracion/items', '/configuracion/cajas', '/configuracion/salones', '/configuracion/pasarelas']) {
    await expect(page.locator(`a[href="${ruta}"]`), ruta).toHaveCount(0)
  }
})
