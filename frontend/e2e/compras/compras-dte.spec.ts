import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect, type APIRequestContext, type Dialog, type Locator, type Page } from '@playwright/test'
import { API, api, crearProducto, limpiarItems, tokenDe, TENANTS } from '../support/api'
import { entrarComo } from '../support/ui'

/**
 * Compras, tarea 4 — cargar la compra desde el XML de la factura (DTE) del SII
 * (spec `docs/superpowers/specs/2026-09-27-compras-xml-dte-design.md`). Como
 * `encargado.compras`, mismo motivo que el resto de `e2e/compras/`: con admin
 * un 403 ajeno no se ve.
 *
 * Qué aporta sobre lo que ya prueban `useDte.spec.ts` (el lector, puro, con
 * `happy-dom`) y los e2e de la API (`lectura-dte.e2e-spec.ts` y el guardado en
 * `compras.e2e-spec.ts`, que prueban las cuentas y el aprendizaje). Lo que solo
 * se puede romper del lado del navegador real:
 *
 * - que `TextDecoder('ISO-8859-1')` decodifique bien un archivo subido de
 *   verdad (no el `happy-dom` de los specs de componente) — el fixture trae
 *   una tilde en esa codificación y se asevera que llega intacta a pantalla;
 * - el `<input type="file">` oculto del `UFileUpload` real, y el selector
 *   combinado unidad/presentación de una línea del XML, que arranca en blanco
 *   (nunca hereda "unidad": tarea 4 § 6) y no tiene texto contra el que hacer
 *   pie como el resto de `compras-presentacion.spec.ts` — se elige por
 *   posición, no por su valor actual;
 * - que el guard de salida (`onBeforeRouteLeave` + `confirm()`) dispare de
 *   verdad en el navegador, y que un 409 de folio repetido al guardar no
 *   pierda el formulario ni deje salir sin avisar (la "duda para el revisor"
 *   del brief).
 *
 * Las precondiciones (proveedor, productos, la "Caja (12)" de la Coca) se
 * arman por API como admin. El RUT del proveedor y los tres folios se generan
 * por corrida y se reescriben en el XML **en memoria** antes de subirlo: así
 * ninguno de los cuatro escenarios depende del seed ni de una corrida previa.
 *
 * **Desviación del brief** (regla del ruling: reportar, no doblar el test):
 * el brief describe el escenario 2 ("factura 2, otro folio") como "Guardar
 * habilitado sin tocar nada". En pantalla, `onCargarDte` (`pages/compras/[id]
 * .vue`) precarga proveedor, tipo, folio y fecha, pero **nunca** la ubicación
 * ("Entra a") — ni con el XML ni con la carga manual (spec § 6, y el propio
 * brief del Step 2 solo lista "proveedor, tipo, folio, fechaDocumento" entre
 * los campos que el XML precarga). Sin ubicación, `puedeGuardar` es `false`
 * pase lo que pase con las líneas. No es un bug de esta pieza: es un campo que
 * el XML no puede saber por sí solo (a qué local o bodega entra la mercadería
 * es una decisión del encargado, no algo que declare la factura). Este test
 * conserva la intención real del escenario — ninguna línea se toca a mano,
 * las dos calzan solas y el flete ya está apartado — y elige la ubicación
 * como el único paso adicional antes de Guardar.
 */

test.use({ storageState: { cookies: [], origins: [] } })

const ENCARGADO = { email: 'encargado.compras@paris.cl', password: 'admin' }

/** Plantilla real del SII, en ISO-8859-1 (con una tilde: "CAFÉ" en la línea de
 *  flete), con `__RUT__`/`__FOLIO__` para reescribir por corrida. Mismos
 *  montos que `frontend/app/composables/__fixtures__/dte/andina-33.xml`
 *  (fixture de `useDte.spec.ts`): Coca 10 CJ12 a $9.600 con 5% de descuento de
 *  línea ($9.120 c/u), Fanta 1 CJ12 a $8.800, flete $5.000, 2% de descuento
 *  global sin `IndExeDR` → $2.100 sobre los $105.000 afectos (spec § 3.3 y
 *  § 8). El cálculo puro ya lo prueba `useDte.spec.ts` con el mismo XML; acá
 *  se asevera además que la PANTALLA lo carga solo al apartar el flete (F1,
 *  ronda 1: el flete sin precio bloquea el descuento hasta que se aparta).
 */
