import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from '@playwright/test'

/**
 * Salones de punta a punta, en un navegador de verdad:
 * mesa → cuenta → línea → cobro.
 *
 * Es la capa que faltaba entre el unit con el HTTP mockeado
 * (`pages/salones/index.nuxt.spec.ts`) y los e2e de API (`salones-fusion`,
 * `salones-comanda`): que la **pantalla encadene** las llamadas en el orden
 * correcto y que lo que se cobró quede bien del lado del servidor.
 *
 * ⚠️ **Las precondiciones se montan por API, no clicando.** Abrir caja, crear un
 * garzón y entrar a turno son tres flujos propios, cada uno con su pantalla; si
 * este test los recorriera, un cambio en cualquiera de ellos lo rompería sin que
 * salones tenga nada que ver. Lo que se ejercita por UI es el flujo bajo prueba.
 *
 * ⚠️ **Y los fixtures son propios** —garzón, salón, mesa e ítem creados acá—
 * porque una cuenta cobrada consume stock y cierra cosas, y el seed no se repara
 * solo entre corridas.
 *
 * El monto sale de la regla, no del output: producto afecto de $1.000 con IVA
 * 19% → **$1.190** (ADR-018), más la propina sugerida del 10% → **$1.309**.
 * (El 10% es el default del cliente y el del tenant sembrado a la vez, así que
 * este test **no** distingue uno del otro: no sirve para afirmar que la
 * sugerencia viene de la config.)
 */

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api'
const TENANT_DEMO_RESTAURANTE = '550e8400-e29b-41d4-a716-446655440007'
const CLP = '550e8400-e29b-41d4-a716-446655440003'

const EMAIL = process.env.E2E_EMAIL ?? 'admin@sistema.com'
const PASSWORD = process.env.E2E_PASSWORD ?? 'admin'

/** Precio base del ítem del test. Todo lo demás se deriva de acá. */
const PRECIO_BASE = '1000'
const TOTAL_CON_IVA = '$1.190'
/** Con la propina sugerida del 10%: 1.190 + 119. */
const TOTAL_CON_PROPINA = '$1.309'
/** Lo que la caja tiene que esperar en efectivo al cerrar: la venta + la propina. */
const EFECTIVO_ESPERADO = '1309'

/**
 * Lo que el `beforeAll` fue creando. **Se llena de a poco a propósito**: si el
 * montaje falla a la mitad, el `afterAll` tiene que poder cerrar lo que sí llegó
 * a existir. Con un objeto que solo se asigna al final, un fallo entre "entrar a
 * turno" y "abrir caja" dejaba al garzón en turno **para siempre**, y desde ahí
 * toda corrida siguiente moría con un strict-mode al elegir garzón. Medido.
 */
const escenario: {
  token?: string
  garzon?: { id: string; pin: string; nombre: string }
  salonNombre?: string
  mesaId?: string
  itemNombre?: string
  cajaId?: string
} = {}

async function api<T>(
  request: APIRequestContext,
  metodo: 'get' | 'post',
  ruta: string,
  opts: { token?: string; data?: unknown } = {},
): Promise<T> {
  const res = await request[metodo](`${API}${ruta}`, {
    headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
    ...(opts.data ? { data: opts.data } : {}),
  })
  if (!res.ok()) {
    throw new Error(
      `${metodo.toUpperCase()} ${ruta} → ${res.status()}: ${await res.text()}`,
    )
  }
  return (await res.json()) as T
}

