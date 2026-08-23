---
name: nestjs-best-practices
description: NestJS best practices and architecture patterns for building production-ready applications. This skill should be used when writing, reviewing, or refactoring NestJS code to ensure proper patterns for modules, dependency injection, security, and performance.
license: MIT
metadata:
  author: Kadajett
  version: "1.1.0"
---

# NestJS Best Practices

## ⛔ Overrides de ESTE repo — mandan sobre cualquier regla de abajo

Esta skill es genérica (vendorizada). Donde choque con lo de acá, **gana esto**, y no es
preferencia de estilo: son cosas que este proyecto ya midió, arregló y protegió con lint.

| La skill muestra | En este repo va | Por qué |
|---|---|---|
| `TypeOrmModule.forFeature([X])` | `RepositoriosModule.forFeature([X])` | los repos del pool no resuelven el manager de la transacción activa |
| `dataSource.transaction(fn)` | `db.transaccion(fn)` | reusa la transacción activa en vez de anidar |
| inyectar `DataSource` | inyectar `Db` (`src/common/db/db.service.ts`) | única puerta al acceso a datos fuera de los repos |
| `createQueryRunner()` | no existe acá | nada lo usa; no introducirlo |
| `dataSource.query(sql)` | `db.query(sql, params)` | usa el manager del contexto si hay transacción abierta |

**El deadlock que esto evita está medido, no supuesto** (ADR-020): un service que adentro de
una transacción pide una conexión **nueva** al pool necesita dos conexiones a la vez. Con el
pool en 10, **9 operaciones concurrentes pasan y la décima cuelga para siempre** — no es un
timeout, las requests no vuelven nunca y el proceso queda envenenado hasta reiniciar el
contenedor. Subir el pool no arregla nada: solo mueve el umbral.

**Consecuencia que hay que tener presente al escribir código o un plan:** `@InjectRepository`
acá **no** devuelve el repo del pool — es un `Proxy` que en cada acceso resuelve el manager de
la transacción activa. Por eso **no hace falta pasar `manager` a mano** a un service que se
llama desde adentro de `db.transaccion`; y por eso registrar un módulo con
`TypeOrmModule.forFeature` rompe la garantía **sin que se vea en el constructor de nadie**.

⚠️ **Vale también para los planes de implementación, no solo para el código.** Un plan que
muestre un bloque de módulo, de service o de transacción escrito de memoria propaga el patrón
prohibido a quien lo ejecute. Antes de escribir ese bloque: abrir el archivo real.

📌 El porqué completo, con el experimento y las alternativas descartadas:
[ADR-020](../../../docs/adr/020-contexto-transaccional-als.md) y
[`docs/patterns/backend.md`](../../../docs/patterns/backend.md) §5.

---

Comprehensive best practices guide for NestJS applications. Contains 40 rules across 10 categories, prioritized by impact to guide automated refactoring and code generation.

## When to Apply

Reference these guidelines when:

- Writing new NestJS modules, controllers, or services
- Implementing authentication and authorization
- Reviewing code for architecture and security issues
- Refactoring existing NestJS codebases
- Optimizing performance or database queries
- Building microservices architectures

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Architecture | CRITICAL | `arch-` |
| 2 | Dependency Injection | CRITICAL | `di-` |
| 3 | Error Handling | HIGH | `error-` |
| 4 | Security | HIGH | `security-` |
| 5 | Performance | HIGH | `perf-` |
| 6 | Testing | MEDIUM-HIGH | `test-` |
| 7 | Database & ORM | MEDIUM-HIGH | `db-` |
| 8 | API Design | MEDIUM | `api-` |
| 9 | Microservices | MEDIUM | `micro-` |
| 10 | DevOps & Deployment | LOW-MEDIUM | `devops-` |

## Quick Reference

### 1. Architecture (CRITICAL)

- `arch-avoid-circular-deps` - Avoid circular module dependencies
- `arch-feature-modules` - Organize by feature, not technical layer
- `arch-module-sharing` - Proper module exports/imports, avoid duplicate providers
- `arch-single-responsibility` - Focused services over "god services"
- `arch-use-repository-pattern` - Abstract database logic for testability
- `arch-use-events` - Event-driven architecture for decoupling

### 2. Dependency Injection (CRITICAL)

- `di-avoid-service-locator` - Avoid service locator anti-pattern
- `di-interface-segregation` - Interface Segregation Principle (ISP)
- `di-liskov-substitution` - Liskov Substitution Principle (LSP)
- `di-prefer-constructor-injection` - Constructor over property injection
- `di-scope-awareness` - Understand singleton/request/transient scopes
- `di-use-interfaces-tokens` - Use injection tokens for interfaces

### 3. Error Handling (HIGH)

- `error-use-exception-filters` - Centralized exception handling
- `error-throw-http-exceptions` - Use NestJS HTTP exceptions
- `error-handle-async-errors` - Handle async errors properly

### 4. Security (HIGH)

- `security-auth-jwt` - Secure JWT authentication
- `security-validate-all-input` - Validate with class-validator
- `security-use-guards` - Authentication and authorization guards
- `security-sanitize-output` - Prevent XSS attacks
- `security-rate-limiting` - Implement rate limiting

### 5. Performance (HIGH)

- `perf-async-hooks` - Proper async lifecycle hooks
- `perf-use-caching` - Implement caching strategies
- `perf-optimize-database` - Optimize database queries
- `perf-lazy-loading` - Lazy load modules for faster startup

### 6. Testing (MEDIUM-HIGH)

- `test-use-testing-module` - Use NestJS testing utilities
- `test-e2e-supertest` - E2E testing with Supertest
- `test-mock-external-services` - Mock external dependencies

### 7. Database & ORM (MEDIUM-HIGH)

- `db-use-transactions` - Transaction management
- `db-avoid-n-plus-one` - Avoid N+1 query problems
- `db-use-migrations` - Use migrations for schema changes

### 8. API Design (MEDIUM)

- `api-use-dto-serialization` - DTO and response serialization
- `api-use-interceptors` - Cross-cutting concerns
- `api-versioning` - API versioning strategies
- `api-use-pipes` - Input transformation with pipes

### 9. Microservices (MEDIUM)

- `micro-use-patterns` - Message and event patterns
- `micro-use-health-checks` - Health checks for orchestration
- `micro-use-queues` - Background job processing

### 10. DevOps & Deployment (LOW-MEDIUM)

- `devops-use-config-module` - Environment configuration
- `devops-use-logging` - Structured logging
- `devops-graceful-shutdown` - Zero-downtime deployments

## How to Use

Read individual rule files for detailed explanations and code examples:

```
rules/arch-avoid-circular-deps.md
rules/security-validate-all-input.md
rules/_sections.md
```

Each rule file contains:
- Brief explanation of why it matters
- Incorrect code example with explanation
- Correct code example with explanation
- Additional context and references

## Full Compiled Document

For the complete guide with all rules expanded: `AGENTS.md`
