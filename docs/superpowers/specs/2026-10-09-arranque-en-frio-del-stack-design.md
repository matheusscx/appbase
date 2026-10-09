# Spec: el arranque en frío del stack de un worktree

**Date**: 2026-10-09 · **Owner**: frente lanzado por la orquestadora · Cierra dos entradas de
`pendientes.md` § 2 (entorno de desarrollo).

## Problema

1. **El frontend se reinicia en el primer `up`**: `nuxt dev` falla con `ENOENT` al escribir
   `.nuxt/nuxt-fonts-global.css`. La carpeta `frontend/` está bind-mounteada en `/app`, así que
   el `.nuxt` del contenedor **es** el del host, y el host también lo escribe: el `nuxt prepare`
   del postinstall de `npm ci`, typecheck, vitest.
2. **`auth.setup` cae a los 30 s en el spinner de `/login`**. En dev la SPA no está construida:
   Vite transforma a pedido los ~1000 módulos del primer `/login`, y cada `reset-db.sh` recrea el
   contenedor y lo vuelve a enfriar. Con el host cargado, eso pasa del timeout.

## Diseño

- **`.nuxt` propio del contenedor:** un volumen anónimo `/app/.nuxt`, con el mismo patrón que ya
  usa `/app/node_modules`. Así el host y el contenedor no escriben el mismo directorio. Afecta solo
  a desarrollo: Railway usa `Dockerfile.prod` y CI usa el `webServer`.
- **Presupuesto explícito para el primer test:** `setup.setTimeout(120_000)` en `auth.setup`, que
  es la primera página de la suite y la que compila el shell. Los specs siguen con 30 s.
- **Descartado: precalentar Vite** (`server.warmup.clientFiles` o un navegador en `reset-db.sh`).
  Le cobraría CPU y memoria en cada arranque a todo el que use el stack, en una VM que ya tuvo OOM,
  para ahorrar unos segundos solo a Playwright.

## Criterio de cierre

Medido con un solo stack nuestro arriba, el load anotado, y RC y `OOMKilled` antes y después:

- reinicios del frontend sin el arreglo contra con el arreglo, en el orden que lo dispara;
- el primer `/login` en frío con distintas cargas, y si una 2ª corrida sola alcanza;
- `auth.setup` en frío y con carga, antes y después del arreglo.
