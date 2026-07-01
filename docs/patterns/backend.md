# Backend Patterns — Playbook

**Status**: Living
**Last Updated**: 2026-06-22

Patrón de referencia para construir un módulo de feature en el backend (NestJS +
TypeORM). Está extraído del código real más reciente (`modules/monedas/`,
`modules/tenants/`). **Léelo antes de planificar una feature** para no re-escanear
el repo: aquí está el esqueleto, los guards, las entities, los DTOs, el SQL raw y
el seeding, listos para copiar y adaptar.

> Convenciones transversales obligatorias (no repetidas en cada sección):
> - **Soft delete en todo**: `@DeleteDateColumn({ name: 'eliminado_el' })`; toda
>   lectura filtra `eliminado_el IS NULL` (o `eliminadoEl: IsNull()`).
> - **`type: 'uuid'` explícito** en toda columna PK/FK de UUID ([ADR-004](../adr/004-uuid-column-types.md)).
> - **`tenant_id` siempre del token** (`req.user.tenantId`), nunca del body.
> - **Decimal.js / `numeric`** para dinero y porcentajes; nunca `number` nativo.
>   Porcentajes en decimal (`0.19` = 19%).

---

## 1. Esqueleto de un módulo

```
backend/src/modules/<feature>/
├── entities/
│   └── <feature>.entity.ts
├── dto/
│   ├── create-<feature>.dto.ts
│   └── update-<feature>.dto.ts
├── <feature>.service.ts
├── <feature>.service.spec.ts      # tests unitarios junto al service (TDD)
├── <feature>.controller.ts
└── <feature>.module.ts
```

Registrar el módulo y sus entities en `app.module.ts`:
- agregar la(s) entity(ies) al array `entities` del `TypeOrmModule.forRoot`,
- agregar `<Feature>Module` al array `imports`.

---

## 2. Entity

### PK simple (tabla con id propio)
Mirar `modules/tenants/entities/tenant.entity.ts`: `@PrimaryGeneratedColumn('uuid')`
+ columnas `@Column`, `@CreateDateColumn({ name: 'creado_el' })`,
`@UpdateDateColumn({ name: 'actualizado_el' })`, `@DeleteDateColumn({ name: 'eliminado_el' })`.

### PK compuesta (tabla puente / por tenant)
De `modules/monedas/entities/tenant-moneda.entity.ts`:

```typescript
@Entity('tenant_moneda')
export class TenantMoneda {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @PrimaryColumn({ name: 'moneda_id', type: 'uuid' })
  monedaId: string;

  @Column({ name: 'es_default', default: false })
  esDefault: boolean;

  @Column({ default: false })
  habilitada: boolean;

  @Column({
    name: 'valor_del_dia',
    type: 'numeric', precision: 18, scale: 6, nullable: true,
  })
  valorDelDia: string | null; // numeric ↦ string en JS, usar Decimal.js para operar

  @CreateDateColumn({ name: 'creado_el' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el' }) actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el' }) eliminadoEl: Date | null;
}
```

Notas:
- Nombres de columna DB en `snake_case` vía `name:`; propiedades en `camelCase`.
- `numeric` se mapea a `string` en JS — no operar con `+`/`*`, usar Decimal.js.

---

## 3. DTO

`class-validator` con `ValidationPipe` global (`main.ts`). Campos opcionales en
update con `@IsOptional()`. De `dto/update-tenant-moneda.dto.ts`:

```typescript
export class UpdateTenantMonedaDto {
  @IsOptional() @IsBoolean()
  habilitada?: boolean;

  @IsOptional() @IsNumberString()   // numeric llega como string
  valorDelDia?: string;
}
```

> **Contrato con el frontend:** `@IsNumberString` exige un **string** (`"10.50"`), no un
> `number`. El cliente lo maneja como string de punta a punta con `UInput`
> `inputmode="decimal"` (nunca `type="number"`) — ver [frontend.md §7](./frontend.md).
> Mandar un `number` (típico de `UInput type="number"`) produce `400 "X must be a number string"`.

---

