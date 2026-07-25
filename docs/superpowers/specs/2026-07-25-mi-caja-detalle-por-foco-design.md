# Detalle de "Mi caja" — layout por foco según el estado de la caja

**Fecha:** 2026-07-25
**Estado:** diseño aprobado, pendiente de plan
**Alcance:** reorganizar la página `mi-caja/[id].vue` para que el layout se enfoque según el
estado de la caja (abierta / en_conciliacion / cerrada), en vez de un molde único apilado.
Es un cambio **solo de frontend** (composición y presentación); no toca backend, motor de
arqueo/cierre, ni el modo ciego (solo lo respeta).

---

## 1. Contexto y problema

Hoy `mi-caja/[id].vue` apila el **mismo layout** para los tres estados de una caja:

1. Navbar "Detalle de caja".
2. `CajaTurnoHeader` — título **"Caja"** + badge + apertura + botones.
3. `CajaTurnoResumen` — 4 tarjetas (Saldo inicial / Entradas / Salidas / Saldo esperado).
4. `CajaMovimientosTable` — tabla de movimientos.
5. Si `cerrada`: además una tarjeta "Arqueo del cierre" al fondo.

Problemas:

- **Redundancia:** en caja cerrada el "Saldo esperado" aparece **dos veces** — la tarjeta azul
  del resumen y la línea del arqueo.
- **Molde único:** una caja cerrada muestra las tarjetas de **operación** (entradas/salidas),
  que ya no aportan, y el **arqueo — que es el resultado — queda al fondo**.
- **Sin jerarquía:** todo pesa igual, en una columna larga. El navbar dice "Detalle de caja" y
  el header repite "Caja".
- Cada estado tiene un **foco distinto** que el layout no refleja: en abierta se **opera**, en
  conciliación se **finaliza**, en cerrada se **audita el resultado**.

---

## 2. Decisiones de diseño

1. **Una sola página, ramificada por foco.** No se navega a otro lado; `mi-caja/[id].vue`
   elige la composición según `detalle.estado`. La página sigue *thin* (sin lógica de negocio).
2. **Dos composiciones, no tres.** Los estados de **cierre** (`en_conciliacion` y `cerrada`)
   comparten foco ("el arqueo es el protagonista"), así que comparten composición; solo se
   diferencian por el banner/CTA de conciliación. La caja **abierta** es la composición de
   trabajo.
3. **Los movimientos cambian de rol según el foco:** en abierta son **área de trabajo**
   (visibles); en cierre son **detalle de auditoría** (colapsados por defecto, se despliegan con
   un click). En un POS un turno puede acumular muchos movimientos → colapsado es el default
   sano en cierre.
4. **Matar la redundancia:** en la vista de cierre se **quitan las 4 tarjetas de operación**; el
   esperado vive en el arqueo. La cifra clave de una caja **abierta** (Saldo esperado) se
   **destaca** sobre entradas/salidas.
5. **Sin inventar datos.** La tira "resultado del cierre" usa solo lo que existe hoy
   (diferencia, cajón, hora de cierre). "Quién contó/cerró" **no** está persistido (no hay
   `cerrada_por`, ver `pendientes.md`) → no se muestra hasta que ese campo exista.
6. **El modo ciego se respeta, no se reimplementa.** La vista de trabajo (abierta) ya gatea por
   `resumenTurno.ciego`; la vista de cierre siempre está revelada (estado ≠ `abierta`). Sin
   cambios de lógica ciega.

---

## 3. Layout por estado

**CAJA ABIERTA — foco: operar**
```
[ navbar: Detalle de caja ]
┌───────────────────────────────────────────────┐
│ Cajón Barra · Ana · abierta 10:00   [ABIERTA]   │  header
│                        [+ Movimiento] [Cerrar]  │
├───────────────────────────────────────────────┤
│ Saldo esperado  $9.500        (destacado)       │  resumen
│ inicial 10.000 · +0 · −500     (secundarias)    │
├───────────────────────────────────────────────┤
│ Movimientos del turno            (VISIBLE)      │  área de trabajo
└───────────────────────────────────────────────┘
```

