import type { APIRequestContext, Page } from '@playwright/test'
import { test, expect } from '../support/sesion'
import { API, api, tokenDe, TENANTS } from '../support/api'
import { cafDePrueba } from '../support/dte'

/**
 * La pantalla de Boleta electrónica (`/configuracion/boleta-electronica`), contra la API real.
 *
 * `boleta-electronica.nuxt.spec.ts` fija lo que se ve con un perfil simulado; acá va lo que solo
 * se ve con el servidor de verdad: que guardar refresque `faltantes` desde el perfil que arma
 * el backend, que el CAF suba por la pantalla en ISO-8859-1 y que el 400 de un archivo ajeno
 * le llegue al dueño con el mensaje del servidor.
 *
 * Qué NO cubre: el camino feliz del certificado. Playwright no tiene `node-forge` para armar un
 * `.pfx`; ese camino lo ejercita `backend/test/dte-perfil.e2e-spec.ts` por la API.
 *
 * La razón social emisora es propia de este archivo (nombre y RUT distintos de los de los e2e de
 * API, para que en local, con la misma base, no se confundan). Se marca preferida y al terminar
 * se devuelve la preferida que había o, si no había, se da de baja (ver `afterAll`).
 */

const NOMBRE = 'Emisor e2e pantalla'
const RUT = '12.345.678-5'
const RUT_CAF = '12345678-5'

// Los tests comparten la razón social emisora y su perfil: en orden, aunque se corran partidos.
test.describe.configure({ mode: 'serial' })

interface RazonSocial { id: string, nombre: string, preferida: boolean }
interface PerfilApi { cafs: { id: string, desde: number }[] }

let token = ''
let preferidaOriginal: string | null = null
/** Cuántos CAF subió este archivo: separa los rangos de un test y otro. */
let cafsSubidos = 0

async function razones(request: APIRequestContext): Promise<RazonSocial[]> {
  return api<RazonSocial[]>(request, 'get', '/tenants/razones-sociales', { token })
}

function ambiente(request: APIRequestContext, ambienteSii: 'certificacion' | 'produccion') {
  return api(request, 'patch', '/dte/perfil', { token, data: { ambienteSii } })
}

async function perfil(request: APIRequestContext): Promise<PerfilApi> {
  return api<PerfilApi>(request, 'get', '/dte/perfil', { token })
}

test.beforeAll(async ({ request }) => {
  token = await tokenDe(request, TENANTS.restaurante)

  const lista = await razones(request)
  preferidaOriginal = lista.find(r => r.preferida && r.nombre !== NOMBRE)?.id ?? null
  let emisora = lista.find(r => r.nombre === NOMBRE)
  if (!emisora) {
    emisora = await api<RazonSocial>(request, 'post', '/tenants/razones-sociales', {
      token,
      data: { nombre: NOMBRE, rut: RUT, direccion: 'Av. Prueba 123', habilitado: true },
    })
  }
  await api(request, 'patch', `/tenants/razones-sociales/${emisora.id}/preferida`, { token })

  // Parte sin giro ni comuna y en producción: una corrida anterior los dejó cargados en esta
  // misma base, y el primer test tiene que cambiarlos por pantalla. (El ambiente no se puede
  // vaciar por la API, pero sí cambiar.)
  await ambiente(request, 'produccion')
  await api(request, 'patch', '/dte/perfil', { token, data: { giro: '', comuna: '' } })
})

