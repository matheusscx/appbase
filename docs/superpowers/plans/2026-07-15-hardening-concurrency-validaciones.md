# Hardening concurrency y validaciones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar TOCTOU (check→mutate sin lock) en salones, inventario, caja y comandas; validar costos/factores `> 0`; alinear `costo_actual` solo a entradas con motivo `compra`.

**Architecture:** Locks pesimistas `SELECT … FOR UPDATE` anclan la serialización (mesa, cuenta, `item_producto`, caja, líneas de comanda). Claim atómico de comanda avanza `cantidad_enviada` antes de imprimir. Validaciones Decimal.js rechazan `<= 0` cuando el valor está presente.

**Tech Stack:** NestJS + TypeORM, PostgreSQL 15, Decimal.js, Jest, Nuxt 4.

**Status**: Done
**Date**: 2026-07-15
**Owner**: Cesar Matheus

## Global Constraints

- Soft delete, `tenant_id` del token, Decimal.js para dinero/cantidades, UUID `type: 'uuid'` (ADR-004).
- Commits en `main` (sin ramas/PRs en etapa de desarrollo).
- Fuera de alcance: recetas; reembolso pasarela (ya endurecido).

## Decisions

| Tema | Elección |
|---|---|
| `costo_actual` | Solo si `entrada` + `motivo === 'compra'` + `costoUnitario != null` |
| Costos / factores | Rechazar `<= 0` cuando presente; `NULL` OK |
| Comanda | Claim atómico bajo `FOR UPDATE` antes de imprimir |
| Caja | `FOR UPDATE` sobre `cajas` antes de saldo/egreso |

## Tasks

- [x] Task 1: Salones — `FOR UPDATE` en `abrirCuenta` (mesa) y `cerrarCuenta` (cuenta)
- [x] Task 2: Inventario — lock unidad en `ajustarStock`; costo solo compra; validar costo `> 0`
- [x] Task 3: `factor_base > 0` en `convertirUnidad` + CHECK en `startup-pos.sql`
- [x] Task 4: Caja — `FOR UPDATE` antes de saldo (movimientos, cierre, NC)
- [x] Task 5: Comanda — claim atómico + FE `useImpresoras`
- [x] Task 6: Docs vivas + verificación suite

## Verification

- [x] `cd backend && npm test` (salones, inventario, catalog, caja, ventas)
- [x] `cd backend && npx tsc --noEmit` (errores preexistentes en `auth.service.spec` / mock de `ventas.service.spec`, ajenos a este plan)

- [x] Docs: `docs/ESTADO.md` + features tocadas

**Status**: Done