**EN CONCILIACIÓN — foco: finalizar**
```
┌───────────────────────────────────────────────┐
│ ⚠ En conciliación — falta finalizar             │  banner + CTA
│                        [Continuar conciliación] │
├───────────────────────────────────────────────┤
│ Resultado: diferencia -$500 · Cajón Barra       │  tira resultado
├───────────────────────────────────────────────┤
│ Arqueo (congelado: esperado/contado/dif/motivo) │  PROTAGONISTA
├───────────────────────────────────────────────┤
│ ▸ Movimientos del turno (12)     [colapsado]    │  auditoría
└───────────────────────────────────────────────┘
```

**CAJA CERRADA — foco: auditar el resultado**
```
┌───────────────────────────────────────────────┐
│ Cajón Barra · Ana · cerrada 18:30    [CERRADA]  │  header (sin acciones)
├───────────────────────────────────────────────┤
│ ✓ Cuadró  ·  Diferencia $0  ·  cerrada 18:30    │  tira resultado
├───────────────────────────────────────────────┤
│ Arqueo del cierre (esperado/contado/dif/motivo) │  PROTAGONISTA
├───────────────────────────────────────────────┤
│ ▸ Movimientos del turno (12)     [colapsado]    │  auditoría
└───────────────────────────────────────────────┘
```

- La tira de resultado dice **"✓ Cuadró"** cuando la diferencia total es 0, o **"Diferencia
  −$X"** (color financiero) cuando no. Deriva de las líneas del arqueo (suma de `diferencia`
  con Decimal.js), no de un total mezclado.

---

## 4. Componentes

**Página — `app/pages/mi-caja/[id].vue`** (modificar)
- Ramifica: `estado === 'abierta'` → `CajaActivaDashboard`; si no (`en_conciliacion` |
  `cerrada`) → nuevo `CajaCierreDetalle`.
- **Carga del arqueo:** hoy solo se llama `cargarArqueo` para `cerrada`; ampliarlo a
  `en_conciliacion` también (para que la vista de cierre tenga las líneas). `obtenerArqueo`
  revela en ambos (estado ≠ abierta).
- Pasa `detalle`, `arqueo`, `readonly` a la composición correspondiente.

**`CajaActivaDashboard.vue`** (modificar — solo estado abierta / trabajo)
- Compone: `CajaTurnoHeader` + `CajaTurnoResumen` (destacado) + `CajaMovimientosTable` visible.
- Contiene los drawers de **movimiento** y de **cierre fase 1** (el header emite `movimiento` /
  `cerrar`). Deja de manejar `en_conciliacion` (migra a `CajaCierreDetalle`); se puede quitar el
  `:resumir` del drawer aquí (solo dispara fase 1 desde abierta).

**`CajaTurnoHeader.vue`** (modificar — compartido)
- Reemplaza el título literal **"Caja"** por **cajón · usuario · apertura** (usa
  `caja.cajonNombre`, y la fecha de apertura ya presente). El badge de estado queda.
- **Acciones solo de la vista de trabajo** (abierta): `+ Movimiento` y `Cerrar caja` (fase 1).
  Se **quita "Continuar conciliación" del header** — ese CTA se mueve al banner de
  `CajaCierreDetalle` (evita duplicarlo). En los estados de cierre el header **no** muestra
  acciones.
- Nota de datos: el nombre del usuario del turno **no** está en la interfaz `Caja` del store
  (solo `usuarioId`). Si no se expone fácil, el header muestra **cajón · apertura** y el usuario
  queda para cuando el detalle lo traiga (no inventar).

**`CajaTurnoResumen.vue`** (modificar — solo abierta)
- Jerarquía: **Saldo esperado** protagonista (tipografía mayor / tarjeta principal);
  `Saldo inicial`, `Entradas`, `Salidas` como secundarias. Mantiene el prop `ciego` y su gateo
  (en ciego el cajero ve solo `Saldo inicial`). Colores financieros hardcodeados permitidos
  (excepción de Caja).

**`CajaCierreDetalle.vue`** (NUEVO — estados en_conciliacion + cerrada)
- Compone: `CajaTurnoHeader` (sin acciones) + (si `en_conciliacion`) **banner** "En conciliación
  — falta finalizar" cuyo **CTA "Continuar conciliación"** abre `CajaCierreDrawer`
  (`resumir=true`, fase 2) + `CajaCierreResumen` + `CajaArqueoTable` (protagonista) +
  `CajaMovimientosTable` dentro de un colapsable. El banner y su CTA son el **único** punto de
  "continuar conciliación" (ya no está en el header).
