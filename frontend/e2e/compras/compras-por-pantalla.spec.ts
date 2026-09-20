import Decimal from 'decimal.js'
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { API, api, crearProducto, limpiarItems, tokenDe, TENANTS } from '../support/api'

/**
 * Compras por pantalla, **como el encargado de compras** (`encargado.compras`:
 * las cuatro acciones de Compras y nada más). Con admin, que lo puede todo,
 * pasaba que la carga del borrador pedía `/items`, el encargado recibía 403 y
 * nadie se enteraba (owner, 2026-09-19).
 *
 * Cubre los pasos que hasta el 2026-09-20 se corrían a mano y hoy viven en
 * `docs/features/compras.md` § «El smoke, automatizado»: cargar con una línea
 * sin precio · confirmar así · completar el precio · corregir una cantidad
 * (bajarla, y el rebote cuando ya no queda saldo) · anular. Más un test que no
 * es uno de esos pasos: que la lista de productos del formulario sea la de
 * Compras, medido como que **no se pide** `/items` —no como un 403, que hoy ni
 * siquiera puede ocurrir—.
 *
 * **Qué aporta sobre `backend/test/compras.e2e-spec.ts`, que ya prueba las
 * cuentas.** Nada de lo que el servidor decide: eso está cubierto ahí y
 * duplicarlo acá sería más lento y más frágil por el mismo dato. Lo que solo se
 * puede romper del lado del navegador:
 *
 * - el **cuerpo que arma el formulario** — un `precioUnitario` vacío que
 *   viajara como `0` sería un precio legítimo para la API, y el costo promedio
 *   del producto quedaría ensuciado sin que ningún test de API lo note;
 * - lo que la pantalla **dice antes de mover plata** (el resumen de confirmar)
 *   y **después** (las insignias, el historial, el mensaje de un rebote);
 * - que cada acción le llegue al **rol** que la ejecuta, no a admin.
 *
 * Las precondiciones —los productos, el proveedor, el stock previo— se arman
 * por API como admin: crear ítems y proveedores no es de Compras. Los montos
 * salen de `docs/features/motor-calculo-precios.md` y ADR-016 (CPP), con la
 * cuenta escrita al lado; nunca de la salida del código.
 */

// Sin la sesión de admin que guarda `auth.setup.ts`: cada test entra como el
// encargado.
test.use({ storageState: { cookies: [], origins: [] } })

const ENCARGADO = { email: 'encargado.compras@paris.cl', password: 'admin' }

let escenario: { token?: string, itemIds: string[], proveedorId?: string } = { itemIds: [] }

test.beforeEach(async ({ request }) => {
  escenario = { itemIds: [] }
  escenario.token = await tokenDe(request, TENANTS.restaurante)
})

test.afterEach(async ({ request }) => {
  if (!escenario.token) return
  await limpiarItems(request, escenario.token, escenario.itemIds)
  // El proveedor también: si no, cada corrida deja uno más en el tenant demo
  // (el mismo motivo que `limpiarItems`). La compra anulada queda: es su estado
  // final, y nunca se borra (spec § 4.5).
  if (escenario.proveedorId) {
    const res = await request.delete(`${API}/terceros/${escenario.proveedorId}`, {
      headers: { Authorization: `Bearer ${escenario.token}` },
    })
    if (!res.ok()) {
      console.warn(`[e2e] no se pudo dar de baja el proveedor: ${res.status()} ${await res.text()}`)
    }
  }
})

/** Login por pantalla. Tiene un solo tenant: entra directo, sin elegir. */
async function entrarComoEncargado(page: Page) {
  // networkidle: esperar la hidratación antes de tipear (ver auth.setup.ts).
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.getByPlaceholder('tu@email.com').fill(ENCARGADO.email)
  await page.locator('input[type="password"]').first().fill(ENCARGADO.password)
  const submit = page.locator('button[type="submit"]').first()
  await expect(submit).toBeEnabled()
  await submit.click()
  await page.waitForURL(url => url.pathname === '/')
}

