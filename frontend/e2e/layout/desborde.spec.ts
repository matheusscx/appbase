import { test, expect, type Page } from '@playwright/test'

// Vigila en navegador real la forma de desborde medida en
// .superpowers/sdd/2026-07-29-playwright-en-ci/investigacion-truncado-report.md
// (Medición 3 y 4): `truncate` en un DESCENDIENTE de un ítem flex/grid cuyo propio
// `overflow` es `visible`. `truncate` trae `white-space: nowrap`, así que el
// min-content de ese bloque es el ancho COMPLETO del texto; si el ítem ancestro no
// tiene `overflow` distinto de `visible` (p. ej. `min-w-0`), se niega a encoger y
// desborda él (y arrastra a la fila). La forma inversa — `truncate` en el propio
// ítem flex — es segura por construcción (su `overflow: hidden` ya fija el mínimo
// en 0) y no hace falta vigilarla.
//
// Detector genérico (idéntico al de la Medición 4, que dio cero falsos positivos en
// 16 rutas × 3 viewports y sí marcó el caso sintético roto): para todo elemento con
// `overflow-x: visible` cuyo `scrollWidth > clientWidth + 1` y que tenga un
// descendiente `.truncate` → es un desborde real.
async function elementosQueDesbordan(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const hallados: string[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      if (!el.querySelector('.truncate')) continue
      if (getComputedStyle(el).overflowX !== 'visible') continue
      if (el.scrollWidth <= el.clientWidth + 1) continue
      const id = el.id ? `#${el.id}` : ''
      const clases = String(el.className || '').trim().replace(/\s+/g, '.')
      hallados.push(`${el.tagName.toLowerCase()}${id}${clases ? '.' + clases : ''}`)
    }
    return hallados
  })
}

async function paginaSinScrollHorizontal(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )
}

// Las 4 rutas cubren cada arquetipo de layout distinto que la app tiene hoy (no las
// 16 que barrió la investigación, que repiten arquetipo): dashboard de tarjetas,
// grilla de catálogo + carrito (donde vivió el bug histórico de AdvertenciasPrecio),
// tabla de muchas columnas, y drawer lateral + grilla de ítems. El resto de las rutas
// (listados de ventas/terceros/cajas/pagos/suscripciones/mermas/órdenes/propinas/
// sesiones-garzón/recuentos, configuración) son variaciones del arquetipo de tabla o
// de formulario y no agregan una forma de markup distinta — mantenerlas fuera del
// barrido cuida el presupuesto de ~5min del job `e2e-navegador` (hoy 2m47s).
const RUTAS = ['/', '/tienda', '/inventario', '/salones']

const VIEWPORTS = [
  { width: 1280, height: 800 }, // escritorio
  { width: 768, height: 1024 }, // tablet — los dos anchos soportados (docs/PRODUCTO.md)
]

for (const viewport of VIEWPORTS) {
  test.describe(`sin desborde a ${viewport.width}px`, () => {
    test.use({ viewport })

    for (const ruta of RUTAS) {
      test(`${ruta}`, async ({ page }) => {
        // networkidle: mismo criterio que auth.setup.ts — esperar a que Nuxt hidrate
        // y las cargas de datos terminen antes de medir layout; sin esperas fijas.
        await page.goto(ruta, { waitUntil: 'networkidle' })

        expect(await paginaSinScrollHorizontal(page)).toBe(true)
        expect(await elementosQueDesbordan(page)).toEqual([])
      })
    }
  })
}

// El spec anterior está en verde hoy porque no hay ningún desborde real (confirmado
// por la investigación) — no porque el detector sea decorativo. Esta prueba inyecta
// en una página real la forma de markup que SÍ rompe (Medición 3, caso B: `truncate`
// en un descendiente de un `<div class="flex-1">` sin `min-w-0`, dentro de un host de
// 300px) y confirma que el detector la marca. Si esto pasa junto con el resto, el
// verde de arriba significa algo.
test('el detector marca el markup roto conocido (truncate en descendiente sin min-w-0)', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'networkidle' })

  await page.evaluate(() => {
    const host = document.createElement('div')
    host.id = 'host-sanity-desborde'
    host.className = 'flex'
    host.style.width = '300px' // mismo ancho de host medido en la Medición 3, caso B

    const item = document.createElement('div')
    item.className = 'flex-1' // sin min-w-0: la forma que rompe

    const p = document.createElement('p')
    p.className = 'truncate'
    // texto sin espacios: su min-content es el ancho completo, muy por sobre 300px,
    // igual que el título de 508px inyectado en la Medición 1/3 de la investigación
    p.textContent = 'DescuentoPromocionalDeTemporadaAplicadoSobreElSubtotalDelCarrito'
    item.appendChild(p)
    host.appendChild(item)
    document.body.appendChild(host)
  })

  const hallados = await elementosQueDesbordan(page)
  expect(hallados.some((h) => h.includes('host-sanity-desborde'))).toBe(true)

  await page.evaluate(() => document.getElementById('host-sanity-desborde')?.remove())
})
