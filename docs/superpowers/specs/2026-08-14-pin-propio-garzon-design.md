# El PIN del garzón es suyo — Design Spec

**Fecha:** 2026-08-14
**Estado:** 📐 Aprobado por el owner — listo para plan de implementación
**Origen:** [`docs/agent/pendientes.md`](../../agent/pendientes.md) — entrada 🔴 *"El PIN del garzón no
es suyo: lo emite el encargado y lo ve en claro"* (medida el 2026-08-12 al implementar el testigo)
**Feature relacionada:** [`docs/features/garzones.md`](../../features/garzones.md)
**Antecedente:** [`2026-08-11-testigo-cierre-forzado-design.md`](2026-08-11-testigo-cierre-forzado-design.md)
— la doble vía de firma nació para esquivar este problema

---

## Contexto

Hoy el PIN de un garzón lo emite el encargado y lo ve en claro. Medido el 2026-08-14 sobre
`backend/src/modules/garzones/garzones.service.ts`:

- `crear()` (`:126-139`) genera el PIN y lo devuelve en la respuesta (`GarzonConPin`).
- `regenerarPin()` (`:275-288`, `PATCH /garzones/:id/pin`, `Salones:Actualizar`) hace lo mismo.
- **No existe ningún flujo para que el garzón lo cambie.**

Consecuencia: el PIN **identifica pero no prueba**. Quien lo emitió puede tecleárselo, y en un
local la pantalla del garzón es un **tótem compartido**, así que ni siquiera hace falta usar una
cuenta ajena.

El alcance no es el testigo del cierre de caja. El mismo PIN abre y cierra sesiones de turno,
manda comandas y atribuye propinas — o sea que hoy **ninguna** de esas acciones prueba quién la
hizo.

### El refinamiento que hace el arreglo barato

El vínculo opcional `garzones.usuario_id` ya existe (entrega del 2026-08-08). Cuando el garzón
**tiene cuenta**, ya está autenticado: no hay que inventar ningún mecanismo nuevo para dejarlo
elegir un secreto. Eso parte el problema en dos, y la mitad cara desaparece:

- **Con cuenta** → el garzón fija su PIN, el encargado nunca lo ve. **Prueba.**
- **Sin cuenta** → el encargado sigue emitiéndolo. **Identifica, no prueba.**

El principio, dicho por el owner y que conviene comunicar así: **la fuerza del registro escala con
si la persona tiene cuenta.** No es una limitación escondida, es una elección del local.

---

## Lo que esta feature gana — y lo que NO

⚠️ **Corrección al encuadre del backlog**, medida el 2026-08-14. La entrada dice que arreglar el
PIN *"convierte la vía PIN del testigo en prueba real"*. **No es así**, y escribirlo mal en la
documentación sería peor que no escribirlo:

- En el testigo, el garzón **con cuenta** ya firma por la vía fuerte (`via_firma: 'cuenta'`, exige
  su JWT — `CajaTestigoService.resolver`).
- La vía `'pin'`, por construcción, la usan los garzones **sin** cuenta. A esos el encargado les
  sigue emitiendo el PIN.

→ **La vía débil del testigo queda exactamente igual de débil, y está bien.** Nadie tiene que
reinterpretar las firmas ya guardadas; el significado histórico de `via_firma` no cambia. La
advertencia de `docs/DIFERENCIADORES.md` sobre no comunicar *"nadie puede firmar por otro"* **sigue
vigente tal cual**.

**Lo que sí gana, que es otra cosa y es más ancho: el tótem compartido.** Hoy una persona con
cuenta que opera desde el tótem no prueba nada, porque el encargado conoce su PIN. Después de esto,
sí. Eso alcanza a **abrir mesas, mandar comandas, iniciar y cerrar turno, y la atribución de
propinas** — todo lo que pasa por ese teclado.

---

## Decisiones del owner (2026-08-14)

