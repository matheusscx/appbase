# Diseño: el repartidor entrega desde su teléfono

**Status**: Draft · **Date**: 2026-10-16 · **Owner**: Cesar Matheus

Fase 2 de Paquetería ([`features/paqueteria.md`](../../features/paqueteria.md); entrada
*Login del repartidor* de [`desarrollo-nuevo.md`](../../agent/desarrollo-nuevo.md)). Lo decidido
por el owner va marcado **(owner)**; lo que decidí yo para que el diseño cierre va marcado
**(mi decisión)** y se puede revisar.

## Intención

El cliente es una empresa de reparto de paquetes de Mercado Libre. Hoy la oficina escanea los
paquetes de cada repartidor, y al volver el repartidor la oficina marca qué se entregó y rinde la
hoja. Lo que se quiere es que **el repartidor cierre cada entrega en el momento, desde su
teléfono**, y que quede una **prueba de que la entregó** para cuando haya un reclamo del
destinatario o de Mercado Libre **(owner)**.

### Cómo se usa (owner)

En el domicilio, el repartidor abre Venka en el teléfono, escanea el QR del paquete con la
cámara y se abre la ficha:

- **Entregado**, con una **foto opcional** de la entrega. Si el paquete es con cobro en destino,
  el botón dice **"Entregado y cobrado $10.000"** (entregar y cobrar son siempre lo mismo) y el
  repartidor elige **efectivo o transferencia** a su cuenta: las dos cuentan igual en lo que
  debe (owner, 2026-10-16; el modelo vive en
  [`2026-10-16-cuenta-del-repartidor-design.md`](2026-10-16-cuenta-del-repartidor-design.md),
  que se construye antes).
- **No entregado**, con un **motivo de una lista fija del sistema** y un **comentario opcional**.

La oficina ve, en la hoja de ruta, el motivo, el comentario y la foto de cada entrega.

### Metas

1. El repartidor tiene su propio usuario (correo y contraseña, el login que ya existe) y ve
   **solo su hoja**.
2. Cierra cada paquete escaneándolo con la cámara del teléfono, en Android y en iPhone.
3. Cada no entrega dice por qué; cada entrega puede tener su foto.
4. La rendición sigue igual: mismas cuentas, misma pantalla de la oficina.

### No metas (esta versión)

- Guardar la ubicación GPS de la entrega (owner, 2026-10-16: para después).
- Que el cliente edite la lista de motivos (owner: fija en el sistema por ahora).
- Funcionar sin señal: guardar entregas offline y sincronizar después.
- Navegación, mapa o ruta optimizada.
- Que el repartidor rinda, escanee para asignarse paquetes o vea otras hojas.
- Firma del destinatario.
- Borrado automático de fotos viejas.

### Anti-metas (si pasa esto, falló aunque funcione)

- Un repartidor puede ver o cambiar un paquete que no es de su hoja, aunque sea por la API.
- La rendición da un número distinto al de hoy para la misma hoja.
- Una foto que no subió deja el paquete sin marcar, o lo marca dos veces.
- El repartidor tiene que abrir la cámara de nuevo para cada paquete.

## Restricciones del repo que mandan

- Invariantes de `CLAUDE.md`: `tenant_id` sale del token; plata con Decimal.js; soft delete;
  **permisos con guard real en el backend** (invariante 6), que es lo que esta fase agrega al
  módulo.
- Las cuentas de una hoja salen de **una sola consulta**, `HojasRutaService.totales`; esta fase no
  la toca.
- El **orden de bloqueo** de Paquetería (repartidor `FOR SHARE` → hoja `FOR UPDATE` → paquetes)
  vale también para lo que marque el repartidor.
- Toda dependencia nueva la aprueba el owner antes de instalarla.
- Toda tarea de frontend invoca las skills `nuxt-ui` y `frontend-design`.
- Sin reintento automático: si algo falla, la app lo dice y el usuario reintenta.

## Lo que hay hoy (relevado el 2026-10-16)

