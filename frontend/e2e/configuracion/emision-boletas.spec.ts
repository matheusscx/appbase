import type { APIRequestContext, Page } from '@playwright/test'
import { test, expect } from '@playwright/test'
import { API, api, tokenDe, TENANTS } from '../support/api'
import { cafDePrueba, certificadoPfxDePrueba } from '../support/dte'
import { entrarComo } from '../support/ui'

/**
 * El interruptor de la emisión y la lista de boletas sin emitir de `/configuracion/boleta-electronica`,
 * como el dueño de un local (spec `2026-10-14-boleta-desde-la-venta`, § 8.3).
 *
 * **Corre como `admin.paris@paris.cl`**: Administrador del tenant y NO superadmin. El admin del
 * resto de la suite es superadmin y pasa cualquier gate; la pantalla es del dueño del local, y es
 * con su rol que se ve si le sirve (`/dte/*` va con `TenantAdminGuard`).
 *
 * Qué cubre: el interruptor deshabilitado mientras falta algo y habilitado con el perfil completo,
 * la confirmación al prender (cancelar no cambia nada) y apagar sin confirmar, y la lista vacía.
 * Qué NO cubre: una boleta que queda `sin_emitir` y el botón "Emitir pendientes" contra el
 * servidor; el botón con resultado, errores y recarga lo fija `boleta-electronica.nuxt.spec.ts`, y
 * el camino real (folios agotados, ILA…) los e2e de `backend/test/`.
 *
 * ⚠️ Precondición: la base recién reseteada (`./scripts/reset-db.sh`), como toda la suite. La lista
 * "vacía" es la del tenant entero: una boleta sin emitir que dejó otra corrida la rompe, y con
 * razón: el test dice lo que el servidor devuelve.
 *
 * ⚠️ **Deja huella en la base, y es a propósito** (igual que `boleta-electronica-pos.spec.ts`): una
 * razón social con certificado y folios cargados no se puede dar de baja. La del test del perfil
 * completo queda, sin ser la preferida si había otra, y el montaje la reutiliza por nombre. La del
 * test con faltantes no carga nada, y se da de baja al terminar.
 */

const ADMIN_PARIS = { email: 'admin.paris@paris.cl', password: 'admin' }

const NOMBRE_COMPLETA = 'Emisor e2e interruptor'
const RUT_COMPLETA = '33.333.333-3'
/** El mismo RUT, como lo escribe el SII en el CAF. */
const RUT_CAF = '33333333-3'
const RUT_FIRMANTE = '11111111-1'

const NOMBRE_VACIA = 'Emisor e2e sin datos'
const RUT_VACIA = '44.444.444-4'

test.use({ storageState: { cookies: [], origins: [] } })
// Los tests comparten la razón social preferida y el interruptor del tenant: en orden.
test.describe.configure({ mode: 'serial' })

interface RazonSocial { id: string, nombre: string, preferida: boolean }
interface PerfilApi {
  certificado: { id: string } | null
  cafs: { tipo: number, ambiente: string, restantes: number }[]
  emisionActiva: boolean
}

let token = ''
let preferidaOriginal: string | null = null

async function razones(request: APIRequestContext): Promise<RazonSocial[]> {
  return api<RazonSocial[]>(request, 'get', '/tenants/razones-sociales', { token })
}

async function perfil(request: APIRequestContext): Promise<PerfilApi> {
  return api<PerfilApi>(request, 'get', '/dte/perfil', { token })
}

/** Crea la razón social (o toma la que ya hay con ese nombre) y la marca preferida. */
async function emisora(request: APIRequestContext, nombre: string, rut: string): Promise<RazonSocial> {
  let rs = (await razones(request)).find(r => r.nombre === nombre)
  if (!rs) {
    rs = await api<RazonSocial>(request, 'post', '/tenants/razones-sociales', {
      token,
      data: { nombre, rut, direccion: 'Av. Prueba 789', habilitado: true },
    })
  }
  await api(request, 'patch', `/tenants/razones-sociales/${rs.id}/preferida`, { token })
  return rs
}

/** Todo lo que el SII pide, por API: razón social con sus datos, certificado y un CAF con folios. */
async function completarPerfil(request: APIRequestContext) {
  await api(request, 'patch', '/dte/perfil', {
    token,
    data: {
      giro: 'Venta de alimentos',
      comuna: 'Providencia',
      ambienteSii: 'certificacion',
      fechaResolucion: '2026-08-01',
      numeroResolucion: 0,
    },
  })
  const p = await perfil(request)
  if (!p.certificado) {
    const { pfx, clave } = certificadoPfxDePrueba({ rut: RUT_FIRMANTE })
    await api(request, 'post', '/dte/certificado', {
      token,
      data: { pfxBase64: pfx.toString('base64'), clave },
    })
  }
  const folios = p.cafs
    .filter(c => c.tipo === 39 && c.ambiente === 'certificacion')
    .reduce((suma, c) => suma + c.restantes, 0)
  if (folios === 0) {
    // Un rango que depende de la hora: dos corridas sobre la misma base no se pisan.
    const desde = (Math.floor(Date.now() / 1000) % 1_000_000) * 1000 + 1
    await api(request, 'post', '/dte/cafs', {
      token,
      data: { xmlBase64: cafDePrueba({ rut: RUT_CAF, tipo: 39, desde, hasta: desde + 49 }).toString('base64') },
    })
  }
}

