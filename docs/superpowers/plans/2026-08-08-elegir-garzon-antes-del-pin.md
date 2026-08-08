# Plan: dos modos de identificación del garzón (tótem y personal)

**Status**: Fase 1 (tótem) **hecha y verificada** · Fase 2 (personal) diferida
**Date**: 2026-08-08
**Owner**: Cesar Matheus

---

## Context

### De dónde viene

La entrada del backlog era de rendimiento: `resolverGarzonPorPin(tenantId, pin)` trae
**todos** los garzones activos del tenant y compara con bcrypt uno por uno, porque el hash
está salteado y no se puede buscar por índice. Cada intento cuesta **N bcrypt**.

Lo medido en su momento: bcryptjs a coste 10 tarda 62,5 ms por comparación, así que 20
garzones son 1,3 s de CPU por intento. La fuerza bruta **no** es el vector (agotar 10⁶ son 14
días de CPU saturada). Lo que sí se midió es **amplificación de carga**: 5 intentos
concurrentes dan 6,3 s y hasta **309 ms de lag del event loop**, que en un solo proceso Node
lo pagan todos los tenants.

### Por qué el plan anterior estaba mal encuadrado

La primera versión proponía "elegir garzón, después PIN" **en todos lados**. El owner lo
frenó con una objeción correcta: **la operación no puede volverse lenta.** Medido: el PIN se
pide en **6 lugares** de `salones/index.vue`, y dos son por mesa y por servicio —abrir
cuenta (`:463`) y cerrar cuenta (`:928`)—. En un turno de 30 mesas son ~60 tecleos de 6
dígitos; agregar un toque a cada uno empeora el camino caliente para resolver un problema de
carga.

### El reencuadre del owner: son dos flujos, no uno

- **Tótem compartido** — muchos garzones, un dispositivo. La identidad **no se puede
  presumir**: nada asegura que quien está frente a la pantalla sea el mismo de hace cinco
  minutos.
- **Tablet personal** — el garzón tiene su propio login. El JWT ya dice quién es; pedirle un
  PIN es re-probar lo ya probado.

⚠️ **Esto agrega un modo que el diseño original descartó explícitamente.**
[`garzones.md`](../../features/garzones.md) dice que el dispositivo queda con la sesión del
restaurante autenticada y el PIN identifica a la persona, con dos objetivos declarados:
*"evitar el login/logout continuo en dispositivos compartidos"* e *"incorporar personal
temporal **sin crear usuarios del sistema**"*. Y la entidad afirma: *"NO es un usuario del
sistema — no tiene login ni JWT"*. Verificado: **no existe ningún vínculo entre `usuarios` y
`garzones` en el esquema**, en ninguna dirección. El modo personal no afina lo que hay: suma
un caso nuevo, y el vínculo es **opcional** justamente para no romper el objetivo del
personal temporal.

---

## Decisiones tomadas (owner, 2026-08-08)

Contrastadas contra la investigación de mercado:
[`investigaciones/2026-08-08-atribucion-de-propina-y-mesa-compartida.md`](../../agent/investigaciones/2026-08-08-atribucion-de-propina-y-mesa-compartida.md).

- **Tótem: lista de garzones + PIN, siempre.** El selector reduce la verificación a **1
  bcrypt**, que era el objetivo original de la entrada.
