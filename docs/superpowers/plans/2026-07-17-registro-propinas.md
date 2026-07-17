# Registro de Propinas al Cerrar Cuenta — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Capturar propina separada de la venta (compatible SII) al cerrar cuenta de mesa, cobrando venta + tip en un solo flujo y persistiendo el split determinista en `pago_aplicaciones`.

**Architecture:** `venta_propina` congela el hecho (montos, % sugerido, garzón responsable). `PagosService.registrar` sigue moviendo el dinero total a caja pero crea filas hijas en `pago_aplicaciones`. El algoritmo `NO_VUELTO` vive en función pura testeable; `VentaPropinaService` deriva tipo/estado. `SalonesService.cerrarCuenta` pasa propina vía `CreateVentaDto.propinaCierreMesa`; el estado de la venta usa solo Σ aplicaciones `venta`.

**Tech Stack:** NestJS, TypeORM, PostgreSQL 15, Decimal.js, Jest, Nuxt 4, Vue 3, Nuxt UI v4, `useApiFetch`.

## Global Constraints

- Trabajar directamente sobre `main`; no crear ramas ni PRs.
- Desarrollo Docker-first; no agregar dependencias npm.
- `tenant_id` siempre del JWT, nunca del body.
- Toda PK/FK UUID declara `type: 'uuid'` explícito (ADR-004).
- Soft delete: `eliminado_el`, `creado_el`, `actualizado_el`.
- Dinero y porcentajes con Decimal.js / `numeric` string; porcentajes en decimal (`0.10` = 10%).
- Propina **no** entra a `ventas.total_final` ni al motor de precios.
- Errores operativos (propina inválida, pagos insuficientes, PIN) → `400`, no `401`.
- Solo cierre de cuenta de mesa crea `venta_propina`; POS/online no.
- Estrategia en D: solo `NO_VUELTO`; otras lanzan `400`.
- Split determinista: orden por `permite_vuelto=false` primero, luego `metodo_pago_id` ASC; **no** por orden de ingreso.
- Estado venta: `calcularEstadoVenta(total_final, Σ aplicaciones tipo=venta)`.
- Caja: movimiento neto = `monto - vuelto` del pago (incluye tip en el total cobrado).
- Frontend: tokens semánticos Nuxt UI; formatters en composables; anti-refetch tras mutar.
- Esquema documental: `startup-pos.sql`; dev usa TypeORM `synchronize`.
- Actualizar `docs/ESTADO.md`, `docs/features/` y spec en el mismo commit final.

---

## Mapa de archivos

### Crear

- `backend/src/modules/propinas/entities/venta-propina.entity.ts` — entidad + enums `TipoVentaPropina`, `EstadoVentaPropina`.
- `backend/src/modules/propinas/venta-propina.service.ts` — crear fila y derivar tipo/estado.
- `backend/src/modules/propinas/venta-propina.service.spec.ts`
- `backend/src/modules/propinas/propinas.module.ts`
- `backend/src/modules/propinas/enums/estrategia-asignacion-propina.enum.ts`
- `backend/src/modules/pagos/entities/pago-aplicacion.entity.ts` — entidad + enum `TipoPagoAplicacion`.
- `backend/src/modules/pagos/asignacion-propina.ts` — función pura `calcularAplicacionesNoVuelto`.
- `backend/src/modules/pagos/asignacion-propina.spec.ts`
- `backend/src/modules/ventas/dto/propina-cierre-mesa.dto.ts`
- `frontend/app/composables/usePropina.ts` — `sugerirPropina`, tipos.
- `frontend/app/composables/usePropina.spec.ts`

### Modificar

