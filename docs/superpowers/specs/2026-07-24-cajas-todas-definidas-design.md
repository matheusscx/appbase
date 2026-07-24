# Spec — `/cajas`: mostrar todas las cajas definidas + su estado

**Fecha:** 2026-07-24
**Estado:** aprobado, listo para plan
**Alcance:** backend (endpoint de supervisión + filtro de historial) + frontend (grid + historial).

## Objetivo

`/cajas` hoy muestra **solo las cajas abiertas** y permite abrir la caja propia (card
sintética "Abrir mi caja"). Se cambia a:

1. Mostrar **todos los cajones activos definidos** en el tenant, con su estado
   (ocupado / libre).
2. **Eliminar** la opción de abrir la caja propia desde `/cajas`. La apertura ocurre
   únicamente en `/mi-caja`.
3. Al hacer click en un cajón **libre**, navegar al **historial de ese cajón**.

## Contexto actual

- `pages/cajas/index.vue` → `CajaAbiertasGrid` (llama `cajaStore.cargarAbiertas()`).
- `CajaAbiertasGrid.vue`: card sintética "Abrir mi caja" (abre modal con
  `CajaAperturaForm`) + cards de cajas abiertas (`GET /caja/abiertas`), click → `/cajas/[id]`.
- `GET /caja/abiertas` (guard `Cajas:Leer`) → solo sesiones abiertas del tenant. Es el
  único consumidor de `abiertas`/`cargarAbiertas` (store) y del endpoint.
- Historial (`GET /caja`, `CajaHistorial.vue`, `/cajas/historial`): filtra por `todas` y
  `usuarioId`. **No** filtra por cajón.
- `CajaAperturaForm.vue` se usa en el modal de `CajaAbiertasGrid` **y** ya no en
  `/mi-caja` (que ahora usa `CajaAperturaGrid`). Tras este cambio deja de usarse en
  `/cajas` también → queda sin consumidores.

## Decisiones tomadas (brainstorm)

1. **Solo cajones activos** (`activo=true`). Los inactivos no aparecen.
2. **Card de cajón libre → navega al historial del cajón** (`/cajas/historial?cajonId=X`).
3. **Orden:** ocupados primero (la caja propia arriba), luego los libres (alfabético).
4. **Rename** `CajaAbiertasGrid.vue` → `CajaCajonesGrid.vue` (refleja que muestra todos
   los cajones, no solo los abiertos).
5. **Sin link a Mi caja** en `/cajas`. Las cajas solo se abren desde `/mi-caja`.

## A. Backend — endpoint de supervisión de cajones

**Ruta:** `GET /caja/cajones-estado` — guard `@RequiresPermiso('Cajas', 'Leer')`.

**Service:** `cajonesEstado(tenantId, usuarioId): Promise<CajonEstado[]>`.

Una sola query (sin N+1): cajones activos del tenant `LEFT JOIN` su sesión abierta.

```sql
SELECT cj.cajon_id,
       cj.nombre,
       c.caja_id,
       c.usuario_id,
       u.nombre   AS usuario_nombre,
       u.apellido AS usuario_apellido,
       c.saldo_inicial,
       c.fecha_apertura,
       SUM(m.monto) FILTER (WHERE m.tipo = 'entrada' AND m.eliminado_el IS NULL) AS total_entradas,
       SUM(m.monto) FILTER (WHERE m.tipo = 'salida'  AND m.eliminado_el IS NULL) AS total_salidas
  FROM cajones cj
  LEFT JOIN cajas c
         ON c.cajon_id = cj.cajon_id
        AND c.tipo = 'fisica'
        AND c.estado = 'abierta'
        AND c.eliminado_el IS NULL
  LEFT JOIN usuarios u ON u.usuario_id = c.usuario_id AND u.eliminado_el IS NULL
  LEFT JOIN movimientos_caja m ON m.caja_id = c.caja_id
 WHERE cj.tenant_id = $1
   AND cj.activo = true
   AND cj.eliminado_el IS NULL
 GROUP BY cj.cajon_id, cj.nombre, c.caja_id, c.usuario_id, u.nombre, u.apellido,
          c.saldo_inicial, c.fecha_apertura
 ORDER BY cj.nombre ASC
```

**Forma de retorno** (`saldoEsperado` con `Decimal`, patrón de `abiertas`):

```ts
interface CajonEstado {
  cajonId: string;
  nombre: string;
  sesion: {
    cajaId: string;
    usuarioId: string | null;
    usuarioNombre: string;      // "nombre apellido" || 'Sin usuario'
    saldoInicial: string;       // Decimal.toFixed(4)
    saldoEsperado: string;      // saldoInicial + entradas - salidas
    fechaApertura: Date;
    esPropia: boolean;          // usuarioId === usuarioId del token
  } | null;                     // null = cajón libre
}
```

- `esPropia = row.usuario_id === usuarioId`.
- Invariantes: `tenantId` del token, `eliminado_el IS NULL` en cajones/usuarios/movimientos,
  `Decimal` para montos. Read-only, sin tocar precios/inventario/fiscal.

