# Arqueo de caja multi-medio (esperado por medio de pago) — Design Spec

**Fecha:** 2026-07-24
**Estado:** ✅ Aprobado por el owner — listo para plan de implementación
**Sub-proyecto:** A de 3 del refactor de arqueo (A multi-medio → B ciego → C motivos)
**Investigación:** [`docs/agent/investigaciones/2026-07-23-gestion-caja.md`](../../agent/investigaciones/2026-07-23-gestion-caja.md) (§3 el hilo bloqueante, §7.3 las tres salidas)
**Feature relacionada:** [`docs/features/gestion-cajas.md`](../../features/gestion-cajas.md)

---

## Contexto

Hoy el cierre de caja arroja un **faltante fantasma** en cada arqueo con ventas no-efectivo.
Raíz verificada en código:

- `pagos.service.ts:245-253` inserta un `movimiento_caja` tipo `entrada` por **cada** pago de
  venta, **sin mirar el método** (`metodoPagoId` sí se guarda por fila).
- `caja.service.ts:250-275` (`calcularSaldoEsperado`) colapsa **todo** en un número:
  `SUM(m.monto) FILTER (WHERE tipo='entrada')`, sin agrupar por método.

Consecuencia: si se vende $500 con tarjeta, el sistema **espera $500 de efectivo físico que
nunca entraron al cajón** → el cuadre marca un faltante enorme. Ninguna caja madura
(Toast/Square/Fudo/Bsale/Toteat) mete la tarjeta en el esperado de efectivo; en Chile la
tarjeta se deposita por Transbank y se concilia aparte (§4/§7 de la investigación).

Este sub-proyecto **A** resuelve el §3 adoptando el **arqueo multi-medio** (§7.3 opción B): el
cierre pasa de "un número" a **una línea esperado-vs-contado por método de pago**. Es la
fundación de B (ciego) y C (motivos), que se montan sobre el flujo de cierre que A establece.

**Sorpresa buena (ya verificada):** el desglose **ya está soportado a nivel de datos** —
`movimientos_caja.metodo_pago_id` existe por fila y `pagos.service` lo puebla. El peso de A no
es la BD de movimientos, es el cálculo agrupado, el DTO de cierre y la UI.

## Recordatorio del dominio (para no romper invariantes)

- **Dinero y porcentajes con Decimal.js**, nunca `number`. Toda diferencia/esperado/contado es
  Decimal.
- **`tenant_id`/`usuario_id` del token**, nunca del body.
- **Soft delete en todo**; toda lectura filtra `eliminado_el IS NULL`.
- El **cierre es owner-only** (`MiCaja:Actualizar`); esto no cambia en A. El cierre forzado por
  el encargado sigue diferido (§6).
- El motor de precios, `movimientos_inventario` y el sistema JWT **no se tocan**.
- **"Congelar el hecho transaccional":** el detalle del arqueo (esperado/contado/diferencia por
  línea) se **persiste congelado** al cerrar, no se recomputa después.

## Alcance

**Incluido:**
- `metodos_pago.es_efectivo` (global) + `tenant_metodo_pago.requiere_conteo` (por tenant) + seed.
- Cálculo del esperado **por método**: partir `calcularSaldoEsperado` en
  `calcularEsperadoEfectivo` (línea de efectivo) + `calcularArqueo` (todas las líneas).
- Tabla nueva `caja_arqueo_medio` (detalle del cierre por método, congelado).
- `CerrarCajaDto` multi-línea + rework del flujo `cerrar` + endpoint `GET /caja/:id/arqueo`.
- Frontend: rework del `CajaCierreDrawer` a multi-línea; desglose por método en el detalle
  read-only.
- **Fix incluido (mismo motivo raíz):** la validación de salida (422) y la NC "devolver dinero"
  pasan a validar contra la **línea de efectivo**, no el total mezclado.

**Fuera de alcance (sub-proyectos siguientes, ver Roadmap):**
- **B — Cierre ciego:** config `arqueo_ciego` por tenant + retención del esperado en backend.
- **C — Motivos + catálogo CRUD:** tabla `motivo_diferencia_caja` tenant-owned + módulo CRUD +
  motivo por línea que descuadra.
