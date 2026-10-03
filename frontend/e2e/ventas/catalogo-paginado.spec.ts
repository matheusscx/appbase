import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { test, expect } from '../support/sin-qz-tray'
import {
  abrirCaja,
  api,
  API,
  cerrarCaja,
  crearProducto,
  limpiarItems,
  tokenDe,
  TENANTS,
} from '../support/api'
import { elegirEnSelector, entrarComo, rondaDePin, valorDeFila, valorDelTotal } from '../support/ui'

/**
 * El catálogo paginado en el servidor, de punta a punta: el producto 101 de un
 * catálogo de 101 se encuentra buscando y se vende — Tarea 8 de
 * `docs/superpowers/plans/2026-10-03-catalogo-paginado.md`, spec § 4.
 *
 * Hasta el 2026-10-03 el POS pedía `pageSize=100` y nada más: el ítem 101 no
 * existía para la pantalla. La grilla pide 48 por página y busca en el servidor
 * (300 ms después de la última tecla), así que lo que prueba este archivo es lo
 * que ningún unit ve: que el ítem que **no entra en la primera página** sea
 * alcanzable —tipeando, y paginando—, y que se pueda **vender**.
 *
 * ⚠️ **Los 101 productos son de esta corrida**, con una marca única en el
 * nombre: el tenant ya trae su catálogo y el 101 solo es "el último" respecto
 * de lo que se siembra acá. Los números van con ceros (`001`…`101`) para que
 * buscar `<marca> 101` no atrape a ningún otro, y para que el orden por nombre
 * del servidor (`Intl.Collator('es')`, todos pedibles con stock 10) sea el
 * numérico: 48 + 48 + 5 en tres páginas, y el 101 cae en la última.
 *
 * ⚠️ **El POS corre como la cajera** (`vendedor@paris.cl`, rol `Vendedor`: con
 * `Items:Leer`, sin `Items:Crear`) y no como admin: la grilla pega a
 * `GET /items` y ese permiso es el que la deja ver el catálogo. Con admin un
 * rol sin `Items:Leer` quedaría tapado. Sembrar y limpiar los ítems sí es del
 * admin (la cajera no tiene `Items:Crear`/`Eliminar`).
 *
 * Las precondiciones (ítems, caja, garzón, mesa) van por API: son flujos con
 * pantalla propia y recorrerlos acá haría que un cambio en cualquiera rompiera
 * este test sin que el catálogo tenga nada que ver.
 */

const CANTIDAD = 101
const VENDEDOR = { email: 'vendedor@paris.cl', password: 'admin' }
const PRECIO_BASE = '1000'
/** Afecto + IVA 19%: 1.000 × 1,19 = 1.190 (ADR-018). */
const TOTAL_CON_IVA = '$1.190'
/** Con la propina sugerida del 10% (119), lo que la caja espera en efectivo. */
const EFECTIVO_ESPERADO = '1309'
const PLACEHOLDER_BUSQUEDA = 'Buscar ítem...'

interface ProductoDeLaCorrida {
  id: string
  nombre: string
}

/** Los 101, en orden numérico; `productos[100]` es el 101. */
const corrida: {
  marca: string
  tokenAdmin?: string
  productos: ProductoDeLaCorrida[]
} = { marca: String(Date.now()), productos: [] }

const nombreDe = (n: number) => `CatPag ${corrida.marca} ${String(n).padStart(3, '0')}`

function tarjeta(page: Page, itemId: string): Locator {
  return page.locator(`[data-qa="item-catalogo-${itemId}"]`)
}

function buscador(page: Page): Locator {
  return page.getByPlaceholder(PLACEHOLDER_BUSQUEDA)
}

/**
 * Tipea en el buscador y espera la respuesta del servidor que ya trae ESE término.
 *
 * ⚠️ Sin esperarla, lo que sigue corre contra el catálogo sin filtrar —que ya
 * tiene más de una página— y el debounce de 300 ms de la grilla lo pisa a mitad
 * de camino: un click en "Page 3" dado antes de que dispare el filtro vuelve a
 * la página 1 al dispararse (`useCatalogoVenta`: buscar resetea la página).
 * Medido: 1 de 1 en la primera corrida.
 */
