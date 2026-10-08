import { test, expect } from '../support/sesion'
import {
  abrirCaja,
  api,
  cerrarCaja,
  CLP,
  limpiarItems,
  tokenDe,
  TENANTS,
} from '../support/api'

/**
 * El garzón tipea 100 en las unidades de un extra: el pedido tiene que salir con
 * 99 y no con un 400 del servidor.
 *
 * `PersonalizacionExtraInputDto.unidades` tiene `@Max(MAX_UNIDADES_POR_PLATO)` —99,
 * owner 2026-10-08— y el `UInputNumber` del drawer no tenía `max`: lo tipeado
 * llegaba tal cual y el garzón veía *"Un extra se puede agregar hasta 99 veces
 * por plato"* recién al pedir. Con el `max`, reka-ui lo clampa al salir del campo.
 *
 * Lo que agrega sobre el spec unitario del drawer es el navegador de verdad: que
 * hacer click en "Agregar" con el 100 todavía en el input dispare el blur ANTES
 * del click —que es lo que hace que el clamp llegue a tiempo—, y que el cálculo
 * del POS mande 99 y el servidor lo acepte.
 *
 * El POS pide caja abierta para mostrar el catálogo. La venta no se cobra: el
 * pedido que se verifica es el `POST /calculo-precios/calcular`, que es lo
 * primero que sale con la personalización y valida el mismo DTO que la venta.
 */

let escenario: { token?: string, cajaId?: string, itemIds: string[] } = { itemIds: [] }

test.beforeEach(async ({ request }) => {
  escenario = { itemIds: [] }
  escenario.token = await tokenDe(request, TENANTS.restaurante)
  escenario.cajaId = await abrirCaja(request, escenario.token)
})

test.afterEach(async ({ request }) => {
  const { token, cajaId, itemIds } = escenario
  if (!token) return
  // Sin ventas, la caja cuadra en cero. Si el test murió a la mitad, cerrarla
  // igual deja el cajón libre para la corrida siguiente (ver `cerrarCaja`).
  if (cajaId) await cerrarCaja(request, token, cajaId, '0')
  // Al revés de como se crearon: un ingrediente no se borra mientras su receta viva.
  await limpiarItems(request, token, [...itemIds].reverse())
})

test('100 unidades tipeadas en un extra salen como 99, y el servidor las acepta', async ({
  page,
  request,
}) => {
  const token = escenario.token!
  const marca = Date.now()

  const crear = async (data: Record<string, unknown>) => {
    const item = await api<{ id: string }>(request, 'post', '/items', { token, data })
    escenario.itemIds.push(item.id)
    return item.id
  }
  const pan = await crear({
    nombre: `Pan tope extra ${marca}`,
    tipo: 'ingrediente',
    precioBase: '100',
    monedaId: CLP,
    unidadMedida: 'unidad',
    stock: '10',
    costo: '100',
  })
  // Stock de sobra: 99 unidades del extra no tienen que chocar con el stock,
  // para que lo único que pueda rechazar el pedido sea el tope.
  const quesoNombre = `Queso tope extra ${marca}`
  const queso = await crear({
    nombre: quesoNombre,
    tipo: 'ingrediente',
    precioBase: '100',
    monedaId: CLP,
    unidadMedida: 'unidad',
    stock: '1000',
    costo: '100',
  })
  const receta = await crear({
    nombre: `Hamburguesa tope extra ${marca}`,
    tipo: 'receta',
    precioBase: '5000',
    monedaId: CLP,
    ingredientes: [
      { ingredienteItemId: pan, cantidad: '1', unidadCodigo: 'unidad', bloqueante: true },
    ],
    extrasPermitidos: [
      { ingredienteItemId: queso, cantidad: '1', unidadCodigo: 'unidad', precioExtra: '500' },
    ],
  })

  await page.goto('/ventas/pos')
  await page.locator(`[data-qa="item-catalogo-${receta}"]`).click()

  const drawer = page.getByRole('dialog').filter({ hasText: 'Personalizar' })
  await drawer.getByRole('checkbox', { name: quesoNombre }).click()
  const unidades = drawer.getByRole('spinbutton', { name: `Cantidad de ${quesoNombre}` })
  await unidades.fill('100')

  // Sin salir del campo a mano: el click en "Agregar" es el que lo saca, como
  // le pasa al garzón.
  const calculo = page.waitForResponse(
    (r) => r.url().endsWith('/calculo-precios/calcular') && r.request().method() === 'POST',
  )
  await drawer.getByRole('button', { name: /^Agregar/ }).click()
  const respuesta = await calculo

  const body = respuesta.request().postDataJSON() as {
    lineas: { itemId: string, personalizacion?: { extras: { ingredienteItemId: string, unidades: number }[] } }[]
  }
  const linea = body.lineas.find((l) => l.itemId === receta)
  expect(linea?.personalizacion?.extras).toEqual([{ ingredienteItemId: queso, unidades: 99 }])
  expect(respuesta.status()).toBe(201)

  // Y la pantalla lo muestra así: la línea del carrito lleva el extra por 99.
  await expect(page.getByText(`Extra ${quesoNombre} x99`)).toBeVisible()
})