| # | Decisión |
|---|---|
| 1 | Un garzón **con cuenta** nace **sin PIN usable**; lo fija él desde su perfil |
| 2 | El disparador es **vincular la cuenta**, no el alta — y el alta acepta la cuenta directamente |
| 3 | Si el PIN elegido coincide con el de otro garzón, **se acepta**: se cae la unicidad |
| 4 | Para un garzón con cuenta, el encargado **invalida sin ver nada**; no regenera |
| 5 | Todo cambio de PIN va a una **tabla de eventos** con historia completa |
| 6 | El historial lo ven **el encargado y el propio garzón** |
| 7 | Fijar el PIN propio **no pide el PIN anterior** |
| 8 | Un solo botón en la ficha, que **cambia de nombre** según el estado del garzón |
| 9 | El garzón se entera de una invalidación por un **aviso en la pantalla del salón** |
| 10 | Se **rechazan los PIN obvios** (repetidos y escaleras) |
| 11 | El encargado **no escribe motivo**: alcanza con que quede registrado |

---

## Diseño

### 1. Qué dispara el "sin PIN usable"

El disparador es **vincular**, no crear. En `actualizar()`, la transición
`usuarioId: null → uuid` pone `pinHash = '!'`: el encargado acaba de darle una cuenta, así que el
PIN que él emitió deja de valer en ese mismo instante.

`CreateGarzonDto` suma `usuarioId` (hoy no lo tiene) para que el alta sea un paso y el encargado
**nunca llegue a ver un PIN** del personal con cuenta. Reusa `assertVinculable()` (`:226-263`), que
ya valida las tres condiciones (miembro vivo del tenant, no marcada como tótem, no vinculada a otro
garzón); el parámetro `garzonId` pasa a ser opcional, porque en el alta la fila todavía no existe.

**El centinela `'!'` está medido, no supuesto:** `bcrypt.compare('123456', '!')` devuelve `false` y
**no tira** (bcryptjs 3.0.3, verificado el 2026-08-14). Un PIN inutilizable cae por el camino normal
de *"PIN inválido"*. Es el mismo valor que ya usa el garzón placeholder `Mostrador`
(`garzones.service.ts:577`), así que no hay esquema nuevo ni columna nullable.

Consecuencias:

- **El garzón vinculado no queda bloqueado.** En modo personal `resolverGarzonActuante` (`:479-497`)
  lo resuelve por JWT en la rama 2, sin mirar el PIN. Solo pierde el tótem hasta fijar uno.
- **Desvincular no toca el PIN.** El garzón sigue operando con el que eligió, que el encargado no
  conoce. Si hace falta uno nuevo, el encargado lo regenera como siempre.
- **El garzón sin PIN usable sigue apareciendo en el selector del tótem.** Esconderlo filtraría
  quién tiene cuenta y quién no; el mensaje genérico ya es la política del proyecto — `verificarPin`
  (`:388-398`) no distingue garzón inexistente de PIN incorrecto.

### 2. La unicidad del PIN se cae para el PIN elegido

Medido el 2026-08-14: **no hay índice ni CHECK** que imponga unicidad de PIN. Vive solo en
`generarPinUnico()` (`:630-641`) → `pinYaUsado()` (`:650-660`), que hace un `bcrypt.compare` **por
garzón del tenant**, y solo corre al generar. Y ningún camino resuelve un garzón por PIN suelto:
`resolverGarzonPorPin(tenantId, pin)` murió con el selector del 2026-08-08 — hoy siempre se elige la
persona antes de teclear.

Por eso, cuando el garzón elige su PIN, **una coincidencia se acepta**. Rechazarla convertiría el
formulario en un oráculo: probando PIN, un garzón descubriría el de otro. La unicidad se conserva
**solo donde el sistema genera el PIN** (alta sin cuenta y regeneración), donde no hay oráculo
porque nadie elige.

### 3. PIN obvios

El PIN elegido se rechaza si es **repetido** (`000000`, `111111`, …) o **escalera** ascendente o
descendente (`123456`, `654321`, …). Son los primeros que prueba cualquiera que quiera hacerse pasar
por otro, y es justo lo que la feature existe para evitar. Lista corta y derivada por regla, no un
diccionario: 10 repetidos + las escaleras de 6 dígitos.