async function buscar(page: Page, termino: string): Promise<void> {
  const respuesta = page.waitForResponse(
    r => r.request().method() === 'GET'
      && r.url().includes('/items?')
      && new URL(r.url()).searchParams.get('search') === termino,
  )
  await buscador(page).fill(termino)
  expect((await respuesta).status()).toBe(200)
}

/** El ítem 101: el que no entraba en el `pageSize=100` de antes. */
const el101 = () => corrida.productos[CANTIDAD - 1]!

test.beforeAll(async ({ request }) => {
  // 101 POST: con la creación en tandas de 10 entra holgado, pero el default de
  // 30 s de un hook no lo asegura sobre un stack recién levantado.
  test.setTimeout(240_000)
  corrida.productos = []
  corrida.tokenAdmin = await tokenDe(request, TENANTS.restaurante)
  const token = corrida.tokenAdmin
  const nombres = Array.from({ length: CANTIDAD }, (_, i) => nombreDe(i + 1))
  for (let i = 0; i < nombres.length; i += 10) {
    const tanda = nombres.slice(i, i + 10)
    // Se anotan a medida que existen: si una tanda muere a mitad, el
    // `afterAll` tiene que poder dar de baja las que sí se crearon.
    const creados = await Promise.allSettled(
      tanda.map(async nombre => ({
        id: (await crearProducto(request, token, { nombre, precioBase: PRECIO_BASE })).id,
        nombre,
      })),
    )
    for (const r of creados) {
      if (r.status === 'fulfilled') corrida.productos.push(r.value)
    }
    const fallo = creados.find(r => r.status === 'rejected')
    if (fallo && fallo.status === 'rejected') throw fallo.reason
  }
})

test.afterAll(async ({ request }) => {
  test.setTimeout(240_000)
  // Red de seguridad del camino de FALLO: sin esto un spec roto deja 101
  // productos más en el catálogo del tenant, para siempre (ver `limpiarItems`).
  if (corrida.tokenAdmin) {
    await limpiarItems(request, corrida.tokenAdmin, corrida.productos.map(p => p.id))
  }
})