- **Personal: el garzón queda fijo.** Identidad desde el JWT, **sin PIN en ninguna acción**.
- **El modo es EXPLÍCITO, no inferido** (revisado el 2026-08-08, después de haberlo decidido
  al revés). Un `es_totem BOOLEAN NOT NULL DEFAULT false` en **`usuarios_tenants`** —la
  asociación usuario↔tenant que ya existe—, no en `usuarios`: ser tótem es propiedad de cómo
  se usa esa cuenta en ese tenant, no de la persona.
  **Por qué se dio vuelta:** con el marcador explícito, una cuenta marcada como tótem **no
  puede volverse personal nunca**, aunque alguien la vincule a un garzón por error. La
  dirección peligrosa —un dispositivo compartido atribuyendo todo a una persona, en
  silencio— deja de depender de que nadie se equivoque. Además le da dónde vivir al aviso de
  rol mínimo: la pantalla de miembros puede advertir si una cuenta tótem tiene permisos
  amplios.
  ⚠️ **NO se construye en la Fase 1**: hoy no hay modo personal, así que todo se comporta
  como tótem y nada consultaría la columna. Se construye con la Fase 2. El diseño queda
  fijado para no rediseñarlo entonces.
  **Descartado: `tipo = 'totem'` en `garzones`.** `tipo_garzon` no es una etiqueta, es la
  **clave de agrupación del reparto**, con `CHECK` en 5 tablas y un índice único
  `(tenant_id, tipo_garzon)` en `propina_grupo_distribucion`. Un cuarto valor **crea un grupo
  de reparto** con porcentaje asignado a algo que no es una persona. Y rompería el receptor
  neutro, que funciona justamente **porque el tipo queda NULL** y la propina cae al pozo.
- **NO se agrega ninguna configuración de "modo estricto".** El tótem pide PIN en los mismos
  6 lugares que hoy; lo único que cambia es el selector previo. Ver abajo el porqué: la
  primera propuesta —derivarlo del `criterio`— no se sostiene, y la versión acotada que sí
  se sostenía la descartó el owner por ahora.
- **Quién edita el reparto: por permiso, y ya funciona.** `PUT /propinas/distribucion` está
  bajo `@RequiresPermiso('Propinas', 'Configurar')`, no `TenantAdminGuard`: un tenant ya
  puede crear un rol "Jefe de garzones" y dárselo. Importa por lo legal (ver abajo). **No hay
  nada que construir acá.**
- **La lista del selector NO puede salir de `GET /garzones`.** Medido sobre el modelo: los
  roles son configurables por tenant, así que nada impide un rol con `Salones:Operar` y sin
  `Salones:Leer` — que es exactamente quien necesita el selector. Endpoint propio bajo
  `Operar`, devolviendo solo `{ garzonId, nombre }`.

### Lo que la investigación cambió

- **La atribución por línea queda descartada.** Toast tampoco la hace: no permite dos meseros
  en una mesa y atribuye a **quien abre la orden**, igual que nosotros. El mercado tapa el
  hueco con *split check* y **empleado genérico**, no con atribución más fina.
- **Restricción legal (Chile), no de producto:** la propina es de los trabajadores y el
  empleador *"no podrá distribuir las propinas"* (DT, ORD. N°4922). Nuestra config de
  distribución **es el registro de un acuerdo entre trabajadores**, no una política del
  restaurante. Por eso el permiso propio importa, y por eso la auditoría del cambio importa
  más que el guard.

### Diferido con fundamento (no re-litigar desde cero)

**Timeout configurable en el tótem + ticket de garzón.** Se diseñó entero y se **descartó por
ahora** el 2026-08-08. El razonamiento, para que no haya que rehacerlo:

- Sin una credencial emitida por el backend, "la tablet recuerda a Ana" es **falsificable**:
  el JWT del tótem dice *"soy la tablet del restaurante"*, es compartido por diseño, y
  cualquiera podría mandar el `garzonId` de otro y atribuirle ventas y propinas.
- Con credencial, el ticket cierra la **falsificación** pero **no la presencia**: prueba que
  alguien tecleó el PIN de Ana hace menos de N minutos, no que la persona que opera sea Ana.
  Ninguna credencial cierra eso; solo volver a pedir el PIN.
- En un restaurante el atacante realista es **el que está parado al lado**, no el que abre
  las herramientas del navegador. Contra ése, el valor útil del timeout es `0` — y si va a
  ser `0`, el ticket es maquinaria que no se usa.
- Lo que sí resuelve la presencia es **la tablet personal**: el dispositivo es de la persona
  y no hay ventana que abrir.
- Toast **sí** recuerda al empleado con timeout de inactividad configurable. Choque
  consciente con el mercado: gana el criterio del owner, y queda escrito por qué.

