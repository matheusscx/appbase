# Feature: Gestión de Garzones (PIN operativo)

**Status**: Complete
**Owner**: Cesar Matheus
**Last Updated**: 2026-08-14 (el PIN del garzón con cuenta es suyo: lo fija él, el encargado invalida)

---

## Overview

### ¿Qué es?

Registro de **garzones** por tenant, cada uno con un **PIN secreto de 6 dígitos**.
En un restaurante, uno o más dispositivos (tablet/tótem) son compartidos por todos
los garzones. En vez de iniciar/cerrar sesión con usuario+contraseña en cada cambio
de turno, el dispositivo permanece con la **sesión del restaurante** ya autenticada y
el sistema pide **elegir el garzón de una lista y después su PIN** al abrir o cerrar
una cuenta.

### Por qué se elige antes de teclear (2026-08-08)

Antes se tecleaba el PIN a secas y el backend lo comparaba contra **todos** los
garzones activos, porque el hash está salteado y no se puede buscar por índice.
Medido: bcrypt a coste 10 tarda 62,5 ms por comparación, así que 20 garzones eran
1,3 s de CPU **por intento**, y 5 intentos concurrentes daban 6,3 s con hasta 309 ms
de lag del event loop — que en un solo proceso Node lo pagan **todos los tenants**.
Con el garzón ya elegido, la verificación es **un** bcrypt.

El selector ofrece **dos listas complementarias**, y la partición no es cosmética:

| flujo | lista | por qué |
|---|---|---|
| Entrar a turno | los que **no** están en turno | quien ya tiene sesión abierta no puede abrir otra |
| Salir de turno, abrir, cobrar, tomar y transferir cuenta | los que **sí** están en turno | los cinco exigen sesión abierta río abajo |

Así **la lista codifica la regla**: el 400 *"El garzón ya tiene una sesión abierta"*
deja de **ofrecerse**.
⚠️ No deja de existir: la lista se pide al abrir el modal, y entre esa carga y el submit el
mismo garzón puede entrar a turno **en otro tótem** —que es el despliegue normal de esta
feature—. El guard del backend sigue siendo el que manda; la lista solo evita el camino
previsible.

⚠️ **La cuenta con la que se loguea el tótem es un usuario común del tenant** — no
existe ningún concepto de "dispositivo" en el sistema. Debería tener un **rol
mínimo**, solo lo que la operación del salón necesita: si se loguea con la cuenta del
admin, queda un dispositivo compartido y desatendido con permisos de administración.
Regla operativa, no enforcement: ningún garzón abre su cuenta en un tótem, y ningún
garzón tiene el usuario y la contraseña del tótem.

### ¿Por qué existe?

- Evitar el login/logout continuo en dispositivos compartidos.
- Identificar al garzón por PIN en dispositivos compartidos (apertura, cierre,
  claim de cuenta).
- Incorporar personal temporal **sin crear usuarios del sistema**.
- Trazabilidad de **quién abrió y quién cerró** cada cuenta (auditoría).

Un garzón **no es un usuario del sistema**: no tiene login ni JWT. El PIN es un
**identificador operativo** dentro de la sesión del tenant ya autenticada — no toca
el sistema de tokens.

### Los dos modos del dispositivo (2026-08-09)

Lo de arriba sigue siendo el caso base, pero **no es el único**. El owner separó
dos flujos que antes se trataban igual, y la diferencia no es de comodidad:

| | **Tótem compartido** | **Tablet personal** |
|---|---|---|
| Quién lo usa | muchos garzones, un dispositivo | una persona, su propio login |
| Identidad | **no se puede presumir**: nada asegura que quien está frente a la pantalla sea el mismo de hace cinco minutos | el JWT ya dice quién es |
| Cómo se identifica | lista de garzones + PIN, en los 6 puntos | sin PIN: sale del token |

El modo es **explícito, no inferido**: `usuarios_tenants.es_totem` marca la
cuenta como tótem, y `garzones.usuario_id` (nullable) la vincula a un garzón.
El marcador **gana siempre**: una cuenta marcada tótem pide PIN aunque alguien
le vincule un garzón por error.

