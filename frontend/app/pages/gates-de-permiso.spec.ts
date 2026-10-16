import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Lote 7 (02.20, 06.10, 06.11): la pantalla que lee con un permiso concreto declara el gate de
// página —el mismo de Salones— para que quien no lo tiene vea un aviso y no un reporte en ceros.
// El gate lo ejecuta el middleware `permiso` (ya probado en `middleware/permiso.nuxt.spec.ts`);
// acá se fija que la PÁGINA lo engancha, leyendo su fuente como `admin.spec.ts`.
function meta(ruta: string) {
  const fuente = readFileSync(join(__dirname, ruta), 'utf-8')
  const m = fuente.match(/definePageMeta\(\{([\s\S]*?)\n?\}\)/)
  expect(m, `definePageMeta en ${ruta}`).toBeTruthy()
  return m![1]!
}

const CASOS: Array<[string, string, string]> = [
  ['salones/anulaciones.vue', 'Salones:Ver todas', 'Anulaciones'],
  ['sesiones-garzon.vue', 'Salones:Leer', 'Sesiones de garzón'],
  ['propinas/index.vue', 'Propinas:Leer', 'Propinas'],
  ['suscripciones.vue', 'Suscripciones:Leer', 'Suscripciones'],
]

describe('gate de página por permiso', () => {
  for (const [ruta, permiso, label] of CASOS) {
    it(`${ruta} exige ${permiso}`, () => {
      const cuerpo = meta(ruta)
      expect(cuerpo).toMatch(/middleware:\s*\['auth',\s*'permiso'\]/)
      expect(cuerpo).toContain(`permiso: '${permiso}'`)
      expect(cuerpo).toContain(`permisoLabel: '${label}'`)
    })
  }
})

describe('gates que esperan los permisos (09.3)', () => {
  it('suscripciones.vue no decide con un `if` en el setup, que corre antes de que lleguen los permisos', () => {
    const fuente = readFileSync(join(__dirname, 'suscripciones.vue'), 'utf-8')
    expect(fuente).not.toMatch(/navigateTo\('\/'\)/)
  })

  it('propinas/index.vue ya no revisa el permiso en onMounted ni devuelve a Inicio sin avisar', () => {
    const fuente = readFileSync(join(__dirname, 'propinas/index.vue'), 'utf-8')
    expect(fuente).not.toMatch(/navigateTo\('\/'\)/)
  })
})
