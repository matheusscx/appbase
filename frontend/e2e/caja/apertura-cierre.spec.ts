import { test, expect } from '@playwright/test'
import { api, cerrarCaja, tokenDe, TENANTS } from '../support/api'
import { elegirEnSelector, escribirMonto, valorDeFila } from '../support/ui'

/**
 * Abrir y cerrar la caja **por pantalla**, que es el único flujo del sistema
 * donde el operador no elige el número que decide: cuenta lo que hay, y la
 * diferencia la calcula el sistema.
 *
 * Por eso el test cruza las dos fases del cierre, que muestran la misma
 * "Diferencia" con orígenes distintos:
 *
 * 1. **Conteo** — la diferencia es aritmética de cliente, para que el cajero vea
 *    en vivo cómo va. No prueba nada por sí sola.
 * 2. **Conciliación** — la diferencia viene del arqueo que devolvió el servidor
 *    al congelar el conteo. Esa es la que manda, y la que este test compara
 *    contra la API al final.
 *
 * ⚠️ Es la única spec que **no** abre la caja por API: abrirla es justamente lo
 * que se está probando. Como el tenant tiene un solo cajón, corre con el resto
 * de la suite en serie (`workers: 1` en `playwright.config.ts`).
 */

/** Saldo con el que se abre el turno, y lo que se cuenta al cerrarlo. */
const SALDO_INICIAL = '10000'
const SALDO_INICIAL_MOSTRADO = '$10.000'
const SALDO_INICIAL_API = '10000.0000'
const CONTADO = '9000'
const CONTADO_MOSTRADO = '$9.000'
const CONTADO_API = '9000.0000'
/** Faltan $1.000 respecto de lo esperado. El signo importa: es un faltante. */
const DIFERENCIA = '-$1.000'
const DIFERENCIA_API = '-1000.0000'

interface LineaArqueo {
  nombre: string
  esEfectivo: boolean
  esperado: string | null
  contado: string | null
  diferencia: string | null
  motivoDiferenciaId: string | null
}

let escenario: {
  token?: string
  cajonNombre?: string
  motivoNombre?: string
  motivoId?: string
} = {}

test.beforeEach(async ({ request }) => {
  escenario = {}
  const token = await tokenDe(request, TENANTS.restaurante)
  escenario.token = token

  const disponibles = await api<{ cajonId: string; nombre: string }[]>(
    request,
    'get',
    '/caja/cajones-disponibles',
    { token },
  )
  // Falla acá y no diez líneas después: sin cajón libre la pantalla muestra el
  // aviso de "pedile al administrador" y el test moriría buscando un formulario
  // que no existe.
  if (!disponibles[0]) {
    throw new Error(
      'No hay cajones disponibles: probablemente quedó una caja abierta de una corrida anterior',
    )
  }
  escenario.cajonNombre = disponibles[0].nombre

  // El motivo se elige por NOMBRE en la pantalla y se verifica por ID contra el
  // servidor: así el test afirma que se guardó el que se eligió, y no solo que
  // se guardó alguno.
  const motivos = await api<{ id: string; nombre: string }[]>(
    request,
    'get',
    '/motivos-diferencia?soloActivas=true',
    { token },
  )
  if (!motivos[0]) throw new Error('El seed no tiene motivos de diferencia activos')
  escenario.motivoNombre = motivos[0].nombre
  escenario.motivoId = motivos[0].id
})

test.afterEach(async ({ request }) => {
  const { token } = escenario
  if (!token) return
  // Red de seguridad del camino de FALLO: si el test murió con el turno sin
  // cerrar, el cajón queda tomado y la corrida siguiente no puede ni empezar.
  //
  // ⚠️ Va por `cajones-estado` y no por `/caja/activa`: una caja que quedó en
  // `en_conciliacion` —el estado exacto en el que muere este test si falla a
  // mitad del cierre— ya no es "activa", pero el cajón lo sigue ocupando igual.
  // Medido: una corrida fallida dejó la siguiente sin poder abrir.
  const cajones = await api<{ sesion: { cajaId: string } | null }[]>(
    request,
    'get',
    '/caja/cajones-estado',
    { token },
  )
  for (const { sesion } of cajones) {
    if (sesion) await cerrarCaja(request, token, sesion.cajaId, '0')
  }
})