## 4. Controller — guards y `tenantId` del token

Patrón de tres guards: `JwtAuthGuard` (autenticado) + `TenantGuard` (pertenece al
tenant activo) en toda la clase; `TenantAdminGuard` (es admin del tenant) solo en
mutaciones. Los guards `Tenant*` los exporta `CommonModule` (`@Global`), así que
**no hay que importar nada extra** para usarlos. De `monedas.controller.ts`:

```typescript
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('monedas')
export class MonedasController {
  constructor(private readonly monedasService: MonedasService) {}

  @Get()
  findMonedas(@Req() req: Request) {
    const user = req.user as { tenantId: string };
    return this.monedasService.findMonedas(user.tenantId);
  }

  @UseGuards(TenantAdminGuard)         // solo admin
  @Patch(':monedaId')
  updateMoneda(
    @Req() req: Request,
    @Param('monedaId') monedaId: string,
    @Body() dto: UpdateTenantMonedaDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.monedasService.updateMoneda(user.tenantId, monedaId, dto);
  }
}
```

**Guards disponibles** (`src/common/guards/`, todos vía `CommonModule` global):

| Guard | Verifica | Imports en `@nestjs` |
|---|---|---|
| `JwtAuthGuard` | token válido | `../auth/guards/jwt-auth.guard` |
| `TenantGuard` | membresía en el tenant del token | `../../common/guards/tenant.guard` |
| `TenantAdminGuard` | rol admin (fijo) en el tenant | `../../common/guards/tenant-admin.guard` |

> Si en el futuro hay un permiso RBAC granular para la feature, migrar de
> `TenantAdminGuard` a un guard `@RequiresPermiso(...)`. Por ahora el estándar de
> las pantallas de configuración es `TenantAdminGuard`.

---

## 5. Module

```typescript
@Module({
  imports: [TypeOrmModule.forFeature([TenantMoneda, PaisMoneda])],
  controllers: [MonedasController],
  providers: [MonedasService],
  exports: [MonedasService],
})
export class MonedasModule {}
```

`forFeature([...])` con las entities que el service inyecta vía repositorio. No se
importa `RbacModule` ni `CommonModule` (los guards son globales).

---

## 6. Service

### Lectura con SQL raw (joins multi-tabla)
Cuando necesitas joins que cruzan país/provincia/tenant, usar `dataSource.query`
con parámetros posicionales (`$1`), filtrando `eliminado_el IS NULL` en cada join,
y mapear las filas `snake_case` → objeto `camelCase`. Ver
`monedas.service.ts → findMonedas`:

```typescript
const rows: {...}[] = await this.dataSource.query(
  `SELECT m.moneda_id, ...,
          (m.moneda_id = p.moneda_oficial_id) AS es_oficial
   FROM tenants t
   JOIN provincia prov ON prov.provincia_id = t.provincia_id AND prov.eliminado_el IS NULL
   JOIN pais p        ON p.pais_id = prov.pais_id          AND p.eliminado_el IS NULL
   LEFT JOIN tenant_moneda tm ON tm.tenant_id = t.tenant_id
        AND tm.moneda_id = m.moneda_id AND tm.eliminado_el IS NULL
   WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL
   ORDER BY es_oficial DESC, m.nombre ASC`,
  [tenantId],
);
return rows.map((r) => ({ monedaId: r.moneda_id, /* ... */ }));
```

### Mutación con transacción (regla "solo uno")
Patrón `setDefault`/`setPreferida`: dentro de `dataSource.transaction`, limpiar el
flag de todos (`UPDATE ... SET x = false WHERE tenant_id = $1 AND eliminado_el IS NULL`)
y marcar el nuevo. Validar precondiciones (p. ej. que esté habilitada) antes.

### Upsert con restauración de soft-deleted
Para "habilitar por primera vez" cuando la fila puede existir borrada:

```typescript
const existing = await manager.findOne(TenantMoneda, {
  where: { tenantId, monedaId },
  withDeleted: true,            // incluye soft-deleted
});
if (existing) { existing.eliminadoEl = null; return existing; } // restaurar
return manager.create(TenantMoneda, { tenantId, monedaId, /* defaults */ });
```

