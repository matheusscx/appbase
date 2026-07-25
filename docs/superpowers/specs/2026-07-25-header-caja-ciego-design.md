# Header de caja — ocultamiento real en modo ciego + fix badge `en_conciliacion`

**Fecha:** 2026-07-25
**Estado:** diseño aprobado, pendiente de plan
**Alcance:** ajuste del header/resumen del turno y de la lista de movimientos para que el
modo ciego (`tenants.arqueo_ciego`) sea **real** (enforcement en backend, no solo visual);
mover su **configuración a admin-only** (que no la pueda apagar un rol operativo); más un
fix independiente del color del badge de estado `en_conciliacion`.

Se monta sobre A (arqueo multi-medio), B (cierre ciego) y C (motivos + cierre en dos
fases), ya en `main`.

---

## 1. Contexto y problema

La página de detalle de una caja (`mi-caja/[id].vue` → `CajaActivaDashboard`) muestra dos
piezas en el header:

- `CajaTurnoResumen` — 4 tarjetas: `Saldo inicial`, `Entradas`, `Salidas`, `Saldo esperado`.
- `CajaMovimientosTable` — la lista de movimientos del turno, con el monto de cada uno.

B ocultó el esperado **en el drawer de cierre** cuando el tenant opera en modo ciego. Pero
el header y la tabla del turno **siguen mostrando todo el tiempo** las cifras que el ciego
debería esconder. Esto produce dos problemas:

1. **Incoherencia:** el drawer dice "contá a ciegas" mientras el header, 2 cm más arriba,
   muestra `SALDO ESPERADO $267.850` durante todo el turno.
2. **Fuga derivable:** `saldoEsperado = saldoInicial + Σentradas − Σsalidas` (se calcula así
   en `caja.service.ts` y se recomputa en el front, `stores/caja.ts` `recalcularSaldoEsperado`).
   Ocultar solo la tarjeta azul deja el número a una resta. Y aunque se tapen las 4 tarjetas,
   **la tabla de movimientos lista cada monto** → sigue siendo sumable.

El objetivo del ciego (anti-fraude) es que el cajero **cuente sin conocer el esperado**, para
que no "cuente hacia atrás" ajustando el conteo al número del sistema. Con la fuga actual, el
ciego no se sostiene.

**Problema de control adicional.** Configurar el modo ciego hoy es un permiso de **módulo**
(`Cajas:Actualizar`), delegable a un rol operativo — tanto en el backend (`PUT
/caja/arqueo-ciego`) como en el front (`configuracion/cajas.vue`). El tenant tiene tres ejes de
rol: el **admin/dueño** (fija la política), el **supervisor contratado** (`Cajas:*`, operativo,
y un posible vector de fraude él mismo) y los **cajeros** (`MiCaja:*`). Que un supervisor con
`Cajas:Actualizar` pueda **apagar el ciego** vuelve la política decorativa: es un agujero mayor
que cualquier fuga de la tabla. La política anti-fraude la fija el dueño, no un rol operativo.

---

## 2. Investigación de mercado (insumo, no verdad)

Cruce con la investigación previa (`docs/agent/investigaciones/2026-07-23-gestion-caja.md`
§5) + una pasada nueva enfocada en la granularidad del ocultamiento.