Que el vínculo sea **opcional** es lo que preserva el objetivo original: sin él
nada cambia, y se puede seguir sumando personal temporal sin crearle una cuenta.

Vincular una cuenta **invalida el PIN** que el encargado conocía (`GarzonesService.actualizar()`,
transición `usuario_id: null → uuid`): desde ese instante la identidad la prueba el JWT, así
que el PIN que el encargado emitió —y por lo tanto conoce— no puede seguir sirviendo. El
garzón fija el suyo propio desde su perfil (`fijarMiPin`), que el encargado nunca ve.
Desvincular **no** restaura el PIN: el garzón sigue operando con el que eligió. Si la
vinculación invalida el PIN de alguien con una sesión abierta ahora mismo, `actualizar()`
lo **advierte, no bloquea** — mismo criterio que cambiar el tipo (decisión del owner,
2026-08-07, extendida el 2026-08-14 a este caso).

**El alta acepta la cuenta directamente** (`CreateGarzonDto.usuarioId`, y el formulario de
`configuracion/garzones.vue` la manda): así el encargado **nunca llega a ver un PIN** del
personal con cuenta, en vez de ver uno que muere al vincular un minuto después. `crear()` con
`usuarioId` **no emite ninguno** (`pin: null`, `pin_hash` en el centinela) y por eso tampoco
escribe evento — la historia de ese garzón empieza el día que él fija el suyo. Sin cuenta, el
alta genera el PIN y lo revela una sola vez, como siempre.

**El garzón sin PIN usable sigue apareciendo en el selector del tótem** — vinculado o no,
`listarParaSelector` filtra por `activo`/`es_placeholder`/`eliminado_el` y por el
`EXISTS`/`NOT EXISTS` sobre `sesiones_garzon` que parte las dos listas, nunca por
`usuario_id`. Es deliberado, no un descuido (`docs/superpowers/specs/2026-08-14-pin-propio-garzon-design.md:109`):
esconderlo filtraría quién tiene cuenta y quién no. La consecuencia visible: elegirlo desde el
tótem y teclear cualquier PIN da el mismo *"PIN inválido"* genérico de siempre —
`verificarPin` no distingue garzón inexistente, PIN incorrecto o PIN muerto por vinculación.

`assertVinculable` valida membresía viva, no-tótem y no-tomada, pero **no** valida que la
cuenta tenga `Salones:Operar`. Vincular sigue permitido sin ese permiso —darlo después es un
flujo legítimo—, y lo que la persona pierde es **más angosto que un bloqueo**: pierde el **modo
personal** (operar sin PIN, desde su propia cuenta), que es lo que corta el `PermisosGuard` en
los 6 puntos cuando quien llama es su cuenta. **Desde el tótem sigue operando**, y sin que el
encargado le dé nada: `PATCH /garzones/mi-pin` está deliberadamente **sin `@RequiresPermiso`**
—cualquier miembro del tenant fija su propio PIN, tenga o no permisos de `Salones`— y
`verificarPin` no mira `usuario_id` ni permisos, porque por esa vía quien llama es la **cuenta
del tótem**, que sí tiene `Salones:Operar`. La advertencia la emiten **las dos vinculaciones**,
`actualizar()` y también `crear()` cuando el alta ya trae la cuenta (decisión del owner,
2026-08-14: toda vinculación, y el alta es una), con el mismo texto y el mismo criterio de
advertir-no-bloquear que el resto de este apartado.

⚠️ **La cuenta del tótem es un usuario común del tenant** — no existe ningún
concepto de "dispositivo" en el sistema. Debe tener un **rol mínimo**, solo lo
que la operación del salón necesita: si se la loguea con la cuenta del admin,
queda un dispositivo compartido y desatendido con permisos de administración. El
seed trae un rol `Salón` (`Salones:Leer` + `Salones:Operar`) como ejemplo
ejercitable. Nada en el sistema lo impide todavía: es recomendación operativa.