- `backend/src/app.module.ts` — registrar entidades `VentaPropina`, `PagoAplicacion`.
- `backend/src/modules/propinas/propinas.module.ts` — exports `VentaPropinaService`.
- `backend/src/modules/pagos/pagos.module.ts` — entity `PagoAplicacion`.
- `backend/src/modules/ventas/ventas.module.ts` — import `PropinasModule`.
- `backend/src/modules/salones/salones.module.ts` — ya importa ventas; sin cambio si ventas importa propinas.
- `backend/src/modules/pagos/pagos.service.ts` — `registrar` + aplicaciones + estado venta.
- `backend/src/modules/pagos/pagos.service.spec.ts`
- `backend/src/modules/ventas/dto/create-venta.dto.ts` — `propinaCierreMesa?`.
- `backend/src/modules/ventas/ventas.service.ts` — crear propina + target cobro + estado.
- `backend/src/modules/salones/dto/cerrar-cuenta.dto.ts` — campos propina.
- `backend/src/modules/salones/salones.service.ts` — mapear propina al `CreateVentaDto`.
- `backend/src/modules/salones/salones.service.spec.ts`
- `backend/src/modules/ventas/ventas.service.ts` — `findOne` incluye propina + aplicaciones.
- `startup-pos.sql` — tablas + backfill aplicaciones `venta`.
- `frontend/app/components/ventas/CobroModal.vue` — modo propina opcional (solo salones).
- `frontend/app/pages/salones/index.vue` — wiring propina + total a pagar.
- `frontend/app/composables/useSalones.ts` — tipos y body `cerrarCuenta`.
- `frontend/app/components/ventas/VentaDetalleDrawer.vue` — mostrar propina y aplicaciones.
- `docs/features/salones-mesas.md` — contrato cierre con propina.
- `docs/ESTADO.md` — fila subproyecto D.
- `docs/superpowers/specs/2026-07-17-registro-propinas-design.md` — `Done / Approved` al cerrar.

---

### Task 1: Modelo persistente y backfill SQL

**Files:**
- Create: `backend/src/modules/propinas/entities/venta-propina.entity.ts`
- Create: `backend/src/modules/pagos/entities/pago-aplicacion.entity.ts`
- Create: `backend/src/modules/propinas/enums/estrategia-asignacion-propina.enum.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/modules/pagos/pagos.module.ts`
- Create: `backend/src/modules/propinas/propinas.module.ts`
- Modify: `startup-pos.sql`

**Interfaces:**
- Produces: `VentaPropina`, `PagoAplicacion`, `EstrategiaAsignacionPropina`, `TipoPagoAplicacion`.
- Consumes: convenciones entity del repo (ADR-004, soft delete).

- [x] **Step 1: Crear enums**

```typescript
// backend/src/modules/propinas/enums/estrategia-asignacion-propina.enum.ts
export enum EstrategiaAsignacionPropina {
  NO_VUELTO = 'no_vuelto',
  ULTIMO_PAGO = 'ultimo_pago',
  PRIMER_PAGO = 'primer_pago',
  PROPORCIONAL = 'proporcional',
  MANUAL = 'manual',
}

// venta-propina.entity.ts
export enum TipoVentaPropina {
  SUGERIDA = 'sugerida',
  MANUAL = 'manual',
}
export enum EstadoVentaPropina {
  PAGADA = 'pagada',
  SIN_PROPINA = 'sin_propina',
}

// pago-aplicacion.entity.ts
export enum TipoPagoAplicacion {
  VENTA = 'venta',
  PROPINA = 'propina',
}
```

- [x] **Step 2: Crear entidad `VentaPropina`**

Campos según spec: `venta_propina_id`, `tenant_id`, `venta_id` (unique partial),
`garzon_id`, `porcentaje_sugerido` numeric(10,6), `monto_sugerido`, `monto_pagado`,
`tipo`, `estado`, timestamps + soft delete. Todos los UUID con `type: 'uuid'`.

- [x] **Step 3: Crear entidad `PagoAplicacion`**

`pago_aplicacion_id`, `tenant_id`, `pago_id`, `tipo`, `referencia_id` nullable,
`monto` numeric(18,4). Índice en `pago_id` y (`tenant_id`, `tipo`, `referencia_id`).

- [x] **Step 4: Registrar en `app.module.ts` y módulos**

`TypeOrmModule.forFeature([PagoAplicacion])` en `pagos.module.ts`.
`PropinasModule` con `VentaPropina` + `VentaPropinaService` (stub vacío por ahora).