No se valida contra fecha de nacimiento: el sistema no la guarda, y pedirla solo para esto sería
sumar un dato personal para una ganancia marginal.

### 4. La API

Todo en `GarzonesController`, que ya trae `JwtAuthGuard + TenantGuard + PermisosGuard` a nivel de
clase. **`PermisosGuard` es `return true` sin el decorador** (`permisos.guard.ts:24`, verificado), así
que las rutas de "mi PIN" no exigen permiso de módulo — un garzón puede no tener ninguno.

| Ruta | Guard efectivo | Qué hace |
|---|---|---|
| `PATCH /garzones/mi-pin` | JWT + tenant | El garzón fija su PIN |
| `GET /garzones/mi-pin` | JWT + tenant | `{ fijado: boolean, eventos: [...] }` para su perfil |
| `PATCH /garzones/:id/pin` | `Salones:Actualizar` | **La que ya existe**, con comportamiento partido |
| `GET /garzones/:id/pin-eventos` | `Salones:Leer` | El historial en la ficha |

**Por qué en `GarzonesController` y no en `MeController`:** `MeController` no tiene `TenantGuard`, y
un garzón es **por tenant** — la misma persona puede ser garzón en dos tenants con PIN distintos.
Ponerlo ahí obligaría a sumarle un guard a un controller compartido para servir a una sola ruta.

**`PATCH /garzones/mi-pin` no pide el PIN actual.** Es una diferencia deliberada con
`PATCH /me/contrasena`, que sí exige `contrasenaActual` (`update-contrasena.dto.ts`): el caso
principal de esta pantalla **es el olvido**, y exigir el viejo lo dejaría sin salida — que es
exactamente el problema que estamos arreglando. La cuenta es el ancla: el JWT ya probó quién es, y
el PIN es un factor *menor* que la cuenta, no otro igual. El garzón se resuelve por
`usuario_id = <JWT> AND tenant_id = <token>`; si no hay ninguno vivo, `404`.

**`PATCH /garzones/:id/pin` se parte según el garzón, no según la ruta:**

- Con `usuarioId` → **invalida**: `pinHash = '!'`, respuesta sin PIN.
- Sin `usuarioId` → **regenera y revela**, exactamente como hoy.

Una sola ruta y no dos porque el encargado no puede elegir mal: manda el estado del garzón. El tipo
de retorno pasa de `pin: string` a `pin: string | null` (`GarzonConPin`), y `useGarzones.ts:49` lo
sigue.

El aviso de sesión abierta que hoy emite `regenerarPin()` (`:278-283`) **cambia de texto en la rama
de invalidación**: el garzón con cuenta que opera desde su dispositivo no queda trabado, solo pierde
el tótem. Decir lo contrario sería una advertencia falsa.

### 5. El historial

Tabla nueva `garzon_pin_evento`, mismo patrón que `liquidacion_propinas_evento`
(`startup-pos.sql:1785`): tenant, garzón, tipo, quién lo hizo, cuándo, con `eliminado_el` como todo
el resto.

| `tipo` | Cómo se lee |
|---|---|
| `emitido_en_alta` | *"PIN emitido al crear a Ana — Pedro, 3 de agosto"* |
| `regenerado_por_encargado` | *"Pedro generó un PIN nuevo para Ana — 12 de agosto"* |
| `invalidado_por_encargado` | *"Pedro invalidó el PIN de Ana — 12 de agosto"* |
| `invalidado_por_vinculo` | *"El PIN de Ana quedó sin efecto al vincularle su cuenta — Pedro"* |
| `fijado_por_garzon` | *"Ana puso su PIN — 12 de agosto"* |

Los dos de invalidación se distinguen porque dicen cosas distintas: uno es *"te di una cuenta"*, el
otro es *"te corté el PIN"*.

El alta **con** cuenta no emite ningún PIN, así que **no escribe evento**: la historia de ese garzón
empieza el día que él fija el suyo. `emitido_en_alta` es solo del alta sin cuenta.

**Se guarda todo, no solo lo último.** Esa es la diferencia entre un log y un dato: el patrón que
hay que poder ver es *"Pedro le regeneró el PIN a Ana tres veces esta semana"*, y se pierde si cada
cambio pisa al anterior. Por eso no alcanzan dos columnas en `garzones`.