**Una cuenta = un garzón vivo por tenant** (`uq_garzones_usuario_tenant`, parcial sobre
filas vivas). Si no, resolver el actuante por JWT elegiría uno al azar. El índice es la
garantía, pero los dos caminos que pueden chocar con él devuelven un mensaje propio, no un
500: vincular una cuenta tomada dice **de quién** desvincularla, y restaurar un garzón de la
papelera cuya cuenta ya tomó otro dice eso —y no el mensaje del placeholder "Mostrador", que
es la otra unique parcial de la misma tabla—.

⚠️ El `usuario_id` **sobrevive al soft delete**, así que borrar un garzón libera su cuenta
para otro, y restaurarlo después puede fallar. Es correcto que falle; lo que importa es que
lo diga bien.

La resolución vive en **un solo lugar** —`GarzonesService.resolverGarzonActuante`,
una consulta— que reemplazó las 6 llamadas directas a `verificarPin`. Como
`garzonId` y `pin` pasaron a ser **opcionales** en el DTO (en modo personal no se
mandan), esa función es la que sostiene el PIN: sin su corte, un body vacío
operaría como cualquier garzón en los 6 puntos a la vez.

### Scope

- **Incluido**: CRUD de garzones, regeneración de PIN, selector + verificación de PIN, y
  captura de auditoría al **abrir** (`garzon_apertura_id`) y **cerrar**
  (`garzon_cierre_id`) una cuenta. Al abrir también se setea el responsable
  vigente inicial (`garzon_responsable_id`); ese campo cambia con transferencias
  (ver [salones-mesas.md](./salones-mesas.md)). Campo `tipo` (`garzon` | `cocina`
  | `barra`) para agrupar en liquidación de propinas (E1).
- **NO incluido (futuro)**: mover cuentas entre mesas con PIN, log por cada
  acción individual (agregar línea, fusionar).

Turnos y sesiones de trabajo (entrada/salida con PIN, sesión obligatoria para
operar cuentas): ver [turnos-garzones.md](./turnos-garzones.md).
Responsable vigente, transferencia por PIN/admin e historial:
[salones-mesas.md](./salones-mesas.md).

---

## Decisiones de diseño

- **Se elige a la persona y después se teclea el PIN** (`verificarPin` recibe `garzonId`).
  **No hay unicidad de PIN por tenant** —ni índice ni CHECK—: la conserva solo
  `generarPinUnico`, o sea el PIN que **emite el sistema**. El que el garzón **elige**
  (`fijarMiPin`) se hashea sin ningún chequeo contra los demás, y es deliberado: con la
  persona ya elegida dos PIN iguales no crean ambigüedad, y rechazar la colisión
  convertiría el formulario en un **oráculo** —probando PIN, un garzón descubriría el de
  otro—. Ver [la spec de diseño](../superpowers/specs/2026-08-14-pin-propio-garzon-design.md).
- **Quién es dueño del PIN depende de si la persona tiene cuenta** (2026-08-14). El
  principio, dicho por el owner: *la fuerza del registro escala con si la persona tiene
  cuenta* — no es una limitación escondida, es una elección del local.
  - **Sin cuenta** → el sistema. Genera uno aleatorio de 6 dígitos (`crypto.randomInt`),
    único en el tenant (reintenta ante colisión), y lo devuelve **una sola vez** al crear
    o regenerar. **Identifica, no prueba**: el encargado lo conoce.
  - **Con cuenta** → la persona. Lo fija desde su perfil (`fijarMiPin`), **sin que se le
    pida el anterior** —el caso principal es el olvido, y exigirlo la dejaría sin salida—,
    y el encargado nunca lo ve: puede **invalidarlo**, no regenerarlo. Se rechazan los PIN
    **obvios** (`esPinObvio`: repetidos y escaleras de 6 dígitos), que son los primeros que
    probaría cualquiera que quisiera hacerse pasar por otro.
- **Todo cambio de PIN queda registrado** en `garzon_pin_evento` (quién, cuándo, qué tipo),
  en la misma transacción que pisa el hash y **sin guardar nunca el PIN**. Se guarda la
  historia completa y no solo el último cambio: lo que hace visible un abuso es la
  **frecuencia** (*"le regeneró el PIN tres veces esta semana"*), y eso se pierde si cada
  cambio pisa al anterior.