- [x] **Step 5: Actualizar `startup-pos.sql`**

CREATE `venta_propina` y `pago_aplicaciones` con CHECKs:
- `monto >= 0`, `porcentaje_sugerido >= 0`
- `tipo IN ('sugerida','manual')`, `estado IN ('pagada','sin_propina')`
- `pago_aplicaciones.tipo IN ('venta','propina')`

Backfill idempotente:

```sql
INSERT INTO pago_aplicaciones (pago_aplicacion_id, tenant_id, pago_id, tipo, referencia_id, monto, creado_el, actualizado_el)
SELECT gen_random_uuid(), p.tenant_id, p.pago_id, 'venta', p.venta_id, p.monto - p.vuelto, NOW(), NOW()
FROM pagos p
WHERE p.eliminado_el IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM pago_aplicaciones pa
    WHERE pa.pago_id = p.pago_id AND pa.eliminado_el IS NULL
  );
```

- [x] **Step 6: Commit**

```bash
git add backend/src/modules/propinas backend/src/modules/pagos/entities/pago-aplicacion.entity.ts backend/src/modules/pagos/pagos.module.ts backend/src/app.module.ts startup-pos.sql
git commit -m "feat(propinas): entidades venta_propina y pago_aplicaciones"
```

---

### Task 2: Algoritmo puro `NO_VUELTO`

**Files:**
- Create: `backend/src/modules/pagos/asignacion-propina.ts`
- Create: `backend/src/modules/pagos/asignacion-propina.spec.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface PagoNetoInput {
    pagoIdx: number;
    metodoPagoId: string;
    permiteVuelto: boolean;
    neto: string;
  }
  export interface AplicacionCalculada {
    pagoIdx: number;
    tipo: 'venta' | 'propina';
    monto: string;
  }
  export function calcularAplicacionesNoVuelto(
    pagos: PagoNetoInput[],
    propinaMonto: string,
  ): AplicacionCalculada[]
  export function dispatchAsignacionPropina(
    estrategia: EstrategiaAsignacionPropina,
    pagos: PagoNetoInput[],
    propinaMonto: string,
  ): AplicacionCalculada[]
  ```
- Consumes: `EstrategiaAsignacionPropina` de Task 1.

- [x] **Step 1: Escribir tests que fallan**

Casos obligatorios:
1. Solo tarjeta $55k, venta 50k, propina 5k → venta 50k + propina 5k en mismo pago.
2. Efectivo 30k + tarjeta 25k, propina 5k — orden `[efectivo, tarjeta]` y `[tarjeta, efectivo]` → **mismo** resultado (tarjeta: venta 20k + propina 5k; efectivo: venta 30k).
3. Solo efectivo, propina 5k → propina 5k en efectivo.
4. Propina 0 → solo aplicaciones `venta`.
5. `dispatchAsignacionPropina(PROPORCIONAL, ...)` → lanza `BadRequestException` con mensaje `Estrategia de asignación no soportada`.

- [x] **Step 2: Implementar**

Orden estable: `permiteVuelto=false` primero, luego `true`; dentro de cada grupo
`metodoPagoId` ASC. Omitir filas con monto `0`. Usar Decimal.js.

- [x] **Step 3: Ejecutar tests**

```bash
cd backend && npm test -- asignacion-propina.spec.ts
```
Expected: PASS

- [x] **Step 4: Commit**

```bash
git commit -m "feat(pagos): algoritmo determinista NO_VUELTO para split propina"
```

---

### Task 3: `VentaPropinaService`

**Files:**
- Create: `backend/src/modules/propinas/venta-propina.service.ts`
- Create: `backend/src/modules/propinas/venta-propina.service.spec.ts`
- Modify: `backend/src/modules/propinas/propinas.module.ts` — export service.

