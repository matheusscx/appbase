# Feature: Paquetería (repartidores, hojas de ruta y rendición)

**Status**: Complete (MVP)
**Owner**: Cesar Matheus
**Last Updated**: 2026-10-15

---

## Overview

### ¿Qué es?

Un módulo para una empresa de reparto (mayormente paquetes de Mercado Libre). La oficina da de
alta a sus **repartidores** (una ficha, sin login), **escanea con pistola** los paquetes que cada
uno se lleva en el día —eso arma su **hoja de ruta**—, marca cada uno como entregado o no
entregado, y al final del día **rinde** la hoja: el sistema congela cuánta plata cobró el
repartidor en destino, cuánto se le paga y cuánto debe entregar (o se le debe).

### ¿Por qué existe?

Es un MVP para mostrarle a un cliente de reparto. Es un módulo de este SaaS y no una app aparte
para no rehacer login ni deploy, y no migrar si el cliente compra. **No es un frente fiscal**: el
envío no emite documento tributario.

### Alcance

- Esta versión: los dos valores por defecto, CRUD de repartidores y de paquetes, escaneo que
  crea y asigna, asignación masiva, marcar entregado / no entregado, rendir la hoja, KPIs por
  rango de fechas y un tenant demo.
- Fase 2 (no existe): [`desarrollo-nuevo.md`](../agent/desarrollo-nuevo.md) § *Paquetería — fase 2*.

### Decisiones de diseño (owner, 2026-10-15)

Cada punto lo eligió el owner con su costo a la vista; esto es lo que quedó y lo que se descartó.

| Decisión | Elegida | Descartada, y por qué |
|---|---|---|
| Dónde vive | Módulo de este SaaS | App aparte: rehacer login y deploy, y migrar si el cliente compra |
| Repartidor | Ficha que maneja la oficina, sin login | Usuario propio con pantalla móvil: suma rol, permisos y UI |
| Paquete no entregado | `en_ruta → entregado \| no_entregado`; solo lo entregado suma | Asignar = pagar (un rechazo descuadra la rendición); pagar la visita igual |
| Qué cobra en destino | Solo el envío | Envío + valor del producto (contrarreembolso con plata de un tercero) |
| Valores por defecto | Uno por empresa, override por paquete | Tarifa por repartidor; precio por comuna (fase 2) |
| Rendición | "Rendir" cierra la hoja y congela los totales; no pasa por Caja | Solo mirar el cálculo; entrar a una Caja (toca cajas: frente aparte) |
| Datos del paquete | Código obligatorio; destinatario, dirección y remitente opcionales | Dirección obligatoria: frena el escaneo, que crea el paquete con solo el código |
| Carga | Escaneo que crea y asigna; además alta uno a uno y asignación masiva | Importar CSV/Excel |
| Lector | Pistola USB/Bluetooth (tipea el código + Enter) | Cámara del celular: dependencia nueva o API que no anda en iPhone |
| Código que no existe | Se crea con solo el código y los defaults, y se asigna | Rechazarlo (obliga a cargar antes); mini-formulario (frena el ritmo) |
| Cobro en destino al escanear | Interruptor fijo en la pantalla, vale para los escaneos siguientes; cada fila se cambia | Todos pagados (o todos con cobro) y marcar después: un olvido descuadra la rendición |
| Modelo | Hoja de ruta (repartidor + día) con sus paquetes | Todo en el paquete (reasignar pisa el intento anterior y cambia reportes ya rendidos); intentos sin cabecera ("el día de Juan" no existe como cosa) |
| Acceso | Todo con `TenantAdminGuard` | Sin guard: viola la invariante 6 (un cajero rendiría hojas por API) |
| Tenant demo | "Demo Gestión de Paquetes" con su admin propio y Paquetería como único módulo; el menú del admin muestra solo lo contratado | Sembrar en Demo Restaurante (el cliente vería un POS de restaurante); tenant propio con el menú de hoy (vería módulos que le dan 403) |
| Total general | Σ `precio_envio` de todos los entregados, con o sin cobro en destino | — |