- Reporte over/short por cajero, aprobación por umbral (§6), conteo por denominación — diferidos.

## Decisiones de diseño (tomadas con el owner, 2026-07-24)

1. **Modelo del esperado = Nivel 2 (multi-medio):** el cajero declara un contado por método;
   cada línea tiene su esperado/contado/diferencia. (Descartados: Nivel 1 solo-efectivo, Nivel 3
   configurable-total.)
2. **El efectivo es especial:** solo la línea de efectivo lleva el fondo inicial + los
   movimientos manuales + los vueltos. Para calcularla, el sistema necesita saber qué método es
   efectivo → **`es_efectivo` booleano** en `metodos_pago` (global, intrínseco). *No* enum
   `tipo` (YAGNI hoy).
3. **Varios métodos efectivo permitidos** (ej. Efectivo CLP + USD), pero **una sola línea de
   efectivo agregada** en el arqueo (`metodo_pago_id NULL`).
4. **Obligatoriedad configurable:** `requiere_conteo` booleano en `tenant_metodo_pago` (por
   tenant, política operativa). Regla: `obligatorio = es_efectivo OR requiere_conteo`. El
   efectivo siempre se cuenta; el admin puede además forzar el conteo de métodos no-efectivo.
   Lo no obligatorio y dejado en blanco → línea **informativa** (`contado NULL`).
5. **Los campos agregados de `cajas`** (`saldo_final`/`monto_contado`/`diferencia`) pasan a
   representar **la línea de efectivo** (el cuadre del cajón físico), no un total mezclado —
   backward-compat del historial. El desglose completo vive en `caja_arqueo_medio`.

## Modelo de datos

**`metodos_pago` (existente) — se agrega una columna:**

| Columna | Tipo | Constraints | Notas |
|---|---|---|---|
| `es_efectivo` | BOOLEAN | NOT NULL, default `false` | Catálogo global; intrínseco al método |

**`tenant_metodo_pago` (existente) — se agrega una columna:**

| Columna | Tipo | Constraints | Notas |
|---|---|---|---|
| `requiere_conteo` | BOOLEAN | NOT NULL, default `false` | Por tenant; junto a `permite_vuelto`/`habilitada` |

**Tabla nueva `caja_arqueo_medio`** — detalle del cierre, una fila por línea del arqueo,
**congelada** al cerrar:

| Columna | Tipo | Constraints | Notas |
|---|---|---|---|
| `arqueo_medio_id` | UUID | PK | |
| `caja_id` | UUID | FK → `cajas(caja_id)`, NOT NULL | |
| `tenant_id` | UUID | FK → `tenants`, NOT NULL | Del token, denormalizado |
| `metodo_pago_id` | UUID | FK → `metodos_pago`, **nullable** | `NULL` = la línea de efectivo agregada |
| `es_efectivo` | BOOLEAN | NOT NULL | Snapshot; `true` en la fila de efectivo |
| `esperado` | NUMERIC(18,4) | NOT NULL | Congelado al cerrar; Decimal.js `toFixed(4)` (convención del módulo) |
| `contado` | NUMERIC(18,4) | **nullable** | `NULL` = línea informativa (no se contó) |
| `diferencia` | NUMERIC(18,4) | **nullable** | `contado − esperado`; `NULL` si no se contó |
| `creado_el` | TIMESTAMPTZ | NOT NULL | |
| `eliminado_el` | TIMESTAMPTZ | nullable | Soft delete |

**Índice único parcial:** `caja_arqueo_medio(caja_id, metodo_pago_id) WHERE eliminado_el IS
NULL` — una línea por método por cierre. La línea de efectivo (`metodo_pago_id NULL`) es única
por caja por construcción (los NULL no colisionan en el índice, pero el flujo inserta una sola).

## Fórmulas del esperado

Los vueltos **ya están netos** en el movimiento: `pagos.service.ts:243-244` inserta el pago con
`monto = pago − vuelto`. Por eso la línea de efectivo **no** resta vueltos por separado.