**Interfaces:**
- Produces:
  ```typescript
  export interface CrearVentaPropinaInput {
    tenantId: string;
    ventaId: string;
    garzonId: string;
    porcentajeSugerido: string; // '0.10'
    montoSugerido: string;
    montoPagado: string;
  }
  async crearEnTransaccion(
    manager: EntityManager,
    input: CrearVentaPropinaInput,
  ): Promise<VentaPropina>
  ```
- Consumes: `VentaPropina` entity, Decimal.js.

- [x] **Step 1: Tests**

- `monto_pagado === monto_sugerido` → `tipo=sugerida`, `estado=pagada` (si >0).
- `monto_pagado=0` → `estado=sin_propina`, `tipo=manual` si sugerido >0.
- `monto_pagado` distinto de sugerido → `tipo=manual`.

- [x] **Step 2: Implementar `crearEnTransaccion`**

Validar `montoPagado >= 0`. Persistir con `manager.save`.

- [x] **Step 3: Tests**

```bash
cd backend && npm test -- venta-propina.service.spec.ts
```

- [x] **Step 4: Commit**

```bash
git commit -m "feat(propinas): servicio de registro venta_propina"
```

---

### Task 4: Extender `PagosService.registrar` con aplicaciones

**Files:**
- Modify: `backend/src/modules/pagos/pagos.service.ts`
- Modify: `backend/src/modules/pagos/pagos.service.spec.ts`

**Interfaces:**
- Consumes: `calcularAplicacionesNoVuelto`, `dispatchAsignacionPropina`, `PagoAplicacion`.
- Produces — firma extendida de `registrar`:
  ```typescript
  async registrar(
    manager: EntityManager,
    params: {
      tenantId: string;
      ventaId: string;
      pagos: PagoItemDto[];
      cajaId: string;
      monedaOficialId: string;
      target: string; // total_final + propinaMonto cuando hay tip
      propinaMonto?: string; // default '0'
      ventaPropinaId?: string | null;
      estrategia?: EstrategiaAsignacionPropina; // default NO_VUELTO
    },
  ): Promise<{ pagos: Pago[]; montoAplicadoVenta: string }>
  ```

- [x] **Step 1: Tests — registrar sin propina**

Target 100, un pago efectivo 100 → una aplicación `venta` 100, `montoAplicadoVenta=100`.

- [x] **Step 2: Tests — registrar con propina mixta**

Target 55k (venta 50k + tip 5k), efectivo 30k + tarjeta 25k → aplicaciones según Task 2; `montoAplicadoVenta=50k`.

- [x] **Step 3: Implementar**

Flujo:
1. Calcular vuelto sobre `target` (igual que hoy).
2. Construir `PagoNetoInput[]` con índices estables.
3. `dispatchAsignacionPropina(estrategia ?? NO_VUELTO, ...)`.
4. Por cada pago guardado, insertar filas `PagoAplicacion` (`referencia_id`: `ventaId` para venta, `ventaPropinaId` para propina si existe).
5. Sumar `montoAplicadoVenta` desde aplicaciones calculadas.
6. Movimientos caja sin cambio (`monto - vuelto`).

- [x] **Step 4: Actualizar `registrarAbono`**

Pasar `propinaMonto: '0'`; debe seguir creando solo aplicación `venta`.

- [x] **Step 5: Ejecutar tests**

```bash
cd backend && npm test -- pagos.service.spec.ts
```

- [x] **Step 6: Commit**

```bash
git commit -m "feat(pagos): persistir pago_aplicaciones al registrar pagos"
```

---

### Task 5: Integrar `VentasService` y `SalonesService`

**Files:**
- Create: `backend/src/modules/ventas/dto/propina-cierre-mesa.dto.ts`
- Modify: `backend/src/modules/ventas/dto/create-venta.dto.ts`
- Modify: `backend/src/modules/ventas/ventas.module.ts`
- Modify: `backend/src/modules/ventas/ventas.service.ts`
- Modify: `backend/src/modules/salones/dto/cerrar-cuenta.dto.ts`
- Modify: `backend/src/modules/salones/salones.service.ts`
- Modify: `backend/src/modules/salones/salones.service.spec.ts`