---

## Reglas

Las numeraciones (`regla 5b`, `3.1`) son las que citan los comentarios del código.

1. **Defaults copiados, no referenciados.** El paquete nace con los montos de
   `paquete_configuracion` (el cliente puede mandar otros). Cambiar el default no mueve los
   paquetes existentes.
2. **El estado del paquete se deriva de sus líneas**, no se guarda: *entregado* si tiene una
   línea `entregado`; *en ruta* si tiene una `en_ruta`; *disponible* en cualquier otro caso
   (nunca salió, o todos sus intentos fueron `no_entregado`).
3. **Solo lo entregado suma.** Un `no_entregado` no aporta cobro ni pago al repartidor, y el
   paquete vuelve a quedar disponible para otra hoja sin borrar el intento anterior.
4. **Totales de una hoja:** `asignados` (líneas), `entregados`, `cobro_destino` (cantidad de
   entregados con cobro en destino), `monto_cobrado_destino` (Σ `precio_envio` de esos),
   `monto_pago_repartidor` (Σ `pago_repartidor` de los entregados), `monto_total_general`
   (Σ `precio_envio` de todos los entregados) y `neto_a_rendir` = cobrado − pago. Un neto
   negativo es que la empresa le debe al repartidor, y la pantalla lo dice así.
5. **Asignar** (`repartidorId`, `fecha`, `paqueteIds[]`) crea la hoja de ese repartidor ese día o
   suma a la existente. 400 si la hoja está rendida, si el repartidor está inactivo o si algún
   paquete no está disponible (todo o nada, con la lista de los que fallaron).
   **5b. Escanear** resuelve **un** código por llamada (cada escaneo es independiente) y
   devuelve `{ resultado, codigo, hoja }`:
   - `asignado_nuevo`: el código no existía → se crea con solo el código, los dos defaults y el
     `cobroEnDestino` del interruptor, y se asigna;
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
6. **Rendir** bloquea la hoja (`FOR UPDATE`), exige que no quede línea `en_ruta` y que la hoja
   tenga paquetes, congela los totales y anota quién y cuándo. Una hoja rendida es de solo
   lectura: no admite asignar, marcar ni quitar.
7. **Editar un paquete:** se puede mientras no esté *entregado en una hoja rendida*; desde ahí
   montos y `cobro_en_destino` son de solo lectura (cambiarlos movería una rendición cerrada).
   La dirección y el destinatario sí se pueden completar.
8. **Borrar un paquete** (soft) solo si **nunca salió** en una hoja (un `no_entregado` también es
   historia de una hoja). **Quitar de la hoja** (soft sobre la línea) solo con la línea
   `en_ruta` y la hoja abierta.
9. **Desactivar un repartidor** no toca sus hojas: solo lo saca del selector. **Borrar** uno con
   hojas es 400 (se desactiva): así ninguna hoja apunta a un repartidor borrado y ninguna
   lectura necesita una excepción al filtro `eliminado_el IS NULL`.
10. **Sin configuración guardada**, escanear un código nuevo o dar de alta un paquete sin montos
    es 400: no se crean paquetes a $0.