test.beforeAll(async ({ request }) => {
  const inicial = await api<{ access_token: string }>(
    request,
    'post',
    '/auth/login',
    { data: { email: EMAIL, password: PASSWORD } },
  )
  const sesion = await api<{ access_token: string }>(
    request,
    'post',
    '/auth/switch-tenant',
    { token: inicial.access_token, data: { tenantId: TENANT_DEMO_RESTAURANTE } },
  )
  escenario.token = sesion.access_token
  const token = escenario.token
  const marca = Date.now()

  // Garzón propio: la sesión de trabajo es única por garzón, así que compartir
  // el del seed hace que dos corridas se pisen.
  const nombreGarzon = `Garzón salón E2E ${marca}`
  const garzon = await api<{ id: string; pin: string }>(
    request,
    'post',
    '/garzones',
    { token, data: { nombre: nombreGarzon } },
  )
  escenario.garzon = { ...garzon, nombre: nombreGarzon }

  const turnos = await api<{ id: string; activo: boolean }[]>(
    request,
    'get',
    '/turnos',
    { token },
  )
  const turnoId = turnos.find((t) => t.activo)?.id
  if (!turnoId) throw new Error('El seed no tiene ningún turno activo')
  await api(request, 'post', '/sesiones-garzon/iniciar', {
    token,
    data: { garzonId: garzon.id, pin: garzon.pin, turnoId },
  })

  escenario.salonNombre = `Salón E2E ${marca}`
  const salon = await api<{ id: string }>(request, 'post', '/salones', {
    token,
    data: { nombre: escenario.salonNombre },
  })
  const mesa = await api<{ id: string }>(
    request,
    'post',
    `/salones/${salon.id}/mesas`,
    {
      token,
      // Al centro del plano: la posición por defecto es (0,0) y ahí la mesa
      // queda recortada contra el borde del contenedor, así que el click cae
      // fuera del área visible. Medido.
      data: { nombre: `Mesa ${marca}`, posX: 0.5, posY: 0.5 },
    },
  )
  escenario.mesaId = mesa.id

  escenario.itemNombre = `Plato E2E ${marca}`
  await api(request, 'post', '/items', {
    token,
    data: {
      nombre: escenario.itemNombre,
      tipo: 'producto',
      precioBase: PRECIO_BASE,
      monedaId: CLP,
      unidadMedida: 'unidad',
      stock: '10',
      costo: '400',
    },
  })

  // El cobro del salón es canal físico: exige caja abierta del usuario que
  // cobra, que acá es el mismo con el que está logueado el navegador.
  const disponibles = await api<{ cajonId: string }[]>(
    request,
    'get',
    '/caja/cajones-disponibles',
    { token },
  )
  if (!disponibles[0]) {
    throw new Error(
      'No hay cajones disponibles: probablemente quedó una caja abierta de una corrida anterior',
    )
  }
  const caja = await api<{ id: string }>(request, 'post', '/caja/abrir', {
    token,
    data: {
      cajonId: disponibles[0].cajonId,
      saldoInicial: '0.0000',
      comentario: 'Apertura E2E navegador',
    },
  })
  escenario.cajaId = caja.id
})

test.afterAll(async ({ request }) => {
  const { token, cajaId, garzon } = escenario
  if (!token) return
  const auth = { Authorization: `Bearer ${token}` }

  // Red de seguridad del camino de FALLO: si el test llegó al final, ya cerró la
  // caja y esto no hace nada. Si murió antes, la cierra igual — un cajón ocupado
  // deja la corrida siguiente sin poder abrir, y Paris tiene un solo cajón.
  if (cajaId) {
    const conteo = await request.post(`${API}/caja/${cajaId}/conteo`, {
      headers: auth,
      data: {
        lineas: [{ metodoPagoId: null, montoContado: EFECTIVO_ESPERADO }],
      },
    })
    const estado = conteo.ok()
      ? ((await conteo.json()) as { estado?: string }).estado
      : undefined
    if (estado === 'en_conciliacion') {
      const motivos = await request.get(
        `${API}/motivos-diferencia?soloActivas=true`,
        { headers: auth },
      )
      const motivoId = ((await motivos.json()) as { id: string }[])[0]?.id
      await request.post(`${API}/caja/${cajaId}/cerrar`, {
        headers: auth,
        data: {
          lineas: [
            {
              metodoPagoId: null,
              motivoDiferenciaId: motivoId,
              comentarioDiferencia: 'Cierre del e2e de navegador',
            },
          ],
        },
      })
    }
  }

  if (garzon) {
    await request.post(`${API}/sesiones-garzon/cerrar`, {
      headers: auth,
      data: { garzonId: garzon.id, pin: garzon.pin },
    })
  }
})

/**
 * Una ronda completa de identificación: elegir quién sos y teclear los 6
 * dígitos. El modal tiene DOS pasos y el segundo no existe hasta el primero.
 *
 * Se usa dos veces —al abrir la cuenta y al cobrarla— porque el dispositivo es
 * compartido: `resolverGarzonActuante` pide credencial en cada operación que
 * necesita saber quién la hace. En una tablet personal no se pediría ninguna.
 *
 * El nombre va **exacto**: por prefijo, un garzón que quedó vivo de una corrida
 * interrumpida hace que el locator matchee dos botones y la suite entera se
 * vuelve inarrancable hasta limpiar la base a mano. Medido.
 */
async function rondaDePin(page: Page, garzon: { pin: string; nombre: string }) {
  const modal = page.getByRole('dialog').last()
  await modal.getByRole('button', { name: garzon.nombre, exact: true }).click()
  for (const digito of garzon.pin) {
    await modal.getByRole('button', { name: digito, exact: true }).click()
  }
}