- Todo Paquetería es `JwtAuthGuard + TenantGuard + TenantAdminGuard`: un no admin recibe 403.
- `Paquetería` tiene un solo permiso, `Leer`, que solo lee el menú (seeder, `modulo_app_permisos`).
  `PermisosGuard` + `@RequiresPermiso` existen y recorren `roles → tenant_modulos → permisos`, así
  que un permiso nuevo exige además que el tenant tenga el módulo contratado.
- Crear un usuario del tenant: `POST /tenants/usuarios` (admin) recibe `correo`, `nombre` y
  `rolIds`, **sin contraseña**: el usuario recibe un correo de invitación y elige su contraseña en
  `/auth/invitacion/:token`. Si el correo ya tiene cuenta, recibe un correo de confirmación.
- Precedente de ficha operativa enlazada a un usuario: **garzones** (`garzones.usuario_id`,
  índice único parcial por tenant, `GET /garzones/mi-vinculo`; `removeMember` trata al garzón
  enlazado).
- El login aterriza en `/` para todos; no hay aterrizaje por rol. Hay un solo layout
  (`dashboard`).
- **No hay** subida de archivos, almacenamiento de objetos, cámara ni lector de QR en el repo.
- La línea de la hoja (`hoja_ruta_paquete`) tiene `estado` y no guarda motivo, comentario, foto,
  quién ni cuándo.

## Diseño

Son tres partes que se construyen en este orden; cada una sirve sola.

### Parte 1 — Acceso del repartidor y su pantalla

**Dar y quitar acceso.**
- La ficha del repartidor (`configuracion/repartidores`) suma **"Darle acceso"**: la oficina
  escribe el correo y Venka crea el usuario con el flujo de invitación que ya existe (el
  repartidor elige su contraseña desde el correo) y lo enlaza a la ficha. **(mi decisión:** el
  owner pidió "lo más práctico con correo y contraseña"; el admin no fija contraseñas en ningún
  lado del sistema y no conviene abrir eso acá.)
- `repartidores.usuario_id` nullable, único por tenant mientras esté vivo (mismo patrón que
  garzones). Se enlaza **al dar el acceso**, aunque la invitación no esté aceptada todavía; la
  ficha muestra el estado: sin acceso / invitación enviada / con acceso. Un mismo usuario puede
  ser repartidor en dos tenants (una ficha en cada uno). **(mi decisión)**
- "Darle acceso" solo existe si el tenant tiene Paquetería contratada (sin el módulo, la pantalla
  de repartidores ni aparece). El rol del tenant demo lleva un ID fijo del seed.
- **"Quitar acceso"** saca al usuario del tenant (`removeMember`) y desenlaza la ficha; la ficha y
  sus hojas quedan. `removeMember` sobre un usuario enlazado a un repartidor lo desenlaza también
  (igual que hace con el garzón). Desactivar al repartidor deja su usuario sin hojas que ver.
- **Rol "Repartidor"**: un rol de sistema por tenant, con un permiso nuevo
  **`Paquetería:Entregar`** (fila nueva en `modulo_app_permisos`). Se crea al dar el primer acceso
  si no existe. **(mi decisión:** el detalle de cómo se siembra queda al builder, mientras el
  rol no se pueda borrar ni quedar sin el permiso.)

**API del repartidor** — un controller aparte (`/mi-ruta`), con
`JwtAuthGuard + TenantGuard + PermisosGuard` y `@RequiresPermiso('Paquetería', 'Entregar')`. El
repartidor se resuelve del usuario del token (`repartidores.usuario_id`), **nunca** de un
parámetro. Toda línea que se lee o escribe se filtra por la hoja de **ese** repartidor; una línea
de otro es 404, no 403 (no confirma que existe).

```
GET   /mi-ruta?fecha                 su hoja abierta de ese día (por defecto hoy) con sus líneas
POST  /mi-ruta/buscar { codigo }     resuelve el QR (normalizarCodigoPaquete) a una línea de su hoja
PATCH /mi-ruta/paquetes/:paqueteId   { estado: 'entregado' } | { estado: 'no_entregado', motivo, comentario? }
```

- **Qué hojas ve.** Hay una hoja por repartidor y día (índice único `tenant + repartidor + fecha`).
  `GET /mi-ruta` devuelve **todas sus hojas abiertas**, la de hoy primero (una de un día
  anterior que la oficina no rindió sigue apareciendo). `buscar` mira en todas: un paquete está
  `en_ruta` en una sola línea a la vez. **(mi decisión)**