**Nunca se guarda el PIN**, ni en claro ni hasheado, en ninguna fila de eventos — solo el hecho de
que cambió.

El evento se escribe **en la misma transacción** que el cambio de `pin_hash`. Un log que puede
quedar desincronizado del hecho que registra no sirve como registro.

**No pide motivo.** La acción es cotidiana y casi siempre legítima; un campo obligatorio ahí se
llena con "olvido" sin pensar y ensucia el registro en vez de informarlo. Lo que hace visible el
abuso es la **frecuencia**, que la tabla ya guarda.

### 6. Frontend

**Perfil del garzón** (`configuracion/perfil.vue`, que solo pide `middleware: 'auth'` — cualquier
usuario autenticado llega): bloque **Mi PIN** junto a `ConfiguracionContrasenaForm`. Dice si tiene
PIN puesto, deja fijar uno nuevo tecleándolo dos veces, y muestra su propia historia. Si la cuenta
no es garzón en el tenant activo, el bloque no se renderiza.

**Ficha del garzón** (`configuracion/garzones.vue`): el botón cambia de nombre según `usuarioId` —
*"Generar PIN nuevo"* (revela, como hoy, `revelarPin` en `:250,271,546`) o *"Invalidar PIN"* (no
muestra nada). La ficha suma un dato que hoy no existe: **si esa persona ya puso su PIN o todavía
no** — sin eso, invalidar sería a ciegas. Y el historial de la tabla de eventos.

**Pantalla del salón** (`pages/salones/index.vue`): en modo personal, si el garzón **no tiene PIN
usable**, un aviso arriba: *"Pedro invalidó tu PIN el martes 12. Poné uno nuevo desde tu perfil."*
La **condición** es el estado (`fijado: false`), no una comparación de fechas entre eventos; el
**texto** sale del último evento de invalidación. Separarlo así evita que el aviso dependa de
ordenar eventos, que es donde se cuelan los off-by-one. Sale del mismo `GET /garzones/mi-pin` que
alimenta el perfil, no de un endpoint propio. Se eligió esta pantalla y no el perfil porque es
la que el garzón **sí** abre todos los días, y no obliga a construir un sistema de notificaciones
(el proyecto no tiene ninguno).

---

## Alternativas descartadas

**Código de enrolamiento para garzones sin cuenta.** Un código de un solo uso que el garzón canjea
en el tótem para fijar su propio PIN. Suena a que cierra el agujero, pero **no prueba**: el
encargado tiene el código y puede enrolar él mismo. Agrega maquinaria para comprar una garantía
falsa, y contradice el principio que el owner fijó — *la fuerza del registro escala con si la
persona tiene cuenta*.

**Dos columnas en `garzones` (`pin_actualizado_el`, `pin_actualizado_por`).** Casi gratis, pero
guarda solo el último cambio: el patrón de abuso —lo único que el log existe para mostrar— se pierde
en cada sobrescritura.

**Tabla de auditoría ancha para todos los eventos del staff.** Más útil a futuro, pero es
infraestructura especulativa: hoy hay un solo tipo de evento que registrar.

**Rechazar el PIN elegido cuando colisiona.** Conserva la invariante actual a costa de convertir el
formulario en un oráculo de PIN ajenos, y de pagar un `bcrypt` por garzón en cada intento.

**Hacer solo la mitad "con cuenta" y dejar `regenerarPin` para después.** Deja el log cojo: el
evento que más importa vigilar —el encargado regenerando— sería el único sin registrar.

---

## Casos borde