11. **Plata que entra por la API:** validada en el DTO contra los decimales de la moneda oficial
    ([`patterns/backend.md`](../patterns/backend.md) § 3.1); lo que no cabe es 400. Montos ≥ 0.
    Plata en `numeric(18,4)` en la moneda oficial del tenant, con Decimal.js.

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
| Total a pagar a repartidores | Σ `pago_repartidor` de los entregados |

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
método privado `congelar` de `HojasRutaService`, que usan `rendir` (con el usuario del token) y
`congelarTotales`, su envoltorio público que llama el seed de la demo (sin usuario): lo
congelado y lo calculado no pueden diferir. **Precondición** de ambos: quien llama tiene la hoja
bloqueada (`FOR UPDATE`) dentro de su transacción. `congelar` se defiende solo de lo que
quedaría mal: una hoja ya rendida (400) y una con líneas `en_ruta` (400: rendida, esa línea no
se podría marcar ni soltar nunca más). La hoja rendida lee sus columnas congeladas; la abierta, el cálculo en vivo.

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
  los paquetes; **marcar** toma la hoja y después el paquete; **entregar-todos**, **quitar** y
  **rendir** toman solo la hoja.
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
superadmin) y Paquetería como único módulo. Defaults $10.000 / $5.000, 3 repartidores, 30
paquetes con códigos con forma de Mercado Libre (mezcla de pagados y con cobro en destino), dos
hojas rendidas en días anteriores y una abierta hoy. Las rendidas se congelan con
`congelarTotales(tenantId, hojaId, null)`, no con números escritos a mano. *Demo Restaurante*
también contrata Paquetería (ahí corren los e2e); *Demo Bodega* no, a propósito: es el tenant
donde el menú no la muestra. IDs en el bloque `PAQUETERIA` del seeder (502-589).

---

## Tarifas de pago

Tabla `tarifas_pago` por tenant (nombre, monto, `es_defecto`, `activa`); diseño en
`docs/superpowers/specs/2026-10-16-cuenta-del-repartidor-design.md` § 1. Reglas ya vigentes:

- Exactamente una por defecto y viva (índice único parcial); la **primera** que se crea lo es
  aunque no se pida. La por defecto no se desactiva ni se borra: se marca otra antes (400).
- Nombre único por tenant sin distinguir mayúsculas (409). Monto con la escala de la moneda oficial (400).
- Borrar es soft; una tarifa en uso por un repartidor o un paquete vivo no se borra (400): se desactiva.
- `repartidores.tarifa_pago_id` y `paquetes.tarifa_pago_id` son opcionales. Asignarlas exige una
  tarifa activa del tenant (`exigirActivaDelTenant`, 400). Hoy solo el repartidor la recibe por la
  API; el paquete y el cálculo del pago llegan con la tarea siguiente (`pago_repartidor` sigue vigente).

## API

Todo con `JwtAuthGuard + TenantGuard + TenantAdminGuard`; el `tenantId` sale del token; todo id
que entra se valida como UUID. Respuestas = proyecciones de `paqueteria.types.ts`, nunca la
entity.

```
GET|PUT  /paquetes/configuracion
GET|POST /tarifas-pago                     PATCH|DELETE /tarifas-pago/:id   (PATCH { esDefecto: true } pasa el defecto en una transacción)
GET|POST /repartidores                     PATCH|DELETE /repartidores/:id   (acepta `tarifaPagoId`, `null` la saca)
GET|POST /paquetes                         PATCH|DELETE /paquetes/:id
         GET /paquetes: paginado en el servidor; filtros de estado, cobroEnDestino, datos por completar y búsqueda (código / destinatario)
POST     /hojas-ruta/escanear              { repartidorId, fecha, codigo, cobroEnDestino } → { resultado, codigo, hoja }
POST     /hojas-ruta/asignar               { repartidorId, fecha, paqueteIds[] }
GET      /hojas-ruta?desde&hasta[&repartidorId]   lista con totales (dos consultas, sin N+1: las cabeceras y `totales` de las abiertas juntas)
GET      /hojas-ruta/resumen?desde&hasta   KPIs
GET      /hojas-ruta/:id                   cabecera + líneas
PATCH    /hojas-ruta/:id/paquetes/:paqueteId   { estado: 'entregado' | 'no_entregado' | 'en_ruta' }   (en_ruta = deshacer un marcado por error, con la hoja abierta; la pantalla de la hoja tiene el botón «En ruta»)
POST     /hojas-ruta/:id/entregar-todos    pasa a entregado toda línea en_ruta
DELETE   /hojas-ruta/:id/paquetes/:paqueteId   quitar de la hoja
POST     /hojas-ruta/:id/rendir
```

