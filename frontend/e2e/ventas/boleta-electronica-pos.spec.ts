import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../support/sin-qz-tray'
import {
  abrirCaja,
  api,
  cerrarCaja,
  crearProducto,
  limpiarItems,
  tokenDe,
  TENANTS,
} from '../support/api'
import { cafDePrueba, certificadoPfxDePrueba } from '../support/dte'
import { entrarComo, valorDeFila } from '../support/ui'

/**
 * El POS con la boleta electrónica prendida, como la cajera (spec
 * `2026-10-14-boleta-desde-la-venta`, § 7 y § 8.2): el cobro no muestra ningún error de emisión,
 * la boleta sale con su folio, y la franja de arriba avisa que quedan pocos folios.
 *
 * **Corre como `vendedor@paris.cl`** (rol `Vendedor`: `Ventas:Leer/Crear`, sin acceso al perfil
 * fiscal), no admin: la franja lee `GET /dte/estado-emision`, que pide `Ventas:Crear` y NO
 * `TenantAdminGuard`. Con admin un 403 en esa ruta se taparía.
 *
 * Qué NO cubre: el papel. El ticket se verifica en los unitarios (`ticket-builder.spec.ts`,
 * `pos.nuxt.spec.ts`); QZ Tray no corre en CI (`sin-qz-tray`).
 *
 * ⚠️ **Prender la emisión necesita un perfil fiscal completo** (`PATCH /dte/emision` rechaza con
 * los `faltantes`): razón social emisora, giro, comuna, ambiente, resolución, certificado, CAF y el
 * proveedor de software (`DTE_PROVEEDOR_*`, que el backend de Playwright trae de `docker-compose.yml`
 * y de `ci.yml`). Todo se monta por API en el `beforeAll`, y se apaga el interruptor al terminar.
 *
 * ⚠️ **Esta suite deja huella en la base, y es a propósito.** Un CAF que entregó un folio ya no se
 * puede borrar (`borrable: false`), y una razón social con folios o certificado cargados no se puede
 * dar de baja (`exigirSinCargasDte`). Así que la razón social de este archivo queda en la base
 * —sin ser la preferida si había otra—, y el montaje es idempotente: la reutiliza por nombre, y solo
 * sube certificado o CAF si no tiene (un CAF de 50 folios alcanza para decenas de corridas). El
 * ambiente es certificación: nada de esto toca el SII (`DTE_COLA_AUTOMATICA=false` en el backend).
 */

const NOMBRE_EMISORA = 'Emisor e2e POS'
const RUT_EMISORA = '22.222.222-2'
/** El mismo RUT, como lo escribe el SII en el CAF. */
const RUT_CAF = '22222222-2'
/** El RUT del firmante del certificado de prueba: no tiene que ser el de la empresa. */
const RUT_FIRMANTE = '11111111-1'

const PRECIO_NETO = '10000'
const TOTAL_VENTA = '$11.900'
const TOTAL_VENTA_MONTO = '11900'

const VENDEDOR = { email: 'vendedor@paris.cl', password: 'admin' }

test.use({ storageState: { cookies: [], origins: [] } })

interface RazonSocial { id: string, nombre: string, preferida: boolean }
interface PerfilApi {
  certificado: { id: string } | null
  cafs: { tipo: number, ambiente: string, restantes: number }[]
}
interface EstadoEmision {
  activa: boolean
  avisos: { codigo: string, mensaje: string }[]
  sinEmitir: number
}
interface BoletaServidor {
  boletaElectronica: { tipo: number, folio: number, cubreTodo: boolean, ambiente: string } | null
  boletaSinEmitir: { mensaje: string } | null
}
interface VentaServidor {
  id: string
  estado: string
  documentos: { emisor: string, estadoEnvio: string | null, folio: number | null, monto: string }[]
}

let tokenAdmin = ''
let tokenVendedor = ''
let preferidaOriginal: string | null = null
let cajaId: string | undefined
const itemIds: string[] = []

/** Un rango que depende de la hora: dos corridas sobre la misma base no se pisan. */
function rangoNuevo(): { desde: number, hasta: number } {
  const desde = (Math.floor(Date.now() / 1000) % 1_000_000) * 1000 + 1
  return { desde, hasta: desde + 49 }
}

