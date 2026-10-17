import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../support/sesion'
import { TENANTS, api, tokenDe } from '../support/api'
import { entrarComo } from '../support/ui'

/**
 * Paquetería en un navegador de verdad: lo que los tests de componente no ven (la pistola es un
 * teclado que tipea y aprieta Enter, la cola de escaneos contra el backend real, la planilla de
 * rendición) y el menú del admin del tenant demo, que no es superadmin.
 *
 * Los números: dos tarifas de envío y dos de pago que cada test crea con nombre propio, porque
 * Demo Restaurante no trae tarifas sembradas y una corrida repetida no tiene que depender de lo
 * que dejó otra. Envío: 10.000 la por defecto (la que se cobra en destino) y 14.000 la
 * prioritaria. Pago: 1.900 la del repartidor y 4.000 la especial. El repartidor también es
 * propio, así que la hoja arranca vacía.
 */

type Tarifa = { id: string, nombre: string, monto: string }

/**
 * Un repartidor nuevo con su tarifa de pago de 1.900, una tarifa de pago especial de 4.000 y dos
 * tarifas de envío (10.000, que pasa a ser la por defecto, y 14.000).
 */
async function repartidorConTarifas(request: APIRequestContext, token: string, sufijo: string) {
  const estandar = await api<Tarifa>(request, 'post', '/tarifas-envio', {
    token, data: { nombre: `E2E Estandar ${sufijo}`, monto: '10000', esDefecto: true },
  })
  const prioritaria = await api<Tarifa>(request, 'post', '/tarifas-envio', {
    token, data: { nombre: `E2E Prioritaria ${sufijo}`, monto: '14000' },
  })
  const comun = await api<Tarifa>(request, 'post', '/tarifas-pago', {
    token, data: { nombre: `E2E Comun ${sufijo}`, monto: '1900' },
  })
  const especial = await api<Tarifa>(request, 'post', '/tarifas-pago', {
    token, data: { nombre: `E2E Especial ${sufijo}`, monto: '4000' },
  })
  const nombre = `E2E Repartidor ${sufijo}`
  await api(request, 'post', '/repartidores', { token, data: { nombre, tarifaPagoId: comun.id } })
  return { nombre, comun, especial, estandar, prioritaria }
}