## Backend

Módulo `backend/src/modules/paqueteria/` (registrado en `app.module.ts`, también en `entities`;
migración `1792108344263-Paqueteria.ts`).

| Tabla | Para qué | Restricciones |
|---|---|---|
| `paquete_configuracion` | `precio_envio_defecto`, `pago_repartidor_defecto` | única por tenant |
| `repartidores` | `nombre`, `telefono`, `activo` | — |
| `paquetes` | `codigo`, `destinatario_nombre`, `destinatario_telefono`, `direccion`, `comuna`, `nota` (nullable: el escaneo crea con solo el código), `remitente_tercero_id` → `terceros`, `cobro_en_destino`, `precio_envio`, `pago_repartidor` | `codigo` único por tenant entre los vivos |
| `hojas_ruta` | `repartidor_id`, `fecha` (`date`), `estado` (`abierta` \| `rendida`), `rendida_por`, `rendida_el`, totales congelados (nulos mientras está abierta) | única por `(tenant, repartidor, fecha)` entre las vivas |
| `hoja_ruta_paquetes` | `hoja_ruta_id`, `paquete_id`, `estado` (`en_ruta` \| `entregado` \| `no_entregado`) | índice único parcial sobre `paquete_id` donde `estado = 'en_ruta'` y vivo: un paquete está en una sola ruta a la vez |

Servicios: `HojasRutaService` (escanear, asignar, marcar, quitar, rendir, totales),
`PaquetesService`, `RepartidoresService`, `PaqueteConfiguracionService`. Toda `SELECT`/`JOIN`
filtra `tenant_id` y `eliminado_el IS NULL` **en cada tabla unida**.

## Frontend

Páginas en `frontend/app/pages/paquetes/` (`escanear.vue`, `index.vue`, `rutas/index.vue`,
`rutas/[id].vue`) y `pages/configuracion/` (`repartidores.vue`, `paqueteria.vue`); lógica de
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
  está abierta. Cada fila muestra además el **precio del envío y el pago al repartidor** del
  paquete, con un lápiz que abre un modal para cambiarlos solo para ese paquete (`PATCH
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
- **Rutas** (`/paquetes/rutas`): `AppRangoFechas`, las cuatro tarjetas de KPI del rango y una fila
  por hoja. **Detalle** (`/paquetes/rutas/:id`): totales con el neto destacado; cada paquete con
  *Entregado* / *No entregado* / *En ruta* (deshace un marcado por error) / *Quitar*; *Marcar todos entregados*; **Rendir** con un modal que
  dice *"Juan entrega $50.000"* o *"Se le pagan $X"*, bloqueado mientras quede algo en ruta.
- **Configuración → Paquetería:** Repartidores (CRUD, activo/inactivo) y Valores por defecto.

## Testing

```bash
cd backend && npm test -- modules/paqueteria
cd backend && npm run test:e2e -- paqueteria.e2e-spec     # totales, escaneo, flujo, bloqueos, 403, aislamiento
cd frontend && npm test
cd frontend && npm run e2e -- paqueteria                  # escanear → marcar → rendir (Playwright, stack propio)
```

El Playwright simula la pistola tipeando el código + Enter en el campo.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| El backend no exige el contrato del módulo | Un admin de un tenant que no lo contrató usa la API | Borde comercial, no de aislamiento; fase 2 |
| Un lock fuera de orden | Deadlock entre escaneo, edición, rendir y borrar repartidor | El orden de arriba; documentado en `HojasRutaService` |

## Related Features

- [pagos.md](./pagos.md) y [gestion-cajas.md](./gestion-cajas.md): la rendición **no** entra a una Caja (fase 2).
- [impuestos.md](./impuestos.md) y [emision-electronica.md](./emision-electronica.md): el envío no emite documento tributario; sería un frente fiscal propio.