/**
 * El valor de la fila "Total" del panel de la cuenta, no cualquier `$1.190` de
 * la pantalla.
 *
 * ⚠️ Un `getByText('$1.190').first()` es **vacuo**: el catálogo comparte
 * pantalla con el panel, y basta un ítem de $1.190 en el catálogo del tenant
 * para que la aserción pase con la cuenta equivocada. Medido — y este mismo test
 * le agrega un ítem al catálogo por corrida, así que la ambigüedad crece sola.
 */
function valorDelTotal(page: Page) {
  return page
    .locator('span')
    .filter({ hasText: /^Total$/ })
    .first()
    .locator('xpath=following-sibling::span[1]')
}

test('abre una cuenta en una mesa, le carga un producto y la cobra', async ({
  page,
  request,
}) => {
  const garzon = escenario.garzon!
  await page.goto('/salones')

  // 1. Elegir el salón propio. Explícito aunque la pantalla preseleccione uno:
  //    cuál queda primero depende del orden de la lista.
  //
  //    ⚠️ `Show popup` es el label por defecto que Reka UI le pone al trigger
  //    del `USelectMenu` — la pantalla no le da ninguno propio. Por eso abajo se
  //    verifica la selección: si ese label cambia y el locator agarra otro
  //    control, el test cae acá y no diez líneas después.
  await page.getByRole('button', { name: 'Show popup' }).click()
  await page.getByRole('option', { name: escenario.salonNombre! }).click()
  await expect(page.getByRole('button', { name: 'Show popup' })).toContainText(
    escenario.salonNombre!,
  )

  // 2. La mesa del plano, por el hook de test que el componente ya expone.
  await page.locator(`[data-qa="mesa-${escenario.mesaId}"]`).click()

  // 3. Nueva cuenta → identificarse.
  await page.getByRole('button', { name: 'Nueva cuenta' }).click()
  await rondaDePin(page, garzon)

  // 4. Ya dentro de la cuenta: agregar el producto desde el catálogo.
  await page.getByText(escenario.itemNombre!, { exact: true }).click()

  // 5. El total de la cuenta sale de la regla: $1.000 afecto + 19% = $1.190.
  await expect(valorDelTotal(page)).toHaveText(TOTAL_CON_IVA)

  // 6. Cobrar. El modal precarga el método por defecto, el total y la propina
  //    sugerida del 10%, así que se paga $1.309.
  await page.getByRole('button', { name: 'Cerrar y cobrar' }).click()
  const cobro = page.getByRole('dialog').filter({ hasText: 'Cobrar venta' })
  await expect(cobro).toContainText(TOTAL_CON_PROPINA)

  // 7. El PIN se pide DESPUÉS de confirmar, no antes: quién cierra la cuenta es
  //    un dato del cierre y no se hereda de quien la abrió.
  await cobro.getByRole('button', { name: 'Confirmar venta' }).click()
  await rondaDePin(page, garzon)

  // 8. La pantalla dice que salió y vuelve al listado de la mesa.
  //    ⚠️ Las dos aserciones son **débiles a propósito** y no son la prueba del
  //    cobro: el toast sale de un ternario de cliente, y el listado vacío ya se
  //    veía en el paso 3 —la mesa arrancó sin cuentas y la pantalla filtra en
  //    memoria, no refetchea—. Lo que fijan es que el flujo llegó al final sin
  //    reventar; la plata la verifica el paso 9.
  //    Plazo propio, no el default de 5 s: en la PRIMERA corrida sobre un stack
  //    recién levantado la cadena venta + cierre pasa de 5 s. No es espera fija
  //    — resuelve apenas aparece.
  await expect(
    page.getByText('Cuenta cerrada — propina registrada').first(),
  ).toBeVisible({ timeout: 15_000 })
  await expect(
    page.getByText(
      'La mesa no tiene cuentas abiertas. Crea una nueva para empezar.',
    ),
  ).toBeVisible({ timeout: 15_000 })

  // 9. ⚠️ La verificación que **no** es de cliente: que la caja espere
  //    exactamente lo cobrado. El `estado: 'cerrada'` solo sale si el conteo
  //    cuadra con lo que el servidor calculó —venta $1.190 + propina $119—.
  //    Sin esto, una pantalla que muestre $1.309 y mande propina 0 pasa en
  //    verde: el modal es matemática de cliente y el toast, un ternario local.
  //    Medido, con `venta_propina.monto_pagado = 0` en la base.
  const conteo = await api<{ estado: string }>(
    request,
    'post',
    `/caja/${escenario.cajaId}/conteo`,
    {
      token: escenario.token,
      data: {
        lineas: [{ metodoPagoId: null, montoContado: EFECTIVO_ESPERADO }],
      },
    },
  )
  expect(conteo.estado).toBe('cerrada')
})
