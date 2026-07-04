# startup-app — SaaS POS Multi-tenant

Sistema SaaS de punto de venta y facturación multi-tenant. Full-stack con NestJS, Nuxt 4 y PostgreSQL. Todo corre vía Docker Compose — no requiere Node.js ni PostgreSQL local.

## Stack

- **Backend** — NestJS (TypeScript), REST API on port 3000
- **Frontend** — Nuxt 4 (Vue 3), on port 5173
- **Database** — PostgreSQL 15

## Getting started

```bash
cp .env.example .env
docker-compose up
```

| Service   | URL                          |
|-----------|------------------------------|
| Frontend  | http://localhost:5173        |
| API       | http://localhost:3000/api    |
| API Docs  | http://localhost:3000/api/docs |

## Dev seed users

All users share the password **`admin`**.

| Role | Email | Tenant | Notes |
|------|-------|--------|-------|
| Superadmin | `admin@sistema.com` | Paris, Falabella | `es_superadmin = true`, acceso a rutas `/admin/*` |
| Admin tenant | `admin.paris@paris.cl` | Paris | Rol Administrador (fijo) |
| Usuario regular | `vendedor@paris.cl` | Paris | Rol Vendedor |

## Common commands

```bash
# Rebuild after changing Dockerfile or package.json
docker-compose up --build

# Reset everything (wipes DB)
docker-compose down -v && docker-compose up

# Run commands inside a container
docker-compose exec backend sh
docker-compose exec postgres psql -U dev_user -d tecnica_db
```

## Documentación

- [`docs/README.md`](./docs/README.md) — índice de documentación técnica (arquitectura, ADRs, features)
- [`CLAUDE.md`](./CLAUDE.md) — convenciones de código y estado del proyecto
