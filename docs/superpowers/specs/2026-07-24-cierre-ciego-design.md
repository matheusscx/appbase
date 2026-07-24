# Cierre ciego (blind count) — Design Spec

**Fecha:** 2026-07-24
**Estado:** ✅ Aprobado por el owner — listo para plan de implementación
**Sub-proyecto:** B de 3 del refactor de arqueo (A multi-medio → **B ciego** → C motivos)
**Depende de:** [`docs/superpowers/specs/2026-07-24-arqueo-multimedio-design.md`](2026-07-24-arqueo-multimedio-design.md) (A, ya implementado y en `main`)
**Investigación:** [`docs/agent/investigaciones/2026-07-23-gestion-caja.md`](../../agent/investigaciones/2026-07-23-gestion-caja.md) (§6 poderes del encargado / cierre ciego)
**Feature relacionada:** [`docs/features/gestion-cajas.md`](../../features/gestion-cajas.md)

---

## Contexto

En un **cierre ciego** el cajero cuenta el cajón **sin ver el monto esperado** — declara lo que
contó y recién ahí el sistema le muestra la diferencia. Es el estándar anti-fraude: si el cajero
ve el esperado, un faltante se puede "maquillar" declarando justo el número esperado. Bsale y
Toteat lo traen de fábrica en Chile (el cajero cuenta ciego, el supervisor sí ve el esperado —
§6 de la investigación).

El sub-proyecto **A** dejó el punto de cambio preparado: `obtenerArqueo` (`caja.service.ts`) ya
tiene el comentario *"en modo ciego retendrá `esperado`"*. B activa esa retención detrás de una
config por tenant, **con enforcement en el backend** — ocultar el esperado solo en la UI no sirve
(el dato viaja igual en la respuesta y es evadible). B **no** toca el flujo de cálculo ni de
congelado de A; solo cambia **qué revela el `GET /caja/:id/arqueo` mientras la caja está abierta**.

## Recordatorio del dominio (para no romper invariantes)

- **Dinero y porcentajes con Decimal.js**, nunca `number`. El esperado/contado/diferencia son Decimal.
- **`tenant_id`/`usuario_id` del token**, nunca del body.
- **Soft delete en todo**; toda lectura filtra `eliminado_el IS NULL`.
- El **cierre sigue owner-only** (`MiCaja:Actualizar`); B no lo cambia. El cierre forzado del
  encargado sigue diferido (§6).
- El motor de precios, `movimientos_inventario` y el sistema JWT **no se tocan**.
- **"Congelar el hecho transaccional":** el arqueo se congela al cerrar exactamente como en A. El
  modo ciego **no** altera el congelado ni la validación server-side del cierre.

## Alcance

**Incluido:**
- Config por tenant `tenants.arqueo_ciego` (booleano) + endpoint `GET`/`PUT /caja/arqueo-ciego` +
  toggle en la página de configuración de Cajas.
- Enforcement en `obtenerArqueo`: en modo ciego con caja abierta, **retener el `esperado`** y
  **filtrar a las líneas obligatorias**. La respuesta del endpoint pasa a `{ ciego, lineas }`.
- Frontend: drawer de cierre en **modo ciego** (inputs sin esperado ni diferencia en vivo);
  revelación por **redirección al detalle** de la caja cerrada tras el cierre ciego.

**Fuera de alcance (siguen diferidos):**
- **Cierre forzado del encargado** + campo `cerrada_por` + **aprobación por umbral** (§6).
- **Ocultar el resultado *después* del cierre** al cajero (pertenece a la conciliación del
  supervisor, §6). En B, al enviar, el cajero **sí** ve su diferencia.
- **Sub-proyecto C** (motivos categorizados + catálogo).

## Decisiones de diseño (tomadas con el owner, 2026-07-24)

1. **Activación por config de tenant, no por permiso de rol:** `tenants.arqueo_ciego` (booleano,
   default `false`). La distinción cajero/supervisor ya la dan los módulos `MiCaja`/`Cajas`.
2. **Retención total mientras la caja está abierta:** en modo ciego, **nadie** ve el `esperado`
   de una caja abierta — ni el dueño ni el supervisor. Regla simple **`ciego && abierta`**, sin
   ramificar por rol. (Se apartó del estándar de mercado, donde el supervisor sí lo ve, a favor
   de una regla más estricta y más simple; decisión explícita del owner.)
