import type { Page } from '@playwright/test'
import { test, expect } from '../support/sesion'

// Auditoría UX 07.23: con `ssr: false`, `@nuxt/icon` pedía en runtime al API público de Iconify
// los íconos que no había encontrado al escanear (el escaneo no miraba los `.ts`, donde viven
// los del menú de Configuración), y el CSS que armaba con esa respuesta salía corrido:
// "Productos" dibujaba el ícono de "Pasarelas de pago". Ahora todos van en el bundle.

const menuConfiguracion = (page: Page) =>
  page.locator('nav').filter({ has: page.getByRole('link', { name: 'Perfil', exact: true }) })

const PANTALLAS = ['/', '/configuracion/perfil', '/ventas/pos', '/salones', '/cajas', '/compras']

test('ninguna pantalla pide íconos al API de Iconify en runtime', async ({ page }) => {
  const remotos: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('api.iconify.design')) remotos.push(r.url())
  })
  for (const ruta of PANTALLAS) {
    await page.goto(ruta)
    await page.waitForLoadState('networkidle')
  }
  expect(remotos).toEqual([])
})

test('cada entrada del menú de Configuración dibuja un ícono, y no el de otra', async ({ page }) => {
  await page.goto('/configuracion/perfil')
  const menu = menuConfiguracion(page)
  await expect(menu.getByRole('link').first()).toBeVisible()

  const mascaras = await menu.getByRole('link').evaluateAll(links => links.map((a) => {
    const icono = a.querySelector('.iconify')
    return { label: (a.textContent || '').trim(), mascara: icono ? getComputedStyle(icono).maskImage : 'none' }
  }))
  expect(mascaras.filter(m => m.mascara === 'none').map(m => m.label)).toEqual([])

  // El cruce de 07.23: dos entradas con íconos distintos no pueden dibujar el mismo SVG.
  const de = (label: string) => mascaras.find(m => m.label === label)!.mascara
  expect(de('Productos')).not.toBe(de('Pasarelas de pago'))
  expect(de('Pasarelas de pago')).not.toBe(de('Usuarios'))
})
