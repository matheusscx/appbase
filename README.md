# 🚀 Prueba Técnica Full Stack - NestJS + Vue3 + PostgreSQL

Proyecto template optimizado para desarrollo rápido y eficiente.

## 📋 Requisitos

- Docker & Docker Compose (versión 3.9+)
- Git

**No necesitas instalar Node.js, npm, ni PostgreSQL localmente - todo está en Docker!**

## 🚀 Inicio Rápido

### 1️⃣ Clonar/Crear el proyecto

```bash
# Si clonas desde git
git clone <tu-repo>
cd tecnica-fullstack

# O crear desde cero
mkdir tecnica-fullstack && cd tecnica-fullstack
```

### 2️⃣ Configurar variables de entorno

```bash
cp .env.example .env
# Editar .env si lo deseas, pero los defaults funcionan
```

### 3️⃣ Levantar los servicios

```bash
docker-compose up
```

**Espera a ver:**
```
postgres    | database system is ready to accept connections
backend     | [Nest] 12345 - MM/DD/YYYY, HH:MM:SS AM     LOG [NestFactory] Nest application successfully started
frontend    | ➜  Local:   http://localhost:5173/
```

### 4️⃣ Acceder a la aplicación

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:3000/api
- **Swagger (API Docs):** http://localhost:3000/api/docs (si está configurado)
- **PostgreSQL:** localhost:5432

---

## 📁 Estructura del Proyecto

```
tecnica-fullstack/
├── backend/                    # NestJS application
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   └── modules/
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
├── frontend/                   # Vue3 application
│   ├── src/
│   │   ├── main.js
│   │   ├── App.vue
│   │   ├── components/
│   │   └── pages/
│   ├── package.json
│   ├── vite.config.js
│   └── Dockerfile
├── docker-compose.yml
├── .env.example
├── .env
└── README.md
```

---

## 🛠️ Comandos Útiles

### Levantar/Parar servicios

```bash
# Levantar en background
docker-compose up -d

# Ver logs en tiempo real
docker-compose logs -f

# Ver logs de un servicio específico
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f postgres

# Parar todos los servicios
docker-compose down

# Parar y eliminar volúmenes (⚠️ borra datos de BD)
docker-compose down -v
```

### Trabajar dentro de los contenedores

```bash
# Abrir bash del backend
docker-compose exec backend sh

# Instalar nuevas dependencias en backend
docker-compose exec backend npm install <package-name>

# Ejecutar migraciones (si usas TypeORM)
docker-compose exec backend npm run typeorm migration:run

# Abrir bash del frontend
docker-compose exec frontend sh

# Ejecutar comandos en postgres
docker-compose exec postgres psql -U dev_user -d tecnica_db
```

### Recontruir imágenes

```bash
# Reconstruir si cambiaste Dockerfile o package.json
docker-compose up --build

# Reconstruir solo un servicio
docker-compose up --build backend
docker-compose up --build frontend
```

### Desarrollo

```bash
# Hot reload está habilitado por defecto
# Cualquier cambio en src/ se refleja inmediatamente

# Para resetear todo a estado limpio
docker-compose down -v && docker-compose up
```

---

## 🔧 Configuración de Servicios

### Backend (NestJS)
- Puerto: **3000**
- Hot reload: ✅ Habilitado
- TypeScript: ✅ Compilación automática
- Variables: `.env`

### Frontend (Vue3)
- Puerto: **5173**
- Hot reload: ✅ Habilitado
- Vite: ✅ Super rápido
- Variables: `.env` → `VITE_` prefix

### PostgreSQL
- Host: **postgres** (dentro de Docker)
- Host (local): **localhost**
- Puerto: **5432**
- Usuario: **dev_user**
- Password: **dev_password_123**
- BD: **tecnica_db**

---

## 🐛 Troubleshooting

### "Cannot connect to Docker daemon"
```bash
# Asegúrate que Docker está corriendo
sudo systemctl start docker  # Linux
# o abre Docker Desktop en Mac/Windows
```

### "Port already in use"
```bash
# Si el puerto 5173 o 3000 está ocupado, edita docker-compose.yml
# Cambia "5173:5173" a "5174:5173" por ejemplo
```

### "postgres: database system is in recovery mode"
```bash
# Espera un poco más o reinicia
docker-compose down -v && docker-compose up
```

### "npm ERR! Cannot find module"
```bash
# Reinstala dependencias
docker-compose down -v
docker-compose up --build
```

### "ECONNREFUSED: Connection refused to database"
```bash
# Asegúrate que postgres está healthy
docker-compose ps
# Debería mostrar postgres como "healthy"
# Si no, espera un poco y reintenta
```

---

## 📚 Stack Detallado

### Backend
- **NestJS** - Framework moderno para Node.js
- **TypeORM** - ORM para bases de datos
- **PostgreSQL** - Base de datos relacional
- **JWT** - Autenticación
- **Swagger** - Documentación de API
- **Jest** - Testing

### Frontend
- **Vue 3** - Framework progresivo
- **Composition API** - Lógica reactiva moderna
- **Vite** - Build tool ultra rápido
- **Tailwind CSS** - Utility-first CSS
- **Pinia** - State management (opcional)
- **Axios** - HTTP client

---

## 📝 Próximos Pasos

1. **Crea tus módulos en backend/** siguiendo la estructura NestJS
2. **Crea tus componentes en frontend/src/** con Vue3
3. **Define tu schema en database** (migrations o scripts SQL)
4. **Conecta frontend → backend** via API
5. **Test todo** en http://localhost:5173

---

## 💡 Tips para la Prueba Técnica

✅ Usa este template como base  
✅ Levanta todo con `docker-compose up` al empezar  
✅ El hot reload te permite ver cambios al instante  
✅ Cuando termines, simplemente `docker-compose down`  
✅ Sube tu código a Git para mostrar al evaluador  

---

## 🆘 ¿Algo no funciona?

1. Revisa los logs: `docker-compose logs`
2. Reinicia todo: `docker-compose down && docker-compose up`
3. Si es persistente: `docker-compose down -v && docker-compose up --build`

---

**Buena suerte en tu prueba técnica, Cesar! 🎯**

Última actualización: 2024
