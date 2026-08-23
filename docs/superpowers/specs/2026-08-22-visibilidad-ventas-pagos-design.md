# Visibilidad por usuario en `ventas` y `pagos` — diseño

**Fecha:** 2026-08-22 · **Estado:** Ejecutado (2026-08-22) · **Plan:** [`plans/2026-08-22-visibilidad-ventas-pagos.md`](../plans/2026-08-22-visibilidad-ventas-pagos.md)

## De dónde sale

De la auditoría de fugas del modo ciego (2026-08-22,
[`pendientes.md`](../../agent/pendientes.md)). El hallazgo que reencuadró el frente **no es
del modo ciego**: `ventas` y `pagos` no tienen **ningún** eje de visibilidad por usuario.
`listar(tenantId, query)`, `findOne(tenantId, ventaId)` y `resumen(tenantId)` no reciben
`usuarioId` ni lo consultan. Un cajero con `Ventas:Leer` ve **todas** las ventas del tenant;
con `Pagos:Leer`, **todos** los pagos.

`caja` sí tiene el modelo de dos niveles —`MiCaja` (la mía) contra `Cajas` (todas)— resuelto
en `resolverLecturaCompartida` y con chequeos explícitos de `usuarioId`. El modo ciego solo
hizo visible la asimetría: con el ciego activo, el cajero pide
`GET /pagos?cajaId=<la suya>&metodoPagoId=<efectivo>` y **el esperado sale en un request**
(demostrado contra el stack real: dedujo 25.355, el real era 25.355).

**Decisión del owner (2026-08-22):** `ventas` y `pagos` reciben el eje "mío/todos".

## La restricción que manda en el diseño

**Ni `ventas` ni `pagos` guardan quién los hizo.** Medido:

| Entidad | Tiene | NO tiene |
|---|---|---|
| `venta` | `caja_id` (nullable), `canal`, `cancelada_por_usuario_id` | `usuario_id` / `creado_por` |
| `pago` | `caja_id` (nullable) | `usuario_id` |

Así que "lo mío" **no se puede leer de una columna: se deriva por la caja**
(`venta.caja_id → cajas.usuario_id`). Para una venta física eso es **exacto**, porque
`ux_cajas_activa_por_usuario` garantiza que una caja abierta pertenece a un solo usuario: la
caja *es* el registro de autoría.

### Por qué NO agregar una columna `creado_por`

Sería más directo, y el proyecto no tiene datos productivos, así que el cambio de esquema es
barato. Pero **duplicaría un dato que ya existe** y abriría la posibilidad de que los dos
diverjan (una venta cuyo `creado_por` no coincida con el dueño de su caja). La caja ya
responde la pregunta; agregar la columna es agregar una segunda fuente de verdad para el
mismo hecho.

⚠️ Si a futuro aparece una venta **sin caja** que igual tenga autor —hoy no existe—, la
columna vuelve a la mesa.

## El eje: reusar el de `caja`, no crear módulos nuevos

Tres caminos, y el elegido es el tercero:

1. **Módulos nuevos `MisVentas`/`MisPagos`**, espejo de `MiCaja`/`Cajas`. Es el patrón literal
   que ya existe, pero agrega dos módulos al catálogo y al contrato de **cada** tenant, para
   una distinción que ya se puede responder.
2. **Cambiar la semántica de `Ventas:Leer`** a "solo las mías" y agregar un permiso nuevo para
   el listado completo. Rompe el significado de un permiso ya asignado en tenants existentes.
3. ✅ **Reusar el eje de `caja`.** Quien tiene `Cajas:Leer` (supervisión de cajas) ve todas las
   ventas y todos los pagos; quien no lo tiene ve lo de **sus** cajas.
   ⚠️ Esta línea decía *"quien solo tiene `MiCaja`"* y **al ejecutar se descartó** por
   fail-open. Ver *Resuelto al ejecutar* abajo.

**Por qué el 3 y no el 1:** la autoría de una venta **se deriva de su caja**, así que el
permiso que decide "¿ves cajas ajenas?" es exactamente el que debe decidir "¿ves ventas
ajenas?". No son dos ejes que casualmente se parecen: es el mismo eje. Y el helper ya existe
(`resolverLecturaCompartida` en `caja.controller.ts` — al ejecutar se movió a `RbacService` y
se partió en dos, ver abajo), así que no hay arquitectura nueva —
`CLAUDE.md` es explícito sobre no introducirla para un problema que el stack ya resuelve.

⚠️ **Costo aceptado, dicho explícito:** un tenant que quiera alguien que supervise ventas
**sin** supervisar caja no lo va a poder expresar. Hoy no hay ningún rol así en el seed ni
pedido del owner; si aparece, ahí sí corresponde el camino 1.

## Regla de "lo mío"

```
mías = las ventas/pagos cuya caja pertenece al usuario que consulta
     = JOIN cajas c ON c.caja_id = X.caja_id AND c.usuario_id = $yo
```

