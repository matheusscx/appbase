# Backend — NestJS

API REST del SaaS POS multi-tenant. Corre normalmente vía Docker Compose desde la raíz del repo (ver [README raíz](../README.md)).

## Dev local

```bash
npm install
npm run start:dev   # watch mode en puerto 3000
npm test            # tests unitarios
npm run test:e2e    # tests end-to-end
npm run lint        # lint + auto-fix
```

Requiere las variables de `.env` en la raíz del repo (`DATABASE_URL`, `JWT_SECRET`, etc.).

- Swagger: http://localhost:3000/api/docs
- Arquitectura y convenciones: [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md), [`docs/patterns/backend.md`](../docs/patterns/backend.md)
- Seed de desarrollo: `src/modules/seeder/seeder.service.ts` (corre al arrancar)
