import { readFileSync } from 'node:fs'
import { test as base, expect, request, type BrowserContextOptions } from '@playwright/test'
import { CREDENCIALES } from './api'

type EstadoDeSesion = Exclude<BrowserContextOptions['storageState'], string | undefined>

/**
 * El `test` de todo spec que corre con la sesión del admin del seed: cada test
 * arranca con una sesión **recién hecha**, no con la foto que dejó el setup.
 *
 * ⚠️ **Por qué no alcanza la foto.** Hasta el 2026-10-06 todos los tests cargaban
 * el mismo `e2e/.auth/paris.json`, y esa foto se pudre sola:
 * - la cookie `access_token` la crea el store con 15 min de vida (`maxAge` de
 *   `app/stores/auth.ts`), contados desde el setup;
 * - pasados esos 15 min el middleware canjea el refresh de la foto, que ya no sirve:
 *   cualquier `tokenDe` lo revocó (switch-tenant del mismo admin revoca todos sus
 *   refresh, `AuthService.switchTenant`). Leído, no medido: aunque nadie lo
 *   revocara, el primer test que lo canjeara lo rotaría y el siguiente lo reusaría
 *   fuera de la gracia.
 * Medido con el backend en `JWT_EXPIRATION=2m`: desde el minuto 2,1 cayó al login
 * todo test con esta sesión (44 de 107), y el backend no registró ningún reuso, o
 * sea que fue la revocación. Con este fixture, la misma corrida no cayó en ninguno.
 *
 * La foto del setup sigue existiendo, pero solo como **plantilla de forma**: los
 * atributos de las cookies, el `localStorage` y el tenant (el `tenant_id` de su
 * access token). Lo que se renueva son los dos tokens, por API y por el mismo
 * origen que usa el navegador (ADR-022), así las cookies quedan en su dominio.
 *
 * ⚠️ El `storageState` por defecto del config es {@link SESION_FRESCA}, una ruta que
 * **no existe a propósito**: un spec que importe `test` de `@playwright/test` y
 * use la sesión del admin falla al crear el contexto (ENOENT con este nombre), en
 * vez de andar 15 minutos y caer al login. **También si solo usa `request`:** el
 * fixture `request` de Playwright carga el mismo `storageState` por defecto
 * (medido: `smoke/proxy-api` cayó así). Los specs que entran por pantalla con otro
 * usuario (`storageState` vacío en `test.use`) no lo necesitan.
 */
export const SESION_FRESCA = 'e2e/.auth/NO-EXISTE--importar-test-de-e2e-support-sesion.json'

/** La foto que escribe `auth.setup.ts`: solo plantilla, ver arriba. */
export const PLANTILLA = 'e2e/.auth/paris.json'

function claims(jwt: string): { iat: number, tenant_id: string } {
  return JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString())
}

/**
 * Una sesión nueva del admin en el tenant de la plantilla, lista para
 * `storageState`. También para un contexto que el spec abre a mano
 * (`browser.newContext`), que no pasa por el fixture.
 */
export async function sesionFresca(baseURL: string): Promise<EstadoDeSesion> {
  const plantilla = JSON.parse(readFileSync(PLANTILLA, 'utf8')) as Required<EstadoDeSesion>
  const accesoViejo = plantilla.cookies.find(c => c.name === 'access_token')
  if (!accesoViejo) throw new Error(`${PLANTILLA} no tiene la cookie access_token: ¿corrió el setup?`)

  const ctx = await request.newContext({ baseURL })
  try {
    const login = await ctx.post('/api/auth/login', { data: CREDENCIALES })
    if (!login.ok()) throw new Error(`login → ${login.status()}: ${await login.text()}`)
    const { access_token: sinTenant } = (await login.json()) as { access_token: string }
    // El switch exige la cookie de refresh del login, que el contexto ya guardó.
    const sw = await ctx.post('/api/auth/switch-tenant', {
      headers: { Authorization: `Bearer ${sinTenant}` },
      data: { tenantId: claims(accesoViejo.value).tenant_id },
    })
    if (!sw.ok()) throw new Error(`switch-tenant → ${sw.status()}: ${await sw.text()}`)
    const { access_token } = (await sw.json()) as { access_token: string }
    const { cookies: nuevas } = await ctx.storageState()

    // La vida de la cookie se copia de la plantilla (su `expires` menos el `iat`
    // del token que llevaba) en vez de repetir acá el `maxAge` del store.
    const vida = accesoViejo.expires - claims(accesoViejo.value).iat
    const acceso = { ...accesoViejo, value: access_token, expires: Date.now() / 1000 + vida }
    const nombres = new Set([...nuevas.map(c => c.name), 'access_token'])
    return {
      cookies: [...plantilla.cookies.filter(c => !nombres.has(c.name)), ...nuevas, acceso],
      origins: plantilla.origins,
    }
  }
  finally {
    await ctx.dispose()
  }
}

export const test = base.extend({
  // Pisa la opción solo cuando trae el default del config: un `test.use` con otro
  // valor (la sesión vacía de los specs que entran por pantalla) llega tal cual.
  storageState: async ({ storageState, baseURL }, use) => {
    await use(storageState === SESION_FRESCA ? await sesionFresca(baseURL!) : storageState)
  },
})

export { expect }
