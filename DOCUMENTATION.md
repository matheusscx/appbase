# Project Documentation

Bienvenido. Toda la documentación técnica del proyecto está organizada en la carpeta `docs/`.

## 📚 Acceso Rápido

| Necesito... | Ir a... |
|-------------|---------|
| Entender el proyecto | [`docs/README.md`](./docs/README.md) |
| Conocer la arquitectura | [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) |
| Entender decisiones de diseño | [`docs/adr/`](./docs/adr/) |
| Documentar una nueva feature | [`docs/QUICK-START.md`](./docs/QUICK-START.md) |
| Ver ejemplo de feature doc | [`docs/features/auth.md`](./docs/features/auth.md) |
| Usar el template | [`docs/features/TEMPLATE.md`](./docs/features/TEMPLATE.md) |
| Convenciones de documentación | [`docs/CONVENTIONS.md`](./docs/CONVENTIONS.md) |

## 🚀 Primeros Pasos (10 minutos)

1. **Lee el índice**: [`docs/README.md`](./docs/README.md)
2. **Comprende la arquitectura**: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
3. **Mira la feature de auth** (ejemplo): [`docs/features/auth.md`](./docs/features/auth.md)

## 📖 Estructura de Documentación

```
docs/
├── README.md              ← Índice y guía de uso
├── ARCHITECTURE.md        ← Diseño del sistema
├── QUICK-START.md         ← Cómo documentar
├── CONVENTIONS.md         ← Estándares y formato
├── adr/                   ← Decisiones arquitectónicas
│   ├── README.md          ← Índice de ADRs
│   ├── 001-jwt-auth.md
│   └── 002-google-oauth.md
└── features/              ← Documentación de funcionalidades
    ├── TEMPLATE.md        ← Template reutilizable
    └── auth.md            ← Ejemplo: Autenticación
```

## ✨ Estándar de Documentación

Usamos dos formatos:

### 1. **Architecture Decision Records (ADR)**
Documenta **por qué** tomamos decisiones técnicas importantes.

Ejemplo: [ADR-001: JWT Authentication](./docs/adr/001-jwt-auth.md)

### 2. **Feature Documentation**
Documenta **cómo** funciona una feature de punta a punta.

Ejemplo: [auth.md](./docs/features/auth.md)

Ver [`docs/README.md`](./docs/README.md) para detalles.

## 🤝 Contribuir a la Documentación

Cuando agregues código nuevo, **también actualiza la documentación**:

1. Para una **nueva feature**:
   - Copia [`docs/features/TEMPLATE.md`](./docs/features/TEMPLATE.md)
   - Completa con tu feature
   - Actualiza [`docs/README.md`](./docs/README.md) para agregar el link

2. Para una **decisión importante**:
   - Crea un nuevo ADR en `docs/adr/`
   - Actualiza [`docs/adr/README.md`](./docs/adr/README.md)

3. Para **cambios arquitectónicos**:
   - Actualiza [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)

Ver [`docs/CONVENTIONS.md`](./docs/CONVENTIONS.md) para reglas de formato.

## 📞 Preguntas?

- **¿Cuándo crear un ADR?** → [`docs/adr/README.md`](./docs/adr/README.md)
- **¿Cómo documentar una feature?** → [`docs/QUICK-START.md`](./docs/QUICK-START.md)
- **¿Qué convenciones usar?** → [`docs/CONVENTIONS.md`](./docs/CONVENTIONS.md)

---

**Última actualización**: 2026-06-13

Ver también: [`README.md`](./README.md) (instrucciones de setup), [`CLAUDE.md`](./CLAUDE.md) (integración con Claude Code)