- **PIN hasheado** con bcrypt (cost 10, igual que las contraseñas). La API jamás devuelve
  `pin_hash`. Si se pierde: **sin cuenta** el encargado regenera y el nuevo se muestra una
  vez; **con cuenta** la persona fija otro desde su perfil. En los dos casos el anterior
  deja de funcionar de inmediato.
- **RBAC**: reutiliza el módulo contratado `Salones` (sin nuevo `tenant_modulos`). El
  CRUD usa `Leer/Crear/Actualizar/Eliminar`; la identificación por PIN usa `Operar`.

---

## API Endpoints

El controller entero está bajo `@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)` y
`tenant_id` sale siempre del JWT, pero **el permiso lo pone `@RequiresPermiso` ruta por
ruta**: `PermisosGuard` es `return true` sin el decorador. Las dos rutas de **"mi PIN" lo
omiten a propósito** — un garzón puede no tener ningún permiso de módulo, y su PIN es suyo;
el corte lo hace el token, que decide de qué garzón se está hablando.

| Método | Ruta | Permiso (`Salones`) | Descripción |
|---|---|---|---|
| GET | `/garzones` | `Leer` | Lista garzones del tenant (sin `pin_hash`); `?incluirEliminados=true` suma la papelera |
| POST | `/garzones` | `Crear` | Crea `{ nombre, activo?, tipo?, usuarioId? }` → el garzón + `advertencias` + `pin`: **sin** `usuarioId` el generado (una vez), **con** cuenta `null` (no se emite ninguno) |
| PATCH | `/garzones/:id` | `Actualizar` | Actualiza `{ nombre?, activo?, tipo?, usuarioId? }` → el garzón + `advertencias`. `usuarioId: null` desvincula; **ausente** no toca el vínculo |
| PATCH | `/garzones/:id/pin` | `Actualizar` | Sin body. **Sin cuenta** regenera y devuelve el `pin` nuevo (una vez); **con cuenta** invalida y devuelve `pin: null`. Suma `habiaPin`: si había uno usable antes de este PATCH |
| GET | `/garzones/:id/pin-eventos` | `Leer` | La historia de PIN del garzón, más nueva primero. **Nunca** el PIN |
| DELETE | `/garzones/:id` | `Eliminar` | Soft delete |
| POST | `/garzones/:id/restaurar` | `Eliminar` | Saca de la papelera |
| PATCH | `/garzones/mi-pin` | — (solo JWT + tenant) | `{ pin, confirmarPin }` → `204`. El garzón fija el suyo; **no pide el anterior**. `404` si esa cuenta no es garzón en este tenant |
| GET | `/garzones/mi-pin` | — (solo JWT + tenant) | `{ fijado, eventos }`: alimenta el bloque "Mi PIN" del perfil |
| GET | `/garzones/mi-vinculo` | `Operar` | El garzón que "es" esta cuenta, o `null` si hay que pedir PIN |
| GET | `/garzones/para-selector?enTurno=` | `Operar` | Las dos listas del selector → `{ garzonId, nombre }[]`. `enTurno` **obligatorio** |
| POST | `/garzones/verificar-pin` | `Operar` | `{ garzonId, pin }` → `{ garzonId, nombre }` (o 400), **sin ejecutar nada** |

⚠️ `mi-pin` está declarada **antes** de `@Patch(':id')` en el controller: Nest resuelve por
orden, así que invertirlas mandaría `PATCH /garzones/mi-pin` a `actualizar` con
`id = 'mi-pin'` y moriría en un 404 confuso.

Al **abrir** cuenta (`POST /mesas/:id/cuentas`) y **cerrar** cuenta
(`POST /cuentas/:id/cerrar`) el body lleva `garzonId` y `pin` (6 dígitos) — **opcionales en
el DTO** (`CredencialGarzonOpcionalDto`), porque en modo personal no se mandan y
`resolverGarzonActuante` resuelve por JWT; sin vínculo personal esa misma función corta, así
que la opcionalidad del DTO no afloja nada. El backend
resuelve el garzón y persiste `garzon_apertura_id` / `garzon_cierre_id`
(auditoría). Al abrir también setea `garzon_responsable_id` al mismo garzón
(responsable vigente inicial). La transferencia de responsable vigente (claim por
PIN o admin) vive en Salones — no en este módulo.

