# Feature: Paquetería (repartidores, hojas de ruta y rendición)

**Status**: Complete (MVP + cuenta del repartidor: tarifas de pago, entregas de plata y rendición por repartidor + tarifas de envío con precio fijo al entregar; el frente del teléfono sigue pendiente)
**Owner**: Cesar Matheus
**Last Updated**: 2026-10-17

---

## Overview

### ¿Qué es?

Un módulo para una empresa de reparto (mayormente paquetes de Mercado Libre). La oficina da de
alta a sus **repartidores** (una ficha, sin login), **escanea con pistola** los paquetes que cada
uno se lleva en el día —eso arma su **hoja de ruta**—, marca cada uno como entregado o no
entregado, y al cerrar el período (un día, una semana) **rinde al repartidor**: el sistema congela, sobre las
hojas que se elijan, cuánta plata cobró en destino, cuánto se le paga y cuánto debe entregar (o se
le debe).

### ¿Por qué existe?

Es un MVP para mostrarle a un cliente de reparto. Es un módulo de este SaaS y no una app aparte
para no rehacer login ni deploy, y no migrar si el cliente compra. **No es un frente fiscal**: el
envío no emite documento tributario.

### Alcance

- MVP (2026-10-15): el precio de envío por defecto, CRUD de repartidores y de paquetes, escaneo
  que crea y asigna, asignación masiva, marcar entregado / no entregado, KPIs por rango de
  fechas y un tenant demo.
- Cuenta del repartidor (2026-10-16/17): tarifas de pago con una por defecto (reemplazan al pago
  por defecto), el pago que queda fijo en la línea al entregar, cobro en efectivo o
  transferencia, entregas de plata a cuenta y **rendición por repartidor** sobre las hojas que se
  elijan, con su planilla imprimible.
- Tarifas de envío (2026-10-17): lo que se cobra por el envío sale de una tabla con nombre
  (Estándar, Prioritario, Premium…) con una por defecto, y el precio queda fijo en la línea al
  entregar, igual que el pago (reemplazan al "precio de envío por defecto" y al precio del paquete).
- Fase 2 (no existe): [`desarrollo-nuevo.md`](../agent/desarrollo-nuevo.md) § *Paquetería — fase 2*.

### Decisiones de diseño (owner, 2026-10-15)

Cada punto lo eligió el owner con su costo a la vista; esto es lo que quedó y lo que se descartó.

| Decisión | Elegida | Descartada, y por qué |
|---|---|---|
| Dónde vive | Módulo de este SaaS | App aparte: rehacer login y deploy, y migrar si el cliente compra |
| Repartidor | Ficha que maneja la oficina, sin login | Usuario propio con pantalla móvil: suma rol, permisos y UI |
| Paquete no entregado | `en_ruta → entregado \| no_entregado`; solo lo entregado suma | Asignar = pagar (un rechazo descuadra la rendición); pagar la visita igual |
| Qué cobra en destino | Solo el envío | Envío + valor del producto (contrarreembolso con plata de un tercero) |
| Cuánto se cobra por el envío (owner, 2026-10-17) | **Tarifas de envío** con nombre, una por defecto. Orden: la del paquete; si no tiene, la por defecto. El precio se copia a la línea al entregar. Sin tarifas por remitente por ahora | Un precio por defecto por empresa y un precio tipeado a mano en cada paquete: no cubre cobrar distinto por servicio, y cambiarlo movía lo ya entregado |
| Valores por defecto | Uno por empresa, override por paquete (**superado** el 2026-10-17 por las tarifas de envío, fila de arriba) | Precio por comuna (fase 2). *Tarifa por repartidor*: descartada al inicio y **superada** el 2026-10-16 (ver Tarifas de pago) |
| Rendición | "Rendir" cierra la hoja y congela los totales; no pasa por Caja | Solo mirar el cálculo; entrar a una Caja (toca cajas: frente aparte) |
| Datos del paquete | Código obligatorio; destinatario, dirección y remitente opcionales | Dirección obligatoria: frena el escaneo, que crea el paquete con solo el código |
| Carga | Escaneo que crea y asigna; además alta uno a uno y asignación masiva | Importar CSV/Excel |
| Lector | Pistola USB/Bluetooth (tipea el código + Enter) | Cámara del celular: dependencia nueva o API que no anda en iPhone |
| Código que no existe | Se crea con solo el código y los defaults, y se asigna | Rechazarlo (obliga a cargar antes); mini-formulario (frena el ritmo) |
| Cobro en destino al escanear | Interruptor fijo en la pantalla, vale para los escaneos siguientes; cada fila se cambia | Todos pagados (o todos con cobro) y marcar después: un olvido descuadra la rendición |
| Modelo | Hoja de ruta (repartidor + día) con sus paquetes | Todo en el paquete (reasignar pisa el intento anterior y cambia reportes ya rendidos); intentos sin cabecera ("el día de Juan" no existe como cosa) |
| Acceso | Todo con `TenantAdminGuard` | Sin guard: viola la invariante 6 (un cajero rendiría hojas por API) |
| Tenant demo | "Demo Gestión de Paquetes" con su admin propio y Paquetería como único módulo; el menú del admin muestra solo lo contratado | Sembrar en Demo Restaurante (el cliente vería un POS de restaurante); tenant propio con el menú de hoy (vería módulos que le dan 403) |
| Total general | Σ `precio_envio` (de la línea) de todos los entregados, con o sin cobro en destino | — |
| Cuánto se le paga al repartidor (owner, 2026-10-16) | **Tarifas de pago** con nombre (Bicicleta, Moto, Auto, Colina…), una por defecto; el repartidor o el paquete llevan la suya y el monto se copia a la línea al entregar | Un monto por defecto por empresa y override a mano por paquete: no cubre pagar distinto por vehículo ni por zona, y cambiarlo movía lo ya entregado |
| Quién rinde (owner, 2026-10-16) | Por **repartidor**, sobre las hojas que la oficina elija (un día, una semana): una rendición con totales congelados | Rendir hoja por hoja: el repartidor cobra por semana y había que sumar a mano |
| Plata que el repartidor deja antes de rendir | **Entregas de plata** (monto, medio, nota) que no pertenecen a un día; entran todas las pendientes en la próxima rendición | Atarlas a una hoja: la plata no se entrega el día que se cobra |
| Cómo se cobra en destino | Efectivo o transferencia a la cuenta del repartidor; las dos cuentan igual en lo que debe | Solo efectivo: la oficina no distinguía qué plata tenía el repartidor en la mano |
| Saldo de una rendición | cobrado − pago − entregado a cuenta; positivo lo debe el repartidor, negativo la empresa le paga; se arregla al rendir y no se arrastra | Arrastrar el saldo a la rendición siguiente |
| Una rendición cerrada | Solo lectura, no se anula | Anular: movería totales que la oficina ya usó para pagar |