Si algún día se retoma: sería por tenant y por inactividad (ya elegido), y lo que habría que
volver a evaluar es solo si apareció un caso donde el tótem con memoria sea la única salida.

**Configuración de "modo estricto" en el tótem.** Explorada y **descartada por ahora**
(2026-08-08). Quedan tres hallazgos que valen aunque la config no se construya:

1. **Derivarlo del `criterio` NO funciona.** El criterio es **por grupo**, no por tenant:
   `propina_grupo_distribucion` tiene una fila por `tipo_garzon` con índice único
   `(tenant_id, tipo_garzon)`, así que un restaurante puede tener garzones con
   `VENTAS_NETAS`, cocina con `PARTES_IGUALES` y barra con `HORAS_TRABAJADAS` **a la vez**.
   No existe "el criterio del tenant". La regla habría sido "mirá el grupo `garzon`", un
   acoplamiento implícito entre dos módulos que nadie adivina leyendo el código.
2. **El PIN al ABRIR es irreducible, y no por la propina.** Establece
   `garzon_responsable_id`, y cobrar exige que la cuenta tenga responsable
   (`salones.service.ts:995`) **y** que ese responsable esté en turno (`:1009`). Sin
   responsable no se cobra, con cualquier criterio de reparto.
3. **El PIN al CERRAR no atribuye plata.** La propina va al responsable, no a quien cobra —
   `salones.service.ts:1106` manda `garzonId: cuenta.garzonResponsableId`, y el comentario lo
   dice explícito. El PIN al cerrar solo graba `garzon_cierre_id`, o sea auditoría.

Si algún día se retoma, la perilla correcta **no** es "modo estricto" sino una mucho más
chica: *¿cerrar una mesa exige identificarse, o puede cerrarla cualquiera en turno?* Eso
baja los ~60 tecleos por turno a la mitad sin tocar la plata de nadie ni agregar
credenciales. Antes de construirla hay que verificar qué consume `garzon_cierre_id` —si
algún reporte depende de él, el modo no-estricto le mete nulls.

---

## Open questions

**Q1 — Mesa compartida.** ⚠️ El owner decidió que sea **una configuración**; falta diseñarla.
Lo bueno: el mecanismo del mercado (*empleado genérico*) **ya funciona en nuestro motor sin
tocar nada**. Seguido el camino: `venta_propina.garzon_id` es NOT NULL y el `Mostrador`
existe como *"receptor neutro"*; la parity constraint obliga a `sesion_garzon_id`,
`turno_id` y `tipo_garzon` a ser los tres NULL; `buscarTipsElegibles` **no** filtra por
`tipo_garzon`, así que la propina entra igual; y `poolTotal` (`:234`) suma **todas** las
elegibles y los grupos se llevan su parte por `porcentaje`. O sea: una propina sin
`tipo_garzon` **engorda el pozo y se reparte entre todos**. Falta solo poder **abrir la mesa
a nombre del genérico**. Dos obstáculos concretos:

1. **El `Mostrador` es `activo: false` a propósito.** Cobrar exige responsable en turno
   (`salones.service.ts:1009`) y `obtenerActivoPorId` filtra `activo: true`, así que una mesa
   compartida **no se podría cobrar**. Hay que eximir al genérico de la regla de turno — una
   excepción explícita, escrita y testeada.
2. **⚠️ Con `turno_id` NULL, la liquidación filtrada por turnos las descarta en silencio.**
   `vp.turno_id = ANY($4)` con NULL no es verdadero, así que liquidar "turno noche" **pierde
   todas las propinas de mesas compartidas**. Plata que desaparece sin error.

**Q2 — RESUELTA (owner, 2026-08-08): dos listas complementarias.**
- **Entrar a turno** → los activos **sin** sesión abierta.
- **Todo el resto** (salir de turno, abrir cuenta, tomar cuenta, cobrar, transferir) → solo
  los que **están** en turno.