test('abre la caja, la cierra con un faltante, y la diferencia la pone el sistema', async ({
  page,
  request,
}) => {
  const token = escenario.token!

  // 1. Sin caja abierta, el POS no vende: ofrece abrirla.
  await page.goto('/ventas/pos')
  const apertura = page.locator('#caja-apertura-form')
  await expect(
    page.getByText(
      'No hay caja abierta. Ingresa el saldo inicial para comenzar el turno.',
    ),
  ).toBeVisible()

  // 2. Elegir el cajón y el saldo con el que arranca el turno.
  await elegirEnSelector(apertura, escenario.cajonNombre!)
  await escribirMonto(apertura, SALDO_INICIAL)
  await page.getByRole('button', { name: 'Abrir caja', exact: true }).click()

  // 3. La pantalla pasó a modo venta, y el servidor tiene el turno abierto con
  //    el saldo tecleado — no con el default.
  await expect(page.getByRole('button', { name: 'Caja abierta' })).toBeVisible()
  const activa = await api<{ id: string; estado: string; saldoInicial: string }>(
    request,
    'get',
    '/caja/activa',
    { token },
  )
  expect(activa.estado).toBe('abierta')
  expect(activa.saldoInicial).toBe(SALDO_INICIAL_API)

  // 4. Cerrar: el arqueo llega con lo que el sistema espera en el cajón, que sin
  //    ventas es el saldo inicial.
  await page.getByRole('button', { name: 'Caja abierta' }).click()
  await page.getByRole('menuitem', { name: 'Cerrar caja' }).click()
  // El drawer cambia de identidad entre las dos fases —"Cerrar caja" pasa a ser
  // "Conciliar diferencias"—, así que son dos locators y no uno: que el segundo
  // aparezca ya es parte de lo que se está probando.
  const cierre = page.getByRole('dialog').filter({ hasText: 'Cerrar caja' })
  const conciliacion = page
    .getByRole('dialog')
    .filter({ hasText: 'Conciliar diferencias' })
  // La línea de efectivo por el hook de test del componente: `EFECTIVO` es la
  // clave que el drawer le da a la línea sin método de pago.
  const efectivo = cierre.locator('[data-qa="arqueo-EFECTIVO"]')
  await expect(efectivo).toContainText(`Esperado ${SALDO_INICIAL_MOSTRADO}`)

  // 5. Se cuenta menos de lo esperado. Esta "Diferencia" es de cliente —el
  //    componente la calcula en vivo mientras se teclea—, así que se asevera
  //    como lo que es: feedback, no prueba.
  await escribirMonto(efectivo, CONTADO)
  await expect(valorDeFila(efectivo, 'Diferencia')).toHaveText(DIFERENCIA)

  // 6. Enviar el conteo lo congela del lado del servidor y abre la conciliación.
  await cierre.getByRole('button', { name: 'Enviar conteo' }).click()
  await expect(
    conciliacion.getByText(
      'El conteo no cuadró. Justificá cada diferencia para confirmar el cierre.',
    ),
  ).toBeVisible()

  // 7. Y ACÁ está la aserción que importa: la diferencia que se muestra en la
  //    conciliación ya no la calculó la pantalla, viene del arqueo que devolvió
  //    el servidor al congelar el conteo.
  const lineaConciliada = conciliacion.locator('[data-qa="arqueo-EFECTIVO"]')
  await expect(lineaConciliada).toContainText(`Contado ${CONTADO_MOSTRADO}`)
  await expect(valorDeFila(lineaConciliada, 'Diferencia')).toHaveText(DIFERENCIA)

  // 8. Justificar y confirmar. Sin motivo, el botón queda deshabilitado: una
  //    diferencia no se cierra sola.
  await expect(
    conciliacion.getByRole('button', { name: 'Confirmar cierre' }),
  ).toBeDisabled()
  await lineaConciliada.getByRole('combobox').click()
  await page
    .getByRole('option', { name: escenario.motivoNombre!, exact: true })
    .click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await conciliacion.getByRole('button', { name: 'Confirmar cierre' }).click()

  // 9. El turno quedó cerrado con el faltante registrado, no perdonado.
  await expect(page.getByText('No hay caja abierta.')).toBeVisible({
    timeout: 15_000,
  })
  const caja = await api<{ estado: string }>(
    request,
    'get',
    `/caja/${activa.id}`,
    { token },
  )
  expect(caja.estado).toBe('cerrada')

  const arqueo = await api<{ lineas: LineaArqueo[] }>(
    request,
    'get',
    `/caja/${activa.id}/arqueo`,
    { token },
  )
  const linea = arqueo.lineas.find((l) => l.esEfectivo)
  expect(linea?.esperado).toBe(SALDO_INICIAL_API)
  expect(linea?.contado).toBe(CONTADO_API)
  expect(linea?.diferencia).toBe(DIFERENCIA_API)
  expect(linea?.motivoDiferenciaId).toBe(escenario.motivoId)
})