test('escanear, marcar entregas, anotar plata y rendir: el precio del envío y el saldo de la planilla quedan congelados', async ({ page, request }) => {
  const token = await tokenDe(request, TENANTS.restaurante)
  const { nombre, comun, especial, estandar, prioritaria } = await repartidorConTarifas(request, token, String(Date.now()))

  await page.goto('/paquetes/escanear')
  await page.locator('[data-qa="escanear-repartidor"]').click()
  await page.getByRole('option', { name: nombre, exact: true }).click()
  await page.getByRole('switch', { name: 'Cobro en destino', exact: true }).click()

  const campo = page.locator('[data-qa="escanear-codigo"]')
  const base = Date.now()
  const codigos = [0, 1, 2, 3].map(i => `E2E${base}${i}`)
  async function escanear(i: number) {
    // La pistola es un teclado: tipea el contenido del QR y aprieta Enter.
    await campo.fill(`{"id":"${codigos[i]}","sender_id":1}`)
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

  // Todos nacen sin tarifa propia: el pago se estima con la del repartidor y el envío con la por defecto.
  await expect(page.locator(`[data-qa="escanear-linea-envio-${codigos[0]}"]`)).toHaveText('$10.000')
  await expect(page.locator(`[data-qa="escanear-linea-pago-${codigos[0]}"]`)).toHaveText('$1.900')
  await expect(page.locator(`[data-qa="escanear-linea-tarifa-${codigos[0]}"]`)).toHaveText(comun.nombre)

  // El primero lleva las tarifas especiales: se eligen en el modal, con selectores (el precio ya no se tipea).
  await page.locator(`[data-qa="escanear-linea-montos-${codigos[0]}"]`).click()
  const montos = page.getByRole('dialog')
  await montos.locator('[data-qa="escanear-montos-envio"]').click()
  await page.getByRole('option', { name: new RegExp(`^${prioritaria.nombre}`) }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await montos.locator('[data-qa="escanear-montos-tarifa"]').click()
  await page.getByRole('option', { name: new RegExp(`^${especial.nombre}`) }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await montos.locator('[data-qa="escanear-montos-guardar"]').click()
  await expect(montos).toHaveCount(0)
  await expect(page.locator(`[data-qa="escanear-linea-envio-${codigos[0]}"]`)).toHaveText('$14.000')
  await expect(page.locator(`[data-qa="escanear-linea-pago-${codigos[0]}"]`)).toHaveText('$4.000')
  await expect(page.locator(`[data-qa="escanear-linea-tarifa-${codigos[0]}"]`)).toHaveText(especial.nombre)

  await page.goto('/paquetes/rutas')
  await page.getByRole('link', { name: nombre, exact: true }).click()
  await page.waitForURL(/\/paquetes\/rutas\/[0-9a-f-]{36}$/)
  const hojaId = new URL(page.url()).pathname.split('/').pop()!
  // El primero en efectivo, el segundo por transferencia, el tercero en efectivo y el cuarto, que
  // no cobra, sin medio. Se espera el contador entre un click y el siguiente: la hoja se recarga.
  const marcas = [
    [0, 'entregado'], [1, 'entregado-transferencia'], [2, 'entregado'], [3, 'entregado'],
  ] as const
  for (const [i, accion] of marcas) {
    await page.locator(`[data-qa="hoja-linea-${codigos[i]}-${accion}"]`).click()
    await expect(page.locator('[data-qa="hoja-entregados"]')).toHaveText(String(i + 1))
  }
  // El precio de cada entrega quedó fijo al marcarla: el primero 14.000 (prioritaria), los otros 10.000.
  await expect(page.locator(`[data-qa="hoja-linea-envio-${codigos[0]}"]`)).toHaveText('$14.000')
  await expect(page.locator(`[data-qa="hoja-linea-tarifa-envio-${codigos[0]}"]`)).toHaveText(prioritaria.nombre)
  await expect(page.locator(`[data-qa="hoja-linea-envio-${codigos[1]}"]`)).toHaveText('$10.000')
  await expect(page.locator(`[data-qa="hoja-linea-tarifa-envio-${codigos[1]}"]`)).toHaveText(estandar.nombre)
  // Cobrado = solo los 3 con cobro (14.000 + 10.000 + 10.000); pago = la especial + 3 comunes
  // (4.000 + 3 × 1.900); total general = los 4 entregados; neto = 34.000 − 9.700.
  await expect(page.locator('[data-qa="hoja-cobrado"]')).toHaveText('$34.000')
  await expect(page.locator('[data-qa="hoja-pago"]')).toHaveText('$9.700')
  await expect(page.locator('[data-qa="hoja-total-general"]')).toHaveText('$44.000')
  await expect(page.locator('[data-qa="hoja-neto-monto"]')).toHaveText('$24.300')

  // Subir después lo que vale la tarifa por defecto no mueve lo ya entregado: la hoja de la API y la
  // pantalla recargada siguen con el precio que se fijó al entregar.
  await api(request, 'patch', `/tarifas-envio/${estandar.id}`, { token, data: { monto: '11000' } })
  const hoja = await api<{ montoTotalGeneral: string, montoCobradoDestino: string, lineas: { codigo: string, precioEnvio: string }[] }>(
    request, 'get', `/hojas-ruta/${hojaId}`, { token },
  )
  expect(hoja.montoTotalGeneral).toBe('44000.0000')
  expect(hoja.montoCobradoDestino).toBe('34000.0000')
  expect(hoja.lineas.find(l => l.codigo === codigos[1])!.precioEnvio).toBe('10000.0000')
  await page.reload()
  await expect(page.locator('[data-qa="hoja-total-general"]')).toHaveText('$44.000')
  await expect(page.locator(`[data-qa="hoja-linea-envio-${codigos[1]}"]`)).toHaveText('$10.000')

  // Rendir lleva a la pantalla de rendiciones con el repartidor puesto.
  await page.locator('[data-qa="hoja-rendir"]').click()
  await page.waitForURL(url => url.pathname === '/paquetes/rendiciones/nueva')
  const saldo = page.locator('[data-qa="nueva-saldo"]')
  await expect(saldo).toHaveText('Debe rendir $24.300')

  // Una entrega de plata a cuenta baja lo que debe: 24.300 − 5.000.
  await page.locator('[data-qa="nueva-entrega-anotar"]').click()
  const entrega = page.getByRole('dialog')
  const monto = entrega.locator('input[data-qa="nueva-entrega-monto"]')
  await monto.selectText()
  await monto.pressSequentially('5000')
  await entrega.locator('[data-qa="nueva-entrega-guardar"]').click()
  await expect(entrega).toHaveCount(0)
  await expect(saldo).toHaveText('Debe rendir $19.300')

  await page.locator('[data-qa="nueva-rendir"]').click()
  await expect(page.locator('[data-qa="nueva-confirmar-texto"]')).toHaveText('Debe rendir $19.300')
  await page.locator('[data-qa="nueva-confirmar"]').click()

  // La planilla muestra lo congelado, partido por medio de cobro.
  await page.waitForURL(/\/paquetes\/rendiciones\/[0-9a-f-]{36}$/)
  const rendicionId = new URL(page.url()).pathname.split('/').pop()!
  await expect(page.locator('[data-qa="rendicion-repartidor"]')).toContainText(nombre)
  await expect(page.locator('[data-qa="rendicion-total-entregados"]')).toHaveText('4')
  await expect(page.locator('[data-qa="rendicion-total-pago"]')).toHaveText('$9.700')
  await expect(page.locator('[data-qa="rendicion-total-efectivo"]')).toHaveText('$24.000')
  await expect(page.locator('[data-qa="rendicion-total-transferencia"]')).toHaveText('$10.000')
  await expect(page.locator('[data-qa="rendicion-cobrado"]')).toHaveText('$34.000')
  await expect(page.locator('[data-qa="rendicion-entregado"]')).toHaveText('$5.000')
  await expect(page.locator('[data-qa="rendicion-saldo"]')).toHaveText('Debe rendir $19.300')

  // Y en el backend quedó ese mismo saldo, no uno recalculado después.
  const guardada = await api<{ totales: Record<string, string> }>(
    request, 'get', `/rendiciones/${rendicionId}`, { token },
  )
  expect(guardada.totales.saldo).toBe('19300.0000')
  expect(guardada.totales.montoPagoRepartidor).toBe('9700.0000')
  expect(guardada.totales.montoEntregadoACuenta).toBe('5000.0000')

  await page.goto('/paquetes/rutas')
  await expect(page.getByRole('row').filter({ hasText: nombre })).toContainText('Rendida')
})

test('cambiar las tarifas de envío y de pago de un paquete desde la hoja de Escanear', async ({ page, request }) => {
  const token = await tokenDe(request, TENANTS.restaurante)
  const { nombre, comun, especial, estandar, prioritaria } = await repartidorConTarifas(request, token, `montos ${Date.now()}`)
  const codigo = `E2EM${Date.now()}`

  await page.goto('/paquetes/escanear')
  await page.locator('[data-qa="escanear-repartidor"]').click()
  await page.getByRole('option', { name: nombre, exact: true }).click()
  // La lista retiene el foco ~140 ms mientras se cierra: lo que se tipea ahí se pierde. Ninguna
  // persona elige con el mouse y dispara la pistola tan rápido; el test sí, así que espera.
  await expect(page.getByRole('listbox')).toHaveCount(0)
  const campo = page.locator('[data-qa="escanear-codigo"]')
  await campo.fill(codigo)
  await campo.press('Enter')
  await expect(page.locator('[data-qa="escanear-asignados"]')).toHaveText('1 asignados')
  // Nace con el envío estimado de la tarifa por defecto y el pago de la del repartidor.
  await expect(page.locator(`[data-qa="escanear-linea-envio-${codigo}"]`)).toHaveText('$10.000')
  await expect(page.locator(`[data-qa="escanear-linea-pago-${codigo}"]`)).toHaveText('$1.900')
  await expect(page.locator(`[data-qa="escanear-linea-tarifa-${codigo}"]`)).toHaveText(comun.nombre)

  await page.locator(`[data-qa="escanear-linea-montos-${codigo}"]`).click()
  const modal = page.getByRole('dialog')
  // La primera opción es la heredada: dice cuál es y cuánto vale.
  await modal.locator('[data-qa="escanear-montos-envio"]').click()
  await expect(page.getByRole('option', { name: `Por defecto (${estandar.nombre} $10.000)` })).toBeVisible()
  await page.getByRole('option', { name: new RegExp(`^${prioritaria.nombre}`) }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await modal.locator('[data-qa="escanear-montos-tarifa"]').click()
  await page.getByRole('option', { name: new RegExp(`^${especial.nombre}`) }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  // Sin guardar, la línea sigue con lo de antes.
  await expect(page.locator(`[data-qa="escanear-linea-envio-${codigo}"]`)).toHaveText('$10.000')

  await modal.locator('[data-qa="escanear-montos-guardar"]').click()
  await expect(modal).toHaveCount(0)
  await expect(page.locator(`[data-qa="escanear-linea-envio-${codigo}"]`)).toHaveText('$14.000')
  await expect(page.locator(`[data-qa="escanear-linea-pago-${codigo}"]`)).toHaveText('$4.000')
  await expect(page.locator(`[data-qa="escanear-linea-tarifa-${codigo}"]`)).toHaveText(especial.nombre)

  // Al cerrar, el foco volvió al campo: la pistola sigue sin tocar el mouse.
  await expect(campo).toBeFocused()
  await page.keyboard.type(`${codigo}B`)
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-qa="escanear-asignados"]')).toHaveText('2 asignados')

  // Lo guardado es del paquete, en el backend: sus tarifas, no un monto.
  const lista = await api<{ data: { codigo: string, tarifaEnvioId: string | null, tarifaPagoId: string | null }[] }>(
    request, 'get', `/paquetes?q=${codigo}`, { token },
  )
  const guardado = lista.data.find(p => p.codigo === codigo)!
  expect(guardado.tarifaEnvioId).toBe(prioritaria.id)
  expect(guardado.tarifaPagoId).toBe(especial.id)
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
    await expect(menu.getByRole('link', { name: 'Rendiciones', exact: true })).toBeVisible()

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
