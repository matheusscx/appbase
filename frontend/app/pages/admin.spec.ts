import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// `/admin` es la única puerta a `/admin/*` y su candado depende 100% de que
// la PÁGINA declare el middleware — no hay `.global.ts` ni `router.beforeEach`
// (ver `middleware/admin.ts`, docblock). `admin.spec.ts` (el de la carpeta
// `middleware/`) prueba la función aislada y pasaría igual si esta página
// nunca la enganchara: por eso este test lee el `.vue` como texto y afirma
// sobre lo que `definePageMeta` declara ACÁ, no sobre el middleware en sí.
//
// El middleware correcto es `auth` (no `admin`): `middleware/auth.ts` trae su
// propio branch para rutas que empiezan con `/admin` —
// `if (!isSuperadmin.value) return navigateTo('/')` — y ESE es el guard de
// superadmin. `middleware/admin.ts` chequea `esAdmin` (admin del tenant
// activo, un eje distinto) contra el store de permisos, no el de auth: no
// sirve para esta ruta.
const fuente = readFileSync(join(__dirname, 'admin.vue'), 'utf-8')

describe('pages/admin — el candado de superadmin está enganchado', () => {
  it('declara middleware "auth" en definePageMeta (el guard de /admin vive ahí)', () => {
    const match = fuente.match(/definePageMeta\(\{([^}]*)\}\)/)
    expect(match, 'definePageMeta en admin.vue').toBeTruthy()

    const cuerpo = match![1]!
    expect(cuerpo).toMatch(/middleware:\s*'auth'/)
  })
})