## B. Backend — filtro `cajonId` en el historial

- `QueryHistorialCajaDto`: agregar `cajonId?: string` con `@IsOptional() @IsUUID()`.
- `buildHistorialFilters`: si `query.cajonId` → `filters += ' AND c.cajon_id = $x'` con
  el `param` correspondiente.
- **Scope:** cuando llega `cajonId` y el usuario tiene `verTodas` (Cajas:Leer), el
  historial del cajón muestra **todas** las sesiones del cajón (todos los usuarios), no
  se restringe al usuario actual. En el controller `historial`, incluir `cajonId` en la
  condición que decide el scope: es "consulta de supervisión" igual que `todas` o
  `usuarioId` de otro. Concretamente, `scope = (query.todas || consultaOtroUsuario ||
  query.cajonId != null) ? verTodas : false`, y el filtro por usuario del builder no se
  aplica cuando hay `cajonId` con `verTodas`.

## C. Frontend — grid `CajaCajonesGrid.vue` (rename de `CajaAbiertasGrid.vue`)

- **Renombrar** el archivo a `app/components/caja/CajaCajonesGrid.vue`. Nuxt auto-importa
  por nombre de archivo → actualizar la referencia en `pages/cajas/index.vue`.
- **Eliminar** la card sintética "Abrir mi caja", el `UModal`, el import/uso de
  `CajaAperturaForm`, `aperturaModalOpen`, `onOpened` y `tieneCajaPropia`.
- Cargar `cajones-estado` vía store (nuevo `cargarCajonesEstado` / `cajonesEstado`).
- **Card ocupada** (`sesion !== null`): mismo contenido que hoy (usuarioNombre, cajón,
  saldo inicial, saldo esperado, apertura, badge "Mía" si `esPropia`),
  clickeable → `navigateTo('/cajas/{sesion.cajaId}')`.
- **Card libre** (`sesion === null`): nombre del cajón + `UBadge` "Libre" (color neutral),
  clickeable → `navigateTo('/cajas/historial?cajonId={cajonId}')`.
- **Orden** (computed): primero las ocupadas (dentro, `esPropia` arriba), luego las
  libres. Base ya viene alfabética del backend.
- Estados: loading spinner; vacío ("No hay cajones activos definidos.") si la lista está
  vacía.

## D. Frontend — store

- Nuevo state `cajonesEstado: CajonEstado[]` + acción `cargarCajonesEstado()` que llama
  `GET /caja/cajones-estado`. Interface `CajonEstado` (y `SesionCajon`) exportada desde
  `stores/caja.ts`.
- **Limpieza:** eliminar `abiertas` / `cargarAbiertas` y el tipo `CajaAbierta` si quedan
  sin uso (solo los usaba `/cajas`), y su test en `caja.spec.ts`.

## E. Frontend — historial por cajón

- `CajaHistorial.vue`: aceptar `cajonId` (prop opcional o `route.query.cajonId`),
  sumarlo a `listFilters`. Cuando hay `cajonId`, ocultar el toggle "Ver todas" (el
  alcance ya es por cajón) y mostrar en el header el contexto (ej. "Historial del cajón").
- `pages/cajas/historial.vue`: leer `?cajonId=` y pasarlo a `CajaHistorial`.

## F. Limpieza backend

- Eliminar `GET /caja/abiertas` (controller) y `CajaService.abiertas` + su tipo
  `CajaAbierta` **si nada más los usa** (verificar unit/e2e en el plan). Si algún test los
  cubre, actualizar/eliminar ese test en el mismo cambio.

## Docs

- `docs/features/gestion-cajas.md`: documentar `GET /caja/cajones-estado`, el filtro
  `cajonId` del historial, el rename del componente y la nueva UX de `/cajas` (sin
  apertura; cajón libre → historial del cajón). Quitar/actualizar la doc de
  `GET /caja/abiertas` y de `CajaAbiertasGrid`.

## Fuera de alcance

- `/mi-caja` (ya refactorizado), apertura/cierre/cuadratura, movimientos.
- Cajones inactivos en la grilla.

## Verificación / cierre

- Gate completo (backend cambia):
  `cd backend && npm run lint:check && npm run typecheck && npm test && npm run test:e2e`
  y `cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check`.
- **Smoke test en navegador** (`/cajas` como supervisor con al menos un cajón ocupado y
  uno libre):
  1. Se ven todos los cajones activos; los ocupados con datos, los libres con badge "Libre".
  2. No aparece ninguna card "Abrir mi caja" ni modal de apertura.
  3. Click en cajón ocupado → `/cajas/[id]`.
  4. Click en cajón libre → `/cajas/historial?cajonId=…` y el historial muestra solo ese
     cajón.
  5. Consola sin errores.

## Invariantes

`tenantId` del token, soft-delete en todas las lecturas, `Decimal` para montos, guard real
`Cajas:Leer`. Sin N+1 (una query con agregación). No toca precios, inventario ni fiscal.
