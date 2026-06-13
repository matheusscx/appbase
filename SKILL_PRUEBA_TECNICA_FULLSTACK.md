# 🎯 SKILL: Prueba Técnica Full Stack - NestJS + Nuxt3 + PostgreSQL

**Autor:** Cesar Matheus (Desarrollador Senior)  
**Objetivo:** Preparación y ejecución de prueba técnica full stack  
**Fecha:** Miércoles (próxima semana)  
**Stack Principal:** NestJS + Nuxt3 + PostgreSQL + Docker Compose

---

## 📦 STACK TECNOLÓGICO

### Backend
- **Framework:** NestJS (Node.js + TypeScript)
- **BD:** PostgreSQL
- **ORM:** TypeORM (recomendado en NestJS)
- **Autenticación:** JWT
- **Validación:** class-validator + class-transformer
- **Testing:** Jest
- **Documentación API:** Swagger/OpenAPI

### Frontend
- **Framework:** Nuxt 3 (Vue 3 + SSR + Auto-routing)
- **CSS:** Tailwind CSS
- **State Management:** Pinia (integrado en Nuxt)
- **HTTP Client:** $fetch (built-in) o axios
- **Herramientas:** Vite (incluido en Nuxt)
- **Testing:** Vitest
- **SEO:** Nuxt Meta automático

### DevOps & Infrastructure
- **Contenedores:** Docker & Docker Compose
- **Staging:** Local con docker-compose.yml
- **Variables de entorno:** .env files

---

## 🏗️ ESTRUCTURA RECOMENDADA

### Backend (NestJS)
```
backend/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── modules/
│   │   ├── auth/
│   │   ├── users/
│   │   └── [domain]/
│   ├── common/
│   │   ├── decorators/
│   │   ├── filters/
│   │   ├── guards/
│   │   ├── interceptors/
│   │   └── pipes/
│   └── config/
├── test/
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

### Frontend (Nuxt3)
```
frontend/
├── app.vue                    # Componente raíz
├── nuxt.config.ts            # Configuración de Nuxt
├── pages/                     # Auto-routing (file-based)
│   ├── index.vue             # /
│   └── [slug].vue            # /[slug]
├── components/               # Auto-importados
│   ├── Header.vue
│   ├── Footer.vue
│   └── [...]/
├── layouts/                  # Layouts reutilizables
│   ├── default.vue
│   └── [...]/
├── composables/              # Lógica reutilizable
│   ├── useApi.ts
│   └── [...]/
├── stores/                   # Pinia stores
│   └── [...].ts
├── server/
│   ├── api/                  # Rutas backend (opcional SSR)
│   └── middleware/
├── public/                   # Assets estáticos
├── Dockerfile
└── .env.example
```

---

## ⚙️ DOCKER COMPOSE SETUP

### Configuración Rápida (docker-compose.yml)
```yaml
version: '3.9'
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: ${DB_NAME}
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build: ./backend
    environment:
      DATABASE_URL: postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}
      JWT_SECRET: ${JWT_SECRET}
      NODE_ENV: development
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - ./backend:/app
      - /app/node_modules
    command: npm run start:dev

  frontend:
    build: ./frontend
    ports:
      - "3001:3000"
    volumes:
      - ./frontend:/app
      - /app/node_modules
    environment:
      NUXT_PUBLIC_API_URL: http://localhost:3000/api
    command: npm run dev

volumes:
  postgres_data:
