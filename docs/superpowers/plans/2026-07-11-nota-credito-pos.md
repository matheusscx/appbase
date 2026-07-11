# Plan: Nota de crédito desde el detalle de venta (POS)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status**: Approved
**Date**: 2026-07-11
**Owner**: Cesar Matheus

**Goal:** Crear notas de crédito internas desde el drawer de detalle de venta, con egreso de caja elegible y devolución de stock elegible, gateado por un permiso RBAC dedicado.

**Architecture:** Se reutiliza `VentasService.crearNotaCredito` (nacido del flujo de reembolsos de pasarela) extendiéndolo con dos flags opcionales: `validarVentaElegible` (estado `pagada`/`pagada_parcial`, no-NC — solo lo activa el endpoint nuevo) y `devolverDinero` (movimiento `salida` en la caja física abierta del usuario, dentro de la MISMA transacción — todo-o-nada). Un wrapper público `crearNotaCreditoDesdeVenta` es la única puerta del endpoint `POST /ventas/:id/notas-credito`. El flujo de pasarela no cambia en nada.

**Tech Stack:** NestJS + TypeORM (SQL raw con manager), Decimal.js, class-validator; Nuxt 4 + Nuxt UI v4 + Pinia.

**Spec:** `docs/superpowers/specs/2026-07-11-nota-credito-pos-design.md`

## Global Constraints

- Dinero y porcentajes SIEMPRE con Decimal.js; decimales como string end-to-end.
- `tenant_id` y `usuario_id` siempre del token JWT, nunca del body.
- Soft delete: toda lectura filtra `eliminado_el IS NULL` (excepto `item_producto`, tabla de extensión SIN esas columnas).
- Frontend: `useApiFetch` (nunca `$fetch` directo), `UInput inputmode="decimal"` (nunca `type=number`), tokens semánticos Nuxt UI (`text-muted`, `divide-default`…), arrays inmutables, re-fetch tras mutación, `useFormatters`/`apiErrorMsg`/`shellUi.modal`.
- Trabajar y commitear directo en `main` (etapa de desarrollo, sin ramas).
- Commits terminan con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Corrección al spec: `startup-pos.sql` es solo schema (sin INSERTs) → el permiso nuevo vive solo en el seeder; esta feature NO toca el SQL.
- Todos los comandos backend se corren desde `/Users/m2pro/cmatheus/startup-app/backend`.

---

### Task 1: Seed del permiso `Ventas : Nota de crédito`

**Files:**
- Modify: `backend/src/modules/seeder/seeder.service.ts` (métodos `seedPermisos` ~:396 y `seedModuloAppPermisos` ~:428)

**Interfaces:**
- Produces: permiso `550e8400-e29b-41d4-a716-446655440219` ("Nota de crédito") vinculado al módulo Ventas vía `modulo_app_permisos` `…440220`. El guard `@RequiresPermiso('Ventas', 'Nota de crédito')` (Task 4) y `permissionsStore.can('Ventas', 'Nota de crédito')` (Task 6) dependen de estos nombres EXACTOS. El rol admin fijo no necesita asignación (bypass `es_fijo` en `RbacService.userHasPermiso`); la matriz de roles muestra el permiso automáticamente porque lee `modulo_app_permisos`.

- [ ] **Step 1: Agregar el permiso al catálogo**

En `seedPermisos`, agregar al final del array `permisos` (después de la entrada `Reembolsar` `…440017`):

```typescript
      {
        permisoId: '550e8400-e29b-41d4-a716-446655440219',
        nombre: 'Nota de crédito',
      },
```

- [ ] **Step 2: Vincular el permiso al módulo Ventas**

En `seedModuloAppPermisos`, junto a las constantes existentes (`REEMBOLSAR`, `VENTAS`, …) agregar:

```typescript
    const NOTA_CREDITO = '550e8400-e29b-41d4-a716-446655440219';
```

y al final del array `entries` (después de la entrada Pasarelas+REEMBOLSAR `…440213`):

```typescript
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440220',
        moduloAppId: VENTAS,
        permisoId: NOTA_CREDITO,
      },
```

- [ ] **Step 3: Verificar que el seeder corre y persiste**

El backend en Docker tiene hot reload: al guardar, Nest reinicia y el seeder corre en el arranque. Verificar:

```bash
docker exec tecnica_postgres psql -U dev_user -d tecnica_db -c \
  "SELECT m.nombre AS modulo, p.nombre AS permiso
   FROM modulo_app_permisos map
   JOIN modulos_app m ON m.modulo_app_id = map.modulo_app_id
   JOIN permisos p ON p.permiso_id = map.permiso_id
   WHERE p.permiso_id = '550e8400-e29b-41d4-a716-446655440219';"
```

Esperado: 1 fila `Ventas | Nota de crédito`. (Si el contenedor no recargó, `docker restart tecnica_backend` y esperar ~15s.)

- [ ] **Step 4: Commit**

