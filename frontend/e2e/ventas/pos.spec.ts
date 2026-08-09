import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  abrirCaja,
  api,
  cerrarCaja,
  crearProducto,
  limpiarItems,
  tokenDe,
  TENANTS,
} from '../support/api'

/**
 * El punto de venta de punta a punta, en un navegador de verdad: catálogo →
 * carrito → cobro → venta persistida.
 *
 * Lo que agrega sobre los unit y sobre los e2e de API es la **cadena completa**:
 * que la pantalla pida el cálculo que corresponde, muestre lo que el motor
 * devolvió, y mande al servidor lo mismo que le mostró al cajero. Cada una de
 * esas tres cosas está cubierta por separado; que encajen entre sí, no.
 *
 * ⚠️ **Los montos salen de la regla, no del output.** Producto afecto de $1.000
 * con IVA 19% del país → $1.190; producto exento de $500 → $500, sin IVA. El
 * exento es el que le da filo al test: si el IVA se derivara de "tiene o no
 * impuestos asignados" en vez de la `clasificacion_tributaria` (ADR-011 /
 * `docs/features/impuestos.md`), los dos ítems —ninguno tiene impuestos
 * asignados— darían lo mismo y el test no distinguiría nada.
 *
 * ⚠️ **Las precondiciones se montan por API** (caja e ítems). Son flujos propios
 * con pantalla propia; recorrerlos acá haría que un cambio en cualquiera de
 * ellos rompiera este test sin que el POS tenga nada que ver.
 */

/** Precio base neto de cada ítem. Todo lo demás se deriva de acá. */
const PRECIO_AFECTO = '1000'
const PRECIO_EXENTO = '500'

/** $1.000 + $500 de neto. */
const NETO = '$1.500'
/** 19% de los $1.000 afectos. El exento no aporta nada. */
const IVA = '+$190'
const TOTAL_VENTA = '$1.690'
/**
 * Sugerencia del 10% sobre el total, half-up a peso entero (`sugerirPropina`).
 * Va sin símbolo porque es lo que muestra el `MoneyInput` mientras se edita —
 * los montos de solo lectura sí lo llevan.
 */
const PROPINA_SUGERIDA = '169'
const TOTAL_A_PAGAR = '$1.859'
/** Lo que la caja tiene que esperar en efectivo: la venta más la propina. */
const EFECTIVO_ESPERADO = '1859'

interface DetalleVenta {
  itemId: string
  cantidad: string
  impuestoAplicado: string
  totalLinea: string
}

interface VentaServidor {
  id: string
  estado: string
  totalImpuestos: string
  totalFinal: string
  tipoDocumento: { codigo: string | null } | null
  propina: { montoPagado: string } | null
  detalles: DetalleVenta[]
}

/**
 * Lo que el `beforeEach` fue montando, en el orden en que lo montó. Se llena de
 * a poco a propósito: si el montaje muere a la mitad, el `afterEach` tiene que
 * poder cerrar lo que sí llegó a existir — una caja abierta que quedó colgada
 * deja al tenant sin cajón libre y la corrida siguiente no puede ni empezar.
 */
let escenario: { token?: string; cajaId?: string; itemIds: string[] } = {
  itemIds: [],
}

test.beforeEach(async ({ request }) => {
  escenario = { itemIds: [] }
  escenario.token = await tokenDe(request, TENANTS.restaurante)
  escenario.cajaId = await abrirCaja(request, escenario.token)
})

test.afterEach(async ({ request }) => {
  const { token, cajaId, itemIds } = escenario
  if (!token) return
  // Red de seguridad del camino de FALLO. Si el test llegó al final ya cerró la
  // caja y este `conteo` rebota con un 4xx, que es exactamente lo que se quiere:
  // `cerrarCaja` devuelve `undefined` sin romper. Si el test murió antes, la
  // cierra igual — el tenant tiene un solo cajón y dejarlo tomado deja la
  // corrida siguiente sin poder ni empezar.
  // El monto no importa acá: si no cuadra, `cerrarCaja` resuelve la
  // conciliación y cierra igual. Lo que importa es que el cajón quede libre.
  if (cajaId) await cerrarCaja(request, token, cajaId, '0')
  await limpiarItems(request, token, itemIds)
})

/** Crea el producto y lo anota para que el `afterEach` lo dé de baja. */
async function sembrarProducto(
  request: Parameters<typeof crearProducto>[0],
  datos: Parameters<typeof crearProducto>[2],
): Promise<{ id: string }> {
  const item = await crearProducto(request, escenario.token!, datos)
  escenario.itemIds.push(item.id)
  return item
}

