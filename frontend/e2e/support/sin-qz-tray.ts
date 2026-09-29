import { test as base, expect } from '@playwright/test'

/**
 * El `test` de los specs que imprimen: cobrar en el POS o en salones, mandar a
 * cocina, pedir la precuenta. Todos pasan por `imprimirEn` (`useImpresoras.ts`),
 * que se conecta a QZ Tray.
 *
 * En CI no hay QZ Tray: la conexión falla al toque y el flujo sigue con el aviso
 * de impresión. En una máquina de desarrollo puede estar abierto, y sin
 * certificado (modo sin firmar) su handshake no vuelve: *"cobra un afecto y un
 * exento"* de `pos.spec.ts` cayó 3 de 3 con el QZ Tray de la Mac del owner y
 * pasó en 6,3 s sin él (2026-09-29).
 * Decisión del owner (2026-09-29, eligió en el chat la opción que le llevó la
 * sesión coordinadora): el Playwright local simula siempre que no hay QZ Tray,
 * igual que CI.
 *
 * Se redirigen los puertos de QZ a uno cerrado para que el socket **falle con
 * error**, que es lo que hace qz-tray pasar al puerto siguiente y rendirse.
 * ⚠️ `page.routeWebSocket` con `ws.close()` no sirve: el socket de la página
 * abre igual, qz-tray entra al handshake y se cuelga.
 */
export const test = base.extend<{ sinQzTray: void }>({
  sinQzTray: [async ({ page }, use) => {
    await page.addInitScript(() => {
      const Original = window.WebSocket
      // Los de `qz-tray.js`: seguros 8181/8282/8383/8484, inseguros 8182/8283/8384/8485.
      const puertosQz = /:(8181|8282|8383|8484|8182|8283|8384|8485)\b/
      window.WebSocket = class extends Original {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(puertosQz.test(String(url)) ? 'ws://127.0.0.1:9/' : url, protocols)
        }
      } as typeof WebSocket
    })
    await use()
  }, { auto: true }],
})

export { expect }