```bash
git add src/modules/seeder/seeder.service.ts
git commit -m "feat(seeder): permiso dedicado Ventas:Nota de crédito

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: DTO `CreateNotaCreditoDto` (TDD)

**Files:**
- Create: `backend/src/modules/ventas/dto/create-nota-credito.dto.ts`
- Test: `backend/src/modules/ventas/dto/create-nota-credito.dto.spec.ts`

**Interfaces:**
- Produces: `CreateNotaCreditoDto { monto: string; comentario?: string; devolverDinero?: boolean; devoluciones?: DevolucionNotaCreditoDto[] }` y `DevolucionNotaCreditoDto { itemId: string; cantidad: string }`. El controller (Task 4) y el modal (Task 5) usan exactamente estos nombres de campo.

- [ ] **Step 1: Escribir el spec que falla**

Crear `backend/src/modules/ventas/dto/create-nota-credito.dto.spec.ts` (el `import 'reflect-metadata'` en la primera línea es OBLIGATORIO — sin él `@Type` revienta en jest):

```typescript
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateNotaCreditoDto } from './create-nota-credito.dto';

const ITEM_ID = '550e8400-e29b-41d4-a716-446655440116';

describe('CreateNotaCreditoDto', () => {
  it('acepta payload mínimo con solo monto', async () => {
    const dto = plainToInstance(CreateNotaCreditoDto, { monto: '5000' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('acepta payload completo', async () => {
    const dto = plainToInstance(CreateNotaCreditoDto, {
      monto: '5000',
      comentario: 'Devolución cliente',
      devolverDinero: true,
      devoluciones: [{ itemId: ITEM_ID, cantidad: '2' }],
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza monto no numérico', async () => {
    const dto = plainToInstance(CreateNotaCreditoDto, { monto: 'abc' });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'monto')).toBe(true);
  });

  it('rechaza devoluciones con itemId inválido', async () => {
    const dto = plainToInstance(CreateNotaCreditoDto, {
      monto: '5000',
      devoluciones: [{ itemId: 'no-es-uuid', cantidad: '2' }],
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'devoluciones')).toBe(true);
  });

  it('rechaza devolverDinero no booleano', async () => {
    const dto = plainToInstance(CreateNotaCreditoDto, {
      monto: '5000',
      devolverDinero: 'si',
    });
    const errores = await validate(dto);
    expect(errores.some((e) => e.property === 'devolverDinero')).toBe(true);
  });
});
```

- [ ] **Step 2: Verificar que falla**

```bash
npx jest src/modules/ventas/dto/create-nota-credito.dto.spec.ts
```

Esperado: FAIL — `Cannot find module './create-nota-credito.dto'`.

- [ ] **Step 3: Implementar el DTO**

Crear `backend/src/modules/ventas/dto/create-nota-credito.dto.ts`:

```typescript
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class DevolucionNotaCreditoDto {
  @IsUUID()
  itemId: string;

  @IsNumberString()
  cantidad: string;
}

export class CreateNotaCreditoDto {
  @IsNumberString()
  monto: string;

  @IsOptional()
  @IsString()
  comentario?: string;

  /** Registra un movimiento de salida en la caja física abierta del usuario. */
  @IsOptional()
  @IsBoolean()
  devolverDinero?: boolean;

  /** Ítems a devolver a stock (solo modo 'cantidad'), independiente del dinero. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DevolucionNotaCreditoDto)
  devoluciones?: DevolucionNotaCreditoDto[];
}
```

- [ ] **Step 4: Verificar que pasa**

```bash
npx jest src/modules/ventas/dto/create-nota-credito.dto.spec.ts
```

Esperado: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/ventas/dto/create-nota-credito.dto.ts src/modules/ventas/dto/create-nota-credito.dto.spec.ts
git commit -m "feat(ventas): DTO de nota de crédito manual con egreso y devoluciones opcionales

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `crearNotaCreditoDesdeVenta` — elegibilidad + egreso de caja (TDD)

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.ts` (imports :1-7, `crearNotaCredito` :362-454, `lockVentaOriginal` :497-525; línea nueva tras :454 para el wrapper)
- Test: `backend/src/modules/ventas/ventas.service.spec.ts` (mock de CajaService :132-138, `ventaOriginalRow` :315-322, tests nuevos dentro del describe :310)

**Interfaces:**
- Consumes: `CajaService.findActiva(tenantId, usuarioId): Promise<Caja | null>`, `CajaService.calcularSaldoEsperado(cajaId, manager): Promise<string>`, `CajaService.registrarMovimientoEnTransaccion(manager, { cajaId, tipo, concepto, monto, ventaId }): Promise<MovimientoCaja>` — ya inyectado como `this.cajaService`.
- Produces: `crearNotaCreditoDesdeVenta(params: { tenantId: string; usuarioId: string; ventaOriginalId: string; monto: string; devoluciones?: DevolucionReembolso[]; comentario?: string; devolverDinero?: boolean }): Promise<{ id: string; totalFinal: string; movimientoCajaId: string | null }>` — lo consume el controller (Task 4). `crearNotaCredito` pasa a devolver también `movimientoCajaId: string | null` (siempre `null` en el flujo de pasarela; el handler de reembolsos solo lee `.id`, no se toca).

- [ ] **Step 1: Ajustar mocks del spec (setup, aún sin tests nuevos)**

En `ventas.service.spec.ts`:

a) En el provider de `CajaService` (:132-138), dejar el `useValue` así:

```typescript
          useValue: {
            findActiva: jest.fn().mockResolvedValue(mockCajaActiva),
            findVirtual: jest.fn().mockResolvedValue(mockCajaVirtual),
            calcularSaldoEsperado: jest.fn().mockResolvedValue('50000.0000'),
            registrarMovimientoEnTransaccion: jest
              .fn()
              .mockResolvedValue({ id: 'mov-caja-nc-1' }),
          },
```

b) Agregar `UnprocessableEntityException` al import de `@nestjs/common` (línea 1).

c) En `ventaOriginalRow` (:315), agregar el campo que ahora devuelve `lockVentaOriginal`:

```typescript
      tipo_documento_id: 'tipo-doc-boleta-uuid',
```

- [ ] **Step 2: Escribir los tests que fallan**

Dentro del describe existente `'crearNotaCredito() / registrarDevolucionesPorReembolso()'` (:310, para reusar `ncManager`/`ventaRows`/`baseParams` de su `beforeEach`), agregar al final:

```typescript
    describe('crearNotaCreditoDesdeVenta()', () => {
      it('feliz sin dinero: delega en crearNotaCredito y devuelve movimientoCajaId null', async () => {
        const res = await service.crearNotaCreditoDesdeVenta(baseParams);
        expect(res.totalFinal).toBe('1100.0000');
        expect(res.movimientoCajaId).toBeNull();
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(
          cajaService.registrarMovimientoEnTransaccion,
        ).not.toHaveBeenCalled();
      });

      it.each(['pendiente', 'borrador', 'cancelada'])(
        'rechaza ventas en estado %s',
        async (estado) => {
          ventaRows = [{ ...ventaOriginalRow, estado }];
          await expect(
            service.crearNotaCreditoDesdeVenta(baseParams),
          ).rejects.toThrow(
            'Solo se puede emitir nota de crédito de ventas pagadas o pagadas parcialmente',
          );
        },
      );

      it('rechaza NC sobre otra NC', async () => {
        ventaRows = [
          { ...ventaOriginalRow, tipo_documento_id: TIPO_DOCUMENTO_NC_ID },
        ];
        await expect(
          service.crearNotaCreditoDesdeVenta(baseParams),
        ).rejects.toThrow(
          'No se puede emitir una nota de crédito sobre otra nota de crédito',
        );
      });

      it('devolverDinero: registra salida en la caja activa ligada a la NC', async () => {
        const res = await service.crearNotaCreditoDesdeVenta({
          ...baseParams,
          devolverDinero: true,
        });
        expect(res.movimientoCajaId).toBe('mov-caja-nc-1');
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(cajaService.findActiva).toHaveBeenCalledWith(
          TENANT_ID,
          USUARIO_ID,
        );
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(cajaService.registrarMovimientoEnTransaccion).toHaveBeenCalledWith(
          ncManager,
          expect.objectContaining({
            cajaId: CAJA_ID,
            tipo: 'salida',
            concepto: 'Devolución · Nota de crédito',
            monto: '1100.0000',
            ventaId: res.id,
          }),
        );
      });

      it('devolverDinero sin caja física abierta → 422', async () => {
        cajaService.findActiva.mockResolvedValueOnce(null);
        await expect(
          service.crearNotaCreditoDesdeVenta({
            ...baseParams,
            devolverDinero: true,
          }),
        ).rejects.toThrow(UnprocessableEntityException);
      });

      it('devolverDinero con saldo insuficiente → 422 y no registra movimiento', async () => {
        cajaService.calcularSaldoEsperado.mockResolvedValueOnce('1000.0000');
        await expect(
          service.crearNotaCreditoDesdeVenta({
            ...baseParams,
            devolverDinero: true,
          }),
        ).rejects.toThrow('Saldo insuficiente en caja');
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(
          cajaService.registrarMovimientoEnTransaccion,
        ).not.toHaveBeenCalled();
      });

      it('regresión: crearNotaCredito directo (flujo pasarela) no valida estado ni toca caja', async () => {
        ventaRows = [{ ...ventaOriginalRow, estado: 'pendiente' }];
        const res = await service.crearNotaCredito(baseParams);
        expect(res.movimientoCajaId).toBeNull();
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(
          cajaService.registrarMovimientoEnTransaccion,
        ).not.toHaveBeenCalled();
      });
    });
```

- [ ] **Step 3: Verificar que fallan**

```bash
npx jest src/modules/ventas/ventas.service.spec.ts
```

Esperado: FAIL — los tests nuevos con `service.crearNotaCreditoDesdeVenta is not a function` y el de regresión por `movimientoCajaId` undefined ≠ null. Los tests preexistentes deben seguir en verde.

- [ ] **Step 4: Implementar en `ventas.service.ts`**

a) Import (línea 1-5): agregar `UnprocessableEntityException` a `@nestjs/common`.

b) `lockVentaOriginal` (:497-525): agregar `tipo_documento_id` al tipo de retorno y al SELECT:

```typescript
  private async lockVentaOriginal(
    manager: EntityManager,
    tenantId: string,
    ventaOriginalId: string,
  ): Promise<{
    venta_id: string;
    caja_id: string | null;
    moneda_id: string;
    canal: string;
    total_final: string;
    estado: string;
    tipo_documento_id: string | null;
  }> {
    const rows: {
      venta_id: string;
      caja_id: string | null;
      moneda_id: string;
      canal: string;
      total_final: string;
      estado: string;
      tipo_documento_id: string | null;
    }[] = await manager.query(
      `SELECT venta_id, caja_id, moneda_id, canal, total_final, estado, tipo_documento_id
       FROM ventas
       WHERE venta_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
       FOR UPDATE`,
      [ventaOriginalId, tenantId],
    );
    if (!rows.length) throw new NotFoundException('Venta no encontrada');
    return rows[0];
  }
```

c) `crearNotaCredito` (:362): agregar los dos flags opcionales a `params` y `movimientoCajaId` al retorno:

```typescript
  async crearNotaCredito(params: {
    tenantId: string;
    usuarioId: string;
    ventaOriginalId: string;
    monto: string;
    devoluciones?: DevolucionReembolso[];
    comentario?: string;
    /** Egreso de caja: movimiento 'salida' en la caja física abierta del usuario. */
    devolverDinero?: boolean;
    /** Solo el endpoint manual: exige venta pagada/pagada_parcial y no-NC. */
    validarVentaElegible?: boolean;
  }): Promise<{ id: string; totalFinal: string; movimientoCajaId: string | null }> {
```

Justo después de `const original = await this.lockVentaOriginal(...)` (:378), insertar:

```typescript
      if (params.validarVentaElegible) {
        if (original.tipo_documento_id === TIPO_DOCUMENTO_NC_ID)
          throw new BadRequestException(
            'No se puede emitir una nota de crédito sobre otra nota de crédito',
          );
        if (!['pagada', 'pagada_parcial'].includes(original.estado))
          throw new BadRequestException(
            'Solo se puede emitir nota de crédito de ventas pagadas o pagadas parcialmente',
          );
      }
```

Reemplazar el `return { id: nc.id, totalFinal: nc.totalFinal };` final (:452) por el bloque de egreso (dentro de la MISMA transacción — si la caja falla, la NC y sus movimientos se revierten):

```typescript
      let movimientoCajaId: string | null = null;
      if (params.devolverDinero) {
        const caja = await this.cajaService.findActiva(
          params.tenantId,
          params.usuarioId,
        );
        if (!caja)
          throw new UnprocessableEntityException(
            'No tienes una caja física abierta para registrar la devolución de dinero',
          );
        const saldo = await this.cajaService.calcularSaldoEsperado(
          caja.id,
          manager,
        );
        if (new Decimal(saldo).minus(params.monto).lt(0))
          throw new UnprocessableEntityException('Saldo insuficiente en caja');
        const movimiento =
          await this.cajaService.registrarMovimientoEnTransaccion(manager, {
            cajaId: caja.id,
            tipo: 'salida',
            concepto: 'Devolución · Nota de crédito',
            monto: params.monto,
            ventaId: nc.id,
          });
        movimientoCajaId = movimiento.id;
      }

      return { id: nc.id, totalFinal: nc.totalFinal, movimientoCajaId };
```

d) Después del cierre de `crearNotaCredito` (:454), agregar el wrapper:

```typescript
  /**
   * NC creada manualmente desde el detalle de una venta (POS): exige venta
   * pagada/pagada_parcial que no sea otra NC, y permite el egreso de caja
   * elegible. El flujo de reembolsos de pasarela usa `crearNotaCredito`
   * directo y NO pasa por estas reglas.
   */
  async crearNotaCreditoDesdeVenta(params: {
    tenantId: string;
    usuarioId: string;
    ventaOriginalId: string;
    monto: string;
    devoluciones?: DevolucionReembolso[];
    comentario?: string;
    devolverDinero?: boolean;
  }): Promise<{ id: string; totalFinal: string; movimientoCajaId: string | null }> {
    return this.crearNotaCredito({ ...params, validarVentaElegible: true });
  }
```

- [ ] **Step 5: Verificar que pasan (ventas + regresión pasarela)**

```bash
npx jest src/modules/ventas src/modules/pasarela
```

Esperado: PASS todo (los specs de `reembolso-callback.handler` y `cobros.service` no cambian: el handler solo lee `.id` del resultado).

- [ ] **Step 6: Lint y commit**

```bash
npx eslint src/modules/ventas/ventas.service.ts src/modules/ventas/ventas.service.spec.ts --fix
git add src/modules/ventas/ventas.service.ts src/modules/ventas/ventas.service.spec.ts
git commit -m "feat(ventas): crearNotaCreditoDesdeVenta con elegibilidad y egreso de caja transaccional

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Endpoint `POST /ventas/:id/notas-credito`

**Files:**
- Modify: `backend/src/modules/ventas/ventas.controller.ts`

**Interfaces:**
- Consumes: `crearNotaCreditoDesdeVenta` (Task 3), `CreateNotaCreditoDto` (Task 2), permiso `Ventas`/`Nota de crédito` (Task 1).
- Produces: `POST /api/ventas/:id/notas-credito` → `201 { id, totalFinal, movimientoCajaId }`. Lo consume el modal (Task 5).

- [ ] **Step 1: Agregar la ruta**

En `ventas.controller.ts`, agregar el import del DTO junto a los existentes (:19-20):

```typescript
import { CreateNotaCreditoDto } from './dto/create-nota-credito.dto';
```

y el handler dentro de `VentasController`, después de `crear()` (:34) y ANTES de `@Get(':id')` (orden de rutas: los @Post no colisionan, pero mantener los estáticos arriba):

```typescript
  @Post(':id/notas-credito')
  @RequiresPermiso('Ventas', 'Nota de crédito')
  async crearNotaCredito(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CreateNotaCreditoDto,
  ) {
    const u = req.user as JwtUser;
    return this.ventasService.crearNotaCreditoDesdeVenta({
      tenantId: u.tenantId ?? '',
      usuarioId: u.id,
      ventaOriginalId: id,
      monto: dto.monto,
      comentario: dto.comentario,
      devoluciones: dto.devoluciones,
      devolverDinero: dto.devolverDinero === true,
    });
  }
```

- [ ] **Step 2: Verificar compilación, tests y lint**

```bash
npx tsc --noEmit -p tsconfig.json && npx jest src/modules/ventas && npx eslint src/modules/ventas/ventas.controller.ts
```

Esperado: sin errores, tests PASS.

- [ ] **Step 3: Smoke test HTTP contra el stack Docker**

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin.paris@paris.cl","password":"admin"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])')
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/switch-tenant -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"tenantId":"550e8400-e29b-41d4-a716-446655440007"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])')
# venta inexistente → 404 con guard/DTO pasando (prueba permiso + validación + wiring)
curl -s -X POST http://localhost:3000/api/ventas/550e8400-e29b-41d4-a716-446655440999/notas-credito \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"monto":"100"}'
```

Esperado: `{"message":"Venta no encontrada","statusCode":404,...}` (NO 403: el admin fijo bypasea el permiso).

- [ ] **Step 4: Commit**

```bash
git add src/modules/ventas/ventas.controller.ts
git commit -m "feat(ventas): endpoint POST /ventas/:id/notas-credito con permiso dedicado

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Frontend — `NotaCreditoModal.vue` + integración en el drawer

**Files:**
- Create: `frontend/app/components/ventas/NotaCreditoModal.vue`
- Modify: `frontend/app/components/ventas/VentaDetalleDrawer.vue`

**Interfaces:**
- Consumes: `POST /api/ventas/:id/notas-credito` (Task 4); `useCajaStore().cargarActiva()` / `.activa` (existente — `GET /caja/activa` devuelve la caja física abierta del usuario o null); `permissionsStore.can('Ventas', 'Nota de crédito')`; `venta.detalles[]` del `GET /ventas/:id` que ya trae `itemId`/`modoInventario`/`cantidadDevuelta` (el drawer debe declararlos en su interfaz).
- Produces: componente auto-importado `VentasNotaCreditoModal` con props `{ ventaId: string; disponible: string; detalles: DetalleVenta[] }` y evento `success`.

- [ ] **Step 1: Crear `frontend/app/components/ventas/NotaCreditoModal.vue`**

```vue
<script setup lang="ts">
import Decimal from 'decimal.js'

interface DetalleVenta {
  itemId: string
  descripcion: string | null
  cantidad: string
  modoInventario: string | null
  cantidadDevuelta: string
}

interface FilaDevolucion {
  itemId: string
  descripcion: string
  disponible: string
  modoInventario: string | null
  cantidad: string
}

const props = defineProps<{
  ventaId: string
  /** total_final − Σ NCs previas (lo calcula el drawer) */
  disponible: string
  detalles: DetalleVenta[]
}>()
const emit = defineEmits<{ success: [] }>()
const open = defineModel<boolean>('open', { required: true })

const config = useRuntimeConfig()
const toast = useToast()
const cajaStore = useCajaStore()
const { formatMonto } = useFormatters()
const apiUrl = config.public.apiUrl

const monto = ref('')
const comentario = ref('')
const devolverDinero = ref(false)
const filas = ref<FilaDevolucion[]>([])
const submitting = ref(false)

function esDecimalValido(v: string) {
  return /^\d+(\.\d+)?$/.test(v)
}

watch(open, (v) => {
  if (!v) return
  monto.value = props.disponible
  comentario.value = ''
  devolverDinero.value = false
  // Una fila por ítem (el disponible a devolver es por ítem, no por línea)
  const porItem = new Map<string, FilaDevolucion>()
  for (const d of props.detalles) {
    const previa = porItem.get(d.itemId)
    if (previa) {
      previa.disponible = new Decimal(previa.disponible).plus(d.cantidad).toString()
    }
    else {
      porItem.set(d.itemId, {
        itemId: d.itemId,
        descripcion: d.descripcion ?? d.itemId,
        disponible: new Decimal(d.cantidad).minus(d.cantidadDevuelta).toString(),
        modoInventario: d.modoInventario,
        cantidad: '',
      })
    }
  }
  filas.value = [...porItem.values()]
  // Habilita/deshabilita el checkbox de devolución de dinero
  cajaStore.cargarActiva()
})

const tieneCaja = computed(() => !!cajaStore.activa)

const montoValido = computed(() => {
  const m = new Decimal(monto.value || '0')
  return m.gt(0) && m.lte(new Decimal(props.disponible))
})

const filasValidas = computed(() =>
  filas.value.every((f) => {
    if (!f.cantidad) return true
    if (!esDecimalValido(f.cantidad)) return false
    return new Decimal(f.cantidad).lte(f.disponible)
  }),
)

const puedeConfirmar = computed(() => montoValido.value && filasValidas.value)

function notaDevolucion(fila: FilaDevolucion) {
  if (fila.modoInventario === null) return 'Servicio: sin stock'
  if (fila.modoInventario !== 'cantidad')
    return `Modo ${fila.modoInventario}: devolución manual desde Inventario`
  return null
}

function filaDevolvible(fila: FilaDevolucion) {
  return fila.modoInventario === 'cantidad' && new Decimal(fila.disponible).gt(0)
}

function setCantidad(itemId: string, valor: string) {
  filas.value = filas.value.map(f =>
    f.itemId === itemId ? { ...f, cantidad: valor } : f,
  )
}

async function confirmar() {
  submitting.value = true
  try {
    const devoluciones = filas.value
      .filter(f => f.cantidad && esDecimalValido(f.cantidad) && new Decimal(f.cantidad).gt(0))
      .map(f => ({ itemId: f.itemId, cantidad: f.cantidad }))

    const body: Record<string, unknown> = { monto: monto.value }
    if (comentario.value.trim()) body.comentario = comentario.value.trim()
    if (devolverDinero.value) body.devolverDinero = true
    if (devoluciones.length) body.devoluciones = devoluciones

    const res = await useApiFetch<{ id: string, movimientoCajaId: string | null }>(
      `${apiUrl}/ventas/${props.ventaId}/notas-credito`,
      { method: 'POST', body },
    )

    toast.add({
      title: res?.movimientoCajaId
        ? 'Nota de crédito generada con devolución de dinero'
        : 'Nota de crédito generada',
      color: 'success',
    })
    open.value = false
    emit('success')
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'Error al generar la nota de crédito'), color: 'error' })
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Nota de crédito" :ui="shellUi.modal">
    <template #body>
      <div class="flex flex-col gap-4">
        <div class="flex justify-between text-sm text-muted">
          <span>Disponible para nota de crédito</span>
          <span class="font-mono">{{ formatMonto(disponible) }}</span>
        </div>

        <div class="flex flex-col gap-1">
          <span class="text-sm text-muted">Monto</span>
          <MoneyInput
            v-model="monto"
            oficial
          />
          <p v-if="!montoValido && monto" class="text-xs text-error">
            El monto debe ser mayor a 0 y no superar el disponible.
          </p>
        </div>

        <div class="flex flex-col gap-1">
          <span class="text-sm text-muted">Comentario (opcional)</span>
          <UInput v-model="comentario" placeholder="Motivo de la devolución" />
        </div>

        <USeparator />

        <UCheckbox
          v-model="devolverDinero"
          :disabled="!tieneCaja"
          label="Registrar devolución de dinero desde la caja"
          :description="tieneCaja
            ? 'Crea un movimiento de salida en tu caja física abierta por el monto de la NC.'
            : 'Necesitas una caja física abierta para devolver dinero.'"
        />

        <div class="flex flex-col gap-2">
          <span class="text-sm text-muted">Devolver a inventario (opcional)</span>
          <div v-if="!filas.length" class="text-sm text-muted">
            La venta no tiene líneas para devolver.
          </div>
          <div v-else class="flex flex-col divide-y divide-default">
            <div
              v-for="fila in filas"
              :key="fila.itemId"
              class="flex items-center justify-between gap-3 py-2"
            >
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm">{{ fila.descripcion }}</p>
                <p class="text-xs text-muted">
                  <template v-if="notaDevolucion(fila)">{{ notaDevolucion(fila) }}</template>
                  <template v-else>Disponible: {{ fila.disponible }}</template>
                </p>
              </div>
              <UInput
                :model-value="fila.cantidad"
                inputmode="decimal"
                placeholder="0"
                class="w-24"
                :disabled="!filaDevolvible(fila)"
                @update:model-value="setCantidad(fila.itemId, String($event ?? ''))"
              />
            </div>
          </div>
          <p v-if="!filasValidas" class="text-xs text-error">
            Las cantidades deben ser numéricas y no superar lo disponible por ítem.
          </p>
        </div>
      </div>
    </template>

    <template #footer>
      <AppModalFooter>
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="open = false" />
        <UButton
          label="Generar nota de crédito"
          :loading="submitting"
          :disabled="!puedeConfirmar"
          @click="confirmar"
        />
      </AppModalFooter>
    </template>
  </UModal>
</template>
```

- [ ] **Step 2: Integrar en `VentaDetalleDrawer.vue`**

a) Extender la interfaz `Detalle` (:14-20) con los campos que el backend ya devuelve:

```typescript
interface Detalle {
  id: string
  itemId: string
  descripcion: string
  cantidad: string
  precioUnitario: string
  totalLinea: string
  modoInventario: string | null
  cantidadDevuelta: string
}
```

b) En el script, después de `const abonoOpen = ref(false)` (:80):

