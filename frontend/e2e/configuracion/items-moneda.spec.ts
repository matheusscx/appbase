import { test, expect } from '@playwright/test'
import {
  crearProducto,
  limpiarItems,
  tokenDe,
  TENANTS,
} from '../support/api'

/**
 * Cambiar la moneda de un ítem vacía la plata que quedó escrita en la anterior.
 *
 * **Por qué esto vive acá y no en el unit.** El gesto está fijado en
 * `app/pages/configuracion/items.nuxt.spec.ts`, pero hay dos propiedades que ese
 * spec **no puede** aseverar, y las dos son de esta pantalla:
 *
 * 1. **Que el selector siga mostrando la moneda vieja mientras el cambio está a
 *    medio confirmar.** El unit afirma sobre el modelo (`props('modelValue')`),
 *    nunca sobre la etiqueta que se ve. Y el modo de falla que este frente vino a
 *    cerrar es exactamente ése: la pantalla diciendo una cosa y el formulario
 *    otra, en un campo de plata.
 * 2. **Que cerrar el drawer mate el cambio pendiente.** Cerrar el drawer de
 *    `items` en el entorno `nuxt` de vitest tira un `Unhandled Rejection` de
 *    happy-dom (`CSSStyleDeclaration` desde el `Presence` de Reka) que deja la
 *    corrida entera en rojo aunque los tests pasen. Misma familia que el `UModal`
 *    sobre este drawer, anotada en `docs/agent/pendientes.md` § 2.
 *    ⚠️ Medido: sacando la línea de `resetDrawer` que mata el pendiente, el unit sigue
 *    dando 43 en verde y **este archivo falla**. Es la única red que cubre ese caso.
 *
 * El ítem se siembra por API y se da de baja al final: nada de esto depende del
 * catálogo del seed, y no queda un ítem huérfano en el listado.
 *
 * ⚠️ **No guarda.** Todo ocurre en el formulario; el ítem sale del test con el
 * precio con el que entró, y la última vuelta lo comprueba reabriendo la ficha.
 */

const marca = Date.now()
const NOMBRE = `Moneda ${marca}`
const CLP = 'Peso Chileno'
const USD = 'Dólar Estadounidense'

let token = ''
let itemId = ''

test.beforeAll(async ({ request }) => {
  token = await tokenDe(request, TENANTS.restaurante)
  const item = await crearProducto(request, token, {
    nombre: NOMBRE,
    precioBase: '8900',
  })
  itemId = item.id
})

test.afterAll(async ({ request }) => {
  await limpiarItems(request, token, [itemId])
})

/**
 * El `UFormField` cuya etiqueta es `etiqueta`, con su control adentro.
 *
 * ⚠️ Ni `getByLabel` ni el hermano de la etiqueta sirven acá. El trigger del
 * `USelectMenu` lleva `aria-label="Show popup"`, que gana sobre el `<label for>`;
 * y entre la etiqueta y el control hay un `<!--v-if-->`, así que
 * `following-sibling::*[1]` cae en la nada. Se busca el contenedor del campo
 * —`UFormField` lo marca con `data-slot="root"`— filtrado por su etiqueta, que es
 * el mismo gesto que hace el spec unitario de la pantalla.
 */
function campo(
  drawer: import('@playwright/test').Locator,
  etiqueta: RegExp,
): import('@playwright/test').Locator {
  return drawer
    .locator('[data-slot="root"][data-orientation="vertical"]')
    // El locator de `has` va armado desde la página, NO desde `drawer`: Playwright
    // lo interpreta relativo al de afuera, así que uno ya acotado al drawer queda
    // acotado dos veces y no matchea nada. Medido: 0 vs 1.
    .filter({
      has: drawer.page().locator('label').filter({ hasText: etiqueta }),
    })
}

/**
 * Deja el catálogo filtrado a la fila del ítem sembrado y devuelve su lápiz.
 *
 * ⚠️ La espera del `toHaveCount(1)` no es adorno: la búsqueda es debounced, y sin
 * ella el click resuelve sobre el listado **sin filtrar** —15 filas— y explota por
 * strict mode.
 */
async function abrirCatalogo(
  page: import('@playwright/test').Page,
): Promise<import('@playwright/test').Locator> {
  await page.goto('/configuracion/items')
  await page
    .getByPlaceholder('Buscar por nombre o descripción...')
    .fill(String(marca))
  const fila = page.locator('tr').filter({ hasText: NOMBRE })
  await expect(fila).toHaveCount(1)
  return fila.getByTitle('Editar')
}

test('cambiar la moneda frena y avisa; desistir no toca nada, confirmar vacía', async ({
  page,
}) => {
  const editar = await abrirCatalogo(page)
  await editar.click()

  const drawer = page.getByRole('dialog')
  const selectorMoneda = campo(drawer, /^Moneda$/).getByRole('button', {
    name: 'Show popup',
  })
  const precio = campo(drawer, /^Precio base/).locator('input[inputmode="decimal"]')
  const aviso = drawer.getByText('Cambiar la moneda del ítem')

  await expect(selectorMoneda).toContainText(CLP)
  await expect(precio).toHaveValue('8.900')

  // ── Elegir otra moneda no cambia nada: pregunta ────────────────────────────
  await selectorMoneda.click()
  await page.getByRole('option', { name: `${USD} (USD)`, exact: true }).click()

  await expect(aviso).toBeVisible()
  await expect(drawer.getByText('Se vacía el precio base')).toBeVisible()
  // Lo que el unit no puede ver: la etiqueta del selector sigue siendo la vieja,
  // así que la pantalla y el formulario dicen lo mismo mientras se decide.
  await expect(selectorMoneda).toContainText(CLP)
  await expect(precio).toHaveValue('8.900')

  // ── Desistir ───────────────────────────────────────────────────────────────
  await drawer.getByRole('button', { name: 'Dejar la moneda como está' }).click()
  await expect(aviso).toBeHidden()
  await expect(selectorMoneda).toContainText(CLP)
  await expect(precio).toHaveValue('8.900')

  // ── Confirmar ──────────────────────────────────────────────────────────────
  await selectorMoneda.click()
  await page.getByRole('option', { name: `${USD} (USD)`, exact: true }).click()
  await drawer.getByRole('button', { name: 'Cambiar y vaciar' }).click()

  await expect(selectorMoneda).toContainText(USD)
  await expect(precio).toHaveValue('')
  await expect(aviso).toBeHidden()
})

test('un cambio a medio confirmar muere al cerrar el drawer', async ({
  page,
}) => {
  const editar = await abrirCatalogo(page)
  await editar.click()

  const drawer = page.getByRole('dialog')
  const aviso = drawer.getByText('Cambiar la moneda del ítem')

  await campo(drawer, /^Moneda$/).getByRole('button', { name: 'Show popup' }).click()
  await page.getByRole('option', { name: `${USD} (USD)`, exact: true }).click()
  await expect(aviso).toBeVisible()

  await drawer.getByRole('button', { name: 'Cancelar' }).click()
  await expect(drawer).toBeHidden()

  // La ficha se reabre limpia: ni el aviso de un gesto que quedó a medias —que
  // confirmado acá le aplicaría a este ítem una moneda que nadie eligió para él—
  // ni rastro del cambio, porque nunca se guardó.
  await editar.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(aviso).toBeHidden()
  await expect(
    campo(page.getByRole('dialog'), /^Precio base/).locator(
      'input[inputmode="decimal"]',
    ),
  ).toHaveValue('8.900')
})