3. **El drawer ciego muestra solo las obligatorias:** efectivo + métodos con `requiere_conteo`
   (lo que el cajero **debe** contar). Las informativas (no-efectivo sin `requiere_conteo`) se
   **ocultan** — sin esperado no aportan nada al conteo ciego. El endpoint, en ciego+abierta, ni
   siquiera las envía (mínimo leak).
4. **Revelación al cerrar por redirección al detalle:** tras un cierre ciego, en vez de volver a
   `/mi-caja`, se **redirige a `/mi-caja/:id`** (detalle), que ya muestra el `CajaArqueoTable`
   congelado (esperado/contado/diferencia) — reusa el componente de A, cero UI nueva — más un
   toast con la diferencia de efectivo. En modo normal el flujo de A no cambia (vuelve a
   `/mi-caja`; el cajero ya vio la diferencia en vivo).
5. **`cerrar` no cambia:** ya recomputa y congela el esperado server-side (nunca confió en el
   cliente). El modo ciego solo cambia el `GET` previo; la validación, el congelado y la respuesta
   del `POST /cerrar` (que devuelve `{ caja, arqueo }` con esperado+diferencia) son idénticos a A —
   esa respuesta **es** la revelación.

## Modelo de datos

**`tenants` (existente) — se agrega una columna:**

| Columna | Tipo | Constraints | Notas |
|---|---|---|---|
| `arqueo_ciego` | BOOLEAN | NOT NULL, default `false` | Política por tenant; junto a `calculo_descuentos`/`monto_tolerancia` |

No hay tablas nuevas. El congelado del cierre sigue en `caja_arqueo_medio` (A), sin cambios.

## Backend — config del modo ciego

Endpoint chico bajo el módulo caja (mismo módulo/permiso que la página que lo edita):

- **`GET /caja/arqueo-ciego`** (`@RequiresPermiso('Cajas','Leer')`) → `{ arqueoCiego: boolean }`.
  Lee `tenants.arqueo_ciego` del tenant del token (`WHERE tenant_id = $1 AND eliminado_el IS NULL`).
- **`PUT /caja/arqueo-ciego`** (`@RequiresPermiso('Cajas','Actualizar')`), body
  `{ arqueoCiego: boolean }` (`@IsBoolean`), setea la columna. Tenant del token.

Service (`caja.service.ts`, query raw parametrizada, estilo del módulo):
- `getArqueoCiego(tenantId): Promise<boolean>`
- `setArqueoCiego(tenantId, valor: boolean): Promise<void>`

El cajero **no** consume estos endpoints: se entera del modo ciego por el flag `ciego` de
`GET /caja/:id/arqueo`.

## Backend — enforcement en `obtenerArqueo`

`obtenerArqueo(tenantId, usuarioId, cajaId, tieneVerTodas)` cambia su retorno de `LineaArqueo[]`
a **`{ ciego: boolean, lineas: LineaArqueo[] }`**:

```
1. verificarAccesoCaja (igual que hoy).
2. ciego = await getArqueoCiego(tenantId)
3. Si caja.estado === 'abierta':
     lineas = await calcularArqueo(cajaId, tenantId, manager)   // preview (A)
     Si ciego:
       lineas = lineas
         .filter(l => l.esEfectivo || l.requiereConteo)          // solo obligatorias
         .map(l => ({ ...l, esperado: null }))                   // retener esperado
       return { ciego: true, lineas }
     return { ciego: false, lineas }
   Si caja.estado === 'cerrada':
     return { ciego: false, lineas: <líneas congeladas de A> }    // SIEMPRE revela
```

- **Caja cerrada → `ciego:false` siempre**, con las líneas congeladas completas (esperado/
  contado/diferencia). El modo ciego es una propiedad del **conteo en curso**, no del histórico.
- El `esperado` retenido se representa como `null` en las líneas obligatorias del preview ciego.
  `LineaArqueo.esperado` (backend) **y** `ArqueoLinea.esperado` (frontend, `stores/caja.ts`) pasan
  de `string` a `string | null` para admitirlo. En caja cerrada y en modo normal el `esperado`
  nunca es null; el null solo aparece en el preview ciego, donde el drawer no lo renderiza.