```typescript
const ncOpen = ref(false)
const permissionsStore = usePermissionsStore()
```

c) Después del computed `esNotaCredito` (:98):

```typescript
// Máximo emitible: total de la venta menos las NCs ya emitidas (validado también en backend)
const disponibleNC = computed(() => {
  if (!venta.value) return '0'
  const previas = venta.value.notasCredito.reduce(
    (acc, nc) => new Decimal(acc).plus(nc.totalFinal).toString(),
    '0',
  )
  return Decimal.max(0, new Decimal(venta.value.totalFinal).minus(previas)).toString()
})

const puedeCrearNC = computed(() =>
  !!venta.value
  && ['pagada', 'pagada_parcial'].includes(venta.value.estado)
  && !esNotaCredito.value
  && new Decimal(disponibleNC.value).gt(0)
  && permissionsStore.can('Ventas', 'Nota de crédito'),
)
```

d) En el `watch` de cierre (:178-181), agregar `ncOpen.value = false` junto a `abonoOpen.value = false`.

e) Después de `onAbonoSuccess` (:185-189):

```typescript
async function onNcSuccess() {
  ncOpen.value = false
  if (props.ventaId) await cargar(props.ventaId)
  emit('updated')
}
```

f) En `<template #actions>` (:452-466), antes del botón "Registrar pago":

