# Plan: NxM de verdad (lleva N, paga M)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- **Status:** Done
- **Date:** 2026-10-13
- **Owner:** Cesar Matheus

**Goal:** que una promo `nxm` se configure como "lleva N, paga M" y el motor regale las N−M unidades
más baratas de cada grupo, con el porcentaje topado en 100% por unidad regalada.

**Architecture:** una columna `paga_m` junto a `cada_n`, validada en el service (espejo del CHECK).
Solo cambia `evaluarNxm`: el motor ya maneja aplicaciones con montos en varias líneas (el combo).
La pantalla suma un campo "Paga" y reescribe la ayuda.

**Tech Stack:** NestJS + TypeORM (migraciones, ADR-030), Decimal.js, Jest + supertest, Nuxt 4 + Nuxt UI, Vitest.

**Spec:** [`docs/superpowers/specs/2026-10-13-nxm-lleva-n-paga-m-design.md`](../specs/2026-10-13-nxm-lleva-n-paga-m-design.md)

## Global Constraints

- Plata y porcentajes con Decimal.js; el porcentaje en decimal (`1` = 100%).
- `pagaM` es requerido en `nxm`, `1 ≤ pagaM < cadaN`, y prohibido en `porcentaje` y `precio_fijo`.
- `valorPorcentaje` de `nxm` ≤ 1; el de `porcentaje` sigue < 1.
- El grupo incompleto no recibe nada (owner, 2026-10-13).
- El % del formulario arranca vacío con el placeholder "1.00 (gratis)" (owner, 2026-10-13).
- La migración hace `paga_m = cada_n - 1` para los `nxm` existentes antes del CHECK.
- Los e2e de 2x1 existentes solo suman `pagaM: 1` y dan los mismos montos.
- Prefijo de cada comando: `export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH"`.

## Review Focus

1. **Las regaladas de un grupo caen en dos líneas** (3x1 con $1.000 ×2 en una línea y $800 en otra): un monto por línea, con la suma exacta. Lo fija la Task 3 (unit) y la Task 4 (e2e POS + congelado por línea).
2. **Un PATCH que cambia de `nxm` a `porcentaje` sin mandar `pagaM`**: el estado resultante conserva el `pagaM` viejo y tiene que dar 400, no un 500 del CHECK. Task 2.
3. **Un PATCH que solo cambia `cadaN` a un valor ≤ `pagaM` guardado**: 400 por estado resultante. Task 2.
4. **La interacción con el greedy**: dos grupos de un 3x1 en una sola línea de 6 unidades no chocan entre sí. Task 3.
5. **Etiqueta con IVA incluido**: un 3x1 sobre $993 cobra $993 exacto. Task 4.

---

### Task 1: Esquema — columna, CHECK, migración, seed

**Files:**
- Modify: `backend/src/modules/promociones/entities/promocion.entity.ts`
- Create: `backend/src/database/migrations/<timestamp>-NxmPagaM.ts` (generada)
- Modify: `startup-pos.sql`
- Modify: `backend/src/modules/seeder/seeder.service.ts` (el "2x1 de la casa" y el combo, que manda `cadaN: null`)

**Produces:** columna `paga_m smallint NULL`, entity `pagaM: number | null`.

- [x] Entity: `@Column({ name: 'paga_m', type: 'smallint', nullable: true }) pagaM: number | null;` junto a `cadaN`, y el CHECK:

```ts
`("tipo" = 'porcentaje' AND "valor_porcentaje" IS NOT NULL AND "cada_n" IS NULL AND "paga_m" IS NULL AND "valor_monto" IS NULL)
 OR ("tipo" = 'nxm' AND "valor_porcentaje" IS NOT NULL AND "cada_n" IS NOT NULL AND "paga_m" IS NOT NULL AND "paga_m" >= 1 AND "paga_m" < "cada_n" AND "valor_monto" IS NULL)
 OR ("tipo" = 'precio_fijo' AND "valor_monto" IS NOT NULL AND "valor_porcentaje" IS NULL AND "cada_n" IS NULL AND "paga_m" IS NULL)`
```