const PLANTILLA_XML = readFileSync(
  resolve(process.cwd(), 'e2e/compras/fixtures/andina-dte.xml'),
  'latin1',
)

let escenario: { token?: string, itemIds: string[], proveedorId?: string } = { itemIds: [] }

test.beforeEach(async ({ request }) => {
  escenario = { itemIds: [] }
  escenario.token = await tokenDe(request, TENANTS.restaurante)
})

test.afterEach(async ({ request }) => {
  if (!escenario.token) return
  await limpiarItems(request, escenario.token, escenario.itemIds)
  if (escenario.proveedorId) {
    const res = await request.delete(`${API}/terceros/${escenario.proveedorId}`, {
      headers: { Authorization: `Bearer ${escenario.token}` },
    })
    if (!res.ok()) {
      console.warn(`[e2e] no se pudo dar de baja el proveedor: ${res.status()} ${await res.text()}`)
    }
  }
})

/**
 * El botón "Compras" para volver, dentro del encabezado de la página. En la
 * barra lateral "Compras" es el grupo —un botón, no un link— y su pantalla se
 * llama "Recepciones", así que el link con ese nombre exacto es solo este. Si
 * el lateral volviera a tener uno, el modo estricto de Playwright lo avisa.
 */
function botonVolverACompras(page: Page): Locator {
  return page.getByRole('link', { name: 'Compras', exact: true })
}

/** Elige en un `USelectMenu` haciendo pie en su placeholder (mismo helper que
 *  el resto de `e2e/compras/`; no se comparte módulo propio más allá de
 *  `support/api.ts`). */