```vue
      <UButton
        v-if="puedeCrearNC"
        label="Nota de crédito"
        icon="i-lucide-file-minus"
        color="neutral"
        variant="outline"
        @click="ncOpen = true"
      />
```

g) Al final del template, junto a `PagosAbonoModal` (:469-476):

```vue
  <VentasNotaCreditoModal
    v-if="venta"
    v-model:open="ncOpen"
    :venta-id="venta.id"
    :disponible="disponibleNC"
    :detalles="venta.detalles"
    @success="onNcSuccess"
  />
```

- [ ] **Step 3: Verificación manual en el navegador**

Con el stack Docker corriendo (`http://localhost:5173`), login `admin.paris@paris.cl` / `admin` → tenant Paris:

1. Abrir caja física (módulo Caja) si no hay una abierta.
2. POS: crear una venta física pagada en efectivo con un producto modo `cantidad`.
3. `/ventas` → abrir el drawer de esa venta → botón "Nota de crédito" visible.
4. Modal: disponible = total; checkbox de dinero HABILITADO (hay caja); generar NC parcial con dinero + devolución de 1 unidad.
5. Verificar: toast éxito, drawer recargado muestra card "Documentos relacionados" con la NC; listado muestra badge "NC" en la fila nueva.
6. Cerrar la caja desde el módulo Caja: el cuadre refleja el egreso (`salida` "Devolución · Nota de crédito").
7. Abrir el drawer de una venta `pendiente` → el botón NO aparece.