/**
 * El valor de una fila del desglose del carrito — la `<span>` que sigue a la
 * etiqueta, no cualquier monto de la pantalla.
 *
 * ⚠️ Sin anclar es **vacuo**: el catálogo comparte pantalla con el carrito y
 * basta un ítem de $1.690 para que un `getByText('$1.690')` pase con el carrito
 * equivocado. Y el locator es **estricto** (sin `.first()`): si algún día hay dos
 * etiquetas iguales, el test explota con un strict-mode violation en vez de
 * elegir una en silencio.
 *
 * `normalize-space(text())` mira solo los nodos de texto DIRECTOS: la fila
 * "Total" lleva adentro un `<VentasMonedaTasasInfo>`, así que un `hasText`
 * normal no la matchea. Y el xpath va **relativo** (`.//`): con `//` un locator
 * anidado igual busca en todo el documento, así que acotarlo al modal no
 * acotaría nada.
 */
function valorDeFila(raiz: Page | Locator, etiqueta: string) {
  return raiz
    .locator(`xpath=.//span[normalize-space(text())="${etiqueta}"]`)
    .locator('xpath=following-sibling::span[1]')
}

/** La tarjeta del catálogo, por el hook de test del componente. */
function tarjetaDeCatalogo(page: Page, itemId: string) {
  return page.locator(`[data-qa="item-catalogo-${itemId}"]`)
}

test('cobra un afecto y un exento: el IVA sale solo del afecto, y así queda en el servidor', async ({
  page,
  request,
}) => {
  const token = escenario.token!
  const marca = Date.now()

  const afecto = await sembrarProducto(request, {
    nombre: `POS afecto ${marca}`,
    precioBase: PRECIO_AFECTO,
  })
  const exento = await sembrarProducto(request, {
    nombre: `POS exento ${marca}`,
    precioBase: PRECIO_EXENTO,
    clasificacionTributaria: 'exento',
  })

  await page.goto('/ventas/pos')

  // 1. Cargar el carrito desde el catálogo.
  await tarjetaDeCatalogo(page, afecto.id).click()
  await tarjetaDeCatalogo(page, exento.id).click()

  // 2. El desglose que ve el cajero. `Neto` y `Total` solos no distinguirían un
  //    exento de un afecto; la fila de impuestos sí: $190 es el 19% de los
  //    $1.000 afectos, no de los $1.500 del carrito (que serían $285).
  await expect(valorDeFila(page, 'Neto')).toHaveText(NETO)
  await expect(valorDeFila(page, 'Impuestos')).toHaveText(IVA)
  await expect(valorDeFila(page, 'Total')).toHaveText(TOTAL_VENTA)

  // 3. Cobrar. El modal precarga método por defecto, total y propina sugerida.
  await page.getByRole('button', { name: 'Cobrar', exact: true }).click()
  const cobro = page.getByRole('dialog').filter({ hasText: 'Cobrar venta' })
  await expect(valorDeFila(cobro, 'Total venta')).toHaveText(TOTAL_VENTA)
  await expect(
    cobro.locator(
      'xpath=//span[normalize-space(text())="Propina"]/following-sibling::*[1]//input',
    ),
  ).toHaveValue(PROPINA_SUGERIDA)
  await expect(valorDeFila(cobro, 'Total a pagar')).toHaveText(TOTAL_A_PAGAR)

  // 4. Confirmar. El id de la venta se toma de la respuesta del POST y no del
  //    "última venta del listado": con otra corrida en el medio, esa heurística
  //    verifica la venta de otro.
  const respuesta = page.waitForResponse(
    (r) => r.url().endsWith('/ventas') && r.request().method() === 'POST',
  )
  await cobro.getByRole('button', { name: 'Confirmar venta' }).click()
  const ventaId = ((await (await respuesta).json()) as { id: string }).id

  // 5. La pantalla cerró el ciclo: avisó y dejó el carrito limpio para la venta
  //    siguiente. Plazo propio y no el default de 5 s: entre el aviso y el
  //    carrito vacío se intenta imprimir la boleta, y esa espera sola ya agota
  //    los 5 s cuando QZ Tray no está (`PRINT_TIMEOUT_MS`). Medido.
  //    ⚠️ Aserciones de cliente — el toast sale de un mapa local. La plata la
  //    verifican los pasos 6 y 7.
  await expect(page.getByText('Venta pagada').first()).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByText('Agregá ítems desde el catálogo.')).toBeVisible({
    timeout: 15_000,
  })

  // 6. Lo que quedó del lado del servidor. El desglose POR LÍNEA es lo que hace
  //    que este test hable de "exento" y no solo de un total: un IVA aplicado a
  //    todo daría $285 en la venta y $95 en la línea exenta.
  const venta = await api<VentaServidor>(request, 'get', `/ventas/${ventaId}`, {
    token,
  })
  expect(venta.estado).toBe('pagada')
  expect(venta.tipoDocumento?.codigo).toBe('39')
  expect(venta.totalImpuestos).toBe('190.0000')
  expect(venta.totalFinal).toBe('1690.0000')
  expect(venta.propina?.montoPagado).toBe('169.0000')

  const impuestoPorItem = new Map(
    venta.detalles.map((d) => [d.itemId, d.impuestoAplicado]),
  )
  expect(impuestoPorItem.get(afecto.id)).toBe('190.0000')
  expect(impuestoPorItem.get(exento.id)).toBe('0.0000')

  // 7. Y la caja espera exactamente lo cobrado: `cerrada` solo sale si el conteo
  //    cuadra con lo que el servidor calculó, venta + propina.
  expect(await cerrarCaja(request, token, escenario.cajaId!, EFECTIVO_ESPERADO))
    .toBe('cerrada')
})