Incluye las cajas **cerradas** del usuario, no solo la abierta: su historial sigue siendo
suyo.

## La venta online: sin dueño, y visible para todos — resuelto midiendo

La venta online no tiene dueño: va contra la caja virtual del tenant, que no pertenece a nadie.
Con la regla de arriba, un cajero **no vería ninguna venta online**.

**Se resuelve que las online las ve cualquiera con `Ventas:Leer`** (no son de una persona, son
del local), y la razón por la que eso NO reabre la fuga está **medida, no supuesta**:
`ventas.service.ts` resuelve la caja por canal —`canal === 'online'` → `findVirtual(tenantId)`,
si no → `findActiva(tenantId, usuarioId)`—, o sea que **una venta online nunca toca una caja
física**. Sus pagos van a la caja virtual, que nunca se cuenta físicamente. Por lo tanto no
puede revelar el esperado de ningún cajón que alguien vaya a arquear, que es lo único que este
frente protege.

La alternativa —ocultárselas al cajero— rompería una pantalla legítima (los pedidos online del
local) a cambio de cero seguridad.

⚠️ **Es un llamado del agente, no una decisión pedida al owner.** Se tomó porque el riesgo que
la hacía dudosa resultó imposible al medirlo. Si el owner prefiere que las online sean solo de
supervisión, es un `OR` menos en el filtro y no cambia nada más del diseño.

## 🛑 Lo que sí falta decidir

Nada bloqueante. Lo que conviene mirar al ejecutar, y no antes:

- **`caja_id` es nullable en las dos entidades.** Hay que ver si existen ventas o pagos sin
  caja (¿importaciones? ¿la pasarela?) y decidir si son "de nadie" (invisibles para el cajero)
  o visibles para todos como las online. Medir primero, no asumir.

## ✅ Resuelto al ejecutar (2026-08-22)

Lo que el diseño dejó abierto o dijo mal, y cómo quedó. **Esta sección manda sobre lo de
arriba**; la regla viva está en
[`features/ventas.md` → Quién ve qué](../../features/ventas.md#quién-ve-qué-el-eje-cajasleer)
y su mecánica en [`patterns/backend.md` §16](../../patterns/backend.md).

1. **`MiCaja:Leer` quedó FUERA de la regla.** El diseño decía "quien solo tiene `MiCaja` ve lo
   de sus cajas" y **eso era fail-open**: `abrir` y `movimientos` piden `MiCaja:`**`Crear`** y
   `conteo`/`cerrar` no llevan permiso de módulo, así que quitarle `MiCaja:Leer` a un rol lo
   dejaba operativo de punta a punta **y** le concedía todos los pagos del tenant. Quitar un
   permiso no puede conceder acceso. Hoy la regla mira **solo `Cajas:Leer`**.
2. **Aparecieron dos funciones, no una.** `resolverAlcanceCaja` (rutas de caja: el permiso es
   el piso, lanza 403) y `resolverAlcanceDerivadoDeCaja` (ventas, pagos: el permiso es el
   acotador, no lanza). Confundirlas rompe cosas distintas.
3. **Tercera rama, que el diseño no tenía:** un tenant que **no contrató el módulo `Cajas`** ve
   todo, porque ahí `Cajas:Leer` es inobtenible —`userHasPermiso` exige el módulo contratado
   incluso para el admin—. Acotar ahí sería permanente y sin arreglo por configuración.
   ⚠️ **Alcanza también al tenant que compró `MiCaja` y no `Cajas`**, que sí tiene cajones
   físicos: ahí el eje queda apagado. Anotado como decisión de producto pendiente en
   [`agent/pendientes.md`](../../agent/pendientes.md).
4. **`caja_id` NULL → "de nadie".** Se resolvió con `EXISTS` **sin** `OR caja_id IS NULL`: hoy
   ningún camino la deja vacía, y si mañana aparece uno, una fila sin caja no cae en "lo mío"
   por omisión.
5. **La venta `online` quedó visible para todos, y sus pagos también.** Excluir los pagos
   online no compraba seguridad —viajaban igual en `GET /ventas/:id`— y descuadraba los KPI de
   pagos contra los de ventas.
6. **El detalle de una venta propia redacta el `caja_id` de un pago ajeno** (abono cruzado), en
   vez de esconder la fila: el monto es de su venta, el cajón no es suyo.

## Fuera de alcance

- Los **dos oráculos** (el 422 de retiro y el de la nota de crédito). Van por el otro camino
  que el owner decidió el mismo día —**dejar rastro, no ocultar**— y son un frente propio: no
  se cierran acotando visibilidad.
- El **modo ciego** en sí. Este frente lo desactiva como problema en tres de las seis fugas,
  pero no toca su predicado.
- Bloquear el historial de cajas del cajero: va después, y con esto puede volverse innecesario.
