import { test, expect } from '../support/sesion'
import { TENANTS, api, tokenDe } from '../support/api'
import { entrarComo } from '../support/ui'

/**
 * Paquetería en un navegador de verdad: lo que los tests de componente no ven (la pistola es un
 * teclado que tipea y aprieta Enter, la cola de escaneos contra el backend real, el modal de
 * rendir) y el menú del admin del tenant demo, que no es superadmin.
 *
 * Los números salen de los defaults del seed: 10.000 de envío (lo que se cobra en destino) y
 * 5.000 de pago por paquete, en Demo Restaurante. El repartidor es propio de cada corrida, así
 * que la hoja arranca vacía y el neto no depende de lo que dejó otra.
 */

test('escanear con la pistola, marcar y rendir: el repartidor entrega lo cobrado menos su pago', async ({ page, request }) => {
  const token = await tokenDe(request, TENANTS.restaurante)
  const nombre = `E2E Repartidor ${Date.now()}`
  await api(request, 'post', '/repartidores', { token, data: { nombre } })

  await page.goto('/paquetes/escanear')
  await page.locator('[data-qa="escanear-repartidor"]').click()
  await page.getByRole('option', { name: nombre, exact: true }).click()
  await page.getByRole('switch', { name: 'Cobro en destino', exact: true }).click()

  const campo = page.locator('[data-qa="escanear-codigo"]')
  const base = Date.now()
  async function escanear(i: number) {
    // La pistola es un teclado: tipea el contenido del QR y aprieta Enter.
    await campo.fill(`{"id":"E2E${base}${i}","sender_id":1}`)
    await campo.press('Enter')
  }
  for (let i = 0; i < 3; i++) await escanear(i)
  await expect(page.locator('[data-qa="escanear-asignados"]')).toHaveText('3 asignados')

  // El cuarto es sin cobro en destino: el switch rige al escanear, no después. Con los 4 cobrando
  // el neto daría igual con fórmulas equivocadas (total − pago, cobrado / 2…).
  await page.getByRole('switch', { name: 'Cobro en destino', exact: true }).click()
  await escanear(3)
  await expect(page.locator('[data-qa="escanear-asignados"]')).toHaveText('4 asignados')
  await expect(page.locator('[data-qa="escanear-con-cobro"]')).toHaveText('3 a cobrar en destino')
  await expect(page.locator('[data-qa="escanear-rechazados"]')).toHaveCount(0)

  await page.goto('/paquetes/rutas')
  await page.getByRole('link', { name: nombre, exact: true }).click()
  await page.locator('[data-qa="hoja-entregar-todos"]').click()
  await expect(page.locator('[data-qa="hoja-entregados"]')).toHaveText('4')
  // Defaults del seed: 10.000 de envío y 5.000 de pago por paquete. Cobrado = solo los 3 con
  // cobro; total general = los 4 entregados; neto = 30.000 − 20.000.
  await expect(page.locator('[data-qa="hoja-cobrado"]')).toHaveText('$30.000')
  await expect(page.locator('[data-qa="hoja-pago"]')).toHaveText('$20.000')
  await expect(page.locator('[data-qa="hoja-total-general"]')).toHaveText('$40.000')
  await page.locator('[data-qa="hoja-rendir"]').click()

  const modal = page.getByRole('dialog')
  await expect(modal.locator('[data-qa="hoja-rendir-texto"]')).toHaveText(`${nombre} entrega $10.000`)
  await modal.locator('[data-qa="hoja-rendir-confirmar"]').click()
  await expect(page.locator('[data-qa="hoja-rendida"]')).toContainText('Rendida el')

  await page.goto('/paquetes/rutas')
  await expect(page.getByRole('row').filter({ hasText: nombre })).toContainText('Rendida')
})

test('el admin del tenant demo ve solo Paquetería en el menú', async ({ browser }) => {
  // No es superadmin: es el caso real que verá el cliente.
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    storageState: { cookies: [], origins: [] },
  })
  try {
    const page = await context.newPage()
    await entrarComo(page, 'admin@paquetes.cl')
    const menu = page.locator('[data-qa="menu-lateral"]')
    const grupo = menu.getByRole('button', { name: 'Paquetería', exact: true })
    await expect(grupo).toBeVisible()
    await grupo.click()
    await expect(grupo).toHaveAttribute('aria-expanded', 'true')
    await expect(menu.getByRole('link', { name: 'Escanear', exact: true })).toBeVisible()

    // Los hijos de un grupo cerrado no están montados: "Punto de venta" ausente no probaría nada.
    // Lo que sí prueba es que el grupo "Ventas" entero no exista.
    await expect(menu.getByRole('button', { name: 'Ventas', exact: true })).toHaveCount(0)
    await expect(menu.getByRole('link', { name: 'Mi caja', exact: true })).toHaveCount(0)

    await page.goto('/paquetes/rutas')
    await expect(page.getByRole('link', { name: 'Juan Pérez', exact: true }).first()).toBeVisible()
  } finally {
    await context.close()
  }
})
