# CLAUDE.md

Guía para Claude Code (claude.ai/code) al trabajar en este repositorio.

---

## ⛔ Invariantes — violarlas es detenerse, no corregir

Si una tarea requiere romper alguna de estas reglas: **detenerse, reportar el conflicto
y esperar confirmación.** Nunca resolverlo por cuenta propia.

1. **`tenant_id` sale siempre del token** del usuario autenticado — nunca del body,
   query ni parámetro de ruta.
2. **Dinero y porcentajes con Decimal.js**, nunca `number` nativo. Porcentajes en
   decimal: `0.19` = 19%, nunca `19`.
3. **Soft delete en todo.** Nunca `DELETE`; marcar `eliminado_el`. Toda lectura filtra
   `eliminado_el IS NULL`.
4. **Toda columna PK/FK de UUID declara `type: 'uuid'` explícito**
   ([ADR-004](docs/adr/004-uuid-column-types.md)).
5. **No modificar el sistema de tokens JWT** (access + refresh, ya implementado).
6. **"Exento" es un estado fiscal explícito**, nunca la ausencia de impuesto.
7. **Permisos con enforcement real en el backend** (guards por ruta). Validar en el
   frontend nunca sustituye al guard.

## 🛑 Detenerse y preguntar

No asumir reglas de negocio. Detenerse y consultar al usuario si la tarea:

- toca el **motor de cálculo de precios** o el cálculo de impuestos;
- escribe en **`movimientos_inventario`** o altera `modo_inventario`;
- requiere una regla de negocio que **no esté documentada** en `docs/PRODUCTO.md`
  ni en `docs/features/`;
- rompe compatibilidad **multi-tenant**, **multi-moneda**, **fiscal (SII)** o de
  **auditoría**;
- exige una **dependencia nueva** (verificar antes si el stack actual la resuelve).

## 🔧 Alcance del trabajo

No refactorizar código fuera del alcance solicitado. Solo intervenir código ajeno
a la tarea cuando: hay un bug que impide que la tarea funcione, rompe la compilación
o los tests, bloquea la implementación pedida, o el usuario lo solicita explícitamente.

Si existen dos formas de resolver algo en el proyecto, seguir la ya existente.
No introducir una arquitectura nueva para un problema pequeño.

## 🔎 Orden de búsqueda — antes de grep/find/Read exploratorio

1. `docs/patterns/backend.md` y `docs/patterns/frontend.md` (playbook de-facto)
2. `docs/features/<feature>.md`, `docs/ARCHITECTURE.md`, ADRs
3. **CodeGraph** — `codegraph_explore` (MCP, cargar vía tool search si aparece
   diferida) o `codegraph explore "<símbolos o pregunta>"` por shell. Devuelve código
   fuente + call paths en una llamada, más barato en tokens que leer archivos sueltos.
4. Código fuente

Si tras estos cuatro pasos el patrón no aparece, **preguntar** en vez de inventarlo.

## ⚠️ Flujo de trabajo — etapa de desarrollo

