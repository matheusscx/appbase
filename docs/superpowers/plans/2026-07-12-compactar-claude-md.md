# Plan: Compactar CLAUDE.md y sus documentos enlazados

**Status**: Done
**Date**: 2026-07-12
**Owner**: Cesar Matheus

## Context

`CLAUDE.md` (18 KB ≈ 5.5k tokens) se inyecta en **cada sesión** de Claude Code, y además ordena leer `docs/patterns/backend.md` (15 KB) + `docs/patterns/frontend.md` (21 KB) antes de cada planificación (~9k tokens extra por plan). El costo crece con cada feature porque la tabla "Estado actual" (40+ filas con descripciones largas) vive dentro de CLAUDE.md. Objetivo: reducir el contexto fijo ~60% sin perder información — todo lo recortado se **mueve** a docs on-demand (que solo se leen cuando hacen falta), no se borra.

## Scope / Out of scope

**In scope:** `CLAUDE.md`, `docs/patterns/backend.md`, `docs/patterns/frontend.md`, nuevo `docs/ESTADO.md`, ajuste de referencias cruzadas.
**Out of scope:** `docs/PRODUCTO.md`, `docs/ARCHITECTURE.md`, ADRs, `docs/features/*` (solo se leen on-demand, no consumen contexto fijo).

## Tareas

### 1. Crear `docs/ESTADO.md`
- [x] Mover íntegra la tabla "Estado actual" de CLAUDE.md (sin recortar filas).
- [x] Agregar link en `docs/README.md`.

### 2. Compactar `CLAUDE.md` (18 KB → ~7 KB)
- [x] **Estado actual** → puntero a `docs/ESTADO.md` + recordatorio de mantenerlo.
- [x] **Visión / Arquitectura**: quitar árbol de directorios y mapa de puertos (duplican `docs/ARCHITECTURE.md`).
- [x] **Decisiones de arquitectura**: conservar lo normativo diario; comprimir a 1-2 líneas + link las secciones con doc propio (inventario → ADR-007 + feature doc; precios, ventas, cajas, pagos → sus feature docs).
- [x] **Convenciones**: regla UUID → 2 líneas + link ADR-004; seed → 3 líneas (detalle en backend.md §8).
- [x] **Planes de implementación**: comprimir a ~5 líneas.
- [x] Tabla "Documentación viva": fila de estado apunta a `docs/ESTADO.md`.

### 3. Compactar `docs/patterns/backend.md` (15 KB → ~8 KB)
- [x] Mantener preámbulo de reglas transversales y tabla de guards (§4).
- [x] Recortar bloques de código a su esencia + referencia al archivo real (entity §2, SQL raw §6, registry §13).
- [x] §12 "Docs vivas": puntero de tabla Estado → `docs/ESTADO.md`.

### 4. Compactar `docs/patterns/frontend.md` (21 KB → ~10 KB)
- [x] §8 Monedas: dejar resumen + archivos de referencia; el detalle ya vive en `docs/features/configuracion-monedas.md`.
- [x] §3/§4: fusionar en una sección con un solo snippet.
- [x] §14: comprimir a lista de 3 pasos + choques en una línea cada uno.
- [x] Conservar completos §7 (string decimales) y §2 (esqueleto de página).

### 5. Verificación
- [x] `wc -c CLAUDE.md docs/patterns/*.md` — confirmar metas (~7 KB / ~8 KB / ~10 KB).
- [x] Grep de referencias rotas a "Estado actual" / `ESTADO.md`.
- [x] Revisión de no-pérdida: cada bloque eliminado tiene destino (ESTADO.md, ADR o feature doc).
- [x] Commit directo a `main`.