- Recibe `caja`, `arqueo` (líneas), `readonly`. La justificación admin del arqueo cerrado sigue
  vía `CajaArqueoTable` (`puede-justificar = perms.esAdmin`, como hoy).
- El `CajaCierreDrawer` vive acá **solo** cuando `en_conciliacion` (no en cerrada).

**`CajaCierreResumen.vue`** (NUEVO — tira de resultado)
- Props: `arqueo: ArqueoLinea[]`, `caja` (para `fechaCierre`, `cajonNombre`).
- Deriva **diferencia total** = Σ `linea.diferencia` (Decimal.js). Muestra "✓ Cuadró" si 0, o
  "Diferencia −$X" con color financiero si no; más cajón y hora de cierre. Sin lógica de
  negocio (solo presentación de datos ya calculados por el backend).

**`CajaMovimientosTable.vue`** (modificar — colapsable opcional)
- Gana un prop `colapsable?: boolean` (default `false`). Cuando `true`, se renderiza dentro de
  un `UCollapsible` (Nuxt UI) con el heading "Movimientos del turno (N)" como disparador,
  **colapsado por defecto**. En abierta se usa sin colapsar (comportamiento actual). El heading
  con el conteo ya existe dentro del componente (no se filtra en ciego porque la vista de cierre
  siempre está revelada).

---

## 5. Datos y carga

- Sin endpoints nuevos. `cargarDetalle`, `cargarResumenTurno`, `cargarArqueo`,
  `cargarMovimientos` ya existen.
- Cambio único de carga: `mi-caja/[id].vue` llama `cargarArqueo(cajaId)` también cuando
  `estado === 'en_conciliacion'` (hoy solo en `cerrada`).
- `CajaCierreResumen` y la tira derivan de datos ya presentes (`arqueo`, `caja`), sin fetch
  extra.

---

## 6. Modo ciego (interacción)

- **Abierta + ciego (cajero):** la vista de trabajo ya muestra solo `Saldo inicial` y **no** la
  tabla de movimientos (server-side). El destacado del esperado no aplica (está oculto). Sin
  cambios.
- **Abierta + admin:** ve todo (resuelto en el feature anterior). Sin cambios.
- **Cierre (en_conciliacion / cerrada):** siempre revelado → la vista de cierre muestra arqueo +
  movimientos normalmente.

---

## 7. Testing

Sin infra de test de componentes `.vue` en el proyecto (igual que el feature anterior) →
verificación por `typecheck:ratchet` + `design:check` + `build` + **smoke de navegador**:

- **Abierta:** header sin la palabra "Caja" (muestra cajón/apertura); esperado destacado;
  movimientos visibles; acciones + Movimiento / Cerrar. Con ciego (cajero): solo saldo inicial,
  sin tabla.
- **En conciliación:** banner + CTA "Continuar conciliación" (abre el drawer fase 2); tira de
  resultado con la diferencia; arqueo visible; movimientos colapsados; el flujo de finalizar con
  motivo sigue andando.
- **Cerrada:** tira "✓ Cuadró" (o "Diferencia −$X"); sin tarjetas de operación; arqueo
  protagonista; movimientos colapsados que se despliegan; override admin del arqueo sigue.
- **Store/vitest** si hay lógica derivada testeable (p. ej. el cálculo de diferencia total del
  `CajaCierreResumen` si se extrae a un composable/util).

---

## 8. Fuera de alcance

- Persistir "quién contó/cerró" (`cerrada_por`) — ítem aparte en `pendientes.md`.
- Cambiar el motor de arqueo/cierre, la máquina de estados o el modo ciego (solo se respetan).
- La lista/dispatcher de cajas (`mi-caja/index.vue`), el historial y la vista de supervisión
  (`/cajas`).
- Exponer el nombre del usuario del turno en el detalle si no está ya disponible (se muestra si
  el dato existe; no se agrega un endpoint para eso).

---

## 9. Fuentes

- Página y componentes actuales: `app/pages/mi-caja/[id].vue`, `app/components/caja/*`.
- Feature previo (modo ciego real + admin ve): `docs/superpowers/specs/2026-07-25-header-caja-ciego-design.md`.
- Backlog relacionado: `docs/agent/pendientes.md` (`cerrada_por`).