/**
 * Tipea en un `MoneyInput` tecla por tecla (maska ignora `fill`).
 *
 * `raiz` acota: en el formulario de carga hay un `compra-precio` **por línea**,
 * y un selector de página entera encontraría los dos.
 */
async function escribirEn(raiz: Page | Locator, qa: string, valor: string) {
  const input = raiz.locator(`input[data-qa="${qa}"]`)
  await input.selectText()
  await input.pressSequentially(valor)
}

/**
 * Elige en un `USelectMenu` haciendo pie en su **placeholder**.
 *
 * No se usa `elegirEnSelector` de `support/ui.ts` por dos razones, y ninguna es
 * que no acepte una raíz (la acepta). Una: los tres selectores del encabezado
 * **comparten** raíz —el formulario— y `elegirEnSelector` busca el trigger por
 * su rol ("Show popup", el label que Reka le pone a TODOS), así que ahí
 * encontraría tres. El placeholder es lo único que los distingue sin inventar
 * un contenedor. Dos: los `searchable` no dibujan la opción hasta que se
 * tipea, y eso `elegirEnSelector` no lo hace.
 *
 * ⚠️ Espera a que el popup **desaparezca**, no solo a que el trigger muestre el
 * valor nuevo: al cerrarse, Reka devuelve el foco al trigger, y ese salto le
 * roba las teclas a lo que se escriba después — acá, al precio de la línea.
 * Medido en `support/ui.ts`, mismo gesto.
 */