---

## Backend

- **Módulo**: `src/modules/garzones/garzones.module.ts` (exporta `GarzonesService`,
  consumido por `SalonesModule`).
- **Controller**: `src/modules/garzones/garzones.controller.ts`
- **Service**: `src/modules/garzones/garzones.service.ts`
- **Entidades**: `Garzon` → tabla `garzones`; `GarzonPinEvento` → tabla `garzon_pin_evento`
  (las dos registradas también en el array `entities` de `app.module.ts`: no hay
  `autoLoadEntities`).

### Tabla `garzones`

| Columna | Tipo | Notas |
|---|---|---|
| `garzon_id` | UUID PK | |
| `tenant_id` | UUID | FK tenants |
| `nombre` | VARCHAR(100) | |
| `pin_hash` | TEXT | bcrypt; nunca expuesto. El centinela `'!'` (`PIN_INUTILIZABLE`) significa **sin PIN usable**: `bcrypt.compare` contra él siempre da `false` y no tira, así que cae por el camino normal de *"PIN inválido"* |
| `activo` | BOOLEAN | default `true` |
| `tipo` | TEXT | default `'garzon'`; CHECK `garzon` \| `cocina` \| `barra` |
| `es_placeholder` | BOOLEAN | default `false`; solo el "Mostrador" del POS |
| `usuario_id` | UUID nullable | Cuenta vinculada (**modo personal**). `uq_garzones_usuario_tenant`, parcial sobre filas vivas |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | soft delete |

### Tabla `garzon_pin_evento`

La historia de cada PIN. Mismo patrón que `liquidacion_propinas_evento`.

| Columna | Tipo | Notas |
|---|---|---|
| `garzon_pin_evento_id` | UUID PK | |
| `tenant_id` / `garzon_id` | UUID | |
| `tipo` | TEXT | `emitido_en_alta` \| `regenerado_por_encargado` \| `invalidado_por_encargado` \| `invalidado_por_vinculo` \| `fijado_por_garzon` |
| `usuario_id` | UUID | Quién lo hizo — el encargado o el propio garzón |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | soft delete |

Los dos tipos de invalidación se distinguen porque **dicen cosas distintas**:
`invalidado_por_vinculo` es *"te di una cuenta"*, `invalidado_por_encargado` es *"te corté el
PIN"*. El alta **con** cuenta no escribe evento: no emite ningún PIN, así que la historia de
ese garzón empieza el día que él fija el suyo.

`cuentas` tiene tres FKs a `garzones`: `garzon_apertura_id` y `garzon_cierre_id`
(auditoría de quién abrió/cerró) y `garzon_responsable_id` (vigente; cambia con
transferencias — ver Salones).

### Métodos clave del service

- `crear` / `regenerarPin` — **se parten según el garzón, no según la ruta**, así el
  encargado no puede elegir mal. Sin cuenta generan un PIN **único** por tenant vía
  `generarPinUnico` (aleatorio con `crypto.randomInt`, comparado con bcrypt contra los
  existentes y reintentado ante colisión), lo hashean y lo devuelven en claro **una sola
  vez**. Con cuenta devuelven `pin: null` y dejan `pin_hash = PIN_INUTILIZABLE`: `crear` no
  emite ninguno, `regenerarPin` **invalida**.
- `fijarMiPin(tenantId, usuarioId, dto)` — el garzón fija el suyo. Resuelve por
  `garzonPersonalDe` (la definición canónica de "esta cuenta es este garzón", con el override
  duro de `es_totem`), valida `pin === confirmarPin` y `esPinObvio`, y **no compara contra
  ningún otro garzón** (ver Decisiones de diseño).
- `guardarConEvento(garzon, evento)` — pisa el `pin_hash` y escribe la fila de
  `garzon_pin_evento` **en la misma transacción**. Un log que puede quedar desincronizado del
  hecho que registra no sirve como registro.