### Errores de negocio
`BadRequestException` para reglas de negocio violadas (mensaje en español, se
muestra tal cual en el frontend), `NotFoundException` cuando el recurso no aplica
al tenant/país. Esos `message` los lee el frontend desde `e.data.message`.

---

## 7. Tests (TDD, junto al service)

`<feature>.service.spec.ts` con mocks de repositorio + `DataSource`. Claves vistas
en `monedas.service.spec.ts`:
- `getRepositoryToken(Entity)` para el repo, `getDataSourceToken()` para el DataSource.
- Mockear `dataSource.query` (lecturas directas) **y** `dataSource.manager.query`/
  `.findOne`/`.create`/`.save` (lo que usan `resolveContexto`/`upsert` dentro del
  manager). `transaction` se mockea como `(cb) => cb(managerMock)`.
- Un test por regla de negocio (rechazos incluidos) + el happy path del upsert.

Correr: `cd backend && npm test`. Antes de cerrar: `npm test`, `tsc` limpio,
`npm run lint`.

---

## 8. Seeding

Dos lugares, ambos en el **mismo commit**:

1. **Al crear el tenant** (`tenants.service.ts → create()`, dentro de la transacción
   que ya siembra rol admin + fórmula de precio + caja virtual): agregar el dato que
   todo tenant nuevo necesita (p. ej. su moneda oficial habilitada + default).

2. **Seeder de desarrollo** (`modules/seeder/seeder.service.ts` — **fuente de
   verdad**): un método privado `seed<Entidad>()` idempotente,
   llamado en `onApplicationBootstrap` en el orden correcto (después de sus
   dependencias). IDs fijos con patrón `550e8400-e29b-41d4-a716-446655440XXX`
   (siguiente número libre); las tablas de PK compuesta no necesitan ID fijo.
   Registrar la entity en `seeder.module.ts` (`forFeature`).

El seeder TS corre automáticamente al arrancar el backend en dev.

---

## 10. Paginación server-side

Patrón estándar para listados con muchos registros (pagos, ventas, kardex, etc.).

### DTO compartido

`common/dto/pagination-query.dto.ts` — query params `page` (1-based, default 1) y
`pageSize` (default 15, max 100). Extender en el DTO del recurso:

```typescript
export class QueryPagosDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(EstadoVenta)
  ventaEstado?: EstadoVenta;
  // …filtros específicos
}
```

### Utilidades

`common/utils/pagination.util.ts`:

- `resolvePagination(query)` → `{ page, pageSize, offset }`
- `buildPaginationMeta(page, pageSize, total)` → `{ page, pageSize, total, totalPages }`

### Respuesta API

`common/interfaces/paginated-response.interface.ts`:

```typescript
interface PaginatedResponse<T> {
  data: T[];
  meta: { page; pageSize; total; totalPages };
}
```

### Service (SQL raw)

1. Armar `WHERE` compartido (tenant + soft delete + filtros).
2. `SELECT COUNT(*) …` con el mismo `WHERE` → `total`.
3. `SELECT … ORDER BY … LIMIT $n OFFSET $m` → `data`.
4. Lecturas vía `this.dataSource.query` (réplica cuando exista).

KPIs/agregados globales **no** van en `data[]`: endpoint separado
(p. ej. `GET /pagos/resumen`).

### Controller

Registrar rutas estáticas (`/resumen`) **antes** de rutas con params.

---

## 11. Docs vivas a tocar en el mismo commit

- `startup-pos.sql` — agregar las tablas nuevas.
- `docs/features/<feature>.md` (desde `docs/features/TEMPLATE.md`) + link en `docs/README.md`.
- `docs/MIGRACION-FUNCIONALIDADES.md` y tabla "Estado actual" de `CLAUDE.md` — marcar ✅.
- ADR nuevo en `docs/adr/` (+ índice) si hubo una decisión arquitectónica.

Ver [frontend.md](./frontend.md) para la capa de UI.
