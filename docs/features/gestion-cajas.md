# Feature: Gestión de Cajas

**Status**: Complete
**Owner**: —
**Last Updated**: 2026-07-25

---

## Overview

### What is it?

Gestiona el ciclo de vida de la caja física en el POS: apertura con saldo inicial,
registro de movimientos manuales (entradas y salidas de efectivo), cierre con
cuadre (monto contado vs. saldo esperado) e historial de sesiones de caja.

Cada sesión de caja corresponde a un turno de un usuario dentro de un tenant.
Las ventas físicas se asocian a la caja activa del usuario que las registra.

### Why does it exist?

En un POS físico el cajero inicia el turno con un fondo de caja, registra todas las
transacciones durante su turno y, al cierre, declara el efectivo físico. El sistema
calcula la diferencia entre lo que debería haber (`saldo_esperado`) y lo que el
cajero cuenta (`monto_contado`), generando el reporte de cuadre de caja.

### Scope

- Incluido:
  - Apertura de caja física con saldo inicial
  - Movimientos manuales (entrada / salida de efectivo)
  - Cierre en dos fases con cuadre automático multi-medio y motivos categorizados de
    diferencia (congela → concilia con motivo → finaliza; auto-cierre si todo cuadra)
  - Historial de sesiones de caja (propia + todas con permiso especial)
  - Caja virtual (creada automáticamente por tenant para ventas online — excluida de flujos manuales)
  - Permisos granulares vía `@RequiresPermiso` + `PermisosGuard`

