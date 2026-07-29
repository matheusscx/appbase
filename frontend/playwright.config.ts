import { defineConfig, devices } from '@playwright/test'

// E2E de navegador contra el STACK REAL. En local requiere `docker-compose up` corriendo:
// front en :5173, back en :3000, con el seed de dev cargado (estado determinista,
// UUIDs fijos). En CI no hay compose: `webServer` levanta los dos servidores.
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
  // En CI no hay compose: Playwright arranca los dos servidores y espera a que respondan.
  // El backend siembra la base en `OnApplicationBootstrap`, y Nest corre ese hook ANTES
  // de abrir el puerto, así que "responde" ya implica "seed terminado" — sin esperas fijas.
  // En local no se define nada: sigue apuntando al `docker-compose up` que ya corre el dev.
  webServer: process.env.CI
    ? [
        {
          command: 'node dist/main',
          cwd: '../backend',
          url: 'http://localhost:3000/api/docs',
          timeout: 120_000,
          reuseExistingServer: false,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        {
          command: 'node .output/server/index.mjs',
          url: 'http://localhost:5173',
          env: { PORT: '5173' },
          timeout: 120_000,
          reuseExistingServer: false,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      ]
    : undefined,
})