- [x] `./scripts/entorno.sh db`, arrancar las migraciones de main sobre esa base (`npm run migration:run`), y `npm run migration:generate -- NxmPagaM`.
- [x] Leer la migración y agregar a mano en `up`, entre el `ADD COLUMN` y el `ADD CONSTRAINT`: `UPDATE "promociones" SET "paga_m" = "cada_n" - 1 WHERE "tipo" = 'nxm'`, con un comentario que diga por qué (el demo conserva filas; `cada_n − 1` es la regla anterior, exacta). `down` deshace en orden inverso.
- [x] `npm run migration:run` y `npm run migration:check` → exit 0.
- [x] Seed: `pagaM: 1` en el 2x1 y `pagaM: null` donde va `cadaN: null`. Comentario del 2x1: "lleva 2, paga 1".
- [x] `startup-pos.sql`: la columna y el CHECK.

### Task 2: Contrato — DTO, service, carga para el motor

**Files:**
- Modify: `backend/src/modules/promociones/dto/create-promocion.dto.ts`
- Modify: `backend/src/modules/promociones/promociones.service.ts`
- Modify: `backend/src/modules/promociones/promociones.evaluator.ts` (solo `PromoElegible.pagaM`)
- Test: `backend/src/modules/promociones/promociones.service.spec.ts`

**Produces:** `PromoElegible.pagaM: number | null`; `cargarVigentes` lo lee de `p.paga_m`.

- [x] Tests que fallan en `promociones.service.spec.ts` (`create` con un nxm válido, molde de los existentes):
  - `nxm` sin `pagaM` → 400 `/pagaM es requerido/`.
  - `nxm` con `pagaM: 2, cadaN: 2` → 400 `/pagar menos/`.
  - `porcentaje` con `pagaM: 1` → 400 `/pagaM no corresponde/`; ídem `precio_fijo`.
  - `nxm` con `valorPorcentaje: '1.0001'` → 400 `/100 %/`; con `'1'` → OK.
  - `update` de un nxm guardado con `cadaN` 3, `pagaM` 2: con `{ cadaN: 2 }` → 400 (estado resultante 2/2); con `{ tipo: 'porcentaje', valorPorcentaje: '0.1', cadaN: null }` sin `pagaM` → 400 (estado resultante conserva `pagaM`).
  - `update` de un nxm guardado con `valorPorcentaje: '2'` (fila vieja) con `{ activo: false }` → OK; con `{ activo: true }` → 400.
  - `cargarVigentes` mapea `paga_m` → `pagaM`.
- [x] Correr: `npx jest src/modules/promociones/promociones.service.spec.ts` → FAIL.
- [x] DTO: `pagaM?: number | null` con `@IsOptional() @IsInt() @Min(1) @Max(MAX_SMALLINT)`, docblock "Solo `nxm`: cuántas paga de cada `cadaN` (2x1 → 1, 3x1 → 1, 4x2 → 2)". Arreglar el docblock de `valorPorcentaje`: en `nxm` es el % de cada unidad regalada.
- [x] Service: `FormaSegunTipo.pagaM`; `validarFormaSegunTipo` exige/prohíbe `pagaM` y valida `pagaM < cadaN` ("Una promoción NxM tiene que pagar menos unidades de las que lleva"); `validarTopeDelPorcentaje` gana la rama `nxm` (`> 1` → 400 "En una promoción NxM el descuento de cada unidad regalada es como máximo 100 % (1.00)"); `create` persiste `pagaM`; `update` arma `forma.pagaM` como `cadaN`; `cargarVigentes` agrega `p.paga_m` al SELECT, a `FilaPromoVigente` y al mapeo. Actualizar el docblock de `validarTopeDelPorcentaje` (ya no "el nxm queda afuera").
- [x] Correr el spec → PASS. Arreglar los fixtures de `promociones.evaluator.spec.ts`, `promociones.evaluator.oraculo.spec.ts` y `calculo-precios.service.spec.ts` que arman `PromoElegible` (agregar `pagaM`: `cadaN − 1` en nxm, `null` en los otros).

### Task 3: Evaluador — las N−M más baratas

**Files:**
- Modify: `backend/src/modules/promociones/promociones.evaluator.ts` (`evaluarNxm`, docblock)
- Test: `backend/src/modules/promociones/promociones.evaluator.spec.ts`
- Test: `backend/src/modules/promociones/promociones.evaluator.oraculo.spec.ts`

**Consumes:** `PromoElegible.pagaM` (Task 2).