- `listarEventosPin(tenantId, garzonId)` — el historial en **una** consulta con `LEFT JOIN` a
  `usuarios` para el nombre del actor; resolverlo fila por fila sería un N+1 exacto. El
  `JOIN` **no** filtra `eliminado_el` de `usuarios` a propósito: quién hizo algo es un hecho
  histórico y no desaparece porque la cuenta se dé de baja.
- `verificarPin(tenantId, garzonId, pin)` — **una** fila (`id + tenant + activo`) y
  **un** `bcrypt.compare`; devuelve el garzón o lanza `400 PIN inválido`. Es un `400`
  (no `401`) a propósito: un PIN incorrecto es un error operativo, no un fallo de
  autenticación de la sesión del dispositivo — un `401` haría que el frontend
  (`useApiFetch`) intente refrescar el token y cierre la sesión del restaurante.
  El mensaje **no distingue** garzón inexistente de PIN incorrecto.
  Reemplazó a `resolverGarzonPorPin(tenantId, pin)` (2026-08-08), que iteraba todos los
  activos porque no había a quién comparar — ver arriba la medición del costo.
- `listarParaSelector(tenantId, enTurno)` — las dos listas complementarias, en **una**
  query con `EXISTS`/`NOT EXISTS` sobre `sesiones_garzon`, devolviendo solo id y nombre.
  Excluye inactivos, eliminados y al placeholder `Mostrador` — **nunca** por `usuario_id`.
- `obtenerActivoPorId(tenantId, id)` — valida pertenencia al tenant + `activo`, o lanza
  `400 Garzón no encontrado o inactivo`. **Todo `garzonId` que llegue desde el body pasa
  por acá antes de persistirse.** Lo usa `VentasService` para `propinaCierreMesa`: sin esa
  validación la propina se acredita a un garzón de otro tenant y este la cobra en su
  liquidación. (`propinaDirecta` no lo necesita: `asegurarMostrador` ya es tenant-scoped.)
  El seed incluye un garzón de Falabella (`…440332`) cuya única razón de existir es que el
  e2e pueda ejercer ese cruce con un garzón activo y válido.

---

## Frontend

- **Composable**: `app/composables/useGarzones.ts` (`listar/crear/actualizar/
  regenerarPin/eliminar/paraSelector/miVinculo/verificarPin/miPin/fijarMiPin/
  listarEventosPin`).
- **Modal de identificación**: `components/salones/GarzonPinModal.vue` — dos pasos
  (elegir garzón, después teclado), con "Cambiar de garzón" para volver sin cerrar el
  modal ni perder la acción que lo abrió. Verifica **antes** de emitir (vía
  `verificar-pin`), así un PIN equivocado se corrige en línea. Lo reutilizan los 6
  flujos de `pages/salones/index.vue` —entrar y salir de turno, abrir, cobrar, tomar y
  transferir cuenta—, que muestra el responsable vigente (independiente de quién
  abrió/cerró).
