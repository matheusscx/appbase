# Frontend — Nuxt 4

SPA/SSR del SaaS POS multi-tenant. Corre normalmente vía Docker Compose desde la raíz del repo (ver [README raíz](../README.md)).

## Dev local

```bash
npm install
npm run dev       # servidor de desarrollo (puerto 5173 vía Docker; 3000 standalone)
npm run build     # build de producción
```

Config vía `VITE_API_URL` y `VITE_APP_NAME` en el `.env` de la raíz.

- Arquitectura y rutas: [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)
- Patrones de páginas/componentes: [`docs/patterns/frontend.md`](../docs/patterns/frontend.md)
- Design system (tokens semánticos Nuxt UI): [`docs/DESIGN-SYSTEM.md`](./docs/DESIGN-SYSTEM.md)