Es más que una lista corta: **la lista codifica la regla**. Hoy hay un 400 *"El garzón ya
tiene una sesión abierta"* que con esta partición se vuelve inalcanzable desde la UI, y el
`assertSesionAbierta` de los otros caminos queda como defensa de backend en vez de como error
esperable. Un solo endpoint con filtro (`?enTurno=true|false`) alcanza para las dos.
⚠️ Definir qué muestra la pantalla cuando la lista operativa viene **vacía** —nadie en turno—:
un selector vacío no explica nada, tiene que decir que primero hay que entrar a turno.

**Q3 — RESUELTA (owner, 2026-08-08): no hay trabajo. La transferencia ya funciona.**

⚠️ **La pregunta estaba mal planteada** (por el agente): decía que *"el destinatario teclea su
PIN en el dispositivo del otro"*. Eso vale para **un** flujo, no para el principal. Leídos los
dos caminos:

- **`POST :id/transferir` es *pull*, no *push*.** El PIN lo teclea **quien se lleva la
  cuenta** — la UI dice *"PIN para tomar esta cuenta"* (`index.vue:563`). El que se
  identifica es el que está operando, igual que en todos los demás casos. **En modo personal
  eso no necesita PIN**: B toma la mesa desde su propia tablet y su JWT ya dice que es B.
- **`POST :id/transferir-admin`** ya permite elegir de una lista **sin PIN**
  (`index.vue:614`), bajo `Salones:Actualizar`.

