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

/**
 * Cobro de un solo producto afecto, que es la base de los dos flujos de pago:
 * $1.000 + 19% = $1.190 de venta, más el 10% sugerido de propina ($119) = $1.309
 * a pagar.
 */
const TOTAL_UN_AFECTO = '$1.190'
const A_PAGAR_UN_AFECTO = '$1.309'
/** El reparto del pago mixto: dos métodos que suman justo los $1.309. */
const PAGO_TARJETA = '500'
const PAGO_EFECTIVO = '809'
/** Sobrepago de un solo método, para el vuelto: $2.000 − $1.309. */
const SOBREPAGO = '2000'
const VUELTO = '$691'
const VUELTO_API = '691.0000'

const TARJETA_CREDITO = 'Tarjeta de crédito'
const EFECTIVO_NOMBRE = 'Efectivo'

interface PagoServidor {
  metodoPagoId: string
  monto: string
  vuelto: string
}

/** Una fila de pago del modal, por el hook de test del componente. */
function filaDePago(cobro: Locator, indice: number) {
  return cobro.locator(`[data-qa="pago-${indice}"]`)
}

/**
 * El selector de método de una fila de pago.
 *
 * ⚠️ `Show popup` es el label que Reka UI le pone por defecto al trigger del
 * `USelectMenu` — la pantalla no le da ninguno propio. Va acotado a la fila, así
 * que no puede agarrar el de otro pago.
 */
function selectorDeMetodo(fila: Locator) {
  return fila.getByRole('button', { name: 'Show popup' })
}

/**
 * Cambia el método de una fila de pago.
 *
 * ⚠️ Espera a que el popup DESAPAREZCA, no solo a que el trigger muestre el
 * nombre nuevo. Al cerrarse, Reka devuelve el foco al trigger, y ese salto le
 * roba las teclas a lo que se esté escribiendo después: sin esta espera, el
 * monto tecleado a continuación se perdía entero y el campo se quedaba con el
 * valor anterior. Medido.
 */
async function elegirMetodo(fila: Locator, nombre: string) {
  await selectorDeMetodo(fila).click()
  await fila.page().getByRole('option', { name: nombre, exact: true }).click()
  await expect(selectorDeMetodo(fila)).toContainText(nombre)
  await expect(fila.page().getByRole('listbox')).toHaveCount(0)
}

/**
 * Escribe un monto en el `MoneyInput` de una fila de pago.
 *
 * ⚠️ Tecla por tecla, no `fill()`: el input está enmascarado con maska, que
 * reformatea a partir de los eventos de teclado. Con `fill()` el valor del DOM
 * cambia pero el `v-model` se queda con el anterior — medido: el campo seguía
 * mostrando $1.309 después de un `fill('2000')`.
 */
async function escribirMonto(fila: Locator, monto: string) {
  const input = montoDePago(fila)
  await input.selectText()
  await input.pressSequentially(monto)
}

/**
 * El input de monto de una fila de pago. Va por `inputmode="decimal"` —el que
 * pone `MoneyInput`— y no por `input` a secas: el selector de método también
 * tiene uno, y un `ControlOrMeta+a` con el foco puesto ahí selecciona la página
 * entera en vez del monto. Medido.
 */
function montoDePago(fila: Locator) {
  return fila.locator('input[inputmode="decimal"]')
}

/** Deja el carrito con un solo producto afecto y abre el modal de cobro. */
async function carritoDeUnAfecto(
  page: Page,
  request: Parameters<typeof crearProducto>[0],
  marca: string,
): Promise<Locator> {
  const producto = await sembrarProducto(request, {
    nombre: `POS pago ${marca}`,
    precioBase: PRECIO_AFECTO,
  })
  await page.goto('/ventas/pos')
  await tarjetaDeCatalogo(page, producto.id).click()
  await expect(valorDeFila(page, 'Total')).toHaveText(TOTAL_UN_AFECTO)

  await page.getByRole('button', { name: 'Cobrar', exact: true }).click()
  const cobro = page.getByRole('dialog').filter({ hasText: 'Cobrar venta' })
  await expect(valorDeFila(cobro, 'Total a pagar')).toHaveText(A_PAGAR_UN_AFECTO)
  return cobro
}