async function elegirPorPlaceholder(
  raiz: Page | Locator,
  placeholder: string,
  opcion: string,
  opts: { buscar?: boolean, exacta?: boolean } = {},
) {
  const page = 'goto' in raiz ? raiz : raiz.page()
  await raiz.getByText(placeholder).click()
  if (opts.buscar) await page.keyboard.type(opcion)
  await page.getByRole('option', { name: opcion, exact: opts.exacta ?? false }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(raiz.getByText(placeholder)).toHaveCount(0)
}

/**
 * Elige en el `USelect` combinado de unidad/presentación de una línea del
 * XML — el único `role="combobox"` de la línea: el trigger de `USelectMenu`
 * (Producto, buscable) usa el patrón `Combobox` de Reka y se lee como
 * `button "Show popup"`, no `combobox` (medido en el snapshot de
 * accesibilidad de un fallo; `role="combobox"` es del `Select` simple, que es
 * lo que es "Unidad" acá). No se elige por su valor actual, a diferencia de
 * `compras-presentacion.spec.ts`: una línea que vino del XML nunca hereda la
 * unidad base al elegir el producto (`onSeleccionarItem`, tarea 4 § 6), así
 * que el trigger queda en blanco (`"\xA0"`) y no hay texto contra el que
 * hacer pie.
 */
async function elegirUnidadDteLinea(linea: Locator, opcion: string) {
  const page = linea.page()
  await linea.getByRole('combobox').click()
  await page.getByRole('option', { name: opcion, exact: true }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
}

/** Dígito verificador de un RUT chileno (módulo 11), para generar uno con
 *  forma válida — el backend no lo verifica (`normalizarRut` solo da forma),
 *  pero total generarlo bien no cuesta nada. */
function digitoVerificador(cuerpo: string): string {
  let suma = 0
  let multiplicador = 2
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * multiplicador
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1
  }
  const resto = 11 - (suma % 11)
  if (resto === 11) return '0'
  if (resto === 10) return 'K'
  return String(resto)
}

/** Un RUT de proveedor propio de la corrida: nunca choca con el
 *  76.123.456-7 del receptor (la razón social del tenant demo) ni con el de
 *  Distribuidora Andina del seed. */
function rutGenerado(sello: number): string {
  const cuerpo = String(10_000_000 + (sello % 89_999_999))
  return `${cuerpo}-${digitoVerificador(cuerpo)}`
}

/** El XML de la plantilla con el RUT y el folio de esta corrida, ya
 *  codificado en ISO-8859-1 — igual que el archivo que bajaría del SII. */
function xmlConValores(rut: string, folio: string): Buffer {
  const texto = PLANTILLA_XML.replace('__RUT__', rut).replace('__FOLIO__', folio)
  return Buffer.from(texto, 'latin1')
}

/** Abre el modal y sube el XML de esta corrida. No cierra el modal: cada
 *  escenario decide qué esperar después (auto-cargar, "proveedor" o
 *  "bloqueado"). */
async function subirXml(page: Page, rut: string, folio: string) {
  await page.locator('[data-qa="compra-cargar-dte"]').click()
  await expect(page.locator('[data-qa="cargar-dte-modal"]')).toBeVisible()
  await page.locator('input[data-qa="cargar-dte-archivo"]').setInputFiles({
    name: 'andina.xml',
    mimeType: 'application/xml',
    buffer: xmlConValores(rut, folio),
  })
}

/** Un proveedor propio del test, con el RUT del XML; el `afterEach` lo da de baja. */
async function crearProveedor(request: APIRequestContext, sello: number, rut: string) {
  const nombre = `Distribuidora DTE e2e ${sello}`
  const proveedor = await api<{ id: string }>(request, 'post', '/terceros', {
    token: escenario.token!,
    data: { tipo: 'proveedor', nombre, rut },
  })
  escenario.proveedorId = proveedor.id
  return { id: proveedor.id, nombre }
}

/** El local del tenant: único por tenant, se lee del listado por `tipo`, no por posición. */
async function ubicacionLocal(request: APIRequestContext) {
  const ubicaciones = await api<{ id: string, tipo: string, nombre: string }[]>(
    request, 'get', '/ubicaciones', { token: escenario.token! },
  )
  return ubicaciones.find(u => u.tipo === 'local')!
}

/** Un producto en `unidad`, sin stock previo, propio del test. */
async function productoDte(request: APIRequestContext, nombre: string) {
  const producto = await crearProducto(request, escenario.token!, { nombre, precioBase: '1000', stock: '0' })
  escenario.itemIds.push(producto.id)
  return { id: producto.id, nombre }
}

async function crearPresentacion(
  request: APIRequestContext,
  proveedorId: string,
  itemId: string,
  contenido: string,
) {
  return api<{ id: string }>(request, 'post', '/compras/presentaciones', {
    token: escenario.token!,
    data: { proveedorId, itemId, nombre: 'Caja', contenido, unidadCodigo: 'unidad' },
  })
}

/** El tipo de documento del país del tenant por su código SII (33 = Factura). */
async function tipoDocumentoPorCodigo(request: APIRequestContext, codigo: string) {
  const tipos = await api<{ id: string, codigo: string | null }[]>(
    request, 'get', '/compras/tipos-documento', { token: escenario.token! },
  )
  return tipos.find(t => t.codigo === codigo)!
}

/** Lo que quedó del lado del servidor: el stock total. */
async function stockDe(request: APIRequestContext, itemId: string): Promise<string> {
  const item = await api<{ stock: string }>(request, 'get', `/items/${itemId}`, { token: escenario.token! })
  return Number(item.stock).toFixed(4)
}

test('el XML pre-llena, aprende el código del proveedor y avisa cuando la factura ya está cargada', async ({ page, request }) => {
  // Los cuatro escenarios comparten el proveedor y sus códigos aprendidos: sin
  // eso, "la segunda factura calza sola" no se podría probar de punta a
  // punta. Un test largo, no cuatro cortos — mismo criterio que el resto de
  // `e2e/compras/` con flujos que dependen unos de otros.
  test.setTimeout(150_000)

  const sello = Date.now()
  const rut = rutGenerado(sello)
  const proveedor = await crearProveedor(request, sello, rut)
  const local = await ubicacionLocal(request)
  const coca = await productoDte(request, `Coca-Cola DTE e2e ${sello}`)
  const fanta = await productoDte(request, `Fanta DTE e2e ${sello}`)
  // La "Caja (12)" de la Coca ya existe antes de la primera factura (brief
  // Step 3): la Fanta, en cambio, la crea el encargado desde la línea.
  await crearPresentacion(request, proveedor.id, coca.id, '12')

  await entrarComo(page, ENCARGADO.email, ENCARGADO.password)

  // ── Escena 1: primera factura, todo a mano ──────────────────────────────
  const folioFactura1 = `E2E1-${sello}`
  await page.goto('/compras/nueva', { waitUntil: 'networkidle' })
  await subirXml(page, rut, folioFactura1)
  // El proveedor calza por RUT (uno solo): el modal se cierra solo, sin
  // preguntar nada.
  await expect(page.locator('[data-qa="cargar-dte-modal"]')).toHaveCount(0)
  await expect(page.locator('[data-qa="compra-dte-franja"]')).toContainText(proveedor.nombre)

  // "Entra a" nunca lo precarga el XML (ver la desviación documentada arriba).
  await elegirPorPlaceholder(page, 'Local o bodega', local.nombre, { exacta: true })

  const lineas = page.locator('[data-qa="compra-linea"]')
  await expect(lineas).toHaveCount(3)

  // Línea 1: la Coca, por asociar la primera vez → se asocia a la Caja (12)
  // que YA existía por API.
  const lineaCoca = lineas.nth(0)
  await expect(lineaCoca.locator('[data-qa="compra-dte-por-asociar"]')).toBeVisible()
  await expect(lineaCoca.locator('[data-qa="compra-dte-texto"]')).toContainText('COCA COLA 350ML CJ12')
  // La Coca trae 5% de descuento de línea en el XML (PLANTILLA_XML): el precio
  // ya lo incluye, y la línea lo dice.
  await expect(lineaCoca.locator('[data-qa="compra-dte-ajuste"]')).toBeVisible()
  await elegirPorPlaceholder(lineaCoca, 'Selecciona un producto', coca.nombre, { buscar: true })
  await elegirUnidadDteLinea(lineaCoca, 'Caja (12)')

  // Línea 2: la Fanta, por asociar → se asocia a su producto y a una Caja
  // (12) creada desde la línea (mismo modal que `compras-presentacion.spec.ts`).
  const lineaFanta = lineas.nth(1)
  await expect(lineaFanta.locator('[data-qa="compra-dte-por-asociar"]')).toBeVisible()
  await elegirPorPlaceholder(lineaFanta, 'Selecciona un producto', fanta.nombre, { buscar: true })
  await elegirUnidadDteLinea(lineaFanta, '+ Nueva presentación…')
  const modalPresentacion = page.getByRole('dialog')
  await expect(modalPresentacion).toContainText('Nueva presentación')
  await modalPresentacion.locator('[data-qa="presentacion-nombre"]').fill('Caja')
  await modalPresentacion.locator('[data-qa="presentacion-contenido"]').fill('12')
  await modalPresentacion.locator('[data-qa="presentacion-guardar"]').click()
  await expect(modalPresentacion).toHaveCount(0)
  await expect(lineaFanta.getByText('Caja (12)', { exact: true })).toBeVisible()

  // Línea 3: el FLETE — con la tilde de "CAFÉ" en ISO-8859-1 intacta, prueba
  // de que `TextDecoder` decodificó bien un archivo real (no `happy-dom`) — va
  // a "No es mercadería".
  const lineaFlete = lineas.nth(2)
  await expect(lineaFlete.locator('[data-qa="compra-dte-texto"]')).toContainText('FLETE CAFÉ')
  await lineaFlete.locator('[data-qa="compra-dte-no-mercaderia"]').click()

  await expect(page.locator('[data-qa="compra-linea"]')).toHaveCount(2)
  await expect(page.locator('[data-qa="compra-dte-por-asociar-pie"]')).toHaveCount(0)
  // F1, ronda 1: con el flete todavía en la compra (sin precio) el descuento
  // seguía bloqueado; recién al apartarlo se destraba solo, sin tocarlo.
  await expect(page.locator('input[data-qa="compra-descuento"]')).toHaveValue(/2\.100/)
  await expect(page.locator('[data-qa="compra-dte-aviso"]')).toHaveCount(0)
  const apartadas = page.locator('[data-qa="compra-dte-apartadas"]')
  await expect(apartadas).toBeVisible()
  await apartadas.getByRole('button', { name: 'No se cargan (no es mercadería)' }).click()
  await expect(page.locator('[data-qa="compra-dte-apartada-texto"]')).toContainText('FLETE CAFÉ')

  // La Factura es `total_documento = 'obligatorio'`: sin este campo, confirmar
  // es 400. El XML todavía no lo pre-llena (tarea aparte) — se tipea a mano,
  // con el `MntTotal` del propio XML (`fixtures/andina-dte.xml`), que incluye
  // el flete apartado como "no es mercadería".
  const totalDocumentoInput = page.locator('input[data-qa="compra-total-documento"]')
  await totalDocumentoInput.selectText()
  await totalDocumentoInput.pressSequentially('122451')

  // Guardar y confirmar de una: el stock sube ahora.
  await expect(page.locator('[data-qa="compra-confirmar"]')).toBeEnabled()
  await page.locator('[data-qa="compra-confirmar"]').click()
  await page.locator('[data-qa="compra-confirmar-si"]').click()
  await expect(page.locator('[data-qa="compra-confirmada"]')).toBeVisible()
  const compraFactura1Id = new URL(page.url()).pathname.split('/').pop()!

  // 10 cajas de 12: +120. La Fanta, 1 caja de 12: +12.
  expect(await stockDe(request, coca.id)).toBe('120.0000')
  expect(await stockDe(request, fanta.id)).toBe('12.0000')

  // ── Escena 2: segunda factura, otro folio → calza sola ──────────────────
  const folioFactura2 = `E2E2-${sello}`
  await page.goto('/compras/nueva', { waitUntil: 'networkidle' })
  await subirXml(page, rut, folioFactura2)
  await expect(page.locator('[data-qa="cargar-dte-modal"]')).toHaveCount(0)

  await expect(page.locator('[data-qa="compra-linea"]')).toHaveCount(2)
  await expect(page.locator('[data-qa="compra-dte-calzo"]')).toHaveCount(2)
  await expect(page.locator('[data-qa="compra-dte-por-asociar"]')).toHaveCount(0)
  // El flete ya llega apartado, sin que nadie lo pida.
  await expect(page.locator('[data-qa="compra-dte-apartadas"]')).toBeVisible()

  // Único paso manual (ver la desviación documentada arriba): elegir dónde entra.
  await elegirPorPlaceholder(page, 'Local o bodega', local.nombre, { exacta: true })
  await expect(page.locator('[data-qa="compra-guardar"]')).toBeEnabled()
  await page.locator('[data-qa="compra-guardar"]').click()
  await page.waitForURL(/\/compras\/[0-9a-f-]{36}$/)

  // ── Duda para el revisor: un 409 de folio repetido al guardar no pierde el
  //    formulario ni deja salir sin avisar ────────────────────────────────
  const folioRace = `E2E3-${sello}`
  await page.goto('/compras/nueva', { waitUntil: 'networkidle' })
  await subirXml(page, rut, folioRace)
  await expect(page.locator('[data-qa="cargar-dte-modal"]')).toHaveCount(0)
  await elegirPorPlaceholder(page, 'Local o bodega', local.nombre, { exacta: true })
  // Todo calza solo, igual que la escena 2 — el sujeto acá es el 409, no las líneas.
  await expect(page.locator('[data-qa="compra-dte-por-asociar"]')).toHaveCount(0)

  // Alguien más carga esa misma factura (mismo proveedor + tipo + folio)
  // mientras el encargado todavía la tiene abierta en pantalla.
  const tipoFactura = await tipoDocumentoPorCodigo(request, '33')
  await api(request, 'post', '/compras', {
    token: escenario.token!,
    data: {
      proveedorId: proveedor.id,
      tipoDocumentoCompraId: tipoFactura.id,
      fechaDocumento: '2026-09-20',
      ubicacionId: local.id,
      folio: folioRace,
      lineas: [{ itemId: coca.id, cantidad: '1', unidadCodigo: 'unidad', precioUnitario: '100' }],
    },
  })

  await page.locator('[data-qa="compra-guardar"]').click()
  // El 409 llega a la pantalla, con el mensaje del backend (`assertFolioLibre`).
  await expect(page.getByText(/Ya cargaste/)).toBeVisible()
  // Nada se perdió: el formulario sigue completo, con lo que el XML cargó.
  await expect(page.locator('input[data-qa="compra-folio"]')).toHaveValue(folioRace)
  await expect(page.locator('[data-qa="compra-dte-calzo"]')).toHaveCount(2)

  // El guard sigue activo: el 409 no soltó `origenDte`, así que salir sin
  // arreglar el folio todavía pide confirmación.
  let dialogoSalida: Dialog | undefined
  page.once('dialog', (dialogo) => {
    dialogoSalida = dialogo
    void dialogo.dismiss()
  })
  await botonVolverACompras(page).click()
  await expect.poll(() => dialogoSalida?.message()).toContain('sin guardar')
  await expect(page).toHaveURL(/\/compras\/nueva$/)

  // Se corrige el folio a mano — nada más — y guarda sin problema.
  const folioRaceCorregido = `${folioRace}-b`
  await page.locator('input[data-qa="compra-folio"]').fill(folioRaceCorregido)
  await page.locator('[data-qa="compra-guardar"]').click()
  await page.waitForURL(/\/compras\/[0-9a-f-]{36}$/)

  // ── Escena 3: subir otra vez la primera factura → "ya está cargada" ─────
  await page.goto('/compras/nueva', { waitUntil: 'networkidle' })
  await subirXml(page, rut, folioFactura1)
  await expect(page.locator('[data-qa="cargar-dte-bloqueo"]')).toContainText('ya está cargada')
  await page.locator('[data-qa="cargar-dte-abrir"]').click()
  await page.waitForURL(new RegExp(`/compras/${compraFactura1Id}$`))
  await expect(page.locator('[data-qa="compra-confirmada"]')).toBeVisible()
})

test('salir con el XML leído sin guardar pide confirmación', async ({ page, request }) => {
  const sello = Date.now() + 1
  const rut = rutGenerado(sello)
  const proveedor = await crearProveedor(request, sello, rut)
  void proveedor // el nombre no se usa acá: alcanza con que el RUT resuelva un proveedor único.

  await entrarComo(page, ENCARGADO.email, ENCARGADO.password)
  await page.goto('/compras/nueva', { waitUntil: 'networkidle' })
  await subirXml(page, rut, `E2E4-${sello}`)
  await expect(page.locator('[data-qa="cargar-dte-modal"]')).toHaveCount(0)
  await expect(page.locator('[data-qa="compra-dte-franja"]')).toBeVisible()

  // Sin guardar nada: salir pide confirmar, y cancelando se queda en la página.
  page.once('dialog', dialogo => void dialogo.dismiss())
  await botonVolverACompras(page).click()
  await expect(page).toHaveURL(/\/compras\/nueva$/)

  // Confirmando, sí se puede salir sin guardar (la carga manual, sin XML, no pide nada de esto).
  page.once('dialog', dialogo => void dialogo.accept())
  await botonVolverACompras(page).click()
  await page.waitForURL(url => url.pathname === '/compras')
})