El proyecto está en **desarrollo activo**. **No crear ramas nuevas ni PRs**: trabajar
y commitear **directamente sobre `main`**. Como no hay PR que sirva de red, el
[checklist de cierre](#-checklist-antes-de-dar-una-tarea-por-terminada) es obligatorio
antes de cada commit.

---

## Visión — SaaS POS Multi-tenant

Sistema SaaS de punto de venta y facturación **multi-tenant**: cada tenant (empresa)
opera aislado con su propio catálogo, monedas, impuestos, usuarios, roles y ventas.
Un usuario puede pertenecer a varios tenants y opera en uno a la vez.

Monorepo full-stack **Docker-first** (`docker-compose up` levanta todo; no requiere
Node.js/PostgreSQL local):

- **backend/** — NestJS (TypeScript), API REST puerto 3000 (Swagger en `3000/api/docs`)
- **frontend/** — Nuxt 4 (Vue 3), SPA/SSR puerto 5173
- **PostgreSQL 15** — puerto 5432

Estructura de directorios, mapa de módulos y flujo de requests: `docs/ARCHITECTURE.md`.

## Comandos

```bash
docker-compose up            # Stack completo (preferido); --build reconstruye imágenes
docker-compose down -v       # Detener y borrar el volumen de la BD

cd backend
npm run start:dev            # Watch mode
npm run lint | npm test | npm run test:e2e   # test:e2e = API (Jest + supertest)

cd frontend
npm run dev | npm run build
```

Config vía `.env` en la raíz (copiar `.env.example`). Backend lee `DATABASE_URL`,
`JWT_SECRET`, `PORT`, `API_PREFIX`; frontend lee `VITE_API_URL`.

**Git hook (una vez por clone):** `git config core.hooksPath .githooks` activa el
pre-commit (`.githooks/pre-commit`), que bloquea el casing malo de `tenant_id`, el
`DELETE` físico y errores de `lint:check` sobre backend staged. No cubre N+1 ni el
filtro de borrado (juicio) — eso es la revisión independiente del skill `verify-feature`.
Escape puntual: `git commit --no-verify`.

## Estado actual

El estado de todas las funcionalidades (✅/🔲 con fechas) y el roadmap viven en
**`docs/ESTADO.md`**. Consultarlo para saber qué existe y **actualizarlo en el mismo
commit** que implementa o cambia una feature.

---

## Terminología (crítico — no mezclar)

| Concepto | Tabla DB | Nombre en código/docs |
|---|---|---|
| Empresa que contrata el SaaS | `tenants` | **tenant** |
| Comprador final en una venta | `venta_customer` | **customer** |
| Entidad externa (proveedor, empresa) | `terceros` | **tercero** |

## Reglas de dominio — qué leer antes de tocar qué

Lo mínimo para decidir si hay que leer más. El detalle vive en un solo lugar.

- **Permisos** — `rol → módulo contratado (tenant_modulos) → permisos`. Superadmin es
  un eje aparte (`es_superadmin`, rutas `/admin/*`, guard propio). El rol `admin` del
  tenant es fijo y automático.
- **Monedas** — la moneda oficial viene del país, no la elige el tenant. Tasas por
  tenant en `tenant_moneda`. Los totales de venta se persisten convertidos a la
  moneda oficial.
- **Motor de precios** — `precioNeto → pasos según tenant_formula_precio → totalFinal`;
  cada paso aplica sobre el acumulado. Lo modulan `items.precio_incluye_impuesto` y
  `tenants.calculo_descuentos`.
  → Antes de tocarlo: `docs/features/motor-calculo-precios.md`.
- **Fiscal (SII)** — la emisión electrónica llega a futuro; se diseña compatible sin
  integrarla. Regla: congelar el hecho fiscal en la transacción, diferir lo que solo
  transmite o formatea. No construir infraestructura DTE especulativa.
  → Antes de tocar impuestos o documentos tributarios: **ADR-010**.
  → Detalle funcional: `docs/features/impuestos.md`.
- **Ventas** — canales `'fisico'` (requiere caja abierta) y `'online'`. Estados
  `borrador → pendiente → pagada | cancelada`, más `pagada_parcial` derivado. Tipos de
  documento por país desde tabla, no enum.
  → Antes de tocar estados, saldos o notas de crédito: `docs/features/ventas.md`.
- **Cajas** — `'fisica'` (apertura manual, una abierta por tenant+usuario) y
  `'virtual'` (una por tenant, siempre abierta).
  → Antes de tocar apertura/cierre o cuadratura: `docs/features/gestion-cajas.md`.
- **Inventario** — solo `tipo='producto'` tiene stock. `movimientos_inventario` es la
  fuente de verdad auditable; `item_producto.stock` es saldo materializado. Movimiento
  y saldo en una transacción. `modo_inventario` es inmutable con movimientos existentes.
  → Antes de tocar stock: `docs/features/inventario-serializado.md` y **ADR-007**.
- **Pagos** — múltiples pagos por venta; `vuelto` solo si `permite_vuelto = true`.
  → Detalle: `docs/features/pagos.md`.
- **BD** — timestamps `creado_el`/`actualizado_el`, PKs UUID, items como modelo base +
  extensión (`item_producto`, `item_servicio`, `item_suscripcion`).

---

## Convenciones

Los patrones completos están en `docs/patterns/backend.md` y `docs/patterns/frontend.md`
— leerlos antes de planificar. Aquí solo lo que no se deduce del código:

- Al crear un tenant, sembrar automáticamente: rol admin, fórmula de precio por
  defecto, caja virtual.
- **Seed:** fuente de verdad `backend/src/modules/seeder/seeder.service.ts` (corre al
  arrancar). IDs fijos, patrón `550e8400-e29b-41d4-a716-446655440XXX` — usar el
  siguiente número libre. Detalle: `docs/patterns/backend.md` §8.
- **Backend:** feature en `src/modules/<nombre>/`, registrada en `app.module.ts`. DTOs
  con `class-validator`. Controller valida y delega; el service tiene la lógica. **Nunca
  una query por iteración (N+1):** el dato derivado por fila se resuelve en una sola
  query (`JOIN`/agregación) o batch con `WHERE id = ANY($1)`. Toda `SELECT`/`JOIN` nueva
  filtra `eliminado_el IS NULL`. Ejemplos: `docs/agent/anti-patterns.md`.
- **Frontend:** `$fetch`/`useApiFetch`, nunca axios. Runtime config pública con prefijo
  `VITE_`. Utilidades de presentación en composables de `app/composables/`, nunca
  locales a un `.vue`. Las páginas no contienen lógica de negocio.
- **Design System:** tokens semánticos de Nuxt UI, nunca Tailwind hardcoded. Excepción:
  colores financieros en el módulo Caja. Referencia: `frontend/docs/DESIGN-SYSTEM.md`
  y `frontend/app.config.ts`.
- **Archivos:** no crear uno nuevo si la implementación cabe en uno existente. Evitar
  `utils.ts`/`helpers.ts`/`common.ts`/`misc.ts`. Sin helpers de un solo uso; duplicar
  dos veces es aceptable, se extrae a la tercera.

**Ejemplos ❌/✅ de los errores ya cometidos aquí: `docs/agent/anti-patterns.md` — leer
antes de implementar.**

## Planes de implementación

Los planes se persisten en `docs/superpowers/plans/YYYY-MM-DD-<kebab-slug>.md` (formato
y metadata en `docs/superpowers/README.md`). Flujo: el agente redacta el plan → el
usuario lo edita → pasa la ruta → el agente lo ejecuta tarea por tarea marcando los
checkboxes. `specs/` es diseño y contexto; `plans/` son pasos ejecutables.

## Documentación viva (actualizar en el mismo commit que el código)

| Tipo de cambio | Archivo(s) a actualizar |
|---|---|
| Nueva feature implementada | `docs/features/<feature>.md` (desde `TEMPLATE.md`) + link en `docs/README.md` + fila en `docs/ESTADO.md` |
| Cambia el estado de una funcionalidad | `docs/ESTADO.md` |
| Cambio arquitectónico / estructural | `docs/ARCHITECTURE.md` |
| Decisión técnica importante | Nuevo ADR en `docs/adr/` + índice `docs/adr/README.md` |
| Cambio en reglas de negocio | `docs/PRODUCTO.md` |
| Nueva convención de código/doc | `docs/CONVENTIONS.md` |
| Patrón backend/frontend nuevo o cambiado | `docs/patterns/backend.md` o `docs/patterns/frontend.md` |
| Bug de patrón que se repitió | `docs/agent/anti-patterns.md` |

La documentación describe **el porqué y las reglas de negocio**, no repite el código.
Corta y accionable.

## ✅ Checklist antes de dar una tarea por terminada

Ejecutar, no afirmar. Si algo falla, la tarea no está terminada.

```bash
cd backend  && npm run lint:check && npm test && npm run test:e2e
cd frontend && npm run build && npm run typecheck:ratchet
```

`nuxt build` **no tipa-chequea**; `typecheck:ratchet` (vue-tsc vs
`frontend/typecheck-baseline.json`) falla solo si un archivo mete errores de tipo
**nuevos** — la deuda preexistente se quema por tandas con `-- --update`.

Además verificar:

- [ ] Sigue las convenciones y los patrones existentes del proyecto
- [ ] No se refactorizó nada fuera del alcance pedido
- [ ] Documentación actualizada según la tabla de arriba
- [ ] Sin `TODO`, sin código comentado, sin código muerto
- [ ] Ninguna invariante violada

Procedimiento completo: skill `verify-feature`.

## Archivos de referencia

| Archivo | Contenido |
|---|---|
| `docs/patterns/` | **Playbook backend/frontend — leer ANTES de planificar una feature** |
| `docs/agent/anti-patterns.md` | Errores reales ya cometidos en el repo |
| `docs/agent/README.md` | Por qué este setup está escrito así |
| `docs/ESTADO.md` | Estado de todas las funcionalidades y roadmap |
| `docs/PRODUCTO.md` | Especificación funcional completa con reglas de negocio |
| `startup-pos.sql` | Esquema de BD completo |
| `backend/src/modules/seeder/seeder.service.ts` | Fuente de verdad del seed (corre al arrancar) |