async function elegirPorPlaceholder(
  raiz: Page | Locator,
  placeholder: string,
  opcion: string,
  opts: { buscar?: boolean, exacta?: boolean } = {},
) {
  const page = 'goto' in raiz ? raiz : raiz.page()
  await raiz.getByText(placeholder).click()
  // Los `searchable` no dibujan la opción hasta que se tipea.
  if (opts.buscar) await page.keyboard.type(opcion)
  await page.getByRole('option', { name: opcion, exact: opts.exacta ?? false }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  // La elección prendió: el placeholder deja lugar al valor. Sin esto, un click
  // que no seleccionó nada seguiría de largo y el fallo aparecería recién al
  // guardar, lejos de su causa.
  // ⚠️ Lo que impide que esto sea decorativo es el click **estricto** de arriba:
  // si el locator resolviera a 0 se colgaría, y a 2 o más tiraría strict-mode,
  // así que al llegar acá el count es exactamente 1. Un `.first()` puesto allá
  // para callar un strict-mode apagaría esta aserción en silencio.
  await expect(raiz.getByText(placeholder)).toHaveCount(0)
}

/** Un proveedor propio del test; el `afterEach` lo da de baja. */
async function crearProveedor(request: APIRequestContext, sello: number) {
  const nombre = `Distribuidora e2e ${sello}`
  const proveedor = await api<{ id: string }>(request, 'post', '/terceros', {
    token: escenario.token!,
    data: { tipo: 'proveedor', nombre },
  })
  escenario.proveedorId = proveedor.id
  return { id: proveedor.id, nombre }
}

/**
 * El local del tenant. Se lee del listado —no se crea— porque es único por
 * tenant, y el `find` va por `tipo`, que lo identifica, no por posición.
 */
async function ubicacionLocal(request: APIRequestContext) {
  const ubicaciones = await api<{ id: string, tipo: string, nombre: string }[]>(
    request, 'get', '/ubicaciones', { token: escenario.token! },
  )
  return ubicaciones.find(u => u.tipo === 'local')!
}

/** Un producto propio del test, sin stock ni costo respaldado. */
async function productoVacio(request: APIRequestContext, nombre: string) {
  const producto = await crearProducto(request, escenario.token!, {
    nombre, precioBase: '3000', stock: '0',
  })
  escenario.itemIds.push(producto.id)
  return { id: producto.id, nombre }
}

/** Una entrada de stock con su costo, para que el CPP tenga de dónde ponderar. */
async function entradaPrevia(
  request: APIRequestContext,
  itemId: string,
  ubicacionId: string,
  cantidad: string,
  costoUnitario: string,
) {
  await api(request, 'patch', `/items/${itemId}/stock`, {
    token: escenario.token!,
    data: { ubicacionId, tipo: 'entrada', motivo: 'compra', cantidad, costoUnitario },
  })
}

/** Lo que quedó del lado del servidor: el stock total y el costo promedio. */
async function stockYCosto(request: APIRequestContext, itemId: string) {
  const item = await api<{ stock: string, costoActual: string | null }>(
    request, 'get', `/items/${itemId}`, { token: escenario.token! },
  )
  return {
    stock: new Decimal(item.stock).toFixed(4),
    costo: item.costoActual == null ? null : new Decimal(item.costoActual).toFixed(4),
  }
}

/** Una compra confirmada de una línea, armada por API: la precondición, no el sujeto. */
async function compraConfirmada(
  request: APIRequestContext,
  linea: { itemId: string, cantidad: string, precioUnitario?: string },
  ubicacionId: string,
  proveedorId: string,
) {
  const token = escenario.token!
  const tipos = await api<{ id: string, requiereFolio: boolean }[]>(
    request, 'get', '/compras/tipos-documento', { token },
  )
  const borrador = await api<{ id: string, lineas: { id: string }[] }>(
    request, 'post', '/compras', {
      token,
      data: {
        proveedorId,
        tipoDocumentoCompraId: tipos.find(t => !t.requiereFolio)!.id,
        fechaDocumento: '2026-09-15',
        ubicacionId,
        lineas: [{ unidadCodigo: 'unidad', ...linea }],
      },
    },
  )
  await api(request, 'post', `/compras/${borrador.id}/confirmar`, { token })
  return { id: borrador.id, lineaId: borrador.lineas[0]!.id }
}

test('el encargado encuentra el producto al cargar una compra: la lista es de Compras', async ({ page, request }) => {
  const nombre = `Harina compras e2e ${Date.now()}`
  const producto = await crearProducto(request, escenario.token!, { nombre, precioBase: '900', stock: '0' })
  escenario.itemIds.push(producto.id)

  await entrarComoEncargado(page)
  const listados: string[] = []
  page.on('response', (r) => {
    if (r.url().includes('/api/items')) listados.push(`${r.status()} ${r.url()}`)
  })
  await page.goto('/compras/nueva', { waitUntil: 'networkidle' })

  await page.getByText('Selecciona un producto').click()
  await page.keyboard.type(nombre)
  await expect(page.getByRole('option', { name: nombre })).toBeVisible()
  // Ni un pedido al catálogo de ítems, que el encargado no puede leer.
  expect(listados).toEqual([])
})

/**
 * Smoke § 1 y § 2, de punta a punta por el formulario.
 *
 * La línea sin precio es el sujeto: el formulario la manda con
 * `precioUnitario: null` ("falta costo"), y el backend la hace entrar al stock
 * sin tocar el costo promedio (ADR-016). Si el `''` del `MoneyInput` viajara
 * como `0`, la API lo tomaría como un precio de regalo perfectamente válido —
 * 200, insignia apagada y el costo del tomate reventado a $222,2222— y ningún
 * test de la API lo vería, porque la API nunca manda `''`.
 */
test('cargar con una línea sin precio y confirmar: entran las dos y el costo promedio no se ensucia con un cero', async ({ page, request }) => {
  const sello = Date.now()
  const proveedor = await crearProveedor(request, sello)
  const local = await ubicacionLocal(request)

  // Dos productos distintos: el smoke mira que suba el stock de LOS DOS.
  const conPrecio = await productoVacio(request, `Harina compras e2e ${sello}`)
  const sinPrecio = await productoVacio(request, `Tomate compras e2e ${sello}`)
  // El tomate llega con stock y costo YA respaldados por un movimiento: sin
  // eso, "no ensucia el costo" no se distinguiría de "no había nada que
  // ensuciar", y la aserción sería vacua. $500 y no $400 a propósito: $400 es
  // lo que `crearProducto` escribe por default, y con ese valor la aserción
  // tampoco distinguiría "lo puso esta entrada" de "ya estaba ahí".
  await entradaPrevia(request, sinPrecio.id, local.id, '4', '500')

  await entrarComoEncargado(page)
  await page.goto('/compras/nueva', { waitUntil: 'networkidle' })

  // ── El encabezado ────────────────────────────────────────────────────────
  await elegirPorPlaceholder(page, 'A quién se le compró', proveedor.nombre, { buscar: true })
  // `exacta`: Chile también tiene "Factura exenta" y "Factura de compra".
  await elegirPorPlaceholder(page, 'Factura, boleta, sin documento…', 'Factura', { exacta: true })
  await page.locator('input[data-qa="compra-folio"]').fill(`E2E-${sello}`)
  await elegirPorPlaceholder(page, 'Local o bodega', local.nombre, { exacta: true })

  // ── Las dos líneas ───────────────────────────────────────────────────────
  const lineas = page.locator('[data-qa="compra-linea"]')
  const primera = lineas.nth(0)
  await elegirPorPlaceholder(primera, 'Selecciona un producto', conPrecio.nombre, { buscar: true })
  await primera.locator('input[data-qa="compra-cantidad"]').fill('10')
  await escribirEn(primera, 'compra-precio', '1500')

  await page.getByRole('button', { name: 'Agregar línea' }).click()
  const segunda = lineas.nth(1)
  await elegirPorPlaceholder(segunda, 'Selecciona un producto', sinPrecio.nombre, { buscar: true })
  await segunda.locator('input[data-qa="compra-cantidad"]').fill('5')
  // Y el precio se deja vacío: eso es lo que se está probando.

  // La pantalla ya sabe que falta un precio antes de mandar nada, y por eso
  // cierra el descuento al total: repartirlo sin todos los precios es 400.
  await expect(page.getByText('Hay líneas sin precio')).toBeVisible()
  await expect(page.locator('[data-qa="compra-descuento-ayuda"]')).toBeVisible()
  await expect(page.locator('input[data-qa="compra-descuento"]')).toBeDisabled()

  // ── Guardar: queda Borrador, y el listado TODAVÍA NO dice "Falta costo" ───
  await page.locator('[data-qa="compra-guardar"]').click()
  await page.waitForURL(/\/compras\/[0-9a-f-]{36}$/)

  await page.goto('/compras', { waitUntil: 'networkidle' })
  // `locator('tr')` y no `getByRole('row')`: el listado abre la compra al
  // clickearla, y Nuxt UI le pone `role="button"` a la fila selectable, así que
  // para el árbol de accesibilidad deja de ser una fila.
  const fila = page.locator('tr').filter({ hasText: proveedor.nombre })
  await expect(fila).toHaveCount(1)
  await expect(fila.getByText('Borrador', { exact: true })).toBeVisible()
  // Y **todavía no** dice "Falta costo": la insignia es de las confirmadas, no
  // de los borradores (`compras.service.ts` → `mapCabecera`, y el mismo
  // `estado = 'confirmada'` en el filtro del listado). Un borrador sin precio no
  // le debe nada a nadie: no movió stock ni costo. Esta negativa no es vacua: la
  // sostiene la positiva sobre el MISMO locator y el mismo texto, después de
  // confirmar (buscá `Falta costo` más abajo en este test) — que es donde la
  // insignia significa algo. Si alguien la renombra, esa positiva cae.
  await expect(fila.getByText('Falta costo')).toHaveCount(0)

  // ── Confirmar: el modal dice qué entra y adónde ANTES de mover stock ──────
  await fila.click()
  await page.waitForURL(/\/compras\/[0-9a-f-]{36}$/)
  await page.locator('[data-qa="compra-confirmar"]').click()
  const resumen = page.locator('[data-qa="compra-confirmar-resumen"]')
  // "2 líneas": si el formulario descartara la línea sin precio, diría 1 — y el
  // tomate no entraría nunca.
  await expect(resumen).toContainText(`Entran 2 líneas a ${local.nombre}`)
  await expect(resumen).toContainText('1 línea entra sin precio')
  await page.locator('[data-qa="compra-confirmar-si"]').click()

  const detalle = page.locator('[data-qa="compra-confirmada"]')
  await expect(detalle).toBeVisible()
  await expect(detalle.getByRole('row').filter({ hasText: conPrecio.nombre })).toContainText('$1.500')
  await expect(
    detalle.getByRole('row').filter({ hasText: sinPrecio.nombre }).getByText('Falta costo'),
  ).toBeVisible()

  // Ahora sí, en el listado: entró mercadería con un costo sin completar, y esa
  // es la compra que hay que ir a buscar cuando llegue la factura.
  await page.goto('/compras', { waitUntil: 'networkidle' })
  const confirmada = page.locator('tr').filter({ hasText: proveedor.nombre })
  await expect(confirmada.getByText('Confirmada', { exact: true })).toBeVisible()
  await expect(confirmada.getByText('Falta costo', { exact: true })).toBeVisible()

  // ── Lo que quedó del lado del servidor ───────────────────────────────────
  // Harina: entró sin stock previo, y el CPP sin stock que ponderar toma el
  // costo de lo que entra (ADR-016). 10 × $1.500 / 10. (No es que no tuviera
  // costo: `crearProducto` escribe $400 por default, pero sin stock detrás ese
  // número no pesa.)
  expect(await stockYCosto(request, conPrecio.id)).toEqual({
    stock: '10.0000', costo: '1500.0000',
  })
  // Tomate: entran las 5 unidades (4 + 5 = 9) y el costo se queda en los $500
  // de la entrada previa, porque una línea sin precio no entra al promedio.
  // Con un 0 por precio sí entraría —el 0 es el regalo, no la ausencia— y daría
  // (4 × 500 + 5 × 0) / 9 = $222,2222.
  expect(await stockYCosto(request, sinPrecio.id)).toEqual({
    stock: '9.0000', costo: '500.0000',
  })
})

/**
 * El índice de una columna por su encabezado, para no contar celdas a mano: en
 * el kardex la columna *Ubicación* solo se dibuja si el tenant tiene bodegas
 * (`docs/features/bodegas-y-traslados.md`), así que las posteriores se corren.
 */
async function columna(page: Page, encabezado: string): Promise<number> {
  const encabezados = await page.getByRole('columnheader').allTextContents()
  const i = encabezados.findIndex(h => h.trim() === encabezado)
  expect(i, `el kardex no tiene columna "${encabezado}"`).toBeGreaterThanOrEqual(0)
  return i
}

/**
 * Smoke § 4: bajar una cantidad, y el control transversal del kardex.
 *
 * La cuenta la prueba la API; acá el sujeto es doble. Por pantalla: que el
 * historial muestre el cambio **como cantidad con su unidad** y no como plata
 * —`CompraConfirmada` decide eso por el nombre del campo, y equivocarse manda
 * "$5 → $3" a una columna que habla de unidades—. Y en **Inventario →
 * movimientos**: que la corrección deje **filas propias** —la salida del stock
 * y, aparte, el ajuste de valor— sin reescribir las anteriores, y con el motivo
 * traducido. Un motivo nuevo que nadie agrega al mapa
 * de etiquetas se dibuja como `correccion_compra` crudo, y eso no lo ve ningún
 * test de la API (`anti-patterns.md` → vocabulario compartido).
 *
 * El kardex se mira como **admin**, en su propio contexto: el encargado de
 * compras no tiene el módulo Inventario, y entrar ahí con su sesión sería
 * probar un 403.
 */
test('bajar una cantidad: el historial la anota con su unidad y el kardex suma sus filas sin tocar las viejas', async ({ page, request, browser }) => {
  const sello = Date.now()
  const proveedor = await crearProveedor(request, sello)
  const local = await ubicacionLocal(request)
  const producto = await productoVacio(request, `Aceite compras e2e ${sello}`)

  // 5 unidades a $400 de antes, para que el promedio tenga de dónde ponderar.
  await entradaPrevia(request, producto.id, local.id, '5', '400')
  const compra = await compraConfirmada(
    request,
    { itemId: producto.id, cantidad: '5', precioUnitario: '2000' },
    local.id,
    proveedor.id,
  )
  // (5 × $400 + 5 × $2.000) / 10
  expect(await stockYCosto(request, producto.id)).toEqual({
    stock: '10.0000', costo: '1200.0000',
  })

  await entrarComoEncargado(page)
  await page.goto(`/compras/${compra.id}`, { waitUntil: 'networkidle' })

  await page.locator(`[data-qa="compra-corregir-${compra.lineaId}"]`).click()
  const dialogo = page.getByRole('dialog')
  await expect(dialogo).toContainText('Corregir la línea')
  await escribirEn(dialogo, 'corregir-cantidad', '3')
  await page.locator('[data-qa="corregir-enviar"]').click()
  await expect(dialogo).toHaveCount(0)

  const detalle = page.locator('[data-qa="compra-confirmada"]')
  // La fila de la línea, no la del historial: las dos nombran al producto, y
  // las del historial son las que llevan la flecha del "antes → después".
  const filaLinea = detalle.getByRole('row')
    .filter({ hasText: producto.nombre })
    .filter({ hasNotText: '→' })
  await expect(filaLinea).toContainText('3 unidad')
  // Cantidades con su unidad, no montos: el historial mezcla las dos cosas en
  // la misma columna y las distingue por el campo.
  const historial = page.locator('[data-qa="compra-historial"]')
  await expect(historial).toContainText('Cantidad')
  await expect(historial).toContainText('5 unidad → 3 unidad')

  // (5 × $400 + 3 × $2.000) / 8: los 2 que no llegaron dejan de pesar.
  expect(await stockYCosto(request, producto.id)).toEqual({
    stock: '8.0000', costo: '1000.0000',
  })

  // ── El kardex, como admin ────────────────────────────────────────────────
  const adminCtx = await browser.newContext({
    storageState: 'e2e/.auth/paris.json',
    baseURL: test.info().project.use.baseURL,
  })
  try {
    const admin = await adminCtx.newPage()
    await admin.goto('/inventario', { waitUntil: 'networkidle' })

    // Por nombre y no por el filtro de producto: el desplegable se llena con un
    // `pageSize=100` del catálogo, y un producto recién creado puede quedar
    // fuera. El producto nació en este test, así que estos son TODOS sus
    // movimientos, y son los más nuevos de la página (orden `creado_el DESC`).
    const filas = admin.getByRole('row').filter({ hasText: producto.nombre })
    // Cuatro, no tres: bajar la cantidad deja la salida del stock Y —aparte— el
    // ajuste de valor, porque el costo resultante difiere del vigente
    // (`docs/features/compras.md` § «Rehacer la cuenta»).
    await expect(filas).toHaveCount(4)

    // **Ninguna fila se reescribió**, y se afirma sin depender del orden: los
    // dos movimientos de la corrección se escriben en la MISMA transacción y
    // comparten `creado_el` al microsegundo, así que `ORDER BY creado_el DESC`
    // no los desempata y cuál va arriba es indistinto (ver `pendientes.md`).
    // El saldo de cada fila sí es invariante: 5 de la entrada previa, 10 de la
    // compra —intacto, el número que dijo el día que entró—, y 8 en las dos que
    // dejó la corrección. Si hubiera reescrito el movimiento de la compra en
    // vez de agregar los suyos, el 10 no estaría.
    const resultante = await columna(admin, 'Resultante')
    const saldos = await filas.locator(`td:nth-child(${resultante + 1})`).allTextContents()
    expect(saldos.map(t => t.trim()).sort()).toEqual(['10', '5', '8', '8'])

    // El ajuste de valor, que es lo que el motivo `correccion_compra` nombra:
    // no mueve cantidad, mueve el costo de $1.200 a $1.000 — las dos cuentas
    // que este test ya derivó arriba. Y lo nombra traducido: un motivo que
    // nadie agregue al mapa de etiquetas se dibujaría como `correccion_compra`.
    const correccion = filas.filter({ hasText: 'Corrección de compra' })
    await expect(correccion).toHaveCount(1)
    await expect(correccion.getByText('Ajuste', { exact: true })).toBeVisible()
    await expect(correccion).toContainText('$1.200')
    await expect(correccion).toContainText('$1.000')
    // Y la mercadería que se fue: su propia fila, una sola.
    await expect(filas.filter({ hasText: 'Salida' })).toHaveCount(1)
  }
  finally {
    await adminCtx.close()
  }
})

/**
 * Smoke § 4, el otro final: bajar por debajo de lo que queda es 400.
 *
 * El documento lo llama resultado correcto, y por eso se cubre: la API ya
 * prueba que el 400 dice cuánto queda (`compras.e2e-spec.ts`), pero que ese
 * mensaje **llegue a la pantalla** depende de `apiErrorMsg` desenvolviendo el
 * error de `$fetch`. Si eso se rompe, el encargado ve "Error al corregir la
 * línea" a secas, sin el único dato que le dice qué poner — y el gate de la API
 * sigue verde.
 */
test('bajar por debajo de lo que queda: la pantalla muestra cuánto queda y no toca la línea', async ({ page, request }) => {
  const sello = Date.now()
  const proveedor = await crearProveedor(request, sello)
  const local = await ubicacionLocal(request)
  const producto = await productoVacio(request, `Azúcar compras e2e ${sello}`)

  const compra = await compraConfirmada(
    request,
    { itemId: producto.id, cantidad: '10', precioUnitario: '1500' },
    local.id,
    proveedor.id,
  )
  // Salieron 8 de las 10 que entraron: quedan 2, así que bajar a 5 no cabe.
  await api(request, 'patch', `/items/${producto.id}/stock`, {
    token: escenario.token!,
    data: { ubicacionId: local.id, tipo: 'salida', motivo: 'ajuste_manual', cantidad: '8' },
  })

  await entrarComoEncargado(page)
  await page.goto(`/compras/${compra.id}`, { waitUntil: 'networkidle' })

  await page.locator(`[data-qa="compra-corregir-${compra.lineaId}"]`).click()
  await escribirEn(page.getByRole('dialog'), 'corregir-cantidad', '5')
  await page.locator('[data-qa="corregir-enviar"]').click()

  // El mensaje del backend, con el número: es lo que hace accionable el rebote.
  await expect(page.getByText(/quedan 2/).first()).toBeVisible()
  // Y no se perdió nada: el modal sigue abierto, con lo tecleado y con el valor
  // vigente al lado. Se asevera DENTRO del diálogo porque mientras está abierto
  // Reka esconde el resto de la página del árbol de accesibilidad, así que un
  // locator por rol sobre el detalle no encuentra nada — y porque el "Actual"
  // es justo lo que el encargado tiene delante para corregirse.
  const dialogo = page.getByRole('dialog')
  await expect(dialogo.locator('[data-qa="corregir-linea"]')).toBeVisible()
  await expect(dialogo).toContainText('Actual: 10 unidad')

  // Cerrado el modal, la línea sigue como estaba: la pantalla no pintó el 5.
  await dialogo.getByRole('button', { name: 'Cancelar' }).click()
  await expect(dialogo).toHaveCount(0)
  await expect(
    page.locator('[data-qa="compra-confirmada"]').getByRole('row').filter({ hasText: producto.nombre }),
  ).toContainText('10 unidad')
  expect((await stockYCosto(request, producto.id)).stock).toBe('2.0000')
})

/**
 * Smoke § 3 y § 5: completar el precio que faltaba y anular.
 *
 * El stock que vuelve al anular no se asevera acá: lo prueba
 * `compras.e2e-spec.ts` («el stock sale y el costo queda como si la compra no
 * hubiera existido»), y repetirlo por navegador no agrega ningún bug que atajar.
 * Lo de acá es la pantalla: que el precio complete, que la insignia se apague,
 * que el historial lo anote, que el descuento no se ofrezca hasta que todas las
 * líneas tengan precio, y que anular frene, pida motivo, deje el motivo a la
 * vista y cierre la compra a cualquier corrección.
 */
test('completar el precio, cargar el descuento y anular una compra confirmada', async ({ page, request }) => {
  const sello = Date.now()
  const proveedor = await crearProveedor(request, sello)
  const local = await ubicacionLocal(request)
  const producto = await productoVacio(request, `Tomate compras e2e ${sello}`)
  const compra = await compraConfirmada(
    request,
    { itemId: producto.id, cantidad: '10' },
    local.id,
    proveedor.id,
  )

  await entrarComoEncargado(page)
  await page.goto(`/compras/${compra.id}`, { waitUntil: 'networkidle' })
  const detalle = page.locator('[data-qa="compra-confirmada"]')
  await expect(detalle).toBeVisible()
  await expect(detalle.getByText('Falta costo')).toBeVisible()

  // Con una línea sin precio el descuento al total ni se ofrece: repartirlo
  // necesita el valor de cada línea, y el backend lo rechaza con 400. Es el
  // "recién ahí" del paso 3, y es puro frontend (`puedeDescontar`).
  await expect(page.locator('[data-qa="compra-descuento-abrir"]')).toHaveCount(0)

  // Completar el precio que faltaba.
  await page.locator(`[data-qa="compra-corregir-${compra.lineaId}"]`).click()
  const dialogo = page.getByRole('dialog')
  await expect(dialogo).toContainText('Completar el precio')
  await escribirEn(page, 'corregir-precio', '1500')
  await page.locator('[data-qa="corregir-enviar"]').click()
  await expect(dialogo).toHaveCount(0)
  await expect(detalle.getByText('Falta costo')).toHaveCount(0)
  await expect(page.locator('[data-qa="compra-historial"]')).toContainText('Precio')

  // El descuento, que ahora sí se ofrece: todas las líneas tienen precio.
  await page.locator('[data-qa="compra-descuento-abrir"]').click()
  await escribirEn(page, 'descuento-nuevo', '1000')
  await page.locator('[data-qa="descuento-enviar"]').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('[data-qa="compra-descuento-vigente"]')).toBeVisible()
  await expect(page.locator('[data-qa="compra-historial"]')).toContainText('Descuento al total')

  // Anular: frena, dice qué sale, y sin motivo no deja.
  await page.locator('[data-qa="compra-anular-abrir"]').click()
  await expect(page.locator('[data-qa="anular-compra-resumen"]')).toContainText('10 unidad')
  const anular = page.locator('[data-qa="anular-compra-si"]')
  await expect(anular).toBeDisabled()
  await page.locator('[data-qa="anular-compra-motivo"]').fill('Factura cargada dos veces')
  await anular.click()
  await expect(page.locator('[data-qa="compra-anulada-motivo"]')).toContainText('Factura cargada dos veces')
  await expect(page.locator('[data-qa="compra-anular-abrir"]')).toHaveCount(0)
  // Y tampoco se corrige. Esto vive SOLO en el frontend —`CompraConfirmada.vue`
  // saca la columna de acciones cuando la compra no está confirmada—, así que
  // no hay test de la API que pueda cazarlo: el backend nunca ve el pedido.
  // `CompraConfirmada.nuxt.spec.ts` lo cubre con props mockeadas; acá el estado
  // `anulada` llega de la API de verdad, y el rol es el del encargado.
  await expect(page.locator(`[data-qa="compra-corregir-${compra.lineaId}"]`)).toHaveCount(0)
})