| Caso | Qué pasa |
|---|---|
| Le invalidan el PIN a alguien **en turno** | Advierte, no bloquea — igual que hoy al regenerar. Con cuenta, el texto aclara que no pierde su dispositivo, solo el tótem |
| Dos garzones **con el mismo PIN** | Funciona: siempre se elige a la persona antes de teclear, y `verificarPin` recibe `garzonId` |
| Se **desvincula** la cuenta | El PIN elegido sigue vivo y el encargado no lo conoce. Correcto: la persona sigue trabajando |
| Alguien intenta fijarle el PIN **a otro** | Imposible: la ruta no recibe a quién, lo resuelve del token |
| La cuenta es garzón en **dos tenants** | Dos garzones, dos PIN. `TenantGuard` scopa la ruta |
| Cuenta marcada **`es_totem`** | `assertVinculable` ya la rechaza; no puede llegar a este flujo |
| Garzón **placeholder** (`Mostrador`) | Ya tiene `pinHash = '!'` y está fuera del selector. No lo toca nada de esto |

---

## Invariantes y convenciones

- `tenant_id` **siempre del token**, nunca del body — incluye las rutas de "mi PIN".
- **Soft delete** en `garzon_pin_evento` (`eliminado_el`), y toda lectura lo filtra.
- **PK/FK con `type: 'uuid'` explícito** (ADR-004, forzado por test + CI).
- La entidad nueva se registra **también en el array `entities` de `app.module.ts`** — no hay
  `autoLoadEntities`, y ni `typecheck` ni los unit tests lo cazan.
- **Sin N+1:** el historial de la ficha se resuelve en una consulta con `JOIN` a `usuarios` para el
  nombre de quien actuó, no una por fila.
- No hay dinero ni porcentajes en esta feature: `Decimal.js` no aplica.

---

## Testing

**Unit (`garzones.service.spec.ts`):** vincular invalida el PIN; desvincular no lo toca; el alta con
`usuarioId` no devuelve PIN y el alta sin cuenta sí; `regenerarPin` se parte por `usuarioId`; el PIN
elegido rechaza repetidos y escaleras; el PIN elegido acepta una colisión; "mi PIN" contra una
cuenta sin garzón da 404; cada camino escribe su evento con el `tipo` correcto.

**E2E de API:** el ciclo completo — el encargado crea un garzón vinculado (nunca ve PIN) → el garzón
fija el suyo → entra al tótem con él → el encargado lo invalida → el viejo deja de servir → el
historial tiene las cuatro líneas en orden, y la del encargado nombra al encargado. Más el contraste
que prueba el aislamiento: el garzón A no ve ni toca el PIN del garzón B.

**Frontend:** render del bloque "Mi PIN" con y sin garzón vinculado; el botón de la ficha con los dos
rótulos; el aviso del salón aparece cuando el garzón no tiene PIN usable y desaparece cuando fija
uno.

**Smoke a mano en el Chrome del owner:** el ciclo de punta a punta. En la feature anterior encontró
tres bugs que ningún test vio, uno que hacía que la pantalla del garzón nunca le apareciera a un
garzón real.

**Mutantes obligatorios**, uno por afirmación central, y cada uno debe **revertir al comportamiento
anterior** —no solo romper algo—: quitar la invalidación al vincular; devolver el PIN en la rama de
invalidación; saltear la escritura del evento.

---

## Impacto en documentación

| Archivo | Qué cambia |
|---|---|
| `docs/features/garzones.md` | El ciclo de vida del PIN, las dos mitades y el principio de la cuenta como ancla |
| `docs/features/gestion-cajas.md` | Precisión: la vía `'pin'` del testigo **no** cambia de fuerza. Enlace a esta spec |
| `docs/DIFERENCIADORES.md` | La advertencia sobre *"nadie puede firmar por otro"* **sigue vigente**; se aclara por qué |
| `docs/ESTADO.md` | Fila de la feature |
| `docs/agent/pendientes.md` | Cerrar la entrada 🔴, con la corrección de su propio encuadre |
| `startup-pos.sql` | `garzon_pin_evento` (documentación; el esquema real sale de las entidades) |

---

## Fuera de alcance

- **Renombrar "garzones" a "staff"** — entrada propia del backlog, 2.974 menciones en 104 archivos.
- **Límite de intentos en `verificar-pin`** — parte de la tanda de rate limiting, que va junta.
- **Verificación de correo del auto-registro** — otra entrada.
- **Cualquier cosa de la tanda 🔴** (conexiones, N+1, redondeo): va sola y aislada, nunca de
  arrastre.