```
Efectivo (metodo_pago_id NULL) = saldo_inicial
                               + Σ movimientos entrada de métodos es_efectivo
                               + Σ movimientos manuales (metodo_pago_id NULL)
                               − Σ movimientos salida
Cada no-efectivo (por metodo_pago_id) = Σ sus movimientos entrada
```

Las **salidas siempre son efectivo:** los movimientos manuales y la devolución de NC se insertan
con `metodo_pago_id NULL` (verificado). Por eso todas las salidas pertenecen a la línea de
efectivo.

## Backend — cálculo y los 3 consumidores

Hoy `calcularSaldoEsperado` (un número mezclado) lo usan 3 lugares con **dos necesidades
distintas**. Se parte en dos funciones:

- **`calcularEsperadoEfectivo(cajaId, manager) → string`** — solo la línea de efectivo (fórmula
  de arriba). Una query.
- **`calcularArqueo(cajaId, manager) → LineaArqueo[]`** — todas las líneas (efectivo agregada +
  una por cada no-efectivo con movimientos), cada una con su `esperado`. Una sola query agrupada
  (JOIN a `metodos_pago` por `es_efectivo`), sin N+1.

**Remapeo de los 3 consumidores:**

| Consumidor | Hoy | Pasa a usar | Efecto |
|---|---|---|---|
| `cerrar` (`caja.service`) | total mezclado | `calcularArqueo` | El cierre multi-medio |
| Salida manual 422 (`registrarMovimiento`) | total mezclado | `calcularEsperadoEfectivo` | 🐛→✅ fix |
| NC "devolver dinero" (`ventas.service:708`) | total mezclado | `calcularEsperadoEfectivo` | 🐛→✅ fix |

**Bugs que arregla de paso (mismo motivo raíz que A):** hoy se puede sacar efectivo (salida
manual o reembolso de NC) **contra plata pagada con tarjeta que nunca entró al cajón**. Tras A,
esas validaciones miran solo el efectivo real. **Es un cambio de comportamiento (más estricto)**
— las aserciones e2e se derivan de la regla nueva.

**Qué líneas aparecen en el arqueo:** las que **tuvieron movimientos** (esperado ≠ 0) + **siempre
la de efectivo** (aunque solo tenga el fondo). `requiere_conteo` gobierna si el contado de una
línea *existente* es obligatorio; un método `requiere_conteo` sin movimientos no genera línea.

## Backend — endpoint de preview

**`GET /caja/:id/arqueo`** — **lectura compartida** (`MiCaja:Leer` **o** `Cajas:Leer`), vía el
helper `resolverLecturaCompartida` del controller, igual que `GET /caja/:id` y `/:id/movimientos`
(no un `@RequiresPermiso` único). El cajero lo usa al cerrar su turno; el supervisor lo usa para
ver el desglose de una caja ajena en `/cajas/[id]` (403 si no tiene ninguno de los dos). Alimenta
el drawer de cierre y el detalle read-only. Sirve **ambos estados**:

- **Caja abierta:** preview **recomputado** (`calcularArqueo`) → líneas con `esperado`,
  `requiereConteo`, sin contado/diferencia.
- **Caja cerrada:** las líneas **congeladas** desde `caja_arqueo_medio` → con `contado` y
  `diferencia`.

Forma de cada línea:
`{ metodoPagoId: string | null, nombre: string, esEfectivo: boolean, esperado: string,
requiereConteo: boolean, contado?: string | null, diferencia?: string | null }`.

*(Este endpoint es el punto donde el sub-proyecto B retendrá el `esperado` en modo ciego. Se
diseña acá para que B sea un cambio localizado.)*

## Backend — DTO y flujo de cierre

**`CerrarCajaDto` — nueva forma multi-línea:**

```ts
{
  lineas: { metodoPagoId: string | null; montoContado: string }[]; // null = línea de efectivo
  comentario?: string;
}
```