- [x] Tests que fallan (`describe('evaluarPromos — nxm lleva N paga M')`, helper `nxm({ cadaN, pagaM, valorPorcentaje })`):
  - 3x1, línea 0 = $1.000 ×2, línea 1 = $800 ×1 → 1 aplicación, `montosPorLinea` `[{0, '1000'}, {1, '800'}]`, `unidadesPorLinea` implícito vía greedy (verificar con un segundo nxm que no puede reusar).
  - 4x2, cuatro líneas $1.500 / $1.200 / $1.000 / $700 → 1 aplicación, montos `{2: 1000}`, `{3: 700}`.
  - 3x1 con $1.200, $1.000, $1.000, $800, $500 (cinco líneas) → 1 aplicación, montos en las líneas de $1.000 (suma 2000); las de $800 y $500 sin monto.
  - 3x1 con una línea de 5 × $1.000 → 1 aplicación, `{0: '2000'}`.
  - 3x1 con una línea de 6 × $1.000 → 2 aplicaciones de `'2000'` cada una (greedy por conteo, no chocan).
  - 2x1 al 0.5 con $1.000 y $800 → `{1: '400'}` (igual que hoy).
  - 4x2 al 0.5 con dos líneas: $1.000 ×3 y $600 ×1 → regaladas = una de $1.000 y la de $600 → `{0: '500'}`, `{1: '300'}`.
- [x] Correr: `npx jest src/modules/promociones/promociones.evaluator.spec.ts` → FAIL (hoy regala una sola).
- [x] Implementar: en cada grupo, `tramosRegalados = ultimasUnidades(tramos, cadaN − pagaM)` (recorre los tramos desde el final y recorta el primero que cruza); monto por línea = `valor × precioLista × unidades`, sumando por `lineaIndex` en el orden de los tramos; descartar el grupo si la suma no es > 0. La memoria del monto compara los tramos regalados con `mismosTramos([a], [b])` en vez del lote de la barata. Docblock: "lleva N, paga M; las N−M más baratas; el grupo incompleto no aplica (owner, 2026-10-13)".
- [x] Oráculo: el generador (`cadaN: 2 + …`) y `nxm(cadaN, …)` arman `pagaM: cadaN − 1`; el evaluador anterior embebido no cambia. Correr el oráculo → PASS (M = N−1 da lo mismo que antes).
- [x] Correr los dos specs → PASS.
- [x] **Mutantes** (uno por vez, revertir y confirmar verde): (a) regalar solo la última unidad (`cadaN − pagaM` → `1`): tienen que caer el 3x1 y el 4x2 y quedar verde el oráculo; (b) regalar las primeras en vez de las últimas: cae el 4x2 mezclado; (c) sacar la rama `nxm` del tope en el service: cae el test de 1.0001.

### Task 4: e2e — de punta a punta

**Files:**
- Modify: `backend/test/promociones.e2e-spec.ts`
- Modify: `backend/test/cantidad-grande-promo.e2e-spec.ts`, `backend/test/decimal-no-plata-no-cabe.e2e-spec.ts`, `backend/test/topes-dto.e2e-spec.ts` (sumar `pagaM: 1` donde crean un `nxm`)

- [x] El `describe('2x1 (nxm)')` existente suma `pagaM: 1`; sus montos (1000 y 1000) no cambian.
- [x] Nuevo `describe('NxM: lleva N, paga M')`:
  - `/calcular` 3x1 con ítem A $1.000 ×2 y B $800 ×1 (exentos) → `totalDescuentos` 1800, `totalFinal` 1000.
  - `POST /ventas` (POS) con el mismo carrito → `totalFinal` 1000; `GET /ventas/:id` → `promociones` con una fila por línea regalada (montos 1000 y 800, misma `aplicacion`).
  - Cuenta de salón (garzón propio, molde del `describe('Cuenta de salón')`): agregar A ×2 y B ×1, cerrar → `totalDescuentos` 1800.
  - Online (`canal: 'online'`, pago completo de $1.000 en efectivo) → `totalFinal` 1000.
  - 3x1 con 5 unidades de $1.000 → `totalFinal` 3000.
  - Góndola: ítem $993 con `precioIncluyeImpuesto: true`, 3x1, cantidad 3 → `totalFinal` 993.
  - 400s: sin `pagaM`; `pagaM` ≥ `cadaN`; `pagaM: 0`; `valorPorcentaje: '1.5'` en nxm.
- [x] `./scripts/reset-db.sh` (o base nueva con `entorno.sh db`) y correr los cuatro specs → PASS.
- [x] Mutante (a) de la Task 3 sobre el e2e: tienen que caer `/calcular`, POS, cuenta, online y góndola.

### Task 5: Pantalla de promociones