- **Anti-fraude:** el esperado ni siquiera viaja en la respuesta en modo ciego+abierta; no hay
  forma de leerlo desde el cliente (ni dueño ni supervisor).

**Impacto en los 3 consumidores del endpoint (contrato de A):** la respuesta pasó de array a
objeto. Se adaptan:
- `stores/caja.ts` `cargarArqueo`: lee `.lineas` (→ estado `arqueo`) y `.ciego` (→ estado nuevo
  `arqueoCiego`).
- `CajaCierreDrawer.vue`: además de `cajaStore.arqueo`, lee `cajaStore.arqueoCiego`.
- Detalle read-only (`mi-caja/[id]`, `cajas/[id]`): siguen leyendo `cajaStore.arqueo` (las líneas);
  para una caja cerrada `ciego` es `false` y las líneas vienen completas → sin cambios de render.

## Frontend

**`configuracion/cajas.vue` — toggle nuevo.** Junto a la gestión de cajones, un toggle "Arqueo
ciego" que carga con `GET /caja/arqueo-ciego` y persiste con `PUT`. Guardado por el permiso
`Cajas` (igual que el resto de la página). Componente `USwitch`/`UCheckbox` del design system.

**`CajaCierreDrawer.vue` — modo ciego.** Al abrir, `cargarArqueo` ya trae `{ ciego, lineas }`. Si
`arqueoCiego === true`:
- Renderiza **solo el grupo "A conciliar"** (las obligatorias que llegaron), con inputs de contado
  **sin la línea "Esperado $…"** y **sin la diferencia en vivo** (no hay esperado).
- El grupo "Informativas" no aparece (el endpoint no las mandó).
- El gate de submit (`obligatoriasCompletas`) sigue igual: todas las obligatorias con contado. No
  depende del esperado.
- Al enviar: `cerrar(cajaId, { lineas, comentario })` como en A; luego el drawer navega
  (`navigateTo`) a **`/mi-caja/:id`** (detalle) y muestra un toast con la diferencia de efectivo de
  la respuesta. La redirección aplica **desde cualquier origen del drawer** (detalle de Mi caja,
  dashboard o POS): el cierre ya termina la sesión de venta, así que llevar al cajero al detalle a
  ver el resultado es coherente en los tres casos.

En **modo normal** (`arqueoCiego === false`) el drawer se comporta exactamente como en A
(esperado visible, diferencia en vivo, grupos obligatorias/informativas, vuelve a `/mi-caja`).

## Reglas de negocio

1. En modo ciego, con la caja **abierta**, el `esperado` **no** se entrega a nadie (dueño ni
   supervisor) por `GET /caja/:id/arqueo`. Enforcement en el backend, no solo en la UI.
2. En modo ciego, el drawer y el endpoint operan **solo sobre las obligatorias** (efectivo +
   `requiere_conteo`). Las informativas no se muestran ni se envían.
3. Al **cerrar**, el cajero ve su diferencia (la respuesta del `POST /cerrar` revela
   esperado+diferencia; el detalle de la caja cerrada las muestra congeladas).
4. La **caja cerrada** siempre revela el arqueo completo (esperado/contado/diferencia). El modo
   ciego afecta solo el conteo en curso, no el histórico.
5. `cerrar` recomputa y congela el esperado server-side, idéntico a A. El modo ciego no cambia la
   validación de completitud ni el congelado.
6. `tenant_id`/`usuario_id` del token; soft delete; Decimal.js. La caja virtual no se afecta.
7. Cambiar `arqueo_ciego` afecta los cierres **desde ese momento**; no reescribe arqueos ya
   congelados.

## Testing

- **Unit** (`caja.service.spec`): `obtenerArqueo` con tenant ciego + caja abierta → `ciego:true`,
  líneas filtradas a obligatorias, `esperado` en `null`; tenant no-ciego → `ciego:false`, líneas
  completas con esperado; caja **cerrada** → `ciego:false` siempre, líneas congeladas reveladas.
  `getArqueoCiego`/`setArqueoCiego` (lectura/escritura de `tenants.arqueo_ciego`, filtro
  `eliminado_el IS NULL`).