async function montarPerfilFiscalCompleto(request: APIRequestContext) {
  const razones = await api<RazonSocial[]>(request, 'get', '/tenants/razones-sociales', { token: tokenAdmin })
  preferidaOriginal = razones.find(r => r.preferida && r.nombre !== NOMBRE_EMISORA)?.id ?? null
  let emisora = razones.find(r => r.nombre === NOMBRE_EMISORA)
  if (!emisora) {
    emisora = await api<RazonSocial>(request, 'post', '/tenants/razones-sociales', {
      token: tokenAdmin,
      data: { nombre: NOMBRE_EMISORA, rut: RUT_EMISORA, direccion: 'Av. Prueba 456', habilitado: true },
    })
  }
  await api(request, 'patch', `/tenants/razones-sociales/${emisora.id}/preferida`, { token: tokenAdmin })

  await api(request, 'patch', '/dte/perfil', {
    token: tokenAdmin,
    data: {
      giro: 'Venta de alimentos',
      comuna: 'Providencia',
      ambienteSii: 'certificacion',
      fechaResolucion: '2026-08-01',
      numeroResolucion: 0,
    },
  })

  const perfil = await api<PerfilApi>(request, 'get', '/dte/perfil', { token: tokenAdmin })
  if (!perfil.certificado) {
    const { pfx, clave } = certificadoPfxDePrueba({ rut: RUT_FIRMANTE })
    await api(request, 'post', '/dte/certificado', {
      token: tokenAdmin,
      data: { pfxBase64: pfx.toString('base64'), clave },
    })
  }
  const folios = perfil.cafs
    .filter(c => c.tipo === 39 && c.ambiente === 'certificacion')
    .reduce((suma, c) => suma + c.restantes, 0)
  if (folios === 0) {
    const { desde, hasta } = rangoNuevo()
    await api(request, 'post', '/dte/cafs', {
      token: tokenAdmin,
      data: { xmlBase64: cafDePrueba({ rut: RUT_CAF, tipo: 39, desde, hasta }).toString('base64') },
    })
  }

  await api(request, 'patch', '/dte/emision', { token: tokenAdmin, data: { activa: true } })
}

test.beforeAll(async ({ request }) => {
  tokenAdmin = await tokenDe(request, TENANTS.restaurante)
  tokenVendedor = await tokenDe(request, TENANTS.restaurante, VENDEDOR)
  await montarPerfilFiscalCompleto(request)
})