- [ ] **Step 4: Commit**

```bash
cd /Users/m2pro/cmatheus/startup-app
git add frontend/app/components/ventas/NotaCreditoModal.vue frontend/app/components/ventas/VentaDetalleDrawer.vue
git commit -m "feat(ventas): modal de nota de crédito con egreso de caja y devolución de stock desde el drawer

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Docs vivas + verificación E2E final

**Files:**
- Modify: `docs/features/reembolsos-nota-credito.md` (nueva sección + scope)
- Modify: `CLAUDE.md` (tabla "Estado actual", fila nueva)
- Modify: `docs/superpowers/plans/2026-07-11-nota-credito-pos.md` (Status → Done al terminar)

- [ ] **Step 1: Actualizar `docs/features/reembolsos-nota-credito.md`**

a) En "### Scope", mover "endpoint independiente de NC sin reembolso" de "NO incluido" a "Incluido" reescribiéndolo, y actualizar Last Updated a 2026-07-11:

```markdown
- Incluido: NC interna elegible en el reembolso; devolución de stock elegible
  (modo `cantidad`); visibilidad de reembolsos en detalle/listado de ventas;
  badges derivados (no son estados nuevos en BD); **NC manual desde el detalle
  de venta con egreso de caja elegible (2026-07-11)**.