- **Página admin**: `pages/configuracion/garzones.vue` — tabla con crear/editar, PIN,
  eliminar y papelera. El PIN generado se muestra en un **modal una sola vez** (con aviso
  de que no se volverá a mostrar); **con cuenta vinculada ese modal ni se abre** —no hay
  número que mostrar— y el resultado sale por toast. El botón de la fila **cambia de
  rótulo** según el garzón: *"Generar PIN nuevo"* sin cuenta, *"Invalidar PIN"* con cuenta.
  El alta acepta la cuenta directamente, y el aviso del formulario dice cuál de los dos
  casos va a pasar **antes** de guardar. La ficha muestra el **historial de PIN de todos los
  garzones** (`GarzonesPinEventosLista`, decisión del owner 2026-08-15) — es la única pantalla
  donde se ven `emitido_en_alta` y `regenerado_por_encargado`, los dos únicos eventos que
  produce un garzón **sin** cuenta, que no tiene perfil donde mirarlos; y es justo el caso que
  justifica el log, porque *"Pedro le regeneró el PIN a Ana tres veces esta semana"* solo puede
  pasar sin cuenta (con cuenta el encargado no regenera, invalida). Sin superficie nueva: el
  endpoint pide `Salones:Leer`, el mismo con el que ya se lee la ficha, y la llamada cuelga de
  **abrir la ficha**, nunca del render de la tabla (una por apertura, cero N+1). El badge de PIN
  (`pinFijado`, del listado — no derivado del historial, que puede tardar o fallar) tiene **tres
  estados**, porque la salida de cada uno la ejecuta alguien distinto:

  | Estado | Badge | Quién lo resuelve |
  |---|---|---|
  | Con cuenta, PIN puesto | *"PIN puesto"* (`success`) | nada que hacer |
  | Con cuenta, sin PIN | *"Sin PIN todavía"* (`warning`) | la persona, desde su perfil |
  | **Sin cuenta, sin PIN** | *"Sin PIN: no puede operar"* (`error`) | **el encargado**, generándole uno |
  | Sin cuenta, con PIN | *(sin badge)* | — |

  El último caso se esconde porque ahí *"PIN puesto"* significaría *"lo puso la persona"*, que
  es lo que un garzón sin cuenta nunca hizo. El tercero, en cambio, **no es un caso teórico**:
  se llega **desvinculando** desde este mismo formulario. `actualizar()` pisa `pin_hash` solo en
  la transición `null → uuid`, así que un garzón dado de alta **con** cuenta y después
  desvinculado queda sin vínculo **y** sin PIN usable — no puede operar por ningún lado ni
  arreglarlo solo (`PATCH /garzones/mi-pin` resuelve por `usuario_id` y le da 404). Es el estado
  más grave que la ficha puede mostrar, y por eso es el que nunca se esconde.
  Entrada de nav bajo Configuración, gated
  **`Salones:Leer`** —no `Crear`—: lo que la pantalla pide para abrirse es el permiso de
  lectura, y con `Crear` el link quedaba escondido para quien solo tiene `Actualizar` o
  `Eliminar` y sí puede trabajar ahí (`pages/configuracion.vue`).
- **Perfil del garzón**: `components/configuracion/MiPinForm.vue`, montado en
  `pages/configuracion/perfil.vue`. Dice si tiene PIN puesto, deja fijar uno tecleándolo dos
  veces y muestra su propia historia. Si la cuenta no es garzón en el tenant activo, el
  bloque no se renderiza.

---

## Testing

### Unit (backend)

```bash
cd backend && npx jest garzones salones
```

Cubre: generación y unicidad del PIN **generado** (con reintento ante colisión),
`verificarPin` (una consulta / match / 400), la forma de las dos listas del selector
(`EXISTS`/`NOT EXISTS`, con el query builder **mockeado**), y que abrir/cerrar cuenta
persisten `garzon_apertura_id`/`garzon_cierre_id` (auditoría) y al abrir también
`garzon_responsable_id`. Del PIN propio: que vincular invalida y desvincular no toca; que el
alta con `usuarioId` no devuelve PIN y sin cuenta sí; que `regenerarPin` se parte por
`usuarioId`; que el PIN **elegido** rechaza obvios y **acepta** una colisión; que "mi PIN"
contra una cuenta sin garzón da `404`; y que cada camino escribe su evento con el `tipo`
correcto.

### E2E (backend, Postgres real)

```bash
./scripts/reset-db.sh && cd backend && npm run test:e2e
```

⚠️ Los specs de `test/` **no los corre el comando unit de arriba** (config aparte), y son los
únicos que ejercitan lo que el mock no puede ver:

- `garzones-selector.e2e-spec.ts` — que el SQL del selector **compile** y que la lista **no
  filtre garzones de otro tenant**. Medido: borrar el `where` de tenant deja el gate unit
  entero en verde.
