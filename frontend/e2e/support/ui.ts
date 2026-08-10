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
