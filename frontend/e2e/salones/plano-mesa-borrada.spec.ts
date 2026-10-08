import type { Page } from '@playwright/test'
import { test, expect, sesionFresca } from '../support/sesion'
import { api, API, tokenDe, TENANTS } from '../support/api'
import { elegirEnSelector } from '../support/ui'

/**
 * Dos admins con el plano del mismo salón abierto: uno borra una mesa y el otro,
 * que todavía la ve, arrastra OTRA y guarda (`docs/features/salones-mesas.md`,
 * § "Una mesa que otro admin borró").
 *
 * La pantalla no tiene polling, así que la borrada sigue dibujada en la segunda
 * sesión hasta que esa sesión le habla al servidor. Lo que se fija es qué pasa en
 * ese momento: el `PATCH /salones/:id/layout` saltea la borrada y devuelve las
 * mesas que escribió, y la pantalla saca del plano la que no volvió y lo avisa.
 * Hasta el 2026-10-08 la reponía como viva: seguía en el plano, arrastrable, y
 * cada arrastre la volvía a mandar.
 *
 * ⚠️ **Por qué es de navegador y no solo unit.** El spec de la página corre contra
 * un mock de `useApiFetch`, que contesta lo que el test le dice: no puede ver que
 * el servidor de verdad devuelva (o no) las mesas que escribió.
 *
 * El salón y sus mesas se montan por API con nombre propio: el flujo bajo prueba
 * es el borrado en una sesión y el arrastre en la otra.
 */

const escenario: {
  token?: string
  salonId?: string
  salonNombre?: string
  borrada?: { id: string, nombre: string }
  movida?: { id: string, nombre: string }
} = {}

test.beforeAll(async ({ request }) => {
  escenario.token = await tokenDe(request, TENANTS.restaurante)
  const token = escenario.token
  const sufijo = Date.now().toString(36)
  escenario.salonNombre = `Plano e2e ${sufijo}`
  const salon = await api<{ id: string }>(request, 'post', '/salones', {
    token,
    data: { nombre: escenario.salonNombre },
  })
  escenario.salonId = salon.id
  const crear = (nombre: string, posX: number, posY: number) =>
    api<{ id: string, nombre: string }>(request, 'post', `/salones/${salon.id}/mesas`, {
      token,
      data: { nombre, posX, posY },
    })
  escenario.borrada = await crear(`Borrada ${sufijo}`, 0.25, 0.3)
  escenario.movida = await crear(`Movida ${sufijo}`, 0.6, 0.6)
})

test.afterAll(async ({ request }) => {
  // DELETE de la API: borrado lógico del salón y de sus mesas vivas.
  if (escenario.salonId && escenario.token) {
    await request.delete(`${API}/salones/${escenario.salonId}`, {
      headers: { Authorization: `Bearer ${escenario.token}` },
    })
  }
})

async function abrirPlano(page: Page) {
  await page.goto('/configuracion/salones')
  await elegirEnSelector(page, escenario.salonNombre!)
}

const mesaEn = (page: Page, id: string) => page.locator(`[data-qa="mesa-${id}"]`)

test('la mesa que otro admin borró sale del plano al guardar la distribución, con aviso', async ({ page, browser, baseURL }) => {
  const { borrada, movida } = escenario as Required<typeof escenario>

  // Sesión 1 (`page`) y sesión 2 (otro contexto, otra sesión del admin) con el
  // mismo salón abierto: las dos dibujan las dos mesas.
  const otro = await browser.newContext({ storageState: await sesionFresca(baseURL!), baseURL })
  const otraPage = await otro.newPage()
  try {
    await abrirPlano(page)
    await abrirPlano(otraPage)
    for (const p of [page, otraPage]) {
      await expect(mesaEn(p, borrada.id)).toBeVisible()
      await expect(mesaEn(p, movida.id)).toBeVisible()
    }

    // La sesión 2 borra una mesa por pantalla.
    await mesaEn(otraPage, borrada.id).dblclick()
    await otraPage.getByRole('button', { name: 'Eliminar', exact: true }).click()
    const del = otraPage.waitForResponse(
      r => r.url().endsWith(`/mesas/${borrada.id}`) && r.request().method() === 'DELETE',
    )
    await otraPage.getByRole('dialog').getByRole('button', { name: 'Eliminar', exact: true }).click()
    expect((await del).status()).toBe(200)
    await expect(mesaEn(otraPage, borrada.id)).toHaveCount(0)

    // Sin polling: la sesión 1 todavía la dibuja.
    await expect(mesaEn(page, borrada.id)).toBeVisible()

    // La sesión 1 arrastra la OTRA mesa: soltar guarda la distribución.
    const caja = await mesaEn(page, movida.id).boundingBox()
    if (!caja) throw new Error('la mesa a mover no tiene caja')
    const x = caja.x + caja.width / 2
    const y = caja.y + caja.height / 2
    const patch = page.waitForResponse(
      r => r.url().endsWith(`/salones/${escenario.salonId}/layout`) && r.request().method() === 'PATCH',
    )
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 60, y - 40, { steps: 5 })
    await page.mouse.up()
    const r = await patch
    expect(r.status()).toBe(200)
    // Viajó la borrada también (la pantalla manda todas las que dibuja)…
    const enviadas = (r.request().postDataJSON() as { mesas: { mesaId: string }[] }).mesas.map(m => m.mesaId)
    expect(enviadas).toEqual(expect.arrayContaining([borrada.id, movida.id]))
    // …y el servidor devolvió solo la que escribió.
    const escritas = ((await r.json()) as { id: string }[]).map(m => m.id)
    expect(escritas).toEqual([movida.id])

    // Lo que ve la sesión 1: la borrada ya no está, y se le dice por qué.
    await expect(mesaEn(page, borrada.id)).toHaveCount(0)
    await expect(mesaEn(page, movida.id)).toBeVisible()
    await expect(page.getByText(`Se sacó "${borrada.nombre}" del plano`, { exact: true })).toBeVisible()

    // El arrastre siguiente ya no la manda.
    const caja2 = await mesaEn(page, movida.id).boundingBox()
    if (!caja2) throw new Error('la mesa a mover no tiene caja')
    const patch2 = page.waitForResponse(
      r => r.url().endsWith(`/salones/${escenario.salonId}/layout`) && r.request().method() === 'PATCH',
    )
    await page.mouse.move(caja2.x + caja2.width / 2, caja2.y + caja2.height / 2)
    await page.mouse.down()
    await page.mouse.move(caja2.x + caja2.width / 2 + 40, caja2.y + caja2.height / 2 + 30, { steps: 5 })
    await page.mouse.up()
    const r2 = await patch2
    expect(r2.status()).toBe(200)
    const enviadas2 = (r2.request().postDataJSON() as { mesas: { mesaId: string }[] }).mesas.map(m => m.mesaId)
    expect(enviadas2).toEqual([movida.id])
  }
  finally {
    await otro.close()
  }
})