- NO incluido (futuro): emisión tributaria real (SII/folios); devolución para
  modos `serie`/`lote` (requiere elegir unidades/lote — se hace manual desde
  Inventario); egreso en el ledger de `pagos`; devolución de dinero por el
  método de pago original (el egreso es efectivo de caja).
```

b) Agregar sección nueva antes de "## Testing":

```markdown
## NC manual desde el detalle de venta (2026-07-11)

```
POST /api/ventas/:id/notas-credito
Authorization: Bearer <JWT>   (permiso dedicado Ventas:Nota de crédito)

Request:  { "monto": "5000", "comentario": "...", "devolverDinero": true,
            "devoluciones": [{ "itemId": "uuid", "cantidad": "1" }] }
Response 201: { "id": "<uuid NC>", "totalFinal": "5000.0000",
                "movimientoCajaId": "<uuid>" | null }
```

- Elegibilidad: venta `pagada`/`pagada_parcial` de cualquier canal, nunca sobre
  otra NC. La venta original no cambia de estado.
- `devolverDinero`: movimiento `salida` ("Devolución · Nota de crédito") en la
  caja física abierta del usuario, en la **misma transacción** que la NC
  (todo-o-nada; valida saldo suficiente). Sin caja o sin saldo → 422.
- Backend: `VentasService.crearNotaCreditoDesdeVenta` → `crearNotaCredito` con
  flags `validarVentaElegible`/`devolverDinero`; el flujo de reembolsos de
  pasarela llama sin flags y no cambia.
