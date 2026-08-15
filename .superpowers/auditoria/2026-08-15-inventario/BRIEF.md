# Brief común — auditoría `inventario` + `mermas` + `recuentos` + conversión de unidades

Sos un **buscador de una sola lente** en la pasada 3 del programa de auditoría de
`startup-app` (SaaS POS multi-tenant: NestJS + Nuxt 4 + Postgres 15). Método completo:
`docs/agent/auditoria-codigo.md`.

**Tu trabajo es encontrar defectos reales en código que YA pasó todos los gates** (lint,
typecheck, unit, e2e, CI y revisión de diff). Por eso no busques errores de escritura
reciente: buscá **deuda estructural que ningún gate mira** — una fórmula que quedó vieja
cuando llegó una feature nueva, una validación que solo existe en el cliente, una rama que
nunca tuvo test, dos caminos que deberían coincidir y no coinciden.

## ⛔ Reglas que hacen que esto sirva

1. **Una sola lente: la tuya.** Sos ciego a las demás a propósito. Si ves algo de otra
   lente, ignoralo — hay otro agente en eso. Sin superposición no hay relleno para llegar
   al cupo.
2. **Todo hallazgo trae `archivo:línea` del código actual, verificado ABRIENDO el archivo.**
   No cites de memoria ni de un grep. Un buscador que tiene que abrir el archivo para citar
   la línea descarta solo sus propias corazonadas.
3. **Todo hallazgo trae escenario reproducible**: inputs y estado concretos → resultado
   incorrecto. "Podría fallar" no es un escenario.
