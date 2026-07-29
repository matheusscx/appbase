import { test, expect, type Page } from '@playwright/test'

// Vigila en navegador real la forma de desborde documentada en
// docs/patterns/frontend.md §16: `truncate` en un DESCENDIENTE de un ítem flex/grid
// cuyo propio `overflow` es `visible`. `truncate` trae `white-space: nowrap`, así que el
// min-content de ese bloque es el ancho COMPLETO del texto; si el ítem ancestro no tiene
// `overflow` distinto de `visible` (p. ej. `min-w-0`), se niega a encoger y desborda él
// (y arrastra a la fila). La forma inversa — `truncate` en el propio ítem flex/grid — es
// segura por construcción (su `overflow: hidden` ya fija el mínimo en 0): **medido** en
// flex (docs/patterns/frontend.md §16, casos A/A2/A3); en grid no se midió esa forma
// segura, se infiere de la misma regla de mínimo automático (CSS Grid §6.6 replica
// Flexbox §4.5) — igual que el propio §16 distingue medición de inferencia, no
// asumirlo sin medir si algún día importa.
//
// El detector NO busca la clase `.truncate` (implementación de Tailwind, puede cambiar)
// sino el criterio exacto que hace inevitable el desborde: `white-space: nowrap` **y**
// `overflow-x: hidden` computados a la vez (no "su efecto" en general — `nowrap` sin
// `hidden`, o un `overflow-x: clip`, no matchean este filtro; ver hueco de cobertura en
// `docs/agent/pendientes.md`), y solo mira el ítem flex/grid ancestro MÁS CERCANO de cada
// bloque truncado — el elemento cuyo propio padre es flex/grid, sea o no el mismo
// elemento que trunca. Si ese ítem ya no tiene `overflow-x: visible`, el bloque truncado
// no puede ser causa de ningún desborde y se descarta sin mirar más arriba en el árbol.
// Esto importa: un chequeo que marcara
// cualquier ancestro que simplemente CONTENGA un `.truncate` en algún lado (sin esta
// relación de ítem/descendiente) puede confundir un desborde de layout ajeno —p. ej. un
// contenedor de terceros con ancho fraccionario— con este bug, solo porque ese contenedor
// también tiene, en otra parte de su árbol, algún texto truncado ya seguro.
async function elementosQueDesbordan(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    function esFlexOGrid(display: string) {
      return (
        display === 'flex' || display === 'inline-flex' || display === 'grid' || display === 'inline-grid'
      )
    }
    function esBloqueTruncado(el: Element) {
      const cs = getComputedStyle(el)
      return cs.whiteSpace === 'nowrap' && cs.overflowX === 'hidden'
    }
    // Bloques truncados cuyo ítem flex/grid ancestro más cercano sigue con overflow
    // visible (la forma insegura); los que ya tienen su ítem protegido, o que no viven
    // dentro de ningún contexto flex/grid, no son candidatos a este bug.
    const truncadosInseguros: Element[] = []
    for (const t of document.querySelectorAll<HTMLElement>('*')) {
      if (!esBloqueTruncado(t)) continue
      const padre = t.parentElement
      if (!padre) continue
      if (esFlexOGrid(getComputedStyle(padre).display)) continue // t mismo es el ítem: seguro
      let item: HTMLElement | null = padre
      while (item && item !== document.documentElement) {
        const abuelo = item.parentElement
        if (abuelo && esFlexOGrid(getComputedStyle(abuelo).display)) {
          if (getComputedStyle(item).overflowX === 'visible') truncadosInseguros.push(t)
          break
        }
        item = abuelo
      }
    }
    if (truncadosInseguros.length === 0) return []

    const hallados: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>('*')) {
      if (getComputedStyle(el).overflowX !== 'visible') continue
      if (el.scrollWidth <= el.clientWidth + 1) continue
      if (!truncadosInseguros.some((t) => el.contains(t))) continue
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

// Las 4 rutas cubren cada arquetipo de layout distinto que la app muestra en un `goto`
// limpio (sin interacción previa): tarjetas del dashboard (`/`), grilla de catálogo +
// panel de carrito a dos columnas (`/tienda` — el carrito arranca vacío en un `goto`
// limpio, así que esto ejercita el layout de dos columnas, no las advertencias de precio
// con contenido), tabla de muchas columnas (`/inventario`), y grilla de mesas tipo
// floor-plan (`/salones` — el drawer lateral de la cuenta arranca cerrado
// (`mesaDrawerOpen = ref(false)` en `app/pages/salones/index.vue`) y no se monta en un
// `goto` limpio, así que esta ruta no ejercita ese arquetipo, solo la grilla de mesas).
// El resto de las rutas de la app (listados de ventas/terceros/cajas/pagos/
// suscripciones/mermas/órdenes/propinas/sesiones-garzón/recuentos, configuración) son
// variaciones del arquetipo de tabla o de formulario y no agregan una forma de markup
// distinta — mantenerlas fuera del barrido cuida el presupuesto del job
// `e2e-navegador`, que en CI corre en serie (`workers: 1` en `playwright.config.ts`).
const RUTAS: Array<{ ruta: string; titulo: string }> = [
  { ruta: '/', titulo: 'Inicio' },
  { ruta: '/tienda', titulo: 'Tienda Online' },
  { ruta: '/inventario', titulo: 'Inventario' },
  { ruta: '/salones', titulo: 'Salones' },
]

const VIEWPORTS = [
  { width: 1280, height: 800 }, // escritorio
  { width: 768, height: 1024 }, // tablet — los dos anchos soportados (docs/PRODUCTO.md)
]

for (const viewport of VIEWPORTS) {
  test.describe(`sin desborde a ${viewport.width}px`, () => {
    test.use({ viewport })

    for (const { ruta, titulo } of RUTAS) {
      test(`${ruta}`, async ({ page }) => {
        // networkidle: mismo criterio que auth.setup.ts — esperar a que Nuxt hidrate
        // y las cargas de datos terminen antes de medir layout; sin esperas fijas.
        await page.goto(ruta, { waitUntil: 'networkidle' })

        // La ruta cargó de verdad (no quedó en login ni en blanco): sin esto, un tenant
        // sin el módulo de la ruta, o una carga de datos fallada, dejarían la página
        // vacía y el barrido de abajo pasaría en verde sin medir nada.
        await expect(page).not.toHaveURL(/\/login/)
        // .first(): algunas páginas (p. ej. /inventario) repiten el título como <h1> del
        // navbar Y como encabezado propio del cuerpo; cualquiera de los dos visible ya
        // prueba que la ruta cargó contenido real, no una redirección o pantalla vacía.
        await expect(page.getByRole('heading', { level: 1, name: titulo }).first()).toBeVisible()

        expect(await paginaSinScrollHorizontal(page)).toBe(true)
        expect(await elementosQueDesbordan(page)).toEqual([])
      })
    }
  })
}

// El barrido de arriba está en verde hoy porque no hay ningún desborde real en estas
// rutas — no porque el detector sea decorativo. Esta prueba inyecta en una página real la
// forma de markup que SÍ rompe (`truncate` en un descendiente de un `<div class="flex-1">`
// sin `min-w-0`, dentro de un host de 300px — docs/patterns/frontend.md §16) y confirma
// que el detector la marca. Si esto pasa junto con el resto, el verde de arriba significa
// algo.
//
// El texto lleva ESPACIOS a propósito (no un token largo sin cortes): un token
// irrompible desbordaría igual con o sin `truncate` (su min-content es el ancho completo
// por sí solo), así que no probaría el mecanismo. Verificado manualmente: con este mismo
// texto, forzar `whiteSpace = 'normal'` sobre el `<p>` (mutando el efecto de `truncate`)
// hace que el host DEJE de desbordar — el texto envuelve a dos líneas en vez de forzar el
// ancho completo — confirmando que la detección depende de `white-space: nowrap`, no del
// simple largo del texto.
test('el detector marca el markup roto conocido (truncate en descendiente sin min-w-0)', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'networkidle' })

  await page.evaluate(() => {
    const host = document.createElement('div')
    host.id = 'host-sanity-desborde'
    host.className = 'flex'
    host.style.width = '300px' // mismo ancho de host medido en docs/patterns/frontend.md §16

    const item = document.createElement('div')
    item.className = 'flex-1' // sin min-w-0: la forma que rompe

    const p = document.createElement('p')
    p.className = 'truncate'
    p.textContent = 'Descuento por promoción de temporada aplicado sobre el subtotal del carrito'
    item.appendChild(p)
    host.appendChild(item)
    document.body.appendChild(host)
  })

  const hallados = await elementosQueDesbordan(page)
  expect(hallados.some((h) => h.includes('host-sanity-desborde'))).toBe(true)

  await page.evaluate(() => document.getElementById('host-sanity-desborde')?.remove())
})