---

## Reglas

Las numeraciones (`regla 5b`, `3.1`) son las que citan los comentarios del código.

1. **Ni el precio del envío ni el pago son un monto del paquete.** El paquete puede llevar una
   *tarifa de envío* propia (`tarifa_envio_id`) y una *tarifa de pago* propia (`tarifa_pago_id`,
   un caso especial como "Colina"); las reglas 10 y 10b dicen cuál se paga y cuál se cobra, y el
   monto se copia a la línea al entregar. Cambiar el monto de una tarifa no mueve lo ya entregado.
2. **El estado del paquete se deriva de sus líneas**, no se guarda: *entregado* si tiene una
   línea `entregado`; *en ruta* si tiene una `en_ruta`; *disponible* en cualquier otro caso
   (nunca salió, o todos sus intentos fueron `no_entregado`).
3. **Solo lo entregado suma.** Un `no_entregado` no aporta cobro ni pago al repartidor, y el
   paquete vuelve a quedar disponible para otra hoja sin borrar el intento anterior.
4. **Totales de una hoja:** `asignados` (líneas), `entregados`, `cobro_destino` (cantidad de
   entregados con cobro en destino), `monto_cobrado_destino` (Σ `precio_envio` **de la línea** de esos),
   `monto_pago_repartidor` (Σ `pago_repartidor` **de la línea**, no del paquete, de los
   entregados), `monto_total_general` (Σ `precio_envio` de la línea de todos los entregados) y
   `neto_a_rendir` = cobrado − pago. El cobrado se parte por medio: `monto_cobrado_efectivo` +
   `monto_cobrado_transferencia` = `monto_cobrado_destino` (las dos cuentan igual en el neto).
   Un neto negativo es que la empresa le debe al repartidor, y la pantalla lo dice así.
