# ========================================
# Backend Dockerfile - NestJS Development
# ========================================

FROM node:22-alpine

WORKDIR /app

# Instalar pnpm (opcional, pero recomendado)
RUN npm install -g pnpm

# Copiar package files
COPY package*.json ./

# Instalar dependencias
RUN npm ci

# Copiar código fuente
COPY . .

# Build (si es necesario en dev)
# RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start:dev"]
