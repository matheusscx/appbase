# Documentation

Welcome to the technical documentation for the `practica` project.

## Quick Navigation

### For New Team Members
1. Start with [`ARCHITECTURE.md`](./ARCHITECTURE.md) — understand the stack and overall structure
2. Read the [ADR index](./adr/) — understand key technical decisions and their rationale
3. Review relevant [feature docs](./features/) for the area you're working on

### For Product & Business Rules
- Read [`PRODUCTO.md`](./PRODUCTO.md) — full functional spec and business rules (Spanish)
- Track progress in [`MIGRACION-FUNCIONALIDADES.md`](./MIGRACION-FUNCIONALIDADES.md) — feature migration plan (Spanish)

### For Feature Development
- Read [`QUICK-START.md`](./QUICK-START.md) — how to document a feature in ~10 minutes
- Use [`features/TEMPLATE.md`](./features/TEMPLATE.md) as a template when documenting a new feature
- Check existing feature docs in [`features/`](./features/) for examples

### For Architecture Decisions
- Browse all decisions in [`adr/`](./adr/)
- Read [ADR-001](./adr/001-jwt-auth.md) and [ADR-002](./adr/002-google-oauth.md) to understand the auth system

---

## Documentation Index

### Architecture
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — System overview, stack, module structure, conventions
- **[CONVENTIONS.md](./CONVENTIONS.md)** — Coding, naming and documentation standards

### Product
- **[PRODUCTO.md](./PRODUCTO.md)** — Complete functional spec with business rules (Spanish)
- **[MIGRACION-FUNCIONALIDADES.md](./MIGRACION-FUNCIONALIDADES.md)** — Feature migration plan and tracking (Spanish)

### Architecture Decision Records
- **[adr/README.md](./adr/)** — Index of all architectural decisions
  - [ADR-001: JWT Authentication](./adr/001-jwt-auth.md)
  - [ADR-002: Google OAuth 2.0](./adr/002-google-oauth.md)
  - [ADR-003: JWT decode en cliente + patrón híbrido JWT/store](./adr/003-jwt-decode-client.md)

### Features
- **[QUICK-START.md](./QUICK-START.md)** — How to document a feature
- **[features/TEMPLATE.md](./features/TEMPLATE.md)** — Template for documenting new features
- **[features/auth.md](./features/auth.md)** — Authentication feature (JWT + Google OAuth)
- **[features/frontend-multitenant.md](./features/frontend-multitenant.md)** — Flujo multi-tenant en frontend (selección de tenant)
- **[features/test-permisos.md](./features/test-permisos.md)** — Módulo Test para validación RBAC end-to-end

### Engineering Notes (superpowers)
- **[superpowers/plans/](./superpowers/plans/)** — Implementation plans
- **[superpowers/specs/](./superpowers/specs/)** — Design specs

---

## Documentation Standards

### Architecture Decision Records (ADRs)

Use ADRs to document **why** we made important technical choices, not just **what** we chose.

**Format**: [Michael Nygard's ADR template](https://github.com/joelparkerhenderson/architecture_decision_record)
- **Status**: Accepted / Proposed / Deprecated / Superseded
- **Context**: What problem are we solving?
- **Decision**: What did we choose?
- **Consequences**: What are the trade-offs?

**When to create**: Framework choices, database schema decisions, auth approaches, performance trade-offs
**When NOT to create**: Bug fixes, refactoring, implementation details

See [`adr/README.md`](./adr/) for detailed guidelines.

### Feature Documentation

Use feature docs to explain **how** a feature works end-to-end.

**Format**: See [`features/TEMPLATE.md`](./features/TEMPLATE.md)
- **Overview**: What is it and why does it exist?
- **API Endpoints**: List all REST endpoints
- **Backend**: Modules, entities, services, DTOs
- **Frontend**: Pages, components, stores
- **Data Flow**: Diagrams and examples
- **Testing**: How to test this feature
- **Known Issues**: TODOs and limitations

**When to create**: Any user-facing feature (auth, user management, etc.)

---

## Project Structure

```
docs/
├── README.md                      # This file — documentation index
├── ARCHITECTURE.md                # System architecture and conventions
├── CONVENTIONS.md                 # Coding, naming and documentation standards
├── QUICK-START.md                 # How to document a feature
├── PRODUCTO.md                    # Functional spec & business rules (ES)
├── MIGRACION-FUNCIONALIDADES.md   # Feature migration plan & tracking (ES)
├── adr/                           # Architecture Decision Records
│   ├── README.md                  # ADR index and guidelines
│   ├── 001-jwt-auth.md
│   └── 002-google-oauth.md
├── features/                      # Feature documentation
│   ├── TEMPLATE.md                # Template for new features
│   ├── auth.md                    # Authentication feature
│   ├── frontend-multitenant.md    # Frontend multi-tenant flow
│   └── test-permisos.md           # RBAC test module
└── superpowers/                   # Engineering plans & design specs
    ├── plans/
    └── specs/
```

---

## Writing & Maintenance

### Before writing documentation
1. Check if docs already exist for this area
2. Update existing docs if they're incomplete; only create new files if necessary
3. Link related docs using relative markdown links

### When updating
- Keep docs in sync with code changes
- Mark incomplete sections with `TODO:` or `WIP:`
- Link to ADRs when explaining design decisions
- Include examples: code snippets, curl commands, data flow diagrams

### Outdated docs
If you find docs that are wrong or outdated:
1. Fix them immediately (or create an issue)
2. Update the "Last Updated" date field
3. Add a note about what changed

---

## Related Resources

- **Code**: `/backend/src/` and `/frontend/app/`
- **Configuration**: `.env.example`, `docker-compose.yml`
- **API Docs**: http://localhost:3000/api/docs (Swagger, auto-generated)
- **Main README**: [`../README.md`](../README.md) — Getting started, commands, quick reference
- **CLAUDE.md**: [`../CLAUDE.md`](../CLAUDE.md) — Claude Code integration guide