**Files:**
- Modify: `frontend/app/composables/usePromociones.ts` (tipos + `resumenNxm`, `ayudaNxm`)
- Modify: `frontend/app/utils/promociones-form-config.ts` (`labelPorcentaje`, `ayudaPorcentaje` de nxm)
- Modify: `frontend/app/pages/configuracion/promociones.vue`
- Test: `frontend/app/utils/promociones-form-config.spec.ts`, `frontend/app/pages/configuracion/promociones.nuxt.spec.ts`, spec del composable si existe (`usePromociones.spec.ts`; si no, sumarlo al de form-config)

- [x] Tests que fallan:
  - `resumenNxm({ cadaN: 3, pagaM: 1, valorPorcentaje: '1.0000' })` → `'Lleva 3, paga 1'`; con `cadaN 2, pagaM 1, '0.5000'` → `'Lleva 2, paga 1 · regalada al 50%'`; con `cadaN 4, pagaM 2, '0.5'` → `'Lleva 4, paga 2 · regaladas al 50%'`.
  - `ayudaNxm(3, 1)` → `'De cada 3 unidades, las 2 más baratas llevan el descuento.'`; `ayudaNxm(2, 1)` → `'De cada 2 unidades, la más barata lleva el descuento.'`; `ayudaNxm(null, …)` / `M ≥ N` → `''`.
  - Página: con tipo `nxm` el drawer muestra "Lleva", "Paga" y "Descuento en cada unidad regalada"; el input del % tiene placeholder "1.00 (gratis)" y arranca vacío; el body del `POST` lleva `pagaM`; al cambiar a `porcentaje`, `pagaM` viaja `null`.
  - form-config: la ayuda de nxm dice "máximo 1.00".
- [x] `npx vitest run <specs>` → FAIL.
- [x] Implementar: `Promocion.pagaM`, `PromocionPayload.pagaM`; `emptyForm.pagaM: null`; `onTipoChange` lo limpia; `abrirEditar` lo carga; `guardar` lo manda solo si `cfg.campoCadaN`; los campos "Lleva" y "Paga" en una fila (`flex gap-4`, tokens semánticos), `UInput type="number" :min="2"` y `:min="1"`, placeholders `2` y `1`; el hint `ayudaNxm(form.cadaN, form.pagaM)`; el % con placeholder por tipo (`placeholderPorcentaje` en la config: nxm `'1.00 (gratis)'`, porcentaje `'0.10 (= 10%)'`); `resumenValor` usa `resumenNxm`. `labelPorcentaje` nxm: "Descuento en cada unidad regalada"; `ayudaPorcentaje` nxm: "1.00 = gratis · 0.50 = a mitad de precio · máximo 1.00". `TIPO_PROMOCION_OPTIONS`: "N x M (ej. 2x1, 3x1, 4x2)".
- [x] `npx vitest run <specs>` → PASS. Ajustar los textos que el spec existente busca ("Cada cuántas unidades", "Porcentaje sobre la unidad más barata del grupo") a los nuevos.
- [x] Mockup ya aprobado por el owner (spec § 7); smoke en el navegador con el stack (Task 7).

### Task 6: Docs

- [x] `docs/features/motor-promociones.md`: `nxm` en § El evaluador (lleva N paga M, N−M más baratas, sobrantes, tope ≤ 1 con su procedencia), el párrafo de `porcentaje` que decía "el `nxm` no tiene tope", el modelo de datos (`paga_m`) y la migración `cada_n − 1` (derivación exacta, no copia), § Pantalla. Last Updated.
- [x] `docs/PRODUCTO.md`: la regla de promos NxM.
- [x] `docs/ESTADO.md`: fila del motor de promociones.
- [x] `docs/agent/pendientes.md` → mover la entrada a `docs/agent/resueltos.md` con el detalle del fix.

### Task 7: Gate

- [x] Back: `npm run lint:check`, `npm run typecheck`, `npm test`, `test:e2e` entero (reset antes, `--verificar` después).
- [x] Front: `npm run build`, `npm test`, `npm run typecheck:ratchet`, `npm run design:check`.
- [x] Pedir el stack a la orquestadora → `entorno.sh borrar` → `entorno.sh stack` → `reset-db.sh` → Playwright entero → smoke de la pantalla → `entorno.sh borrar --purgar`.
- [x] `verify-feature` con domain-reviewer; commit sobre `origin/main` en la rama, sin push.
- [x] Mensaje a la orquestadora: SHA, ejemplos medidos, gate.

## Decisions / Open questions

Todas cerradas (spec § 2).