- `garzon-pin.e2e-spec.ts` — el ciclo completo del PIN propio: el encargado crea un garzón
  vinculado (nunca ve PIN) → el garzón fija el suyo → entra al tótem con él → el encargado lo
  invalida → el viejo deja de servir → el historial queda completo, en orden y con el nombre
  del actor. Más el radio de impacto (fijar el propio no toca el de ningún otro), el `404`
  en un tenant donde la cuenta no es garzón, y el rechazo de un PIN obvio. El garzón que
  **abre y cierra sesión** es su fixture propia (`PIN Fixture`, `…440346`/`…440347`) y nunca
  Ana, Bruno ni Carla: esa sesión es única y varios specs se pisarían. Bruno **sí** aparece,
  como testigo del radio de impacto — pero solo por `verificar-pin`, que es de **solo
  lectura** (un `findOne` y un `bcrypt.compare`, sin sesión ni escritura), así que no toca la
  fixture compartida. La restricción es sobre abrir/cerrar turno, no sobre leer.
- `garzon-modo-personal.e2e-spec.ts` — la resolución por JWT sin PIN.

### Manual (frontend)

1. `docker-compose up`. PINs demo del tenant Paris: **Bruno=`222222`, Carla=`333333`**.
   ⚠️ **Ana Torres no tiene PIN** desde el 2026-08-14: el seed la siembra **vinculada a su
   cuenta** (modo personal) con `pin_hash = PIN_INUTILIZABLE`, igual que cualquier garzón
   con cuenta. Tecleando cualquier PIN suyo en el tótem sale *"PIN inválido"*, y **eso es
   lo correcto** — no es una regresión. Para volver a usarla desde el tótem hay que fijarle
   un PIN desde su propio perfil (paso 5).
2. Configuración → Garzones, las dos altas:
   - **sin** cuenta vinculada → el PIN se muestra una vez, en el modal;
   - **con** cuenta vinculada → **no se emite ninguno**: el aviso del formulario lo dice
     antes de guardar, el modal del PIN no se abre y el resultado sale por toast.
3. Misma pantalla, el botón de la llave: *"Generar PIN nuevo"* en un garzón sin cuenta
   (revela uno nuevo) y *"Invalidar PIN"* en uno con cuenta (no muestra ningún número). La
   ficha muestra el historial de PIN de **cualquier** garzón; el badge de PIN, siempre que no
   haya PIN usable (con cuenta o sin ella) más el caso *"con cuenta y PIN puesto"*.
4. **Primero, entrar a turno con el garzón que vas a usar.** ⚠️ Sin esto el paso no se puede
   completar y no hay mensaje que lo explique: el selector de PIN pide la lista con
   `garzonesApi.paraSelector(enTurno)` y *"abrir cuenta"* usa el default `enTurno: true`
   (`GarzonPinModal.vue:19`), o sea que **solo lista garzones con sesión de turno abierta**.
   El seed no abre ninguna sesión, así que si nadie entró a turno el selector sale **vacío**
   — y como sin garzón no se dispara ningún request, el toast de *"sesión de trabajo"* de
   `salones/index.vue` tampoco aparece. Queda una pantalla muda.

   Recién entonces: Salones → abrir cuenta: PIN correcto abre la cuenta (apertura +
   responsable vigente inicial visibles); PIN incorrecto muestra "PIN inválido" (sin cerrar
   sesión). Cerrar y cobrar pide el PIN del garzón que cierra (auditoría; puede diferir del
   responsable vigente).
5. Entrando con la cuenta de Ana (`ana.torres`): Configuración → Perfil → **Mi PIN**, fijar
   uno propio (dos veces, sin pedir el anterior). El encargado, en la ficha, ve el evento
   `fijado_por_garzon` — pero **no el PIN**.
   ⚠️ Comprobar ese PIN **exige cambiar de cuenta** (`totem.paris` o `admin.paris`): con la
   sesión de Ana, `resolverGarzonActuante` la resuelve por JWT y **ningún flujo del salón le
   pide PIN** — el selector de garzón ni aparece. El PIN recién fijado se ejercita desde el
   tótem, que es exactamente para lo que sirve.

---

## Related Features

- [Turnos y Sesiones de Garzón](./turnos-garzones.md)
- [Salones y Mesas](./salones-mesas.md)
- [Ventas](./ventas.md)

Spec de diseño del PIN propio:
[`2026-08-14-pin-propio-garzon-design.md`](../superpowers/specs/2026-08-14-pin-propio-garzon-design.md).