test.describe('POS como cajera', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  let caja: { tokenVendedor?: string, cajaId?: string } = {}

  test.beforeEach(async ({ request }) => {
    caja = {}
    caja.tokenVendedor = await tokenDe(request, TENANTS.restaurante, VENDEDOR)
    caja.cajaId = await abrirCaja(request, caja.tokenVendedor)
  })

  test.afterEach(async ({ request }) => {
    // Si el test llegó al final ya cerró la caja y esto rebota sin romper; si
    // murió antes, la cierra igual: el tenant tiene un solo cajón.
    if (caja.tokenVendedor && caja.cajaId) {
      await cerrarCaja(request, caja.tokenVendedor, caja.cajaId, '0')
    }
  })

  test('el producto 101 se encuentra buscándolo y se vende en efectivo', async ({ page, request }) => {
    const producto = el101()
    await entrarComo(page, VENDEDOR.email, VENDEDOR.password)
    await page.goto('/ventas/pos')

    // Con la marca solita hay más de una página; con "<marca> 101", una sola
    // tarjeta. El filtro lo hace el servidor: la pantalla nunca tuvo los 101.
    await buscar(page, `${corrida.marca} 101`)
    await expect(tarjeta(page, producto.id)).toBeVisible()
    await expect(page.locator('[data-qa^="item-catalogo-"]')).toHaveCount(1)
    await expect(tarjeta(page, producto.id)).toContainText(producto.nombre)

    await tarjeta(page, producto.id).click()
    await expect(valorDeFila(page, 'Total')).toHaveText(TOTAL_CON_IVA)

    await page.getByRole('button', { name: 'Cobrar', exact: true }).click()
    const cobro = page.getByRole('dialog').filter({ hasText: 'Cobrar venta' })
    const respuesta = page.waitForResponse(
      r => r.url().endsWith('/ventas') && r.request().method() === 'POST',
    )
    await cobro.getByRole('button', { name: 'Confirmar venta' }).click()
    const ventaId = ((await (await respuesta).json()) as { id: string }).id
    // ⚠️ Aserción de cliente (el toast sale de un mapa local): la venta de
    // verdad se verifica abajo, contra el servidor.
    await expect(page.getByText('Venta pagada').first()).toBeVisible({ timeout: 15_000 })

    const venta = await api<{ estado: string, totalFinal: string, detalles: { itemId: string }[] }>(
      request,
      'get',
      `/ventas/${ventaId}`,
      { token: caja.tokenVendedor },
    )
    expect(venta.estado).toBe('pagada')
    expect(venta.totalFinal).toBe('1190.0000')
    expect(venta.detalles.map(d => d.itemId)).toEqual([producto.id])

    // Y la caja de la cajera espera lo cobrado: venta + propina sugerida.
    expect(await cerrarCaja(request, caja.tokenVendedor!, caja.cajaId!, EFECTIVO_ESPERADO))
      .toBe('cerrada')
    caja.cajaId = undefined // Ya cerrada: que el `afterEach` no repita el conteo.
  })

  test('con la marca en el buscador hay tres páginas, y la página 3 trae lo que la 1 no tenía', async ({ page }) => {
    await entrarComo(page, VENDEDOR.email, VENDEDOR.password)
    await page.goto('/ventas/pos')

    await buscar(page, corrida.marca)
    const cards = page.locator('[data-qa^="item-catalogo-"]')
    // 101 resultados / 48 por página = 48 + 48 + 5.
    await expect(cards).toHaveCount(48)
    await expect(tarjeta(page, corrida.productos[0]!.id)).toBeVisible() // 001, primero por nombre
    await expect(tarjeta(page, el101().id)).toHaveCount(0) // el 101 no está en la página 1

    await page.getByRole('button', { name: 'Page 3', exact: true }).click()
    await expect(cards).toHaveCount(5)
    await expect(tarjeta(page, el101().id)).toBeVisible()
    await expect(tarjeta(page, corrida.productos[0]!.id)).toHaveCount(0)
  })

  test('a 375 px la paginación se ve entera: su último botón cae dentro del viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await entrarComo(page, VENDEDOR.email, VENDEDOR.password)
    await page.goto('/ventas/pos')

    await buscar(page, corrida.marca)
    // Tres páginas exactas (48 + 48 + 5): el filtro ya se aplicó en pantalla.
    await expect(tarjeta(page, corrida.productos[0]!.id)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Page 4', exact: true })).toHaveCount(0)
    const pagina1 = page.getByRole('button', { name: 'Page 1', exact: true })
    await expect(pagina1).toBeVisible()
    await pagina1.scrollIntoViewIfNeeded()

    // Todos los botones de la paginación: los de página y los de ir/volver. Se
    // los busca desde "Page 1" hacia arriba hasta el contenedor que ya trae
    // más de un botón de página (la raíz del `UPagination`).
    const botones = pagina1.locator(
      'xpath=ancestor::*[.//button[@aria-label="Page 3"]][1]//button',
    )
    const cantidad = await botones.count()
    expect(cantidad).toBeGreaterThan(3)

    const cajas = []
    for (let i = 0; i < cantidad; i++) {
      const b = await botones.nth(i).boundingBox()
      expect(b, `botón ${i} sin caja: no se renderiza`).not.toBeNull()
      cajas.push(b!)
    }
    const derechaMax = Math.max(...cajas.map(b => b.x + b.width))
    const izquierdaMin = Math.min(...cajas.map(b => b.x))
    const ultimo = cajas[cajas.length - 1]!
    // La medida va en el mensaje: si falla por recorte, es el dato del reporte.
    expect(ultimo.x + ultimo.width, `último botón: x=${ultimo.x} ancho=${ultimo.width} (viewport 375); derecha máx=${derechaMax}, izquierda mín=${izquierdaMin}`)
      .toBeLessThanOrEqual(375)
    expect(derechaMax).toBeLessThanOrEqual(375)
    expect(izquierdaMin).toBeGreaterThanOrEqual(0)
  })
})