test('pago mixto: dos métodos que suman justo, y la caja espera solo el efectivo', async ({
  page,
  request,
}) => {
  const token = escenario.token!
  const cobro = await carritoDeUnAfecto(page, request, String(Date.now()))

  // El modal precarga un solo pago con el total. Se parte en dos: tarjeta por
  // $500 y el resto en efectivo. El segundo pago nace con el `restante`, así que
  // no hace falta escribirlo — y que nazca con $809 ya es la aserción de que la
  // pantalla hizo bien la resta.
  //
  // ⚠️ Que el método por defecto sea "Efectivo" no es una regla: es
  // `metodosHabilitados[0]`, o sea el orden del catálogo del tenant. Si algún día
  // cambia el orden del seed, este test se cae acá —en una aserción explícita— y
  // no diez líneas después con un monto que no cuadra.
  await elegirMetodo(filaDePago(cobro, 0), TARJETA_CREDITO)
  await escribirMonto(filaDePago(cobro, 0), PAGO_TARJETA)
  await cobro.getByRole('button', { name: 'Agregar pago' }).click()
  await expect(selectorDeMetodo(filaDePago(cobro, 1))).toContainText(
    EFECTIVO_NOMBRE,
  )
  await expect(montoDePago(filaDePago(cobro, 1))).toHaveValue(PAGO_EFECTIVO)

  await expect(valorDeFila(cobro, 'Pagado')).toHaveText(A_PAGAR_UN_AFECTO)
  await expect(valorDeFila(cobro, 'Restante')).toHaveText('$0')
  await expect(valorDeFila(cobro, 'Vuelto')).toHaveText('$0')

  const respuesta = page.waitForResponse(
    (r) => r.url().endsWith('/ventas') && r.request().method() === 'POST',
  )
  await cobro.getByRole('button', { name: 'Confirmar venta' }).click()
  const ventaId = ((await (await respuesta).json()) as { id: string }).id
  await expect(page.getByText('Venta pagada').first()).toBeVisible({
    timeout: 15_000,
  })

  // Los dos pagos quedaron separados del lado del servidor: un solo pago por el
  // total —o uno de los dos con el monto del otro— pasaría cualquier aserción
  // sobre el total de la venta.
  const venta = await api<{ pagos: PagoServidor[] }>(
    request,
    'get',
    `/ventas/${ventaId}`,
    { token },
  )
  // Los ids salen del catálogo del tenant, no hardcodeados: lo que la prueba
  // afirma es que cada monto quedó en el MÉTODO que se eligió en pantalla.
  const metodos = await api<{ metodoPagoId: string; nombre: string }[]>(
    request,
    'get',
    '/metodos-pago',
    { token },
  )
  const idDe = (nombre: string) =>
    metodos.find((m) => m.nombre === nombre)?.metodoPagoId
  const porMetodo = new Map(venta.pagos.map((p) => [p.metodoPagoId, p.monto]))
  expect(venta.pagos).toHaveLength(2)
  expect(porMetodo.get(idDe(EFECTIVO_NOMBRE)!)).toBe('809.0000')
  expect(porMetodo.get(idDe(TARJETA_CREDITO)!)).toBe('500.0000')

  // Y la caja: el arqueo cuenta efectivo, así que espera los $809 y NO los
  // $1.309 de la venta. Lo cobrado con tarjeta no está en el cajón.
  expect(await cerrarCaja(request, token, escenario.cajaId!, PAGO_EFECTIVO))
    .toBe('cerrada')
})

test('el vuelto depende del método: con tarjeta no se puede devolver, con efectivo sí', async ({
  page,
  request,
}) => {
  const token = escenario.token!
  const cobro = await carritoDeUnAfecto(page, request, String(Date.now()))

  // Mismo sobrepago, misma fila: lo único que cambia entre los dos casos es el
  // método. Así el test no puede pasar por otra razón que la regla de
  // `permite_vuelto` (`docs/features/pagos.md`).
  await elegirMetodo(filaDePago(cobro, 0), TARJETA_CREDITO)
  await escribirMonto(filaDePago(cobro, 0), SOBREPAGO)
  await expect(
    cobro.getByText(
      'Los pagos con métodos sin vuelto superan el total: ese excedente no se puede devolver.',
    ),
  ).toBeVisible()
  await expect(valorDeFila(cobro, 'Vuelto')).toHaveText('$0')
  await expect(
    cobro.getByRole('button', { name: 'Confirmar venta' }),
  ).toBeDisabled()

  await elegirMetodo(filaDePago(cobro, 0), EFECTIVO_NOMBRE)
  await expect(valorDeFila(cobro, 'Vuelto')).toHaveText(VUELTO)

  const respuesta = page.waitForResponse(
    (r) => r.url().endsWith('/ventas') && r.request().method() === 'POST',
  )
  await cobro.getByRole('button', { name: 'Confirmar venta' }).click()
  const ventaId = ((await (await respuesta).json()) as { id: string }).id
  await expect(page.getByText('Venta pagada').first()).toBeVisible({
    timeout: 15_000,
  })

  const venta = await api<{ pagos: PagoServidor[] }>(
    request,
    'get',
    `/ventas/${ventaId}`,
    { token },
  )
  expect(venta.pagos).toHaveLength(1)
  expect(venta.pagos[0]?.monto).toBe('2000.0000')
  expect(venta.pagos[0]?.vuelto).toBe(VUELTO_API)

  // El cajón queda con lo entregado menos el vuelto, que es justo el total a
  // pagar. Si el vuelto no se descontara, el arqueo esperaría $2.000.
  expect(await cerrarCaja(request, token, escenario.cajaId!, '1309')).toBe(
    'cerrada',
  )
})