- **El "blind" es un patrón estándar y es un permiso de rol.** Toast ("3.17 Cash drawers
  (Blind)"), Fudo ("Arqueo ciego"), Toteat ("Cierre Ciego").
- **Efecto documentado y universal:** oculta el **esperado en el momento de contar**. Toast:
  *"If you have the 3.17 Cash drawers (Blind) permission, the Cash expected amount is hidden."*
- **Propósito:** evitar el "contar hacia atrás" (sesgo de confirmación que facilita el skimming).
- **Ver totales/reportes del turno es un permiso SEPARADO** de operar la caja (Dynamics 365:
  `Allow X-report printing`, distinto de vender). El feed de ventas no se le regala al cajero
  ciego automáticamente, pero tampoco lo blanquea el mercado por defecto.
- **Hueco del mercado:** si el esperado corrido se oculta *durante todo el turno* (no solo al
  contar) **no está documentado con claridad** → es decisión de diseño, no hay verdad que copiar.

**Decisión del owner (gana sobre el mercado):** el mercado da el "por qué" (ocultar el esperado
al contar) pero no el "hasta dónde". El owner decide ir **más estricto que Toast/Square**:
durante el turno ciego se oculta **todo el dinero y el feed de movimientos**, y se revela como
**detalle del arqueo** al conciliar. Se acepta el costo operativo (ver §7) a cambio de cerrar la
fuga por completo. Es una decisión de negocio consciente, documentada acá.

---

## 3. Decisiones de diseño

1. **Sin config ni concepto nuevo.** Se reutiliza `tenants.arqueo_ciego` (B) y la máquina de
   estados `abierta → en_conciliacion → cerrada` (C). No hay flag, columna ni permiso nuevo.

2. **El gating de ciego espeja `obtenerArqueo` exactamente.** Una caja está "en ciego" cuando
   `arqueo_ciego(tenant) === true` **y** `caja.estado === 'abierta'`. En cualquier estado ≠
   `abierta` (`en_conciliacion`, `cerrada`) los datos se **revelan** — igual que ya hace
   `obtenerArqueo`. El reveal ocurre al **congelar el conteo** (fase 1 → `en_conciliacion`),
   que es cuando se cierra la ventana anti-fraude.

3. **El ocultamiento es server-side, no solo en la UI** (invariante 6: permisos con enforcement
   real en el backend). El backend no debe devolver las cifras ni los movimientos al operador
   ciego; esconderlos solo en el front dejaría la fuga abierta en devtools.

4. **El modo ciego NO aplica al admin del tenant ni al superadmin; sí al cajero y al supervisor
   no-admin.** *(Reconsiderado 2026-07-25 por el owner — revierte la "decisión A" original de
   "nadie ve en vivo".)* El **admin de un tenant es el dueño absoluto de ese tenant** y el
   **superadmin es el dueño del software** (con acceso directo a la DB): ningún anti-fraude los
   detiene, y si el admin "se roba a sí mismo" es su problema, no el del sistema. Por eso un
   admin/superadmin ve el esperado y los movimientos **en vivo incluso en una caja `abierta`**,
   **incluida la que él mismo opera** (decisión explícita: no se protege al dueño de sí mismo).
   El ciego sigue aplicando a **quien el anti-fraude sí vigila**: el **cajero** (`MiCaja`) y el
   **supervisor contratado** (`Cajas:Leer` sin ser admin) — `Cajas:Leer` **no** es confianza de
   dueño. Para el no-admin el reveal sigue siendo la conciliación / caja cerrada.

   **Criterio único, server-side:** `esAdmin = u.esSuperadmin || userIsTenantAdmin(u.id, tenant)`
   (el `esSuperadmin` viene del token; `userIsTenantAdmin` cubre al admin del tenant). El ciego
   pasa a `arqueo_ciego && estado === 'abierta' && !esAdmin`. Se calcula en el controller (mismo
   patrón que `cerrar`, que ya computa `userIsTenantAdmin`) y se pasa a `obtenerArqueo`,
   `resumenMovimientos` y `listarMovimientos`. No condiciona por `tieneVerTodas` (el supervisor
   no-admin **sí** queda ciego).

5. **Modo normal intacto.** Todo el cambio está detrás de `arqueo_ciego`. Si el tenant no opera
   en ciego, el header y la tabla quedan **exactamente como hoy**.

6. **Configurar el modo ciego es admin-only (dueño), no delegable.** Activar/desactivar el
   arqueo ciego es una **política anti-fraude**, no una acción operativa: se mueve a
   `TenantAdminGuard` (mismo patrón catálogos/config que impuestos, monedas, motivos), con la
   lectura abierta. El **CRUD de cajones de la misma página sigue** delegable a
   `Cajas:Actualizar` (es operativo, no política) — no confundir ambos gates.

---

## 4. Comportamiento

| | Modo normal | **Ciego + `abierta`** | Ciego, `en_conciliacion` / `cerrada` |
|---|---|---|---|
| Tarjeta `Saldo inicial` | visible | **visible** (la declaró el cajero, no revela nada) | visible |
| Tarjetas `Entradas` / `Salidas` / `Saldo esperado` | visibles | **ocultas** | reveladas |
| Sección de movimientos | visible | **oculta, sin placeholder** | visible (detalle del arqueo) |
| Origen del ocultamiento | — | **backend + front** | — |

- **Sin placeholder.** En ciego + abierta la sección de movimientos simplemente no se renderiza
  (ni el heading "Movimientos del turno (N)", que revelaría el conteo de líneas).
- Al conciliar, los movimientos aparecen como parte del **detalle del arqueo** y ayudan a
  justificar el descuadre ("esta venta no se registró"). Es la misma vista revelada que ya
  existe para caja cerrada.
- **Admin / superadmin (§3.4):** el ciego **no les aplica** — ven las 4 tarjetas y la tabla
  siempre, incluso en una caja `abierta`, como en modo normal. La columna "Ciego + `abierta`"
  de arriba describe al **cajero y al supervisor no-admin**, no al dueño.

---

## 5. Backend (enforcement real)

Ninguna ruta nueva. Se endurecen dos endpoints existentes para el operador ciego, con el mismo
criterio que `obtenerArqueo`: **`arqueo_ciego && estado === 'abierta' && !esAdmin`** (§3.4).
Cada controller calcula `esAdmin = u.esSuperadmin || rbacService.userIsTenantAdmin(u.id,
u.tenantId)` y lo pasa al service (un solo chequeo por request; para un admin/superadmin se
cortocircuita antes de `getArqueoCiego`, sin N+1). El mismo `esAdmin` se agrega a
`obtenerArqueo` (drawer de cierre / detalle) para que el admin vea el esperado en vivo ahí.

### 5.1 Resumen del turno — `GET /caja/:id/movimientos/resumen`
`caja.service.ts → resumenMovimientos(tenantId, usuarioId, cajaId, tieneVerTodas)`.

- La query ya lee `cajas c`; sumar `c.estado` al `SELECT`.
- La respuesta gana un booleano **`ciego`** (espeja la forma `{ ciego, ... }` de `obtenerArqueo`,
  para que el front decida el layout sin adivinar por nulls).
- Cuando `getArqueoCiego(tenantId) === true && estado === 'abierta'`:
  devolver `{ ciego: true, saldoInicial, totalEntradas: null, totalSalidas: null,
  saldoEsperado: null, totalMovimientos: null }`.
- En cualquier otro caso: `{ ciego: false, ...cifras completas }` (comportamiento actual).

### 5.2 Lista de movimientos — `GET /caja/:id/movimientos`
`caja.service.ts → listarMovimientos(...)`.

- Cuando `getArqueoCiego(tenantId) === true && estado === 'abierta'`: devolver una **página
  vacía** con la forma `PaginatedResponse` actual (`data: []`, `meta.total: 0`), sin ejecutar la
  query de filas. El operador no recibe montos por ningún camino, ni siquiera vía devtools.
- En cualquier otro estado: comportamiento actual.

> Nota de eficiencia: chequear `getArqueoCiego` una sola vez por request (no por fila). Sin N+1.

### 5.3 Config del modo ciego — admin-only
`caja.controller.ts → PUT /caja/arqueo-ciego`.

- Hoy: `@RequiresPermiso('Cajas', 'Actualizar')`. **Cambia a `@UseGuards(TenantAdminGuard)`**
  (mismo patrón que `PATCH :id/arqueo/motivos`, que ya usa ese guard). Se quita el
  `@RequiresPermiso` — `PermisosGuard` sin metadata es pass-through, igual que en
  `justificarDiferencias`. `TenantAdminGuard` ya está importado en el controller.
- **La lectura no cambia:** `GET /caja/arqueo-ciego` queda en `Cajas:Leer` (solo la escritura
  es admin-only, patrón catálogos). El cajero no la necesita: su layout ciego lo decide
  `resumenTurno.ciego` (§5.1), no este endpoint.
- `tenant_id` sigue saliendo del token (invariante 1); no cambia la firma del service.

---

## 6. Frontend

- **`stores/caja.ts`** — la interfaz `CajaTurnoResumen` gana `ciego: boolean`; `totalEntradas`
  / `totalSalidas` / `saldoEsperado` pasan a nullable. Los caminos optimistas
  (`recalcularSaldoEsperado`, incremento de totales al registrar un movimiento) hacen **no-op**
  cuando `ciego` (no hay cifras que actualizar). El seed local de `resumenTurno` (apertura)
  arranca `ciego` según corresponda.

- **`CajaTurnoResumen.vue`** — nuevo prop `ciego?: boolean`. Cuando `true`, renderiza **solo la
  tarjeta `Saldo inicial`** (oculta entradas/salidas/esperado). El grid se adapta a 1 tarjeta.

- **`CajaActivaDashboard.vue`** — lee `ciego` de `resumenTurno` y lo pasa a `CajaTurnoResumen`;
  cuando `ciego`, **no renderiza `CajaMovimientosTable`** (`v-if`). Sin placeholder.

- Los colores financieros hardcodeados de las tarjetas se mantienen (excepción del design
  system para el módulo Caja).

- **`configuracion/cajas.vue`** — el toggle de arqueo ciego (`USwitch`, hoy línea ~315) pasa a
  gatearse con un computed nuevo **`puedeConfigCiego = computed(() => perms.esAdmin)`**. **No
  reusar `puedeActualizar`** (línea 50): ese computed también gobierna el CRUD de cajones
  (líneas ~257-275), que **debe seguir** delegable a `Cajas:Actualizar`. Solo el toggle del
  ciego cambia a admin-only; el resto de la página queda igual.

---

## 7. Costo operativo aceptado

Ocultar la tabla durante el turno ciego significa que el cajero **no puede revisar sus propios
movimientos mientras opera** (p. ej. confirmar que entró una venta). En modo ciego esto es la
intención anti-fraude, y es una decisión consciente del owner. Se revela al conciliar. Si en el
futuro se quiere aflojar, el camino market-consistent es un **permiso aparte** de "ver totales
del turno" (patrón X-report), no reintroducir la fuga — fuera de alcance de este spec (YAGNI).

---

## 8. Fix independiente — badge de estado `en_conciliacion`

`CajaTurnoHeader.vue` hoy: `caja.estado === 'abierta' ? 'success' : 'neutral'`, así que
`en_conciliacion` y `cerrada` pintan ambos gris. Con las dos fases (C), `en_conciliacion` debe
tener color propio.

- `abierta` → `success` (verde)
- `en_conciliacion` → `warning` (naranja), consistente con el botón "Continuar conciliación"
- `cerrada` → `neutral` (gris)

Cambio cosmético, sin lógica de negocio.

---

## 9. Casos borde

- **Caja cerrada desde el historial (readonly):** `estado !== 'abierta'` → nunca en ciego →
  revela movimientos + arqueo. Es el "detalle del arqueo" que el owner quiere. Ya funciona hoy;
  solo hay que asegurarse de no romperlo.
- **`en_conciliacion`:** conteo congelado → revelado. Muestra tarjetas + movimientos + arqueo,
  útil para justificar. Cubierto por el gating `estado === 'abierta'`.
- **Auto-cierre por cuadre (C):** salta `abierta → cerrada` directo → nunca hay ventana de
  reveal intermedia, y la caja cerrada revela. Sin caso especial.
- **Admin operando en ciego:** ve ciego mientras la caja está abierta (por diseño, §3.4); reveal
  vía B.
- **Registrar un movimiento en ciego:** sigue permitido (`POST /:id/movimientos`,
  `MiCaja:Crear`, caja `abierta`); lo que cambia es que el resultado no se lista ni actualiza
  cifras en vivo. El drawer de "nuevo movimiento" no muestra saldo esperado.

---

## 10. Testing

- **Backend (e2e `caja.e2e-spec.ts`):** con `arqueo_ciego` on y caja `abierta` →
  `GET .../movimientos/resumen` devuelve `ciego:true` y `entradas/salidas/esperado` en null,
  `saldoInicial` presente; `GET .../movimientos` devuelve página vacía. Tras enviar conteo
  (`en_conciliacion`) → ambos endpoints revelan. Con `arqueo_ciego` off → todo visible siempre.
- **Backend — config admin-only (e2e `caja.e2e-spec.ts`):** un usuario con `Cajas:Actualizar`
  pero **no admin** recibe **403** en `PUT /caja/arqueo-ciego`; el admin del tenant puede.
  `GET /caja/arqueo-ciego` sigue accesible con `Cajas:Leer`.
- **Frontend (vitest):** `CajaTurnoResumen` con `ciego` renderiza solo `Saldo inicial`;
  `CajaActivaDashboard` con `resumenTurno.ciego` no monta la tabla. `CajaTurnoHeader` mapea los
  tres estados al color correcto. En `configuracion/cajas.vue`, el toggle del ciego queda
  disabled para un no-admin **mientras** el CRUD de cajones sigue habilitado con
  `Cajas:Actualizar`.
- **Smoke navegador:** activar ciego en config; abrir caja; verificar header sin
  entradas/salidas/esperado y sin tabla; devtools/network sin las cifras; enviar conteo y ver el
  reveal con movimientos en el detalle del arqueo.

---

## 11. Fuera de alcance

- Permiso separado de "ver totales del turno" (§7).
- Vista "el dueño ve el esperado en vivo" (se ataría al eje admin, no a `Cajas:Leer` — §3.4).
- Cambiar el gate del **CRUD de cajones**: sigue en `Cajas:Actualizar` (§6). Solo la config
  del ciego se mueve a admin-only.
- Conteo por denominación, umbral de aprobación por monto (ya en backlog de la investigación).
- Cualquier cambio al modelo de esperado (A) o a la máquina de estados (C).

---

## 12. Fuentes

- Investigación previa: `docs/agent/investigaciones/2026-07-23-gestion-caja.md` §5, §7.4.
- Toast — Shift Review / blind cash drawer permission (Cash expected hidden at close).
- Microsoft Dynamics 365 Commerce — Shift and cash drawer management (X-report como permiso
  separado; modelo de shift).
- Cash-handling best practices (blind count evita "contar hacia atrás" / skimming).