test.describe('Salón', () => {
  // El garzón no se loguea: se identifica con el PIN sobre la sesión del admin
  // del seed (como `cuenta-hasta-cobro.spec.ts`).
  test.use({ storageState: 'e2e/.auth/paris.json' })

  const salon: {
    token?: string
    garzon?: { id: string, pin: string, nombre: string }
    salonNombre?: string
    mesaId?: string
  } = {}

  /** Cancela las cuentas abiertas de la mesa: una cuenta viva aparta stock. */
  async function cancelarCuentas(request: APIRequestContext, token: string, mesaId: string) {
    const auth = { Authorization: `Bearer ${token}` }
    const res = await request.get(`${API}/mesas/${mesaId}/cuentas`, { headers: auth })
    if (!res.ok()) return
    for (const c of (await res.json()) as { id: string }[]) {
      await request.post(`${API}/cuentas/${c.id}/cancelar`, { headers: auth })
    }
  }

  test.beforeAll(async ({ request }) => {
    test.setTimeout(60_000)
    const token = await tokenDe(request, TENANTS.restaurante)
    salon.token = token
    const marca = Date.now()

    // Garzón propio: la sesión es única por garzón (Ana la pisan seis specs).
    const nombre = `Garzón catálogo E2E ${marca}`
    const garzon = await api<{ id: string, pin: string }>(request, 'post', '/garzones', {
      token,
      data: { nombre },
    })
    salon.garzon = { ...garzon, nombre }
    const turnos = await api<{ id: string, activo: boolean }[]>(request, 'get', '/turnos', { token })
    const turnoId = turnos.find(t => t.activo)?.id
    if (!turnoId) throw new Error('El seed no tiene ningún turno activo')
    await api(request, 'post', '/sesiones-garzon/iniciar', {
      token,
      data: { garzonId: garzon.id, pin: garzon.pin, turnoId },
    })

    salon.salonNombre = `Salón catálogo E2E ${marca}`
    const s = await api<{ id: string }>(request, 'post', '/salones', {
      token,
      data: { nombre: salon.salonNombre },
    })
    // Al centro del plano: en (0,0) la mesa queda recortada y el click cae fuera.
    const mesa = await api<{ id: string }>(request, 'post', `/salones/${s.id}/mesas`, {
      token,
      data: { nombre: `Mesa ${marca}`, posX: 0.5, posY: 0.5 },
    })
    salon.mesaId = mesa.id
  })

  test.afterAll(async ({ request }) => {
    const { token, garzon, mesaId } = salon
    if (!token) return
    // Antes de que la `afterAll` de arriba dé de baja los ítems: la cuenta con
    // el 101 adentro lo tiene apartado.
    if (mesaId) await cancelarCuentas(request, token, mesaId)
    if (garzon) {
      await request.post(`${API}/sesiones-garzon/cerrar`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { garzonId: garzon.id, pin: garzon.pin },
      })
    }
  })

  test('buscando el 101 en la grilla de la cuenta, se agrega a la cuenta', async ({ page, request }) => {
    const producto = el101()
    await page.goto('/salones')

    await elegirEnSelector(page, salon.salonNombre!)
    await page.locator(`[data-qa="mesa-${salon.mesaId}"]`).click()
    await page.getByRole('button', { name: 'Nueva cuenta' }).click()
    await rondaDePin(page, salon.garzon!)

    await buscar(page, `${corrida.marca} 101`)
    await expect(tarjeta(page, producto.id)).toBeVisible()
    await expect(page.locator('[data-qa^="item-catalogo-"]')).toHaveCount(1)
    await tarjeta(page, producto.id).click()

    // En pantalla: el total de la cuenta sale de la regla ($1.000 + 19%).
    await expect(valorDelTotal(page)).toHaveText(TOTAL_CON_IVA)

    // Y en el servidor: la cuenta abierta de la mesa tiene esa línea. El total
    // de la pantalla es aritmética de cliente; esto no.
    await expect.poll(async () => {
      const cuentas = await api<{ lineas: { itemId: string }[] }[]>(
        request,
        'get',
        `/mesas/${salon.mesaId}/cuentas`,
        { token: salon.token },
      )
      return cuentas.flatMap(c => c.lineas.map(l => l.itemId))
    }).toEqual([producto.id])
  })
})
