# SKILL: Setup Full Stack - NestJS + Nuxt3 + PostgreSQL + Docker

**Stack:** NestJS + Nuxt3 + PostgreSQL + Docker Compose

---

## STACK

### Backend
- NestJS (TypeScript)
- PostgreSQL + TypeORM
- JWT para autenticación
- class-validator para validación
- Swagger para documentación

### Frontend
- Nuxt 3 con Composition API
- Tailwind CSS
- Pinia para state management
- $fetch para llamadas API

### Infrastructure
- Todo dockerizado con Docker Compose
- Variables de entorno via .env

---

## SETUP DESDE CERO

### 1. Backend
- Crear proyecto con `nest new`
- Instalar dependencias: TypeORM, pg, class-validator, JWT, Swagger
- Crear `src/config/database.config.ts`
- Configurar `app.module.ts` con TypeORM y ConfigModule
- Configurar `main.ts`: CORS, ValidationPipe global, Swagger en `/api/docs`

### 2. Frontend
- Crear proyecto con `npm create nuxt@latest`
- Instalar y configurar Tailwind CSS
- Configurar `nuxt.config.ts` con runtimeConfig para URL del API
- Crear `pages/` para routing, `components/` y `composables/`

### 3. Docker
- Dockerfile para backend
- Dockerfile para frontend
- `docker-compose.yml` en raíz con tres servicios: postgres, backend, frontend
- Healthcheck en postgres, backend depende de postgres
- `.env` y `.env.example` en raíz

---

## CHECKLIST ANTES DE CONTINUAR

- [ ] Backend levanta y Swagger accesible en `http://localhost:3000/api/docs`
- [ ] Frontend accesible en `http://localhost:3001`
- [ ] PostgreSQL healthy
- [ ] CORS configurado correctamente
- [ ] Hot reload funcionando en ambos
- [ ] `docker-compose up` levanta todo sin errores

---

## CHECKLIST ANTES DE ENTREGAR

### Backend
- [ ] Todos los endpoints funcionan y responden status codes correctos
- [ ] Validación de entrada en todos los controllers
- [ ] Manejo de errores consistente
- [ ] Tests unitarios en servicios críticos
- [ ] Swagger documentado
- [ ] CORS habilitado para el frontend
- [ ] Migrations versionadas (no usar synchronize en producción)

### Frontend
- [ ] Interfaz responsive (mobile, tablet, desktop)
- [ ] Integración completa con API
- [ ] Loading states y manejo de errores visible al usuario
- [ ] Componentes reutilizables
- [ ] Sin errores en consola

### DevOps
- [ ] `docker-compose up` levanta todo sin intervención manual
- [ ] BD se inicializa automáticamente
- [ ] Variables de entorno documentadas en `.env.example`
- [ ] README con instrucciones de setup

---

**Última actualización:** 2026-06-13