**Interfaces:**
- `PropinaCierreMesaDto`: `montoPagado`, `montoSugerido?`, `porcentajeSugerido?`, `garzonId`, `estrategia?`.
- `CreateVentaDto.propinaCierreMesa?: PropinaCierreMesaDto`.
- `CerrarCuentaDto`: `propinaMonto?`, `propinaSugerida?`, `propinaPorcentajeSugerido?` (`@IsNumberString`, `@IsOptional`).

- [x] **Step 1: Tests `salones.service.spec` — cerrar con propina**

Mock ventas/pagos o integración ligera:
- `cerrarCuenta` pasa `propinaCierreMesa` con `garzonId = cuenta.garzonResponsableId`.
- `target` de pagos = `total_final + propinaMonto`.
- `propinaMonto` omitido → `'0'`.

- [x] **Step 2: Modificar `crearEnTransaccion`**

Después de crear cabecera venta (paso 7a) y antes de pagos:
- Si `dto.propinaCierreMesa`: llamar `ventaPropinaService.crearEnTransaccion`.
- `targetCobro = totalFinal + propinaMonto`.
- Llamar `pagosService.registrar` con `propinaMonto`, `ventaPropinaId`, `estrategia`.
- Estado venta: `calcularEstadoVenta(totalFinal, montoAplicadoVenta)` — **no** usar bruto de pagos.

- [x] **Step 3: Modificar `cerrarCuenta`**

```typescript
const propinaMonto = dto.propinaMonto ?? '0';
if (new Decimal(propinaMonto).lt(0)) {
  throw new BadRequestException('Propina inválida');
}
const ventaDto: CreateVentaDto = {
  // ...lineas existentes...
  propinaCierreMesa: {
    montoPagado: propinaMonto,
    montoSugerido: dto.propinaSugerida ?? propinaMonto,
    porcentajeSugerido: dto.propinaPorcentajeSugerido ?? '0.10',
    garzonId: cuenta.garzonResponsableId!,
    estrategia: EstrategiaAsignacionPropina.NO_VUELTO,
  },
  pagos: dto.pagos,
  // ...
};
```

Validar que `garzonResponsableId` no sea null (400 si falta).

- [x] **Step 4: Ejecutar tests**

```bash
cd backend && npm test -- salones.service.spec.ts ventas.service.spec.ts
```

- [x] **Step 5: Commit**

```bash
git commit -m "feat(salones): cierre de cuenta con propina separada de la venta"
```

---

### Task 6: Lectura en `GET /ventas/:id`

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.ts` (`findOne`)
- Test: extender spec existente o añadir caso en `ventas.service.spec.ts` si existe.

**Interfaces:**
- Response añade:
  ```typescript
  propina: null | {
    id: string;
    porcentajeSugerido: string;
    montoSugerido: string;
    montoPagado: string;
    tipo: string;
    estado: string;
    garzonId: string;
    garzonNombre: string | null;
  }
  pagos[].aplicaciones: { tipo: string; monto: string; referenciaId: string | null }[]
  pagos[].montoAplicadoVenta?: string  // derivado al serializar
  pagos[].montoAplicadoPropina?: string
  ```

- [x] **Step 1: JOIN `venta_propina` + garzones en `findOne`**

- [x] **Step 2: Cargar `pago_aplicaciones` por pago**

- [x] **Step 3: Test manual vía spec o e2e ligero**

- [x] **Step 4: Commit**

```bash
git commit -m "feat(ventas): exponer propina y aplicaciones en detalle"
```

---

### Task 7: Frontend — composable y modal de cobro

**Files:**
- Create: `frontend/app/composables/usePropina.ts`
- Create: `frontend/app/composables/usePropina.spec.ts`
- Modify: `frontend/app/components/ventas/CobroModal.vue`
- Modify: `frontend/app/pages/salones/index.vue`
- Modify: `frontend/app/composables/useSalones.ts`

**Interfaces:**
- `sugerirPropina(total: string, porcentaje = '0.10'): string` — half-up 0 decimales.
- `CobroModal` props nuevas opcionales:
  - `modoPropina?: boolean` (default false — POS sin cambios)
  - `ventaTotal?: string`
  - Emite `confirmar` igual; el padre ya conoce `propinaMonto` via v-model o segundo emit.

Enfoque recomendado: `CobroModal` con `v-model:propinaMonto` cuando `modoPropina=true`;
muestra filas Venta / Propina / Total a pagar; `total` computado internamente =
`ventaTotal + propinaMonto`.

- [x] **Step 1: Tests `usePropina.spec.ts`**

```typescript
expect(sugerirPropina('50000')).toBe('5000')
expect(sugerirPropina('50001')).toBe('5000') // half-up según caso documentado
expect(sugerirPropina('0')).toBe('0')
```

- [x] **Step 2: Extender `useSalones.cerrarCuenta`**

Body incluye `propinaMonto`, `propinaSugerida`, `propinaPorcentajeSugerido`.

- [x] **Step 3: `CobroModal` modo propina**

Solo activo desde salones (`modo-propina`). POS no pasa la prop.

- [x] **Step 4: `salones/index.vue`**

```vue
<VentasCobroModal
  v-model:open="cobroOpen"
  modo-propina
  :venta-total="totalFinal"
  v-model:propina-monto="propinaMonto"
  :metodos="metodos"
  :submitting="submitting"
  @confirmar="confirmarCobro"