**Validación del DTO** (`class-validator` + regla de negocio en el service):
- `montoContado` **admite decimales**. ⚠️ El DTO viejo usa `@IsNumberString({ no_symbols: true })`,
  que **rechaza el punto decimal** (rompió 6 e2e el 2026-07-23). El nuevo valida decimal real:
  `@IsNumberString()` sin `no_symbols` (dinero es Decimal.js).
- Cada `metodoPagoId` (no-null) es `@IsUUID('4')`; `comentario` `@IsOptional @IsString`.

**Flujo `cerrar(tenantId, usuarioId, cajaId, dto)`** (dentro de la transacción actual, con el
lock `bloquearCajaAbierta` que ya existe):
1. Lock + owner-only + caja abierta (igual que hoy).
2. `calcularArqueo` server-side → esperado por línea (**congelado**). El esperado **nunca** viene
   del DTO (evita que el cliente falsee el cuadre).
3. **Validar completitud contra el arqueo recomputado:**
   - Línea de efectivo (`metodoPagoId NULL`): `montoContado` **obligatorio**.
   - Línea no-efectivo con `es_efectivo OR requiere_conteo`: **obligatoria**.
   - Opcional omitida → línea informativa (`contado NULL`, `diferencia NULL`).
   - `metodoPagoId` que no exista en el arqueo recomputado, o método extra → **400**.
   - Falta una línea obligatoria → **400**.
4. Por línea: `contado` del DTO (o `NULL`); `diferencia = contado − esperado` (o `NULL`).
5. Insertar filas en `caja_arqueo_medio` (todas las líneas, congeladas).
6. Actualizar agregado de `cajas` = **línea de efectivo**: `saldo_final` = esperado efectivo,
   `monto_contado` = contado efectivo, `diferencia` = diferencia efectivo.
7. `estado='cerrada'`, `fecha_cierre = now()`, `comentario`.

Respuesta: el arqueo completo (todas las líneas con esperado/contado/diferencia) + la caja.

**Guarda de alcance:** en A la diferencia por línea **solo se registra**. El motivo categorizado
es del sub-proyecto C — no entra acá. El `comentario` global de cierre ya existe y se conserva.

## Frontend

**`CajaCierreDrawer.vue` — rework a multi-línea.** Al abrir, llama `GET /caja/:id/arqueo` y
renderiza las líneas en **dos grupos** (la prominencia la dicta `requiere_conteo`, todas
visibles):

- **Grupo "A conciliar" (obligatorias)** — efectivo + métodos con `requiere_conteo`: `MoneyInput`
  de contado destacado, **obligatorio**, con diferencia en vivo (Decimal.js). **Efectivo primero.**
- **Grupo "Informativas" (opcionales)** — métodos con movimientos sin `requiere_conteo`: muestran
  el esperado, de-emphasized/abajo; contado **opcional** (si el cajero concilia, ve su diferencia;
  si no, queda informativa).

- Colores financieros de diferencia (verde sobra / rojo falta) — excepción de tokens hardcoded ya
  permitida en el módulo Caja.
- Validación cliente solo UX (obligatorias completas); el gate real es el backend.
- Submit → `cerrarCaja(cajaId, { lineas, comentario })`.

**`stores/caja.ts`:**
- Acción nueva `cargarArqueo(cajaId)` → `GET /caja/:id/arqueo` → estado `arqueo: ArqueoLinea[]`.
- `cerrarCaja` cambia el payload a `{ lineas, comentario }`.

**Detalle read-only de una caja cerrada** (`/mi-caja/[id]` y `/cajas/[id]`): muestra el desglose
del arqueo (método · esperado · contado · diferencia) con el mismo `GET /caja/:id/arqueo` (líneas
congeladas).

**Historial (`CajaHistorial`, `GET /caja`): sin cambios.** Sigue mostrando el cuadre agregado
(`montoContado`/`diferencia`), que ahora significa la línea de efectivo. Backward-compat total.

**Componentes:** reuso `MoneyInput` + `AppDrawer`. El desglose (filas método/esperado/contado/
diferencia) arranca editable en el drawer y read-only en el detalle; si aparece la tercera copia,
se extrae a un `CajaArqueoTable` con prop `readonly` (regla de "extraer a la tercera").

