# ========================================
# Frontend Dockerfile - Vue3 + Vite Development
# ========================================

FROM node:22-alpine

WORKDIR /app

# Instalar pnpm (opcional)
RUN npm install -g pnpm

# Copiar package files
COPY package*.json ./

# Instalar dependencias
RUN npm install

# Copiar código fuente
COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host"]