/**
 * Stock inicial del producto del test de inventario, y lo que se vende de él.
 * Las cantidades van dos veces porque se leen en dos escalas distintas: la
 * pantalla muestra `8`, y la API devuelve el `numeric(18,4)` de la columna.
 */
const STOCK_INICIAL = '10'
const UNIDADES_VENDIDAS = 2
const STOCK_RESULTANTE = '8'
const STOCK_INICIAL_API = '10.0000'
const STOCK_RESULTANTE_API = '8.0000'
const UNIDADES_VENDIDAS_API = '2.0000'

interface Movimiento {
  motivo: string
  tipo: string
  cantidad: string
  stockAnterior: string
  stockResultante: string
}

test('vender descuenta el stock: queda el movimiento auditable y el saldo al día', async ({
  page,
  request,
}) => {
  const token = escenario.token!
  const producto = await sembrarProducto(request, {
    nombre: `POS stock ${Date.now()}`,
    precioBase: PRECIO_AFECTO,
    stock: STOCK_INICIAL,
  })

  await page.goto('/ventas/pos')

  // Dos clicks sobre la misma tarjeta = una línea de cantidad 2 (`agregarLinea`
  // acumula en vez de duplicar la línea).
  const tarjeta = tarjetaDeCatalogo(page, producto.id)
  for (let i = 0; i < UNIDADES_VENDIDAS; i++) await tarjeta.click()

  // El catálogo ya descuenta lo que está en el carrito, ANTES de cobrar: es
  // aritmética de cliente para no dejar vender lo que ya está reservado en la
  // pantalla. Lo que pasó de verdad se verifica abajo, contra el servidor.
  await expect(tarjeta).toContainText(`Stock: ${STOCK_RESULTANTE}`)

  await page.getByRole('button', { name: 'Cobrar', exact: true }).click()
  const cobro = page.getByRole('dialog').filter({ hasText: 'Cobrar venta' })
  await cobro.getByRole('button', { name: 'Confirmar venta' }).click()
  await expect(page.getByText('Venta pagada').first()).toBeVisible({
    timeout: 15_000,
  })

  // El saldo materializado.
  const item = await api<{ stock: string }>(
    request,
    'get',
    `/items/${producto.id}`,
    { token },
  )
  expect(item.stock).toBe(STOCK_RESULTANTE_API)

  // Y la fuente de verdad auditable, que es la que manda: un solo movimiento de
  // salida por la venta, con el antes y el después. Sin esto, un stock correcto
  // podría venir de un UPDATE sin movimiento — que es exactamente el bug que
  // `movimientos_inventario` existe para hacer imposible.
  const movimientos = await api<{ data: Movimiento[] }>(
    request,
    'get',
    `/inventario/movimientos?itemId=${producto.id}`,
    { token },
  )
  const deVenta = movimientos.data.filter((m) => m.motivo === 'venta')
  expect(deVenta).toHaveLength(1)
  expect(deVenta[0]?.tipo).toBe('salida')
  expect(deVenta[0]?.cantidad).toBe(UNIDADES_VENDIDAS_API)
  expect(deVenta[0]?.stockAnterior).toBe(STOCK_INICIAL_API)
  expect(deVenta[0]?.stockResultante).toBe(STOCK_RESULTANTE_API)
})
