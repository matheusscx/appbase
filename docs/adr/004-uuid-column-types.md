# ADR-004: Declarar `type: 'uuid'` explícito en todas las columnas PK y FK de UUID en entidades TypeORM

**Status**: Accepted  
**Date**: 2026-06-21

## Context

En dev, `synchronize: true` genera el esquema de BD directamente desde las entidades TypeORM. Cuando una propiedad `string` no declara `type`, TypeORM la mapea a `character varying` en PostgreSQL.

El problema ocurre cuando:
- Un PK está declarado con `@PrimaryGeneratedColumn('uuid')` → columna `uuid` en la BD.
- Una FK en otra tabla está declarada con `@PrimaryColumn({ name: '...' })` o `@Column({ type: 'varchar' })` → columna `character varying` en la BD.
- Un JOIN en SQL raw entre ambas columnas falla con error de tipos (`uuid = character varying`), porque PostgreSQL no hace coerción implícita entre esos dos tipos.

Este bug surgió en `getMyTenants` (join `tenants.tenant_id uuid` ↔ `usuarios_tenants.tenant_id character varying`) y afectaba también a `roles`, `roles_usuarios`, `modulos_roles`, `roles_permisos_modulos`, `refresh_tokens`, `cajas`, `tenant_formula_precio` y `tenant_modulos`.

## Decision

Toda columna PK o FK que almacene un UUID **debe** declarar `type: 'uuid'` explícitamente en el decorador de TypeORM, sin excepción.

```typescript
// PKs compuestos
@PrimaryColumn({ name: 'tenant_id', type: 'uuid' })

// FKs regulares
@Column({ name: 'usuario_id', type: 'uuid', nullable: true })

// PKs auto-generados — ya están bien por convención
@PrimaryGeneratedColumn('uuid', { name: 'tenant_id' })
```

**Excepción única**: `google_id` es el identificador externo de Google OAuth y es legítimamente `varchar`.

## Consequences

**Positive**
- El esquema generado en dev es idéntico en tipos a lo que se espera en producción.
- Los JOINs en SQL raw funcionan sin casts (`::uuid`, `::text`).
- No se necesitan workarounds en queries cuando ambos lados del JOIN son `uuid`.

**Negative**
- Requiere disciplina en cada nueva entidad: no hay comprobación automática en tiempo de compilación. Un `@PrimaryColumn({ name: '...' })` sin `type: 'uuid'` pasa tsc sin error.

**Neutral**
- Al recrear la BD (`docker-compose down -v && up --build`), TypeORM re-genera el esquema correctamente desde las entidades corregidas.

## How to verify

```bash
# Comprobar que no quedan columnas _id declaradas como character varying
docker exec tecnica_postgres psql -U dev_user -d tecnica_db -t -c "
SELECT table_name||'.'||column_name||' = '||data_type
FROM information_schema.columns
WHERE column_name LIKE '%\_id'
  AND table_schema = 'public'
  AND data_type != 'uuid'
ORDER BY table_name;"
# Debe devolver solo google_id (varchar legítimo)
```

## Related

- [ARCHITECTURE.md — UUID columns in TypeORM entities](../ARCHITECTURE.md#uuid-columns-in-typeorm-entities)
- [ADR-001](./001-jwt-auth.md) — JWT auth (usa usuario_id/tenant_id en tokens)
