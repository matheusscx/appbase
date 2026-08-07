import { defineVitestConfig } from '@nuxt/test-utils/config'
import { configDefaults } from 'vitest/config'

export default defineVitestConfig({
  test: {
    environment: 'happy-dom',
    setupFiles: ['./test.setup.ts'],
    // Los specs `.nuxt.spec.ts` levantan un entorno Nuxt completo en un hook
    // `beforeAll`, y con el default de 10s eso expira en cuanto la máquina está
    // cargada (medido el 2026-08-06: la misma suite pasa 591/591 sola y deja 4
    // archivos en "Hook timed out in 10000ms" corriendo junto a otra cosa).
    // La corrida sí sale roja —`Test Files 4 failed`, exit ≠ 0—; lo que engaña
    // es el CONTADOR: esos tests se reportan `skipped`, así que la línea dice
    // `566 passed | 25 skipped` con **0 failed** y parece que no faltó nada.
    hookTimeout: 60_000,
    // Y la misma causa del otro lado: `mountSuspended` monta una página Nuxt
    // entera, que bajo carga pasa de ~300ms a >5s. Medido el 2026-08-06 con el
    // compose arriba: 15 tests de 11 archivos caídos por `Test timed out in
    // 5000ms`, todos de pantallas que nadie estaba tocando, y verdes al correr
    // la suite sola. Un gate que es cara o cruz no es un gate. 20s deja margen
    // de sobra sin volver eterno un test que sí se cuelgue.
    testTimeout: 20_000,
    // `e2e/` es de Playwright: sus specs usan `page`, que no existe acá. Sin
    // esta exclusión vitest los levanta y `npm test` termina en rojo aunque
    // todos los unit pasen.
    exclude: [...configDefaults.exclude, '.output/**', 'e2e/**'],
  },
})