/>
```

En `confirmarCobro` / `cerrarCuentaConPin` enviar campos propina.
Toast si `propinaMonto > 0`: "Cuenta cerrada — propina registrada".

- [x] **Step 5: Ejecutar tests front**

```bash
cd frontend && npm run test -- usePropina.spec.ts
cd frontend && npm run build
```

- [x] **Step 6: Commit**

```bash
git commit -m "feat(salones): UI de propina en cierre de cuenta"
```

---

### Task 8: Detalle de venta y documentación

**Files:**
- Modify: `frontend/app/components/ventas/VentaDetalleDrawer.vue`
- Modify: `docs/features/salones-mesas.md`
- Modify: `docs/ESTADO.md`
- Modify: `docs/superpowers/specs/2026-07-17-registro-propinas-design.md`

- [x] **Step 1: Mostrar bloque propina en drawer** (si `venta.propina`)

Líneas: % sugerido, monto sugerido, monto pagado, garzón.

- [x] **Step 2: Opcional — desglose aplicaciones por pago** (colapsable o texto muted)

- [x] **Step 3: Actualizar docs**

`salones-mesas.md`: body cierre, invariantes, ejemplo cobro mixto.
`ESTADO.md`: fila "Registro de propinas al cerrar cuenta" ✅.

- [x] **Step 4: Verificación final**

```bash
cd backend && npm test && npm run build
cd frontend && npm run build
```

Manual (checklist spec):
1. Cerrar mesa tip 10%.
2. Editar tip.
3. Tip $0.
4. Mixto efectivo+tarjeta — ver aplicaciones en detalle venta.
5. Arqueo caja cuadra.

- [x] **Step 5: Commit**

```bash
git commit -m "docs: registrar propinas en salones y estado del proyecto"
```

---

## Verification

| Requisito spec | Task |
|---|---|
| `venta_propina` siempre en cierre mesa | 1, 3, 5 |
| `pago_aplicaciones` extensible | 1, 4 |
| Cobro venta + propina | 4, 5, 7 |
| Estrategia `NO_VUELTO` | 2, 4 |
| % y monto sugerido congelados | 3, 5, 7 |
| Estado venta solo por aplicaciones venta | 4, 5 |
| Caja con total recibido | 4 |
| Solo mesa (no POS/online) | 5, 7 |
| `GET /ventas/:id` con propina | 6, 8 |
| Backfill pagos legacy | 1 |

## Decisions (locked)

- No columnas `monto_aplicado_*` en `pagos`.
- `referencia_id` en aplicaciones: `venta_id` / `venta_propina_id`.
- Impresión boleta en salones: fuera de D (totales actuales sin propina en ticket hasta impresión futura); no bloquear D.
