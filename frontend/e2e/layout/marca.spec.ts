import { test, expect } from '@playwright/test'

// Identidad de Venka en el tema global (spec 2026-10-13-identidad-venka-en-app §3.1/§3.5).
// Sin sesión: todo se ve en /login.
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('marca Venka', () => {
  test('la pestaña dice Venka', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveTitle(/Venka/)
  })

  test('el botón principal es petróleo', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('button[type="submit"]')).toHaveCSS('background-color', 'rgb(14, 77, 87)')
  })

  test('las fuentes de marca cargan desde la app', async ({ page }) => {
    const externos: string[] = []
    page.on('request', (req) => {
      const { hostname } = new URL(req.url())
      if (hostname === 'fonts.googleapis.com' || hostname === 'fonts.gstatic.com') externos.push(req.url())
    })
    await page.goto('/login')
    // La SPA dibuja después del `goto`: hasta que algo usa cada cara el navegador no la
    // baja, y `document.fonts.ready` resolvería con la lista vacía. El título usa Bricolage
    // (`font-display`) y el rótulo del campo, DM Sans.
    await expect(page.getByRole('heading', { name: 'Ingresa a tu caja' })).toBeVisible()
    await expect(page.getByText('Contraseña', { exact: true })).toBeVisible()
    await page.evaluate(() => document.fonts.ready)

    // `document.fonts.check` devuelve true aunque la fuente no exista: se mira el estado de cada cara.
    const cargadas = await page.evaluate(() =>
      [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/["']/g, '')))
    expect(cargadas).toContain('DM Sans')
    expect(cargadas).toContain('Bricolage Grotesque')
    expect(externos).toEqual([])
  })

  // Auditoría UX 00.8 (owner, 2026-10-16, opción B): los tonos de estado de Nuxt UI por
  // defecto medían 2,22 / 1,91 / 3,81 sobre blanco. Se mide lo que resuelve el navegador
  // —`app.config` + escalas de `main.css`—, no el hex escrito, y su contraste como texto
  // sobre blanco y sobre el fondo `/10` de insignias y alertas suaves.
  test('los tonos de estado se leen como texto', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('button[type="submit"]')).toBeVisible()
    const medidos = await page.evaluate(() => {
      const canal = (c: number) => {
        const v = c / 255
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      }
      const lum = ([r, g, b]: number[]) => 0.2126 * canal(r!) + 0.7152 * canal(g!) + 0.0722 * canal(b!)
      const contraste = (a: number[], b: number[]) => {
        const [x, y] = [lum(a), lum(b)].sort((m, n) => m - n)
        return (y! + 0.05) / (x! + 0.05)
      }
      return Object.fromEntries(['success', 'warning', 'error'].map((tono) => {
        const el = document.createElement('span')
        el.style.color = `var(--ui-${tono})`
        document.body.appendChild(el)
        const rgb = getComputedStyle(el).color.match(/\d+/g)!.slice(0, 3).map(Number)
        el.remove()
        const blanco = [255, 255, 255]
        const fondo10 = rgb.map(c => Math.round(255 + (c - 255) * 0.1))
        return [tono, { rgb: rgb.join(','), blanco: contraste(rgb, blanco), fondo10: contraste(rgb, fondo10) }]
      }))
    })
    expect(medidos.success!.rgb).toBe('0,120,111') // #00786F
    expect(medidos.warning!.rgb).toBe('197,60,0') // #C53C00
    expect(medidos.error!.rgb).toBe('193,0,7') // #C10007
    for (const m of Object.values(medidos)) {
      expect(m.blanco).toBeGreaterThanOrEqual(4.5)
      expect(m.fondo10).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('a 1280 se ve el panel de marca', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/login')
    const panel = page.locator('[data-qa="marco-lateral"]')
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Tu caja,')).toBeVisible()
    await expect(panel.getByText('a la vista.')).toBeVisible()
    await expect(panel.locator('img[alt="Venka"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Ingresa a tu caja' })).toBeVisible()
  })

  test('a 768 solo el formulario', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto('/login')
    await expect(page.locator('[data-qa="marco-lateral"]')).toBeHidden()
    await expect(page.locator('main img[alt="Venka"]')).toBeVisible()
    await expect(page.getByPlaceholder('tu@email.com')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('el link de contraseña va junto al rótulo', async ({ page }) => {
    await page.goto('/login')
    const link = page.getByRole('link', { name: '¿Olvidaste tu contraseña?' })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', '/forgot-password')

    // "Junto al rótulo": mismo renglón (centros verticales a menos de 12 px).
    const rotulo = page.getByText('Contraseña', { exact: true })
    const [cajaLink, cajaRotulo] = [await link.boundingBox(), await rotulo.boundingBox()]
    expect(cajaLink).not.toBeNull()
    expect(cajaRotulo).not.toBeNull()
    const centro = (c: { y: number, height: number }) => c.y + c.height / 2
    expect(Math.abs(centro(cajaLink!) - centro(cajaRotulo!))).toBeLessThan(12)
  })

  test('las cifras de DM Sans miden lo mismo', async ({ page }) => {
    await page.goto('/login')
    // La cara solo baja cuando algo la usa: se espera a que el título pinte y se la pide
    // por nombre en cada peso que mide la prueba.
    await expect(page.getByText('Contraseña', { exact: true })).toBeVisible()
    // Los diez dígitos, en varios pesos y en dos tamaños (el tamaño mueve el eje óptico).
    // El motor de fuentes de Linux (FreeType) lee el avance de los puntos fantasma del
    // glifo y el de macOS lo lee de HVAR: la fuente tiene que decir lo mismo en los dos
    // sitios, y esta prueba corre en CI sobre Linux, no solo en un Mac.
    const pesos = [400, 500, 600, 700]
    const tamanos = [14, 32]
    const medidas = await page.evaluate(async ({ pesos, tamanos }) => {
      const medir = (texto: string, peso: number, tamano: number) => {
        const span = document.createElement('span')
        span.textContent = texto
        span.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${peso} ${tamano}px 'DM Sans'`
        document.body.appendChild(span)
        const ancho = span.getBoundingClientRect().width
        span.remove()
        return ancho
      }
      await Promise.all(pesos.flatMap(p => tamanos.map(t => document.fonts.load(`${p} ${t}px 'DM Sans'`, '0123456789'))))
      await document.fonts.ready
      const cara = [...document.fonts].find(f => f.family.replace(/["']/g, '') === 'DM Sans')
      const filas = pesos.flatMap(peso => tamanos.map((tamano) => {
        const anchos = [...'0123456789'].map(d => medir(d.repeat(10), peso, tamano))
        return { peso, tamano, dif: Math.max(...anchos) - Math.min(...anchos) }
      }))
      return { estado: cara?.status, filas }
    }, { pesos, tamanos })

    expect(medidas.estado).toBe('loaded')
    // Cifras de ancho fijo: la columna de montos se alinea sin `tabular-nums`.
    for (const fila of medidas.filas) expect(fila.dif, `${fila.peso} a ${fila.tamano}px`).toBeLessThanOrEqual(0.5)
  })
})
