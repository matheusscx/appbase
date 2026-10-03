import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Gestos de pantalla que se repiten entre flujos de navegador.
 *
 * Acá vive lo que **cuesta descubrir** de la UI —cómo se lee un monto sin
 * agarrar el de al lado, cómo se escribe en un input enmascarado, cómo se elige
 * en un selector de Reka— y que si cada spec resuelve por su cuenta, cada una lo
 * resuelve un poco distinto y un poco peor.
 */

/**
 * El valor que acompaña a una etiqueta: el elemento hermano que le sigue.
 *
 * ⚠️ Sin anclar a la etiqueta, un `getByText('$1.190')` es **vacuo**: en el POS
 * el catálogo comparte pantalla con el carrito, y basta un ítem de ese precio
 * para que la aserción pase con el total equivocado. Y el locator es
 * **estricto** (sin `.first()`): si hay dos etiquetas iguales, el test explota
 * con un strict-mode violation en vez de elegir una en silencio.
 *
 * `normalize-space(text())` mira solo los nodos de texto DIRECTOS: la fila
 * "Total" del carrito lleva adentro un `<VentasMonedaTasasInfo>`, así que un
 * `hasText` normal no la matchea. El xpath va **relativo** (`.//`): con `//` un
 * locator anidado igual busca en todo el documento, y acotarlo a un modal no
 * acotaría nada.
 */
export function valorDeFila(raiz: Page | Locator, etiqueta: string): Locator {
  return raiz
    .locator(`xpath=.//*[normalize-space(text())="${etiqueta}"]`)
    .locator('xpath=following-sibling::*[1]')
}

/**
 * Escribe un monto en un `MoneyInput`, tecla por tecla.
 *
 * ⚠️ No `fill()`: el input está enmascarado con maska, que reformatea a partir
 * de los eventos de teclado. Con `fill()` el valor del DOM cambia pero el
 * `v-model` se queda con el anterior — medido: el campo seguía mostrando $1.309
 * después de un `fill('2000')`.
 *
 * Y busca por `inputmode="decimal"` —el que pone `MoneyInput`— y no por `input`
 * a secas: un `ControlOrMeta+a` con el foco en otro control selecciona la página
 * entera en vez del monto.
 */
export async function escribirMonto(
  raiz: Locator,
  monto: string,
): Promise<void> {
  const input = raiz.locator('input[inputmode="decimal"]')
  await input.selectText()
  await input.pressSequentially(monto)
}

/**
 * Elige una opción en un `USelectMenu` de Nuxt UI.
 *
 * ⚠️ `Show popup` es el label que Reka le pone por defecto al trigger — las
 * pantallas no le dan ninguno propio. Y espera a que el popup DESAPAREZCA, no
 * solo a que el trigger muestre el nombre nuevo: al cerrarse, Reka devuelve el
 * foco al trigger, y ese salto le roba las teclas a lo que se escriba después.
 * Medido: el monto tecleado a continuación se perdía entero.
 */
export async function elegirEnSelector(
  raiz: Page | Locator,
  nombre: string,
): Promise<void> {
  // Las opciones se dibujan en un portal, fuera de `raiz`: hay que buscarlas en
  // la página aunque el trigger esté acotado a un formulario o a una fila.
  const page = 'goto' in raiz ? raiz : raiz.page()
  const trigger = raiz.getByRole('button', { name: 'Show popup' })
  await trigger.click()
  await page.getByRole('option', { name: nombre, exact: true }).click()
  await expect(trigger).toContainText(nombre)
  await expect(page.getByRole('listbox')).toHaveCount(0)
}