5. **Asignar** (`repartidorId`, `fecha`, `paqueteIds[]`) crea la hoja de ese repartidor ese día o
   suma a la existente. 400 si la hoja está rendida, si el repartidor está inactivo o si algún
   paquete no está disponible (todo o nada, con la lista de los que fallaron).
   **5b. Escanear** resuelve **un** código por llamada (cada escaneo es independiente) y
   devuelve `{ resultado, codigo, hoja }`:
   - `asignado_nuevo`: el código no existía → se crea con solo el código, el `cobroEnDestino` del
     interruptor y, si llegan, su `tarifaPagoId` y su `tarifaEnvioId`, y se asigna;
   - `asignado`: existía y estaba disponible → se asigna **sin** pisar su `cobro_en_destino`
     (ya lo decidió quien lo cargó; se cambia en la fila);
   - `ya_escaneado`: ya está `en_ruta` en esta misma hoja → no hace nada y no es error;
   - un `no_entregado` de **esta** hoja que se reescanea reactiva su línea a `en_ruta` (reintento
     del mismo día) en vez de crear otra;
   - **rechazado**: en ruta en otra hoja (otro repartidor) o ya entregado → 409 con el motivo
     legible (*"El paquete X está con Pedro (hoja del 12-10)."*, *"El paquete X ya se entregó el
     12-10."*). Vale también para un código **nuevo** escaneado a la vez por dos repartidores: uno
     lo crea y el segundo recibe este 409 (e2e `paqueteria.e2e-spec.ts`, el caso de los dos
     repartidores).

   Igual que asignar, crea la hoja si no existe y es 400 si está rendida o el repartidor
   inactivo. Dos escaneos simultáneos del mismo código nuevo: el índice único de `codigo` hace
   que uno cree y el otro relea y asigne (o diga `ya_escaneado`, o el 409 de arriba si es de otro
   repartidor), nunca un 500.
6. **Rendir** es por **repartidor** y por las hojas que se elijan (un día, varios, una semana):
   `POST /rendiciones { repartidorId, hojaIds[] }`. Es todo o nada: las hojas tienen que ser de ese
   repartidor, estar abiertas, tener paquetes y no tener ninguna línea `en_ruta`; si alguna no
   cumple es 400 y no cambia nada. Crea una **rendición** (quién, cuándo, totales y saldo
   congelados), congela cada hoja (`congelar`, con su `rendicion_id`) y reclama las entregas de
   plata pendientes del repartidor, todo en una transacción. Una hoja rendida es de solo lectura:
   no admite asignar, marcar ni quitar. Una rendición cerrada es de solo lectura y **no se
   anula**. `GET /rendiciones/previa` da la misma cuenta sin escribir.
   **6b. La cuenta de una rendición:** cobrado en destino (partido en efectivo y transferencia),
   pago al repartidor y **entregado a cuenta** (la suma de las entregas de plata reclamadas);
   **saldo = cobrado − pago − entregado a cuenta**: positivo lo debe el repartidor, negativo la
   empresa le paga. El saldo se arregla al rendir: no se arrastra a la siguiente rendición. Los
   totales de la rendición son la suma de lo que congeló cada hoja más las entregas; las dos
   cuentas (previa y rendir) salen del mismo código y de `totales`.
   **6c. Entregas de plata** (`entregas_repartidor`): plata que el repartidor le deja a la oficina
   en cualquier momento (`fecha`, `monto` > 0, `medio`, `nota`). No pertenecen a un día: **entran
   todas las pendientes del repartidor** en la próxima rendición. Se corrigen o anulan (soft) solo
   mientras no estén rendidas; rendida, 400. Una entrega creada después de rendir queda pendiente
   para la siguiente. Un repartidor con entregas no se borra (se desactiva) y una entrega se puede
   anotar para uno inactivo (puede seguir debiendo).
   **6d. La planilla:** la rendición devuelve `dias` (una fila por hoja, por fecha ascendente:
   entregados, pago, cobrado por medio y neto del día, y `porTarifa`, el **conteo** de entregados
   por tarifa de pago), `tarifas` (las usadas en el período, una columna de la planilla cada una)
   y `entregas`. La plata de cada día es la de su hoja; `porTarifa` no lleva plata.
7. **Editar un paquete:** se puede mientras no esté *entregado en una hoja rendida*; desde ahí
   las tarifas (de pago y de envío) y `cobro_en_destino` son de solo lectura (cambiarlos movería una
   rendición cerrada). La dirección y el destinatario sí se pueden completar. Con la hoja
   **abierta**, cambiar la tarifa de pago de un paquete ya entregado **vuelve a resolver** el pago
   de esa línea y cambiar la de envío, su precio (es la forma de corregir un error; solo la que
   cambió, y solo si cambia: reenviar la misma o `null → null` no toca la línea), y cambiar su
   `cobro_en_destino` ajusta el medio de cobro de la línea (efectivo al activarlo, vacío al
   quitarlo).
8. **Borrar un paquete** (soft) solo si **nunca salió** en una hoja (un `no_entregado` también es
   historia de una hoja). **Quitar de la hoja** (soft sobre la línea) solo con la línea
   `en_ruta` y la hoja abierta.
9. **Desactivar un repartidor** no toca sus hojas: solo lo saca del selector. **Borrar** uno con
   hojas es 400 (se desactiva): así ninguna hoja apunta a un repartidor borrado y ninguna
   lectura necesita una excepción al filtro `eliminado_el IS NULL`.
10. **Qué tarifa de pago se paga y cuándo se fija.** Al marcar una línea `entregado` se
    resuelve **la del paquete; si no tiene, la del repartidor de esa hoja; si no tiene, la por
    defecto** (la del paquete reemplaza, no se suma) y la línea guarda `tarifa_pago_id` y
    `pago_repartidor`. Cambiar después el monto de la tarifa **no mueve** esa entrega; marcar
    entregado otra vez una línea ya entregada tampoco la resuelve de nuevo. Volver a `en_ruta` o
    `no_entregado` limpia tarifa, pago y medio de cobro. Un paquete `no_entregado` con un
    repartidor y entregado al otro día por otro se paga con la tarifa del segundo (la resolución
    usa el repartidor de la hoja que entrega). La resolución es SQL, en un solo lugar:
    `tarifa-resuelta.ts` (`tarifaResueltaSql`); la usan el `UPDATE … FROM` de entregar y de
    corregir la tarifa, y la lectura del pago **estimado** de una línea que aún no se entregó
    (`pagoEstimado: true`, solo en una hoja abierta: en una rendida es siempre `false`). Nadie lee las tarifas en TypeScript para repetirla. Una tarifa
    desactivada sigue valiendo para el paquete o repartidor que ya la tenían; una borrada no.
    **Sin una tarifa de pago por defecto o sin una de envío por defecto**, escanear un código
    nuevo o dar de alta un paquete es 400: no se crean paquetes que se entregarían a $0 (el 400 de
    envío dice *"Carga una tarifa de envío por defecto en Configuración → Paquetería…"*). Lo que
    antes devolvía `configurada` (y se fue con `GET /paquetes/configuracion`) es hoy que
    `GET /tarifas-pago` y `GET /tarifas-envio` traigan cada una una fila con `esDefecto`.
10b. **Qué tarifa de envío se cobra y cuándo se fija.** Al marcar una línea `entregado` se resuelve
    **la del paquete; si no tiene, la por defecto** (no hay nivel repartidor: cobrar el envío no
    depende de quién lo lleva) y la línea guarda `tarifa_envio_id` y `precio_envio`, **en la misma
    sentencia que el pago** (`entregar-todos` también). Cambiar después el monto de la tarifa no
    mueve esa entrega; volver a `en_ruta` o `no_entregado` limpia tarifa y precio. La resolución es
    SQL, en un solo lugar (`tarifa-resuelta.ts`, `tarifaEnvioResueltaSql`) y la comparte la lectura
    del precio **estimado** de una línea que aún no se entregó (`precioEstimado: true`, solo en una
    hoja abierta: en una rendida una línea no entregada trae `precioEnvio '0.0000'`, sin tarifa y
    `precioEstimado: false`). `LineaHoja.precioEnvio` es el fijado (entregada) o el estimado, y
    `tarifaEnvioPaqueteId` la propia del paquete. Una línea anterior a las tarifas
    (`tarifa_envio_id` null) conserva el precio que tenía. Una tarifa desactivada sigue valiendo
    para el paquete que ya la tenía; una borrada no. Los totales, la rendición, la planilla y los
    KPIs suman `l.precio_envio`, nunca algo del paquete.
11. **Plata que entra por la API:** validada en el DTO contra los decimales de la moneda oficial
    ([`patterns/backend.md`](../patterns/backend.md) § 3.1); lo que no cabe es 400. Montos ≥ 0.
    Plata en `numeric(18,4)` en la moneda oficial del tenant, con Decimal.js.
12. **Medio de cobro.** Un cobro en destino se paga en `efectivo` o `transferencia` (a la cuenta
    del repartidor): `medio_cobro` en la línea, **solo** en una línea `entregado` de un paquete
    con cobro en destino. Al marcar entregado sin `medioCobro` queda `efectivo`; `entregar-todos`
    los deja en efectivo y se cambian en la fila (marcar `entregado` otra vez con `medioCobro`,
    mientras la hoja esté abierta). Mandar `medioCobro` con un paquete sin cobro en destino o con
    `no_entregado` / `en_ruta` es 400. Lo valida el service (el cobro vive en `paquetes`; un
    `CHECK` no lo ve); la base sostiene el resto con `CHECK`: el medio es uno de los dos, solo
    hay medio si está entregada, y está entregada si y solo si tiene `pago_repartidor` y si y solo
    si tiene `precio_envio`.

### 3.1 Normalizar el código escaneado

La pistola es un teclado: tipea lo que lee el QR y da Enter. `normalizarCodigoPaquete`
(`backend/src/modules/paqueteria/codigo-paquete.ts`) recorta los bordes; si el texto es un JSON
con campo `id`, el código es ese `id`; si no, es el texto entero. Corre en el escaneo, el alta y
la búsqueda, para que el código tipeado y el escaneado sean el mismo paquete. El DTO deja
entrar hasta 500 caracteres crudos (`MAX_ENTRADA_CODIGO`) y el código normalizado cabe en 100
(`MAX_CODIGO`).

✅ **Confirmado con una etiqueta real** (owner, 2026-10-16, escaneada con el teléfono): el QR de
Mercado Libre trae `{"id":"<número de envío>","sender_id":<número>,"hash_code":null,"security_digit":null}`.
El `id` viene **entre comillas**, así que no hay pérdida de precisión de `JSON.parse`; el spec de
`codigo-paquete.ts` usa esa misma forma. Si una etiqueta trajera el `id` sin comillas y con más de
15 dígitos, habría que leerlo como texto.

### KPIs (por rango de fechas de la hoja)

| KPI | Cálculo |
|---|---|
| Paquetes entregados | líneas `entregado` (los asignados, al lado, de referencia) |
| Cobro en destino | cantidad y Σ `precio_envio` de los entregados con cobro en destino |
| Total general | Σ `precio_envio` de **todos** los entregados |
| Cobrado por transferencia | Σ `precio_envio` de los entregados con cobro en destino pagados por transferencia |
| Total a pagar a repartidores | Σ `pago_repartidor` de las líneas entregadas |

`fecha` es una columna `date` que se elige en pantalla (por defecto el día del negocio), así que
el rango se compara directo, sin `rango-fecha.util.ts`.

---

## Los totales salen de UNA consulta

`HojasRutaService.totales(tenantId, hojaIds)` es la **única** consulta de totales: la usan el
detalle, la lista y, al rendir, la que produce lo que se congela. No hay una función TS que
calcule lo mismo aparte de una SQL: dos fuentes de la misma plata terminan diferentes. Por eso se
prueba en el e2e de API contra Postgres (neto negativo, `no_entregado` que no suma, pagados que
suman al total general y no al cobrado en destino) y no en unitarios: el mock de `Db` no ve el
SQL.

**Rendir congela lo que `totales` calcula en ese momento.** Escribir el estado `rendida` es el
método público `congelar` de `HojasRutaService`, que llama `RendicionesService.rendir` (con el
usuario del token, o sin usuario desde el seed de la demo) una vez por hoja: lo congelado y lo
calculado no pueden diferir. `HojasRutaService.exigirRendibles` valida las hojas elegidas y devuelve
lo que `totales` calcula para cada una; ese mismo resultado es el que `congelar` escribe y el que
suma la rendición. **Precondición** de `congelar`: quien llama tiene la hoja bloqueada (`FOR UPDATE`)
dentro de su transacción; se defiende solo de lo que quedaría mal: una hoja ya rendida (400) y una
con líneas `en_ruta` (400: rendida, esa línea no se podría marcar ni soltar nunca más). La hoja
rendida lee sus columnas congeladas; la abierta, el cálculo en vivo. La rendición sigue la misma
regla: lee las columnas que congeló.

---

## Orden de bloqueo

Todo lo que escribe líneas de una hoja toma los cerrojos que necesita **respetando este orden**
(ninguno toma los tres):

**repartidor (`FOR SHARE`) → hoja (`FOR UPDATE`) → paquetes (`FOR UPDATE`, por `paquete_id`
ascendente)**.

- `PaquetesService.update` toma primero `FOR SHARE OF h` sobre la hoja del paquete (rendir
  bloquea la hoja y no los paquetes): si una rendición está en curso, la edición espera y ve el
  paquete ya rendido; si llega después, la rendición espera a la edición. Sin ese cerrojo, un
  monto editado en el hueco entre leer `bloqueado` y escribir movería una rendición cerrada.
- `RepartidoresService.remove` toma al repartidor `FOR UPDATE` antes de preguntar por sus hojas;
  asignar y escanear lo leen `FOR SHARE` (`exigirActivo(..., { bloquear: true })`). Uno de los
  dos espera al otro y no queda una hoja apuntando a un repartidor borrado.
- Quién toma qué: **escanear** y **asignar** toman el repartidor (`FOR SHARE`), después la hoja y
  los paquetes; **marcar** toma la hoja y después el paquete; **entregar-todos** y **quitar** toman
  solo la hoja; **rendir** toma el repartidor (`FOR SHARE`) y después TODAS las hojas elegidas
  `FOR UPDATE` **por `hoja_ruta_id` ascendente** (`ORDER BY … FOR UPDATE` bloquea en ese orden), no
  los paquetes. El estado de cada hoja se mira DESPUÉS del cerrojo: quien pierde una carrera la ve
  ya rendida y rebota con 400.
- **Las entregas de plata no usan cerrojo explícito: el candado es el `WHERE rendicion_id IS NULL`
  del `UPDATE`.** Rendir las reclama con `UPDATE entregas_repartidor SET rendicion_id = $r WHERE …
  AND rendicion_id IS NULL AND eliminado_el IS NULL RETURNING monto` y suma lo devuelto; corregir o
  anular una es un `UPDATE … WHERE rendicion_id IS NULL` (0 filas → 400 *"ya está rendida"*, o 404 si
  no existe). Si gana la rendición, el `UPDATE` espera su fila, relee y no encuentra nada; si gana el
  cambio, la rendición suma el monto ya cambiado: la entrega queda dentro con su monto final o fuera
  para la siguiente, nunca contada dos veces ni perdida. Crear una entrega toma al repartidor `FOR
  SHARE` (`remove` lo toma `FOR UPDATE` y mira también las entregas). Ninguna toma hojas después de
  una entrega, así que no hay ciclo.
- **La tarifa de pago se toma después del repartidor y de la hoja cuando hay hoja, y en
  `PaquetesService.update`, antes que el paquete.** `PaquetesService.create` y `update` sobre un
  paquete sin línea viva la toman sin repartidor ni hoja delante (no hay ninguna que tomar). `PaquetesService.update` toma la hoja `FOR SHARE`, después la tarifa
  `FOR SHARE` y por último el paquete; crear y escanear un paquete toman la tarifa `FOR SHARE`
  explícito (`exigirActivaDelTenant(..., { bloquear: true })`) después de la hoja.
  **La tarifa de envío va justo después de la de pago**, con las mismas reglas (`FOR SHARE` en
  `PaquetesService.create`/`update` y en escanear; `eliminar` la toma `FOR UPDATE`), y sus
  escrituras (`crear`, `actualizar`, `eliminar`) van al final del orden igual que las de pago: toman
  su propio lock de aviso por tenant y la fila, y no piden nada después. Las dos tablas nunca se
  esperan entre sí. `hoja_ruta_paquetes.tarifa_envio_id` toma un `KEY SHARE` implícito por la FK.
  `RepartidoresService.update` toma al repartidor `FOR UPDATE` (como `remove`) y recién después la
  tarifa `FOR SHARE`: si fuera al revés, `escanear` (repartidor `FOR SHARE`, esperando la tarifa)
  y una edición de tarifa (esperando el defecto) lo cerraban en ciclo. Escribir
  `hoja_ruta_paquetes.tarifa_pago_id` toma además un `KEY SHARE` implícito por la FK.
- **Las escrituras de `tarifas_pago` (`crear`, `actualizar`, `eliminar`) van en fila y van al final
  del orden.** Las tres toman primero un lock de aviso por tenant (`pg_advisory_xact_lock`), así que
  dos de ellas nunca se esperan entre sí; después `actualizar` / `eliminar` toman `FOR UPDATE` la
  fila de la tarifa y `crear` / `actualizar` suman la fila del defecto (`soltarDefecto`, que es un
  segundo cerrojo sobre otra fila). No toman repartidor, hoja ni paquete después. Por eso esperan
  como mucho a quien tiene una tarifa `FOR SHARE`, y ese nunca espera a una escritura de tarifas
  sin haber pasado antes por su repartidor y su hoja.
- Mientras todos respeten el orden no hay ciclo; quien lo rompa abre un deadlock.

---

## Acceso

- **Todo el backend** es `JwtAuthGuard + TenantGuard + TenantAdminGuard` (invariante 6, enforcement
  real en el backend). Un usuario que no es admin recibe 403, incluso con el módulo contratado.
  Los permisos finos por rol son fase 2.
- **Paquetería es un módulo en `modulos_app` con un solo permiso `Leer`** que sirve de **marca de
  contratado**: es lo que lee el menú del frontend (`Paquetería:Leer` en `mis-permisos`). Ese permiso
  también se puede asignar a un rol propio en Roles y permisos (la pantalla lista los permisos de
  todo módulo contratado), pero el menú exige además ser **admin del tenant**: el backend es
  admin-only y a un rol no admin le daría 403. El menú del admin pasa a mostrar **solo lo contratado** (antes mostraba todo y
  el backend daba 403 en lo que el tenant no pagó).
- ⚠️ **El backend NO exige el contrato**: un admin de un tenant que no contrató Paquetería puede
  usar la API igual. Es un borde comercial (nadie ve datos de otro tenant), anotado para fase 2.
- Pantallas y menú: [`reference/modulos-y-configuraciones.md`](../reference/modulos-y-configuraciones.md).

## Tenant demo

**Demo Gestión de Paquetes** (Chile, CLP), con `admin@paquetes.cl` (admin del tenant, no
superadmin) y Paquetería como único módulo. Tres tarifas de envío (**Estándar $10.000 por
defecto**, Prioritario $14.000 y Premium $20.000; Prioritario y Premium solo en paquetes que no se
entregaron en una hoja rendida), cuatro tarifas de pago
(Bicicleta $1.800, Moto $1.900, **Auto $1.900 por defecto**, Colina $4.000), 3 repartidores con la
suya, 30 paquetes con códigos con forma de Mercado Libre (mezcla de pagados y con cobro en
destino, cinco con Colina, algunos cobros por transferencia) y 8 hojas: la **semana de Juan**
(6 días, tres paquetes por día, rendida de una vez junto con una entrega de plata de $8.000), un
**día de María** (rendido solo) y una abierta hoy de Pedro. Las rendiciones pasan por
`RendicionesService.rendir(..., null)`, la misma ruta que la API, no por números escritos a mano.
*Demo Restaurante*
también contrata Paquetería (ahí corren los e2e); *Demo Bodega* no, a propósito: es el tenant
donde el menú no la muestra. *Demo Restaurante* no trae tarifas de pago ni de envío en una base nueva (los e2e las crean): ahí
crear o escanear un paquete es 400 hasta cargar una por defecto de cada una. En una base que ya
existía antes de las tarifas de envío, la migración `PrecioEnLaLinea` le crea "Estándar" por
defecto con el precio de la configuración que tenía (así que ahí sí hay una de envío). IDs en el bloque `PAQUETERIA` del seeder (502-599; 580-583 las tarifas de pago, 584-586 las de envío, 590-594 las hojas, 595 la entrega de plata).

---

## Tarifas de pago

Tabla `tarifas_pago` por tenant (nombre, monto, `es_defecto`, `activa`); el diseño
original se borró al cerrarse el frente (queda en git). Reglas vigentes:

- Exactamente una por defecto y viva (índice único parcial); la **primera** que se crea lo es
  aunque no se pida. La por defecto no se desactiva ni se borra: se marca otra antes (400).
- Nombre único por tenant sin distinguir mayúsculas (409). Monto con la escala de la moneda oficial (400).
- Borrar es soft; una tarifa en uso por un repartidor o un paquete vivo no se borra (400): se desactiva.
- `repartidores.tarifa_pago_id` y `paquetes.tarifa_pago_id` son opcionales. Asignarlas exige una
  tarifa activa del tenant (`exigirActivaDelTenant`, 400), tomada `FOR SHARE` dentro de la
  transacción de quien escribe: `eliminar` la toma `FOR UPDATE` antes de mirar el uso, así uno de
  los dos espera al otro. La reciben el repartidor y el paquete (alta, edición y escaneo).
  En una **edición** solo se exige si la tarifa **cambia**: el formulario reenvía la que ya
  tiene, y una desactivada después no puede hacer fallar el cambio de otro campo.
- `LineaHoja.tarifaPaqueteId` es la tarifa propia del **paquete** (null = hereda), distinta de
  `tarifaPagoId`, que es la resuelta: la pantalla preselecciona la primera, y no calcula la regla.
- Qué tarifa se paga y cómo se fija en la línea: regla 10.

## Tarifas de envío

Tabla `tarifas_envio` por tenant, gemela de `tarifas_pago` (nombre, monto, `es_defecto`, `activa`;
mismas reglas de defecto único, nombre único, monto con la escala de la moneda, soft delete y
`exigirActivaDelTenant` con cerrojo). Diferencias: no hay nivel repartidor, y `paquetes.tarifa_envio_id`
es opcional (null = la por defecto). Borrar una en uso por un **paquete** vivo es 400 (se desactiva);
las líneas de hoja no cuentan, igual que con las de pago: copiaron su precio al entregar. Qué se
cobra y cómo se fija en la línea: regla 10b.

## API

Todo con `JwtAuthGuard + TenantGuard + TenantAdminGuard`; el `tenantId` sale del token; todo id
que entra se valida como UUID. Respuestas = proyecciones de `paqueteria.types.ts`, nunca la
entity.

```
GET|POST /tarifas-envio                    PATCH|DELETE /tarifas-envio/:id  (mismas reglas que las de pago)
GET|POST /tarifas-pago                     PATCH|DELETE /tarifas-pago/:id   (PATCH { esDefecto: true } pasa el defecto en una transacción)
GET|POST /repartidores                     PATCH|DELETE /repartidores/:id   (acepta `tarifaPagoId`, `null` la saca)
GET|POST /paquetes                         PATCH|DELETE /paquetes/:id
         POST|PATCH /paquetes aceptan `tarifaPagoId` y `tarifaEnvioId` (`null` la saca en el PATCH); ya no existen `pagoRepartidor` ni `precioEnvio`
         GET /paquetes: paginado en el servidor; filtros de estado, cobroEnDestino, datos por completar y búsqueda (código / destinatario)
POST     /hojas-ruta/escanear              { repartidorId, fecha, codigo, cobroEnDestino, tarifaPagoId?, tarifaEnvioId? } → { resultado, codigo, hoja }
POST     /hojas-ruta/asignar               { repartidorId, fecha, paqueteIds[] }
GET      /hojas-ruta?desde&hasta[&repartidorId]   lista con totales (dos consultas, sin N+1: las cabeceras y `totales` de las abiertas juntas)
GET      /hojas-ruta/resumen?desde&hasta   KPIs
GET      /hojas-ruta/:id                   cabecera + líneas
PATCH    /hojas-ruta/:id/paquetes/:paqueteId   { estado: 'entregado' | 'no_entregado' | 'en_ruta', medioCobro?: 'efectivo' | 'transferencia' }   (medioCobro solo con entregado y un paquete con cobro en destino: regla 12; en_ruta = deshacer un marcado por error, con la hoja abierta; la pantalla de la hoja tiene el botón «En ruta»)
POST     /hojas-ruta/:id/entregar-todos    pasa a entregado toda línea en_ruta (resuelve pago y precio de todas en una sentencia; cobros en efectivo)
DELETE   /hojas-ruta/:id/paquetes/:paqueteId   quitar de la hoja
GET      /hojas-ruta?pendientes=true[&repartidorId]   las hojas sin rendir (el rango pasa a ser opcional)
GET|POST /entregas-repartidor              ?repartidorId&pendientes=true   POST { repartidorId, fecha, monto, medio, nota? }
         PATCH|DELETE /entregas-repartidor/:id   (solo mientras no esté rendida: 400 si lo está; DELETE es soft)
GET      /rendiciones?desde&hasta[&repartidorId]   las rendiciones cuyas hojas tocan el rango (por la fecha de las hojas)
GET      /rendiciones/previa?repartidorId&hojaIds=a,b,c   la cuenta como quedaría, sin escribir (las mismas exigencias que rendir)
POST     /rendiciones                      { repartidorId, hojaIds[] } → 201 con el detalle (planilla); todo o nada
GET      /rendiciones/:id                  el detalle congelado
```

`POST /hojas-ruta/:id/rendir` **ya no existe** (404): rendir un solo día es elegir una sola hoja.

## Backend

Módulo `backend/src/modules/paqueteria/` (registrado en `app.module.ts`, también en `entities`;
migraciones `1792108344263-Paqueteria.ts`, `…-TarifasPago.ts`, `…-PagoEnLaLinea.ts`, `…-Rendiciones.ts`, `…-TarifasEnvio.ts` y `…-PrecioEnLaLinea.ts`).

| Tabla | Para qué | Restricciones |
|---|---|---|
| `tarifas_envio` | `nombre`, `monto`, `es_defecto`, `activa` | una por defecto viva por tenant; nombre único sin distinguir mayúsculas |
| `repartidores` | `nombre`, `telefono`, `activo` | — |
| `paquetes` | `codigo`, `destinatario_nombre`, `destinatario_telefono`, `direccion`, `comuna`, `nota` (nullable: el escaneo crea con solo el código), `remitente_tercero_id` → `terceros`, `cobro_en_destino`, `tarifa_pago_id` y `tarifa_envio_id` (opcionales) | `codigo` único por tenant entre los vivos |
| `hojas_ruta` | `repartidor_id`, `fecha` (`date`), `estado` (`abierta` \| `rendida`), `rendicion_id`, `rendida_por`, `rendida_el`, totales congelados, con el cobrado partido en `monto_cobrado_efectivo` y `monto_cobrado_transferencia` (nulos mientras está abierta) | única por `(tenant, repartidor, fecha)` entre las vivas |
| `rendiciones` | `repartidor_id`, `rendida_por` (null: el seed), `rendida_el`, totales congelados (`total_entregados`, cobrado en destino partido en efectivo y transferencia, `monto_pago_repartidor`, `monto_entregado_a_cuenta`) y `saldo` | solo lectura |
| `entregas_repartidor` | `repartidor_id`, `fecha` (`date`), `monto`, `medio`, `nota`, `registrada_por`, `rendicion_id` (null = pendiente) | `CHECK` `monto > 0` y `medio` en efectivo \| transferencia |
| `hoja_ruta_paquetes` | `hoja_ruta_id`, `paquete_id`, `estado` (`en_ruta` \| `entregado` \| `no_entregado`), `tarifa_pago_id`, `pago_repartidor`, `tarifa_envio_id`, `precio_envio` y `medio_cobro` (fijados al entregar; nulos si no está entregada; `tarifa_envio_id` también nulo en una entrega anterior a las tarifas de envío) | `CHECK` de la regla 12 y `entregado ⇔ precio_envio`; índice único parcial sobre `paquete_id` donde `estado = 'en_ruta'` y vivo: un paquete está en una sola ruta a la vez |

Servicios: `HojasRutaService` (escanear, asignar, marcar, quitar, `exigirRendibles`, `congelar`, totales),
`RendicionesService` (rendir, previa, lista, detalle), `EntregasRepartidorService`, `PaquetesService`,
`RepartidoresService`, `TarifasPagoService`, `TarifasEnvioService`. Toda `SELECT`/`JOIN`
filtra `tenant_id` y `eliminado_el IS NULL` **en cada tabla unida**.

## Frontend

Páginas en `frontend/app/pages/paquetes/` (`escanear.vue`, `index.vue`, `rutas/index.vue`,
`rutas/[id].vue`, `rendiciones/index.vue`, `rendiciones/nueva.vue`, `rendiciones/[id].vue`) y
`pages/configuracion/` (`repartidores.vue`, `paqueteria.vue`); lógica de
presentación en `composables/usePaqueteria.ts` y `useColaEscaneo.ts`.

- **Escanear** (`/paquetes/escanear`), la pantalla principal del día: repartidor y fecha arriba,
  el interruptor *Cobro en destino* y un campo que **conserva el foco** (vuelve a él tras cada
  escaneo y tras un clic en la pantalla, salvo sobre un control interactivo o mientras hay
  texto seleccionado; un menú o calendario abierto no se pisa), así la pistola tipea y da Enter sin tocar el mouse. Cada Enter
  llama a `escanear` y pinta el resultado en grande (verde asignado / amarillo ya escaneado /
  rojo rechazado, con el motivo). Mientras una llamada está en curso, el próximo Enter se
  **encola en orden** (`useColaEscaneo`): la pistola escanea más rápido que la red. Sin reintento
  automático: lo que falló lo repite quien escanea.
- **Debajo, la hoja del repartidor y el día elegidos:** el contador *"N asignados"* y *"M a
  cobrar en destino"*, y una fila por paquete (código, destinatario y
  dirección si los tiene) con su interruptor *Cobra en destino* (cambia el paquete al instante,
  con rollback si el servidor lo rechaza) y *Quitar* mientras la línea sigue en ruta y la hoja
  está abierta. Cada fila muestra además el **precio del envío, el pago al repartidor** (estimado
  mientras la línea no se entrega) **y la tarifa** del paquete, con un lápiz que abre un modal
  para cambiar el precio y elegir otra tarifa (un `USelect`; *Según repartidor* la quita) solo
  para ese paquete (`PATCH
  /paquetes/:id`; la regla 7 sigue valiendo en el backend). Lo pidió el owner el 2026-10-16, solo
  para esta pantalla (en el detalle de la hoja no se editan montos). El modal con botón —y Enter
  que no guarda— es decisión de diseño: un campo de monto con el foco recibiría lo que tipee la
  pistola. El lápiz aparece en toda línea de una hoja abierta, también `entregado` y
  `no_entregado`, a diferencia de *Quitar* y del interruptor (solo `en_ruta`): corregir un monto
  antes de rendir es justo el caso de una línea ya marcada. Con entregados en la hoja, después de
  guardar se relee la hoja para los totales (descartada si mientras tanto llegó una más nueva).
  Una hoja rendida se muestra bloqueada, sin lápiz. El **neto a rendir no se muestra mientras
  se escanea**: solo cuando hay entregados y no queda nada en ruta (`textoResumenNeto`), porque
  el neto del servidor suma solo lo entregado y uno parcial se leería como el de la rendición.