- Frontend: botón "Nota de crédito" en `VentaDetalleDrawer` +
  `ventas/NotaCreditoModal.vue` (checkbox de dinero deshabilitado sin caja
  abierta — `GET /caja/activa`; devolución de stock igual al `ReembolsoModal`).
- Spec: `docs/superpowers/specs/2026-07-11-nota-credito-pos-design.md`.
```

- [ ] **Step 2: Actualizar `CLAUDE.md`**

Agregar fila al final de la tabla "Estado actual":

```markdown
| Nota de crédito manual desde el detalle de venta (permiso dedicado `Ventas:Nota de crédito`, egreso de caja elegible en la misma transacción, devolución de stock elegible) | ✅ Implementado (2026-07-11) |
```

- [ ] **Step 3: Suite completa + lint**

```bash
cd /Users/m2pro/cmatheus/startup-app/backend && npx jest && npx eslint src/modules/ventas src/modules/seeder --ext .ts
```

Esperado: todos los tests PASS (383 previos + ~13 nuevos); sin errores nuevos de lint (el error preexistente de `query-ordenes.dto.ts:43` no cuenta).

- [ ] **Step 4: E2E por API + BD (complementa el paso manual del Task 5)**

```bash
# (con TOKEN del tenant Paris como en Task 4)
# 1. Caja física abierta con saldo (si no existe):
curl -s -X POST http://localhost:3000/api/caja/abrir -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"saldoInicial":"50000"}'
# 2. Crear venta física pagada (usar el POS del navegador o el endpoint /ventas con pagos efectivo)
# 3. NC con dinero + devolución sobre esa venta:
curl -s -X POST http://localhost:3000/api/ventas/<VENTA_ID>/notas-credito \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"monto":"100","devolverDinero":true,"devoluciones":[{"itemId":"<ITEM_ID>","cantidad":"1"}]}'
# 4. Verificar en BD:
docker exec tecnica_postgres psql -U dev_user -d tecnica_db -c \
  "SELECT v.venta_id, v.estado, v.total_final, v.venta_referencia_id
     FROM ventas v WHERE v.tipo_documento_id = '550e8400-e29b-41d4-a716-446655440218'
     ORDER BY v.creado_el DESC LIMIT 1;"