## Reglas de negocio

1. El esperado del arqueo se calcula **por método**; la tarjeta **no** infla el esperado de
   efectivo.
2. `es_efectivo` (global) define qué entra a la línea de efectivo; `requiere_conteo` (por tenant)
   define qué método exige contado obligatorio. `obligatorio = es_efectivo OR requiere_conteo`.
3. Línea obligatoria sin contado → **400**. Línea opcional sin contado → **informativa**.
4. Salida manual (422) y NC "devolver dinero" validan contra la **línea de efectivo**, no el total.
5. El esperado se **recomputa y congela** en el backend al cerrar; nunca viene del cliente.
6. Los campos agregados de `cajas` representan la **línea de efectivo**.
7. `tenant_id`/`usuario_id` del token; soft delete; toda lectura filtra `eliminado_el IS NULL`.
8. La caja **virtual** no se ve afectada (canal online no arquea multi-medio manual).

## Testing

- **Unit** (`caja.service.spec`): `calcularEsperadoEfectivo` (fondo + es_efectivo + manuales −
  salidas; sin doble-restar vueltos; excluye no-efectivo); `calcularArqueo` (agrega efectivo,
  una línea por no-efectivo con su esperado); completitud de líneas obligatorias vs opcionales
  (400 si falta obligatoria; informativa si opcional omitida); diferencia por línea con Decimal;
  la salida 422 mira solo efectivo.
- **Unit** (`ventas.service.spec` si aplica): NC "devolver dinero" valida contra efectivo.
- **E2E** (`caja.e2e-spec`): venta efectivo + tarjeta → dos líneas, tarjeta informativa si no
  `requiere_conteo`; con `requiere_conteo` en tarjeta, el cierre sin su contado → 400; el
  **faltante fantasma desaparece** (vender con tarjeta ya no infla el esperado de efectivo);
  `montoContado` con decimales aceptado; el detalle de la caja cerrada devuelve las líneas
  congeladas. Aserciones derivadas de la **regla documentada**, nunca del output del código.

## Seed

`seeder.service.ts` (fuente de verdad, corre al arrancar):
- `metodos_pago`: `Efectivo` con `es_efectivo = true`; el resto `false`.
- `tenant_metodo_pago`: `requiere_conteo = false` en todos por defecto.
- No se siembra nada nuevo al **crear un tenant** en A (los motivos y su catálogo son de C).

## Backward-compat (etapa de desarrollo)

- Columnas nuevas y tabla `caja_arqueo_medio`: las crea `synchronize` al bootstrap (dev/CI). Sin
  migración (producción = pendiente ya anotado en `docs/agent/pendientes.md`).
- **Cajas ya cerradas** (data vieja): sin filas en `caja_arqueo_medio`; su detalle muestra el
  cuadre agregado (efectivo) desde `cajas.*`, con el desglose por método **no disponible**. Sin
  backfill (no tiene sentido inventar el desglose histórico).
- **Cajas abiertas** al deploy: cierran con el flujo nuevo (el arqueo se computa desde sus
  movimientos, que ya tienen `metodo_pago_id`).

## Docs a actualizar (mismo commit que el código)

- `docs/features/gestion-cajas.md` — modelo del esperado multi-medio, `es_efectivo`/
  `requiere_conteo`, endpoint `GET /caja/:id/arqueo`, nueva forma de cierre, tabla
  `caja_arqueo_medio`, el fix de salida/NC.
- `docs/ESTADO.md` — fila de la feature (arqueo multi-medio).
- `docs/agent/investigaciones/2026-07-23-gestion-caja.md` §9 — marcar §3 resuelto por el
  sub-proyecto A.
- `docs/agent/pendientes.md` — actualizar el ítem §3 de "Features de negocio diferidas".
- `startup-pos.sql` — columnas `es_efectivo`/`requiere_conteo` + tabla `caja_arqueo_medio`.

## Criterios de aceptación