- NOT included (future):
  - Integración con pasarela de cobros
  - Cajas de múltiples bodegas / sucursales
  - Reimpresión de recibos de apertura/cierre
  - Conciliación automática con pagos electrónicos
  - Firma de testigo del cierre forzado (el garzón que da fe de cuánta gente había en
    turno) — el cierre forzado en sí ya existe, ver [Modelo de
    acceso](#modelo-de-acceso-por-permiso); lo que falta es el flujo de solicitud/firma
    (plan `testigo-cierre-forzado`, en curso)
  - Aprobación de cierre por umbral de diferencia (patrón Toast)
  - Reporte agregado de over/short por cajero/motivo/período

---

## Modelo de acceso por permiso

Operar el propio turno y supervisar todas las cajas del tenant son dos responsabilidades
distintas, y hasta 2026-07-23 convivían en un solo módulo `Caja` bifurcado por el permiso
`Ver todas` — una acción CRUD genérica haciendo de "rol supervisor" disfrazado. Se separaron
en **dos módulos de permiso y dos superficies de navegación**:

| Módulo | Permiso | Superficie (frontend) | Qué puede hacer |
|---|---|---|---|
| `MiCaja` | `Leer` / `Crear` / `Actualizar` | `/mi-caja*` | El cajero opera **su propio** turno: abrir, registrar movimientos, cerrar con cuadre, ver su propio historial. |
| `Cajas` | `Leer` (única acción) | `/cajas*` | El encargado **supervisa** todos los cajones del tenant: grid de cajones con su estado, historial de todos (filtro por cajero o por cajón), detalle de cualquier caja — **siempre read-only**, sin botones de operar ni de abrir. |

Un usuario con ambos módulos ve las dos entradas de sidebar de forma independiente:
"Mi caja" es su propio turno, "Cajas" es supervisión — sin lógica especial para el caso
"admin que también opera". El rol admin (`es_fijo`) obtiene `Cajas:Leer` automáticamente
en cuanto el tenant contrata el módulo `Cajas` (short-circuit de rol fijo).

**El backend no se reorganizó**: las rutas siguen siendo `/caja/*` en un único
`caja.controller.ts` / `caja.service.ts` — el usuario nunca ve esas URLs, las llama el
frontend. Lo único que cambió es el `@RequiresPermiso` de cada endpoint. Ver
[endpoints](#api-endpoints) y [Backend](#backend).

**Escrituras casi siempre owner-only, con una excepción — el admin puede forzar**: tener
`Cajas:Leer` nunca habilita `POST /caja/:id/movimientos` sobre una caja ajena — esa
validación vive en el service y no depende del módulo de permiso, y ahí sigue siendo
estrictamente owner-only. `POST /caja/:id/conteo` (fase 1 del cierre) y `POST
/caja/:id/cerrar` (fase 2) son **owner-o-admin**: el dueño del turno siempre puede: un
admin del tenant (`RbacService.userIsTenantAdmin`, no `Cajas:Leer` — un supervisor
no-admin sigue sin poder) puede además **forzar** el cierre completo de la caja de OTRO
cajero, desde el conteo inicial, no solo finalizar una conciliación que el dueño ya
congeló (decisión del owner 2026-08-11, plan `testigo-cierre-forzado`: sin esto, un cajero
que se va deja su caja abierta para siempre y, por `ux_cajas_activa_por_usuario`, no puede
volver a abrir ninguna). Un cierre forzado congela además quién contó
(`cajas.cerrada_por`) y cuántos garzones había en turno en ese momento
(`cajas.testigos_disponibles`), y pasa SIEMPRE por conciliación aunque cuadre — nunca
auto-cierra —, porque ahí es donde va a vivir la firma del testigo. Ese flujo de
solicitud/firma todavía no existe (sigue en `docs/agent/pendientes.md` / el plan en curso);
lo que ya funciona hoy es el forzado en sí.

---

## Definición de cajones (Configuración → Cajas)

**Sub-proyecto 1 de 3** del refactor general de caja (ver roadmap §9 de la
[investigación de mercado](../agent/investigaciones/2026-07-23-gestion-caja.md)).
Introduce el **cajón físico** (Mostrador, Delivery, Barra…) como entidad propia que el
admin del tenant define en Configuración. El vínculo `cajon_id` en la sesión de caja
(`cajas`) y la autorización de qué usuario puede abrir qué cajón se documentan en
[Apertura sobre un cajón](#apertura-sobre-un-cajón-sub-proyecto-33) más abajo — ese
sub-proyecto cierra la **estructura** del refactor.

**Nota de terminología:** `cajones` (este módulo, el mueble físico) ≠ `cajas` (la
sesión/turno documentada en el resto de este archivo). A partir de este sub-proyecto,
"cajón" es siempre el mueble físico y "caja" es siempre la sesión — no usar ambos
términos indistintamente.

### Entidad `cajones`

**Table**: `cajones` (tenant-owned)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `cajon_id` | UUID | PK | |
| `tenant_id` | UUID | FK tenants, NOT NULL | Del token — nunca del body |
| `nombre` | TEXT | NOT NULL | Único por tenant (ver regla abajo) |
| `activo` | BOOLEAN | NOT NULL, default `true` | Desactivar sin borrar |
| `creado_el` | TIMESTAMPTZ | NOT NULL | |
| `actualizado_el` | TIMESTAMPTZ | NOT NULL | |
| `eliminado_el` | TIMESTAMPTZ | nullable | Soft delete |

Índice único parcial `ux_cajones_tenant_nombre` sobre `(tenant_id, nombre)` filtrando
`eliminado_el IS NULL` — la garantía dura contra duplicados bajo concurrencia; el
service valida antes (`validarNombreUnico`) para devolver un `409` con mensaje amable.

### Endpoints

- **Module**: `src/modules/cajones/cajones.module.ts`
- **Controller**: `src/modules/cajones/cajones.controller.ts`
- **Service**: `src/modules/cajones/cajones.service.ts`

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/cajones` | `Cajas` / `Leer` | Lista cajones del tenant, ordenados por nombre |
| POST | `/cajones` | `Cajas` / `Crear` | Crea cajón; `409` si el `nombre` ya existe (no borrado) en el tenant |
| PATCH | `/cajones/:id` | `Cajas` / `Actualizar` | Edita `nombre` y/o `activo`; `409` si el nuevo nombre choca con otro cajón |
| DELETE | `/cajones/:id` | `Cajas` / `Eliminar` | Soft delete (`softDelete`, nunca `DELETE` físico) |

Todos bajo `JwtAuthGuard + TenantGuard + PermisosGuard` en la clase, igual que el resto
de módulos de feature — ver `docs/patterns/backend.md §4`.

### Módulo de permiso `Cajas` extendido (antes solo `Leer`)

Hasta este sub-proyecto, el módulo de permiso `Cajas` solo tenía la acción `Leer`
(supervisión read-only de sesiones — ver [Modelo de acceso por
permiso](#modelo-de-acceso-por-permiso)). Se **extendió** con `Crear` / `Actualizar` /
`Eliminar` para gobernar también el CRUD de cajones: no se creó un módulo de permiso
nuevo porque supervisar sesiones y definir cajones son responsabilidades del mismo rol
"encargado de caja" del tenant. Solo se agregaron filas `modulo_app_permiso` — el
módulo `Caja` (sesión) y su controller/service **no se tocaron**.

### Frontend

- **Page**: `pages/configuracion/cajas.vue` — CRUD de cajones dentro de Configuración
  (tabla + drawer crear/editar + confirm de eliminar). Gate por `Cajas:Crear` /
  `Actualizar` / `Eliminar` (UX-only; el backend enforcea con `@RequiresPermiso`). La
  etiqueta de UI que ve el admin ("Cajas") mapea a la entidad `cajones` — ver nota de
  terminología arriba. La misma página trae una tarjeta "Política de cierre" con el
  toggle "Arqueo ciego" (`Cajas:Actualizar` para escribir, `Cajas:Leer` alcanza para
  verlo deshabilitado) — ver [Cierre ciego](#cierre-ciego-modo-anti-fraude).

### Autorización: qué usuarios abren qué cajones (allow-list)

**Sub-proyecto 2 de 3** del refactor general de caja (roadmap
[§9](../agent/investigaciones/2026-07-23-gestion-caja.md#9-roadmap-del-refactor-general-de-caja-decisión-2026-07-23)).
El admin define, por cajón, la lista de usuarios autorizados a abrirlo — un mapeo
N-a-N, no un amarre 1-a-1.

**Table**: `cajon_usuario` (tenant-owned)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `cajon_usuario_id` | UUID | PK | |
| `cajon_id` | UUID | FK cajones, NOT NULL | |
| `usuario_id` | UUID | FK usuarios, NOT NULL | |
| `tenant_id` | UUID | FK tenants, NOT NULL | Del token — nunca del body |
| `creado_el` | TIMESTAMPTZ | NOT NULL | |
| `actualizado_el` | TIMESTAMPTZ | NOT NULL | |
| `eliminado_el` | TIMESTAMPTZ | nullable | Soft delete |

Índice único parcial `ux_cajon_usuario_cajon_usuario` sobre `(cajon_id, usuario_id)`
filtrando `eliminado_el IS NULL` — una habilitación viva por par no se repite; al
quitar y re-habilitar un usuario, la fila anterior queda soft-deleted y se crea una
fila nueva.

**Endpoints** (mismo controller `cajones.controller.ts`):

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/cajones/:id/usuarios` | `Cajas` / `Leer` | Lista `usuarioId` autorizados del cajón |
| PUT | `/cajones/:id/usuarios` | `Cajas` / `Actualizar` | Reemplaza el set completo (replace-set, no incremental) |

`PUT` recibe la lista completa de `usuarioIds` deseada; el service calcula el diff
contra los vivos (`quitar` = softDelete de los que sobran, `agregar` = insertar los
nuevos) dentro de una transacción. La pertenencia de cada `usuarioId` se valida en un
solo `count` contra `usuarios_tenants` (miembro del tenant) — `400` si alguno es
ajeno; sin N+1.

**Regla de lista vacía = permisiva.** Un cajón sin ningún `cajon_usuario` vivo **no
está bloqueado para nadie** — queda abierto a cualquier usuario con `MiCaja:Crear`.
La allow-list es una restricción opt-in que el admin agrega cajón por cajón, no un
default cerrado.

**Enforcement al abrir.** Desde el sub-proyecto 3 (ver [Apertura sobre un
cajón](#apertura-sobre-un-cajón-sub-proyecto-33)), `POST /caja/abrir` consulta esta
allow-list y la hace valer: cajón con lista vacía → cualquiera con `MiCaja:Crear`
puede abrirlo; cajón con lista no vacía → solo un usuario en ella.

**Ortogonalidad con `MiCaja:Crear`:** son dos preguntas distintas que se cruzan al
abrir, no una redundancia.

| Pregunta | Responde |
|---|---|
| ¿Puede este usuario operar caja en general? | `MiCaja:Crear` (RBAC) |
| ¿En cuáles cajones puede hacerlo? | Allow-list (`cajon_usuario`) |

Un usuario sin `MiCaja:Crear` no abre ningún cajón aunque esté en la allow-list de
todos; un usuario con `MiCaja:Crear` pero fuera de la allow-list de un cajón
específico no podrá abrir *ese* cajón en particular.

---

## Apertura sobre un cajón (sub-proyecto 3/3)

**Sub-proyecto 3 de 3** del refactor general de caja (roadmap
[§9](../agent/investigaciones/2026-07-23-gestion-caja.md#9-roadmap-del-refactor-general-de-caja-decisión-2026-07-23)).
Cierra la **estructura** del refactor (opción A: cajones + autorización + sesión sobre
cajón). Las features de negocio que salieron de la misma investigación — modelo del
esperado multi-medio (§3), cierre forzado (§6), blind count/motivos categorizados (§5)
— quedan **fuera de alcance**, diferidas para montarse después sobre esta estructura.

**La caja física ya no se abre "al aire": se abre sobre un cajón.** `POST /caja/abrir`
exige `cajonId` (antes solo pedía `saldoInicial`). La caja **virtual** no cambia: se
sigue sembrando automáticamente por tenant con `cajon_id = NULL`, siempre abierta, y no
pasa por este flujo.

### Validaciones al abrir, en orden, bajo una transacción

1. **Usuario libre** — sigue la regla previa: una sola caja física `abierta` o
   `en_conciliacion` por `(tenant, usuario)` (`409` si ya tiene una; desde el
   sub-proyecto C una conciliación pendiente también cuenta).
2. **Cajón válido y activo** — el `cajonId` debe existir en el tenant, no estar
   soft-deleted y tener `activo = true` (`404` si no existe, `409` si está inactivo).
3. **Autorizado** — hace valer la allow-list del sub-2 (`cajon_usuario`): lista vacía
   para ese cajón = permisivo (cualquiera con `MiCaja:Crear`); lista no vacía = solo un
   usuario en ella (`403` si no está autorizado).
4. **Cajón libre** — sin sesión `abierta` ni `en_conciliacion` para ese `cajonId`, con
   lock pesimista (`FOR UPDATE`) sobre esas sesiones del cajón antes de insertar, para
   cerrar la ventana de carrera entre el chequeo y el insert (`409` si ya tiene una).
   Backstop de concurrencia: el índice único parcial (ver [Entity &
   Database](#entity--database)) solo cubre `estado='abierta'` — convierte cualquier
   condición de carrera entre dos aperturas simultáneas en un `23505` que el service
   traduce a `409`; una sesión `en_conciliacion` la excluye el lock, no el índice (ver
   [`en_conciliacion` ocupa igual que
   `abierta`](#en_conciliacion-ocupa-igual-que-abierta)).

### Picker: `GET /caja/cajones-disponibles`

Antes de abrir, el frontend pide la lista de cajones que el usuario **puede** elegir:
activos, sin sesión `abierta` ni `en_conciliacion`, y (lista vacía o el usuario está en
la allow-list) — la intersección de los puntos 2–4 de arriba, resuelta en una sola
query. Un cajón que no aparece en el picker no es un cajón que exista con otro estado
escondido: es un cajón ocupado (incluida una conciliación pendiente), inactivo o fuera
de la allow-list del usuario.

```
GET /caja/cajones-disponibles
Permiso requerido: MiCaja / Crear

Response (200):
[{ "cajonId": "uuid", "nombre": "Mostrador" }, ...]
```

### Integridad: no se puede inhabilitar un cajón en uso

`PATCH /cajones/:id` con `activo: false` y `DELETE /cajones/:id` (soft delete)
verifican que el cajón no tenga una sesión `abierta` antes de aplicar el cambio —
`409 Conflict` si la tiene ("cierra la caja antes de desactivar/eliminar"). Sin esta
guarda, desactivar o borrar un cajón con una sesión viva dejaría una caja abierta
apuntando a un cajón inactivo o inexistente.

---

## Arqueo de caja multi-medio (sub-proyecto de negocio A, post-estructura)

**Sub-proyecto A** de las features de negocio diferidas por el roadmap
[§9](../agent/investigaciones/2026-07-23-gestion-caja.md#9-roadmap-del-refactor-general-de-caja-decisión-2026-07-23)
del refactor general de caja — se monta sobre la estructura cajones + sesión (sub-1/2/3).
Resuelve el hallazgo [§3/§7](../agent/investigaciones/2026-07-23-gestion-caja.md#3-lo-que-requiere-decisión-de-negocio-no-auto-resolver)
de la investigación: hasta este sub-proyecto, `saldo_esperado` sumaba **toda** entrada de
caja sin mirar el método de pago — vender $500 con tarjeta inflaba el esperado de
efectivo en $500 (**faltante fantasma**), porque el cierre era un solo número mezclando
efectivo y medios electrónicos que nunca están físicamente en el cajón.

### El modelo: una línea esperado-vs-contado por método

El cierre deja de ser "un número" y pasa a ser un **arreglo de líneas**, cada una con su
propio `esperado`/`contado`/`diferencia`:

- **Línea de efectivo** (`metodoPagoId = null`, agregada, siempre presente): fondo inicial
  + entradas de métodos marcados efectivo + entradas manuales (`metodo_pago_id IS NULL`)
  − todas las salidas. Los vueltos ya llegan netos (el `movimiento_caja` de un pago
  registra `monto = pago − vuelto`), así que no se restan aparte.
- **Una línea por método no-efectivo** que tuvo movimientos en la caja (tarjeta,
  transferencia, etc.): `esperado` = suma de sus entradas. Es informativa salvo que el
  tenant la haga obligatoria (ver abajo).

Esto es **norma LatAm** (Fudo/Bsale/Toteat cuadran por medio de pago), no la escuela
"cajón solo-efectivo" de Toast/Square — decisión tomada en la investigación §7.3.

### Dos booleanos que no hay que confundir

| Campo | Tabla | Alcance | Significa |
|---|---|---|---|
| `es_efectivo` | `metodos_pago` | Global (catálogo del sistema) | Intrínseco al método: define qué entra a la línea de efectivo agregada. No lo decide el tenant. |
| `requiere_conteo` | `tenant_metodo_pago` | Por tenant | Política operativa: fuerza el conteo obligatorio de un método **no-efectivo** al cerrar (ej. el tenant quiere conciliar tarjeta contra el cierre del terminal Transbank todos los días). |

**Regla de obligatoriedad:** `obligatorio = es_efectivo OR requiere_conteo`. La línea de
efectivo es siempre obligatoria (no depende de ningún flag de tenant); una línea de
método no-efectivo es obligatoria solo si el tenant activó `requiere_conteo` para ese
método. El resto queda informativo: se puede declarar un contado si se quiere, pero no
bloquea el cierre.

`es_efectivo` se lee del movimiento histórico sin filtrar `metodos_pago.eliminado_el` a
propósito: es intrínseco al método que se usó en su momento, no al estado actual del
catálogo — un método borrado después de usarse en una venta no debe desaparecer de la
línea de efectivo del arqueo ni de su fila informativa. El join a `tenant_metodo_pago`
sí filtra `tmp.eliminado_el IS NULL`: `requiere_conteo` no es intrínseco como
`es_efectivo` — es política de tenant, así que si la config se borra, `requiere_conteo`
cae a `false` vía `COALESCE`.

### Tabla `caja_arqueo_medio` — detalle del cierre, congelado

Cada cierre inserta **una fila por línea del arqueo recomputado** (nunca se recalcula
después): `metodo_pago_id NULL` = la línea de efectivo agregada. `esperado` es siempre
`NOT NULL` (se congela aunque el método no sea obligatorio); `contado`/`diferencia` son
nullable — `NULL` significa que esa línea informativa no se contó. Índice único parcial
`(caja_id, metodo_pago_id)` filtrando `eliminado_el IS NULL`: una fila viva por línea y
caja. Ver [Entity & Database](#entity--database).

### `GET /caja/:id/arqueo` — preview o congelado según el estado

```
GET /caja/:id/arqueo
Authorization: Bearer <token>

Permiso requerido: MiCaja:Leer (propia) o Cajas:Leer (ajena) — lectura compartida,
                   igual que el resto de endpoints de lectura de este controller.

Response (200): { "ciego": boolean, "lineas": [...] } — ver por qué el envoltorio en
                Cierre ciego (modo anti-fraude) más abajo.

Si la caja está 'abierta' y el tenant NO tiene arqueo ciego — preview recomputado en
vivo, sin contado:
{
  "ciego": false,
  "lineas": [
    { "metodoPagoId": null, "nombre": "Efectivo", "esEfectivo": true,
      "esperado": "750.0000", "requiereConteo": true },
    { "metodoPagoId": "uuid", "nombre": "Tarjeta débito", "esEfectivo": false,
      "esperado": "320.0000", "requiereConteo": false }
  ]
}

Si la caja está 'en_conciliacion' o 'cerrada' — SIEMPRE `ciego:false`, líneas congeladas de
`caja_arqueo_medio` (el modo ciego solo retiene mientras la caja está `abierta`; ambos
estados no-`abierta` comparten la misma rama de lectura, ver [Cierre en dos
fases](#cierre-en-dos-fases--motivos-de-diferencia-sub-proyecto-c)):
{
  "ciego": false,
  "lineas": [
    { "metodoPagoId": null, "nombre": "Efectivo", "esEfectivo": true,
      "esperado": "750.0000", "requiereConteo": true,
      "contado": "748.5000", "diferencia": "-1.5000",
      "motivoDiferenciaId": "uuid-o-null", "motivoNombre": "falta de efectivo",
      "comentarioDiferencia": "Faltó billete de 5" },
    { "metodoPagoId": "uuid", "nombre": "Tarjeta débito", "esEfectivo": false,
      "esperado": "320.0000", "requiereConteo": false,
      "contado": null, "diferencia": null,
      "motivoDiferenciaId": null, "motivoNombre": null, "comentarioDiferencia": null }
  ]
}
```

`motivoDiferenciaId`/`motivoNombre`/`comentarioDiferencia` solo tienen valor cuando la
línea descuadró y ya se justificó (fase 2 del cierre o el override admin); `null` en
cualquier otro caso, incluida una línea que cuadró exacto.

El drawer de cierre (`CajaCierreDrawer`) llama este endpoint al abrirse para armar el
formulario; el detalle read-only de una caja cerrada lo usa para mostrar el desglose.

### Conteo multi-línea (congelado en la fase 1 del cierre)

Esta parte no cambió con el sub-proyecto C: sigue siendo un arreglo de líneas en vez de un
`montoContado` único. Lo que sí cambió es **qué endpoint** lo recibe — `POST
/caja/:id/conteo` (fase 1), no `POST /caja/:id/cerrar` (que ahora es la fase 2, sin
`montoContado`). Ver [Cierre en dos fases](#cierre-en-dos-fases--motivos-de-diferencia-sub-proyecto-c)
para la razón de la división y el contrato completo de ambos endpoints.

```
Request POST /caja/:id/conteo:
{
  "lineas": [
    { "metodoPagoId": null, "montoContado": "748.50" },
    { "metodoPagoId": "uuid-tarjeta", "montoContado": "320.00" }
  ],
  "comentario": "Faltó billete de 5"   // opcional
}

Response (200):
{ "estado": "cerrada" | "en_conciliacion", "arqueo": [ ...líneas congeladas con contado/diferencia... ] }
```

**El esperado nunca viene del cliente.** El servidor recomputa el arqueo completo dentro
de la misma transacción del conteo (`calcularArqueo`, con lock pesimista de la caja) y lo
congela junto con el `contado` que declaró el cajero; el body del cliente solo aporta
`montoContado` por línea. Esto cierra la puerta a que un cliente manipulado declare un
esperado distinto al real.

### Agregados de `cajas` = línea de efectivo (backward-compat del historial)

`cajas.saldo_final` / `monto_contado` / `diferencia` — los campos que ya existían antes
de este sub-proyecto — pasan a representar **la línea de efectivo**, no un total
mezclado: al congelar el conteo (fase 1, `POST /caja/:id/conteo`) el service toma la línea
`metodoPagoId === null` del arqueo congelado y la copia a esos tres campos. Así el
historial (`GET /caja`) y cualquier reporte que ya lea `cajas.*` sigue funcionando sin
cambios, y sigue significando lo mismo que documentaba esta feature desde el inicio:
cuadre del efectivo físico del cajón.

⚠️ **Por eso el historial NO puede rotular `diferencia` como "la" diferencia de la caja.**
Con `requiere_conteo = true` en un método no-efectivo, una caja podía cerrarse con -500 en
tarjeta y el listado mostraba **+0** mientras el detalle mostraba **-500** — dos números
distintos con la misma etiqueta, y el descuadre invisible justo en la superficie que barre
el supervisor (auditoría 2026-07-27). El listado emite además **`diferenciaTotal`**: la
suma de **todas** las líneas del arqueo congelado, que es la que responde "¿cuadró?" y la
que muestra la columna. Sale por `LEFT JOIN LATERAL` con un `SUM` en la misma query del
listado — una sola consulta para todas las filas, sin N+1. Es `null` mientras la caja no
tenga arqueo congelado (o sea, mientras está `abierta`), y el front muestra "—".

### El fix: salida manual y NC "devolver dinero" validan contra efectivo real

Antes de este sub-proyecto, el bloqueo de saldo insuficiente (`422`, ver
[Bloqueo de salida por saldo insuficiente](#bloqueo-de-salida-por-saldo-insuficiente-contra-la-línea-de-efectivo)) y
el egreso de la nota de crédito con devolución de dinero (`POST
/ventas/:id/notas-credito` con `devolverDinero: true`, ver
[`docs/features/ventas.md`](./ventas.md)) validaban contra el mismo saldo mezclado. Ambos
ahora llaman `calcularEsperadoEfectivo` (la misma fórmula de la línea de efectivo) antes
de descontar — ya no se puede egresar efectivo físico contra plata que en realidad entró
por tarjeta.

### Backward-compat: cajas viejas sin desglose

Las cajas cerradas **antes** de este sub-proyecto no tienen filas en
`caja_arqueo_medio` (sin backfill). Su `GET /:id/arqueo` en una caja cerrada devuelve un
arreglo vacío, y el detalle read-only (`/mi-caja/[id]`, `/cajas/[id]`) solo muestra la
sección de desglose (`CajaArqueoTable`) si `arqueo.length > 0` — para esas cajas el
cuadre agregado en `cajas.saldo_final`/`monto_contado`/`diferencia` sigue visible como
antes, simplemente sin la tabla por método.

---

## Cierre ciego (modo anti-fraude)

**Sub-proyecto de negocio B**, montado sobre el arqueo multi-medio (sub-proyecto A, arriba) —
resuelve la mitad barata del hallazgo "blind count" del roadmap
[§9](../agent/investigaciones/2026-07-23-gestion-caja.md#9-roadmap-del-refactor-general-de-caja-decisión-2026-07-23)
(§5/§6 de la investigación). En un **cierre ciego** el cajero cuenta el cajón **sin ver el
monto esperado** — declara lo que contó y recién ahí el sistema revela la diferencia. Es el
estándar anti-fraude de Bsale/Toteat en Chile: si el cajero ve el esperado, un faltante se
puede "maquillar" declarando justo ese número.

### Config por tenant, no por rol

`tenants.arqueo_ciego` (booleano, default `false`) activa o desactiva el modo para **todo el
tenant**. No es un permiso de rol — la distinción cajero/supervisor ya la dan los módulos
`MiCaja`/`Cajas`; lo que cambia es la política operativa del negocio. Se edita en
Configuración → Cajas (misma página que el CRUD de cajones, tarjeta "Política de cierre") con
permiso `Cajas:Actualizar`; leerlo alcanza con `Cajas:Leer`.

- `GET /caja/arqueo-ciego` (`Cajas:Leer`) → `{ "arqueoCiego": boolean }`
- `PUT /caja/arqueo-ciego` (`Cajas:Actualizar`), body `{ "arqueoCiego": boolean }` →
  `{ "arqueoCiego": boolean }`

Cambiar la config afecta los cierres **desde ese momento**; no reescribe arqueos ya
congelados de cierres anteriores.

### Enforcement en el backend, no en la UI

Ocultar el esperado solo en el frontend no sirve — el dato viajaría igual en la respuesta
HTTP y sería evadible con curl/devtools. La retención vive en `obtenerArqueo`
(`caja.service.ts`): en modo ciego **y** con la caja `abierta`, la respuesta devuelve
`esperado: null` en cada línea y se **filtra** a solo las líneas obligatorias (efectivo +
las que tengan `requiereConteo`) — las informativas ni siquiera se listan. Es la regla
`ciego && abierta && !esAdmin`: no lo ve **ni el dueño del turno ni el supervisor con
`Cajas:Leer`** — solo el admin del tenant y el superadmin, para quienes el ciego no aplica
(ver [Alcance del modo ciego](#alcance-del-modo-ciego-arqueo_ciego) y el criterio
`esAdmin = esSuperadmin || userIsTenantAdmin`). Que al supervisor **sí** le aplique es una
decisión explícita del owner, más estricta que el estándar de mercado (donde el supervisor
lo ve).

Por eso la respuesta de `GET /caja/:id/arqueo` cambió de un arreglo plano (`LineaArqueo[]`)
a un envoltorio `{ ciego: boolean, lineas: LineaArqueo[] }` — el cliente necesita saber si
está mirando un preview retenido o uno completo para renderizar el drawer en consecuencia
(ver ejemplos en [GET /caja/:id/arqueo](#get-cajaidarqueo--preview-o-congelado-según-el-estado)
más arriba).

**Caja `en_conciliacion` o cerrada → siempre revela**, sin importar la config del tenant
(`ciego:false` y las líneas congeladas completas, con `contado`/`diferencia`). El modo
ciego afecta únicamente el conteo **en curso** (caja `abierta`); el histórico de una caja
que ya pasó por la fase 1 nunca queda retenido — sería inútil para conciliar y auditar
después. La revelación es una propiedad de la respuesta al **congelar el conteo** (fase 1,
`POST /caja/:id/conteo` — ver abajo), no de un endpoint aparte.

### La revelación ocurre en la fase 1 del cierre (`POST /caja/:id/conteo`)

Con el sub-proyecto C el cierre se partió en dos fases (ver [Cierre en dos
fases](#cierre-en-dos-fases--motivos-de-diferencia-sub-proyecto-c) más abajo). La fase 1
(`enviarConteo`) sigue haciendo exactamente lo que hacía el `cerrar` original de este
sub-proyecto A: recompute server-side del arqueo completo + congelado en
`caja_arqueo_medio`, sin conocer el modo ciego. Su response (`{ estado, arqueo }`) siempre
trae el esperado/contado/diferencia completos, sea que el resultado bifurque a
`estado: 'cerrada'` (auto-cierre, todo cuadró) o a `estado: 'en_conciliacion'` (algo
descuadró) — es, en ambos casos, el momento en que el cajero deja de estar ciego. La
fase 2 (`POST /caja/:id/cerrar`) no recomputa nada — solo aplica los motivos de las
líneas descuadradas y finaliza —, así que no tiene ningún rol en la revelación. El modo
ciego sigue gobernando únicamente el **preview** (`GET /:id/arqueo` con la caja todavía
`abierta`), nunca el resultado del conteo ni de un cierre posterior.

### Drawer ciego + revelación por redirección al detalle

`CajaCierreDrawer` lee `cajaStore.arqueoCiego` (poblado por `cargarArqueo`, que ahora
consume `{ ciego, lineas }`). En modo ciego el drawer solo muestra las líneas obligatorias,
sin esperado ni diferencia en vivo (los inputs de conteo son los mismos, pero no hay número
de referencia contra qué compararse mientras se escribe). Al confirmar el cierre, en vez de
solo cerrar el drawer, el flujo **redirige al detalle** de la caja recién cerrada
(`/mi-caja/[id]`) para que el cajero vea ahí la diferencia revelada vía `CajaArqueoTable` —
la misma tabla congelada que usa cualquier caja cerrada, no una vista especial. En modo
normal (`arqueoCiego === false`) el drawer se comporta exactamente como en el sub-proyecto A
(esperado y diferencia visibles en vivo, sin redirección forzada al cerrar).

### Qué queda diferido

Fuera de alcance de este sub-proyecto, siguen pendientes en
[`docs/agent/pendientes.md`](../agent/pendientes.md) y documentados en la investigación
[§6](../agent/investigaciones/2026-07-23-gestion-caja.md#6-poderes-del-encargado-sobre-la-caja-del-cajero-investigación-2026-07-23):

- ~~**Cierre forzado de una caja ajena por el encargado**~~ — implementado, ver [Modelo de
  acceso](#modelo-de-acceso-por-permiso). Falta la firma de testigo (plan
  `testigo-cierre-forzado`, en curso).
- **Aprobación de cierre por umbral de diferencia** (patrón Toast: si el over/short supera
  un umbral configurable, requiere aprobación del supervisor).
- **Ocultar el resultado *después* del cierre** al cajero — en el modo ciego de hoy, al
  enviar el conteo el cajero **sí** ve su propia diferencia (la revelación es inmediata,
  vía el detalle) aunque la caja quede `en_conciliacion`. El sub-proyecto C (ver [Cierre
  en dos fases](#cierre-en-dos-fases--motivos-de-diferencia-sub-proyecto-c) más abajo)
  resolvió la conciliación operador→supervisor de §6 pero no este ítem puntual — sigue
  diferido en `docs/agent/pendientes.md`.

---

## Cierre en dos fases + motivos de diferencia (sub-proyecto C)

**Sub-proyecto de negocio C**, montado sobre el arqueo multi-medio (A) y el cierre ciego
(B) — resuelve la mitad que quedaba de §5/§6 de la investigación
[`2026-07-23-gestion-caja.md`](../agent/investigaciones/2026-07-23-gestion-caja.md): la
**conciliación operador→supervisor** (§6) y los **motivos categorizados de diferencia**
(§5). Antes de este sub-proyecto, `POST /caja/:id/cerrar` recomputaba, congelaba y cerraba
en un solo paso — un descuadre quedaba en el historial sin ninguna explicación
estructurada de por qué pasó, y nadie más que el propio cajero podía cerrar su turno bajo
ninguna circunstancia.

### Por qué dos fases y no una

Congelar el conteo y decidir qué hacer con el descuadre son dos preguntas distintas:
*"¿cuánto hay realmente en el cajón?"* (un hecho, que no debería poder tocarse después de
observado) y *"¿por qué no coincide con lo esperado?"* (una explicación de negocio, que
puede tomar más tiempo — el cajero puede necesitar preguntarle al supervisor, revisar un
comprobante, etc.). Congelarlas en un solo paso obligaba a justificar la diferencia *antes*
de que existiera un registro inmutable de qué se contó — dejando una ventana donde el
cajero podía "ajustar" el conteo a lo que le convenía justificar. Separar las fases cierra
esa ventana: el hecho se congela primero, la explicación se resuelve después, sobre un
número que ya no se puede cambiar.

### Fase 1 — `POST /caja/:id/conteo`: congela y revela

Igual que el `cerrar` del sub-proyecto A: recomputa el arqueo completo server-side
(`calcularArqueo`, con lock pesimista de la caja `abierta`), lo congela en
`caja_arqueo_medio` junto con el `contado` que declaró el cajero, y copia la línea de
efectivo a `cajas.saldoFinal`/`montoContado`/`diferencia` (ver [Agregados de
`cajas`](#agregados-de-cajas--línea-de-efectivo-backward-compat-del-historial)). A partir
de acá **ninguna línea vuelve a recomputarse** — ni en la fase 2 ni en el override admin.
Owner-o-admin (`MiCaja:Actualizar`; ver [Modelo de acceso](#modelo-de-acceso-por-permiso)):
un admin puede forzar el conteo de la caja de otro cajero, y ahí también congela
`cajas.cerrada_por` (quién contó) y `cajas.testigos_disponibles` (garzones en turno en ese
momento).

Bifurca según el resultado:

- **Ninguna línea descuadra Y el usuario del token es el dueño** → auto-cierre:
  `estado: 'cerrada'` + `fechaCierre` fijada. No hay fase 2 que resolver — el flujo termina
  acá, como antes del sub-proyecto C.
- **Alguna línea descuadra, O el conteo lo envió un admin que no es el dueño (forzado)** →
  `estado: 'en_conciliacion'`, sin `fechaCierre`. Un forzado pasa por acá SIEMPRE, cuadre o
  no — es donde va a vivir la firma del testigo. La fase 2 (abajo) es la única forma de
  sacarla de ese estado.

```
POST /caja/:id/conteo
Permiso requerido: MiCaja / Actualizar — owner-o-admin (cierre forzado, ver Modelo de acceso)
Request: { "lineas": [{ "metodoPagoId": null | string, "montoContado": string }, ...], "comentario"?: string }
Response (200): { "estado": "cerrada" | "en_conciliacion", "arqueo": LineaArqueo[] }
Error (400) si falta el conteo de una línea obligatoria o una línea no pertenece al arqueo.
Error (403) si la caja no existe, no está 'abierta', o no es del usuario ni el usuario es admin.
```

### `en_conciliacion` ocupa igual que `abierta`

Una caja `en_conciliacion` sigue "activa" a todo efecto de exclusión mutua — la
conciliación pendiente es trabajo sin terminar, no un estado de reposo:

- **Bloquea abrir otra caja** — `findActiva` la incluye junto a `abierta`; el cajero no
  puede abrir un segundo turno mientras tenga una conciliación pendiente.
- **Ocupa el cajón** — `abrir` y `cajonesDisponibles` tratan `en_conciliacion` igual que
  `abierta` al decidir si un cajón está libre; otro usuario no puede abrir sobre ese cajón
  hasta que la conciliación se resuelva.
- **Bloquea ventas y movimientos** — `registrarMovimiento` y cualquier flujo que dependa de
  `bloquearCajaAbierta` exige `estado = 'abierta'` a secas; una caja `en_conciliacion` no
  la cumple, así que no admite entradas/salidas manuales ni nuevas ventas físicas sobre
  ella. El único camino hacia adelante es la fase 2.
- **`cajonesEstado`** (grid de supervisión) también considera ocupado un cajón con una
  sesión `en_conciliacion`, para que el supervisor vea que ese cajón tiene trabajo
  pendiente, no que está libre.

El índice único parcial `ux_cajas_cajon_abierta` (BD) solo cubre `estado = 'abierta'` —
la ocupación de `en_conciliacion` es una regla de aplicación (service), no un constraint
de base de datos; ver el comentario en `startup-pos.sql`.

### Fase 2 — `POST /caja/:id/cerrar`: justifica y finaliza (owner **o** admin)

Recibe un motivo (y opcionalmente un comentario) por cada línea que descuadró en la fase
1, los aplica sobre las filas ya congeladas de `caja_arqueo_medio` y recién entonces marca
`estado: 'cerrada'` + `fechaCierre`. **No recalcula nada**: `esperado`/`contado`/
`diferencia` quedaron fijados en la fase 1; esta fase solo escribe
`motivo_diferencia_id`/`comentario_diferencia`. Si falta un motivo (o el comentario que
ese motivo exige) para alguna línea descuadrada, lanza `400` y la caja **sigue**
`en_conciliacion` — la transacción no finaliza a medias.

⚠️ **La completitud se verifica contra el arqueo congelado, no contra el payload.** El
recorrido sale de las filas descuadradas de `caja_arqueo_medio`: una línea que descuadra y
que el request **omite** falla igual que una que llega vacía, con el mismo mensaje. Mientras
el recorrido salía de `lineas`, mandar `{"lineas": []}` cerraba la caja dejando el faltante
sin justificar para siempre (auditoría 2026-07-27). Las líneas que cuadran se ignoran, así
que un cierre sin descuadres sigue aceptando `lineas: []`.

```
POST /caja/:id/cerrar
Permiso requerido: MiCaja / Actualizar — owner-o-admin (ver más abajo)
Request: { "lineas": [{ "metodoPagoId": null | string, "motivoDiferenciaId"?: string, "comentarioDiferencia"?: string }, ...] }
Response (200): { "caja": Caja (estado 'cerrada'), "arqueo": LineaArqueo[] }
Error (400) si falta el motivo (o el comentario que ese motivo exige) de una línea descuadrada.
Error (403) si la caja no existe o no es del usuario ni el usuario es admin.
Error (400) si la caja no está 'en_conciliacion'.
```

**Owner-o-admin, no `TenantAdminGuard`.** El endpoint NO usa `TenantAdminGuard` (eso
bloquearía al cajero dueño de completar su propio cierre); el piso de permiso sigue siendo
`MiCaja:Actualizar` y el controller resuelve `esAdmin` aparte
(`rbacService.userIsTenantAdmin`) con el mismo criterio que usaría `TenantAdminGuard`, para
permitir *además* que un admin no-dueño finalice la conciliación. Antes del cierre forzado
(ver [Modelo de acceso](#modelo-de-acceso-por-permiso)) esta fase 2 era la única escritura
owner-o-admin del controller: un admin solo podía completar una conciliación que el dueño
**ya había congelado** en la fase 1, nunca iniciar el conteo de una caja ajena. Eso ya no
es así — un admin puede forzar también la fase 1 (`POST /caja/:id/conteo`), y ese forzado
es justamente lo que deja la caja en `en_conciliacion` para que esta fase 2 la resuelva. Lo
que esta fase 2 en sí **no** hace es tocar `cajas.cerrada_por`: ese campo se congela en la
fase 1 (con el `usuarioId` de quien envió el conteo, dueño o admin forzando), y
`cajas.usuario_id` sigue siendo siempre el dueño original del turno, sea quien sea quien
complete esta fase 2.

### El conteo es inmutable desde la fase 1 (anti-fraude)

`caja_arqueo_medio.esperado`/`contado`/`diferencia` se escriben una única vez, en la fase
1, y **nada** los vuelve a tocar — ni la fase 2, ni el override admin (abajo), ni ningún
flujo futuro. Es la misma lógica anti-fraude del cierre ciego (B): si el número se pudiera
ajustar después de conocerse la diferencia, cualquier control de motivos sería teatro —
bastaría con "corregir" el conteo para que la diferencia (y su justificación) desaparezcan.
Congelar antes de exigir la explicación es lo que hace que la explicación signifique algo.

### Motivos de diferencia — catálogo admin-only

Igual patrón que `causas_merma` (mermas de inventario): catálogo por tenant, admin-only,
con motivos **fijos** (`es_fijo`) sembrados por tenant que no se pueden renombrar ni
eliminar, pero sí togglear en `activo` y en `requiere_comentario`.

**Table**: `motivo_diferencia_caja` — ver columnas en [Entity &
Database](#entity--database). Índice único parcial `(tenant_id, lower(nombre))` filtrando
`eliminado_el IS NULL`.

**Endpoints** (`src/modules/motivos-diferencia/`, controller/service propios, no
`caja.controller.ts`):

| Método | Ruta | Guard | Descripción |
|---|---|---|---|
| GET | `/motivos-diferencia` | `JwtAuthGuard + TenantGuard` | Lista los motivos del tenant; `?soloActivas=true` filtra a `activo=true`. Sin permiso dedicado — cualquier usuario autenticado del tenant puede leer el catálogo (lo necesita para justificar una diferencia) |
| POST | `/motivos-diferencia` | `TenantAdminGuard` | Crea un motivo (`es_fijo: false` siempre) |
| PATCH | `/motivos-diferencia/:id` | `TenantAdminGuard` | Edita `nombre`/`activo`/`requiereComentario`; en un motivo fijo bloquea el rename (`400`) pero permite togglear `activo`/`requiereComentario` — divergencia intencional de `causas_merma`, donde un fijo no admite ningún cambio |
| DELETE | `/motivos-diferencia/:id` | `TenantAdminGuard` | Soft delete; `400` si el motivo es fijo |

Sembrado por tenant (`motivos-diferencia.defaults.ts`): *falta de efectivo*, *sobra de
efectivo*, *divergencia de tarjeta*, *error de lanzamiento manual*, *pago no registrado*,
*error operacional* (sin comentario obligatorio) y *otro* (`requiereComentario: true`,
la válvula de escape para lo que no encaja en ninguna categoría fija).

### Red de seguridad: sin motivos activos, el comentario es obligatorio

Un tenant puede desactivar todos sus motivos (o, en teoría, no tener ninguno). En ese caso
`aplicarMotivosADescuadres` no exige `motivoDiferenciaId` — pero exige un
`comentarioDiferencia` no vacío para cada línea descuadrada (`400` si falta). Nunca es
válido cerrar/justificar una diferencia sin ninguna explicación, tenga o no el tenant el
catálogo configurado.

### Override admin: `PATCH /caja/:id/arqueo/motivos`

Corrige (o completa) los motivos de una caja **ya `cerrada`** — el caso "el supervisor
revisa el historial días después y ve una diferencia sin justificar, o justificada con el
motivo equivocado". Mismo enforcement que la fase 2 (comparten
`aplicarMotivosADescuadres`): solo toca `motivo_diferencia_id`/`comentario_diferencia` de
las líneas ya congeladas, nunca `esperado`/`contado`/`diferencia`.

```
PATCH /caja/:id/arqueo/motivos
Guard: TenantAdminGuard (admin-only, a diferencia de la fase 2 que es owner-o-admin)
Request: { "lineas": [{ "metodoPagoId": null | string, "motivoDiferenciaId"?: string, "comentarioDiferencia"?: string }, ...] }
Response (200): { "ciego": false, "lineas": LineaArqueo[] }
Error (400) si la caja no está 'cerrada', o si falta el motivo/comentario de una línea descuadrada.
```

Frontend: `CajaArqueoTable` (usada en el detalle de cualquier caja cerrada, `/mi-caja/[id]`
y `/cajas/[id]`) habilita edición inline de motivo/comentario por línea descuadrada
solo si `puedeJustificar` (prop poblada con `perms.esAdmin`) — pre-cargada con lo ya
justificado, para poder corregir, no solo completar.

### Qué sigue diferido

Igual que en el sub-proyecto B, quedan fuera de alcance y registrados en
[`docs/agent/pendientes.md`](../agent/pendientes.md):

- ~~**Cierre forzado de una caja ajena por el encargado**~~ — implementado: un admin ya
  puede iniciar el conteo (fase 1) de la caja de otro cajero, no solo finalizar una
  conciliación que el dueño ya congeló. Ver [Modelo de
  acceso](#modelo-de-acceso-por-permiso). Falta la firma de testigo (plan
  `testigo-cierre-forzado`, en curso).
- **Aprobación de cierre por umbral de diferencia** (patrón Toast).
- **Reporte de over/short** agregado (histórico de diferencias por cajero/motivo/período).

---

### Alcance del modo ciego (arqueo_ciego)

Cuando el tenant opera en modo ciego, mientras la caja está `abierta` el operador
—cajero o supervisor— **no ve ninguna cifra derivable del esperado**: el backend
(`resumenMovimientos`, `listarMovimientos`) devuelve `ciego:true` con
entradas/salidas/esperado en `null` y la lista de movimientos vacía. El header
muestra solo `Saldo inicial` y no se renderiza la tabla de movimientos (sin
placeholder). Al **conciliar** (fase 1 → `en_conciliacion`) o cerrar, se revela todo
como detalle del arqueo. El gating espeja `obtenerArqueo`
(`arqueo_ciego && estado === 'abierta'`), con la única excepción del admin del tenant y el
superadmin, a quienes el ciego no aplica.

**Los cuatro caminos que retienen son `obtenerArqueo`, `resumenMovimientos`,
`listarMovimientos` y `cajonesEstado`.** El último se sumó en la auditoría del 2026-07-27:
la grilla de supervisión calculaba `saldoEsperado` en vivo y lo devolvía sin gatear, así que
un supervisor con `Cajas:Leer` leía desde `/cajas` el número que el arqueo le retenía. La
regla del ciego solo vale si la cumplen **todas** las superficies que exponen el esperado o
algo de donde derivarlo: al agregar una nueva, gatearla es parte de agregarla.

**El usuario contra el que se define la regla existe en el seed:**
`supervisor@paris.cl`, rol `Cajas · Supervisión` con `Cajas:Leer` y nada más. No es admin
del tenant y no tiene `MiCaja`, así que ve todas las cajas y no opera ninguna — la única
combinación a la que el ciego sí aplica *y* que llega a una caja ajena. Antes no existía
—`admin.paris` hacía de "supervisor" pero es admin, y `vendedor.paris` no ve cajas
ajenas—, así que la retención solo la cubrían mocks: ningún e2e podía distinguir "no ve el
número porque es ciego" de "no ve el número porque no llega a la caja". Lo ejerce
`caja.e2e-spec.ts` → *el modo ciego SÍ aplica al supervisor no-admin*, que assevera la
sesión **no nula** con `saldoEsperado: null`, y contra el mismo cajón y la misma caja que
el admin sí ve el número.

**Configurar el modo ciego es admin-only** (`TenantAdminGuard` en `PUT /caja/arqueo-ciego`):
es una política anti-fraude, no una acción operativa. El CRUD de cajones de la misma
pantalla sigue delegable a `Cajas:Actualizar`. Criterio: `docs/features/roles-permisos.md`,
sección "Admin-only vs permiso de módulo".

---

## API Endpoints

### GET /caja/cajones-estado — Todos los cajones activos + su estado

```
GET /caja/cajones-estado
Authorization: Bearer <token>

Permiso requerido: Cajas / Leer
Nota: endpoint exclusivo de supervisión (quien llega tiene `Cajas:Leer`). Devuelve
      TODOS los cajones activos del tenant; cada uno con su sesión `abierta` o
      `en_conciliacion` (`sesion`, cualquiera de las dos cuenta como ocupado) o `null`
      si está libre. Una sola query (LEFT JOIN a la sesión) — sin N+1.
      `saldoEsperado` llega en `null` si el tenant está en modo ciego, la caja está
      `abierta` y quien consulta no es admin del tenant ni superadmin — misma regla
      que `GET /:id/arqueo` (ver Alcance del modo ciego). En `en_conciliacion` siempre
      se revela: el conteo ya se congeló. El front muestra "—" en ese caso.

Response (200):
[
  {
    "cajonId": "uuid",
    "nombre": "Mostrador",
    "sesion": {
      "cajaId": "uuid",
      "usuarioId": "uuid",
      "usuarioNombre": "Juan Pérez",
      "saldoInicial": "500.0000",
      "saldoEsperado": "750.0000",   // null si el ciego aplica — ver Nota
      "fechaApertura": "2026-06-29T08:00:00Z",
      "esPropia": true
    }
  },
  { "cajonId": "uuid", "nombre": "Delivery", "sesion": null },
  ...
]
```

### GET /caja/activa — Caja física abierta del usuario

```
GET /caja/activa
Authorization: Bearer <token>
X-Tenant-ID: <tenantId>  (via guard, del token)

Permiso requerido: MiCaja / Leer

Response (200):
{
  "cajaId": "uuid",
  "tipo": "fisica",
  "estado": "abierta",
  "saldoInicial": "500.00",
  "saldoEsperado": "750.00",
  "abiertaEl": "2026-06-29T08:00:00Z",
  "comentario": "Turno mañana",
  "movimientos": []
}

Response (200) si no hay caja activa:
null
```

### POST /caja/abrir — Abrir caja física

```
POST /caja/abrir
Authorization: Bearer <token>

Permiso requerido: MiCaja / Crear

Request:
{
  "cajonId": "uuid",             // obligatorio — ver GET /caja/cajones-disponibles
  "saldoInicial": "500.00",
  "comentario": "Turno mañana"   // opcional
}

Response (201):
{
  "cajaId": "uuid",
  "tipo": "fisica",
  "estado": "abierta",
  "saldoInicial": "500.00",
  "saldoEsperado": "500.00",
  "abiertaEl": "2026-06-29T08:00:00Z"
}

Error (409) si ya hay una caja abierta para este usuario+tenant, o si el cajón
      elegido ya tiene una sesión abierta, o si el cajón está inactivo.
Error (404) si el cajón no existe en el tenant.
Error (403) si el usuario no está en la allow-list del cajón (ver Autorización).
Ver validaciones y orden en Apertura sobre un cajón (sub-proyecto 3/3).
```

### POST /caja/:id/movimientos — Registrar movimiento manual

```
POST /caja/:id/movimientos
Authorization: Bearer <token>

Permiso requerido: MiCaja / Crear

Request:
{
  "tipo": "entrada",          // "entrada" | "salida"
  "concepto": "Fondo adicional",
  "monto": "200.00",
  "referencia": "Ref-001"     // opcional
}

Response (201):
{
  "movimientoId": "uuid",
  "cajaId": "uuid",
  "tipo": "entrada",
  "concepto": "Fondo adicional",
  "monto": "200.00",
  "referencia": "Ref-001",
  "creadoEl": "2026-06-29T10:00:00Z"
}

Error (422) si tipo es "salida" y monto > esperado de la línea de efectivo (no el total
      mezclado — ver Arqueo de caja multi-medio § El fix).
Error (403) si la caja no pertenece al usuario (owner-only, aun con `Cajas:Leer`).
```

### GET /caja/:id/movimientos/resumen — KPIs del turno

```
GET /caja/:id/movimientos/resumen
Authorization: Bearer <token>

Permiso requerido: MiCaja:Leer (propia) o Cajas:Leer (ajena) — lectura compartida,
                   ver nota en GET /caja/:id/movimientos.

Response (200):
{
  "saldoInicial": "1000.0000",
  "totalEntradas": "500.0000",
  "totalSalidas": "200.0000",
  "saldoEsperado": "1300.0000",
  "totalMovimientos": 5
}
```

Totales globales del turno (independientes de la página del listado).

### GET /caja/:id/movimientos — Listar movimientos de la caja (paginado)

```
GET /caja/:id/movimientos?page=1&pageSize=15&tipo=entrada
Authorization: Bearer <token>

Permiso requerido: MiCaja:Leer (propia) o Cajas:Leer (ajena) — resuelto por el helper
                   `resolverLecturaCompartida` del controller (403 si no tiene ninguno).
Nota: usuarios con Cajas:Leer pueden listar movimientos de cajas ajenas (read-only).
      Solo el dueño puede registrar movimientos (POST) o cerrar (POST /cerrar),
      sin importar Cajas:Leer.

Response (200):
{
  "data": [
    {
      "id": "uuid",
      "cajaId": "uuid",
      "tipo": "entrada",
      "concepto": "Fondo adicional",
      "monto": "200.0000",
      "referencia": "Ref-001",
      "fecha": "2026-06-29T10:00:00Z",
      "ventaId": null
    }
  ],
  "meta": { "page": 1, "pageSize": 15, "total": 5, "totalPages": 1 }
}
```

### GET /caja/:id/arqueo — Preview o desglose congelado del cierre

```
GET /caja/:id/arqueo
Authorization: Bearer <token>

Permiso requerido: MiCaja:Leer (propia) o Cajas:Leer (ajena) — lectura compartida.

Response (200): { "ciego": boolean, "lineas": [...] } — una línea por método + la de
      efectivo agregada. Si la caja está 'abierta', recomputado en vivo sin
      `contado`/`diferencia` (y con `esperado:null` + solo líneas obligatorias si el
      tenant tiene el modo ciego activo — ver Cierre ciego); si está 'en_conciliacion' o
      'cerrada', SIEMPRE `ciego:false` con las filas congeladas de `caja_arqueo_medio`
      completas (incluye `motivoDiferenciaId`/`motivoNombre`/`comentarioDiferencia` si ya
      se justificó esa línea), o `[]` si es una caja cerrada antes del sub-proyecto A, sin
      backfill.
Ver detalle de forma y campos en Arqueo de caja multi-medio § GET /caja/:id/arqueo y en
Cierre ciego (modo anti-fraude).
```

### GET/PUT /caja/arqueo-ciego — Config del modo ciego por tenant

```
GET /caja/arqueo-ciego
Permiso requerido: Cajas / Leer
Response (200): { "arqueoCiego": boolean }

PUT /caja/arqueo-ciego
Permiso requerido: Cajas / Actualizar
Request: { "arqueoCiego": boolean }
Response (200): { "arqueoCiego": boolean }
```

Ver detalle de negocio en [Cierre ciego (modo anti-fraude)](#cierre-ciego-modo-anti-fraude).

### POST /caja/:id/conteo — Fase 1 del cierre: congela y revela

```
POST /caja/:id/conteo
Authorization: Bearer <token>

Permiso requerido: MiCaja / Actualizar — owner-o-admin (`Cajas:Leer` sin admin no habilita;
                   un admin del tenant puede forzar el conteo de la caja de otro cajero,
                   ver Modelo de acceso)

Request:
{
  "lineas": [
    { "metodoPagoId": null, "montoContado": "748.50" },
    { "metodoPagoId": "uuid-tarjeta", "montoContado": "320.00" }
  ],
  "comentario": "Faltó billete de 5"   // opcional
}

Response (200) — todo cuadró (auto-cierre):
{
  "estado": "cerrada",
  "arqueo": [
    { "metodoPagoId": null, "nombre": "Efectivo", "esEfectivo": true,
      "esperado": "750.0000", "requiereConteo": true,
      "contado": "750.0000", "diferencia": "0.0000" }
  ]
}

Response (200) — algo descuadró (pasa a conciliación):
{
  "estado": "en_conciliacion",
  "arqueo": [
    { "metodoPagoId": null, "nombre": "Efectivo", "esEfectivo": true,
      "esperado": "750.0000", "requiereConteo": true,
      "contado": "748.5000", "diferencia": "-1.5000" },
    { "metodoPagoId": "uuid-tarjeta", "nombre": "Tarjeta débito", "esEfectivo": false,
      "esperado": "320.0000", "requiereConteo": false,
      "contado": "320.0000", "diferencia": "0.0000" }
  ]
}

Error (400) si falta el conteo de una línea obligatoria (es_efectivo o requiere_conteo)
      o si una línea del body no pertenece al arqueo recomputado del servidor.
Error (403) si la caja no existe, no está 'abierta', o no pertenece al usuario ni el
      usuario es admin del tenant.
```

Un conteo **forzado** (usuario del token ≠ dueño de la caja, solo posible si es admin)
siempre responde `estado: "en_conciliacion"`, aunque las líneas cuadren — ver [Modelo de
acceso](#modelo-de-acceso-por-permiso).

`cajas.saldoFinal`/`montoContado`/`diferencia` quedan copiados de la línea de efectivo en
ambos casos — ver Arqueo de caja multi-medio § Agregados de `cajas`. Detalle de negocio de
la bifurcación en [Cierre en dos fases](#cierre-en-dos-fases--motivos-de-diferencia-sub-proyecto-c).

### POST /caja/:id/cerrar — Fase 2 del cierre: justifica y finaliza

```
POST /caja/:id/cerrar
Authorization: Bearer <token>

Permiso requerido: MiCaja / Actualizar — owner-o-admin (igual que la fase 1, `POST
                   /caja/:id/conteo`; `registrarMovimiento` sigue siendo la única escritura
                   estrictamente owner-only de este controller, ver Cierre en dos fases)

Request:
{
  "lineas": [
    { "metodoPagoId": null, "motivoDiferenciaId": "uuid-motivo", "comentarioDiferencia": "Faltó billete de 5" }
  ]
}

Response (200):
{
  "caja": {
    "id": "uuid",
    "estado": "cerrada",
    "saldoInicial": "500.0000",
    "saldoFinal": "750.0000",
    "montoContado": "748.5000",
    "diferencia": "-1.5000",
    "fechaCierre": "2026-06-29T18:05:00Z",
    "comentario": "Faltó billete de 5"
  },
  "arqueo": [
    { "metodoPagoId": null, "nombre": "Efectivo", "esEfectivo": true,
      "esperado": "750.0000", "requiereConteo": true,
      "contado": "748.5000", "diferencia": "-1.5000",
      "motivoDiferenciaId": "uuid-motivo", "motivoNombre": "falta de efectivo",
      "comentarioDiferencia": "Faltó billete de 5" }
  ]
}

Error (400) si falta el motivo (o el comentario que ese motivo exige) de una línea
      descuadrada.
Error (403) si la caja no existe, no pertenece al usuario ni el usuario es admin.
Error (400) si la caja no está 'en_conciliacion'.
```

No recibe `montoContado`: el conteo ya quedó congelado por la fase 1, este endpoint solo
aplica motivos. Solo hay algo que enviar en `lineas` si el conteo dejó alguna diferencia
(caja `en_conciliacion`); una caja que se auto-cerró en la fase 1 nunca llega a este
endpoint.

### PATCH /caja/:id/arqueo/motivos — Override admin sobre una caja cerrada

```
PATCH /caja/:id/arqueo/motivos
Authorization: Bearer <token>

Guard: TenantAdminGuard (admin-only)

Request:
{
  "lineas": [
    { "metodoPagoId": null, "motivoDiferenciaId": "uuid-otro-motivo", "comentarioDiferencia": "Corrección: se contó mal el vuelto" }
  ]
}

Response (200): { "ciego": false, "lineas": [...] } — mismo shape que GET /caja/:id/arqueo

Error (400) si la caja no está 'cerrada', o si falta el motivo/comentario de una línea
      descuadrada.
```

Corrige o completa la justificación de una caja ya cerrada — nunca toca
`esperado`/`contado`/`diferencia`. Detalle en [Cierre en dos
fases](#cierre-en-dos-fases--motivos-de-diferencia-sub-proyecto-c).

### GET/POST/PATCH/DELETE /motivos-diferencia — Catálogo de motivos

```
GET    /motivos-diferencia?soloActivas=true   — cualquier usuario autenticado del tenant
POST   /motivos-diferencia                    — TenantAdminGuard
PATCH  /motivos-diferencia/:id                — TenantAdminGuard
DELETE /motivos-diferencia/:id                — TenantAdminGuard

Body (POST/PATCH): { "nombre"?: string, "activo"?: boolean, "requiereComentario"?: boolean }
```

Controller/service propios (`src/modules/motivos-diferencia/`), no `caja.controller.ts`.
Detalle en [Cierre en dos fases § Motivos de diferencia](#cierre-en-dos-fases--motivos-de-diferencia-sub-proyecto-c).

### GET /caja — Historial de cajas (paginado)

```
GET /caja?page=1&pageSize=15
GET /caja?todas=true&page=1&pageSize=15   // requiere Cajas:Leer
GET /caja?usuarioId=uuid&page=1&pageSize=15   // historial de un cajero (detalle /caja/:id); ajeno requiere Cajas:Leer
GET /caja?cajonId=uuid&page=1&pageSize=15   // historial de un cajón (todos los usuarios); requiere Cajas:Leer
Authorization: Bearer <token>

Permiso requerido: MiCaja:Leer o Cajas:Leer (lectura compartida). `todas=true`,
                   `usuarioId` de otro usuario o `cajonId` solo escalan el alcance si
                   tiene `Cajas:Leer`; si no, se ignora y devuelve solo lo propio.
                   Con `cajonId` (y `Cajas:Leer`) el historial del cajón incluye a
                   todos los usuarios que lo operaron.

Response (200):
{
  "data": [
    {
      "id": "uuid",
      "tenantId": "uuid",
      "usuarioId": "uuid",
      "cajonNombre": "Mostrador",
      "tipo": "fisica",
      "estado": "cerrada",
      "saldoInicial": "500.0000",
      "saldoFinal": "750.0000",
      "montoContado": "748.5000",
      "diferencia": "-1.5000",
      "fechaApertura": "2026-06-29T08:00:00Z",
      "fechaCierre": "2026-06-29T18:00:00Z",
      "comentario": null
    }
  ],
  "meta": { "page": 1, "pageSize": 15, "total": 42, "totalPages": 3 }
}
```

### GET /caja/:id — Detalle de una caja

```
GET /caja/:id
Authorization: Bearer <token>

Permiso requerido: MiCaja:Leer (propia) o Cajas:Leer (ajena)

Response (200): objeto caja completo con movimientos embebidos.
Error (403) si la caja pertenece a otro usuario y no tiene `Cajas:Leer`.
```

---

## Backend

### Module & Services

- **Module**: `src/modules/caja/caja.module.ts`
- **Controller**: `src/modules/caja/caja.controller.ts`
- **Service**: `src/modules/caja/caja.service.ts`

### Entity & Database

**Table**: `cajas`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `caja_id` | UUID | PK | `@PrimaryGeneratedColumn('uuid')` |
| `tenant_id` | UUID | FK tenants, NOT NULL | Del token — nunca del body |
| `usuario_id` | UUID | FK usuarios, NOT NULL | Del token |
| `cajon_id` | UUID | FK cajones, nullable | Obligatorio en `'fisica'`; siempre `NULL` en `'virtual'`. Índice único parcial `ux_cajas_cajon_abierta` sobre `(cajon_id)` filtrando `estado='abierta' AND eliminado_el IS NULL` — un cajón, una sesión abierta a la vez |
| `tipo` | TEXT | NOT NULL | `'fisica'` \| `'virtual'` |
| `estado` | TEXT | NOT NULL | `'abierta'` \| `'en_conciliacion'` \| `'cerrada'` — `en_conciliacion` la fija la fase 1 del cierre cuando alguna línea descuadra; ver [Cierre en dos fases](#cierre-en-dos-fases--motivos-de-diferencia-sub-proyecto-c) |
| `saldo_inicial` | NUMERIC(18,4) | NOT NULL | Fondo al abrir; Decimal.js |
| `saldo_final` | NUMERIC(18,4) | nullable | Congelado en la fase 1 del cierre (`POST /caja/:id/conteo`) = `esperado` de la línea de efectivo (`caja_arqueo_medio` con `metodo_pago_id IS NULL`), no el total mezclado — ver Arqueo de caja multi-medio |
| `monto_contado` | NUMERIC(18,4) | nullable | Congelado en la fase 1 = `contado` de la línea de efectivo |
| `diferencia` | NUMERIC(18,4) | nullable | Congelado en la fase 1 = `diferencia` de la línea de efectivo (`monto_contado − saldo_final`) |
| `comentario` | TEXT | nullable | Al abrir; se sobrescribe con el comentario del conteo (fase 1) al enviarlo |
| `abierta_el` / `fecha_apertura` | TIMESTAMPTZ | NOT NULL | `@CreateDateColumn` |
| `fecha_cierre` | TIMESTAMPTZ | nullable | Se setea al cerrar |
| `creado_el` | TIMESTAMPTZ | NOT NULL | |
| `actualizado_el` | TIMESTAMPTZ | NOT NULL | |
| `eliminado_el` | TIMESTAMPTZ | nullable | Soft delete |

**Table**: `movimientos_caja`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `movimiento_id` | UUID | PK | |
| `caja_id` | UUID | FK cajas, NOT NULL | |
| `tenant_id` | UUID | FK tenants, NOT NULL | Desnormalizado para queries por tenant |
| `tipo` | TEXT | NOT NULL | `'entrada'` \| `'salida'` \| `'apertura'` \| `'cierre'` |
| `concepto` | TEXT | NOT NULL | Descripción del movimiento |
| `monto` | NUMERIC(18,6) | NOT NULL | Siempre positivo; tipo define el signo |
| `metodo_pago_id` | UUID | FK metodos_pago, nullable | `NULL` en movimientos manuales; poblado en los que vienen de un pago de venta — es la clave que agrupa el arqueo por método (ver Arqueo de caja multi-medio) |
| `referencia` | TEXT | nullable | Referencia externa (nro. doc, etc.) |
| `creado_el` | TIMESTAMPTZ | NOT NULL | |
| `eliminado_el` | TIMESTAMPTZ | nullable | Soft delete |

**Table**: `caja_arqueo_medio` — detalle del cierre por método, CONGELADO (nunca se
recalcula después de escrita)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `arqueo_medio_id` | UUID | PK | |
| `caja_id` | UUID | FK cajas, NOT NULL | |
| `tenant_id` | UUID | FK tenants, NOT NULL | Del token — nunca del body |
| `metodo_pago_id` | UUID | FK metodos_pago, nullable | `NULL` = línea de efectivo agregada |
| `es_efectivo` | BOOLEAN | NOT NULL | Copiado de `metodos_pago.es_efectivo` al momento del cierre |
| `esperado` | NUMERIC(18,4) | NOT NULL | Recomputado server-side en la transacción de la fase 1 (`POST /caja/:id/conteo`); nunca viene del cliente |
| `contado` | NUMERIC(18,4) | nullable | `NULL` = línea informativa no contada |
| `diferencia` | NUMERIC(18,4) | nullable | `contado − esperado`; `NULL` si `contado` es `NULL` |
| `motivo_diferencia_id` | UUID | FK motivo_diferencia_caja, nullable | Escrito por la fase 2 del cierre o el override admin; `NULL` mientras no se justifique |
| `comentario_diferencia` | TEXT | nullable | Comentario libre de la justificación; obligatorio si el motivo lo exige o si el tenant no tiene motivos activos (red de seguridad) |
| `creado_el` | TIMESTAMPTZ | NOT NULL | |
| `eliminado_el` | TIMESTAMPTZ | nullable | Soft delete |

Índice único parcial `ux_caja_arqueo_medio` sobre `(caja_id, metodo_pago_id)` filtrando
`eliminado_el IS NULL` — una fila viva por línea de arqueo y caja.

**Table**: `motivo_diferencia_caja` — catálogo de motivos de diferencia por tenant
(sub-proyecto C, mismo patrón que `causas_merma`)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `motivo_diferencia_id` | UUID | PK | |
| `tenant_id` | UUID | FK tenants, NOT NULL | Del token — nunca del body |
| `nombre` | TEXT | NOT NULL | Único por tenant (case-insensitive), ver índice abajo |
| `activo` | BOOLEAN | NOT NULL, default `true` | Desactivar sin borrar; togglable incluso en un motivo `es_fijo` |
| `requiere_comentario` | BOOLEAN | NOT NULL, default `false` | Fuerza el comentario libre además del motivo al justificar una línea |
| `es_fijo` | BOOLEAN | NOT NULL, default `false` | Sembrado por tenant; no renombrable ni eliminable, sí togglable en `activo`/`requiere_comentario` |
| `creado_el` | TIMESTAMPTZ | NOT NULL | |
| `actualizado_el` | TIMESTAMPTZ | nullable | |
| `eliminado_el` | TIMESTAMPTZ | nullable | Soft delete |

Índice único parcial `uq_motivo_diferencia_caja_tenant_nombre` sobre
`(tenant_id, lower(nombre))` filtrando `eliminado_el IS NULL`.

### DTOs

- `AbrirCajaDto` — `{ cajonId: string, saldoInicial: string, comentario?: string }` (`@IsUUID`, `@IsNumberString`, `@IsOptional`)
- `MovimientoCajaDto` — `{ tipo, concepto, monto: string, referencia? }`
- `CerrarCajaDto` — `{ lineas: LineaCierreDto[], comentario?: string }` — body de la fase 1 (`POST /caja/:id/conteo`), pese al nombre heredado del sub-proyecto A
- `LineaCierreDto` — `{ metodoPagoId: string | null, montoContado: string }` (`metodoPagoId: null` = línea de efectivo; `@IsNumberString` sin `no_symbols` para admitir decimales)
- `FinalizarCierreDto` — `{ lineas: LineaJustificacionDto[] }` — body de la fase 2 (`POST /caja/:id/cerrar`)
- `JustificarDiferenciasDto` — `{ lineas: LineaJustificacionDto[] }` — body del override admin (`PATCH /caja/:id/arqueo/motivos`); mismo shape que `FinalizarCierreDto`, DTO propio porque son endpoints distintos
- `LineaJustificacionDto` — `{ metodoPagoId: string | null, motivoDiferenciaId?: string, comentarioDiferencia?: string }` (`@IsUUID('4')` opcional en ambos campos; `metodoPagoId` acepta `null` vía `@ValidateIf`)
- `SetArqueoCiegoDto` — `{ arqueoCiego: boolean }` (`@IsBoolean`) — body de `PUT /caja/arqueo-ciego`
- `CreateMotivoDiferenciaDto` / `UpdateMotivoDiferenciaDto` — `{ nombre?, activo?, requiereComentario? }`, mismo patrón que `causas_merma`

### Key Methods

- `cajaService.findActiva(tenantId, usuarioId)` — caja física `estado IN ('abierta', 'en_conciliacion')` del usuario; una conciliación pendiente sigue "ocupando" al cajero
- `cajaService.abrir(tenantId, usuarioId, dto)` — valida usuario libre → cajón válido/activo → autorizado (allow-list) → cajón libre (lock sobre `estado IN ('abierta', 'en_conciliacion')`) → crea caja sobre `dto.cajonId`; 409/404/403 según la validación que falle
- `cajaService.cajonesDisponibles(tenantId, usuarioId)` — cajones activos, sin sesión `abierta` ni `en_conciliacion`, y autorizados para el usuario (allow-list vacía o incluido) — arma el picker de apertura
- `cajaService.registrarMovimiento(tenantId, usuarioId, cajaId, dto)` — `FOR UPDATE` de la caja `abierta` (excluye `en_conciliacion`), valida propiedad (owner-only), valida saldo de la **línea de efectivo** (`calcularEsperadoEfectivo`) para `salida`, inserta movimiento
- `cajaService.bloquearCajaAbierta(manager, cajaId, tenantId)` — lock pesimista de una caja `abierta`, reutilizable (p.ej. egreso de NC en la misma tx). **Todo camino que escriba en `movimientos_caja` debe tomarlo primero**: `registrarMovimientoEnTransaccion` no revalida el estado, así que sin el lock un cierre concurrente puede commitear entre el chequeo y el `INSERT`, y el movimiento cae en una caja ya `cerrada` con el arqueo congelado. Lo toman hoy: creación de venta (`ventas.service`), abono (`pagos.service`), egreso de nota de crédito y `registrarMovimiento`. **La caja virtual no se bloquea**: nunca se cierra (una por tenant, siempre abierta) y el lock serializaría todas las ventas online del tenant sin proteger de nada.
- `cajaService.listarMovimientos(tenantId, usuarioId, cajaId, query, verTodas)` — lista `movimientos_caja`; acepta caja ajena si `verTodas=true`
- `cajaService.calcularEsperadoEfectivo(cajaId, manager)` — fondo + entradas de métodos `es_efectivo`/manuales − salidas; usada por el conteo, la salida manual (422) y la NC "devolver dinero"
- `cajaService.calcularArqueo(cajaId, tenantId, manager)` — línea de efectivo + una línea por método no-efectivo con movimientos (dos queries, sin N+1)
- `cajaService.obtenerArqueo(tenantId, usuarioId, cajaId, verTodas)` — `{ ciego, lineas }`; preview (`calcularArqueo` en vivo) si `abierta` — retenido (`esperado:null`, solo obligatorias) si el tenant tiene `arqueo_ciego`; filas completas de `caja_arqueo_medio` (con motivo/comentario si ya se justificó, `ciego:false` siempre) si `en_conciliacion` o `cerrada`
- `cajaService.getArqueoCiego(tenantId)` / `setArqueoCiego(tenantId, valor)` — lee/escribe `tenants.arqueo_ciego`; query raw parametrizada, filtra `eliminado_el IS NULL`
- `cajaService.enviarConteo(tenantId, usuarioId, cajaId, dto, esAdmin)` — **fase 1**, owner-o-admin; recomputa y congela el arqueo (`calcularArqueo` + `caja_arqueo_medio`), valida obligatorias (`400`), copia la línea de efectivo a `cajas.saldoFinal`/`montoContado`/`diferencia`, congela `cajas.cerradaPor` (siempre, no solo forzado) y `cajas.testigosDisponibles` (sesiones de garzón abiertas del tenant, vía `SesionesGarzonService.contarAbiertas` corrido con el mismo `manager` de la transacción), bifurca a `estado='cerrada'` (todo cuadró y `usuarioId` es el dueño) o `estado='en_conciliacion'` (algún descuadre, o forzado aunque cuadre) — sin cambios por el modo ciego, ver Cierre ciego
- `cajaService.cerrar(tenantId, usuarioId, cajaId, esAdmin, dto)` — **fase 2**, owner-o-admin; lock de la caja `en_conciliacion`, aplica motivos vía `aplicarMotivosADescuadres` (`400` si falta alguno) y marca `estado='cerrada'` — no recalcula nada
- `cajaService.justificarDiferencias(tenantId, cajaId, lineas)` — **override admin**, invocado desde el controller bajo `TenantAdminGuard`; misma validación que `cerrar` vía `aplicarMotivosADescuadres`, pero exige `estado='cerrada'` en vez de `en_conciliacion`
- `cajaService.historial(tenantId, usuarioId, query, todas)` — historial; `todas=true` retorna todas las cajas del tenant
- `cajaService.findOne(tenantId, usuarioId, cajaId, verTodas)` — detalle de la caja
- `motivosDiferenciaService.hayMotivosActivos(runner, tenantId)` / `assertMotivoValido(runner, tenantId, motivoId)` — consultados por `aplicarMotivosADescuadres` para decidir si exigir motivo o solo comentario (red de seguridad)

### Guards

El módulo `Caja` (backend) fue el primer módulo de **feature** (no configuración) en
usar `@RequiresPermiso` + `PermisosGuard` en lugar de `TenantAdminGuard`; sigue siéndolo
tras el refactor de 2026-07-23, solo que ahora referencia dos módulos de permiso
distintos (`MiCaja` / `Cajas`) sobre el mismo controller. Todos los endpoints están bajo
`JwtAuthGuard + TenantGuard + PermisosGuard` en la clase; los endpoints **operativos**
(propios del cajero) usan `@RequiresPermiso` directo, y el endpoint exclusivo de
supervisión (`/caja/cajones-estado`) usa `@RequiresPermiso('Cajas', 'Leer')`:

```typescript
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('caja')
export class CajaController {
  @RequiresPermiso('MiCaja', 'Leer')
  @Get('activa')
  activa(@Req() req) { ... }

  @RequiresPermiso('MiCaja', 'Crear')
  @Post('abrir')
  abrir(@Req() req, @Body() dto: AbrirCajaDto) { ... }

  @RequiresPermiso('Cajas', 'Leer')
  @Get('abiertas')
  abiertas(@Req() req) { ... }
}
```

Los endpoints de **lectura compartida** (`GET /caja`, `/:id`, `/:id/movimientos`,
`/:id/movimientos/resumen`) no usan `@RequiresPermiso` — llaman al helper privado
`resolverLecturaCompartida(u)`, que exige `MiCaja:Leer` **o** `Cajas:Leer` (403 si no
tiene ninguno) y devuelve `verTodas = tieneCajas` para que el service resuelva el
alcance (propia vs. todas). Este patrón — permiso compuesto resuelto a mano en vez de
un solo `@RequiresPermiso` — es específico de este controller por tener dos módulos
sirviendo las mismas rutas de lectura; no es el patrón por defecto del proyecto.

Ver nota en `docs/patterns/backend.md §4` sobre cuándo usar `@RequiresPermiso` vs. `TenantAdminGuard`.

**El override admin es la única excepción de método.** `PATCH /caja/:id/arqueo/motivos`
agrega `@UseGuards(TenantAdminGuard)` a nivel de método (sub-proyecto C) — el único
endpoint del controller que exige admin puro en vez de `@RequiresPermiso`. `POST
/caja/:id/cerrar` (fase 2, owner-o-admin) en cambio **no** usa `TenantAdminGuard`: sigue
con `@RequiresPermiso('MiCaja', 'Actualizar')` y el controller resuelve `esAdmin` aparte
(`rbacService.userIsTenantAdmin`) para no bloquear al cajero dueño — ver [Cierre en dos
fases](#cierre-en-dos-fases--motivos-de-diferencia-sub-proyecto-c).

---

## Frontend

### Pages

Dos superficies, cada una gateada por su módulo (sidebar en `layouts/dashboard.vue`):

- `pages/mi-caja/index.vue` — Cajero opera su propio turno: sin caja abierta → grid de
  cajones disponibles (`CajaAperturaGrid`; click en un cajón → drawer con saldo inicial +
  comentario → abre la caja sobre ese cajón) + botón "Ver historial" →
  `/mi-caja/historial`; con caja abierta → redirect a `/mi-caja/[id]`. Gate: `MiCaja:Leer`.
- `pages/mi-caja/historial.vue` — Historial paginado **del propio cajero**
  (`CajaHistorial` con alcance por defecto = propias; sin `todas`).
- `pages/mi-caja/[id].vue` — Detalle operable de su turno activo: KPIs + tabla de
  movimientos (`CajaActivaDashboard`). En el header de la tarjeta de caja: "Ver historial"
  + botones de operar (+Movimiento / Cerrar). En vista read-only (caja ajena/cerrada) queda
  solo "Ver historial" + back-link "Volver a caja".
- `pages/cajas/index.vue` — Grid de **todos los cajones activos** del tenant y su estado
  (`CajaCajonesGrid`), read-only. **Sin apertura** (la caja se abre en `/mi-caja`). El botón
  "Ver historial" abre `/cajas/historial`. Gate: `Cajas:Leer`.
- `pages/cajas/historial.vue` — Historial de **todos los cajeros** del tenant
  (`CajaHistorial` con `todas`; alcance fijo, sin toggle). Soporta `?usuarioId=` (por
  cajero) y `?cajonId=` (por cajón). El alcance "solo propias" vive en `/mi-caja/historial`.
- `pages/cajas/[id].vue` — Detalle **read-only** de cualquier caja (sin botones de
  operar, aunque sea la propia): KPIs + movimientos (`CajaActivaDashboard` en modo
  read-only). Botón "Ver historial del cajón" (`?cajonId=` de esa caja) en el header de
  la tarjeta + back-link "Volver a cajas". 403/404 → redirect a `/cajas`.
- `pages/caja/index.vue` — Compatibilidad: redirige a `/mi-caja` (bookmarks/enlaces
  internos previos al refactor).
- `pages/configuracion/motivos-diferencia.vue` — CRUD admin-only del catálogo de motivos
  de diferencia (sub-proyecto C), mismo patrón que `configuracion/causas-merma.vue`:
  tabla + drawer crear/editar + toggle inline de `activo`; un fijo (`esFijo`) deshabilita
  el campo nombre en el drawer pero permite togglear `activo`/`requiereComentario`.

### Components

`components/caja/` se mantiene **compartida** entre las dos superficies (`/mi-caja` y
`/cajas`) — son piezas de presentación reusadas por ambas, no específicas de un módulo
de permiso; separarlas en `components/mi-caja/` + `components/cajas/` habría duplicado
sin necesidad.

- `components/caja/CajaActivaDashboard.vue` — Orquestador del turno: compone header, resumen KPIs y tabla de movimientos; modales de movimiento y cierre. Prop `readonly` para la superficie `/cajas` (oculta botones de operar)
- `components/caja/CajaTurnoHeader.vue` — Título, badge de estado, fecha de apertura, botones +Movimiento / Cerrar caja
- `components/caja/CajaTurnoResumen.vue` — Grid de 4 KPIs (saldo inicial, entradas, salidas, saldo esperado)
- `components/caja/CajaMovimientosTable.vue` — Tabla paginada de movimientos con filtro por tipo, scroll interno y thead sticky
- `components/caja/CajaHistorial.vue` — Listado paginado de sesiones (`GET /caja`); props `todas` (alcance todo el tenant), `usuarioId` y `cajonId` (o sus `?query=`). El alcance es fijo por página: `/mi-caja/historial` sin `todas` (propias), `/cajas/historial` con `todas`. Sin toggle.
- `components/caja/CajaAperturaGrid.vue` — Apertura en `/mi-caja`: grid de cards de cajones disponibles (poblado por `cajonesDisponibles`); click en un cajón abre un `AppDrawer` con saldo inicial + comentario → `cajaStore.abrir`. Cajón implícito por la card (nombre en el título del drawer)
- `components/caja/CajaAperturaForm.vue` — Formulario de apertura con selector de cajón (poblado por `cajonesDisponibles`, obligatorio) + saldo inicial + comentario; usado en el POS (`pages/ventas/pos.vue`) para abrir caja sin salir de la venta
- `components/caja/CajaMovimientoDrawer.vue` — Drawer entrada/salida manual
- `components/caja/CajaCierreDrawer.vue` — Drawer del **cierre en dos fases** (sub-proyecto
  C), con estado local `fase: 'conteo' | 'conciliacion'`. Fase **conteo**: carga el arqueo
  (`GET /caja/:id/arqueo`) al abrirse, separa líneas obligatorias (efectivo +
  `requiereConteo`) de informativas, un `MoneyInput` de contado por línea con su diferencia
  en vivo, y bloquea "Enviar conteo" hasta completar las obligatorias; llama
  `cajaStore.enviarConteo`. Si la respuesta es `estado: 'en_conciliacion'`, el drawer NO se
  cierra: carga el catálogo de motivos (`cargarMotivos(true)`) y pasa a fase
  **conciliacion**, donde cada línea descuadrada pide un `USelect` de motivo + comentario
  (obligatorio si el motivo lo exige o si no hay motivos activos) y llama
  `cajaStore.cerrar`. **Retomar**: si se reabre el drawer con la caja ya
  `en_conciliacion` (prop `resumir` o detección automática vía
  `cajaStore.activa?.estado`), arranca directo en fase conciliacion sin repetir el conteo.
  En modo ciego (`cajaStore.arqueoCiego`) oculta esperado/diferencia en vivo durante el
  conteo y, al confirmar (cualquiera de las dos fases), redirige al detalle en vez de solo
  cerrar el drawer — ver [Cierre ciego](#cierre-ciego-modo-anti-fraude) y [Cierre en dos
  fases](#cierre-en-dos-fases--motivos-de-diferencia-sub-proyecto-c)
- `components/caja/CajaArqueoTable.vue` — Tabla (método / esperado / contado / diferencia /
  motivo) para el desglose congelado; usada en el detalle de una caja `cerrada`
  (`/mi-caja/[id]`, `/cajas/[id]`), solo si `arqueo.length > 0` — una caja
  `en_conciliacion` no llega a esta tabla, la resuelve `CajaCierreDrawer` en fase
  conciliacion. Prop `puedeJustificar` (poblada con `perms.esAdmin`) habilita edición
  inline de motivo/comentario por línea descuadrada — el **override admin**
  (sub-proyecto C, `PATCH /caja/:id/arqueo/motivos`), pre-cargado con lo ya justificado
  para poder corregir
- `components/caja/CajaCajonesGrid.vue` — Grid de cards para la superficie `/cajas` (permiso `Cajas:Leer`): **todos los cajones activos** del tenant con su estado (ocupado/libre), ocupados primero (la propia arriba). Card ocupada → `/cajas/[id]`; card libre (badge "Libre") → `/cajas/historial?cajonId=…`. No permite abrir caja (eso vive en `/mi-caja`)

### Pinia Store

**File**: `stores/caja.ts`

Un único store sirve a ambas superficies — no se partió por módulo de permiso.

**State**:
- `activa: Caja | null` — caja `abierta` o `en_conciliacion` del usuario actual
- `resumenTurno: CajaTurnoResumen | null` — KPIs del turno (`GET /:id/movimientos/resumen`), con patch local optimista en cada movimiento/cobro
- `cajonesEstado: CajonEstado[]` — todos los cajones activos del tenant con su estado ocupado/libre (superficie `/cajas`, permiso `Cajas:Leer`)
- `detalle: Caja | null` — detalle de una caja (propia o ajena, página read-only)
- `cajonesDisponibles: CajonDisponible[]` — opciones del picker de apertura (activos + libres + autorizados)
- `arqueo: ArqueoLinea[]` — líneas del arqueo (preview en vivo o congeladas), poblado por `cargarArqueo()`; se consume desde `CajaCierreDrawer` y `CajaArqueoTable`. `ArqueoLinea.esperado` es `string | null` (nullable desde el modo ciego); incluye `motivoDiferenciaId`/`motivoNombre`/`comentarioDiferencia` (sub-proyecto C)
- `arqueoCiego: boolean` — `ciego` del último `cargarArqueo()`; consumida por `CajaCierreDrawer` para la rama ciega y por la config de Cajas para el toggle
- `motivos: MotivoDiferencia[]` — catálogo de motivos de diferencia (sub-proyecto C), poblado por `cargarMotivos()`; consumido por `CajaCierreDrawer` (fase 2) y `CajaArqueoTable` (override admin)
- `loadingActiva` / `loadingResumenTurno: boolean`

**Actions**:
- `cargarActiva()` — GET /caja/activa
- `cargarCajonesDisponibles()` — GET /caja/cajones-disponibles → puebla `cajonesDisponibles`
- `abrir(dto)` — POST /caja/abrir (`dto` incluye `cajonId`)
- `cargarArqueoCiego()` — GET /caja/arqueo-ciego → boolean (config del tenant)
- `guardarArqueoCiego(valor)` — PUT /caja/arqueo-ciego
- `registrarMovimiento(cajaId, dto)` — POST /caja/:id/movimientos; aplica el patch local a `resumenTurno`
- `cargarArqueo(cajaId)` — GET /caja/:id/arqueo → puebla `arqueo` y `arqueoCiego` (del `{ ciego, lineas }` de la respuesta)
- `cargarMotivos(soloActivas?)` — GET /motivos-diferencia → puebla `motivos` (sub-proyecto C)
- `enviarConteo(cajaId, { lineas, comentario? })` — **fase 1**: POST /caja/:id/conteo; devuelve `{ estado, arqueo }`; si `estado==='cerrada'` limpia `resumenTurno`/`activa`, si `'en_conciliacion'` avanza el `estado` local de `activa`/`detalle` para que el drawer detecte "retomar conciliación" sin recargar (sub-proyecto C)
- `cerrar(cajaId, { lineas })` — **fase 2**: POST /caja/:id/cerrar; devuelve `{ caja, arqueo }`; limpia `resumenTurno`/`activa` (sub-proyecto C)
- `justificarDiferencias(cajaId, lineas)` — **override admin**: PATCH /caja/:id/arqueo/motivos; devuelve `{ ciego, lineas }` (sub-proyecto C)
- `cargarCajonesEstado()` — GET /caja/cajones-estado → puebla `cajonesEstado`
- `cargarDetalle(id)` — GET /caja/:id → puebla `detalle`

---

## Data Flow

### Abrir caja

```
[Usuario llega al turno → /mi-caja muestra "Sin caja activa"]
  ↓ clic "Abrir caja"
[AbrirCajaForm: saldo inicial + comentario]
  ↓ useCajaStore.abrirCaja(dto)
[POST /caja/abrir]
  ↓
[CajaService valida: no hay caja abierta para tenant+usuario]
  ↓ (lanza 409 si ya existe)
[Crea fila en `cajas` + movimiento inicial `tipo='apertura'`]
  ↓
[saldo_esperado = saldo_inicial]
  ↓
[Store: cajaActiva = nueva caja]
  ↓
[/mi-caja muestra panel "Caja abierta"]
```

### Registrar movimiento manual

```
[Clic "Entrada" o "Salida" en panel caja abierta]
  ↓ usuario ingresa tipo, concepto, monto
  ↓ useCajaStore.registrarMovimiento(cajaId, dto)
[POST /caja/:id/movimientos]
  ↓
[Service valida: salida → monto ≤ saldo_esperado (lanza 422 si excede)]
  ↓
[Inserta en `movimientos_caja`]
[Actualiza `cajas.saldo_esperado += entrada | -= salida` (Decimal.js)]
  ↓
[Store: movimientos.push(nuevo); cajaActiva.saldoEsperado actualizado]
```

### Cerrar caja en dos fases (sub-proyecto C)

```
[Clic "Cerrar caja"]
  ↓ CajaCierreDrawer se abre (fase='conteo') → cajaStore.cargarArqueo(cajaId)
[GET /caja/:id/arqueo] → preview en vivo (línea efectivo + una por método no-efectivo)
  ↓
[Usuario ingresa el contado de cada línea obligatoria (efectivo + requiereConteo);
 las informativas quedan opcionales]
  ↓ cajaStore.enviarConteo(cajaId, { lineas, comentario })
[POST /caja/:id/conteo — FASE 1]
  ↓
[Service, en una transacción: lock de la caja 'abierta' → recomputa `calcularArqueo`
 (server-side, ignora cualquier "esperado" que mandara el cliente) → valida que
 toda línea obligatoria tenga contado (400 si falta) → CONGELA cada línea en
 `caja_arqueo_medio` (inmutable desde acá) → copia la línea de efectivo a
 cajas.saldoFinal/montoContado/diferencia]
  ↓
  ├─ [Ninguna línea descuadra] → estado='cerrada' + fechaCierre
  │    ↓ Response { estado: 'cerrada', arqueo }
  │    ↓ Store: activa = null; resumenTurno = null → /mi-caja "Sin caja activa"
  │
  └─ [Alguna línea descuadra] → estado='en_conciliacion' (sin fechaCierre)
       ↓ Response { estado: 'en_conciliacion', arqueo }
       ↓ Drawer pasa a fase='conciliacion' (sin cerrarse) → cajaStore.cargarMotivos(true)
       ↓ Usuario elige motivo (o comentario, si no hay motivos activos) por línea descuadrada
       ↓ cajaStore.cerrar(cajaId, { lineas: [{ metodoPagoId, motivoDiferenciaId?, comentarioDiferencia? }] })
       [POST /caja/:id/cerrar — FASE 2, owner-o-admin]
         ↓
       [Service: lock de la caja 'en_conciliacion' → aplica motivos sobre las líneas
        YA CONGELADAS (no recalcula nada) → 400 si falta un motivo/comentario → estado='cerrada' + fechaCierre]
         ↓
       [Response: { caja, arqueo }]
         ↓
       [Store: activa = null; resumenTurno = null → /mi-caja "Sin caja activa"]
```

Si el drawer se cierra con la caja `en_conciliacion` sin completar la fase 2, la conciliación queda pendiente: la próxima vez que se abre el drawer (o el dashboard detecta `activa.estado === 'en_conciliacion'`) arranca directo en `fase='conciliacion'`, sin repetir el conteo — ver [Fase 1](#fase-1--post-cajaidconteo-congela-y-revela) y [`en_conciliacion` ocupa igual que `abierta`](#en_conciliacion-ocupa-igual-que-abierta).

---

## Business Rules

### Una sola caja física por tenant+usuario, y una sola sesión por cajón

Solo puede haber una caja `tipo='fisica'` con `estado IN ('abierta', 'en_conciliacion')`
por combinación `(tenant_id, usuario_id)` — desde el sub-proyecto C una conciliación
pendiente también "ocupa" al cajero, no solo una caja `abierta`. Intentar abrir una
segunda retorna `409 Conflict`. Desde el sub-proyecto 3, esto convive con una segunda
regla independiente: un **cajón** físico también admite una sola sesión activa
(`abierta` o `en_conciliacion`) a la vez — el índice único parcial `ux_cajas_cajon_abierta`
(BD) solo cubre `estado='abierta'`, la ocupación de `en_conciliacion` la hace valer el
service — dos usuarios distintos no pueden abrir el mismo cajón en paralelo. Ver
[Apertura sobre un cajón](#apertura-sobre-un-cajón-sub-proyecto-33) y [`en_conciliacion`
ocupa igual que `abierta`](#en_conciliacion-ocupa-igual-que-abierta).

### Fórmula del esperado — por línea, no un total mezclado

Desde el sub-proyecto de arqueo multi-medio (ver
[sección dedicada](#arqueo-de-caja-multi-medio-sub-proyecto-de-negocio-a-post-estructura)),
el esperado no es un solo número: la **línea de efectivo** es la única con fórmula
acumulativa sobre todo el turno —

```
esperado_efectivo = saldo_inicial
                  + Σ movimientos 'entrada' de métodos es_efectivo o manuales
                  − Σ movimientos 'salida' (todos)
```

— y cada **línea no-efectivo** es simplemente la suma de sus entradas del turno
(`Σ movimientos 'entrada' de ese método`), sin restar salidas (no hay salidas de
tarjeta/transferencia por diseño). Todo cálculo usa Decimal.js; nunca aritmética nativa
de JavaScript.

### Bloqueo de salida por saldo insuficiente (contra la línea de efectivo)

Si `tipo='salida'` y `monto > esperado_efectivo` (no el total de todas las entradas), el
endpoint retorna `422 Unprocessable Entity`. No se permite que la línea de efectivo quede
negativa. Antes del sub-proyecto de arqueo multi-medio esto se validaba contra el total
mezclado (efectivo + tarjeta) — ver el fix documentado en esa sección.

### Caja virtual

La caja `tipo='virtual'` se crea automáticamente al crear un tenant (en la misma
transacción que el rol admin y la fórmula de precios). Permanece siempre `abierta`
y se usa para ventas `canal='online'`. Está **excluida** de todos los flujos
manuales: no aparece en `GET /caja/activa`, no puede abrirse ni cerrarse
manualmente, y no acepta movimientos manuales. No tiene cajón: `cajon_id` queda
`NULL` — no pasa por `POST /caja/abrir` ni por sus validaciones de cajón.

### Módulo `Cajas` (supervisión, solo lectura)

El módulo `Cajas` con permiso `Leer` permite a supervisores o administradores:

- Consultar todas las cajas del tenant (historial completo vía `GET /caja?todas=true`).
- Ver el grid de todos los cajones activos y su estado ocupado/libre (`GET /caja/cajones-estado`).
- Acceder en read-only al detalle de cualquier caja (`GET /caja/:id` y `GET /caja/:id/movimientos`).

Hasta 2026-07-23 este diferenciador era la acción global `Ver todas` dentro del módulo
`Caja`; se reemplazó por un módulo dedicado (`Cajas`) para que el supervisor sea una
responsabilidad de acceso propia, no una acción CRUD reutilizada. `Ver todas` sigue
existiendo como acción global para otros módulos — solo se dejó de asociar a caja.

**Owner-only (independientemente de `Cajas:Leer`), con una excepción:**
`POST /caja/:id/movimientos` solo lo puede ejecutar el dueño de la caja (permiso
`MiCaja`) — ahí `Cajas:Leer` no habilita nada, ni siquiera para un admin.
`POST /caja/:id/conteo` (fase 1) y `POST /caja/:id/cerrar` (fase 2) son **owner-o-admin**:
el dueño siempre puede, y un admin del tenant (`RbacService.userIsTenantAdmin`, no
`Cajas:Leer`) puede además forzar el cierre completo de la caja de otro cajero **desde
cero**, no solo finalizar una conciliación que el dueño ya congeló — ver [Modelo de
acceso](#modelo-de-acceso-por-permiso) y [Cierre en dos
fases](#cierre-en-dos-fases--motivos-de-diferencia-sub-proyecto-c).

---

## Testing

### Unit Tests (Backend)

```bash
cd backend
npm test -- modules/caja/caja.service.spec.ts
npm test -- modules/caja/caja.controller.spec.ts
npm test -- modules/motivos-diferencia/motivos-diferencia.service.spec.ts
```

### E2E Tests

```bash
cd backend
npm run test:e2e -- caja.e2e-spec.ts
npm run test:e2e -- motivos-diferencia.e2e-spec.ts
```

### Manual Testing (Swagger)

1. Abrir http://localhost:3000/api/docs
2. Autenticar con Bearer token (con permiso `MiCaja/Leer` y `MiCaja/Crear`)
3. `GET /caja/activa` → debe retornar `null` si no hay caja
4. `GET /caja/cajones-disponibles` → lista de cajones activos y libres para el usuario
5. `POST /caja/abrir` con `{ "cajonId": "<uuid del picker>", "saldoInicial": "500" }` → 201
6. `POST /caja/abrir` de nuevo con el mismo `cajonId` (otro usuario) → 409 (cajón ocupado)
7. `POST /caja/:id/movimientos` con `{ "tipo": "entrada", "concepto": "Prueba", "monto": "100" }` → 201
8. `POST /caja/:id/movimientos` con `{ "tipo": "salida", "monto": "700" }` → 422 (saldo insuficiente de la línea de efectivo)
9. `GET /caja/:id/arqueo` con la caja abierta → arreglo con la línea de efectivo + una por cada método no-efectivo usado
10. `POST /caja/:id/conteo` con `{ "lineas": [{ "metodoPagoId": null, "montoContado": "598" }] }` que cuadra exacto → `{ "estado": "cerrada", arqueo }`; si falta el conteo de una línea obligatoria → 400
11. Repetir la apertura + un conteo que **no** cuadre → `{ "estado": "en_conciliacion", arqueo }`; la caja queda ocupando el cajón (no aparece en `cajones-disponibles`) y bloquea `POST /:id/movimientos` (403, ya no está `'abierta'`)
12. `POST /caja/:id/cerrar` sobre la caja `en_conciliacion` sin `lineas` (o sin motivo) → 400; con `{ "lineas": [{ "metodoPagoId": null, "motivoDiferenciaId": "<uuid de GET /motivos-diferencia>" }] }` → 200 con `{ caja, arqueo }`, `estado: 'cerrada'`
13. `PATCH /caja/:id/arqueo/motivos` (con un token admin) sobre la caja recién cerrada, cambiando el motivo → 200; con un token no-admin → 403 (`TenantAdminGuard`)
14. `GET /caja/:id/arqueo` con la misma caja ya cerrada → las mismas líneas, ahora con `contado`/`diferencia`/`motivoDiferenciaId` congelados
15. `GET /caja` → historial con la caja cerrada; `saldoFinal`/`montoContado`/`diferencia` = línea de efectivo
16. Con un token que solo tenga `Cajas/Leer` (sin `MiCaja`): `GET /caja/cajones-estado` → 200 (todos los cajones); `POST /caja/abrir` → 403

### Manual Testing (Frontend)

1. `docker-compose up`
2. Login + selección de tenant
3. Navegar a `/mi-caja`
4. Abrir caja: en el grid de cajones disponibles, click en un cajón → drawer con saldo
   inicial + comentario → verificar panel de caja activa en `/mi-caja/[id]`
5. Con una segunda sesión/usuario: el cajón recién abierto ya no aparece en el
   grid de cajones disponibles (ocupado)
6. Agregar movimientos entrada/salida → verificar saldo esperado actualizado
7. Intentar salida mayor al saldo de efectivo → verificar error
8. Cerrar caja con un conteo que cuadra exacto: verificar que el drawer muestra la línea
   de efectivo (obligatoria) y, si hubo ventas con tarjeta u otro método, una línea
   adicional por ese método; completar el conteo de las obligatorias → verificar
   diferencia en vivo por línea → "Enviar conteo" cierra directo (auto-cierre, sin fase 2)
9. Cerrar caja con un conteo que **no** cuadra: "Enviar conteo" no cierra el drawer — pasa
   a "Conciliar diferencias"; elegir un motivo (o escribir un comentario, si el tenant no
   tiene motivos activos) por cada línea descuadrada → "Confirmar cierre"
10. Cerrar el drawer en medio de una conciliación pendiente (sin confirmar) y volver a
    entrar a `/mi-caja/[id]` → clic en "Cerrar caja" retoma directo en "Conciliar
    diferencias" (no repite el conteo)
11. Reabrir el detalle de la caja recién cerrada → verificar la tabla de desglose por
    método (`CajaArqueoTable`) con `esperado`/`contado`/`diferencia`/motivo congelados
12. Con un usuario admin: en el detalle de una caja cerrada con descuadre, editar el
    motivo/comentario de una línea (override) → "Guardar" → verificar que persiste al
    recargar. Con un usuario no-admin: la tabla no muestra los controles de edición
13. Configuración → Motivos de diferencia: crear/editar/desactivar un motivo; un motivo
    fijo no permite editar el nombre pero sí `activo`/`requiereComentario`; eliminar un
    motivo no fijo
14. `/mi-caja` (cajero sin caja): grid de cajones disponibles + botón "Ver historial" → `/mi-caja/historial`
15. Admin: sidebar muestra "Mi caja" y "Cajas" como entradas independientes
16. `/cajas`: grid de todos los cajones activos (ocupados con datos, libres con badge
    "Libre"); sin card de apertura. Click en ocupado → `/cajas/[id]`; click en libre →
    `/cajas/historial?cajonId=…`. Botón "Ver historial" → `/cajas/historial` (siempre todas,
    sin toggle); click en fila → `/cajas/[id]`
17. `/cajas/[id]`: una sola tabla de movimientos, modo read-only (sin botones de operar); botón "Ver historial del cajón" con `?cajonId=` (todas las sesiones de ese cajón)
18. KPIs visibles al hacer scroll en movimientos (thead sticky)
19. `/caja` redirige a `/mi-caja` (compatibilidad)

---

## Acceptance Criteria

- [x] Endpoint `GET /caja/activa` retorna la caja abierta o `null`
- [x] `POST /caja/abrir` valida unicidad (solo una caja por usuario+tenant)
- [x] Movimientos `salida` validan saldo suficiente de la **línea de efectivo** (422 si excede)
- [x] Cierre calcula `diferencia = contado − esperado` por línea con Decimal.js
- [x] Caja virtual excluida de todos los flujos manuales
- [x] `metodos_pago.es_efectivo` (global) y `tenant_metodo_pago.requiere_conteo` (por tenant) gobiernan `obligatorio = es_efectivo OR requiere_conteo`
- [x] `GET /caja/:id/arqueo` retorna preview recomputado (caja abierta) o líneas congeladas (caja `en_conciliacion` o cerrada)
- [x] `POST /caja/:id/conteo` (fase 1) recibe `lineas[]`, recomputa y congela el esperado server-side (nunca del cliente), `400` si falta una línea obligatoria; bifurca a `'cerrada'` (todo cuadró) o `'en_conciliacion'` (algún descuadre)
- [x] `caja_arqueo_medio` congela una fila por línea con índice único parcial `(caja_id, metodo_pago_id)`
- [x] `cajas.saldoFinal`/`montoContado`/`diferencia` representan la línea de efectivo (backward-compat del historial)
- [x] La NC "devolver dinero" valida saldo contra la línea de efectivo, no el total mezclado
- [x] Cajas cerradas antes del sub-proyecto (sin filas en `caja_arqueo_medio`) muestran el cuadre agregado sin desglose por método
- [x] Módulo `MiCaja` (operar el propio turno) y módulo `Cajas` (supervisar, solo lectura) separados
- [x] `GET /caja/cajones-estado` requiere `Cajas:Leer` y retorna todos los cajones activos del tenant con su estado (ocupado/libre)
- [x] `GET /caja/:id/movimientos` permite lectura de caja ajena con `Cajas:Leer`; registrar
      movimientos sigue owner-only bajo `MiCaja` (el conteo, fase 1, pasó a owner-o-admin
      con el cierre forzado — ver [Modelo de acceso](#modelo-de-acceso-por-permiso))
- [x] `cajas.estado` admite `'en_conciliacion'`; `findActiva`/`abrir`/`cajonesDisponibles`/`cajonesEstado` la tratan como ocupada igual que `'abierta'`
- [x] `POST /caja/:id/cerrar` (fase 2) es owner-o-admin, aplica motivos a las líneas descuadradas sin recalcular nada, `400` si falta un motivo/comentario obligatorio
- [x] `PATCH /caja/:id/arqueo/motivos` (`TenantAdminGuard`) corrige motivos de una caja ya cerrada, mismo enforcement que la fase 2
- [x] Catálogo `motivo_diferencia_caja` (admin-only CRUD, `es_fijo` no renombrable/eliminable pero togglable en `activo`/`requiereComentario`); sin motivos activos, el comentario es obligatorio (red de seguridad)
- [x] El conteo (`esperado`/`contado`/`diferencia` en `caja_arqueo_medio`) es inmutable desde la fase 1 — ni la fase 2 ni el override lo recalculan
- [x] Frontend `/cajas` muestra grid de todos los cajones activos (sin apertura) para usuarios con `Cajas:Leer`
- [x] `CajaCajonesGrid` muestra cards por cajón: ocupado con badge "Mía"/datos → detalle; libre con badge "Libre" → historial del cajón
- [x] Página `/cajas/historial` con historial paginado y filtros `?usuarioId=` y `?cajonId=`
- [x] Página `/cajas/[id]` con KPIs + movimientos (sin historial embebido, siempre read-only); 403/404 redirige a `/cajas`
- [x] `/caja` redirige a `/mi-caja` (compatibilidad de enlaces previos)
- [x] Store `useCajaStore` con `cajonesEstado`, `detalle`, `cargarCajonesEstado()` y `cargarDetalle(id)` (compartido por ambas superficies)
- [x] Todos los guards usan `@RequiresPermiso` + `PermisosGuard` (no `TenantAdminGuard`)
- [x] Frontend páginas `/mi-caja` y `/cajas` con máquina de estados propia y store `useCajaStore` compartido
- [x] Soft delete en cajas y movimientos
- [x] `tenant_id` y `usuario_id` siempre del token (nunca del body)
- [x] `POST /caja/abrir` exige `cajonId` y valida cajón activo → autorizado (allow-list) → libre, bajo transacción
- [x] `GET /caja/cajones-disponibles` arma el picker (activos + libres + autorizados)
- [x] Un cajón admite una sola sesión abierta (`ux_cajas_cajon_abierta`); condición de carrera → `409`
- [x] `PATCH /cajones/:id` (desactivar) y `DELETE /cajones/:id` retornan `409` si el cajón tiene sesión abierta
- [x] Caja virtual sin cambios: `cajon_id` siempre `NULL`, no pasa por `POST /caja/abrir`
- [x] `tenants.arqueo_ciego` (default `false`) con `GET`/`PUT /caja/arqueo-ciego` (`Cajas:Leer`/`Actualizar`)
- [x] `GET /caja/:id/arqueo` responde `{ ciego, lineas }`; en modo ciego + caja abierta retiene `esperado:null` y filtra a solo líneas obligatorias, sin importar quién consulte
- [x] Caja `en_conciliacion` o cerrada siempre revela (`ciego:false`, líneas completas), sin importar la config del tenant
- [x] `POST /caja/:id/conteo` (fase 1) sigue recomputando y congelando el arqueo completo, ignorando el modo ciego — es donde ocurre la revelación
- [x] Toggle "Arqueo ciego" en Configuración → Cajas (`Cajas:Actualizar`)
- [x] `CajaCierreDrawer` en modo ciego oculta esperado/diferencia en vivo durante el conteo y redirige al detalle tras cerrar (cualquiera de las dos fases)
- [x] `CajaCierreDrawer` retoma en fase "conciliacion" si se reabre sobre una caja ya `en_conciliacion`, sin repetir el conteo

---

## Related Features

- [Gestión de ventas](./ventas.md) — Las ventas físicas asocian la caja activa del usuario
- [Registro de pagos](./pagos.md) — Los pagos se asocian a la caja donde se cobran
- [Roles y Permisos (RBAC)](./roles-permisos.md) — Los permisos `MiCaja/*` y `Cajas:Leer` controlan el acceso

---

## Notes

- La caja virtual se siembra automáticamente en `tenants.service.ts → create()` dentro
  de la transacción de creación del tenant, junto con el rol admin y la fórmula de precios.
- Este módulo es la referencia canónica para el patrón `@RequiresPermiso` en módulos de feature
  (a diferencia de los módulos de configuración que siguen usando `TenantAdminGuard`).
  Ver `docs/patterns/backend.md §4`.