test.afterAll(async ({ request }) => {
  // Cada paso en su propio intento: que uno falle no deja sin hacer los otros. Los fallos se
  // tiran al final, porque un afterAll que deja la emisión prendida tiene que poner la corrida
  // en rojo y no solo avisar por consola (le cambiaría los documentos a todas las suites que siguen).
  const fallos: string[] = []
  const intentar = async (que: string, paso: () => Promise<unknown>) => {
    try {
      await paso()
    }
    catch (e) {
      fallos.push(`${que}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  await intentar('apagar la emisión', () =>
    api(request, 'patch', '/dte/emision', { token: tokenAdmin, data: { activa: false } }))
  if (preferidaOriginal) {
    await intentar('devolver la preferida', () =>
      api(request, 'patch', `/tenants/razones-sociales/${preferidaOriginal}/preferida`, { token: tokenAdmin }))
  }
  if (fallos.length) throw new Error(`No se pudo dejar la base como estaba: ${fallos.join('; ')}`)
})

test.beforeEach(async ({ request }) => {
  cajaId = await abrirCaja(request, tokenVendedor)
})

test.afterEach(async ({ request }) => {
  if (cajaId) await cerrarCaja(request, tokenVendedor, cajaId, '0')
  cajaId = undefined
  await limpiarItems(request, tokenAdmin, itemIds.splice(0))
})

test('la cajera cobra con la emisión prendida: sin error, con folio, y la franja avisa los folios', async ({
  page,
  request,
}) => {
  const producto = await crearProducto(request, tokenAdmin, {
    nombre: `Boleta electrónica POS ${Date.now()}`,
    precioBase: PRECIO_NETO,
  })
  itemIds.push(producto.id)

  // La franja lee una ruta que la cajera SÍ puede leer: lo que el servidor le contesta es lo que
  // la pantalla va a pintar.
  const estado = await api<EstadoEmision>(request, 'get', '/dte/estado-emision', { token: tokenVendedor })
  expect(estado.activa).toBe(true)
  expect(estado.avisos.map(a => a.codigo)).toContain('POCOS_FOLIOS')

  await entrarComo(page, VENDEDOR.email, VENDEDOR.password)
  await page.goto('/ventas/pos')

  // La franja aparece al entrar, antes de cobrar nada.
  const franja = page.locator('[data-qa="franja-emision"]')
  await expect(franja).toContainText(/Quedan \d+ folios de boleta/)

  await page.locator(`[data-qa="item-catalogo-${producto.id}"]`).click()
  await expect(valorDeFila(page, 'Total')).toHaveText(TOTAL_VENTA)
  await page.getByRole('button', { name: 'Cobrar', exact: true }).click()
  const cobro = page.getByRole('dialog').filter({ hasText: 'Cobrar venta' })
  // El modal abre sin propina: lo aplicado a la venta es lo cobrado.

  const respuesta = page.waitForResponse(
    r => r.url().endsWith('/ventas') && r.request().method() === 'POST',
  )
  await cobro.getByRole('button', { name: /^Cobrar \$/ }).click()
  const creada = await respuesta
  expect(creada.status()).toBe(201)
  const { id: ventaId, boleta } = (await creada.json()) as { id: string, boleta: BoletaServidor }

  // El servidor emitió la boleta dentro del cobro: tiene su folio y no quedó nada pendiente.
  expect(boleta.boletaSinEmitir).toBeNull()
  expect(boleta.boletaElectronica).toMatchObject({ tipo: 39, cubreTodo: true, ambiente: 'certificacion' })
  const folio = boleta.boletaElectronica!.folio
  expect(folio).toBeGreaterThan(0)

  // La pantalla cerró el ciclo sin ningún aviso de emisión.
  await expect(page.getByText('Venta pagada').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('La boleta no se emitió')).toHaveCount(0)

  // La franja se vuelve a leer después del cobro y sigue avisando los folios.
  await expect(franja).toContainText(/Quedan \d+ folios de boleta/)
  await expect(franja).not.toContainText('sin emitir')

  // Y del lado del servidor: el documento de la venta es la boleta emitida, con ese folio.
  const venta = await api<VentaServidor>(request, 'get', `/ventas/${ventaId}`, { token: tokenVendedor })
  expect(venta.estado).toBe('pagada')
  const documento = venta.documentos.find(d => d.emisor === 'sistema')
  expect(documento).toMatchObject({ estadoEnvio: 'emitido', folio, monto: `${TOTAL_VENTA_MONTO}.0000` })

  // La reimpresión trae la misma boleta: sale con su folio (el papel lo arma el front).
  const reimpresion = await api<BoletaServidor>(request, 'get', `/ventas/${ventaId}/boleta`, { token: tokenVendedor })
  expect(reimpresion.boletaElectronica?.folio).toBe(folio)

  expect(await cerrarCaja(request, tokenVendedor, cajaId!, TOTAL_VENTA_MONTO)).toBe('cerrada')
  cajaId = undefined
})

// ⚠️ Playwright no llega a la base: `GET /dte/estado-emision` va simulado con `page.route` para ver
// lo que el POS pinta cuando el servidor cuenta boletas con problemas en el SII. El contrato real
// de ese conteo lo fija el e2e de la API en `backend/test/`.
test('la franja avisa las boletas con problemas en el SII', async ({ page }) => {
  await page.route('**/api/dte/estado-emision', route => route.fulfill({
    json: { activa: true, avisos: [], sinEmitir: 0, conProblemas: 2 },
  }))

  await entrarComo(page, VENDEDOR.email, VENDEDOR.password)
  await page.goto('/ventas/pos')

  await expect(page.locator('[data-qa="franja-emision"]'))
    .toContainText('Hay 2 boletas con problemas en el SII: avisa al encargado')
})
