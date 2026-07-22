import { defineConfig, devices } from '@playwright/test'

// E2E de navegador contra el STACK REAL. Requiere `docker-compose up` corriendo:
// front en :5173, back en :3000, con el seed de dev cargado (estado determinista,
// UUIDs fijos). No levanta servidores: apunta al stack ya arriba.
//
// Aserciones de montos/impuestos/stock se derivan de docs/features/, NUNCA del output
// del código (ver docs/agent/README.md → riesgo de tests que describen el bug).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/paris.json' },
      dependencies: ['setup'],
    },
  ],
})
