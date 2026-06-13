# practica

Full-stack app built with NestJS, Nuxt 3, and PostgreSQL. Everything runs via Docker Compose — no local Node.js or PostgreSQL required.

## Stack

- **Backend** — NestJS (TypeScript), REST API on port 3000
- **Frontend** — Nuxt 3 (Vue 3), on port 5173
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
