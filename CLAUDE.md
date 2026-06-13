# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Full-stack monorepo for a technical assessment. Docker-first development — the entire stack runs via `docker-compose up`. No local Node.js/PostgreSQL required.

- **backend/** — NestJS (TypeScript), REST API on port 3000
- **frontend/** — Nuxt3 (Vue3), SPA/SSR on port 5173
- **PostgreSQL 15** — managed by Docker, port 5432

## Commands

### Full stack (preferred)
```bash
docker-compose up          # Start all services
docker-compose up --build  # Rebuild images first
docker-compose down -v     # Stop and wipe DB volume
```

### Backend only (local dev)
```bash
cd backend
npm run start:dev   # Watch mode
npm test            # Unit tests
npm run test:e2e    # End-to-end tests
npm run lint        # Lint + auto-fix
```

### Frontend only (local dev)
```bash
cd frontend
npm run dev         # Dev server
npm run build       # Production build
```

## Architecture

```
practica/
├── backend/           # NestJS app
│   └── src/
│       ├── main.ts           # Bootstrap: CORS, ValidationPipe, Swagger
│       ├── app.module.ts     # Root module
│       └── modules/          # Feature modules go here
├── frontend/          # Nuxt3 app
│   ├── app/app.vue           # Root component
│   ├── pages/                # File-based routing
│   ├── components/           # Auto-imported components
│   ├── composables/          # Auto-imported composables
│   └── stores/               # Pinia stores
├── docker-compose.yml
├── backend.Dockerfile
├── frontend.Dockerfile
└── .env                      # Copy from .env.example
```

### Port map
| Service   | Host port |
|-----------|-----------|
| Frontend  | 5173      |
| Backend   | 3000      |
| Swagger   | 3000/api/docs |
| PostgreSQL| 5432      |

### Environment
All config via `.env` at repo root (copy `.env.example`). Backend reads `DATABASE_URL`, `JWT_SECRET`, `PORT`, `API_PREFIX`. Frontend reads `VITE_API_URL`.

## Conventions

**Backend modules** — each feature lives in `src/modules/<name>/` with its own controller, service, entity, and DTOs. Register in `app.module.ts`.

**Frontend routing** — file-based via `pages/`. Use `$fetch` for API calls (not axios). Prefix public runtime config vars with `VITE_` in env and access via `useRuntimeConfig().public`.

**Validation** — ValidationPipe is global in `main.ts`; use `class-validator` decorators on all DTOs.