El único caso con un tercero es el traspaso al cerrar turno (*"PIN del garzón que se hace
cargo"*). **Ahí el PIN sobrevive también en modo personal**: A le acerca la tablet a B, B
teclea. Cero código nuevo — es lo que ya pasa hoy.

**Y no hay que elegir un plan B:** `cerrarPorPin` cierra la sesión **incondicionalmente** y
*después* informa las pendientes (`sesiones-garzon.service.ts:145`). Si A cancela el modal,
las mesas quedan huérfanas y cualquiera las toma con el flujo *pull*. Las dos salidas ya
conviven.

**Descartado: que A elija a B de una lista sin PIN.** Sería la única puerta *push* del
sistema, justo donde hay plata: asignar una cuenta sin que el otro actúe le mueve dinero si
su grupo usa `VENTAS_NETAS` o `CANTIDAD_CUENTAS` (con `PARTES_IGUALES`, no). Un mecanismo
cuyo perjuicio depende de la config de otro módulo es el acoplamiento implícito que ya se
descartó en la sección de arriba.
⚠️ El argumento **no es legal**: el dictamen de la DT habla del reparto de la propina entre
trabajadores, no de quién atiende qué mesa. Estirarlo hasta acá sería sobreafirmarlo.

**Q4 — RESUELTA (owner, 2026-08-08): separación de credenciales, no código.**

El caso planteado —se le muere la tablet y agarra el tótem— **funciona sin nada especial**:
el tótem corre con la cuenta del restaurante, que no está vinculada, así que el modo se
infiere como tótem, sale la lista y el garzón teclea su PIN. Único requisito: **al vincular
a alguien se le sigue generando y manteniendo el PIN**; el vínculo agrega un camino, no
reemplaza el viejo.

El riesgo inverso que apareció al analizarlo —que un garzón loguee **su propia cuenta** en el
tótem y lo deje en modo personal, atribuyéndole todo a él sin pedir PIN— **no se maneja por
código**. Regla del owner: *ningún garzón abre su cuenta en un tótem, y ningún garzón tiene
el usuario y la contraseña del tótem.*

⚠️ Lo que hace tolerable el residuo: para loguear su cuenta, el garzón primero tiene que
**desloguear el tótem**, y restaurarlo exige una contraseña que no tiene. El tótem **se rompe
para todos** y se nota en minutos. La mala atribución mientras dura sigue siendo silenciosa,
pero la situación **se auto-anuncia** — no es el caso de "nadie se entera por un turno
entero".

**Descartado: pedir confirmación de dispositivo la primera vez** (*"¿este dispositivo es
tuyo?"*). Con la separación de credenciales, defiende de un caso que ya es ruidoso, a cambio
de una fricción que todos pagan.

**Q5 — RESUELTA (owner, 2026-08-08): es trabajo del admin, y falta una feature aparte.**

Medido: `POST /tenants/members` recibe un **`usuarioId` que ya existe**
(`tenants.controller.ts:103`) — suma al tenant, no crea. La pantalla de usuarios solo lista
miembros y asigna roles. El único camino para que exista una cuenta es `POST /auth/register`,
**público y de auto-registro**. No hay invitación, ni reset, ni alta por el admin.

Intención del owner: **el admin creará los usuarios del tenant**, como feature propia y más
adelante; la asociación usuario↔tenant ya está modelada, lo que falta es la creación.

**Consecuencia sobre el alcance** (ver abajo): hasta que eso exista, habilitar el modo
personal cuesta 4 pasos en 3 pantallas y arranca con un auto-registro público. Por eso el
modo personal **se difiere**.

**Q6 — Historial de la config de distribución.** Subió de prioridad con el hallazgo legal: si
la distribución es un acuerdo entre trabajadores, importa poder mostrar **cómo se llegó** a
los porcentajes vigentes. Hoy `propina_configuracion` guarda la versión y `actualizado_por`
**solo del último** que la tocó; la historia sobrevive parcialmente porque cada liquidación
snapshotea sus grupos, pero una versión que nunca liquidó se pierde. Costo estimado: una
tabla append-only con `version`, `usuario`, `fecha` y el diff.

## Scope — SOLO TÓTEM (decisión del owner, 2026-08-08)

El modo personal **se separa y se difiere**. Razón: el problema que originó la entrada era la
**amplificación de bcrypt**, y el selector la cierra entera por sí solo. El modo personal era
la respuesta a la **fricción**, y su onboarding depende de un alta de usuarios que todavía no
existe (Q5). Construirlo ahora sería un camino que casi nadie puede recorrer — y cuando
llegue el alta, traerá decisiones propias (¿el vínculo se hace al crear el usuario? ¿el rol
se asigna solo?) que hoy habría que adivinar.

Lo diseñado del modo personal **no se pierde**: queda escrito en este plan (Fase 2) y en las
preguntas resueltas.

- `verificarPin(tenantId, garzonId, pin)`: **1 bcrypt**. Reemplaza `resolverGarzonPorPin`.
- `garzonId` requerido en los DTOs de los caminos que hoy piden PIN.
- Endpoint del selector bajo `Salones:Operar`, con filtro `?enTurno=true|false` (Q2).
- Frontend: selector antes del teclado, con las dos listas complementarias.
- **Sin cambios de esquema.**

### Fase 2 — diferida (modo personal)

- `usuarios_tenants.es_totem` (boolean, default false) — el marcador explícito del modo.
- Vínculo **opcional** `garzones.usuario_id` (nullable, único por tenant sobre filas vivas).
- Resolución del garzón actuante: del JWT si hay vínculo, del `garzonId` + PIN si no.
- El PIN se sigue generando y manteniendo para los vinculados (Q4).
- En modo personal el PIN sobrevive **solo** en el traspaso al cerrar turno (Q3).
- Depende de: alta de usuarios del tenant por el admin (feature propia, sin plan aún).

⚠️ **La cuenta con la que se loguea el tótem es un usuario común del tenant** — no existe
ningún concepto de "dispositivo" en el sistema. Debería tener un **rol mínimo**, solo lo que
la operación del salón necesita: si se loguea con la cuenta del admin, queda un dispositivo
compartido y desatendido con permisos de administración. Hoy nada lo impide, y conviene que
quede en `docs/features/garzones.md` como recomendación operativa.

### Out of scope

- Throttling / rate limiting (entrada propia, acotada a `/auth/*`).
- Ticket de garzón y timeout del tótem — diferidos, ver arriba.
- HMAC en columna indexada — alternativa descartada al tomar la decisión.
- Cambiar el largo o la generación del PIN.
- Compatibilidad hacia atrás: **no hay datos productivos**, se cambia el contrato y se
  resiembra.

---

## Backend

- [x] `verificarPin(tenantId, garzonId, pin)`: una fila por `(garzonId, tenantId, activo)`,
      **un** `bcrypt.compare`. Borrar `resolverGarzonPorPin` una vez migrados los 7
      llamadores — no dejar las dos conviviendo.
- [x] `garzonId` (`@IsUUID('4')`) **requerido** en los DTOs de los 7 caminos.
- [x] `GET /garzones/para-selector?enTurno=true|false` bajo `Salones:Operar` →
      `{ garzonId, nombre }[]`. Nada de PIN, `activo` ni fechas. **Sin N+1**: el estado de
      turno sale de un `JOIN`/agregación, no de una query por garzón.
- [x] ⚠️ **Decisión revertida al implementar.** El plan decía eliminar `POST /identificar`
      porque "pierde su razón de ser". **Era falso:** tenía un segundo trabajo — verificar el
      PIN **sin ejecutar la acción**, para que el modal muestre el error en línea y el
      usuario reintente sin perder lo que estaba haciendo. Sin él, el modal cierra y el fallo
      sale como toast con la acción descartada. Se conservó como `POST /verificar-pin` con
      `garzonId`: mismo trabajo, 1 bcrypt en vez de N.
- [x] Seed: al menos **dos** garzones activos (ya estaban: Ana, Bruno, Carla) — el fixture
      tiene que poder distinguir batch de N+1.
      ⚠️ **La sesión abierta NO se sembró**, y no hacía falta: el seeder no crea ninguna fila
      de `sesiones_garzon` a propósito (*"las sesiones las crean los usuarios"*), así que el
      e2e la abre en runtime y la cierra al terminar. Medido tras `reset-db.sh`: 0 sesiones
      abiertas.

## Frontend

- [x] `GarzonPinModal.vue`: paso de selección antes del teclado. Volver atrás cambia de
      garzón sin cerrar el modal.
- [x] Los 6 llamadores pasan a emitir `(garzonId, pin)`. Cada uno elige su lista:
      *entrar a turno* → `enTurno=false`; los otros cinco → `enTurno=true`.
- [x] Lista vacía: la pantalla dice que primero hay que entrar a turno, no muestra un
      selector vacío (Q2).
- [x] `pages/salones/index.nuxt.spec.ts` ya ejercita el teclado (`rondaDePin` teclea seis
      "1"): con el paso nuevo deja de alcanzar.

## Verification

- [x] Gate completo **por exit code**: backend `lint:check`/`typecheck`/`test`/`test:e2e`
      (`reset-db.sh` antes, `--verificar` después); frontend `test`/`build`/
      `typecheck:ratchet`/`design:check`. **Mirar el exit code, no la línea de resumen.**
- [x] Mutante que revierte a la iteración: el test prueba que se hace **1** bcrypt y no N.
      Fixture con **dos** garzones como mínimo — con uno solo, iterar y no iterar dan lo
      mismo, y el test pasaría por construcción.
- [x] Las dos listas son complementarias y **ninguna filtra de más**: un garzón en turno no
      aparece en la de "entrar a turno", y viceversa.
- [x] Los 7 caminos siguen cubiertos, y sin `garzonId` dan 400 (no 500).
- [x] Revisión independiente (`domain-reviewer`): `tenant_id` del token, `garzonId` solo
      desde el body validado, y que el endpoint nuevo no exponga nada más que id y nombre.

## Docs a actualizar en el mismo commit

- [x] `docs/features/garzones.md` — el flujo de identificación pasa a ser selector + PIN, y
      la recomendación operativa del **rol mínimo para la cuenta del tótem**.
- [x] `docs/features/turnos-garzones.md` — entrar y salir de turno con selector.
- [x] `docs/features/salones-mesas.md` — abrir, cobrar, tomar y transferir cuenta.
- [x] `docs/agent/pendientes.md` → `resueltos.md` — cerrar la entrada de amplificación, y
      dejar anotado el modo personal como entrada propia con su dependencia (alta de
      usuarios del tenant).