4. **Tope: 6 hallazgos.** No los completes. **Cero hallazgos es un resultado válido y
   bueno** — esta pasada existe para producir confianza, no inventario. Si tu lente sale
   limpia, decilo y contá qué revisaste para poder afirmarlo (ej: "las 43 queries, una por
   una").
5. **Si algo de este brief no coincide con lo que leés en el código, PARÁ y reportá
   `BLOCKED`** con la discrepancia. El brief lo escribí de memoria y puede estar mal; vos
   tenés el archivo abierto y yo no. Un BLOCKED es señal, no fricción.

## Alcance

**Backend** (`backend/src/modules/`):
- `inventario/` — kardex, movimientos, CPP, ajuste de costo (1.091 líneas)
- `recuentos/` — recuento de inventario (986)
- `mermas/` — mermas y causas de merma (939)
- `motivos-diferencia-inventario/` (590)
- `catalog/catalog.service.ts` — **solo** conversión de unidades (`convertirUnidad`,
  `crearConversor`, `findAllUnidadesMedida`). El resto de `catalog` (países, monedas,
  permisos) es de otra pasada.
- **La costura de stock en `ventas/ventas.service.ts` e `items/items.service.ts`** — solo
  por donde escriben o leen stock/movimientos/costo. Esos dos módulos ya se auditaron
  enteros desde su propio lado (jul-2026); acá interesa el kardex como cuerpo, no ellos.

**Tests del alcance:** `backend/src/modules/{inventario,recuentos,mermas,catalog}/**/*.spec.ts`
y `backend/test/{inventario,mermas,recuentos,simulador-costos}.e2e-spec.ts`.

**Frontend** (`frontend/app/`):
- `pages/inventario/index.vue`, `pages/inventario/recuentos/index.vue`,
  `pages/inventario/recuentos/[id].vue`
- `pages/mermas.vue`, `pages/configuracion/causas-merma.vue`,
  `pages/configuracion/motivos-diferencia-inventario.vue`
- `components/DevolucionInventarioLista.vue`
- `composables/useDevolucionInventario.ts`, `useRecuentoInventario.ts`, `useUnidadConversion.ts`

## Invariantes del proyecto (romperlas ES el hallazgo)

- **`tenant_id` sale siempre del token**, nunca del body, query ni parámetro de ruta.
- **Dinero y porcentajes con `Decimal.js`**, nunca `number` nativo. Porcentajes en decimal
  (`0.19` = 19%).
- **Soft delete en todo.** Nunca `DELETE` físico; se marca `eliminado_el`. **Toda lectura
  filtra `eliminado_el IS NULL`** — incluidos los `JOIN`.
- **Nunca una query por iteración (N+1).** El dato derivado por fila se resuelve en una
  sola query (`JOIN`/agregación) o batch con `WHERE id = ANY($1)`.
- **Permisos con enforcement real en el backend** (guards por ruta). Validar en el frontend
  no sustituye al guard.
- **Solo `tipo='producto'` tiene stock.** `movimientos_inventario` es la fuente de verdad
  auditable; `item_producto.stock` es **saldo materializado**. Movimiento y saldo se
  escriben **en la misma transacción**. `modo_inventario` es **inmutable** si ya hay
  movimientos.

## Contexto del esquema (no te confundas con esto)

- **`startup-pos.sql` es documentación, NO se ejecuta.** El esquema real lo crea TypeORM
  por `synchronize` desde las entidades. Si una entidad y el `.sql` no coinciden, **manda
  la entidad** — y esa divergencia en sí puede ser un hallazgo, pero verificalo contra la
  entidad antes de reportarlo.
- El seed vive en `backend/src/modules/seeder/seeder.service.ts` y corre al arrancar.
- Docs funcionales del alcance: `docs/features/inventario-kardex.md`,
  `inventario-serializado.md`, `mermas-valorizadas.md`, `recuento-inventario.md`,
  `simulador-impacto-costos.md`, y **ADR-007** (serie/lote).
- Playbook de patrones: `docs/patterns/backend.md`, `docs/patterns/frontend.md`.
- Errores de patrón ya cometidos en este repo: `docs/agent/anti-patterns.md`.

## 🚫 YA CONOCIDO — no lo reportes, ya está en el backlog

Reportar cualquiera de estos gasta tu cupo sin agregar nada:

1. **CPP y mermas redondean con `HALF_UP` fijo, sin `modo_redondeo`** —
   `inventario.service.ts` (CPP: `valorPrevio + valorEntrante` ÷ stock) y
   `mermas.service.ts` (dos sitios, costo × cantidad). Ya anotado, es 🔴 prioridad máxima.
2. **`convertirUnidad` pedido sin `manager` dentro de una transacción** —
   `mermas.service.ts:124`, `items.service.ts:1477,2044`,
   `grupos-modificadores.service.ts:910`. Es parte del deadlock de conexiones ya medido
   (🔴 prioridad máxima). **La tabla `unidad_medida` solo la escribe el seeder**, medido.
3. **Filtros de rango por fecha pura dependientes del `TimeZone` de sesión** —
   `mermas.service.ts:268,272` e `inventario.service.ts:788,792`. Ya anotado con su
   corrección (el molde de `propina-reportes` NO es copiable tal cual).
4. **El recuento no cubre `modo_inventario` en `serie` ni `lote`** — ya anotado como
   feature diferida con decisión de negocio pendiente.
5. **`registrarMovimientoEnTransaccion` no tiene test propio** — decisión explícita: se
   ejercita indirectamente en cada venta que mueve stock.
6. **No hay idempotencia en la creación de venta** (doble clic = dos ventas) — anotado para
   producción.
7. **El e2e corre con `maxWorkers: 1`**, así que ningún test ve concurrencia real. Ya
   anotado. Podés apoyarte en el dato, no lo reportes como hallazgo.

Si encontrás una **variante distinta** de alguno de estos (otro sitio, otro mecanismo),
**sí reportala** — pero decí explícitamente en qué se diferencia del conocido.

## Formato de salida (obligatorio)

Tu texto final ES el resultado; no escribas mensaje para humanos, escribí el reporte.

```
## Lente: <nombre de tu lente>
## Veredicto: <N hallazgos> | LIMPIA | BLOCKED

### Qué revisé para poder afirmarlo
<2-5 líneas concretas y contables: qué archivos, cuántas queries/rutas/ramas, con qué
criterio. Esto es tan importante como los hallazgos: es lo que convierte "no encontré nada"
en "está limpio".>

### H1. <título corto y falsable>
- **Severidad:** alta | media | baja
- **Ubicación:** `ruta/archivo.ts:NN` (abrí el archivo: sí)
- **Qué está mal:** <1-3 frases>
- **Escenario:** <inputs y estado concretos → resultado incorrecto observable>
- **Por qué ningún test lo caza:** <el test que debería existir, o el que existe y no mata
  el mutante>
- **Confianza:** alta | media | baja — <qué te faltaría para subirla>

### H2. ...
```

Severidad: **alta** = plata equivocada, datos corruptos, o fuga entre tenants. **media** =
comportamiento incorrecto sin corromper. **baja** = defensa en profundidad o cosmético.
