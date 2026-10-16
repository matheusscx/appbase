# Diseño: la cuenta del repartidor (tarifas, cobros, entregas de plata y rendición por período)

**Status**: Draft · **Date**: 2026-10-16 · **Owner**: Cesar Matheus

Fase 2 de Paquetería ([`features/paqueteria.md`](../../features/paqueteria.md)). Va **antes** que
[`2026-10-16-repartidor-entrega-desde-el-telefono-design.md`](2026-10-16-repartidor-entrega-desde-el-telefono-design.md),
que se apoya en esta. Lo decidido por el owner va marcado **(owner)**; lo que decidí yo para que
cierre, **(mi decisión)**, y se puede revisar.

## Intención

El cliente lleva hoy la cuenta de cada repartidor en una planilla semanal (*"Relación de
entregas"*, mostrada por el owner el 2026-10-16): por día, cuántos paquetes entregó en cada
tarifa de pago (1.900, 3.200, 1.800, 4.000), lo que se le paga ("total costo"), lo que cobró en
destino y se le descuenta ("envíos por pagar") y lo que la empresa le paga al final ("total a
pagar"). Ejemplo real: semana del 05 al 10/10, 235 paquetes a $1.900 = $446.500, menos
$22.178 cobrados en destino, **$424.322 a pagarle**.

La cuenta es la misma que Venka ya hace por hoja (*cobrado en destino − pago al repartidor*,
negativo = la empresa le debe). Lo que falta para reemplazar la planilla:

1. **Varias tarifas de pago**, no un solo monto por empresa.
2. **Cómo le pagaron** cada cobro en destino: efectivo o transferencia a la cuenta del
   repartidor.
3. **Entregas de plata** a cuenta, en cualquier momento.
4. **Rendir por el período que se elija** (un día, dos, una semana), no hoja por hoja.

### Metas

- La oficina arma su tabla de tarifas de pago y cada paquete se le paga al repartidor con la que
  corresponde, sin tipear montos.
- La rendición de una semana se ve como la planilla del cliente y da el mismo número.
- Sirve igual para el cliente que rinde a diario y para el que rinde los sábados, sin configurar
  nada **(owner: "tiene que ser flexible")**.

### No metas

- Multas o descuentos a mano (*"7000 pedido sin evidencia"* de la planilla: owner, ignorarlo).
- Tarifas de lo que se **cobra** por el envío: eso sigue como hoy (un valor por defecto de la
  empresa con override por paquete) **(owner: "son tarifas aparte")**.
- Que la rendición mueva una Caja o emita un documento (sigue fuera, igual que en el MVP).
- Que el saldo de una rendición pase a la siguiente (ver *Rendir*).

### Anti-metas

- Cambiar el monto de una tarifa mueve plata de entregas ya hechas.
- Una rendición cerrada cambia después.
- Dos lugares calculan la misma plata y dan distinto (hoy hay **una** consulta de totales; sigue
  siendo una).

## Restricciones

- Invariantes de `CLAUDE.md` (tenant del token, Decimal.js, soft delete, guards reales). Todo
  esto es admin del tenant, como el resto de Paquetería hoy (`TenantAdminGuard`).
- Plata en `numeric(18,4)`, validada en el DTO contra los decimales de la moneda oficial
  (`patterns/backend.md` § 3.1).
- Orden de bloqueo de Paquetería: repartidor `FOR SHARE` → hoja `FOR UPDATE` → paquetes. Rendir
  varias hojas las bloquea **por `hoja_ruta_id` ascendente**.
- Sin datos productivos: la migración no hace backfill; el seed del demo se rehace.
- Cada cambio de entity con su migración (ADR-030).

## Diseño

### 1. Tarifas de pago al repartidor (owner)

- Tabla **`tarifas_pago`** por tenant: `nombre` (ej. Bicicleta, Moto, Auto, Colina), `monto`,
  `es_defecto`, `activa`. Exactamente una por defecto mientras haya alguna (índice único parcial).
  Pantalla en Configuración → Paquetería.
- **Cada repartidor** puede tener su tarifa (`repartidores.tarifa_pago_id`, opcional): la de su
  vehículo.
- **Cada paquete** puede llevar otra, elegida de un **selector** (`paquetes.tarifa_pago_id`,
  opcional): los casos especiales, como "Colina" por lejanía.
- **Qué tarifa se paga** en una entrega: la del paquete; si no tiene, la del repartidor de esa
  hoja; si no tiene, la por defecto. La del paquete **reemplaza**, no se suma **(owner:** un
  repartidor en bicicleta que entrega un "Colina" cobra solo Colina).
- **El pago se fija en la línea al entregar** **(mi decisión,** misma regla 1 del MVP: los
  defaults se copian, no se referencian): al pasar a `entregado`, la línea guarda
  `tarifa_pago_id` y `pago_repartidor` resueltos en ese momento. Cambiar después el monto de la
  tarifa no mueve esa entrega. Cambiar la tarifa del paquete con la línea entregada y la hoja sin
  rendir **vuelve a resolver** esa línea (es la forma de corregir).
- Como el pago depende del repartidor, un paquete no entregado que al otro día lleva otro
  repartidor se paga con la tarifa del segundo **(mi decisión)**.
- **Sale lo que hay hoy:** `paquetes.pago_repartidor` y
  `paquete_configuracion.pago_repartidor_defecto`, y el override de **monto** del pago en
  Escanear y en la ficha del paquete pasa a ser el **selector de tarifa**. El precio de envío
  sigue siendo un monto con override, como ahora.
- Volver una línea de `entregado` a `en_ruta` o `no_entregado` limpia su tarifa, su pago y su
  `medio_cobro`; si se vuelve a entregar, se resuelven de nuevo con lo que valga en ese momento.
- Sin ninguna tarifa cargada, escanear o dar de alta un paquete es 400 (hoy pasa lo mismo sin
  configuración: no se crean paquetes que se pagarían $0).
- La tarifa por defecto no se desactiva ni se borra: primero se marca otra como defecto **(mi
  decisión)**. Montos de tarifas con la misma regla de decimales de la moneda oficial que el
  resto de la plata.
- Borrar una tarifa: soft. Una tarifa en uso por un repartidor o un paquete no se borra, se
  desactiva (sale de los selectores); las líneas entregadas no dependen de ella porque guardan su
  monto.

### 2. Cómo le pagaron un cobro en destino (owner)

- Al marcar entregado un paquete con cobro en destino se elige **efectivo** o **transferencia**
  (a la cuenta del repartidor). Columna `medio_cobro` en la línea, solo con `entregado` y cobro en
  destino (`CHECK`). Por defecto, efectivo.
- **Las dos cuentan igual** en lo que debe el repartidor **(owner:** con 7 en efectivo y 3 por
  transferencia de $10.000, y $50.000 de pago, rinde $50.000). La rendición muestra el detalle.
- "Entregar todos" de la hoja deja los cobros en destino en efectivo; se cambian en la fila
  **(mi decisión)**. Resuelve el pago de todas las líneas en una sola consulta.
- En la hoja de la oficina, el medio se elige en la fila al marcar y se puede cambiar mientras la
  hoja no esté rendida.

### 3. Entregas de plata a cuenta (owner)

- La oficina anota en cualquier momento que el repartidor dejó plata: `entregas_repartidor`
  (`repartidor_id`, `fecha`, `monto` > 0, `medio`: efectivo | transferencia, `nota` opcional,
  quién y cuándo la anotó, `rendicion_id` nulo hasta que se rinde).
- Mientras no esté rendida se puede corregir o anular (soft). Rendida, es de solo lectura.
- **(mi decisión)** No existe al revés (la empresa le adelanta plata al repartidor): no salió en
  la conversación ni en la planilla; si hace falta, es un monto con el otro signo y se agrega
  después.

### 4. Rendir por período (owner: flexible)

- **Rendir** se hace por **repartidor**: la pantalla muestra todas sus hojas **sin rendir** y sus
  entregas de plata sin rendir. La oficina marca qué hojas entran (por defecto todas las que no
  tienen paquetes en ruta) y ve el total antes de confirmar.
- Una hoja con algún paquete `en_ruta` no se puede incluir (igual que hoy): primero se marca.
- **Entran todas las entregas de plata sin rendir de ese repartidor** **(mi decisión:** una
  entrega no pertenece a un día; elegirlas a mano abre errores sin ganar nada. Como el saldo se
  arregla al rendir, que una entrega del sábado entre en una rendición de lunes a miércoles no
  descuadra nada).
- Una rendición lleva al menos una hoja **(mi decisión)**.
- **La cuenta:**
  - cobrado en destino = Σ `precio_envio` de los entregados con cobro en destino, separado en
    efectivo y transferencia;
  - pago al repartidor = Σ `pago_repartidor` de las líneas entregadas;
  - entregado a cuenta = Σ de las entregas de plata;
  - **saldo = cobrado − pago − entregado a cuenta**. Positivo: lo debe el repartidor. Negativo:
    la empresa le paga. La pantalla lo dice en palabras, como hoy el neto.
- **Cada hoja se sigue congelando como hoy** (`congelar`, con sus columnas por hoja, más el
  desglose por medio), dentro de la transacción de la rendición; los totales de la rendición son
  la suma de lo congelado en sus hojas más las entregas. Así la lista de hojas sigue leyendo lo
  suyo y la plata sale de una sola consulta. **(mi decisión)**
- **Rendir crea una `rendicion`** (repartidor, quién, cuándo, los totales y el saldo congelados)
  y marca sus hojas `rendida` con `rendicion_id`, y sus entregas con `rendicion_id`, todo en una
  transacción. Lo que congela es lo que calcula la consulta de totales en ese momento (la regla
  de hoy de `congelar`).
- **El saldo se arregla al rendir** **(mi decisión):** rendir es el momento en que se paga o se
  recibe la diferencia; la rendición no deja un saldo arrastrado a la siguiente. Si el cliente
  necesita arrastrar, es un cambio chico después (una entrega de plata por el saldo).
- Una rendición cerrada es de solo lectura. **(mi decisión)** No se anula en esta versión.
- Hoy se rinde por hoja (`POST /hojas-ruta/:id/rendir`): eso **se reemplaza** por la rendición
  por repartidor; rendir un solo día es elegir una sola hoja.

### 5. Lo que muestra la rendición (la planilla)

Una vista por rendición, imprimible, con el formato de la planilla del cliente: una fila por día
(fecha de la hoja; hay una sola hoja por repartidor y día, así que es el día en que se entregó) con la cantidad de paquetes entregados **por tarifa** (una columna por cada
tarifa usada en el período), el pago del día, lo cobrado en destino (efectivo y transferencia) y
el neto del día; abajo, los totales, las entregas de plata y el saldo. **(mi decisión:** imprimir
desde el navegador, sin generar PDF en el servidor; se puede compartir como PDF desde la
impresión.)

### 6. Una sola consulta para la plata

`HojasRutaService.totales` pasa a leer el pago de **la línea** (no del paquete) y a separar el
cobrado por medio. La rendición suma lo de sus hojas con esa misma consulta más las entregas de
plata; la planilla por día también sale de ahí. Nada recalcula la plata en TypeScript aparte.

### 7. KPIs

"Total a pagar a repartidores" pasa a salir del pago de las líneas. Se agrega
"Cobrado por transferencia" junto al de efectivo **(mi decisión)**.

### 8. Demo

El seed del tenant demo arma tarifas (Bicicleta, Moto, Auto por defecto, Colina), repartidores
con su tarifa, paquetes con alguna "Colina", cobros en efectivo y por transferencia, una entrega
de plata y una rendición semanal cerrada que reproduzca la forma de la planilla.

Lo que muestra una rendición cerrada no cambia: la línea guarda su pago y su medio, y la regla 7
del MVP ya deja de solo lectura los montos y el cobro en destino de un paquete entregado en una
hoja rendida.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Cambiar el modelo de pago rompe hojas ya rendidas del demo | Sin datos productivos: se rehace el seed |
| Rendir varias hojas a la vez abre un deadlock con escanear o marcar | Bloquear repartidor → hojas por id ascendente, el orden de siempre |
| Un cambio de tarifa a mitad de semana | El pago se fija en la línea al entregar |
| Lo que muestra la planilla no cuadra con lo congelado | Las dos salen de la misma consulta; e2e que compara planilla y rendición |

## Lo que queda al builder

- Nombres de tablas y columnas, y la migración.
- La forma exacta de las respuestas (proyecciones en `paqueteria.types.ts`).
- El diseño de las pantallas, dentro del design system (skills `nuxt-ui` y `frontend-design`).
- Cómo partir el trabajo en tareas.