- **La lista de rechazados es persistente en pantalla:** un rechazo queda hasta que alguien lo
  descarta (uno a uno o *limpiar*), porque el mensaje en grande dura un parpadeo y se perdería
  en el ritmo de la pistola. Vive en memoria de la pestaña: recargar la pantalla la vacía.
- **En vivo se muestra la CANTIDAD de paquetes con cobro en destino, no el monto**
  (decisión de la sesión, 2026-10-15). Sumar `precioEnvio` de las líneas en ruta en el cliente
  sería regla de negocio y plata en la página; el monto aparece en el detalle de la hoja al
  marcar entregas. Si el owner quiere ver "$ a cobrar si entrega todo" mientras escanea hace
  falta un campo nuevo del backend (anotado en fase 2).
- **Paquetes** (`/paquetes`): tabla con búsqueda y filtros (incluido *datos por completar*);
  *Nuevo paquete* con los montos precargados con los defaults; selección múltiple de disponibles
  → *Asignar a repartidor*. El selector de *Remitente* solo aparece (y `GET /terceros` solo se
  pide) si el usuario tiene `Terceros:Leer`: en un tenant que solo contrató Paquetería sería un
  403 en cada carga.
- **Rutas** (`/paquetes/rutas`): `AppRangoFechas`, las cinco tarjetas de KPI del rango y una fila
  por hoja. **Detalle** (`/paquetes/rutas/:id`): totales con el neto destacado; cada paquete con
  *Entregado* (en un paquete con cobro: *Entregado en efectivo* y *Entregado por transferencia*) /
  *No entregado* / *En ruta* (deshace un marcado por error) / *Quitar*; *Marcar todos entregados*
  (en efectivo); *Rendir a <repartidor>* es un enlace a la pantalla de rendición y nunca se
  deshabilita: ahí, la hoja que todavía tiene algo en ruta (o ningún paquete) no se puede tildar.