async function abrir(page: Page) {
  await entrarComo(page, ADMIN_PARIS.email, ADMIN_PARIS.password)
  await page.goto('/configuracion/boleta-electronica')
  await expect(page.getByRole('heading', { name: 'Boleta electrónica' })).toBeVisible()
  await expect(page.getByText('Empresa que emite')).toBeVisible()
}

test.beforeAll(async ({ request }) => {
  token = await tokenDe(request, TENANTS.restaurante, ADMIN_PARIS)
  preferidaOriginal = (await razones(request))
    .find(r => r.preferida && r.nombre !== NOMBRE_COMPLETA && r.nombre !== NOMBRE_VACIA)?.id ?? null
  // Una corrida anterior que se cortó pudo dejar la emisión prendida.
  await api(request, 'patch', '/dte/emision', { token, data: { activa: false } })
})

test.afterAll(async ({ request }) => {
  // Cada paso en su propio intento: que uno falle no deja sin hacer los otros. Los fallos se tiran
  // al final: un afterAll que deja la emisión prendida pone la corrida en rojo, no solo avisa.
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
    api(request, 'patch', '/dte/emision', { token, data: { activa: false } }))
  if (preferidaOriginal) {
    await intentar('devolver la preferida', () =>
      api(request, 'patch', `/tenants/razones-sociales/${preferidaOriginal}/preferida`, { token }))
  }
  await intentar('dar de baja la razón social sin datos', async () => {
    const vacia = (await razones(request)).find(r => r.nombre === NOMBRE_VACIA)
    if (!vacia) return
    const res = await request.delete(`${API}/tenants/razones-sociales/${vacia.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok()) throw new Error(`DELETE razones-sociales → ${res.status()}: ${await res.text()}`)
  })
  if (fallos.length) throw new Error(`No se pudo dejar la base como estaba: ${fallos.join('; ')}`)
})

test('con faltantes el interruptor está deshabilitado y dice qué falta', async ({ page, request }) => {
  // Una razón social recién creada no tiene giro, comuna, certificado ni folios.
  await emisora(request, NOMBRE_VACIA, RUT_VACIA)
  await abrir(page)

  const tarjeta = page.locator('[data-qa="emision"]')
  await expect(tarjeta.getByRole('switch')).toBeDisabled()
  await expect(tarjeta.getByRole('switch')).not.toBeChecked()
  await expect(tarjeta).toContainText('Para emitir falta:')
  await expect(tarjeta).toContainText('Falta el giro de la empresa')
})

test('con el perfil completo se prende pidiendo confirmación y se apaga sin pedirla', async ({ page, request }) => {
  await emisora(request, NOMBRE_COMPLETA, RUT_COMPLETA)
  await completarPerfil(request)
  await abrir(page)

  const interruptor = page.locator('[data-qa="emision"]').getByRole('switch')
  await expect(interruptor).toBeEnabled()
  await expect(interruptor).not.toBeChecked()

  // Cancelar la confirmación no cambia nada, ni en pantalla ni en el servidor.
  await interruptor.click()
  const modal = page.getByRole('dialog')
  await expect(modal).toContainText('Desde ahora cada venta emite una boleta ante el SII.')
  await modal.getByRole('button', { name: 'Cancelar' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(interruptor).not.toBeChecked()
  expect((await perfil(request)).emisionActiva).toBe(false)

  // Confirmar lo prende de verdad.
  await interruptor.click()
  await page.getByRole('dialog').getByRole('button', { name: 'Emitir boletas', exact: true }).click()
  await expect(interruptor).toBeChecked()
  expect((await perfil(request)).emisionActiva).toBe(true)

  // Apagar no confirma.
  await interruptor.click()
  await expect(interruptor).not.toBeChecked()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await perfil(request)).emisionActiva).toBe(false)
})

test('sin boletas pendientes la lista lo dice y "Emitir pendientes" no tiene qué emitir', async ({ page }) => {
  await abrir(page)

  const tarjeta = page.locator('[data-qa="boletas-sin-emitir"]')
  await expect(tarjeta).toContainText('Boletas sin emitir')
  await expect(tarjeta).toContainText('No hay boletas sin emitir.')
  await expect(tarjeta.getByRole('button', { name: 'Emitir pendientes' })).toBeDisabled()
})