- **Unit** (`caja.controller.spec`): `GET`/`PUT /caja/arqueo-ciego` con los permisos `Cajas:Leer`/
  `Cajas:Actualizar`; el arqueo sigue por lectura compartida.
- **E2E** (`caja.e2e-spec`): setear `arqueo_ciego=true` para el tenant → abrir caja, vender →
  `GET /caja/:id/arqueo` devuelve `ciego:true`, **sin `esperado`** y solo obligatorias; el
  **cierre igual cuadra** (el server recomputa); la **caja cerrada** revela las líneas congeladas
  con esperado/diferencia (`ciego:false`). Aserciones derivadas de la **regla documentada**.
- **Smoke navegador:** toggle "Arqueo ciego" ON → abrir caja → drawer sin esperado ni diferencia
  en vivo → cerrar → redirige al detalle mostrando el arqueo revelado. Consola sin errores.

## Seed

`seeder.service.ts`: `tenants.arqueo_ciego = false` por defecto (lo da el default de la columna;
no se siembra nada nuevo). Los tenants de demo quedan en modo normal.

## Backward-compat (etapa de desarrollo)

- Columna `arqueo_ciego`: la crea `synchronize` al bootstrap (dev/CI), default `false` → **todos
  los tenants siguen en modo normal**; el comportamiento de A queda intacto salvo que el admin
  active el toggle.
- **Cambio de forma de la respuesta de `GET /caja/:id/arqueo`** (`LineaArqueo[]` → `{ ciego,
  lineas }`): es un breaking interno absorbido por los 3 consumidores de A en el mismo cambio. No
  hay clientes externos.
- Cajas ya cerradas: sin efecto (siempre `ciego:false`, líneas congeladas de A o cuadre agregado
  para las viejas sin filas).

## Docs a actualizar (mismo commit que el código)

- `docs/features/gestion-cajas.md` — modo ciego (config, enforcement, endpoint), forma nueva de la
  respuesta del arqueo, comportamiento del drawer ciego y la revelación al cerrar.
- `docs/ESTADO.md` — fila de la feature (cierre ciego).
- `docs/agent/investigaciones/2026-07-23-gestion-caja.md` §9 / `docs/agent/pendientes.md` — marcar
  B hecho; §6 (cierre forzado, umbral, ocultar resultado post-cierre) sigue diferido.
- `startup-pos.sql` — columna `arqueo_ciego` en `tenants`.

## Criterios de aceptación

- [ ] `tenants.arqueo_ciego` (BOOLEAN NOT NULL default false).
- [ ] `GET`/`PUT /caja/arqueo-ciego` (`Cajas:Leer`/`Cajas:Actualizar`), tenant del token.
- [ ] `obtenerArqueo` devuelve `{ ciego, lineas }`; en ciego+abierta retiene `esperado` (null) y
  filtra a obligatorias; cerrada siempre `ciego:false` con líneas reveladas.
- [ ] Los 3 consumidores de A adaptados a la respuesta `{ ciego, lineas }`; `arqueoCiego` en el store.
- [ ] Toggle "Arqueo ciego" en `configuracion/cajas.vue`.
- [ ] Drawer en modo ciego: solo obligatorias, sin esperado ni diferencia en vivo; gate de submit
  intacto; al cerrar redirige al detalle + toast.
- [ ] Modo normal (default) sin cambios de comportamiento respecto de A.
- [ ] `tenant_id`/`usuario_id` del token; soft delete; Decimal.js; virtual sin afectar.
- [ ] Unit + e2e verdes; smoke del drawer ciego.
- [ ] Docs actualizadas (gestion-cajas.md, ESTADO.md, §9/pendientes.md, startup-pos.sql).

---

## Relación con el roadmap del refactor de arqueo

- **A — Arqueo multi-medio** (hecho, en `main`): esperado por método; arregló el faltante fantasma.
  Dejó preparado el punto de retención del esperado en `obtenerArqueo` que B usa.
- **B — Cierre ciego** (este spec): retiene el esperado durante el conteo, por config de tenant.
- **C — Motivos + catálogo CRUD** (siguiente): motivo categorizado por línea que descuadra. Se
  monta sobre el flujo de cierre de A; independiente de B.