- **Rendiciones** (`/paquetes/rendiciones`): las ya cerradas por rango de fechas. **Nueva**
  (`/paquetes/rendiciones/nueva?repartidorId=…`): las hojas sin rendir del repartidor (marcadas
  las que se pueden; una con paquetes en ruta, o sin ninguno, no entra), sus entregas de plata (*Anotar*,
  *Corregir*, *Anular*) y la **cuenta como quedaría**, que se vuelve a pedir (`/rendiciones/previa`)
  en cada cambio; *Rendir* pide confirmación con el saldo. La pantalla que sigue muestra lo que
  devolvió el POST, no la previa: si alguien anotó una entrega en el medio, el monto final es
  el del servidor. **Planilla** (`/paquetes/rendiciones/:id`, sin layout para imprimir): una fila
  por día con el conteo por tarifa, el pago y el cobrado por medio, las entregas a cuenta y el
  saldo en grande.
- **Configuración → Paquetería:** Repartidores (CRUD, activo/inactivo, tarifa propia) y Valores
  por defecto (el precio de envío y, en la misma pantalla, las tarifas de pago: alta, edición y
  cuál es la por defecto).

## Testing

```bash
cd backend && npm test -- modules/paqueteria
cd backend && npm run test:e2e -- paqueteria.e2e-spec     # totales, escaneo, flujo, bloqueos, 403, aislamiento
cd frontend && npm test
cd frontend && npm run e2e -- paqueteria                  # escanear → marcar → entrega de plata → rendir (Playwright, stack propio)
```

El Playwright simula la pistola tipeando el código + Enter en el campo. Como *Demo Restaurante*
no trae tarifas, cada test crea las suyas con nombre propio y un repartidor propio, y lee la
planilla anclada a su `data-qa`; además compara el saldo de la pantalla con el que quedó
congelado en `GET /rendiciones/:id`.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| El backend no exige el contrato del módulo | Un admin de un tenant que no lo contrató usa la API | Borde comercial, no de aislamiento; fase 2 |
| Un lock fuera de orden | Deadlock entre escaneo, edición, rendir y borrar repartidor | El orden de arriba; documentado en `HojasRutaService` |

## Related Features

- [pagos.md](./pagos.md) y [gestion-cajas.md](./gestion-cajas.md): la rendición **no** entra a una Caja (fase 2).
- [impuestos.md](./impuestos.md) y [emision-electronica.md](./emision-electronica.md): el envío no emite documento tributario; sería un frente fiscal propio.
