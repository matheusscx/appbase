import { defineVitestConfig } from '@nuxt/test-utils/config'
import { configDefaults } from 'vitest/config'

export default defineVitestConfig({
  test: {
    environment: 'happy-dom',
    setupFiles: ['./test.setup.ts'],
    // `e2e/` es de Playwright: sus specs usan `page`, que no existe acá. Sin
    // esta exclusión vitest los levanta y `npm test` termina en rojo aunque
    // todos los unit pasen.
    exclude: [...configDefaults.exclude, '.output/**', 'e2e/**'],
  },
})