test.afterAll(async ({ request }) => {
  // Dejar el tenant como estaba. No hay ruta que des-marque la preferida (`PATCH …/preferida`
  // solo marca) y Playwright no tiene SQL, así que sin una preferida original se da de baja
  // la razón social de este archivo (soft delete por la API): una razón social borrada no es
  // la emisora, y el tenant vuelve a no tener preferida. Si había una, marcarla desmarca la nuestra.
  // Cada paso en su propio `finally`: que uno falle no deja sin hacer la restauración. Los
  // fallos se acumulan y se tiran al final: un afterAll que deja la preferida cambiada tiene que
  // poner la corrida en rojo, no solo avisar por consola.
  const fallos: string[] = []
  const intentar = async (que: string, paso: () => Promise<unknown>) => {
    try {
      await paso()
    }
    catch (e) {
      fallos.push(`${que}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const headers = { Authorization: `Bearer ${token}` }
  try {
    // Todos los CAF de la razón social de este archivo son de este archivo.
    await intentar('borrar los CAF', async () => {
      for (const caf of (await perfil(request)).cafs) {
        const res = await request.delete(`${API}/dte/cafs/${caf.id}`, { headers })
        if (!res.ok()) throw new Error(`DELETE cafs/${caf.id} → ${res.status()}`)
      }
    })
  }
  finally {
    if (preferidaOriginal) {
      await intentar('devolver la preferida', () =>
        api(request, 'patch', `/tenants/razones-sociales/${preferidaOriginal}/preferida`, { token }))
    }
    else {
      await intentar('dar de baja la razón social emisora', async () => {
        const nuestra = (await razones(request)).find(r => r.nombre === NOMBRE)
        if (!nuestra) return
        const res = await request.delete(`${API}/tenants/razones-sociales/${nuestra.id}`, { headers })
        if (!res.ok()) throw new Error(`DELETE razones-sociales → ${res.status()}: ${await res.text()}`)
      })
    }
  }
  if (fallos.length) throw new Error(`No se pudo dejar la base como estaba: ${fallos.join('; ')}`)
})

/** Un rango que depende de la hora: dos corridas sobre la misma base no se pisan. */
function rangoNuevo(): { desde: number, hasta: number } {
  const base = (Math.floor(Date.now() / 1000) % 1_000_000) * 1000
  const desde = base + 1 + cafsSubidos++ * 100
  return { desde, hasta: desde + 49 }
}

async function abrir(page: Page) {
  await page.goto('/configuracion/boleta-electronica')
  await expect(page.getByRole('heading', { name: 'Boleta electrónica' })).toBeVisible()
  await expect(page.getByText('Empresa que emite')).toBeVisible()
}

test('guardar los datos de la empresa saca sus faltantes', async ({ page }) => {
  await abrir(page)

  const faltantes = page.locator('[data-qa="faltantes"]')
  await expect(faltantes).toContainText('Falta el giro de la empresa')
  await expect(faltantes).toContainText('Falta la comuna de la empresa')

  await page.getByPlaceholder('Venta de alimentos').fill('Venta de alimentos')
  await page.getByPlaceholder('Providencia').fill('Ñuñoa')
  await page.getByRole('combobox').click()
  await page.getByRole('option', { name: 'Certificación (pruebas)' }).click()
  // El calendario del campo de fecha tiene su gancho de e2e: un evento con el valor.
  await page.locator('[data-qa="fecha-resolucion"]').evaluate(
    (el, valor) => el.dispatchEvent(new CustomEvent('qa-set-value', { detail: valor })),
    '2026-08-01',
  )
  await page.getByPlaceholder('0', { exact: true }).fill('0')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(page.getByText('Datos de la empresa guardados', { exact: true })).toBeVisible()

  // El perfil se pidió de nuevo: el aviso sale de lo que dice el servidor.
  await expect(faltantes).not.toContainText('Falta el giro de la empresa')
  await expect(faltantes).not.toContainText('Falta la comuna de la empresa')
  await expect(faltantes).not.toContainText('resolución del SII')

  // Y quedó guardado, no solo en pantalla.
  await page.reload()
  await expect(page.getByPlaceholder('Venta de alimentos')).toHaveValue('Venta de alimentos')
  await expect(page.getByPlaceholder('Providencia')).toHaveValue('Ñuñoa')
  await expect(page.getByRole('combobox')).toContainText('Certificación (pruebas)')
})

test('subir un CAF lo muestra con sus folios restantes, y se puede borrar', async ({ page, request }) => {
  // El backend no recibe folios hasta que el emisor tiene ambiente.
  await ambiente(request, 'certificacion')
  await abrir(page)
  const { desde, hasta } = rangoNuevo()

  await page.getByRole('button', { name: 'Subir CAF' }).click()
  const modal = page.getByRole('dialog')
  await modal.locator('input[type="file"]').setInputFiles({
    name: 'caf-39.xml',
    mimeType: 'text/xml',
    buffer: cafDePrueba({ rut: RUT_CAF, tipo: 39, desde, hasta }),
  })
  await modal.getByRole('button', { name: 'Subir', exact: true }).click()
  await expect(page.getByText('Folios cargados', { exact: true })).toBeVisible()

  const fila = page.getByRole('row').filter({ hasText: `${desde} – ${hasta}` })
  await expect(fila).toHaveCount(1)
  await expect(fila).toContainText('Boleta (39)')
  await expect(fila).toContainText('Certificación (pruebas)')
  await expect(fila).toContainText('50')
  await expect(fila).not.toContainText('otro ambiente')

  await fila.getByRole('button', { name: 'Borrar' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Borrar', exact: true }).click()
  await expect(page.getByText('Folios borrados', { exact: true })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: `${desde} – ${hasta}` })).toHaveCount(0)
})

test('un CAF de otro RUT se rechaza con el mensaje del servidor', async ({ page, request }) => {
  await ambiente(request, 'certificacion')
  await abrir(page)
  const { desde, hasta } = rangoNuevo()

  await page.getByRole('button', { name: 'Subir CAF' }).click()
  const modal = page.getByRole('dialog')
  await modal.locator('input[type="file"]').setInputFiles({
    name: 'caf-ajeno.xml',
    mimeType: 'text/xml',
    buffer: cafDePrueba({ rut: '76086428-5', tipo: 39, desde, hasta }),
  })
  await modal.getByRole('button', { name: 'Subir', exact: true }).click()

  await expect(modal.locator('[data-qa="error-caf"]')).toContainText('no de la empresa')
  await expect(page.getByRole('row').filter({ hasText: `${desde} – ${hasta}` })).toHaveCount(0)
})

test('un certificado que no es un .pfx muestra el mensaje del servidor y borra la clave al cerrar', async ({ page }) => {
  await abrir(page)

  await page.getByRole('button', { name: 'Subir certificado' }).click()
  const modal = page.getByRole('dialog')
  await modal.locator('input[type="file"]').setInputFiles({
    name: 'no-es-un-certificado.pfx',
    mimeType: 'application/x-pkcs12',
    buffer: Buffer.from('esto no es un pfx'),
  })
  await modal.locator('input[type="password"]').fill('una-clave')
  await modal.getByRole('button', { name: 'Subir', exact: true }).click()

  await expect(modal.locator('[data-qa="error-certificado"]')).toContainText('no se pudo abrir el .pfx')

  // La clave no sobrevive al modal.
  await modal.getByRole('button', { name: 'Cancelar' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Subir certificado' }).click()
  await expect(page.getByRole('dialog').locator('input[type="password"]')).toHaveValue('')
})