/**
 * Elige en un `USelectMenu` haciendo pie en su **placeholder**.
 *
 * No se usa `elegirEnSelector` (arriba) por dos razones, y ninguna es que no
 * acepte una raíz (la acepta). Una: en el formulario de Compras los tres
 * selectores del encabezado **comparten** raíz —el formulario— y
 * `elegirEnSelector` busca el trigger por su rol ("Show popup", el label que
 * Reka le pone a TODOS), así que ahí encontraría tres. El placeholder es lo
 * único que los distingue sin inventar un contenedor. Dos: los `searchable` no
 * dibujan la opción hasta que se tipea, y eso `elegirEnSelector` no lo hace.
 *
 * ⚠️ Espera a que el popup **desaparezca**, no solo a que el trigger muestre el
 * valor nuevo: al cerrarse, Reka devuelve el foco al trigger, y ese salto le
 * roba las teclas a lo que se escriba después — en Compras, al precio de la
 * línea. Medido en `elegirEnSelector`, mismo gesto.
 *
 * Extraído acá al tercer uso (`compras-por-pantalla.spec.ts`,
 * `compras-dte.spec.ts` y `compras-presentacion.spec.ts`), misma regla que
 * `rondaDePin`.
 */
export async function elegirPorPlaceholder(
  raiz: Page | Locator,
  placeholder: string,
  opcion: string,
  opts: { buscar?: boolean, exacta?: boolean } = {},
): Promise<void> {
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

/**
 * Una ronda completa de identificación de garzón: elegir quién sos y teclear
 * los 6 dígitos del PIN. El modal tiene DOS pasos y el segundo no existe hasta
 * que el primero elige un garzón.
 *
 * Extraído acá al tercer uso (`cuenta-hasta-cobro.spec.ts` y
 * `anular-plato.spec.ts` ya lo duplicaban) — regla del repo: duplicar dos veces
 * es aceptable, se extrae a la tercera.
 *
 * El nombre va **exacto**: por prefijo, un garzón que quedó vivo de una corrida
 * interrumpida hace que el locator matchee dos botones y la suite entera se
 * vuelve inarrancable hasta limpiar la base a mano. Medido.
 */
export async function rondaDePin(
  page: Page,
  garzon: { pin: string, nombre: string },
): Promise<void> {
  const modal = page.getByRole('dialog').last()
  await modal.getByRole('button', { name: garzon.nombre, exact: true }).click()
  for (const digito of garzon.pin) {
    await modal.getByRole('button', { name: digito, exact: true }).click()
  }
}

/**
 * El valor de la fila "Total" del panel de la cuenta/carrito, no cualquier
 * monto suelto de la pantalla.
 *
 * ⚠️ Un `getByText('$1.190').first()` es **vacuo**: el catálogo comparte
 * pantalla con el panel, y basta un ítem de ese precio en el catálogo del
 * tenant para que la aserción pase con la cuenta equivocada. Medido.
 *
 * Extraído acá al tercer uso, misma regla que `rondaDePin`.
 */
export function valorDelTotal(page: Page): Locator {
  return page
    .locator('span')
    .filter({ hasText: /^Total$/ })
    .first()
    .locator('xpath=following-sibling::span[1]')
}

/**
 * Entra por la pantalla de login como un usuario de **un solo tenant**: la app
 * hace el `switch-tenant` sola y aterriza en el Inicio.
 *
 * Es el login de los specs que corren como el rol que usa la pantalla y no como
 * el admin del seed (`test.use({ storageState: { cookies: [], origins: [] } })`).
 * `admin@sistema.com` tiene más de un tenant y entra por `/select-tenant`, que este
 * helper no recorre: con un usuario así el test cae por timeout esperando `/`.
 *
 * ⚠️ `networkidle` antes de tipear: sin la hidratación de Nuxt el `v-model` no
 * captura lo escrito y el submit queda deshabilitado (ver `auth.setup.ts`).
 *
 * `password` por defecto es la de todas las cuentas del seed.
 */
export async function entrarComo(
  page: Page,
  email: string,
  password = 'admin',
): Promise<void> {
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.getByPlaceholder('tu@email.com').fill(email)
  await page.locator('input[type="password"]').first().fill(password)
  const submit = page.locator('button[type="submit"]').first()
  await expect(submit).toBeEnabled()
  await submit.click()
  await page.waitForURL(url => url.pathname === '/')
}