- [ ] `metodos_pago.es_efectivo` (global, default false; seed `Efectivo=true`) y
  `tenant_metodo_pago.requiere_conteo` (por tenant, default false).
- [ ] Tabla `caja_arqueo_medio` con índice único parcial `(caja_id, metodo_pago_id) WHERE
  eliminado_el IS NULL`.
- [ ] `calcularSaldoEsperado` partido en `calcularEsperadoEfectivo` + `calcularArqueo`; los 3
  consumidores remapeados (cierre → arqueo; salida 422 y NC → efectivo).
- [ ] `GET /caja/:id/arqueo` devuelve preview recomputado (abierta) o líneas congeladas (cerrada).
- [ ] `CerrarCajaDto` multi-línea; `montoContado` admite decimales (no `no_symbols`).
- [ ] `cerrar` recomputa y congela el esperado; valida líneas obligatorias (400 si falta);
  persiste `caja_arqueo_medio`; actualiza `cajas.*` = línea de efectivo.
- [ ] Frontend: `CajaCierreDrawer` multi-línea (obligatorias/informativas, efectivo primero);
  detalle read-only muestra el desglose; historial sin cambios.
- [ ] Vender con tarjeta ya **no** produce faltante fantasma en el arqueo de efectivo.
- [ ] Salida manual y NC "devolver dinero" validan contra la línea de efectivo.
- [ ] `tenant_id`/`usuario_id` del token; soft delete; Decimal.js; virtual sin afectar.
- [ ] Unit + e2e verdes.
- [ ] Docs actualizadas (gestion-cajas.md, ESTADO.md, §9, pendientes.md, startup-pos.sql).

---

## Roadmap del refactor de arqueo (A → B → C)

Decisión del owner (2026-07-24): abordar el arqueo completo en tres sub-proyectos, en orden de
necesidad. **A va primero (es el bug); B y C son independientes entre sí y se montan sobre A.**
Las decisiones de B y C ya están tomadas y se registran acá para no perderlas; cada uno tendrá su
propio spec cuando le toque.

### A — Arqueo multi-medio (este spec)
Esperado por método; arregla el faltante fantasma. Fundación de B y C.

### B — Cierre ciego (decisiones tomadas)
- **Activación:** config por tenant `arqueo_ciego` (booleano). No un permiso por rol (la
  distinción cajero/supervisor ya la dan los módulos `MiCaja`/`Cajas`).
- **Enforcement en el backend, no en el frontend:** en modo ciego, `GET /caja/:id/arqueo` **no
  entrega el `esperado`** a quien está cerrando (ocultarlo solo en la UI no sirve — es
  anti-fraude). Este es el punto de cambio que A dejó preparado.
- **Diferencia visible al cerrar:** el cajero cuenta sin ver el objetivo, pero al enviar ve el
  resultado. Ocultar el resultado *después* pertenece a la conciliación supervisor (§6, diferido).

### C — Motivos + catálogo CRUD (decisiones tomadas)
- **Tabla `motivo_diferencia_caja` tenant-owned**, sembrada al crear el tenant con los motivos
  por defecto (*falta de efectivo, sobra de efectivo, divergencia de tarjeta, error de
  lanzamiento manual, pago no registrado, error operacional, otro*). Único por `(tenant_id,
  nombre)`, `activo`, soft-delete.
- **Módulo CRUD** (entidad + controller + service + permisos + página de Configuración) — el
  admin gestiona sus motivos igual que Cajas/Métodos de pago. Es casi un sub-proyecto en sí.
- **Motivo (FK) por cada línea que descuadra** (diferencia ≠ 0), **obligatorio** ante cualquier
  diferencia. Si la línea cuadra, no se pide nada.
- **"Otro"** habilita comentario libre obligatorio. **Red de seguridad:** si el tenant desactiva
  todos los motivos, la diferencia se justifica solo con comentario obligatorio (degradación, no
  bloqueo).
- **Por qué C al final:** el catálogo es el de más maquinaria y sus consumidores reales (reporte
  over/short, aprobación por umbral §6) están diferidos; rinde más una vez que exista quien
  consuma las categorías.