```

---

## 💡 PATRONES Y MEJORES PRÁCTICAS

### Backend (NestJS)
1. **Arquitectura en capas:** Controllers → Services → Repositories → Database
2. **DTOs para validación:** request/response DTOs siempre
3. **Exception Handling:** Custom filters para errores consistentes
4. **Guards & Decorators:** Autenticación y autorización limpia
5. **Migrations:** TypeORM migrations para versionado de BD
6. **Logging:** Logger nativo de NestJS + contexto

### Frontend (Nuxt3)
1. **File-based routing:** Usa carpeta `pages/` para auto-routing
2. **Composables:** Lógica reutilizable en carpeta `composables/`
3. **Auto-imports:** Componentes, composables y stores se importan automáticamente
4. **$fetch:** Usar `$fetch` para llamadas API (SSR-ready)
5. **Pinia:** State management integrado
6. **Layouts:** Reutiliza layouts comunes (default, auth, etc)
7. **Error Handling:** Try-catch en $fetch, user feedback
8. **Responsive Design:** Mobile-first con Tailwind
9. **Accesibilidad:** ARIA labels, semantic HTML

### General
1. **Variables de entorno:** Nunca hardcodear credenciales
2. **CORS:** Configurar correctamente en NestJS
3. **Validación de datos:** Ambos lados (front y back)
4. **Documentación:** README claro + comentarios en código complejo
5. **Git commits:** Mensajes descriptivos

---

## 🧪 CHECKLIST PARA ANTES DE ENTREGAR

### Backend
- [ ] Todos los endpoints funcionan
- [ ] Validación de entrada en controllers
- [ ] Manejo de errores con status codes correctos
- [ ] Tests unitarios de servicios críticos
- [ ] Documentación Swagger/OpenAPI
- [ ] Variables de entorno configuradas
- [ ] Migrations creadas y versionadas
- [ ] CORS habilitado para frontend
- [ ] Autenticación funcionando (si es requerido)

### Frontend (Nuxt)
- [ ] Interfaz responsive (mobile, tablet, desktop)
- [ ] Integración con API backend completa (usando $fetch)
- [ ] Manejo de errores y loading states
- [ ] Tailwind CSS aplicado correctamente
- [ ] Componentes reutilizables en `components/`
- [ ] Composables para lógica compartida
- [ ] Routes file-based en `pages/` funcionando
- [ ] Pinia stores si maneja estado global
- [ ] Performance aceptable (no renderizado innecesario)
- [ ] Console sin errores
- [ ] Variables de entorno en `nuxt.config.ts` (NUXT_PUBLIC_*)
- [ ] Layouts reutilizables si necesita

### DevOps
- [ ] docker-compose.yml sin errores
- [ ] Levanta todo con `docker-compose up` sin problemas
- [ ] Base de datos se inicializa automáticamente
- [ ] Hot reload funcionando en dev
- [ ] Puertos correctos (backend 3000, frontend 3001 via docker)
- [ ] Nuxt build optimizado (no console errors)
- [ ] README con instrucciones de setup

---

## 🎬 WORKFLOW DE LA PRUEBA TÉCNICA

### Fase 1: Análisis (Primeros 15-20 min)
1. Leer completamente el enunciado
2. Identificar: modelos, endpoints, flujos de usuario
3. Dibujar diagrama simple (si ayuda)
4. Listar tareas por prioridad (MVP vs nice-to-have)

### Fase 2: Setup (15-20 min)
1. Crear structure backend/frontend
2. Configurar docker-compose
3. Instalar dependencias
4. Verificar que levanta

### Fase 3: Backend (40-50% del tiempo)
1. Crear modelos/entities
2. Setup database connection
3. Implementar servicios
4. Crear controllers con DTOs
5. Agregar validación
6. Documentar con Swagger

### Fase 4: Frontend (40-50% del tiempo)
1. Setup inicial de Nuxt con Tailwind
2. Crear pages/ con routes necesarias
3. Componentes reutilizables en components/
4. Composables para lógica ($fetch calls, etc)
5. Llamadas a API con $fetch
6. State management con Pinia (si es necesario)
7. Error handling y loading states
8. Responsive design con Tailwind
9. Layouts si es necesario

### Fase 5: Pulimiento (10-15% del tiempo)
1. Testing de flujos completos
2. Fix de bugs encontrados
3. Optimizaciones rápidas
4. README actualizado

---

## 🚀 COMANDOS ÚTILES

```bash
# Levantar todo
docker-compose up

# Reconstruir si hay cambios en Dockerfile
docker-compose up --build

# Ver logs de un servicio específico
docker-compose logs backend -f
docker-compose logs frontend -f

# Acceder a bash del contenedor
docker-compose exec backend sh
docker-compose exec frontend sh

# Ejecutar migrations
docker-compose exec backend npm run typeorm migration:run

# Build Nuxt para producción (dentro del contenedor)
docker-compose exec frontend npm run build

# Detener todo
docker-compose down

# Limpiar volúmenes (PELIGRO: borra datos)
docker-compose down -v

# Desarrollo local (sin Docker)
cd frontend
npm install
npm run dev  # http://localhost:3000 por defecto
```

---

## 📚 RECURSOS Y REFERENCIAS

### NestJS
- Documentación oficial: https://docs.nestjs.com
- TypeORM docs: https://typeorm.io
- Validación: https://github.com/typestack/class-validator

### Nuxt3
- Documentación oficial: https://nuxt.com
- File-based routing: https://nuxt.com/docs/guide/directory-structure
- Composables: https://nuxt.com/docs/guide/directory-structure/composables
- $fetch: https://nuxt.com/docs/api/utils/fetch
- Pinia (integrado): https://pinia.vuejs.org

### Tailwind
- Utility-first CSS: https://tailwindcss.com/docs
- Componentes comunes: https://tailwindui.com

---

## 🎯 MÉTRICAS DE ÉXITO

✅ El proyecto levanta sin errores  
✅ Backend expone API documentada  
✅ Frontend consume API y renderiza datos  
✅ Responde a requerimientos funcionales  
✅ Código limpio y bien estructurado  
✅ UI/UX intuitiva y responsive  
✅ Sin errores en consola/logs  
✅ README claro para replicar setup

---

## 💬 MODO DE TRABAJO DURANTE LA PRUEBA

Cesar, cuando llegue el miércoles:
1. **Comparte el enunciado completo** conmigo
2. Yo analizo y proposino arquitectura
3. **Trabajamos en paralelo:**
   - Tú escribes el código
   - Yo reviso, sugiero, debugueo
   - Iteramos rápido
4. **Si algo falla:** Debugueamos juntos en tiempo real
5. **Optimizamos** en los últimos 15-20 minutos

---

**Última actualización:** [Tu fecha actual]  
**Estado:** ✅ Ready para preparación