- Cada línea muestra código, destinatario, dirección y, si es con cobro en destino, **el monto a
  cobrar** (`precio_envio`). **(mi decisión:** no ve `pago_repartidor` ni los totales de la
  hoja; lo que gana lo ve la oficina al rendir.)
- Escanear un código que no está en su hoja dice qué pasa (*"Este paquete no está en tu hoja de
  hoy"*); no crea ni asigna nada: asignar sigue siendo de la oficina.
- El monto a cobrar es **fijo**: el repartidor no escribe ningún monto, solo elige efectivo o
  transferencia (`medio_cobro` de la línea, del diseño de la cuenta). "Entregado y cobrado" es
  el mismo `entregado` de hoy **(owner: entregar y cobrar es siempre
  lo mismo)**.
- Mientras la hoja esté **abierta**, el repartidor puede corregir lo que marcó (entregado ↔ no
  entregado, o volver a en ruta). Con la hoja rendida, todo es solo lectura. **(mi decisión,**
  la misma regla que ya tiene la oficina.)
- Marcar respeta el orden de bloqueo: hoja `FOR UPDATE` → paquete.
- **Oficina y repartidor sobre la misma línea:** los dos pueden marcarla mientras la hoja esté
  abierta; el cerrojo de la hoja los ordena y gana el último. `marcado_por` dice quién fue. La
  oficina puede corregir lo que marcó el repartidor. **(mi decisión)**
- **Rendir no cambia:** sigue exigiendo que no quede ninguna línea `en_ruta`. Lo que el
  repartidor no cerró lo cierra la oficina (con motivo) antes de rendir. Después de rendida, el
  repartidor ya no puede marcar: su pantalla muestra la hoja como cerrada.

**Motivos de no entrega (owner: lista fija; mi decisión: los textos).**

| Clave | Texto |
|---|---|
| `nadie` | No había nadie |
| `direccion` | Dirección incorrecta o incompleta |
| `rechazado` | El destinatario lo rechazó |
| `sin_acceso` | No se pudo acceder (condominio o portería) |
| `otro` | Otro |

- Con `otro`, el comentario es **obligatorio** **(mi decisión:** "Otro" sin comentario no dice
  nada). Con los demás, opcional. Comentario hasta 500 caracteres.
- La lista vive en el código (tipo + `CHECK` en la base), no en una tabla.
- `hoja_ruta_paquete` suma `motivo_no_entrega`, `comentario`, `marcado_por` (usuario) y
  `marcado_el`. Volver a `en_ruta` o a `entregado` limpia motivo y comentario.
- **La oficina también elige el motivo** al marcar "No entregado" desde la hoja de ruta **(mi
  decisión:** si solo lo exige el teléfono, la mitad de los no entregados quedan sin motivo y el
  dato no sirve). Cambia `PATCH /hojas-ruta/:id/paquetes/:paqueteId` y su pantalla.

**La pantalla (`/mi-ruta`).**
- Layout propio, de una columna, pensado para el teléfono y para una mano; sin el menú lateral de
  la oficina.
- Un admin que además reparte (el dueño que entrega) tiene su ficha enlazada y ve una entrada
  "Mi ruta" en el menú. **(mi decisión)**
- Tras el login, un usuario cuyo único acceso es `Paquetería:Entregar` aterriza en `/mi-ruta` en
  vez de `/` (hoy vería un Inicio vacío).
- Arriba, lo que falta: *"Te quedan 12 de 30"* y cuánto lleva cobrado (efectivo y transferencia). Abajo, la lista,
  con los pendientes primero. Tocar una fila abre la ficha; la ficha tiene los dos botones.
- En esta parte se llega a la ficha tocando la fila o escribiendo el código; la cámara llega en
  la parte 2.

### Parte 2 — Escanear con la cámara del teléfono

- Un botón **"Escanear"** abre la cámara trasera **una sola vez** y queda abierta: cada QR que
  lee abre la ficha de ese paquete; al cerrar la ficha, la cámara sigue. El mismo QR no se lee
  dos veces seguidas mientras siga en cuadro.
- Vibra al leer (donde el teléfono lo permite).
- Tiene que andar en **Android y iPhone, en Chrome y Safari** (owner). Chrome en Android trae
  `BarcodeDetector`; iOS no (tampoco Chrome en iOS, que usa WebKit). Por eso hace falta una
  **librería de lectura de QR** como respaldo — **dependencia nueva: la aprueba el owner** con
  nombre y peso a la vista. Candidatas a evaluar: el polyfill `barcode-detector` (misma API que
  el nativo, sobre `zxing-wasm`) o `qr-scanner`. Que el código de la librería se cargue solo al
  abrir la cámara, no con la app.
- La cámara del navegador exige https (Railway lo es) y el permiso del teléfono; si se niega, la
  pantalla dice cómo habilitarlo y sigue funcionando con la búsqueda por código.

### Parte 3 — Foto de la entrega

- En la ficha, después de **Entregado**, un botón **"Agregar foto"** abre la cámara del teléfono
  (`<input type="file" accept="image/*" capture="environment">`). **(mi decisión:** solo cámara,
  no galería; una foto elegida de la galería prueba menos. El atributo `capture` no lo garantiza
  en todos los teléfonos: es una preferencia, no un control.)
- **Marcar y subir la foto son dos pasos**: primero queda entregado (una llamada chica), después
  sube la foto. Si la foto falla, el paquete ya está entregado y la fila muestra "Foto sin subir —
  Reintentar". Así una foto que no sube nunca deja el paquete sin marcar ni lo marca dos veces.
- La foto se **achica en el teléfono** antes de subir (lado mayor ~1280 px, JPEG, apuntando a
  ~200 KB), porque se sube con datos móviles.
- Se guarda en un **bucket de objetos** (Railway ofrece buckets compatibles con S3) — **otra
  dependencia nueva, la aprueba el owner** (el cliente S3 de AWS o equivalente). La subida entra
  por el backend (`multipart`, que NestJS ya trae con `platform-express`), que valida tipo y tamaño,
  y escribe en el bucket; la base guarda solo la referencia (`foto_clave`, `foto_subida_el`) en la
  línea.
- Una foto por entrega; subir otra la reemplaza. Solo con la hoja abierta. Si la línea deja de
  estar entregada, la foto queda guardada pero no se muestra; vuelve a verse si se marca
  entregada de nuevo. **(mi decisión:** una prueba no se borra por un cambio de estado.)
- **Desarrollo y CI:** el almacenamiento va detrás de una interfaz chica, con un adaptador a
  disco local para docker-compose y los e2e, y el de bucket para Railway. **(mi decisión:** así
  ni el compose ni el CI necesitan un servicio S3.)
- Ver la foto: la oficina la abre desde la hoja de ruta; el backend la sirve con el guard del
  admin (y al repartidor, la suya). La foto nunca es pública por URL.
- **Retención:** no se borra sola en esta versión **(mi decisión)**; queda anotado.

### Datos del demo

- Un repartidor del tenant demo con acceso ya activo (correo verificado, contraseña del seed),
  para mostrar la pantalla sin pasar por el correo de invitación.
- Algunas líneas de las hojas rendidas con motivo y comentario de no entrega.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El correo de invitación no llega en Railway | Verificar el envío en el demo antes de la parte 1; el repartidor del seed no lo necesita |
| Calle sin señal | Esta versión exige conexión; el error lo dice y el repartidor reintenta. Offline queda como no meta |
| La librería de QR pesa en el teléfono | Cargarla solo al abrir la cámara |
| Fotos que llenan el bucket | ~200 KB por foto; medir el volumen real antes de decidir retención |
| Un repartidor que alcanza datos de otro | Guard por permiso + filtro por su hoja en cada consulta + e2e con dos repartidores |

## Lo que queda al builder

- Cómo se siembra y protege el rol "Repartidor".
- La forma exacta de las respuestas de `/mi-ruta` (proyecciones en `paqueteria.types.ts`).
- El nombre de las columnas y la migración (ADR-030).
- Cuál librería de QR y cuál cliente S3 proponerle al owner, con peso y mantenimiento.
- El diseño visual de `/mi-ruta`, dentro del design system.