docker exec tecnica_postgres psql -U dev_user -d tecnica_db -c \
  "SELECT tipo, concepto, monto, venta_id FROM movimientos_caja
     WHERE concepto = 'Devolución · Nota de crédito' ORDER BY creado_el DESC LIMIT 1;"
docker exec tecnica_postgres psql -U dev_user -d tecnica_db -c \
  "SELECT tipo, motivo, cantidad FROM movimientos_inventario ORDER BY creado_el DESC LIMIT 1;"
```

Esperado: NC tipo 61 estado `pagada` referenciando la venta; movimiento caja `salida` ligado a la NC; movimiento inventario `entrada/devolucion`. Casos negativos: repetir la NC excediendo el total → 400; `devolverDinero` con saldo insuficiente → 422 y SIN NC creada (verificar que no apareció fila nueva tipo 61).

- [ ] **Step 5: Marcar plan Done + commit docs**

```bash
cd /Users/m2pro/cmatheus/startup-app
# editar Status: Approved → Done en docs/superpowers/plans/2026-07-11-nota-credito-pos.md
git add docs/features/reembolsos-nota-credito.md CLAUDE.md docs/superpowers/plans/2026-07-11-nota-credito-pos.md
git commit -m "docs: nota de crédito manual desde el detalle de venta

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Decisions / Open questions

- El egreso de caja va DENTRO de la transacción de la NC (sin proveedor externo no aplica el patrón post-commit de pasarela).
- `startup-pos.sql` no se toca: es schema-only y esta feature no crea tablas/columnas/índices.
- El monto de la NC no se cruza contra las líneas devueltas (flexibilidad, decisión previa del 2026-07-10).
- No se agrega spec de controller (el repo no tiene ese patrón); cobertura por spec de service + DTO + smoke test HTTP.
