# Resueltos — archivo de pendientes cerrados

Entradas que salieron de [`pendientes.md`](pendientes.md) al corregirse. Cada una queda
con el texto con el que se cerró: **qué se hizo, por qué, y qué mutante o test lo fija**.

Existe porque `pendientes.md` es una lista de trabajo, y una lista de trabajo con más
entradas tachadas que vivas deja de leerse. Acá el detalle sigue disponible —las auditorías
de jul-2026 se explican solas desde este archivo— sin competir con lo que falta hacer.

Agrupadas por su procedencia en `pendientes.md`. El texto se muda **verbatim**: si una
entrada afirma algo que después resultó falso, se corrige donde se descubre, no acá.

Corolario de "verbatim": las **citas de línea de una entrada mudada quedan como estaban**,
aunque el propio cierre las haya corrido — describen el código en el momento en que se
midió el problema, que es lo que este archivo registra. En `pendientes.md`, que es texto
vivo, la regla es la contraria: ahí una cita que apunta a otra cosa se corrige o se saca.

---

## Cambiar la contraseña desde el perfil ahora sí echa al intruso (2026-08-15)

**Entrada original (verbatim):** *"🚩 **Cambiar la contraseña desde el perfil no cierra las
sesiones vivas** (backend, auditoría RBAC/auth 2026-08-15) — `me.service.ts` →
`updateContrasena` valida la contraseña actual, hashea la nueva, hace `repo.update` y
devuelve. **No toca `refresh_tokens`.** Su flujo hermano sí: `auth.service.ts:134`
(`elegirContrasena`, el reset por link) hace `refreshRepo.delete({ userId })` con comentario
explicando por qué hace falta. **Escenario:** a alguien le roban la sesión, se da cuenta,
entra y cambia su contraseña desde el perfil. El atacante **sigue adentro** hasta que su
refresh token expire, y puede renovarlo indefinidamente. Es exactamente lo que la persona
creyó estar cortando. Mecánica porque **el arreglo ya está escrito en el hermano**: una
línea. Al hacerlo, ojo con cerrar también la sesión propia de quien cambia la contraseña (o
reemitirle tokens), o el usuario se autodeslogea al cambiarla — decidir eso es parte del
fix, no una pregunta aparte."*

**El fix es la línea del hermano**, con `RefreshToken` agregado al `MeModule`:
`await this.refreshRepo.delete({ userId })` después de guardar el hash.

**La decisión que la entrada dejaba abierta: cae también la sesión propia.**

⚠️ **Y acá el primer intento se escudó en una invariante que no aplicaba.** El docblock
decía que *"todos menos el mío"* no era representable sin tocar el sistema de tokens
(`CLAUDE.md` #4). **Es falso, y lo cazó la revisión independiente:** la cookie
`refresh_token` viaja en cada request al mismo origen —`AuthController` ya la lee en
`/auth/refresh` y `/auth/logout`—, así que un `WHERE user_id = $1 AND token <> $2` habría
preservado la pestaña propia sin tocar nada del sistema de tokens.

La decisión **se mantiene**, pero por su razón verdadera: el borrado total no depende de que
la cookie llegue intacta, y ante la duda de si echar al intruso, echa a todos. Simplicidad y
robustez, no imposibilidad. También se corrigió la analogía: la comparación con
`elegirContrasena` no alcanzaba para justificarlo, porque ese flujo es **no autenticado** y
ahí el borrado total es la única opción, no una elección.

**Y por eso el fix tocó también el frontend**, que si no quedaba peor que antes:
`ContrasenaForm.vue` ahora avisa (*"Se cerraron todas las sesiones"*) y llama a
`authStore.logout()` en el momento. Sin eso, `useApiFetch` expulsa **sin explicación** en
cuanto vence el access token —hasta 15 minutos después, en cualquier pantalla—, porque su
rama de refresh fallido hace `clearAuth()` + `navigateTo('/login')` en silencio.

**Lo fija:** `me.service.spec.ts`, que no existía (el módulo `me` no tenía ningún test).
Mutante verificado: sacar el `delete` deja el test rojo **por su aserción**
(`Number of calls: 0`), no por un `TypeError` del mock. Se descartó un segundo test que
afirmaba sobre las claves del criterio: era redundante, porque `toHaveBeenCalledWith` ya
compara el objeto entero, y con el mutante fallaba por `TypeError`.

## El motor de permisos ataba el rol al usuario, pero no al tenant — y eran cinco consultas, no tres (2026-08-15)

**Entrada original (verbatim):** *"🚩 **El motor de permisos y `assignUser` no atan el rol a
su tenant** (backend, auditoría RBAC/auth 2026-08-15; **lo vieron dos lentes ciegas entre
sí**) — dos mitades que van juntas o el arreglo queda a medias: 1. `roles.service.ts` →
`assignUser` valida que el **usuario** sea miembro del tenant, pero nunca que el **`rolId`**
pertenezca a ese tenant. Sus hermanos del mismo archivo (`update`, `remove`,
`findPermissions`, `setPermissions`) sí lo hacen. 2. Peor y más de fondo: **las tres
consultas de `rbac.service.ts` unen `JOIN roles r ON r.rol_id = ru.rol_id` sin
`r.tenant_id = ru.tenant_id`** (verificado abriendo el archivo), y la del permiso completo
tampoco ata `tenant_modulos` al tenant. O sea que una fila cruzada **se evalúa de verdad**:
no es una fila inerte. ⚠️ **Severidad media, no alta, y el encuadre importa:** la ruta exige
`TenantAdminGuard`, así que el actor ya es admin de su tenant; `ru.tenant_id` es siempre el
del token, así que **no hay acceso a datos de otro tenant**; y hace falta conocer el UUID de
un rol ajeno (trivial en el seed, no adivinable en prod). Lo que se cruza es el borde de
módulos contratados — ver la entrada de ese tema en la sección 4. **Arreglar solo
`assignUser` deja el motor confiando** en cualquier fila que entre por otro camino. Es el
patrón de 'fix a medias' que este método ya cobró una vez."*

**La entrada subcontaba: son cinco consultas, no tres.** Medido abriendo el archivo — las
dos de `userHasPermiso`, la de `userIsTenantAdmin` y las dos de `getMisPermisos` unen
`roles` por `rol_id` a secas. Las cinco llevan ahora
`AND r.tenant_id = ru.tenant_id` **en el JOIN**, no en el `WHERE`, para que el invariante se
lea donde se une.

**`tenant_modulos`:** el JOIN de `userHasPermiso` no ataba el tenant; el de `getMisPermisos`
sí, pero por `WHERE tm.tenant_id = $2`. Se unificó: los dos lo atan en el JOIN
(`tm.tenant_id = ru.tenant_id`) y se sacó el `WHERE` duplicado. En un archivo que decide
accesos, que dos consultas gemelas se escriban distinto es peor que la línea de más.

**Lo que hubo que verificar antes de tocar nada: `roles.tenant_id` es nullable**, así que
atar el JOIN dejaría afuera cualquier rol global. Medido: **cero filas con `tenant_id`
NULL** en la base, y los seis `INSERT INTO roles` del seeder más `RolesService.create` lo
setean siempre. La columna nullable es herencia, no una función. Queda anotado en el
docblock: si algún día se quiere un rol global, que conceda permisos en todos los tenants
tiene que ser una decisión de producto, no la herencia de un JOIN sin atar.

**La otra mitad:** `assignUser` ahora busca el rol con `findOne({ where: { id, tenantId } })`
y tira `NotFoundException`, igual que sus cuatro hermanos del mismo archivo. Valida el rol
**antes** de consultar la membresía del usuario.

**Lo fija:** dos specs que no existían — `rbac.service.spec.ts` (10 tests) y
`roles.service.spec.ts` (6). Cubren primero **lo que concede** acceso, no lo que lo niega,
porque un `return true` sin test es peor que un `return false` sin test. Las aserciones de
SQL corren sobre las consultas **efectivamente ejecutadas** (`dataSource.query.mock.calls`),
no sobre el texto del archivo, así que el docblock que menciona la misma cláusula no las
puede satisfacer por accidente. Tres mutantes verificados, los tres rojos por aserción:
quitar la atadura de `roles` en una sola consulta, quitar la de `tenant_modulos`, y quitar
la validación de rol de `assignUser` (mata 3 tests).

**El gemelo que no busqué, y lo encontró la revisión independiente.** Grepeé la carpeta de
cada módulo, no el repo entero — el error que este método ya cobró antes.
`garzones.service.ts` → `assertVinculable` lleva **la misma consulta duplicada a mano**, y su
propio docblock dice que *"replica el criterio de `RbacService.userHasPermiso`"*. Había
quedado desincronizada. Se le aplicaron las mismas tres ataduras (las dos subconsultas de
`roles`, más `tenant_modulos`), y se le agregó al docblock la advertencia de que **por ser
copia se desincroniza sola**, con este caso como precedente. Mitigante que igual conviene
saber: `puede_operar_salon` es dato advisorio, no gatea acceso.

**Y el gate estaba verde sobre líneas que nadie ejecutaba.** Segundo hallazgo de la revisión:
los unit corren con `DataSource`/`Repository` mockeados, y **ningún e2e pegaba a
`/rbac/mis-permisos`, `/rbac/es-admin` ni `PATCH /me/contrasena`**. O sea que el SQL
reescrito nunca había tocado Postgres. Se agregó `test/rbac-y-contrasena.e2e-spec.ts`
(7 tests): el caso 2 de `getMisPermisos` con `vendedor@paris.cl` —el único actor sin rol
fijo—, el contraste admin vs vendedor, y la muerte del refresh token al cambiar la
contraseña **con un control positivo al lado**, para que el 401 no pueda venir de que el
refresh nunca funcione en e2e. Cuenta registrada por test, no del seed: cambiarle la
contraseña a `vendedor@paris.cl` la rompería para las otras seis specs que loguean con ella.
Mutante verificado contra la base real: romper la atadura del caso 2 deja al vendedor con
**cero** permisos y el test rojo — o sea que el e2e ejercita la consulta, no la mira.

⚠️ **Lo que NO cierra:** la cobertura de `roles.service.ts` es solo de `assignUser`.
`setPermissions`, `findPermissions`, `create`, `update` y `remove` siguen sin test — ver la
entrada reducida en `pendientes.md`.
⚠️ **Y lo que el e2e NO prueba:** el aislamiento entre tenants propiamente dicho. Montar una
fila de `roles_usuarios` apuntando a un rol ajeno **ya no es posible por API** —era la mitad
del fix—, y armarla con SQL directo probaría un estado inalcanzable. Esa mitad la fijan los
unit, que afirman sobre la forma del SQL ejecutado.

🚨 **Y lo más importante: este frente NO está cerrado.** Queda vivo un **tercer gemelo** —
`tenants.service.ts:338`, en `findMembers`— con el mismo `JOIN roles` sin atar el tenant. Se
dejó afuera a propósito, porque ahí el JOIN es `LEFT` y la decisión no es un copy-paste; la
entrada está en [`pendientes.md`](pendientes.md). **Si estás leyendo esto para saber si el
criterio de permisos ya ata el tenant en todos lados: todavía no.** La advertencia va acá y
no solo allá porque `resueltos.md` es el archivo que se consulta para dar algo por cerrado, y
el link entre los dos archivos era de una sola dirección.

## Las dos preguntas que abrió el día, contestadas el mismo día (2026-08-15)

Las dos nacieron al cerrar entradas mecánicas: al abrirlas resultó que no lo eran, y se
elevaron en vez de resolverse solas. El owner las contestó y quedan cerradas.

### El historial de PIN: se topea, **con aviso**

**La pregunta:** `garzon_pin_evento` solo crece —el diseño decidió guardar todos los cambios
de PIN, no solo el último— y dos pantallas lo traían entero en cada carga. ¿Alguien necesita
verlo completo, o con los últimos N alcanza?

**La respuesta del owner: topear, pero que se note.** Ni paginar de verdad (nadie pidió
navegar el historial: se mira el final) ni topear a secas, que **recorta la historia en
silencio** — la pantalla muestra menos y nada avisa que hay más.

**Cómo quedó:** `eventosPinDe` devuelve `{ eventos, total }` — los últimos **50** más el
conteo completo, en dos consultas paralelas. El total **no lleva el `LIMIT`**: si lo llevara
toparía en 50 y el aviso diría *"50 de 50"*, o sea mentiría con más pasos.
El aviso vive en `PinEventosLista.vue` y no en cada pantalla, porque ese componente lo montan
**las dos** (la ficha del encargado y el perfil del garzón): *"Mostrando los últimos N de M"*,
y solo cuando efectivamente hay más.

⚠️ **Es un cambio de contrato**, y se llevó puesto lo que tenía que llevarse: el spec de la
ficha, el de `MiPinForm`, y un e2e que trataba la respuesta como array. Los tres se
actualizaron; que se pusieran rojos es exactamente lo que se esperaba de ellos.
**Mutantes:** sacar el `LIMIT` deja el test rojo por su aserción, y sacar el cartel del
componente también.

### Sin `SMTP_HOST` en producción: el sistema **sigue arrancando**

**La pregunta:** el agujero de la fuga ya estaba cerrado (el cuerpo del mail nunca se escribe
en el log). Lo que quedaba era si el arranque debía **negarse a levantar** sin SMTP.

**La respuesta del owner: no.** Se queda como está — arranca y registra un `error` diciendo
que ningún mail va a salir.

**Por qué es la correcta, y no solo la cómoda:** negarse a arrancar deja el **POS entero
caído** porque el mail no está configurado — nadie vende porque nadie puede invitar usuarios.
Y contradice el docblock de `MailService`, que dice explícitamente que este service **nunca
lanza hacia arriba**: un mail que no sale no puede tumbar la operación que lo originó.
**No hubo cambio de código**: la decisión confirma el comportamiento vigente. Lo que cambia
es que deja de ser un default accidental y pasa a ser una decisión registrada.

🔎 **Sigue pendiente el dato que decide la urgencia**, que no se consultó a propósito porque
listar variables de Railway expone credenciales: **¿el deploy de producción tiene `SMTP_HOST`
seteado?** Un clic en el dashboard. Ya no hay fuga en ninguno de los dos casos; lo que cambia
es si hoy los mails llegan o no llegan.

## La sección mecánica queda vacía: segunda tanda, once entradas más (2026-08-15)

Segunda tanda paralelizada, con la regla que salió de la primera: **repartir por dueño de
archivo, no por cantidad**. Los grupos fueron `tenants` (5 entradas, todas sobre
`tenants.service.ts`), `garzones` (2 sobre el mismo archivo), `roles` (2, porque la segunda
tiene que cubrir a la primera) y uno de **cobertura e2e pura** (2). El principal tomó la que
cruzaba módulos.

### Lo que se cerró

- **El tercer gemelo del criterio de permisos** (`findMembers`): atado en el `ON` y no en el
  `WHERE`, porque el JOIN es `LEFT` y ponerlo en el `WHERE` **haría desaparecer del roster** a
  cualquier miembro sin rol.
- **`switchTenant` no miraba si el tenant estaba borrado.** Su hermano `getMyTenants` sí.
  Devolvía 200 y un token para un tenant muerto; `TenantGuard` cortaba en la ruta siguiente,
  así que el usuario se enteraba un request después y con otro error.
- **Re-agregar a alguien le resucitaba `es_totem`**, en los dos caminos de revival.
- **El alta de usuario devolvía un 500 crudo** en la carrera del `23505`, en vez del 409
  accionable que ya tiraba el chequeo deliberado.
- **`setPermissions` no era transaccional** —si el `save` fallaba, el `delete` ya había
  commiteado y el rol quedaba sin permisos— **y su body no lo validaba nadie**: el `@Body()`
  estaba tipado con una interfaz inline, cuyo `metatype` reflejado es `Object`, que
  `ValidationPipe` excluye. Ahora hay una clase DTO.
- **`miPin` hacía cuatro consultas**: `listarEventosPin` volvía a buscar el garzón que el
  llamador ya tenía en memoria. Se partió en el método público (que sigue validando, porque su
  otro llamador recibe el id por URL sin validar) y un privado con solo la query.
- **Dos tests de aislamiento que no aislaban** y **dos coberturas e2e que no existían**: el
  efecto de invalidar el PIN al vincular, y una venta con un ítem en moneda extranjera.
- **`nombre: null` reventaba con 500** en los tres catálogos, más el nombre del **tenant** y el
  del **perfil**.

### Los tres errores que cazó el trabajo, no la lectura

1. **Una trampa del seed que habría hecho pasar un test falso.** Para probar "un `usuarioId`
   ajeno al tenant devuelve 400", el primer intento iba a usar el único miembro de Falabella
   — que es el superadmin, y **también es miembro real de Paris**. Habría devuelto 200 y el
   test habría "pasado" sin probar nada. Se corrigió creando un usuario propio de Falabella,
   siguiendo el patrón que `alta-usuarios-tenant.e2e-spec.ts` ya usa para el mismo problema.
2. **Una entrada del backlog se puso obsoleta a mitad de la tanda.** El agente de `tenants`
   estaba copiando el patrón de `UpdateCausaMermaDto` cuando el principal, en paralelo, le
   agregó un tercer decorador a ese mismo archivo. Lo detectó releyendo y **lo verificó
   empíricamente** —escribió un spec descartable para confirmar que `@IsOptional()` deja pasar
   `null`— en vez de confiar en el texto de la entrada o en su primera lectura.
3. **Un mutante mal aplicado dio un falso "test decorativo".** Al verificar la cobertura de
   moneda extranjera, el primer `perl -0pi -e "s/\.times\(tasa\)/…/"` **sin `/g`** reemplazó
   la primera ocurrencia, que estaba **en el docblock**, no en el código. El test pasó y
   parecía inútil. Repetido sobre la línea real: `Expected "9500.0000", Received "0.0105"`.
   Es la misma trampa que el repo ya tiene anotada para las aserciones sobre SQL, esta vez
   del lado del mutante.

### Y un cuarto error, cazado por la revisión en el archivo del propio fix

`update-my-tenant.dto.ts` blindó `nombre` con el trío de decoradores **y dejó `correo` y
`provinciaId` con `@IsOptional()` puro** — las dos columnas son igual de `NOT NULL`, así que
seguían con el mismo 500 que el cambio decía cerrar. Mismo archivo, mismo commit, misma
motivación escrita arriba. Cerrado con su mutante; `telefono` y `direccion` sí conservan
`@IsOptional()` a propósito, porque sus columnas son nullables y ahí `null` es la forma
legítima de **borrar** el dato.

### Y una que se elevó en vez de cerrarse

El `LIMIT` de `listarEventosPin` **no era mecánica**. Topear recorta la historia sin decirlo;
paginar con el patrón que el repo ya usa en 8+ módulos cambia el shape de la respuesta y toca
las dos pantallas que la consumen. Pasó a la sección 4 con la pregunta concreta.

### La decisión que no se tomó sola

Ante el array vacío en `setPermissions` —¿bug o función?— el agente **buscó precedente en vez
de decidir**: `cajones` tiene el mismo patrón con el comentario *"array vacío es válido: deja
el cajón sin asignados"*, dentro de una transacción. Lo trató como decisión ya tomada por el
proyecto y lo dejó marcado por si ese precedente no aplica a permisos.

## Once entradas mecánicas en paralelo, y los dos huecos que la paralelización destapó (2026-08-15)

Primera tanda corrida con **cinco agentes en paralelo**. Lo que decidió la partición no fue
el conflicto de archivos sino **los recursos compartidos**: hay un solo Postgres y
`reset-db.sh` hace `docker-compose down -v`, así que un agente que lo corra le vuela la base
a los otros cuatro; y el backend bind-montea el fuente, así que editar un `.ts` recompila y
**re-siembra** el contenedor de todos. Los worktrees no lo arreglan, lo empeoran: el stack de
compose no ve los archivos del worktree, así que un e2e ahí correría contra el código viejo y
volvería verde sin probar nada.

**La regla que salió, y que conviene sostener:** los agentes **escriben y corren solo su
propio spec**; el gate completo lo corre el principal, **en serie**, al final. Dos
`nuxt build` concurrentes también se pisan el `.nuxt/`.

### Lo que se cerró

- **La moneda del ítem no llegaba a la pantalla de mermas.** `inventario` ya traía
  `i.moneda_id` en el kardex; `mermas` tenía **cero** ocurrencias, así que un ítem importado
  en USD mostraba su merma como si fueran pesos. ⚠️ La entrada decía *"los dos `SELECT`"* y en
  realidad el `COUNT(*)` no selecciona columnas: los que había que tocar eran **el de `findAll`
  y el del `POST`**, que arma su propia fila y la inserta en el listado sin refetch — sin eso,
  la merma recién creada quedaba con el bug hasta recargar. Ese segundo no estaba en la entrada.
- **Se podía dejar sin nombre una causa de merma o un motivo de diferencia.** Esta entrada se
  equivocó **dos veces** antes de cerrar, y las dos las cazó algo distinto:
  1. ⚠️ **Eran tres DTOs, no dos.** Existen dos módulos vivos con rutas distintas
     —`/motivos-diferencia` y `/motivos-diferencia-inventario`— y la entrada nombraba solo el
     segundo, que **no** es el que sirve la ruta que el test nuevo golpea. Lo cazó el e2e:
     `Expected 400, Received 200` con el DTO "arreglado".
  2. ⚠️⚠️ **Y `@IsNotEmpty()` no cerraba el hueco.** Rechaza `''` exacto, **no `'   '`**; y
     como el service hace su `.trim()` **después** de validar, un nombre de solo espacios
     reproducía el bug entero. Los tres e2e probaban `''` y ninguno `'   '`, así que el gate
     pasaba en verde sobre un arreglo que no arreglaba. Lo cazó la **revisión independiente**,
     que lo verificó corriendo `class-validator` de verdad en vez de razonarlo.
     El arreglo correcto ya existía en el repo y no lo busqué: `RestaurarDto` tiene un
     `@Transform` que trimea **antes** de validar, con un comentario que dice literalmente
     *"`" "` tiene que fallar el `@IsNotEmpty` igual que `""`"*. Se copió a los tres.
  Los tres quedan cubiertos por e2e —`causas-merma`, `motivos-diferencia` y
  `motivos-diferencia-inventario`, este último dentro de `recuentos.e2e-spec.ts`— con los dos
  casos, `''` y `'   '`, porque quien rechaza es el `ValidationPipe` y en unit no corre.
  Mutante verificado: sacar el `@Transform` devuelve 200 y pone el test rojo.
  🔎 Al buscar el resto **por conducta y no por nombre** (campos `string` opcionales con
  `@MaxLength` y sin `@IsNotEmpty()`, en todo `src/**/dto/`) aparecieron **9 sitios**: siete son
  `comentario`/`apellido`/`telefono`, donde vacío es legítimo, y uno es el nombre del **tenant**,
  que quedó como entrada nueva en `pendientes.md`.
- **El e2e del simulador de costos comparaba contra el valor viejo.** `not.toBe('1200.0000')`
  pasaba con cualquier recálculo equivocado. Ahora compara contra `costoPropuesto` y
  `precioSugerido`, que **la propia bandeja devuelve**: sin números hardcodeados que se
  desincronicen si cambia la fórmula del CPP.
- **El e2e de mermas no miraba el stock.** La respuesta ya traía `stockResultante` y nadie lo
  leía. Se afirma contra el stock previo **y** contra la base con un `GET` posterior: un
  `stockResultante` bien calculado y mal persistido pasaba lo primero.
- **El reintento por deadlock de `RecuentosService.aplicar` no lo ejercitaba nada** (cero
  ocurrencias de `40P01` en 754 líneas de spec). Cuatro tests: reintenta y sale bien, no
  reintenta con otro `code`, no reintenta si no es `QueryFailedError`, y si el reintento
  también falla el error que se propaga es **el del segundo intento** (`toBe` por referencia).
- **Las dos barreras de tenant de serie y lote no tenían test.** ⚠️ Las líneas de la entrada
  habían derivado. Y el primer intento cayó justo en la trampa que el brief advertía: con el
  mock incompleto, el mutante fallaba por `TypeError` de una query no mockeada en vez de por la
  aserción; se completó la cadena de mocks hasta el final del camino feliz.
- **`/admin` era la única página sin guard de cliente.** El middleware correcto es `auth`, no
  `admin`: `middleware/auth.ts:27-31` tiene un branch propio para `/admin` que chequea
  `isSuperadmin`, mientras que `admin.ts` chequea `esAdmin` **del tenant** y redirige a
  `/configuracion`. Eran ejes distintos.
- **El garzón veía un toast rojo de permiso en la carga inicial de `/salones`.** Se silenciaron
  las cuatro llamadas de fondo (`/items` ×3 y `/tipos-documento`) **una por una y no en
  bloque**: `cargarCatalogo` incluye `/metodos-pago`, que el garzón **sí** puede leer, y un
  `.catch` en el call-site habría tapado un fallo real de esa. Hay un segundo test de
  contraejemplo que lo prueba.
- **Tres pantallas sin spec** (`ventas/pos.vue`, `tienda/index.vue`,
  `tienda/suscripciones.vue`): borrar `&activo=true` de una URL dejaba la suite en verde. El
  arnés se copió del spec de `salones/index.vue`. La de suscripciones resultó distinta: su
  consulta no sale en `onMounted` sino al abrir el drawer, gateado por permisos.
- **Dos de documentación.** El paso 4 de la prueba manual de `garzones.md` no se podía
  completar al pie de la letra —el selector solo lista garzones **con turno abierto** y el seed
  no abre ninguno, así que salía vacío y sin ningún mensaje que lo explicara—, y la spec del
  testigo prometía conteo a ciegas *"sin excepciones"* cuando el admin del tenant sí ve lo
  esperado (decisión del owner del 2026-08-13).

### Los mutantes

**Once entradas, once verificaciones.** Todos los agentes reportaron el mutante aplicado, el
test que se puso rojo **por su aserción** y el `git diff` vacío del archivo restaurado. Dos
merecen mención: el de `/salones` reprodujo el síntoma exacto del reporte (*"No tienes permiso
para esta acción"* en el array de toasts capturados), y el de serie/lote hubo que rehacerlo
porque el primero moría por `TypeError`.

## El log que reintroducía el token en claro, y el arranque que se dejó como está (2026-08-15)

**Entrada original (verbatim):** *"🚩 **Sin `SMTP_HOST`, los links de reset e invitación
quedan en el log en texto plano — y nada lo impide en producción** (backend, auditoría
RBAC/auth 2026-08-15) — `mail.service.ts` → `enviar()`: si no hay transporte, hace
`logger.log()` con el **cuerpo completo** del mail, que es el que lleva la URL con el token
en claro. **Grep de `NODE_ENV`/`production` en ese archivo: cero** (medido). `.env.example:49`
trae `SMTP_HOST=` vacío por default. ⚠️ **Loguear en vez de mandar es una decisión cerrada y
documentada** (hace falta para no disparar mails reales en cada corrida de CI). Lo que no
existe es el **gate de producción**: el sistema degrada en silencio a 'escribir el secreto en
el log' en vez de fallar fuerte. Tiene su ironía: `TokenAcceso` guarda solo el hash SHA-256
justamente para que el texto plano exista **una sola vez**, en el link del mail. Este log lo
reintroduce en el lugar que más gente puede leer."*

**El fix:** con `NODE_ENV=production` y sin `SMTP_HOST`, `enviar()` registra un `error` con
**destinatario y asunto** —lo necesario para reenviar a mano— y **ni una línea del cuerpo**.
El aviso de arranque también sube de `warn` a `error`. Fuera de producción no cambia nada: el
fallback con el link clickeable en el log es el loop de desarrollo y es deliberado.

**Lo que NO se hizo, y por qué:** negarse a arrancar sin SMTP en producción. Sería *fallar
fuerte* de verdad, pero deja el POS entero caído porque el mail no está configurado, y
contradice el docblock de la clase, que dice explícitamente que **este service nunca lanza
hacia arriba**. Es decisión de producto: quedó como entrada abierta en
[`pendientes.md`](pendientes.md), no resuelta por cuenta propia.

**Lo fija:** `mail.service.spec.ts`, que no existía. Ocho tests, y el que importa es el que
mete un token reconocible en el cuerpo y afirma que **no aparece en ninguno de los tres
niveles de log**. Mutante verificado: quitar el guard de producción deja
`TOKEN-EN-CLARO-abc123` escrito y dos tests en rojo por su aserción.

## El `expect` que faltaba en 29 specs destapó un test que nunca había probado nada (2026-08-15)

**Entrada original (verbatim):** *"🚩 **Los 23 helpers de login del e2e no afirman su status,
y eso fabrica el 401 intermitente** (backend/tests, auditoría RBAC/auth 2026-08-15) — **esto
explica la forma de los cuatro avistajes** de la entrada del flaky. Medido: 23 de los 32
`*.e2e-spec.ts` leen `resLogin.body.access_token` / `resTenant.body.access_token` **sin
verificar `.status`**. Si el login o el `switch-tenant` fallan una vez, `token` queda
`undefined` en silencio y todo el resto del `describe` manda `Authorization: Bearer undefined`
— que `JwtAuthGuard` rechaza con **401 en la siguiente ruta que se pida, no en la que falló**.
Un solo test por corrida, siempre otra ruta, nunca reproduce: la firma exacta."*

**La entrada subcontaba otra vez: son 29 archivos, no 23** — y **71 sitios**, no uno por
archivo (`recuentos` tenía seis, `caja`/`papelera`/`recetas`/`alta-usuarios` cuatro cada uno).
Se midió por **conducta**, no por forma: cualquier `const <var> = await request(...)` cuya
`<var>.body` alimente un `access_token`, sin `expect(<var>.status)` cerca. Las siete formas
distintas de helper que hay en el repo hacían inútil buscar por texto.

⚠️ **Dato que se cobró en el momento: `/auth/login` y `/auth/switch-tenant` devuelven 200, no
201** — los dos llevan `@HttpCode(HttpStatus.OK)`. El primer intento asumió 201 y puso cuatro
specs en rojo.

**Y lo que la barrida destapó, que es el verdadero valor:**
`ventas.e2e-spec.ts` → *"retorna 400 si no hay caja abierta para el usuario"* **estaba verde
sin ejercitar nada**. Logueaba con `password: 'Vendedor1234!'` cuando el seed usa `'admin'`
—como los otros seis specs que usan esa cuenta—, así que el login devolvía 401, el token
quedaba `undefined`, y un `if (!vendedorToken) return` con el comentario *"si el usuario
vendedor no existe en seed, saltear"* **salía del test antes de pedir nada**. El escape existía
para tolerar un seed que sí tiene esa cuenta hace tiempo.
Se corrigió la contraseña, se agregó el `switch-tenant` que faltaba, se borró el escape, y se
apretó la aserción: ahora además del 400 comprueba el mensaje `'No tienes una caja abierta'`,
porque cualquier fallo de validación del body daría 400 igual y el test dice cubrir la caja.

⚠️ **Lo que esto NO resuelve:** por qué el login falla esa vez. La entrada ya lo decía y sigue
siendo cierto — esto explica la **propagación**, no el disparador. Lo que cambia es que el
próximo rojo cae en el login y dice qué contestó, en vez de aparecer dos rutas más tarde.

**El porqué quedó en un solo lugar**, no replicado en 29 archivos: `docs/patterns/backend.md`
§7. No se agregó a `anti-patterns.md` porque ese archivo está en su tope de 20 entradas y su
propia regla 3 pide hacer lugar antes de sumar, que es trabajo aparte.

---

## El redondeo de la conversión de moneda: dos sitios, y el que importaba no era el anotado (2026-08-11)

**Entrada original (verbatim):** *"**`convertirAMonedaOficial` redondea a 4 fijo** (backend,
`calculo-precios.service.ts:188`) — **hallazgo del refutador, ninguna lente lo vio**: el
`.toFixed(4)` ignora `escalaCalculo` y `modoRedondeo` del tenant, y ocurre justo antes de
entregarle el precio al motor que sí los respeta. Un paso de redondeo fuera de la config."*

Los dos hechos que afirma son ciertos. Lo que estaba mal era todo lo demás: **el sitio, y
que fueran un solo problema.**

**Primer intento, revisado y revertido sin commitear.** Se arregló el modo en
`convertirAMonedaOficial` y se documentó el 4. La revisión independiente lo bloqueó midiendo
lo que el docblock afirmaba: **la venta nunca pasa por esa función**. `ventas.service.ts`
hacía su propia conversión (`precioOrigen × tasa`, `.toFixed(4)`) y la pasaba como
`precioUnitario`, así que la rama del `??` nunca se tomaba — y ese era el número que se
persiste en `venta_detalles.precio_unitario`. El arreglo cubría solo la previsualización.
Peor: **creaba una divergencia que no existía**. En el alta de suscripciones el monto que se
le autoriza a la tarjeta sale de `calcular` y el que se guarda lo reconvierte la venta; los
dos eran HALF_UP y coincidían. Con medio arreglo, un tenant en `FLOOR` podía ver los dos
números distintos. Se revirtió el código a HEAD y se reescribió la entrada con lo medido
(commit `eb873e86`).

**Después, con el owner decidiendo "los tres sitios juntos", se midió el tercero y no
existía.** El `.toFixed(4)` de `precioBase + precioExtraTotal` **no puede redondear**:
`precio_extra` es `NUMERIC(18,4)` y `items.service.ts` rechaza unidades fraccionarias en las
dos ramas (extras: *"deben ser un entero mayor o igual a 1"*; grupos: *"Las unidades de la
opción deben ser un entero ≥ 1"*). La revisión lo reforzó: `precioExtraTotal` llega **ya**
con `toFixed(4)` desde los tres resolvers de `items.service.ts`, así que la suma es de dos
strings de 4 decimales pase lo que pase. Son **dos** sitios reales, los dos `precio × tasa`.
Queda un comentario para el día que las unidades admitan fracción — apuntando a
`items.service.ts`, que es donde caería ese redondeo, y no a ventas.

**Qué se hizo.** Los dos sitios pasaron a ser **uno**: `convertirAMonedaOficial` es pública y
la llaman los dos caminos. Esa era la causa de fondo —dos copias de la misma cuenta pueden
arreglarse por separado, y eso fue exactamente lo que casi pasa—. `modoToRounding` se exportó
del motor en vez de duplicar el `switch`. Y `cargarConfig` es pública para que ventas cargue
las preferencias una vez, convierta con ese modo y se las pase a `calcular` por
`configPrecargada`: **no son consultas nuevas**, son las dos de siempre movidas unas líneas
más arriba.

**Lo que no se tocó, y por qué.** La escala sigue en 4. `escala_calculo` es, según el
esquema, "decimales para cálculos intermedios"; este valor no es intermedio, se persiste en
`NUMERIC(18,4)`. Subirlo no evitaría el recorte: lo movería al `INSERT`, donde lo hace
Postgres con su propia regla, fuera de la config y sin que ningún test lo vea. **Cuidado con
cómo se escribe esto**: la primera redacción decía "las otras 74 columnas de plata del
esquema" y la revisión lo refutó —hay 75 `NUMERIC(18,4)` pero ~23 son cantidades y stock, y
hay plata a 6 decimales (`monto_tolerancia`, los montos de la pasarela)—. La afirmación que
se sostiene es acotada: *el libro mayor de ventas* va a 4.

**Lo que este cierre NO cierra, anotado para que no se lea de más.** "Único redondeo de
plata fuera del motor" era falso y la revisión lo refutó con contraejemplos: el CPP de
inventario, el costo propuesto de una receta, el reparto de propinas y dos sitios de mermas
siguen en HALF_UP fijo. Lo que sí se verificó es lo acotado: **un solo `.times(tasa)` en todo
`backend/src`**. Los que quedan abrieron entrada propia en [`pendientes.md`](pendientes.md),
porque la entrada que los habría alcanzado es justo la que este cierre borra.

**Magnitud** (`19.99 × 950.123456 = 18992.96788544`): el modo mueve el precio unitario en
`0.0001` (`FLOOR` → `18992.9678` en vez de `18992.9679`). No es plata que se pierda; es la
configuración del tenant desobedecida, en el número que queda guardado.

**Qué lo fija:** cuatro tests y **tres mutantes, cada uno muerto por el test que le toca**.
En `calculo-precios.service.spec.ts`: el modo (`FLOOR → …9678`, `CEIL`/`HALF_UP → …9679`, con
tasa de 6 decimales a propósito — con la tasa redonda del resto del spec los cuatro modos dan
igual y el test no probaría nada), la escala persistida, y que `configPrecargada` evita la
segunda consulta. En `ventas.service.spec.ts`: que el modo del tenant llega a la conversión
**que se persiste** — el test que faltaba en el primer intento y que habría bloqueado el
arreglo a medias solo. Los mutantes: volver al `.toFixed(4)` en `calculo-precios.service.ts` —el service, no el
`engine`— cae el primero;
devolverle a ventas su conversión propia cae el de ventas; subir `ESCALA_PERSISTIDA` a 6 cae
dos. Ese último existe porque el arreglo **se ve** incompleto e invita a "terminarlo".

## El alta de una suscripción cobraba y se callaba lo que el motor tenía para decir (2026-08-11)

**Entrada original (verbatim):** *"**`suscripciones.service.ts:87-90` descarta
`resultado.advertencias`** (backend, medido 2026-08-03) — la justificación escrita ("hoy
ningún ítem de suscripción tiene descuentos") es más angosta que la superficie nueva: ahora
ese descarte también se traga los avisos de regla o impuesto pausado sobre el primer
período."*

**La entrada apuntaba al descarte equivocado.** El alta llama al motor **dos veces**: en el
paso 5 para saber cuánto autorizarle a la tarjeta, y otra vez adentro de la venta del paso 9.
La entrada nombra el primero; el que perdía información era el segundo.

El criterio para elegir no es de contenido sino de **autoridad**: la venta es el cálculo que
queda persistido, así que sus advertencias explican la fila que existe; las del paso 5
explican un intermedio que no sobrevive. Hoy los dos conjuntos son **idénticos** —argumentos
equivalentes, y las advertencias que la venta agrega por su cuenta son de recetas y combos,
inalcanzables acá porque el paso 1 rechaza todo lo que no sea `tipo='suscripcion'`—. La
primera redacción de este cierre decía "superconjunto" y que la venta "le suma recetas y
combos": **la revisión independiente lo refutó leyendo el código**, y el docblock quedó
reescrito sobre la autoridad, que es el argumento que sí se sostiene si los dos conjuntos
alguna vez divergen (los dos caminos arman su mapa de tasas por consultas distintas).

**Qué se hizo.** `crear()` devuelve `advertencias: string[]` tomadas de `venta.advertencias`
— siempre presente, vacío si no hay nada, misma convención que `garzones.service.ts` (sin eso
el cliente no distingue "no hubo nada que avisar" de "este endpoint no avisa"). El composable
`useSuscripciones` las separa del resto en vez de guardarlas en la fila: describen el cobro
que acaba de ocurrir, no el estado de la suscripción. La página las emite como un toast por
mensaje, igual que `ventas/pos.vue` con una venta. El descarte del paso 5 queda, ahora con el
porqué escrito encima.

**No frenan el alta**, y no es un descuido: para cuando existen, el cobro contra Transbank ya
ocurrió. Son la explicación de por qué el monto autorizado puede no ser el precio de catálogo,
no una confirmación previa. Que la tienda **no muestre un precio calculado antes de cobrar**
es otra cosa, y más grande: quedó anotada aparte en [`pendientes.md`](pendientes.md).

**Qué lo fija:** dos tests en `suscripciones.service.spec.ts`. El happy path exige
`advertencias: []` —vacío, no ausente—; el segundo hace que **las dos** llamadas al motor
avisen cosas distintas y afirma que sale la de la venta. Dos mutantes, los dos muertos:
borrar la línea cae 2 tests; cablearla a `resultado.advertencias` del paso 5 cae **1**, el
segundo.

**Y eso último recién es cierto después de arreglar el mock.** La primera versión de este
cierre afirmaba ese "cae 1" sin haberlo medido; la corrida real decía 2, porque el mock de
`calcular` omitía `advertencias` y el mutante producía `undefined`, que el happy path
rechazaba **por forma, no por procedencia**. Lo encontró la revisión independiente. El mock
ahora devuelve `advertencias: []` como el motor real, y con eso cada test falla por lo suyo y
el segundo es de verdad el único que sostiene la regla. La lección no es la frase mal
contada: es que **un mock infiel le presta cobertura a un test que no la tiene**, y el
recibo escrito acá la habría dado por buena.

## Con el seed a secas ya se puede ver una comanda (2026-08-11)

**Entrada original (mitad restante, verbatim):** *"Con el seed a secas
`agruparEstacionesComanda` devuelve `[]`, así que hubo que cablear una categoría por SQL
para ver una comanda en pantalla. La categoría **existe y tiene impresora** —"Ropa y
accesorios" → "Cocina", puesta a propósito con ese comentario en el seeder—, pero **no
tiene ningún ítem adentro**. El arreglo es asignarle `categoriaId` a un ítem vendible del
seed, no crear categoría ni impresora."* (La mitad de test se había cerrado el 2026-08-09.)

**Un parámetro de más en un `INSERT`:** la receta "Hamburguesa Especial" ahora se siembra
con `categoria_id`. La intención ya estaba escrita en el seeder desde la feature de
impresión —*"Demo: rutea a Cocina para poder probar el flujo de comanda sin configurar
nada manualmente"*— y nunca llegaba a ningún ítem: la categoría ruteada estaba vacía.

**Verificado como pide la entrada —a mano, con el seed y nada más—**, no con un test que se
monta sus fixtures (ese ya existía). Reset, y por API: garzón, turno, salón y mesa del
seed, la hamburguesa a la cuenta, `GET /cuentas/:id/comanda/pendiente` →

```
estaciones: [{ nombre: "Cocina", items: [{ nombre: "Hamburguesa Especial", cantidad: "1" }] }]
```

Antes de esto, `estaciones: []`.

**Se eligió la receta y no un producto** porque una comanda de cocina con una hamburguesa
es el demo que alguien va a querer mirar. Y **no se renombró la categoría**, aunque
"Hamburguesa Especial" bajo "Ropa y accesorios" queda raro: el nombre está referenciado en
[`impresion-termica.md`](../features/impresion-termica.md) y en el plan de esa feature, así
que renombrarlo se ramifica más de lo que la entrada pedía. En la comanda no se ve —agrupa
por impresora, así que el ticket dice "Cocina"—; se ve en la pantalla de ítems.

**El seed es el escenario inicial de los 30 specs**, que era el riesgo que la entrada
marcaba: e2e completo en verde, 398 tests.

---

## Una asimetría de guard que no era un pendiente sino un porqué (2026-08-11)

**Entrada original (verbatim):** *"Asimetría de guard entre rutas hermanas (backend) —
`GET /items/:id/uso` exige `Items:Eliminar`; la ruta hermana
`GET /items/:id/recetas-afectadas` exige solo `Items:Leer`. Es una decisión deliberada
(solo quien puede borrar necesita ver el impacto del borrado), no un descuido — se anota
por si el frontend en algún momento quiere el dato de uso fuera del flujo de borrado."*

**No había nada que hacer, y por eso estaba mal ubicada.** `pendientes.md` es una lista de
trabajo; esto es la explicación de una línea que **parece** un error y no lo es. Vivía
donde nadie lo iba a leer en el momento en que importa: al mirar el guard.

Se movió a un docblock sobre la ruta, con la condición que la reabriría —si el front quiere
el dato de uso fuera del flujo de borrado, este guard no alcanza— escrita ahí mismo.

---

## El e2e no fijaba `testTimeout`, así que cada spec tenía 5 segundos para arrancar (2026-08-11)

**No venía del backlog: apareció en el gate.** Cerrando otra cosa, `garzon-modo-personal`
se puso rojo con 14 tests caídos y un solo motivo: *"Exceeded timeout of 5000 ms for a
hook"* en su `beforeAll`. La re-corrida sobre base fresca dio verde — flaky, no regresión.

**La causa no era de ese spec.** `test/jest-e2e.json` no declaraba `testTimeout`, así que
todos los hooks caían en el **default de Jest: 5 segundos**. Y el `beforeAll` de cada spec
e2e compila el `AppModule` **entero**. Doce de los specs no tenían timeout propio —los
otros lo habían parchado uno por uno con `}, 60000)`— o sea que estaban todos a un arranque
lento del mismo fallo, y el que cayó fue cuestión de suerte.

`"testTimeout": 30000` en la config, que en Jest aplica a tests **y** hooks. Seis veces el
default, y sigue muy por debajo del tope de 25 min que el job de CI tiene desde hoy: un
cuelgue real se sigue reportando, lo que deja de reportarse es un arranque lento.

**Por qué se anota una config de tres palabras:** el flaky costó una re-corrida completa
del gate para descartar que fuera una regresión del cambio que estaba cerrando, que es
exactamente el impuesto que cobra un flaky.

---

## Diez líneas con el mismo impuesto pausado daban diez toasts (2026-08-11)

Dos entradas hermanas de la auditoría de `items` + `calculo-precios`, cerradas juntas
porque son el mismo ruido por dos puertas.

**Las entradas, verbatim:** *"El aviso de ítem pausado se emite por línea — el mismo ítem
en 3 líneas (recetas personalizadas, salones) da 3 toasts idénticos en el POS."* y *"Una
advertencia de impuesto pausado se repite por línea, y se emite aunque la fórmula del
tenant no incluya el paso `impuestos` — un carrito de 10 líneas con el mismo impuesto
pausado produce 10 advertencias idénticas. Puede ser deliberado (las advertencias de línea
son por línea por naturaleza), pero para una regla global al catálogo el ruido es real."*

**Medido antes de tocar nada**, que es lo que convirtió el "puede ser deliberado" en una
pregunta contestable: 10 líneas → 10 avisos; y con la fórmula `['descuentos','recargos']`
—sin el paso de impuestos— el aviso *"está en pausa y no se aplicó"* **igual salía**.

**Decisión del owner (2026-08-11): uno por regla.** El aviso de algo pausado es información
de **catálogo**, no de una línea; repetirla no agrega nada y tapa los avisos que sí son de
una línea.

**Lo que se cambió, y por qué en dos lugares y no en uno:**

- `sinRepetidas` en `calculo-precios.engine.ts`, sobre el aplanado `advertencias`.
- Un `Set` por `itemId` en `advertirItemsPausados` (`calculo-precios.service.ts`). **La
  deduplicación del motor no lo alcanza**: esa advertencia se empuja *después* de que
  `calcularVenta` devolvió. Si aparece una tercera fuente fuera del motor, va a necesitar
  lo mismo — queda escrito en `motor-calculo-precios.md`.
- El aviso de impuesto pausado ahora solo se emite si `cfg.formula.includes('impuestos')`.
  Se armaba antes de recorrer la fórmula: en un tenant sin ese paso, *"no se aplicó"*
  describía la fórmula y lo hacía pasar por consecuencia de la pausa.

**Lo que NO se tocó, y tiene su propio test:** `ResultadoLinea.advertencias` y
`advertenciasVenta`. Ahí la repetición es la que marca **cuáles** líneas están afectadas —
si se dedujeran también, el aviso quedaría arriba sin decir a qué línea mirar. El test
`pero cada línea conserva el suyo` existe para que nadie "termine el trabajo" por error.

**Seis tests nuevos y tres mutantes, uno por cada mitad del cambio:**

| Mutante | Qué murió |
|---|---|
| `sinRepetidas` → identidad | 1: `10 líneas … dan UN aviso` |
| aviso de impuesto sin el guard de `formula` | 1: `sin el paso impuestos … NO avisa` |
| `advertirItemsPausados` sin el `Set` | 1: `el mismo ítem pausado en 3 líneas avisa UNA vez` |

Ninguno tocó los tests de los otros dos, que es lo que confirma que son tres caminos
independientes. Y el control `dos reglas pausadas DISTINTAS siguen dando dos avisos` es el
que evita que la deduplicación se pase de lista.

**Lo que encontró la revisión independiente, y que era serio:**

1. **Un byte NUL crudo dentro del código**, en la clave de deduplicación. El editor y
   `git diff` lo mostraban como un espacio; `file` decía `data`, no texto. Y lo peor no era
   cosmético: el pre-commit usa `git diff --cached | grep` para sus guards de `tenant_id`
   y `DELETE` físico, y **sobre un archivo binario ese grep no devuelve nada**, así que el
   archivo entero quedaba fuera de la única red mecánica del repo. Se reemplazó por
   `JSON.stringify([titulo, detalle])`, que además no depende de ningún separador.
2. **La deduplicación es más ancha que "lo pausado"**: también colapsa el aviso del tope,
   que es por línea. Era un ensanche no declarado del pedido del owner. Se revisó y **se
   mantiene** —dos textos idénticos no le dicen al lector que hubo dos eventos, y el
   `detalle` no nombra montos ni líneas a propósito— pero ahora está escrito como decisión
   y tiene su propio test, en vez de ser un efecto lateral.
3. **La clave del `Set` de ítems iba con el casing crudo.** `@IsUUID('4')` acepta
   mayúsculas y la BD devuelve minúsculas —por eso existe `aliasarCasingDeIds`—, así que el
   mismo ítem con dos casings en el mismo carrito se contaba dos veces: exactamente el bug
   que este cambio venía a cerrar. La clave ahora va en minúsculas.
4. **`impuestos` no tiene índice único de nombre por tenant** y sus hermanas sí. Es lo
   único que hace que el colapso pueda esconder algo. Quedó como entrada nueva en
   [`pendientes.md`](pendientes.md), con las dos preguntas que hay que responder antes de
   agregar el índice.

**Sigue abierta la tercera hermana:** `suscripciones.service.ts` descarta
`resultado.advertencias` enteras, así que sobre el primer período de una suscripción estos
avisos no llegan igual. La deduplicación no cambia eso.

**Gate:** backend 98 suites / 1574 unit, e2e 29 suites / 398, frontend completo.

---

## Los dos jobs de CI dejan de poder colgarse seis horas (2026-08-11)

**Entrada original (verbatim):** *"El job de CI del frontend necesita timeout propio
(2026-08-06) — con `hookTimeout` en 60s y `testTimeout` en 20s, un entorno Nuxt realmente
colgado tarda hasta un minuto por archivo en reportarse, y hay 22 `.nuxt.spec.ts`. Hoy no
hay un `timeout-minutes` en `.github/workflows/ci.yml`. Prioridad baja."*

`timeout-minutes: 25` en `gate` **y también en `e2e-navegador`**, que la entrada no
mencionaba y tiene el mismo agujero: un Playwright que no arranca tampoco puede quedarse
seis horas —el default de GitHub— ocupando un runner.

**El 25 no es al ojo:** las tres corridas más recientes tardaron **4 min 30 s** de punta a
punta (medido con `gh run list`), así que deja ~5× de margen. Un job que toque ese número
no está lento: está colgado, que es exactamente lo que el tope tiene que distinguir.

---

## Ocho lecturas que morían con un `TypeError` en vez de decir qué pasó (2026-08-11)

Mitad de la entrada del flaky de caja, que sigue abierta por su otra mitad (la causa del
flaky, todavía sin determinar).

**El problema, verbatim de la entrada:** *"el helper `usuarioIdDe` hace
`(res.body as Member[]).find(...)` **sin mirar el status**, así que cuando la respuesta no
es la lista el test muere con un `TypeError` sobre `.find` en vez de decir qué contestó el
servidor. Eso convierte un diagnóstico de un minuto en una sesión de forense."*

**Lo que se hizo:** afirmar `status` y `Array.isArray` **antes** del casteo, en los tres
archivos donde el grep encontró el molde. En `alta-usuarios-tenant.e2e-spec.ts` eran
**ocho** repeticiones —la entrada decía seis, el grep del cierre encontró dos más—, así que
ahí no se copió la aserción ocho veces: salió un helper `listarMiembros(app, token)`. En
`caja.e2e-spec.ts` y `cajones.e2e-spec.ts` es un solo uso cada uno y quedó inline, según la
convención del repo (duplicar dos veces se acepta, se extrae a la tercera).

**Verificado que hace lo que promete, no solo que compila:** se apuntó el helper a una ruta
inexistente y el fallo pasó a ser

```
expect(received).toBe(expected)
Expected: 200
Received: 404
```

en vez del `TypeError: .find is not a function` de antes. Después del revert, los 10 tests
del spec en verde.

⚠️ **Esto no arregla el flaky** y no pretende hacerlo: lo saca de mudo. La causa sigue
abierta en [`pendientes.md`](pendientes.md).

**Gate:** backend 1569 unit, e2e 29 suites / 398 tests.

---

## El cuaderno de anti-patrones vuelve a su tope, y sin borrar nada (2026-08-11)

**Entrada original (verbatim):** *"`anti-patterns.md` pasó su propio tope de 20 entradas y
nadie podó (docs, `docs/agent/anti-patterns.md:14`) — la regla 3 del archivo dice 'Tope: 20
entradas. Si se llena, la más antigua sin reincidencia se elimina'. Medido el 2026-08-07:
**25** entradas `### ❌`. Ya estaba en 23 antes de esa tanda, así que no lo rompió un commit
puntual: el tope nunca se aplicó."*

**El owner la delegó en el agente** (2026-08-11): es herramienta del harness, no producto.

**Lo que se hizo, y por qué no fue podar.** La regla mandaba borrar 5 entradas, y borrar
era la peor salida disponible: **cada entrada es un bug que ya se pagó**, y ninguna de las
25 era relleno. Se llegó a 20 por otros dos caminos que no pierden nada:

- **Fusión de 5 en 1.** Las cinco entradas de `vue-tsc` estricto (`@click` que devuelve
  valor, índice sin guard, `string | null` contra Nuxt UI, mismatch con reka, tipado de los
  unit tests) son **la misma lección con distinto código de error**: `vue-tsc` rechaza lo
  que `nuxt build` acepta, y el fix es siempre solo-de-tipo. Quedaron como subsecciones
  `####` de una entrada única, con todo el contenido intacto.
- **Una pasó a `✅ AUTOMATIZADO`** (regla 2 del archivo, que ya existía y tampoco se venía
  aplicando): la de Tailwind hardcodeado, que `check-design-tokens.mjs` enforcea en el gate
  y en el pre-commit. Su propio texto ya decía "AUTOMATIZADO" adentro pero seguía contando
  como entrada activa.

Resultado: **20 exactas**, 3 stubs de automatizadas, 0 líneas de conocimiento perdidas.

**La regla 3 se reescribió** para que la próxima vez no haya que reinventar el criterio:
primero pasar a `✅` lo automatizado, después fusionar caras del mismo error, y **borrar
recién al final**. Con la nota de que esta fue la primera vez que el tope se ejecutó desde
que existe.

---

## El orden de los descuentos deja de decidirlo el azar de una query (2026-08-11)

**La entrada estaba abierta desde el 2026-07-28** y es la más vieja de las que se cerraron
en la ronda. Preguntaba con qué criterio se ordenan los descuentos de un ítem: en modo
`compuesto` cada regla se aplica sobre el acumulado de la anterior, así que el orden cambia
el total —1000 con un 20% y un fijo de 100 da **700 o 720** según cuál vaya primero— y ese
orden no estaba definido en ninguna parte. El batch del 2026-07-28 había puesto un
`ORDER BY` por id **solo para que fuera determinista**, no porque fuera el criterio
correcto, y la tabla puente no tiene timestamp: "el orden en que el usuario los agregó" no
existe ni se puede recuperar.

**Precondición que el owner puso el 2026-08-08:** investigación de mercado antes de
diseñar. Corrida y registrada en
[`investigaciones/2026-08-11-orden-de-descuentos.md`](investigaciones/2026-08-11-orden-de-descuentos.md).
Lo que trajo, y que cambió la conversación:

- **No hay estándar que copiar.** Los cuatro sistemas relevados fijan el orden en el motor
  y ninguno lo hace configurable — y Toast y Square lo fijan **al revés uno del otro**.
- **La prioridad configurable, que era la forma que el owner prefería, no la usa ningún
  POS**: aparece en e-commerce y apps de terceros. El insumo original le atribuía un
  respaldo que no tiene.
- El SII no impone nada: estandariza campos, no algoritmo. La decisión es de producto.

**Decisión del owner (2026-08-11): criterio propio y fijo — porcentajes antes que montos
fijos.** Config por tenant queda **descartada por ahora**, a revisar si un tenant la pide.

**El razonamiento que la sostiene, y que no salió del mercado sino de medir nuestro
motor:** `aplicarValor` ignora la base cuando el modo es `monto_fijo`, así que **un fijo
resta lo mismo vaya donde vaya**. El único que depende de la posición es el porcentaje, y
lo que se está eligiendo es si mira el precio original o el ya rebajado. De ahí las tres
razones: "20% de descuento" significa 20% del precio; le conviene al cliente; y **el último
es el que se recorta** cuando entra el piso en cero — un fijo recortado se explica en el
ticket, un porcentaje recortado no.

**Lo que se cambió: 7 líneas.** Una función `ordenarReglas` en
`calculo-precios.engine.ts` y el `for` que la usa. Va en el motor y no en el `ORDER BY` de
las queries **porque hay tres caminos que arman listas de reglas** (ventas, salones,
combos): una regla que dependa de que los tres se acuerden del mismo `ORDER BY` se rompe
sola. El sort es estable, así que el desempate del llamador se preserva — y puede seguir
siendo arbitrario porque entre reglas del mismo modo el total no cambia.

**Un test existente se puso rojo, y el resultado nuevo es el correcto.** El caso: cuenta de
1190 con IVA, un cupón fijo de 1100 y un 10% de socio, en `compuesto`.

| | Antes | Ahora |
|---|---|---|
| Socio 10% | **se evaporaba** (base negativa → guard a 0) | aplica 100 |
| Cupón 1100 | aplica 1100 | aplica 1090, con su advertencia |
| El cliente paga | 90 | **0** |

Los 90 no eran una regla de negocio: eran un artefacto del orden arbitrario. El cliente
tenía un cupón de 1100 **y** un 10% sobre 1190; que pague 0 es lo que corresponde. El test
se reescribió afirmando lo nuevo, con el porqué adentro para que el próximo que lo lea no
crea que alguien aflojó una garantía.

**Y se verificó que esa garantía siga cubierta:** el guard `Decimal.max(monto, ZERO)`
quedaba con un test menos, así que se mutó a propósito. **Mató exactamente 1**: el del
recargo sobre base negativa — que sigue siendo alcanzable, porque el paso de recargos corre
con el acumulado que dejaron los descuentos. O sea que el guard sigue siendo carga
estructural, ahora por un solo camino, y eso está escrito en el test.

**Tests nuevos:** 6 en `calculo-precios.engine.spec.ts`, entre ellos el que prueba que el
resultado **ya no depende de cómo venga la lista** (700 en los dos órdenes), el control de
que en `base` nada se movió, que la traza refleja el orden aplicado y no el de entrada, y
que la regla vale también para recargos.

**Gate:** backend 98 suites / 1569 unit, e2e 29 suites / 398, frontend completo.

---

## El sobrante de un descuento topeado se pierde, y ahora hay un test que lo dice (2026-08-11)

**Entrada original (verbatim):** *"¿Un descuento debe topearse aunque un recargo posterior
levante el total? (backend, `calculo-precios.engine.ts`) — el piso en cero (2026-07-28)
topea **regla por regla** contra el acumulado en ese punto de la fórmula. Con fórmula
`descuentos → recargos`, neto 1000, descuento fijo 1200 y recargo fijo 2000: sin tope el
total daba 1800 (positivo); con tope da 2000, o sea el cliente paga 200 más en una venta
que nunca fue negativa. La regla que decidiste habla del **total**, no del acumulado
intermedio, así que topear por regla es más estricto que lo pedido. La alternativa —topear
recién al final— rompe la coherencia de la traza, que es lo que el diseño actual protege.
Lo detectó la revisión independiente con un fuzz de 20.000 ventas. Es raro (exige un
descuento fijo mayor al neto **y** un recargo posterior que lo levante), por eso no se
resolvió sobre la marcha."*

**Decisión del owner (2026-08-11): el sobrante se pierde.** El tope sigue siendo regla por
regla, aun sabiendo que en ese borde el cliente paga de más. Gana la coherencia de la
traza: cada paso del cálculo se explica solo y el comprobante cuadra.

**Cero líneas de código de producción.** Es la clase de entrada que se cierra sin tocar
nada y que igual valía la pena: el comportamiento ya era el correcto, lo que faltaba era
que estuviera **elegido** en vez de heredado, y que algo lo defendiera. Sin eso, el
próximo que lea el piso en cero ve un cliente pagando 200 de más y lo "arregla".

**Lo que se agregó:** el test `el sobrante de un descuento topeado NO compensa un recargo
posterior` (`calculo-precios.engine.spec.ts`, en el describe del piso en cero) con los
números exactos de la entrada, y la quinta precisión de la regla en
[`motor-calculo-precios.md`](../features/motor-calculo-precios.md).

El test no se queda en el total: verifica que `descuentoAplicado` sea 1000 y no 1200 —o
sea que el recorte quedó en la traza y no solo en el resultado—, que el comprobante cuadre
(`1000 − 1000 + 2000`), y que la advertencia le llegue al cliente. Un test que solo mirara
`totalFinal` daría verde con una implementación que descuenta 1200 y compensa después.

**Mutante:** sacar `monto = tope` de `procesarReglas` —que es **exactamente la alternativa
que el owner descartó**, topear al final en vez de por regla— dejó 6 tests en rojo, el
nuevo entre ellos. Los otros 5 son los del piso que ya existían: el mutante confirma de
paso que la regla es carga estructural y no un chequeo decorativo. Tras el revert, el
motor quedó **byte-idéntico a `HEAD`** (`git diff --stat` vacío) y los 51 tests del engine
en verde.

---

## `categorias` y `terceros` pausados: el backend deja de aceptar la asignación (2026-08-11)

**Entrada original (verbatim):** *"`categorias` y `terceros` pausados: el front los esconde,
el backend acepta la asignación (backend, medido 2026-08-03) — hermano menor de la entrada
de reglas pausadas que se cerró ese mismo día, pero sobre entidades que se **referencian**,
no que se aplican: no cambian ningún monto, por eso quedó fuera de aquel alcance. Medido:
`ClienteForm.vue:34` filtra `terceros` por `activo` y `items.vue:798` filtra `categorias`,
pero ningún service del backend lee el campo, así que un POST/PATCH directo puede asignar
una categoría o un tercero pausado. ⚠️ Acá "ignorar" **no** puede significar romper el
vínculo existente: un ítem no pierde su categoría porque la categoría se haya pausado. Lo
que corresponde es **rechazar la asignación nueva**, y dejar en paz las que ya existen.
Sin decidir: si el rechazo es 400 o si se ignora en silencio."*

**Decisión del owner (2026-08-11): 400.** Pausar significa "no se usa más", no "las
pantallas lo esconden". Lo notable es que
[`patterns/backend.md`](../patterns/backend.md) ya describía esta regla exacta desde el
2026-08-03 —la fila "se referencia" de su tabla dice *rechazar la asignación nueva; el
vínculo existente no se rompe*— y el código no la cumplía para estas dos entidades: la
doc iba adelante del código.

**Lo que se cambió**, un punto de enforcement por entidad, que es donde tiene que sumarse
quien agregue otro camino de asignación:

- `validarCategoria` (`items.service.ts`) — la usan `create` y `update`, así que los dos
  caminos quedan cubiertos por un solo cambio. Precedente que ya existía al lado y marcó
  la forma: `validarImpresoraComanda` (`categorias.service.ts`) ya exigía `activo = true`.
- `validarTercero` (`ventas.service.ts`) — **nuevo**, ver abajo.

En ambos el `activo` se lee y se evalúa en TypeScript en vez de sumarse al `WHERE`: así
"no es de este tenant" y "está pausada" son dos errores distintos, que es la diferencia
entre un id equivocado y una decisión de negocio.

**Hallazgo que apareció al medir, y que era más grave que la entrada:** el `terceroId` del
customer de una venta **no se validaba en absoluto**. El DTO solo exige formato
(`@IsUUID()`), el service lo persistía tal cual, y la FK de `venta_customer.tercero_id`
(`startup-pos.sql:1154`) referencia `terceros` **sin tenant**. O sea que el id de un
tercero de otro tenant quedaba guardado en tu venta. Hoy no filtra datos —`venta_customer`
denormaliza nombre y RUT, y ninguna lectura hace JOIN a `terceros`— pero es una FK cruzada
entre tenants esperando al primer JOIN que alguien agregue. No se pudo separar del alcance:
para mirar `activo` hay que cargar la fila, y cargarla sin filtrar por tenant habría sido
escribir la mitad mala del arreglo.

**Tests:** 7 en `test/items-pausados.e2e-spec.ts` (mismo archivo y no uno nuevo: es la misma
regla sobre entidades que se referencian en vez de aplicarse). El control con ambos
**activos** va antes de pausar, si no un 400 podría venir de cualquier otra cosa. El del
tenant ajeno
inserta el tercero por SQL a propósito: no existe camino de API para crear datos en un
tenant al que no pertenecés, que es justo el punto.

**Mutantes (los dos revierten al código anterior):**

| Mutante | Qué murió |
|---|---|
| `validarCategoria` sin el chequeo de `activo` | 2 de 17: crear con categoría pausada, y mover un ítem existente a ella |
| sin la llamada a `validarTercero` en `crear()` | 2 de 17: vender con tercero pausado, y el tercero de otro tenant |

Ninguno de los dos tocó los tests del otro, que es lo que confirma que son dos caminos
independientes y no un chequeo que tapa al otro.

**Un test de los 7 no lo mata ningún mutante, y está a propósito:** el que verifica que el
ítem conserva su categoría después de pausarla. Hoy pasa igual sin la feature —ninguna
lectura filtra `activo`, y `categoriaId` sale de la columna de `items`, no del JOIN— así
que no prueba este cambio: **custodia el siguiente**. El arreglo fácil y equivocado de
"ignorar lo pausado" es filtrar en las lecturas, y el día que alguien lo intente el ítem
perdería su categoría en silencio. Lo señaló la revisión independiente y el comentario del
test se corrigió para no prometer más de lo que hace.

**Gate:** backend 98 suites / 1562 unit, e2e 29 suites / **398** tests (eran 391), frontend
build + test + `typecheck:ratchet` + `design:check`.

---

## `precioUnitario` en `0` — la última laguna de la línea de venta (2026-08-11)

**Entrada original (verbatim):** *"`LineaVentaDto.precioUnitario` — ¿debe permitir `0`?
(parcialmente cerrado) (backend, `ventas/dto/create-venta.dto.ts`) — el rechazo de
negativos ya se cerró (jul-2026): tiene `@IsDecimalNoNegativo()`, que además permite `0`.
Lo que sigue abierto es si el `0` debería seguir siendo válido o si el owner quiere
prohibirlo también (podría representar un ítem promocional/gratis, o podría ser una
laguna para vaciar el `totalFinal` de una línea sin tocar el resto). Decidir `>= 0`
(estado actual) vs `> 0` (`IsDecimalPositivo`) es una regla de negocio del owner, no algo
a inferir. Requiere confirmación antes de endurecer más."*

**Decisión del owner (2026-08-11): `> 0`.** El `0` era el único camino para vaciar una
línea **sin rastro de quién la regaló**; un regalo modelado con descuento queda en la
traza del cálculo con su regla y su monto. Y prohibirlo no cierra ningún camino para
regalar: el campo es opcional, y omitirlo hace que el precio salga de `item.precioBase`,
que sí puede ser 0.

**Lo que se cambió:** `@IsDecimalNoNegativo()` → `@IsDecimalPositivo()` en `LineaVentaDto`
(`ventas/dto/create-venta.dto.ts`), **y solo ahí**. Ningún productor manda el campo a ese
endpoint: `toVentaLineasBody` no lo incluye y `online.service.ts:39` lo omite a propósito.

**El mismo cambio en `calcular.dto.ts` se probó, se revisó y se revirtió** — vale más
anotado que escondido, porque el razonamiento que lo justificaba era plausible y falso.
La versión bloqueada endurecía también la previsualización "por simetría, es el mismo
carrito". Lo que la revisión independiente encontró, y se verificó línea por línea:

- **`frontend/app` SÍ manda `precioUnitario` a `calcular`**, desde `useVenta.ts:197` y
  `useSalones.ts:200`. La afirmación contraria —que sostenía toda la decisión— salió de
  un `grep` cuyo `head` se comió los resultados del frontend. El dato falso llegó hasta
  la pregunta que se le hizo al owner.
- Lo que mandan es el precio **ya calculado** de la línea (`precioBase + extras`), que da
  `0` legítimamente cuando el ítem vale 0 —`create-item.dto.ts` documenta que ese 0 es
  legítimo— y la personalización no agrega nada pago (alcanza con un "sin cebolla":
  `personalizacionVacia` ya es falso con `omitidos`).
- El filtro que decide si se manda es `if (precioOverride)` sobre un **string**, y `'0'`
  es truthy en JS: el cero pasa el filtro y viaja.
- El 400 resultante **no se ve**: `useCalculoPrecios` se traga el error a propósito, el
  carrito nunca vuelve a estar vigente y el modal de cobro no abre. Sin toast.
- Y no protegía nada: `ventas.service.ts:315` **ignora el override** cuando la línea tiene
  personalización (recalcula `precioBase + precioExtraTotal`), o sea que el preview
  quedaba **más estricto que la venta** — exactamente al revés del argumento usado.

Queda un test que fija la divergencia en `test/calculo-precios.e2e-spec.ts` (`acepta un
precioUnitario en 0`), para que el próximo que vea los dos DTOs distintos no los "empareje".

**Un test afirmaba lo contrario y se invirtió, no se agregó:** `create-venta.dto.spec.ts`
tenía *"acepta un precioUnitario en 0 (ítem de cortesía)"*. Ese giro es la señal de que el
cambio llega hasta donde importa. Se sumó `acepta una línea sin precioUnitario`, que fija
la premisa de la que cuelga toda la decisión (el campo es opcional), y en
`test/calculo-precios.e2e-spec.ts` el caso `0` contra el endpoint real.

**Mutante (revierte al código anterior, no rompe por romper):** `create-venta.dto.ts` →
`@IsDecimalNoNegativo()` mató 1 de 7, `rechaza un precioUnitario en 0`. `acepta una línea
sin precioUnitario` siguió verde, que es correcto: el mutante no toca la opcionalidad, y
esa opcionalidad es la premisa de la que cuelga toda la decisión.

**Gate:** backend 98 suites / 1562 unit, e2e 29 suites / 391 tests (reset previo, 1 seed),
frontend build + test + `typecheck:ratchet` + `design:check`. Doc de la regla en
`docs/features/ventas.md`.

---

## Suite E2E de navegador (los cinco flujos críticos, escritos)

Playwright corre 19 tests en `frontend/e2e/` (auth vía storageState). Los cinco flujos
que esta lista pedía están escritos; queda solo el ítem de CI, al final.

Reglas que siguen valiendo para cualquier flujo nuevo: aserciones derivadas de
`docs/features/` (NUNCA del output del código), `@smoke` solo en el subconjunto barato,
cero esperas fijas. Y **`workers: 1`**: el tenant tiene un solo cajón y `abrir` rechaza si
el usuario ya tiene caja abierta, así que dos specs de caja en paralelo se pisan siempre.

- [x] **Venta completa hasta documento** (afecto + exento) — hecho el 2026-08-09,
  `e2e/ventas/pos.spec.ts`. El exento es lo que le da filo: sin él, "hay IVA" no
  distingue derivarlo de `clasificacion_tributaria` de derivarlo de "tiene impuestos
  asignados". Se verifica el desglose por línea del lado del servidor, no solo el total.
  **Solo cubre la Boleta** (el default): la Factura exige customer y es su propio flujo.
- [x] **Pago mixto** (múltiples métodos; vuelto solo si `permite_vuelto`) — hecho el
  2026-08-09, `e2e/ventas/pos.spec.ts`. Son dos tests: el reparto exacto entre dos
  métodos —donde la caja espera solo el efectivo, no el total— y el vuelto, que cambia el
  MÉTODO dejando fijo el sobrepago, para que la regla sea la única variable.
- [x] **Nota de crédito** (referencia a la venta original) — hecho el 2026-08-09,
  `e2e/ventas/nota-credito.spec.ts`. Va **parcial** ($500 sobre $1.190) para que el monto
  no pueda confundirse con el total de la venta, y verifica el vínculo desde los dos
  lados: la NC apunta a la venta y la venta la reconoce como hija. Mutante medido
  (`ventaReferenciaId: null` en `ventas.service.ts`): `Expected <uuid> / Received null`.
- [x] **Apertura/cierre de caja** (`diferencia` calculada por el sistema) — hecho el
  2026-08-09, `e2e/caja/apertura-cierre.spec.ts`. Cruza las dos fases del cierre: la
  "Diferencia" del conteo es aritmética de cliente y la de la conciliación viene del
  arqueo del servidor. Mutante medido (invertir el signo en `caja.service.ts`): falla solo
  la segunda, que es la prueba de que son independientes. El **reloj congelado** quedó
  fuera: no hay nada que dependa de la hora en este flujo.
- [x] **Descuento de stock en una venta** (movimiento + saldo materializado) — hecho el
  2026-08-09, `e2e/ventas/pos.spec.ts`. El `Stock: 8` que muestra el catálogo es
  aritmética de cliente y **no prueba nada**: medido con un mutante en el backend
  (`ventas.service.ts`, el `registrarMovimiento` de la venta, `cantidad: '1'` en vez de
  `cantidadCanonica`), la pantalla sigue en verde y lo cazan el saldo (`9.0000`) y el
  movimiento del servidor.
- [x] **Cambio de tenant sin fuga de datos** — hecho el 2026-08-09,
  `e2e/tenants/aislamiento.spec.ts`. Cubre el catálogo; **las ventas siguen sin cubrirse**
  por ese eje. Y cubre **scoping**, no caché: que los stores de Pinia se reseteen al
  cambiar de institución lo cubre `app/stores/tenant.spec.ts`. La primera versión de esa
  spec reclamaba lo segundo y era falso —la segunda visita al catálogo iba por
  `page.goto()`, o sea recarga dura, que borra el estado en memoria antes de aseverar—;
  hoy va por el menú de la app.
- [x] **Salones de punta a punta** (mesa → cuenta → línea → cobro) — hecho el 2026-08-09,
  `e2e/salones/cuenta-hasta-cobro.spec.ts`. **No lleva `@smoke`**: escribe en la base
  (abre caja, cobra una venta) y tarda ~20 s en frío, así que no es del subconjunto barato.
- [x] **Integrar `@smoke` al CI** — cerrado el 2026-08-10 **como decisión, sin
  implementarlo**: la premisa de la entrada ("cuando haya masa crítica", "hoy el CI no
  levanta el stack de navegador") dejó de ser cierta. El job `e2e-navegador` corre
  `npm run e2e` —la suite **entera**— desde el 2026-08-09, y la última corrida sobre
  `e637c0a6` midió **`19 passed (43.3s)`** con un worker. Un subconjunto barato ahorra
  ~40 s sobre un job que ya paga varios minutos de `npm ci` + dos builds + la descarga de
  Chromium: optimiza lo que no domina el costo, y a cambio abre la puerta a que el CI mida
  menos de lo que corre en local. El tag `@smoke` **sigue vivo** para `npm run e2e:smoke`,
  que es una herramienta local para no arrastrar las specs que escriben en la base; lo que
  se descarta es que el CI use el subconjunto en vez del total.

## Salones de punta a punta, en un navegador de verdad (2026-08-09)

Primer flujo de la suite Playwright además del smoke: mesa → cuenta → línea → cobro. Es la
capa que faltaba entre el unit con HTTP mockeado (`pages/salones/index.nuxt.spec.ts`) y los
e2e de API (`salones-fusion`, `salones-comanda`): que la **pantalla encadene** las llamadas
en el orden correcto y muestre lo que el backend devolvió.

**Las precondiciones se montan por API, no clicando** —abrir caja, crear garzón y entrar a
turno son tres flujos con pantalla propia; recorrerlos haría que un cambio en cualquiera de
ellos rompa este test sin que salones tenga nada que ver—. Y los fixtures son propios:
garzón, salón, mesa e ítem creados en el `beforeAll`.

**El monto sale de la regla, no del output:** producto afecto de $1.000 + IVA 19% = **$1.190**
(ADR-018), y el cobro suma la propina sugerida del 10% → **$1.309**. (El 10% es a la vez el
default del cliente y el del tenant sembrado, así que el test **no** distingue uno del otro
— medido por la revisión con un mutante que ignora la respuesta del backend.)

**Lo que el navegador enseñó y ninguna de las otras capas mostraba** —cada uno costó una
corrida y una captura de pantalla—:

- **El PIN se pide DOS veces**, y la segunda **después** de "Confirmar venta", no antes:
  quién cierra la cuenta es un dato del cierre y no se hereda de quien la abrió.
- La mesa con posición por defecto `(0,0)` queda **recortada** contra el borde del plano y el
  click cae fuera; el fixture la crea al centro.
- El teclado del PIN va acotado al diálogo. (La primera redacción decía que chocaba con el
  stepper de cantidad; la revisión lo midió y **es falso** — el fondo queda fuera del árbol de
  accesibilidad con el modal abierto. El acotado queda igual, como defensa, pero sin inventarle
  una medición.)
- El trigger del `USelectMenu` no tiene label propio: Reka UI le pone `Show popup`. El test lo
  usa **y verifica la selección** después, para que un cambio de ese label falle donde se
  produce.
- La primera corrida sobre un stack recién levantado tarda más de los 5 s de plazo por
  defecto en volver al listado tras el cobro. La aserción final lleva plazo propio —no espera
  fija: sigue resolviendo apenas aparece—.

**La revisión independiente bloqueó la primera versión con tres hallazgos, los tres
reproducidos:**

1. La aserción del monto era `getByText('$1.190').first()`, sin anclar. El revisor la volvió
   vacua creando **un ítem de catálogo de $1.190** —y este mismo test le agrega un ítem al
   catálogo por corrida, así que la ambigüedad crecía sola—. Ahora apunta a la fila `Total`
   del panel.
2. El locator del garzón matcheaba **por prefijo** y el cleanup se salteaba si el montaje
   fallaba a la mitad: una sola corrida interrumpida dejaba un garzón en turno y **toda**
   corrida siguiente moría con un strict-mode, sin recuperarse sola. Ahora el nombre va exacto
   y el escenario se llena de a poco para que el `afterAll` cierre lo que sí llegó a existir.
3. **El `afterAll` se tragaba la única verificación server-side.** Con un mutante que cobra
   sin propina, el test quedaba verde —el modal muestra $1.309 porque es matemática de
   cliente, y el toast es un ternario local— mientras en la base quedaba
   `venta_propina.monto_pagado = 0` y la caja descuadrada. Ahora el test **cierra la caja como
   último paso y afirma `estado: 'cerrada'`**, que solo sale si el conteo cuadra con lo que el
   servidor calculó.

**Los tres mutantes, medidos sobre la versión final:** `cantidad: '2'` al agregar la línea →
`Expected "$1.190" / Received "$2.380"`; cobrar con propina `'0'` →
`Expected "cerrada" / Received "en_conciliacion"`; y `credencialGarzon` devolviendo `{}` —la
regresión histórica del `pin: ''`— muere al agregar el producto.

**No lleva `@smoke`**: escribe en la base y tarda ~20 s en frío, así que no entra al
subconjunto barato que corre en cada tarea.

## La guarda de rango estaba duplicada, y el test no sabía a cuál apuntaba (2026-08-09)

**El hallazgo era de la revisión independiente del día anterior**, anotado al cierre de la
tanda de ramas que está más abajo en este mismo archivo: el e2e del rango invertido pasaba en
verde con cualquiera de las dos guardas viva —una en `rangoLiquidacionDesde`, otra
dentro de `computarReparto`, con el mismo mensaje— así que no fijaba ninguna.

**La duplicada era código muerto**, medido siguiendo los llamadores: el único que entra a
`computarReparto` en producción es el `preview` del controller, y construye el período con
`rangoLiquidacionDesde` justo antes de llamarlo. Se borró, y el docblock del método ahora dice que
recibe el período **ya validado** y por qué duplicar la guarda vuelve a romper la señal.

**El test pasó a cubrir los tres puntos de entrada** —`preview`, `crear` y `liquidar`— porque
son tres llamadas distintas a la misma función y nada garantiza que las tres la sigan
llamando. Y se sumó el otro borde que solo cierra ese util: una fecha ISO 8601 **legítima**
que `new Date` no sabe leer (`2026-W32-1`). La guarda de orden no la frena —compara
`NaN <= NaN`, siempre `false`— y antes llegaba a Postgres como un 500.

**Los dos mutantes, medidos sobre la única guarda que queda:**

- sacar la comparación de orden → mueren los **tres** tests de entrada;
- sacar el chequeo de fecha ilegible → `Expected 400 / Received 500`, que es exactamente el
  bug histórico que el docblock del util documenta.

## Seis ramas sin cobertura, elegidas de una lista de catorce (2026-08-09)

La entrada decía *"ramas sin cobertura alguna, **para decidir si entran**"*. Se decidió por
riesgo, y el criterio para descartar fue el mismo en tres casos: si montar el escenario exige
SQL directo, lo que se escribe es un test de un estado que en producción no existe. El detalle
de lo que no entró queda en [`pendientes.md`](pendientes.md) para no reevaluarlo de cero.

### Spillover de propina entre pagos (unit)

La propina que no cabe en el primer medio se derrama al siguiente. Los seis tests que ya
tenía `asignacion-propina.spec.ts` usaban propinas que caben cómodas, así que la rama del
tope no la tocaba ninguno. Se sumaron dos: el derrame y el borde de una propina
mayor que todo lo pagado, que no puede inventar plata que nadie puso. (La aserción de
conservación que acompaña al primero es **redundante**: el `toEqual` de arriba ya fija el
array elemento por elemento, así que no existe mutación que rompa una sin romper el otro. Se
deja como documentación de la propiedad, no como cobertura.) **Mutante:** sacar el `Decimal.min(neto, …)` mata
los dos.

### Aislamiento multi-tenant de caja (e2e) — el más valioso de la tanda

El eje cubierto era el de roles dentro de un tenant (cajero vs supervisor). Este es el otro:
que la caja de Paris sea invisible con un token de Falabella. **Mutante:** sacar `tenantId`
del `where` de `CajaService.findOne` devuelve **200 con la caja de otra empresa** donde el
test espera 404.

**La clave del arnés es que ataca la MISMA PERSONA**: `admin@sistema.com` es miembro de los
dos tenants del seed, así que la caja se abre con su token de Paris y se ataca con el de
Falabella. La primera versión usaba dos personas distintas y la revisión independiente midió
que **sobrevivía a borrar el scoping por tenant de todo el camino**: lo que cortaba era el
chequeo de dueño. Lo mismo con el listado, que hoy se pide con `?todas=true` porque sin el
flag filtra además por `usuario_id` y ese filtro tapaba al de tenant.

⚠️ **La mitad de escritura sigue fijando menos de lo que parece, y está escrito en el test.**
No se pudo construir un mutante que aislara la defensa de tenant: sacándola, la request del
otro tenant llega al `FOR UPDATE` de `bloquearCajaAbierta` y la corrida se cuelga, así que no
hay aserción posible sobre el resultado. Lo que ese test fija es que la escritura **no
prospera** y que la caja queda intacta. Queda anotado en [`pendientes.md`](pendientes.md).

(La primera redacción de esta ficha decía que el rechazo venía del guard de permisos. Es
falso y lo midió la revisión: sale de `bloquearCajaAbierta`, y el usuario es admin en los dos
tenants, así que el guard ni interviene.)

### La capa SQL de `propina-reportes` (e2e)

Dos queries con CTEs, `generate_series` y agregaciones que solo se ejercitaban en unit con el
`dataSource` mockeado — el mismo perfil que ya nos mordió en `fusionarCuentas`.

Se afirma sobre el **delta** contra una fila recién sembrada, no sobre valores absolutos ni
sobre "los totales son la suma de las filas": eso último sería **tautológico**, porque
`totales` se calcula en JS recorriendo `data`. El delta prueba lo que importa — que la query
ve la fila nueva, la suma y se la atribuye a quien corresponde. **Dos mutantes:** uno en la
capa JS (`montoOriginado: '0'`) y otro en el SQL (`SUM(monto_pagado) FILTER (WHERE FALSE)`),
cada uno mata su test.

### `HORAS_TRABAJADAS` (e2e)

Aporte igual al pool y horas 4:2:1 — si el reparto siguiera la plata en vez de las horas, el
test no distinguiría nada. Las sesiones se siembran por SQL **cerradas**, por la misma razón
que el archivo ya inserta los tips directo: no hay forma de que un test haga durar una sesión
tres horas. **Mutante:** que `HORAS_TRABAJADAS` devuelva peso `1` —o sea partes iguales— lo
mata.

⚠️ **Y dejó una lección de orden de limpieza, medida dos veces.** El `afterAll` propio del
test tiene que **drenar el pool antes** de borrar las sesiones: al revés, los tips quedan sin
ningún participante con peso y el test siguiente corta con un 400 que no es suyo. Y borrarlas
hay que borrarlas: si quedan vivas, Carla pertenece a "Garzones" por la sesión y a "Cocina"
por su tip, y el test de dos grupos corta con **otro** 400 ajeno.

### Las guardas de entrada: entró una rama, no tres

Se escribieron tres tests, pero **solo uno cubre una rama que no estaba cubierta**: el
rechazo de `peso <= 0` en `MANUAL/PESOS` (`propina-distribucion.service.ts`), que ningún unit
mataba. Los otros dos —rango invertido y Σ de porcentajes— ya los mataban tests unitarios
preexistentes (`utils/rango-liquidacion.spec.ts`, `query-propina-reporte.dto.spec.ts`,
`propina-distribucion.service.spec.ts`); quedan como cobertura por HTTP, que no es lo mismo
que cobertura nueva. Lo midió la revisión independiente apagando las cuatro guardas y viendo
qué se ponía rojo.

Peor todavía, y anotado para el próximo: el test del rango invertido **no distingue cuál de
las dos guardas con el mismo mensaje está viva** —hay una en `rango-liquidacion.ts` y otra
duplicada en `computarReparto`—, así que apagar una sola lo deja en verde.

La tercera de la lista original, `gruposConfig.length === 0`, resultó inalcanzable; ver
[`pendientes.md`](pendientes.md).

## Los dos E2E que la feature de pausa dejó abiertos (2026-08-09)

Los dos estaban anotados desde el 2026-08-03 con la misma forma: *"el comportamiento es
correcto por construcción, pero eso lo sostiene un razonamiento, no un test"*. Los dos
razonamientos resultaron ciertos —ningún bug— y ahora los sostiene algo que se puede romper.

### Una regla pausada no queda congelada en `ventas_descuentos`

Vive en `ventas.e2e-spec.ts` § *"la venta congela la regla aplicada"*, que es donde ya
estaban el helper de descuentos y la query de las filas: es el **caso negativo** de ese
describe.

Una sola venta cubre los **dos** caminos por los que una regla llega a una línea: heredada
por asociación al ítem (lo que hace el POS, que no manda `descuentoIds`) y pedida explícita
por línea, que es la forma más forzada de intentar aplicarla.

No alcanzaba con mirar el total: una fila con `valor_aplicado = 0` daría el mismo total y
mentiría en el detalle, diciendo que se aplicó una regla que el tenant tenía apagada. Por eso
se afirman las dos cosas — cero filas **y** `totalDescuentos` en cero.

**Mutante:** borrar la guarda `if (!regla.activo)` del motor —o sea volver al comportamiento
anterior a la feature— deja **2** filas donde el test espera 0. Que sean dos y no una es la
prueba de que los dos caminos se ejercitan de verdad.

### Una cuenta de salón con el ítem pausado después de cargarlo se cobra igual

Vive en `items-pausados.e2e-spec.ts`, que es el spec del ítem pausado **por canal** y cuyo
propio docblock listaba Salones como el canal sin cubrir. La razón por la que no se había
escrito —"no existe `salones.e2e-spec.ts` del que partir"— ya no aplica: el arnés de mesa,
cuenta y garzón se resolvió esta semana.

La cuenta se arma en el `beforeAll`, con el ítem **todavía activo**: montarla después sería
imposible —`getItemVendibleOrThrow` rechaza la línea— y probaría el otro caso, el que ya
estaba cubierto. Por eso el test lleva además un **control**: agregar la línea AHORA da 404.
Sin él, un `getItemVendibleOrThrow` que dejara de mirar `activo` haría pasar el cobro por la
razón equivocada.

**Dos mutantes, los dos medidos:** filtrar `i.activo = true` en `cargarBasePorIds` —el
"arreglo" que alguien haría para que lo pausado no se venda— mata este test y otros cuatro
del mismo archivo; y sacar `AND i.activo = true` de `getItemVendibleOrThrow` mata solo el
control, con `Expected 404 / Received 201`.

Es el lado de la regla del owner donde **el consumo ya ocurrió**: el plato está en la mesa.
Que la cuenta no se pudiera cobrar porque el admin pausó el ítem mientras el cliente comía
sería dejar a la mesa sin forma de pagar.

## Los ítems pausados dejan de viajar al cliente (2026-08-09)

**Decisión del owner, y no era el trabajo que había anotado.** El backlog decía que "el
filtro de ítems pausados en los tres catálogos de venta no tiene test". Al plantearlo, el
owner enunció la regla directamente: *"no quiero filtro de ítems pausados en el POS ni en el
salón ni en online, simplemente no salen"*. Medido contra el código, eso era **casi** lo que
pasaba, con dos correcciones al enunciado del backlog:

- Son **cuatro** superficies de venta, no tres: `ventas/pos.vue`, `salones/index.vue`,
  `tienda/index.vue` y `tienda/suscripciones.vue`.
- El pausado **sí salía del backend**; lo descartaba cada pantalla con
  `.filter(i => i.activo)` después de pedir `pageSize=100`. Y eso **no es equivalente** a "no
  salen": el pausado ocupaba uno de esos 100 lugares, así que en un catálogo de más de 100
  ítems cada pausado empujaba fuera de la pantalla a uno vendible — un ítem desaparecía del
  POS sin que nadie lo hubiera pausado. `GET /items` no tenía filtro por `activo`.

**La forma fiel es que no vengan**, y es la que se implementó: `activo` como parámetro de
`GET /items`, las cuatro pantallas piden `activo=true` y ninguna filtra más en el cliente.

**Tres estados, no dos**: ausente no filtra (la pantalla de configuración muestra pausados y
activos juntos, con su badge), `true` deja los vendibles, `false` deja los pausados. La
coerción del booleano no es la de `incluirEliminados`, y la primera redacción de esta ficha
justificaba eso mal —decía que `value === 'true'` convierte el ausente en `false`—. **Es
falso y lo midió la revisión independiente**: `@Transform` no corre sobre una clave que no
vino, así que con esa coerción el ausente sigue sin filtrar. Lo que sí cambia es la basura:
`activo=TRUE` o `activo=1` caerían a `false`, o sea al catálogo **invertido**, en silencio.
Acá dan 400 — medido junto con `activo=`, `?activo` sin valor y `activo=yes`.

**Compatible hacia atrás:** sin el parámetro la respuesta es la de siempre, así que las cinco
pantallas que listan ítems fuera de venta (configuración de ítems, grupos de modificadores,
inventario, recuentos y mermas — siete *call sites*, porque la de ítems hace tres) no se
enteran, y ahí un pausado **tiene** que verse.

**Los mutantes, los tres medidos** en `items-pausados.e2e-spec.ts`:

- **sin el filtro en la query** (o sea, el estado anterior): mueren 3 tests.
- **`if (query.activo)` en vez de `!== undefined`**: mueren 2 — `activo=false` deja de
  filtrar, que es el borde que la coerción de tres estados existe para proteger.
- **sacar `&activo=true` de una URL de `salones/index.vue`**: muere el test nuevo de
  `index.nuxt.spec.ts`, que captura las URLs **completas** con query string. Sin eso el
  parámetro se puede borrar con la suite en verde, que es la misma trampa ya documentada
  para `enTurno` en el selector de garzones.

Lo que el e2e afirma y un filtro de cliente no puede dar: el **`total` de la paginación**
baja al pausar. Esa es exactamente la diferencia entre las dos formas — que el pausado deje
de ocupar un lugar de la página, no solo que no se dibuje.

## El aviso de ítem eliminado se podía borrar sin que nada se pusiera rojo (2026-08-09)

**La entrada:** el computed `cuentaConItemEliminado` (`pages/salones/index.vue`) no tenía
cobertura, con el mutante medido: `computed(() => false)` dejaba el **frontend entero** en
verde. Lo que faltaba no era el arnés —`pages/salones/index.nuxt.spec.ts` ya existía, creado
para el guard de reentrancia— sino el **fixture**: una cuenta que ya venga con una línea
marcada, que el mock del `POST` no produce porque abre cuentas vacías.

**Cómo se cerró:** el mock de `GET /mesas/:id/cuentas` pasó a devolver una lista
configurable (vacía por defecto, así los tests viejos no se enteran) y se agregó el de
`POST /calculo-precios/calcular`, que en este escenario **falla** — que es lo que hace el
backend real: el motor resuelve los ítems contra el catálogo vivo y devuelve 404.

⚠️ **Y el arnés tuvo que aprender a rendir plata**, que fue el bloqueo de la revisión
independiente sobre la primera versión: con el store de monedas vacío `formatMonto` devuelve
`'—'` para **cualquier** monto, así que la fila de Totales se veía igual con y sin el
computed y las dos aserciones que la miraban **no podían fallar bajo ninguna mutación**. El
spec hidrata la moneda del tenant y la aserción de plata va sobre **la fila del Total**, no
sobre el `textContent` del drawer —que rinde `— Cuenta 9` en la cabecera, y por eso un
`toContain('—')` daba verde siempre—. (El cartel sí se busca en el texto del drawer: ahí no
hay ambigüedad y mata los dos mutantes.) Mismo patrón que
[`anti-patterns.md`](anti-patterns.md) registra para el SQL: una aserción que matchea otra
cosa parece cobertura y no lo es.

Dos tests, uno por cada mutante:

- **avisa, tapa el total y deshabilita el cobro.** Mata `computed(() => false)`. Lo que
  importa no es solo el cartel: con el mutante puesto la aserción del total falla con
  `expected '$0' to be '—'`, o sea reproduce el síntoma exacto —una cuenta con productos
  mostrando **Total $0**, que invita a cobrar cero— y no solo la ausencia del cartel.
- **la misma cuenta sin la marca cobra normal.** Mata el mutante espejo,
  `computed(() => true)`, que dejaría toda cuenta sana imposible de cobrar. Sin este, el
  primero pasaría igual.

## El camino a cocina no lo tocaba ningún test (2026-08-09)

**La entrada:** los únicos tests que afirmaban sobre `estaciones` eran unitarios con el SQL
mockeado, y un `grep` de `comanda` sobre `backend/test/` y `frontend/e2e/` no devolvía una
línea. La razón por la que nunca se escribió estaba medida: con el seed
`agruparEstacionesComanda` devuelve siempre `[]` —la categoría con impresora existe pero no
tiene ningún ítem adentro—, así que ver una comanda exigía cablear datos por SQL.

**Cómo se cerró:** `test/salones-comanda.e2e-spec.ts`, que **no espera nada del catálogo del
seed**: crea por API dos impresoras, dos categorías y cuatro ítems. (Del seed sigue saliendo
el escenario base —tenant, moneda, admin, el garzón y su turno—, como en todos los e2e.) Eso
da el escenario que el seed no tiene: **dos** estaciones distintas, **dos** líneas en una
misma estación, y una línea que no rutea a ninguna.

Cada pieza del fixture existe por un mutante concreto, y esto salió de la revisión
independiente, que **bloqueó** la primera versión: con una sola línea por impresora,
"agrupar por impresora" y "emitir una estación por línea" son indistinguibles, y el mutante
que manda tres papeles a cocina para una misma partida pasaba en verde.

Dos tests, y los tres mutantes medidos:

- **agrupa por impresora y saltea la línea sin ruta.** Mutante A: sacar
  `|| !row.impresora_id` de la guarda → aparece una tercera "estación" con
  `impresoraId: null` y nombre vacío, o sea un ticket dirigido a nadie. Mutante B: keyear el
  mapa por `cuenta_linea_id` en vez de `impresora_id` → tres estaciones donde van dos.
- **el claim avanza lo enviado.** Mutante: no ejecutar el `UPDATE` de `cantidad_enviada` →
  el segundo `reclamar` devuelve otra vez lo mismo, que es cocinar dos veces cuando el
  garzón toca "Enviar" de nuevo o el ticket no salió. El test también fija que lo agregado
  **después** sale por la diferencia (1) y no por el total (3).

**Y un hallazgo que dejó la corrida completa, que vale para el próximo e2e de salones:** la
primera versión usaba el garzón del seed (Ana) y volteó `garzon-modo-personal` con un
`400 "El garzón ya tiene una sesión abierta"`. La sesión es **única por garzón** y hoy
**seis** specs comparten a Ana, así que el estado se filtra de un spec al siguiente
—`jest-e2e.json` corre con `maxWorkers: 1`, o sea en serie: el que deja la sesión abierta le
rompe el `iniciar` al que viene—. (La primera redacción de esta ficha decía "en paralelo", y
es falso; lo corrigió la revisión independiente del 2026-08-09.) El spec pasaba aislado y la suite completa fallaba, que es el peor modo de falla.
Los dos specs nuevos de salones crean su propio garzón (`POST /garzones` devuelve el PIN
generado, una sola vez), lo que además hace innecesario el cierre defensivo previo que
copiaban de `combos`. Medido después del cambio: tres corridas completas con base fresca,
371 verdes las tres.

Queda abierta la mitad **de smoke manual** de la entrada original —el seed sigue sin permitir
ver una comanda en pantalla sin tocar SQL—, con el arreglo ya identificado en
[`pendientes.md`](pendientes.md).

## Dos huecos de test que el gate no veía (2026-08-09)

Los dos venían de revisiones independientes, los dos traían el mutante ya medido, y ninguno
se cerraba con "agregar un assert": había que construir el escenario que ningún test montaba.

### La transacción de `crearUsuario` no estaba protegida por ningún test

**La entrada:** reemplazar `this.dataSource.transaction(...)` por `this.dataSource.manager`
dejaba los unit y los e2e **en verde**. La transacción funcionaba —comprobado a mano:
rompiendo el `INSERT` de roles daba 500 y no quedaba ni el usuario ni la membresía— pero una
regresión pasaba sin ruido. El test que parecía cubrirlo, *"sin roles → 400"*, lo corta el
`ValidationPipe` antes de que el service arranque.

**Cómo se cerró:** un `describe('crearUsuario — atomicidad')` en
`tenants.service.spec.ts`. La clave del arnés es que el manager de la transacción y
`dataSource.manager` son **dos objetos distintos**, y lo que se afirma es cuál de los dos
recibió cada escritura — así el mutante falla por lo que hace, no por un `TypeError`.

Tres tests, tres invariantes:

1. **todo se escribe con el manager de la transacción** y `dataSource.manager` no recibe ni
   un `save` ni un `query`;
2. **la invitación se emite dentro** (`emitir(usuarioId, 'invitacion', managerTx)`): si se
   emitiera afuera y el alta fallara después, quedaría un link vivo apuntando a un usuario
   que no existe;
3. **si falla la última sentencia** —la baja de los roles que no vinieron— la promesa
   propaga y **el mail no sale**, porque el envío es post-commit.

**Verificado:** con el mutante puesto (la lambda invocada contra `this.dataSource.manager`)
caen los **tres**. Sin él, los 22 del archivo pasan.

### `fusionarCuentas` no tenía NINGÚN e2e, y su SQL solo corría mockeado

**La entrada:** `grep -rn "fusionar" backend/test/` no devolvía nada, y el único test que
recorría ese camino mockeaba `manager.query`, así que **no llegaba SQL a Postgres**. No era
teórico: el 2026-08-07 un `SELECT` nuevo de esa ruta filtraba `eliminado_el` sobre
`item_producto`, que no tiene esa columna. Habría reventado la fusión con un 500 sosteniendo
el `pessimistic_write` de todas las cuentas de la mesa, y el gate entero —1490 unit, 321
e2e, lint, typecheck— pasó en verde igual.

**Cómo se cerró:** `test/salones-fusion.e2e-spec.ts`, con el caso mínimo que pedía la
entrada. Lo que lo hace ejercitar el SQL en cuestión es la **presentación**: ese `SELECT`
solo se emite si alguna línea la tiene. Un producto con unidad base `kg` cargado en las dos
cuentas con unidades distintas —1 kg en el destino, 500 g en el origen— más un segundo ítem
que no matchea, y la fusión tiene que dejar **dos** líneas: la repetida sumada a 1,5 y
reconvertida a la unidad del destino, y la otra mudada tal cual.

**Los dos mutantes, los dos medidos:**

- **el histórico** — reponer `AND ip.eliminado_el IS NULL` en el JOIN a `item_producto`:
  `500` donde el test espera `201`. Es exactamente el bug que se escapó, y ahora se caza.
- **el de comportamiento** — sacar la llamada a `sincronizarPresentacion` del merge:
  `cantidadPresentacion` se queda en `1` mientras `cantidad` ya vale `1.5`, o sea la línea
  diría "1 kg" pesando kilo y medio.

**Los fixtures que la fusión consume son propios** —salón, mesa, ítems y **el garzón**,
creados en el `beforeAll`— porque una fusión cancela cuentas y borra líneas, y el seeder no
repara lo que una corrida previa dejó movido. Del seed salen el tenant, la moneda, el admin
y el turno. Medido: tres corridas seguidas sobre la misma base, verde las tres.

## `GET /tenants/members` repartía el roster con correos (2026-08-09)

**La entrada, como estaba en `pendientes.md`:** *"`GET /tenants/members` es el único
endpoint de `members/*` SIN `TenantAdminGuard`, y la Fase 2 del garzón lo convirtió en
superficie de UI (backend, `tenants.controller.ts`) — el hueco es **preexistente**: la
lectura estaba abierta a cualquier miembro autenticado del tenant mientras las tres
escrituras van con `TenantAdminGuard`. Lo que cambió el 2026-08-09 es **quién lo alcanza
sin querer**: antes había que armar la request a mano; ahora `configuracion/garzones.vue`
lo llama al montar para poblar el selector de cuenta vinculable, y esa pantalla no tiene
middleware de permiso propio. O sea que el roster completo —nombre, apellido y **correo**
de cada miembro— se renderiza en un dropdown. **No es fuga multi-tenant**: la query está
acotada a `user.tenantId`. Al arreglarlo hay que decidir si la lectura pasa a admin-only (y
entonces el selector de garzones necesita otra fuente, porque quien administra garzones no
es necesariamente admin) o si se expone una lista mínima `{ usuarioId, nombre }` sin
correos, como se hizo con `garzones/para-selector`."*

**Se hicieron las dos cosas, porque la disyuntiva era falsa.** `GET /tenants/members` pasó
a `TenantAdminGuard` con su payload intacto —correo y roles incluidos— y la única pantalla
que lo consume, `configuracion/usuarios`, ya era admin-only por middleware. Los otros dos
consumidores no necesitaban nada de eso: se les dio
**`GET /tenants/members/para-selector`**, que devuelve `{ usuarioId, nombre, apellido,
esTotem }` y nada más.

**Lo que decidió el corte fue medir qué usa cada consumidor**, no elegir entre dos formas:

- `configuracion/usuarios` — admin-only, usa correo y roles. Queda con el roster completo.
- `configuracion/cajas` — su interfaz local `Member` ya declaraba solo
  `{ usuarioId, nombre, apellido }`: **nunca miró el correo**.
- `configuracion/garzones` — usa `esTotem` para filtrar, y tenía el correo únicamente como
  *fallback* del label (`` `${nombre} ${apellido}`.trim() || m.correo ``). `usuarios.nombre`
  es `NOT NULL` —medido contra la base viva—, pero la validación del alta es `@MinLength(1)`
  (`crear-usuario-tenant.dto.ts`), que **acepta un nombre en blanco**: el fallback no era
  inalcanzable, solo improbable (0 filas así hoy). Se reemplazó por `'Sin nombre'`, que
  cubre el mismo caso sin repartir el correo.

**Por qué `para-selector` queda abierta a cualquier miembro autenticado, y es una decisión
y no un olvido:** sus dos consumidores viven en módulos de permiso distintos (`Cajas` y
`Salones`), así que ningún `@RequiresPermiso` único los cubre —y quien opera el salón ve los
nombres de sus compañeros en el selector de garzones igual—. Lo que no puede repartirse es
el correo (PII, y además el identificador de login) y la lista de roles (dice quién es
admin, o sea a quién atacar); ninguno de los dos sale de ahí.

**El mutante que lo fija:** hacer que `findMembersParaSelector` delegue en `findMembers`
—el atajo obvio, y exactamente el comportamiento anterior— pone en rojo
`para-selector: cualquier miembro lo lee, y NO trae correo ni roles`
(`tenants-members.e2e-spec.ts`), que recorre la respuesta campo por campo. El test hermano
del guard tiene su contrapeso: `GET /tenants/members` con admin **exige** que venga el
correo, así que un guard que rechazara a todos no pasaría en verde.

Nota de la migración de los e2e: las **12** llamadas GET a `/tenants/members` repartidas en
**4** specs (`caja`, `cajones`, `garzon-modo-personal`, `alta-usuarios-tenant`) ya usaban
token de admin —incluido `tokenSupervisor` de `caja.e2e-spec.ts`, que pese al nombre loguea
con `ADMIN_EMAIL`, y `tokenFalabella`, que es admin de ese otro tenant—. El único test que
había que reescribir era el que afirmaba que la lectura estaba abierta.

**Decisión del owner (2026-08-09): `para-selector` queda abierta a cualquier miembro
autenticado.** La revisión independiente marcó que el alcance concedido es más ancho que la
unión de sus consumidores —están detrás de `Cajas:Actualizar` y `Salones:Actualizar`, y el
hermano que se cita como patrón (`garzones/para-selector`) sí lleva `@RequiresPermiso`— y lo
dejó a criterio del owner. Respuesta: *"que se vean los nombres de los compañeros, no es
crítico"*. Lo que sí es crítico —correo y roles— ya no sale de ahí. Si algún día cambia, la
salida es **dos rutas**, una por módulo, porque el decorador admite un solo par
`(módulo, permiso)`.

## No había forma de mandar un mail, y eso bloqueaba tres cosas (2026-08-09)

**Cerrado por el servicio de mail + invitación por link + reset.** Se resolvieron los
puntos 2 (invitación) y 3 (reset). El punto 1 —verificación de correo— quedó **medio
cerrado y sigue en `pendientes.md`**: la invitación prueba la dirección **del invitado**
(si hizo clic, existe y alguien la lee), pero el auto-registro público sigue sin verificar.

**Cómo se cerró:** `nodemailer` contra SMTP propio, detrás de una interfaz que con
`SMTP_HOST` vacío **loguea en vez de mandar** —obligatorio, no comodidad: si no, cada
corrida de los e2e dispara mails reales y CI necesitaría credenciales—. Una sola tabla
`tokens_acceso` para los dos flujos, guardando **SHA-256 del token, no el claro**;
determinista a propósito para poder indexarlo, que es lo que evita la amplificación que se
sacó del PIN del garzón.

**Lo que quedó fijado por test:** que un link no sirva dos veces, que uno vencido no sirva,
que un token de invitación no valga como reset, que en la base esté el hash y no el claro,
que `/auth/recuperar` responda idéntico exista o no el correo, y que el entorno de test
**no mande mail**. Dos los encontró la revisión y se sumaron con su mutante: que el link de
invitación viejo **no sobreviva a un reset** (era toma de cuenta: 7 días de ventana para
quien tuviera ese primer mail), y que quemar un token dos veces falle la segunda —el test
por HTTP que creía cubrirlo no se solapaba y pasaba con la guarda borrada—.

⚠️ **La instrucción sobre `refresh()` que traía esta entrada quedó sin objeto**: decía que
al implementar el reset había que mirar `debe_cambiar_contrasena` también en
`AuthService.refresh()`. Esa columna **la borró este mismo cambio** junto con todo el
andamiaje de la contraseña temporal.

<details>
<summary>Texto con el que estaba en <code>pendientes.md</code></summary>

- [ ] **No hay forma de mandar un mail, y eso bloquea tres cosas a la vez** (backend) —
  medido el 2026-08-08: cero rastros de `nodemailer`, `@nestjs-modules/mailer`, SMTP,
  SendGrid o Resend en `package.json` ni en `backend/src`. **No es una feature faltante, es
  infraestructura ausente**, y por eso bloquea:
  1. **Verificación de correo** al dar de alta un usuario del tenant. Diferida
     explícitamente por el owner (2026-08-08) *"porque no hay nada para enviar mail aún"*.
     ⚠️ Mientras no exista, un admin puede sumar **cualquier correo registrado** a su tenant:
     el daño está acotado —sumarte a mi restaurante no me da acceso a tus datos, te da
     acceso a los míos— pero **filtra si ese correo está registrado** (enumeración), y a la
     persona le aparece un tenant que no pidió.
  2. **Invitación por link**, que es lo que reemplazaría a la contraseña temporal del alta
     (ver `docs/superpowers/plans/2026-08-08-alta-de-usuarios-del-tenant.md`). Con
     invitación, el admin deja de conocer una contraseña válida de otra persona.
  3. **Reset de contraseña** ("olvidé la mía"), que **tampoco existe** hoy: no hay ningún
     endpoint que reponga una contraseña. El único de contraseña es `PATCH /me/contrasena`,
     que **exige la actual**.
     ⚠️ **Al implementarlo hay que mirar `debe_cambiar_contrasena` también en
     `AuthService.refresh()`.** Hoy el flag se controla solo en `switchTenant`, y alcanza
     porque únicamente lo llevan cuentas recién creadas, que nunca tuvieron token de tenant.
     Un reset se lo pone a alguien **con sesión viva**: sin el chequeo en `refresh`, esa
     sesión se renueva sola con el tenant que ya tenía y se saltea el cambio. Se probó
     agregarlo por adelantado y se sacó: era una rama inalcanzable y sin test dentro del
     subsistema que la invariante 4 pide no tocar.
  **La dependencia ya está decidida** (owner, 2026-08-08): **`nodemailer`** contra el
  **SMTP propio del owner** (Gmail o corporativo). Las tres se resuelven con la misma
  infraestructura, así que se hace una vez y no tres. Lo que falta es ejecutarlo — el owner
  lo pospuso para después de cerrar la Fase 2 del garzón.

  Lo decidido y lo que se descartó, con su porqué:

  - **`nodemailer` es el cliente, no el proveedor.** Se escribe contra SMTP, así que el
    proveedor real (Resend / SendGrid / SES / el que sea) entra por `.env` el día del
    deploy **sin tocar código**. Es la decisión menos comprometedora disponible.
  - **NO sumar `@nestjs-modules/mailer`.** Trae motor de plantillas y config propia para
    resolver dos mails. `nodemailer` pelado alcanza.
  - **Se descartó Mailpit** (capturador SMTP local en `docker-compose`) porque el fallback
    de abajo da el mismo loop de desarrollo sin sumar un servicio.
  - ⚠️ **Restricción de diseño, no opcional: los tests no pueden mandar mail de verdad.**
    Se corren 342 e2e en cada cierre y en CI; mandando en serio, cada corrida dispara mails
    reales, come el tope diario de Gmail (~500/día) y CI necesitaría las credenciales del
    owner. Por eso el envío va detrás de una interfaz que **con `SMTP_HOST` vacío loguea el
    mail en vez de mandarlo**. Beneficio lateral: el link de invitación aparece en el log
    del backend, que es todo el loop de desarrollo que hace falta.
  - **Credenciales:** claves `SMTP_*` **vacías** en `.env.example` (mismo patrón que
    `GOOGLE_CLIENT_SECRET` y `QZ_PRIVATE_KEY`); el owner completa su `.env`, gitigno­rado.
    Gmail exige 2FA + **App Password**, no la contraseña de la cuenta. Y reescribe el
    remitente a la dirección de la cuenta: no se puede mandar como `no-reply@dominio`.

  **Decisiones que faltan y que el plan tiene que poner sobre la mesa:** cuánto vive una
  invitación y qué pasa al expirar; si invitación y reset comparten tabla de tokens (se
  parecen mucho: token de un solo uso, con vencimiento, que termina en "elegí tu
  contraseña"); y si la verificación de correo entra en la misma tanda.

  ### Lo que ya se decidió sobre esto (charla con el owner, 2026-08-08)

  - **Se manda un link de invitación, NO la contraseña por mail.** La contraseña mandada por
    correo queda en la casilla en texto plano para siempre, es reenviable y pasa por
    servidores intermedios; el link se quema al usarse. Además, con invitación **nadie más
    que la persona conoce jamás una credencial suya** —hoy el admin la dicta, o sea que hay
    un momento en que otro ser humano sabe cómo entrar a esa cuenta— y la verificación de
    correo sale gratis: si hizo clic, la dirección existe y es suya.
  - **Con invitación desaparecen la temporal, `debe_cambiar_contrasena`, el 403 de
    `switchTenant` y la pantalla `/cambiar-contrasena`.** No se suavizan: se borran. Todo
    ese andamiaje existe **solo** porque hay una contraseña que un tercero conoce. El owner
    propuso reemplazar el bloqueo por un modal que insista en cada login; se descartó
    mientras la temporal la dicte el admin, porque un modal que se puede cerrar deja la
    ventana de suplantación abierta indefinidamente en vez de acotarla a un login.
  - **NO se va a construir "reposición por el admin".** Se evaluó como paso previo (cierra
    el callejón de la temporal perdida sin necesitar mail) y **el owner la descartó**: con
    self-service el reset llega siempre al correo de la persona, así que el admin no
    necesita conocer ninguna credencial ajena. Construirla ahora sería trabajo que el mail
    tira, y obligaría a decidir una regla que con mail ni se plantea (ver abajo).
  - ⚠️ **La escalada entre tenants que evita el self-service, anotada para que no se
    redescubra:** la contraseña es del **usuario**, no del tenant — una sola cuenta para
    todos los tenants a los que pertenece. Si un admin del tenant A pudiera reponerla, se
    quedaría con una credencial válida para entrar como esa persona **en el tenant B**. Hoy
    el alta esquiva el problema no tocando nunca la contraseña de un correo que ya existe;
    cualquier reposición por admin que se proponga en el futuro tiene que resolver esto
    primero.
  - **Callejón sin salida que existe mientras tanto, asumido:** la temporal se muestra una
    sola vez. Si se pierde, la cuenta queda muerta —re-dar de alta responde 409, cambiarla
    exige saberla, y no hay reset—. Se asume porque no hay datos productivos ni gente
    usando el sistema: es riesgo de laboratorio, no de operación.

</details>

---

## Lo que está en pausa no se aplica ni se ofrece (2026-08-03)

- [x] **Un descuento, recargo o impuesto desactivado seguía aplicándose** (backend +
  frontend, cerrado 2026-08-03) — `activo` se escribía y no lo leía nadie:
  `indexarReglas` ni siquiera copiaba el campo al mapa del motor. El front escondía la regla
  del selector y el back la seguía cobrando.
  **La forma anotada el 2026-07-30 —desactivar limpia las asociaciones— quedó sustituida.**
  El owner precisó el 2026-08-03 que *desactivar es pausar, no eliminar*: la regla deja de
  aplicarse pero conserva sus asociaciones, y reactivarla la devuelve como estaba. Con eso se
  cayeron el cambio de esquema en las tres tablas puente, el problema de la PK compuesta
  bloqueando la reinserción, y el modal de restauración: nada de eso hizo falta.
  **Cómo se cerró:** `ReglaResuelta` e `ImpuestoResuelto` llevan `activo` **requerido** —si
  fuera opcional, olvidarse de mapearlo revive el bug en silencio—, y el descarte pasa al
  **aplicar**, no al cargar: la regla sigue en el mapa, porque sacarla haría que `requerir()`
  tirara 400 por id ausente en cada ítem asociado y el POS dejaría de vender. Cada descarte
  emite una `AdvertenciaPrecio`, siguiendo el precedente del tope.
  **Lo que fija cada cosa:** el mutante que revierte al comportamiento anterior (aplicar la
  regla pausada) rompe los tests; el control —*la misma regla activa sí descuenta*— impide que
  un motor que ignorara TODOS los descuentos pasara igual; y el test del desbruteo prueba que
  el impuesto pausado sale de la lista **antes** de dividir, no al aplicarlo, que era donde el
  neto se habría calculado mal sin que ningún total lo delatara.
  **Efecto lateral atendido:** la rama de recargos descartaba `r.advertencias` porque el tope
  solo avisa en descuentos y nunca había nada que perder. Con reglas pausadas sí lo hay.
- [x] **El IVA quedó explícitamente fuera del interruptor** (cerrado 2026-08-03) — lo gobierna
  la clasificación tributaria del ítem, nunca `activo` ([ADR-018](../adr/018-iva-derivado-de-la-clasificacion.md)).
  `CalculoPreciosService` fuerza `activo: true` al derivar el IVA del país, con un test que lo
  fija: *un ítem afecto paga IVA aunque la fila esté en `activo = false`*. Sin ese blindaje,
  una fila mal sembrada dejaba de cobrar IVA en silencio — problema fiscal, no aritmética.
  Su gemelo con dientes: *un adicional pausado del mismo catálogo sí se descarta*, para que el
  forzado no degenere en un "todo activo" que anule la feature.
- [x] **Un ítem pausado se vendía igual por POS y tienda online** (cerrado 2026-08-03) —
  hallazgo que no estaba en el radar y pegaba más fuerte que el de las reglas: `salones` exigía
  `AND i.activo = true` pero `cargarBasePorIds` —el camino del POS y de la tienda— solo
  filtraba `eliminado_el IS NULL`, y ninguno de los tres catálogos del front lo escondía.
  Cerrado con el comportamiento por canal que decidió el owner: **la tienda online rechaza el
  checkout** nombrando el producto (el carrito vive en el navegador, así que el ítem se puede
  pausar entre que se agrega y se paga, y ese es el único punto donde atajarlo); **el POS
  advierte y deja cobrar**; **salones no se toca** —lo ya cargado se cobra, agregar más se
  sigue rechazando—. La regla de fondo: se bloquea donde todavía no pasó nada, no se bloquea
  donde el consumo ya ocurrió en el mundo físico.
  El filtro **no** se puso en `cargarBasePorIds`: lo comparten los tres canales y cada uno
  necesita algo distinto. Y la advertencia del ítem pausado vive en el service, no en el
  motor: el motor calcula plata y un ítem pausado no cambia ningún monto.
- [x] **Refutado: editar un ítem NO borra la asociación de una regla pausada** (frontend,
  verificado en navegador 2026-08-04) — la revisión de cierre sospechaba que el
  `USelectMenu`, cuya lista de opciones excluye las pausadas, podía recortar del `v-model`
  los ids que no estuvieran en esa lista: editar cualquier campo del ítem habría borrado la
  asociación y la promesa del modal ("las asociaciones se conservan") habría dejado de ser
  cierta. **Se probó por los dos caminos y sobrevive en ambos:** renombrando el ítem sin
  tocar el selector, y abriendo el selector para agregar OTRO descuento —ahí el array quedó
  con los dos, el pausado incluido—. El componente no recorta.
- [x] **Pero el selector mostraba el UUID crudo de la regla pausada** (frontend,
  `items.vue`, cerrado 2026-08-04) — hallazgo colateral de esa misma verificación, y este sí
  era real: al excluir las pausadas de las opciones, el select no podía resolver id → nombre
  para una regla YA asociada y pintaba `3a1a81a4-feeb-41d0-…` donde el admin esperaba un
  nombre. Preexistente, pero casi inalcanzable hasta ahora: nadie pausaba porque pausar no
  hacía nada. **Cierre:** las opciones incluyen también las pausadas **que el ítem ya tiene
  asociadas**, con el sufijo `(en pausa)` —conservando el `(Sistema)` de los impuestos del
  catálogo oficial, que la primera versión se comía—. No contradice "lo pausado no se
  ofrece": aparece para explicar lo que ya está puesto, no para elegirlo de nuevo.
  **Dos lecciones del molde de tests, las dos medidas con mutantes:**
  1. **Un `USelectMenu` cerrado no renderiza sus opciones** —viven en el portal de reka-ui y
     no llegan al `document.body` hasta que se abre—, así que un
     `expect(document.body.textContent).not.toContain(...)` sobre una opción **no observa
     opciones: observa selección**, y pasa con cualquier implementación. La primera versión
     de estos tests afirmaba cubrir "la pausada no asociada no se ofrece" y no cubría nada:
     el mutante que ofrecía TODAS las pausadas pasaba 15/15. Se corrigió afirmando sobre el
     prop `items` de cada select. Hoy los tres mutantes caen: ofrecer todas, revertir el
     arreglo, y revertir un solo gemelo.
  2. El drawer se teletransporta a `document.body`, así que un `unmount()` que no corre por
     una aserción fallida contamina tests **posteriores**. Sin el `finally`, el mutante hacía
     caer además el test del chip de IVA y la señal apuntaba al lugar equivocado.
- [x] **`metodos_pago.activo` era una columna muerta** (cerrado 2026-08-03) — existía en el
  esquema, la entidad y el seed, y no la leía ningún código. El interruptor real es
  `tenant_metodo_pago.habilitada`, que además es por tenant; `activo` habría sido global, y en
  multi-tenant lo global casi nunca es lo que se quiere. Se eliminó de los tres lugares.

---

## Congelado de las reglas aplicadas en la venta (2026-08-02)

- [x] **El valor de un tramo nunca se validaba: un "50%" cargado como `50` pasaba**
  (backend, cerrado 2026-08-02) — `validarValor()` exigía que un porcentaje fuera `< 1`,
  pero **solo se invocaba para `TIPOS_CON_VALOR_UNICO`**. Los tipos por tramos pasaban por
  otra rama que solo verificaba que **hubiera** al menos un tramo; el `valor` de cada uno lo
  tipaba `TramoDto` con un `@IsNumberString()` pelado. La misma regla de negocio se
  enforzaba o no según el tipo, y un tramo `porcentaje` con `50` producía un descuento del
  **5000%**.
  **Al arreglarlo apareció la cara opuesta de la misma falla:** `validarSegunTipoUpdate`
  resolvía el modo como `dto.modo ?? 'porcentaje'`, así que un `PATCH { valor: '5000' }`
  sobre una regla `monto_fijo` que no reenviaba el modo se rechazaba con 400 — una edición
  legítima, imposible desde la API. Las dos son *validar el campo que llegó en vez del
  estado que queda*, que es la lección que este archivo ya tenía escrita de la oleada
  anterior (`validarEstadoResultante`).
  **Cómo se cerró:** `validarMontosDeRegla(modo, valor, tramos)` en
  `common/utils/monto-regla.util.ts` valida el `valor` plano y el de **cada tramo** con el
  **mismo** modo — el modo con el que la fila queda, no el que llegó. Se extrajo a `common/`
  (decisión del owner) en vez de duplicarla en los dos services: el costo de la duplicación
  anterior no fue que las copias divergieran, sino que nadie podía ver de un vistazo si
  todos los caminos la usaban — y en dos de cuatro no. En `update` los tramos se leen de la BD cuando el `PATCH` no los trae, para
  que cambiar solo el `modo` no reinterprete valores ya guardados (un tramo de `5000`
  legítimo como monto fijo pasaría a ser 500.000%). El mismo fix en `recargos`, donde ningún
  tipo pide tramos pero la plomería es alcanzable por API y el motor los evalúa mirando
  `tramos.length` antes que el código del tipo.
  **Qué lo fija:** `reglas-valor.e2e-spec.ts` gana cinco casos —tramo `50` en porcentaje
  (400), el mismo `5000` en monto fijo (201, ancla positiva), `PATCH` de solo el modo que
  revalida los tramos guardados, `PATCH` de valor sobre `monto_fijo` (200) y el gemelo de
  recargos— más siete unit entre los dos services. Los dos bugs se verificaron **abiertos**
  contra la API real antes de cerrarlos y **cerrados** después. Mutantes: quitar la
  validación de tramos mata 4 tests; volver a `dto.modo ?? 'porcentaje'` mata 1.
  ⚠️ La revisión que lo encontró lo reportó como riesgo de *overflow* de `NUMERIC(7,4)`;
  eso estaba mal —esa columna aguanta hasta `999.9999`, un `50` cabe—. El daño era el
  descuento absurdo, no el desborde.

- [x] **El recorte de un descuento no queda auditado en ninguna parte** (backend, cerrado
  2026-08-02) — cuando el piso topea un descuento de 500 a 100, en BD quedaba un descuento
  de 100 sin ningún rastro de que la regla valía 500; el motivo vivía solo en un toast que
  el cajero puede no leer.
  **Cómo se cerró:** la entrada proponía "una columna o flag en el detalle de venta", y al
  medir resultó ser la punta de un hueco más grande: la venta tampoco guardaba **con qué
  valor** aplicó ninguna regla, así que editar un descuento de 10% a 20% reescribía el
  pasado. Se resolvieron juntos. `ventas_descuentos.valor_solicitado` guarda lo que la regla
  pedía —separado de `valor_aplicado`, que sigue siendo lo que entró en el total para que el
  comprobante cuadre—, y las tres tablas congelan además `nombre_regla`, `modo`,
  `porcentaje_aplicado` y `detalle_id`. No es un flag: guardar el **monto pedido** dice
  cuánto se recortó, mientras que un booleano solo diría que algo se recortó.
  **Qué lo fija:** `ventas.e2e-spec.ts` → "guarda lo que el descuento pedía cuando el piso
  en cero lo recortó" (aplicado $2.000 / solicitado $5.000) y el unit gemelo en
  `ventas.service.spec.ts`. Mutantes verificados: revertir al código sin `detalle_id` y
  atribuir todo a `detalles[0]` — los dos matan el test de las dos líneas, en unit y en e2e.
  Detalle completo en `docs/features/motor-calculo-precios.md` → "La venta congela la regla
  que aplicó". Plan: `docs/superpowers/plans/2026-08-02-congelar-reglas-en-la-venta.md`.

---

## Papelera — las 15 pantallas del frontend (2026-08-02)

- [x] **Las 15 pantallas de la papelera cableadas** (frontend, cerrado 2026-08-02) —
  ⚠️ **Corregido (Ronda de fixes 1):** son 16 recursos backend, pero **15
  pantallas** — `mesas` no tiene página propia, vive dentro de
  `configuracion/salones.vue`, así que no cuenta aparte.
  `configuracion/items.vue`, `configuracion/categorias.vue` y —desde el
  2026-08-01— `configuracion/impuestos.vue`, `configuracion/descuentos.vue` y
  `configuracion/recargos.vue` y `configuracion/turnos.vue` tienen el toggle
  "ver eliminados" y el botón restaurar; las otras 9 (`grupos-modificadores`,
  `terceros`, `cajones`, `garzones`, `salones` [con sus `mesas`], `impresoras`,
  `causas-merma`, `motivos-diferencia`, `motivos-diferencia-inventario`) quedan
  sin UI. El molde ya está probado en las seis pantallas hechas:
  `usePapelera(recurso)`
  (`app/composables/usePapelera.ts`) da el toggle, `restaurar(id, nombre?)` y
  `formatearBorradoPor(fila)`.
  📐 **Usar `configuracion/descuentos.vue` + `descuentos.nuxt.spec.ts` como
  molde** (antes era `impuestos`): es el que tiene la salida de colisión y el
  primero cuyos 11 tests se verificaron uno por uno contra el mutante que cada
  uno debería cazar. `recargos.vue` + `recargos.nuxt.spec.ts` son la copia de ese
  molde, también con los mutantes corridos — sirve de referencia de qué cambia y
  qué no al replicarlo (spoiler: solo los nombres). Para una pantalla SIN
  unicidad de nombre, copiar todo menos el modal de colisión y sus 4 tests. Lo que las rondas de
  revisión corrigieron, y que conviene no volver a romper:
  - **Guard de reentrancia en `restaurar`, y aplica a las 9.** El `CrudModal`
    no se cierra solo al confirmar —lo cierran las funciones de la página—, así
    que mientras el `POST` viaja el segundo click manda un segundo
    `POST .../restaurar` sobre una fila que el primero ya revivió, el backend
    contesta 404 y el usuario ve un toast de **error inmediatamente después de
    un restore exitoso**. Reproducido en la re-revisión.
    ⚠️ **Corregido el 2026-08-01 (medido con mutantes sobre `descuentos`):** una
    versión anterior de esta entrada decía "el `ref` es la protección, el
    `:loading` solo el feedback". **Es falso**: `:loading` deshabilita el botón,
    así que las dos capas se tapan mutuamente y sacar cualquiera por separado
    deja el test en verde — solo sacando las dos se rompe. No es motivo para
    borrar ninguna (el `ref` cubre la función, que en `descuentos` entra también
    por el botón del modal de colisión), pero sí para no creerle a un test que
    "prueba el guard": prueba la conducta, un solo POST.
  - **El fixture del test tiene que estar ELIMINADO** para que una aserción
    negativa (`not.toContain('Restaurar')`, etc.) pruebe algo. Con todas las
    filas vivas esa rama no se renderiza para ninguna y la aserción pasa por
    construcción — pasó en la primera versión de este spec. Regla general:
    toda aserción negativa necesita un ancla positiva al lado.
  - **El badge "Eliminado" se asserta por elemento, no por subcadena.** Un
    `toContain('Eliminado')` sobre el texto de la página queda subsumido por
    "Eliminado por &lt;autor&gt;" y no caza que borren el badge. En
    `categorias.vue` esa línea funciona solo por el género ("Eliminada" vs
    "Eliminado por"): **no copiarla a las pantallas masculinas**, que son casi
    todas las que faltan. ℹ️ `items.nuxt.spec.ts` ya tiene una de esas
    subsumidas, preexistente: cerrarla cuando se toque ese spec.
  ⛔ **Lo que NO hay que copiar de `impuestos`: el guard de `origen`.** Esa
  pantalla tiene filas que el listado de la papelera devuelve pero que **no se
  pueden restaurar** (el catálogo oficial del país). **Medido el 2026-08-01: el
  caso es exclusivo de `impuestos`** y no se repite en ningún otro de los 16 —
  es el único listado que devuelve filas ajenas al tenant (entran por la rama
  `pais_id` del `OR`, `impuestos.service.ts`, mientras `restaurar()` busca por
  `{ id, tenantId }`).
  ⚠️ **Una versión anterior de esta entrada decía lo contrario** —que el caso se
  repetía "en cada recurso con filas `es_fijo`", nombrando `causas-merma`,
  `motivos-diferencia` y `motivos-diferencia-inventario`—. **Es falso**: los tres
  tienen `es_fijo`, pero su `remove()` rechaza la fila fija con 400 antes de
  borrarla, así que **una fila fija nunca puede entrar a la papelera**. Copiar el
  guard ahí produce una condición muerta en el template y un test que no puede
  fallar. La afirmación se había generalizado desde un solo ejemplo sin contar
  los casos, que es el error que esta misma entrada advierte más arriba.
  **Cada pantalla nueva necesita el mismo fix que `items.vue` ya tiene en su
  `eliminar()`:** con el toggle "ver eliminados" activo, el `DELETE` no puede
  quitar la fila del array local — tiene que **recargar el listado**, porque el
  `DELETE` no devuelve `eliminadoEl`/`eliminadoPorNombre` (esos datos solo llegan en
  el próximo `GET ...?incluirEliminados=true`). Sin el fix, la fila desaparece en vez
  de pasar a "eliminada" y el usuario no puede restaurarla sin refrescar la página a
  mano. Ni el build ni el typecheck ven este bug — es un comportamiento de runtime
  del composable `eliminar()` de cada página, no un error de tipos.
  **Y cada pantalla necesita su propio test de página** (el proyecto no testea
  páginas por default, pero el bug de arriba es exactamente la clase de regresión que
  solo un test de página cazaría — build/typecheck/reviews no lo ven, como ya pasó
  una vez con el guard de reentrancia de `items.vue`, ver "Revisión final
  `borrado-ingrediente-extra`" más abajo).
  ⚠️ **Corregido (revisión final `papelera-restaurar-eliminados`):** falta un
  segundo fix, aparte del de `eliminar()` — la **carrera del toggle**. Dos
  toggles rápidos de "ver eliminados" disparan dos `GET` en vuelo; sin
  protección, gana el que responda último y no el que se disparó último (el
  listado final puede quedar desincronizado del switch). `categorias.vue` ya
  la tenía resuelta con una cola serial local (`cargaEnCurso` en `cargar()`);
  `items.vue` NO la tenía — el refetch lo dispara el `watch` de filtros de
  `usePaginatedList`, sin ninguna protección. El fix quedó en el composable
  (`usePaginatedList.ts` → `fetch()`, misma cola serial), porque ahí lo hereda
  cualquier pantalla que ya lo use, sin nada que replicar.
  ⚠️ **Corregido el 2026-08-01, y es el dato que decide el trabajo:** la
  versión anterior de esta entrada decía que `grupos-modificadores.vue` era la
  única de las 13 que usa `usePaginatedList` y que por eso "ya hereda el fix,
  nada que hacer". **Es falso, y de la peor forma**: mandaba a saltear justo la
  pantalla que necesita el arreglo. Medido —`grep` de las llamadas, no del
  import—: `grupos-modificadores.vue` **solo importa el tipo**
  `PaginatedResponse` y tiene su propio `cargar()` (`:309`) sin `cargaEnCurso`.
  **Ninguna de las pendientes usa el composable** (eran 13 cuando se midió; hoy
  quedan 9, las mismas menos `impuestos`, `descuentos`, `recargos` y `turnos`,
  que ya la tienen), así
  que **todas** necesitan la cola serial local. Los 10 consumidores reales de
  `usePaginatedList` (8 páginas + 2 componentes: `CajaHistorial`,
  `CajaMovimientosTable`, `sesiones-garzon`, `mermas`, `ordenes`,
  `ventas/index`, `configuracion/items`, `pagos/index`, `inventario/index`,
  `inventario/recuentos/index`) no son ninguna de ellas.
  **Las 9 necesitan la MISMA cola serial local que `categorias.vue` ya tiene**
  (`cargaEnCurso` en su `cargar()`): copiar ese patrón, no reinventar uno nuevo.
  Test determinístico por pantalla: promesas controladas que resuelven en orden
  inverso al de los dos toggles, como `descuentos.nuxt.spec.ts` → "papelera: la
  carrera de `cargar()` bajo toggles rápidos". El equivalente de `items.vue`
  ("la carrera del toggle vía usePaginatedList") **no** sirve de molde acá: ese
  ejercita el `watch` del composable, que ninguna de las 9 tiene.

  ---

  **CÓMO SE CERRÓ (2026-08-02).** Las 9 pantallas restantes se replicaron en
  paralelo, una por agente, cada uno con el molde y los hechos de SU pantalla
  medidos de antemano y con la instrucción de **parar y reportar BLOCKED si un
  dato del brief no cerraba contra el código**. Ese freno se usó dos veces y las
  dos el brief estaba mal, no el código:

  - `grupos-modificadores`: el brief decía que usaba `usePaginatedList` y que por
    eso heredaba la cola serial. **Falso**: el grep matcheó el import del TIPO
    `PaginatedResponse`, que la pantalla usa para el catálogo de `/items`; los
    grupos cargan con `useApiFetch<Grupo[]>`. De las 15, **solo `items.vue`**
    hereda la cola.
  - `garzones`: el brief pedía agregar un `restaurar(id)` a `useGarzones`. El
    agente no lo hizo porque `usePapelera(recurso)` ya lo provee y duplicarlo
    habría sido código muerto. Tenía razón: `turnos.vue`, que también tiene
    composable propio, hace exactamente eso.

  Los mutantes de esta entrada (A/C/E/F/G, +P donde hay permisos) se corrieron en
  las 9. Dos pantallas las escribió Haiku y sus mutantes se re-corrieron a mano
  antes de creerles — pero con `causas-merma` ya resuelta y validada como molde a
  un paso de distancia, no con el molde original.

  **Mutantes nuevos que salieron de este trabajo y no estaban en la lista:**
  - **I** (`impresoras`): `useImpresoras.listar()` la comparten los caminos de
    impresión (`imprimirComanda`, `obtenerImpresoraBoleta`). Un `incluirEliminados`
    con el default cambiado haría imprimir en impresoras borradas. Lo fija
    `useImpresoras.nuxt.spec.ts` sobre la cadena real, no sobre `listar()` aislada.
  - **M** (`garzones`): que el 400 del placeholder Mostrador se muestre como toast
    y no como modal de renombrado — renombrar no resuelve esa colisión.
  - **S** (`salones`): que el Restaurar de una MESA no pegue al endpoint del
    SALÓN. Son dos controllers distintos y es el error más fácil de cometer ahí.

  **Deriva que dejó el paralelismo, y que hubo que limpiar después:** tres copias
  idénticas de la misma función de orden (`esFijo` primero, después alfabético),
  extraída a `usePapelera.ts` → `ordenarFijosPrimero`; y `terceros` había perdido
  su uso de `CrudListItem` reemplazándolo por markup a mano, contra el precedente
  ya commiteado de `categorias.vue`. Ninguna de las dos la habría visto un agente
  mirando solo su pantalla: las encontró la revisión del diff completo.

---

## Unicidad de nombre — unificada (2026-08-01)

- [x] **La unicidad de nombre estaba partida 4 y 4, sin que nadie lo hubiera
  decidido.** Medido leyendo la cláusula de comparación real y los índices del
  esquema (no grepeando `lower`, que matchea comentarios): `descuentos`,
  `recargos`, `turnos` y `cajones` comparaban case-**sensitive**; `causas_merma`,
  `motivo_diferencia_caja`, `motivo_diferencia_inventario` y
  `grupos_modificadores`, case-**insensitive**. Encima los tres primeros no tenían
  índice ninguno: la unicidad vivía solo en el código, con una ventana de carrera
  entre el `SELECT` y el `INSERT` por la que sí podían quedar dos filas vivas con
  el mismo nombre.

  **Decisión del owner: case-insensitive en los ocho** —"Extras" y "extras" son el
  mismo nombre, porque en una lista que alguien elige a ojo dos entradas que solo
  difieren en mayúsculas son un error de tipeo—, **y con índice en los tres que no
  tenían**. Queda en `docs/PRODUCTO.md` como regla de producto, no como detalle de
  esquema.

  Cerrado con: índice único parcial sobre `(tenant_id, lower(nombre))` con
  `WHERE eliminado_el IS NULL` en `descuentos`, `recargos` y `turnos`; el de
  `cajones` pasó de `nombre` pelado a `lower(nombre)`; comparación con `LOWER` en
  los cuatro services; `{ ignorarMayusculas: true }` en las cuatro llamadas al
  helper de sugerencia; y `restaurar()` de los tres que pre-consultaban pasó a la
  forma del `catch` del `23505`, que ahora es la única de las ocho.

  `cajon.entity.ts` perdió su `@Index`: TypeORM no sabe expresar `LOWER()`, así
  que mientras estuvo declarado ahí `synchronize` creaba en dev un índice
  case-sensitive y la base enforzaba otra regla que el código —exactamente el bug
  que se había corregido en `grupos_modificadores` el mismo día—. Lo crea el
  seeder con SQL cruda, con el mismo `DROP` condicional que repara las bases de
  dev viejas (verificado en vivo: índice CS a mano → restart → queda el de
  `lower()`).

  **Lo fija `test/unicidad-nombre.e2e-spec.ts`** (16 tests): forma del índice de
  las 8 tablas —consultado por tabla, no por nombre de índice, que no es la
  regla— y conducta por las dos puertas, crear y restaurar. Mutantes corridos:
  revertir el `LOWER` de `descuentos` deja el crear en **500** (el índice rechaza
  lo que el código aceptó); hacer que el seeder cree el índice sin `lower()` pone
  en rojo la forma **y** la conducta de restaurar. El de índice-shape **no** se
  cae borrando el índice a mano: el propio e2e arranca el seeder, que lo recrea —
  por eso el mutante válido es sobre el seeder, no sobre la base.

  ⚠️ Efecto de borde a saber: en una base que ya tenga nombres que colisionan solo
  por mayúsculas, el `CREATE INDEX` del seeder **falla y el backend no arranca**.
  Se comprobó (lo provocó un mutante) y no se mitiga: no hay datos productivos, el
  seed sembrado no tiene colisiones —verificado antes de tocar nada— y la salida es
  resetear.

- [x] **`recargos` validaba contra dos códigos que no existen.** La lista local
  `tiposConTramos = ['por_mayor', 'por_monto_venta']` de `validarSegunTipoCreate`
  era de códigos de **descuento**: ningún tipo de recargo usa tramos, así que ese
  `if` no podía matchear nunca. Copy-paste entre los módulos gemelos. Borrada la
  lista y su `if`; verificado que `RECARGO_CONFIG` (frontend) no declara
  `campoTramos: true` en ninguno de los 5 tipos, así que la UI nunca los manda.
  **La plomería que persiste tramos en `create()`/`update()` sigue en pie** y
  quedó como entrada propia en `pendientes.md`: sacarla toca persistencia.

---

## Lote de pendientes mecánicos (2026-08-06)

Entradas de tandas anteriores que no necesitaban ninguna decisión de negocio.

- [x] **El e2e daba fallos masivos falsos si se corría después de editar un fuente**
  (harness, `scripts/reset-db.sh`) — la entrada traía la causa como **hipótesis no
  verificada**. Se verificó, y resultó **más amplia** de lo que decía: no es que
  `reset-db.sh` espere el `Seed complete` equivocado, es que **cada cambio de un `.ts`
  vuelve a sembrar**. Medido el 2026-08-06 sobre el stack real: crear un archivo `.ts`
  llevó el contador de `Seed complete` de **1 a 2**, y borrarlo a **3**. La causa es el
  compose: `command: npm run start:dev` con `./backend:/app` bind-mounteado. Un `touch`
  (solo mtime) **no** alcanza — el watcher mira contenido —, lo que explica por qué el
  síntoma parecía intermitente.
  **Dato que reordena el problema:** el e2e **no usa el backend del contenedor**. Levanta
  su propia app en proceso contra la misma BD, así que ese contenedor no le aporta nada a
  la suite — solo puede contaminarla.
  **Cómo se cerró, en dos mitades:** (1) el script espera a que el backend quede
  **quieto** (log sin crecer 6s, con timeout propio de 60s) y recién ahí devuelve el
  control, para que una recompilación en vuelo aterrice antes y no durante la suite;
  re-asserta 1 seed después de esperar. (2) `./scripts/reset-db.sh --verificar`, que se
  corre **después** del e2e y contesta la pregunta que un e2e con fallos raros deja
  abierta: ¿la base se movió abajo de la suite? Sin eso, la respuesta costaba una sesión
  de forense sobre fallos que no eran regresiones.
  ⚠️ **La revisión independiente bloqueó con tres agujeros, los tres medidos, y uno era
  exactamente el que hace que la herramienta sea peor que no tenerla:**
  - **Verde falso ante un contenedor recreado.** `docker logs` es por **instancia**, no
    por nombre: un `--force-recreate` (o un `--build`, o un cambio de `.env`) re-siembra
    sobre el mismo volumen y deja el log en 1 → el comando decía "la corrida es válida"
    justo en el caso que existe para detectar. Se cerró registrando el `docker inspect
    -f '{{.Id}}'` del contenedor en `.git/reset-db.estado` durante el reset y exigiendo
    que coincida al verificar. Medido: con el log en 1 tras recrear, ahora corta en rojo.
  - **El bucle de quietud no tenía timeout.** El compose declara `restart:
    unless-stopped`: un backend en crash-loop escribe log para siempre y el script
    quedaba colgado **en silencio**, en el paso que el checklist manda correr antes de
    cada e2e. Ahora corta a los 60s mostrando las últimas líneas.
  - **Muerte muda con 0 seeds.** `grep -c` sale 1 sin match y `set -e` mataba el script
    sin imprimir nada (contenedor caído, docker ausente, `NODE_ENV=production` donde el
    seeder retorna antes de loguear). Ahora `seeds()` devuelve 0 y hay un diagnóstico.
  - Y un cuarto, chico pero feo: **cualquier flag mal tipeado caía al camino
    destructivo**. `--verify` en vez de `--verificar`, tipeado *después* del e2e para
    peritar, hacía `down -v` y borraba la evidencia. Ahora hay validación de argumentos.

  ⚠️ **Y la segunda vuelta de revisión encontró que el propio arreglo se apagaba solo en
  un worktree.** `ESTADO=".git/reset-db.estado"` asume que `.git` es un directorio, y en
  un **worktree enlazado es un archivo**: escribir ahí falla con "Not a directory" y, al
  ser la última línea del reset, mataba el script **después** de haber hecho todo bien —
  sin registrar el Id y sin imprimir el verde—. El `--verificar` siguiente caía en la rama
  "no hay registro"… que salía **0**. O sea: dentro de un worktree, la detección de
  recreación que motivó el bloqueo anterior quedaba desactivada en silencio. Y este repo
  tiene un worktree vivo, en el directorio que el propio proyecto usa para verificar sin
  `git stash`. Se cerró con `$(git rev-parse --git-common-dir)` —`--git-common-dir` y no
  `--git-dir`, porque el contenedor es uno solo para todos los worktrees y el registro
  tiene que ser compartido—, medido desde el worktree real.
  De la misma vuelta salió el fail-open: **`--verificar` salía 0 cuando admitía no poder
  responder**. Ahora sale **2** con un mensaje que distingue "no sé" de "sí". Es el mismo
  principio que motivó todo el comando: un verde falso es peor que no tenerlo.
  **Todo verificado midiendo cada rama**: verde legítimo (mismo contenedor, 1 seed),
  contaminación por watcher (2 seeds → rojo), contenedor recreado (1 seed pero otro Id →
  rojo), contenedor inexistente (diagnóstico, no terminal vacía), flag mal tipeado (no
  resetea). `CLAUDE.md` documenta la regla —no tocar un `.ts` del backend con el e2e
  corriendo— y el comando.
  ℹ️ **Lo que `--verificar` NO mide**, dicho en el propio script: el estado que acumula la
  suite. Correr el e2e dos veces seguidas deja cajas abiertas y stock agotado, y eso este
  comando no lo ve.

- [x] **`uq_motivo_diferencia_caja_tenant_nombre` se llamaba distinto en el seeder**
  (backend) — verificado antes de tocar: `startup-pos.sql:962` lo declara con ese nombre,
  el seeder lo creaba como `uq_motivo_diferencia_tenant_nombre`, la definición era
  idéntica y en la BD real existía solo el del seeder. Su **gemelo de inventario**
  (`uq_motivo_dif_inv_tenant_nombre`) sí coincidía en los dos lados: este era el único
  desalineado de los dos.
  Se unificó hacia el nombre de `startup-pos.sql`. ⚠️ **El primer intento copió el `DROP` +
  `CREATE` de `seedCajones()` y la revisión mostró que ese patrón no encaja acá:** allá la
  definición vieja era **distinta** (case-sensitive, sin `lower()`) y había que reconstruir
  el índice; acá es idéntica y solo cambia el nombre. `DROP` + `CREATE` son dos sentencias
  en dos transacciones implícitas, o sea una ventana con la tabla **sin unicidad** — y si
  el arranque muere en el medio la deja sin índice, cosa nada hipotética porque el watcher
  reinicia el backend seguido. Quedó como `ALTER INDEX … RENAME`, que es **atómico** y no
  reconstruye nada, dentro de un `DO $$` condicional a los dos nombres.
  **Los tres caminos verificados contra Postgres real:** base fresca → nombre nuevo; base
  vieja (solo el nombre viejo) → renombrado; y el borde de que existan **los dos** → se
  dropea el viejo y queda uno.
  El e2e de unicidad no se rompe porque afirma la **forma** del índice (UNIQUE + tenant_id
  + `lower(`), no su nombre.

- [x] **El guard de reentrancia de `items.vue` ya tiene regresión automatizada**
  (frontend, `items.nuxt.spec.ts`) — ⚠️ **la entrada decía "el proyecto no testea páginas"
  y eso quedó viejo**: `items.nuxt.spec.ts` existe hace rato (614 líneas) y ya tenía dos
  tests de carrera con promesas retenidas. El hueco era solo este guard.
  **Lo que costó pensar fue qué afirmar.** El observable NO es a qué item apunta el modal
  al final: sin el guard, la respuesta tardía del primero igual termina pisando al segundo,
  así que los dos caminos aterrizan en el mismo item y una aserción sobre eso no falsea
  nada. Lo que distingue es **cuántas verificaciones se disparan** — con el guard, una; sin
  él, dos — y que el modal no llegue a abrirse con el item equivocado en el medio.
  Se instrumentó el mock de `useApiFetch` para registrar cada `GET /items/:id/uso` y poder
  retener la respuesta por id. Tres tests: la carrera; **que el guard se libere** al
  terminar (un guard que no se libera deja la pantalla muerta después del primer borrado,
  que sería peor que el bug original); y la **mitad visual** —que el menú de esa fila quede
  deshabilitado mientras verifica—, que la revisión señaló como mutante sobreviviente: sin
  ese feedback el guard se traga los clicks en silencio.
  **Mutantes medidos:** borrar `if (verificandoEliminarId.value) return` mata 1; vaciar el
  `finally` que libera el guard mata 1; borrar `:loading`/`:disabled` mata 1; y un guard
  que igual abriera el modal con el item equivocado también mata 1.
  ⚠️ La revisión encontró además un `if (cerrar)` **inerte** en uno de los tests: el click
  condicional pasaba igual si el botón no existía, así que el test podía degradar en
  silencio a una versión más débil. Ahora se afirma el botón.

---

## El esquema uniformado a `timestamptz` (2026-08-06)

- [x] **El esquema mezclaba `TIMESTAMPTZ` y `TIMESTAMP` sin zona en la misma columna
  lógica** (backend, transversal) — el default de TypeORM cuando el decorador de fecha no
  fija `type`. Medido sobre Postgres real antes de tocar nada: `eliminado_el` 65 sin zona
  contra 22 con zona, y **el mismo split en las otras dos columnas de auditoría** que la
  entrada original no había mirado: `creado_el` 66/22 y `actualizado_el` 64/22. O sea ~195
  columnas partidas por accidente, no 65 — la entrada subestimaba el alcance 3×.
  **Por qué no es cosmético:** comparar una columna de cada tipo sin cast deja que Postgres
  castee la que no tiene zona usando el `TimeZone` de **la sesión que compara**, no el que
  estaba activo al escribir. Verificado con `SET TimeZone` en sesiones separadas: matchea 1
  de 3 combinaciones. Ya le había costado una ronda de revisión a `items.restaurar()`.
  **Cómo se cerró:** codemod de 4 variantes literales sobre las entities (196 offenders
  medidos, 196 explicados) + `refresh_tokens`, que es aparte (abajo). `startup-pos.sql` **no
  se tocó: ya estaba entero en `TIMESTAMPTZ`** — la deriva era de las entities, y el archivo
  además no lo ejecuta nadie (es referencia; la base la construye `synchronize` + seeder).
  Sin migración incremental: sin datos productivos se cambia el esquema y se resetea.
  **Resultado medido después del reset: CERO columnas `timestamp without time zone` en toda
  la base**, no sólo en las tres de auditoría. Por eso el invariante que quedó escrito es el
  fuerte —ninguna columna del esquema sin zona— en vez del acotado a las tres.
  **Dos redes, porque una sola no alcanza:** un invariante unit
  (`common/invariants/timestamptz-columns.invariant.spec.ts`, junto al de ADR-004) que mira
  la **metadata de TypeORM** y no un grep, porque el grep mide el mecanismo (el decorador) y
  la regla es sobre la conducta (el tipo): 5 entities declaran estas columnas con `@Column` a
  secas y un grep de `@DeleteDateColumn` no las ve. Y un e2e (`test/esquema.e2e-spec.ts`)
  contra `information_schema`, que cubre **todas** las columnas y no sólo las que el unit
  reconoce como de auditoría. Revertir una sola entity mata las dos: el unit nombra la clase (`Turno.eliminado_el`), el e2e la tabla.
  **El invariante encontró su propio límite:** `refresh_tokens.expires_at` estaba sin zona,
  no la miraba ninguna red —no es columna de auditoría— y decide si un token sigue vivo. La
  encontró una persona leyendo la tabla de al lado al migrar `created_at`. Es exactamente el
  caso que justifica que el e2e vaya sobre el esquema entero.
  **Invariante 4 (no tocar el sistema JWT):** `refresh_tokens` cae bajo ella, así que se
  paró y se preguntó en vez de decidir. El owner autorizó migrar las dos columnas
  (2026-08-06), con el radio ya medido: `created_at` no lo lee nadie y la comparación de
  expiración vive en JS (`existing.expiresAt < new Date()`), nunca en SQL. Ninguna lógica de
  tokens cambió.
- [x] **El propio fix de `items.service.ts` se dio vuelta con la migración** (cerrado en la
  misma tanda) — lo encontró el barrido, y es lo más caro que salió de todo esto.
  `remove()` escribía `eliminado_el = NOW() AT TIME ZONE 'UTC'` y `restaurar()` leía con el
  mismo cast, **puesto a propósito** porque `items.eliminado_el` era sin zona y
  `receta_extras_permitidos.eliminado_el` con zona. Con las dos columnas ya en `timestamptz`
  ese cast **reintroduce el bug que arreglaba**: convierte la columna a un `timestamp` sin
  zona que Postgres re-castea con el `TimeZone` de sesión. **Medido contra Postgres real:
  con la sesión en `America/Santiago`, el instante guardado quedaba 4 horas corrido.** Hoy
  no explotaba porque la sesión es UTC — justo la coincidencia de la que ese código decía no
  querer depender. Se sacaron los dos casts y se reescribieron los comentarios que
  documentaban el razonamiento viejo. El test de `items.service.spec.ts` que **exigía** el
  cast ahora asevera lo contrario: que no esté.
  **La moraleja, que vale más que el fix:** un cast de zona horaria es una respuesta al TIPO
  de la columna, no una verdad permanente. Si el tipo cambia, el cast se relee, no se
  conserva. Y ningún test lo habría cazado: el mutante correcto era el propio esquema.

---

## Auditoría `turnos` + `salones` + `garzones` (2026-08-06)

Los hallazgos que se cerraron. Los que quedan y lo refutado están en
[`pendientes.md`](pendientes.md).

- [x] ~~**Dos `describe` viejos de `garzones.nuxt.spec.ts` desmontan al final del test, no
  en `afterEach`**~~ (frontend, cerrado 2026-08-11) — *"papelera: eliminar respeta el
  toggle"* y *"papelera: restaurar"* pasaron al patrón que ya usaba el `describe` de
  advertencias: `let montado` + `afterEach`, seis `wrapper.unmount()` menos.

  **La entrada describía el mecanismo bien y el síntoma mal**, y eso cambió cómo se
  verificó. Decía que un test que falla contamina al siguiente; forzar un fallo *después*
  de cerrar el modal no reprodujo nada (1 test rojo, 12 verdes), porque el diálogo ya no
  estaba abierto. Recién forzando el fallo **con el modal abierto** apareció, y no como
  test rojo: una sonda al entrar al test siguiente midió **`dialogos=1`** en
  `document.body`. Con el `afterEach`, la misma sonda mide **`dialogos=0`**.

  Que no pintara rojo es lo peor del caso, no lo mejor: el test siguiente busca su modal
  con `document.body.querySelector('[role="dialog"]')` —el **primero**—, así que agarraba
  el huérfano del test anterior y **pasaba en verde clickeando la pantalla equivocada**.
  La entrada advertía "cualquier mutante sobre este archivo puede dar señal inflada"; la
  medición muestra que también puede dar señal *falsamente verde*, que no se nota nunca.

- [x] ~~**El filtro "Hasta" del historial de sesiones excluía las sesiones del propio
  día**~~ (backend, cerrado 2026-08-07) — `AppDateInput` emite `YYYY-MM-DD`, `s.inicio_el`
  es `timestamptz`, y comparar una contra otra castea la fecha a **medianoche**: "Desde hoy
  / Hasta hoy" no devolvía **ninguna** sesión del día.
  **Por qué la zona del tenant y no un simple `+ 1 día`.** Medido contra Postgres real con
  una sesión que arranca 21:00 hora Chile del 7 de agosto:

  | variante | sesiones |
  |---|---|
  | `<= '2026-08-07'` (el bug) | **0** |
  | `< fecha + 1`, sin zona (el arreglo "mínimo") | **0** |
  | `< fecha + 1` en zona del tenant | **1** |

  El arreglo barato **no cerraba el bug**: medianoche UTC del 8 son las 20:00 del 7 en
  Chile, o sea justo cuando trabaja un restaurante. No es una decisión nueva: el proyecto ya
  la había tomado en `propina-reportes.service.ts`, que castea igual (`$N::date::timestamp
  AT TIME ZONE $Z`). Lo que sí difiere de ese precedente es que allá `hasta` es
  **exclusivo** y acá es **inclusivo del día completo** (`< hasta + 1`), porque un
  `AppDateInput` rotulado "Hasta" promete incluir ese día.
  **La entrada decía "backend + frontend" y el frontend no necesitó nada**: ya mandaba
  `YYYY-MM-DD`, que es exactamente lo que el backend ahora interpreta bien.
  **Efecto lateral asumido:** es la **doceava** copia del JOIN `tenants → provincia → pais`.
  Se duplicó con su filtro `eliminado_el` —la condición que la entrada de ese JOIN pone para
  reabrirse— y esa entrada quedó actualizada con el conteo real.

- [x] ~~**`garzones.actualizar()` no bloqueaba `activo:false` con una sesión abierta, y
  `eliminar()` sí**~~ (backend, cerrado 2026-08-07) — **solo la mitad `activo`**, que era la
  mecánica. Desactivar a alguien en turno lo dejaba sin poder cerrar su sesión ni operar
  (`resolverGarzonPorPin` filtra `activo: true`) y bloqueaba de rebote la desactivación del
  turno. El chequeo que `eliminar()` ya tenía se extrajo a `assertSinSesionAbierta(tenantId,
  id, accion)` y `actualizar()` lo llama cuando `dto.activo === false && garzon.activo`.
  **La condición es esa y no `dto.activo !== undefined`** a propósito: reactivar a un garzón
  y guardar solo el nombre no consultan sesiones. Los tres casos tienen test, y los mutantes
  discriminan entre sí (ensanchar la condición mata el de reactivar; volverla incondicional
  mata además el de "solo el nombre").
  **La mitad de `tipo` sigue abierta** en [`pendientes.md`](pendientes.md): es decisión de
  producto —bloquear o solo advertir— y no se cierra junto con la mecánica.
  **Limitación heredada, no introducida:** entre el `count` y el `save` hay una ventana de
  carrera que el índice parcial de `sesiones_garzon` no cubre. `eliminar()` ya tenía la
  misma; el diff la copia tal cual.

- [x] ~~**Si se borraba el ítem *y* su categoría, la línea desaparecía del ticket de
  cocina**~~ (backend, cerrado 2026-08-07) — el `LEFT JOIN categorias` de `sqlLineasComanda`
  filtraba `eliminado_el IS NULL`, así que `impresora_id` quedaba `NULL` y
  `agruparEstacionesComanda` hacía `continue` **en silencio**: lo ya pedido no llegaba a
  cocina. Se quitó ese filtro, con el mismo argumento que ya tenía el JOIN de `items`:
  **lo que el cliente pidió se cocina aunque el catálogo lo haya borrado después.**
  **Por qué es seguro:** `c` se usa exclusivamente para `c.impresora_id`, y el JOIN es contra
  la PK, o sea a lo sumo una fila — no puede duplicar ni partir líneas. El filtro del JOIN de
  `impresoras` **sí se conserva**: una impresora dada de baja no es un destino válido.
  Efecto colateral asumido y correcto: esas líneas ahora también avanzan su `cantidad_enviada`.
  Sigue sin cubrirse a nivel de dato por el hueco de fixture del seed que
  [`pendientes.md`](pendientes.md) ya tiene anotado; el test afirma sobre el SQL.

- [x] ~~**"Nueva cuenta" no tenía guard de reentrancia, y sus tres hermanos sí**~~
  (frontend, cerrado 2026-08-07) — `nuevaCuenta`/`abrirCuentaConPin` no usaban el ref "en
  curso" + `:loading` que ya usaban `fusionarSeleccionadas`, `transferirCuentaConPin` y
  `cerrarCuentaConPin`. El modal de PIN cierra apenas emite `confirm`, antes de que resuelva
  el POST, así que quedaba una ventana con la UI interactuable y la petición en vuelo: doble
  tap o lag de red creaban dos cuentas en la mesa. El backend no puede defenderlo —varias
  cuentas abiertas por mesa es intencional—, así que el guard va sí o sí en el cliente.
  `abriendoCuenta.value = true` se setea **antes del primer `await`** y lo chequean los dos
  puntos de entrada.
  **Con regresión automatizada**, que es lo que faltaba: `pages/salones/index.nuxt.spec.ts`
  —el primer spec de esta página— ejercita dos rondas completas de PIN con el POST retenido.
  Dos mutantes medidos, y **cada uno mata exactamente un test**, que es lo que prueba que
  ninguno de los dos es relleno: revertir el guard entero al código anterior hace fallar
  solo el del doble submit, con **2 POST en vez de 1** (las dos cuentas del bug); sacar
  únicamente el `finally` hace fallar solo el que verifica que el flag se libera. Ninguno
  muere por `TypeError`.
  Esa separación limpia costó una corrección: con el `unmount()` al final de cada `it`, el
  primer mutante arrastraba también al segundo test —cascada, no señal: el test que falla
  no llega a desmontar y deja su diálogo teletransportado vivo en el `document.body`
  compartido—. Con el desmontaje en un `afterEach`, que corre pase o falle, desaparece. Ni `vue-tsc` ni `design:check` ven reentrancia, así que sin ese
  test el cambio se apoyaba solo en lectura de código.
  **Del harness, lo único que quedó verificado:** `AppDrawer` y `UModal` teletransportan su
  contenido fuera del wrapper, así que la búsqueda va sobre `document.body` y **acotada a su
  diálogo** — con dos diálogos vivos a la vez, buscar por texto en todo el body puede tomar
  el botón equivocado y el test pasa igual. Es la misma trampa que ya documentaba el spec de
  `configuracion/garzones`, no una nueva.
  ⚠️ **Acá había una regla más ancha que decía que un `HTMLElement.click()` sobre un nodo
  teletransportado no dispara el handler de Vue. Es falsa** — medido: dispara, y el spec
  hermano ya lo venía haciendo. Salió de una observación con dos variables cambiadas a la
  vez y se generalizó sin medir. Queda anotada porque el error no fue de código sino de
  método, y este archivo es el de lo medido.

- [x] ~~**Al fusionar dos líneas del mismo ítem se suma `cantidad` pero no
  `cantidadPresentacion`** (backend, `salones.service.ts`, ramas `match` de `agregarLinea`
  y `existente` de `fusionarCuentas`) — agregar 200 g y después 300 g del mismo ítem deja
  `cantidad = 0.5` (correcto, y el motor cobra sobre eso) pero `cantidadPresentacion`
  sigue en "200 g". El ticket y la pantalla muestran 200 g de algo que se cobra como 500 g:
  el monto es correcto, lo que miente es lo que ve el cliente.~~
  **Cerrado el 2026-08-07.** La regla NO se inventó acá: ya estaba escrita en el spec de
  diseño de presentación (2026-07-16) — *"sumar en canónica y **reescribir** presentación en
  la unidad actualmente visible de esa línea"*. Se implementó eso: la presentación se
  reescribe, nunca se suma, porque la línea puede mostrar `g` y lo que entra venir en `kg`.
  **El frontend ya lo hacía bien**: `desdeCantidadCanonica` (`app/utils/cantidad-presentacion.ts`)
  reescribe al incrementar desde siempre. El desalineado era el backend, que no tenía la
  función inversa. Ahora existe (`presentacionDesdeCanonica`) y las dos se referencian
  mutuamente en sus docblocks, como ya hacía `resolverUnidadBaseDeItem` con su gemela.
  **Difieren a propósito en el fracaso:** el frontend lanza (carrito local, error visible al
  instante); el backend devuelve `null` y deja la presentación como estaba. La razón es **de
  UX, no de integridad**: esto corre dentro de una transacción, así que lanzar haría rollback
  limpio y no dejaría nada a medio escribir. Lo que se evita es que una unidad fuera de
  catálogo o un cruce de magnitudes —estados en los que esa fila ya estaba mal— impidan
  agregar una línea o fusionar una mesa. El precio, asumido: **el fallo es mudo**, queda una
  presentación vieja, que es el bug de esta misma entrada en miniatura.
  (La primera versión de este párrafo decía que abortar "dejaría la venta sin cerrar". Era
  falso —hay transacción— y lo corrigió la revisión.)
  **El N+1 que la fusión invitaba, evitado y con test:** `fusionarCuentas` no tenía los
  ítems a mano, y resolverlos por línea habría sido una query por línea **sosteniendo el
  lock pesimista de la fusión**. Se resuelven en bloque antes del bucle, y solo si alguna
  línea muestra presentación. Mutantes medidos: sacar la reescritura hace que los tests
  fallen mostrando `"200"` —el síntoma literal de la entrada— en las dos puertas; y
  **reemplazar** el batch por una query por línea hace fallar la aserción de "una sola
  query" con 2.
  ⚠️ Dos correcciones de la revisión, las dos por errores de método ya conocidos acá:
  el primer mutante del N+1 **agregaba** una query en vez de revertir al N+1, y el fixture
  tenía **un solo ítem** mergeando —con uno, una query por línea también da 1 y la aserción
  no distingue nada—. El fixture tiene ahora dos ítems distintos.
  Y el `SELECT` que resuelve los ítems **no ejecutaba**: filtraba `eliminado_el` en
  `item_producto`, que no tiene esa columna. Habría roto la fusión entera con un 500
  sosteniendo el lock, en cuanto una línea tuviera presentación. No lo vio el gate porque
  el test mockea `manager.query` y **no hay ningún e2e de `fusionarCuentas`** (anotado en
  `pendientes.md`). Verificado contra la BD viva antes y después del arreglo.
  Nota sobre el texto tachado: dice `cantidad = 0.5`, pero la canónica va en la unidad base
  del ítem (`g`), o sea **500**. Se conserva verbatim y se corrige acá.

- [x] ~~**`grupos-modificadores` convive con un segundo índice único y la red nueva no los
  distingue** (backend, `grupos-modificadores.service.ts`) — `traducirColisionDeNombre`
  revalida **solo el nombre**, pero `uq_grupo_opcion_item_vivo` puede disparar en la misma
  transacción de `create`/`update`. En una doble carrera (uno toma el nombre, otro inserta
  una opción con el mismo `item_id`) el error diría "Ya existe un grupo con el nombre…",
  mandando a renombrar algo que no es la causa. Nunca es peor que el 500 previo, pero el
  propio archivo ya discrimina por `constraint` en `restaurar()`, y `caja.service.ts`
  también: la red nueva introdujo un patrón distinto justo donde había uno.~~
  **Cerrado el 2026-08-07.** El fix es exactamente ese punto: replicar la discriminación por
  `constraint` que `restaurar()` ya hacía, en vez de dejar dos patrones distintos en el
  mismo archivo.
  **Matiz sobre la entrada, razonando sobre el código (no medido con dos clientes reales):**
  la doble carrera que describe necesita **tres** transacciones —una toma el nombre, otra
  inserta la opción, la nuestra pierde contra las dos—, mientras que con el nombre libre
  alcanzan **dos**: ahí `revalidar` no lanzaba y el 23505 se relanzaba tal cual, o sea un
  **500**. El fix cubre los dos caminos; cuál ocurre más seguido en producción no lo sé.
  **Dónde va la distinción, medido y no asumido:** solo en `update()`. Ahí las opciones
  vivas se leen **sin lock** y después se insertan, así que dos updates que agregan el mismo
  item al mismo grupo pasan los dos por el `INSERT`. En `create()` es **inalcanzable**: el
  grupo recién nace y nadie más puede tener una opción bajo ese `grupo_modificador_id`; un
  duplicado dentro del mismo request lo corta antes la validación del service. Ponerlo
  también ahí habría sido código muerto con cara de red.
  `traducirColisionDeNombre` ganó un `soloConstraint` opcional; los otros 7 recursos no lo
  pasan y **su conducta no cambia**, con test propio que lo fija. Mutante medido: quitar la
  distinción hace que el test del service falle mostrando el mensaje real del bug —
  `"Ya existe un grupo con el nombre \"Bebida\""`— en vez del de la opción.

- [x] ~~**Seis mecánicas de contrato y concurrencia**~~ (backend, cerradas 2026-08-07).
  Ninguna necesitaba decisión: se agruparon por eso.
  - **El signo de propina se validaba en uno de tres.** `propinaMonto` cortaba con 400 pero
    `propinaSugerida` y `propinaPorcentajeSugerido` solo tenían `@IsNumberString()`, que
    acepta el menos. No cobran de más —`targetCobro` usa solo el primero— pero se
    persistían en `venta_propina`. Ahora los tres pasan por el mismo chequeo.
  - **`@MaxLength(100)` en `Create`/`UpdateGarzonDto`.** La columna es `VARCHAR(100)` y el
    gemelo `CreateTurnoDto` ya lo tenía: sin él, un nombre largo moría en Postgres con un
    500 en vez de un 400 accionable.
    El `:maxlength="100"` del input **también se puso**. La primera versión de este cierre
    lo omitía argumentando que "ningún input de `configuracion/` lo usa": literal cierto,
    pero la conclusión iba más lejos que el hecho — el repo **sí** tiene el patrón
    (`components/ventas/ItemPersonalizacionDrawer.vue:460`), así que ponerlo es seguirlo,
    no inventarlo. Y la entrada decía "backend + frontend": cerrar solo la mitad y borrar
    el checkbox entero es cómo un pendiente se evapora.
  - **`reclamarComanda` pedía una segunda conexión del pool** con el `FOR UPDATE` tomado.
    Una palabra: pasarle el `manager`. `previewComanda` no está en transacción, así que ahí
    la conexión global sigue siendo inofensiva.
  - **`crear`/`actualizar` de salón y mesa devolvían la entity cruda**, con `tenantId`,
    timestamps y `eliminadoPor`. Ahora tienen `toSalonPublico`/`toMesaPublica`, siguiendo lo
    que `garzones` y `turnos` ya hacían.
    ⚠️ **La entrada decía que "el frontend no lo consume" y es falso**: sí lo consume
    (`configuracion/salones.vue` lee `saved.id`, `saved.nombre` y, en mesa, `posX`, `posY`,
    `forma`, `tamano`). Los campos de la vista curada son exactamente esos, medidos antes de
    tocar; ninguno de los que se sacaron se leía.
  - **`ids.sort()` antes del lock de `fusionarCuentas`.** Seguro barato: **no cierra ningún
    deadlock demostrado** —un solo `SELECT … FOR UPDATE` lockea en orden de plan, igual para
    las dos transacciones— y por eso **no tiene mutante**: no hay conducta observable que
    fijar. Se hizo porque cuesta una línea y saca la pregunta del medio.
  - **El docblock de `traducirColisionDeNombre`** ahora advierte que meter un `await` entre
    `const escritura = …` y el wrapper deja la promesa rechazada sin handler, y Node ≥15
    **mata el proceso**. Es prosa: tampoco tiene mutante.

  **Cuatro mutantes medidos** (los que tienen conducta observable): el signo validado solo
  en `propinaMonto`, `reclamarComanda` por la conexión global, `crearMesa` devolviendo la
  entity cruda, y `CreateGarzonDto` sin `@MaxLength`.
  **Los cuatro mueren por la aserción que el test enuncia, no por un `TypeError`.** No era
  así al principio: los dos primeros morían en un `.map`/`.length` de `undefined` porque el
  mock no devolvía nada, o sea mataban por accidente. El primer arreglo fue poner defaults
  resueltos en el harness, y la revisión midió su **precio**: con `manager.query → []`, el
  mutante que borra `getMesaOrThrow` de `abrirCuenta` pasó de **cazado a sobreviviente**,
  porque el `if (!locked.length) throw` de más abajo tira la misma excepción. Los defaults
  se movieron a los dos tests que los necesitan: los mutantes siguen muriendo por su
  aserción y el de `getMesaOrThrow` vuelve a caer. Quedó en
  [`anti-patterns.md`](anti-patterns.md).

- [x] ~~**Cinco huecos de cobertura del barrido de la auditoría**~~ (backend, cerrados
  2026-08-07). Solo tests: **ningún archivo de producción se tocó**. Los siete mutantes que
  las entradas anotaban pasaban de verdad —los medí antes de escribir una línea— y ahora
  mueren:
  - **`guardarLayout`** no tenía ningún test. Sin el `if (!res.affected) throw`, mover por
    drag&drop una mesa de otro salón actualiza cero filas y la pantalla responde OK.
  - **`GarzonesService.actualizar`** tampoco. Es el único método que mueve `tipo`, que se
    congela en cada sesión y decide el grupo de reparto de propinas.
  - **`buildHistorialFilters`** nunca corría con un filtro puesto: los dos tests llamaban
    con `{}`. Los placeholders arrancan en `$2` porque `$1` es el tenant; con `paramIdx = 1`
    el filtro pisa al tenant y nada explota. Es la misma función donde vive el bug abierto
    del filtro "Hasta".
  - **`activaPorPin`** no se invocaba nunca. Se cubrió además que un PIN inválido **propaga
    el rechazo** en vez de devolver `null`: `null` significa "sin turno abierto", y
    confundirlos hace que la UI ofrezca iniciar turno cuando el PIN está mal.
  - **La personalización de línea** se verificaba con `toHaveBeenCalled()` **sin
    argumentos**, y el mock devuelve un snapshot fijo sin mirarlos: mandar `{}` en vez de lo
    que pidió el mesero pasaba la suite entera. Ahora se afirma con los argumentos.
  - **Tres filtros más** de la entrada de las revisiones: el tenant en el JOIN a `items` del
    detalle, el tenant en la query de ítems eliminados de `cerrarCuenta`, y que
    `loadCatalogoUnidades()` se cargue **fuera** de la transacción (adentro pide una segunda
    conexión del pool con el `FOR UPDATE` tomado).

  **Un matiz que la entrada no distinguía:** hay dos JOIN gemelos a `items` con el mismo
  filtro de tenant. El de la comanda **sí** estaba cubierto; solo el del detalle no. Medido
  mutando cada uno por separado.
  **Los tests sobre SQL van acotados a la cláusula**, no con un `toContain('tenant_id')`
  suelto — ese matchearía el `cl.tenant_id` del `WHERE` y pasaría sin el filtro del JOIN.
  **Un octavo hueco, que ninguna entrada anotaba**, lo encontró la revisión: un test decía
  "lanza NotFound si el garzón no existe **en el tenant**" y solo mockeaba `findOne → null`,
  sin afirmar el `where`. El aislamiento por tenant de `GarzonesService.getOrThrow` —lo que
  decide si se puede editar el garzón de otra empresa— no tenía red. Mutante: `where: { id }`.
  Es la misma clase de defecto que el `toHaveBeenCalled()` pelado: **un título que promete
  más que su aserción**.

- [x] ~~**Los dos N+1 de `salones.service.ts`**~~ (backend, cerrados 2026-08-07 juntos, por
  ser el mismo defecto en el mismo servicio).
  **`listarCuentasDeMesa` — 1 + 3N.** `armarDetalle` disparaba tres consultas y se llamaba
  una vez por cuenta. Ahora existe `armarDetalles(cuentas[])`, que hace las mismas tres para
  N cuentas: las dos auxiliares ya eran batch (`= ANY($1)`), solo faltaba llamarlas una vez
  con las líneas de todas juntas. `armarDetalle` quedó como el caso de una. Es el endpoint
  que el garzón golpea cada vez que abre una mesa.
  **`fusionarCuentas` — M×L, dentro del lock.** Por cada línea de cada origen se consultaba
  el destino. Lo caro no era la latencia sino que corría **sosteniendo el
  `pessimistic_write` sobre todas las cuentas de la mesa**: cada query de más alargaba el
  tiempo en que nadie podía agregar líneas ni cerrar ahí. Ahora son dos lecturas fuera del
  bucle, con el índice del destino **mantenido al día** — la línea que se mueve tiene que
  poder recibir la suma de una igual que venga de un origen posterior; armar el mapa una
  vez y no actualizarlo duplica en vez de acumular.
  **Medido antes de tocar, no estimado:** con 2 orígenes de 1 línea, 4 lecturas de
  `cuenta_lineas`; con 2 orígenes de 10 líneas, **22**. Después: constante en las dos
  dimensiones.
  **Cinco mutantes**, cada uno verificado como aplicado: volver a la tanda por cuenta,
  romper el agrupado por `cuenta_id`, releer las líneas de origen en el bucle, reconsultar
  el destino por línea, y no mantener el índice al día.
  **Un error propio que el mutante encontró:** el primer test medía el costo variando solo
  las líneas, y el mutante "leer las líneas de origen dentro del bucle" **sobrevivía** — el
  N+1 tenía dos dimensiones y el test cubría una. Quedó en
  [`anti-patterns.md`](anti-patterns.md).
  **Una línea que se sacó a conciencia:** preservar "la primera gana" cuando el destino
  trae dos líneas con la misma clave. Ningún mutante la mataba, el estado no lo produce
  `agregarLinea` (mergea), y sumar sobre cualquiera de las dos da el mismo total de cuenta.

- [x] **Fin de turno con mesas abiertas: avisar y ofrecer transferir** (backend +
  frontend, decidido y cerrado el 2026-08-06) — cobrar una cuenta exige que su
  **responsable** tenga sesión abierta, porque la propina se atribuye a esa sesión. Ni
  `cerrarPorPin` ni `cerrarAdmin` miraban si el garzón dejaba cuentas abiertas, así que
  el que marcaba salida con una mesa abierta la dejaba imposible de cobrar hasta que
  alguien la transfiriera. **No hace falta ninguna carrera: es el martes normal de un
  restaurante.** (La lente lo reportó como una carrera entre `assertSesionAbierta` y la
  transacción de `abrirCuenta`; agrandarlo al caso sin carrera fue del refutador.)
  **Forma elegida por el owner:** el cierre **no** se bloquea —el garzón se va igual, y
  bloquearlo solo dejaría la sesión abierta contando horas—; los dos cierres devuelven
  `cuentasPendientes[]` y la UI ofrece transferirlas a alguien en turno. Aceptar es
  opcional: "cuenta sin responsable en turno" es un estado válido y reversible.
  **Cómo se cerró:** `SesionCerrada = SesionPublica + cuentasPendientes`, resuelto con
  **una** query (`LEFT JOIN` a `mesas`/`salones`: una cuenta abierta sobre una mesa
  borrada es la que más urge no perder de vista) que corre en paralelo con `cargarNombres`.
  Va por SQL crudo dentro de `turnos` y no delegada a `SalonesService` porque la
  dependencia entre módulos corre al revés. En el frontend, dos modales gemelos —PIN en
  Salones, select de garzones **en turno** en el backoffice— sobre el composable
  `useTransferenciaPendientes`, que transfiere cuenta por cuenta y **corta en el primer
  error**: los errores de este flujo son del destinatario, no de una cuenta puntual, y
  seguir solo repetiría el mismo mensaje N veces.
  **Lo que salió de paso, y no era cosmético:** al declinar la oferta, cobrar esa mesa
  daba *"El garzón no tiene una sesión de trabajo abierta"* — y Salones usa esa frase
  como señal para abrir el modal de entrar a turno, así que mandaba al **cajero** (que sí
  estaba en turno) a iniciar un turno que ya tenía, y el reintento fallaba igual: un
  callejón sin salida. Ahora `cerrarCuenta` usa `buscarSesionAbierta` (devuelve `null` en
  vez de tirar) y lanza su propio mensaje, que nombra al responsable y dice qué hacer.
  **Lo que fija cada cosa:** el mutante que revierte el mensaje al genérico rompe el test
  —que asevera las dos mitades: que dice "ya no está en turno" y que **no** dice "sesión
  de trabajo"—; sacar `AND c.garzon_responsable_id = $2`, cambiar `LEFT JOIN` por `JOIN` y
  sacar el `eliminado_el IS NULL` de un join matan un test cada uno. En el frontend, sobre
  la pantalla del backoffice: no abrir el modal mata 4. Sobre el composable: no chequear la
  identidad del lote, abrir siempre en `reabrirSiQuedan` y sacar el guard de reentrancia
  matan uno cada uno.
  **Un mutante también delató el propio spec:** dos tests fallaban de más porque los
  modales se teletransportan al `body` y los toasts viven fuera del wrapper, así que
  `dialogo()` podía devolver el modal del test anterior. Se limpia el `body` en cada
  `beforeEach` — sin eso, un verde puede no estar probando nada.
  **La revisión independiente encontró dos defectos de runtime que ningún test veía**, y
  los dos eran del gemelo de Salones, el único sin spec: cancelar el teclado de PIN dejaba
  las cuentas vivas en memoria con la oferta **imposible de reabrir** (un toque accidental
  y el garzón se iba con las mesas a su nombre), y `pendientes.value = restantes` en el
  `finally` podía pisar una oferta más nueva —con el modal cerrado durante el vuelo, la
  pantalla queda operable y se puede cerrar otra sesión— dejando el nombre de un garzón
  con la lista de otro. El arreglo de los dos fue **extraer el bucle al composable**: no
  por deduplicar (dos copias son aceptables acá) sino porque dentro de una pantalla de
  1.400 líneas con cinco stores no había forma de probarlos. `GarzonPinModal` solo avisa
  cuando el PIN es válido, así que el `solicitarPin` de Salones ganó un hook de cancelación
  —un `watch` sobre el cierre del modal, que en el camino feliz ya no encuentra hook porque
  el componente emite `confirm` antes de cerrarse.
  **El camino por PIN se verificó en el navegador** (no tiene spec de página): el modal
  aparece con la cuenta bien etiquetada; transferir a alguien fuera de turno deja el toast
  del backend, reabre la oferta y —esto es lo que se estaba arreglando— **no** abre el modal
  de entrar a turno; y transferir a alguien en turno deja la cuenta a su nombre.
- [x] **El gate del frontend era cara o cruz bajo carga** (cerrado 2026-08-06, salió al
  agregar el spec de arriba) — montar un entorno Nuxt entero pasa de ~300ms a varios
  segundos cuando la máquina está ocupada, y los dos timeouts default de vitest quedaban
  cortos. Se manifestaba de dos formas distintas, y **la primera es la peligrosa**:
  - **`beforeAll` (default 10s)**: al expirar, vitest reporta los tests de ese archivo como
    *skipped*. La corrida sale roja (`Test Files 4 failed`, exit ≠ 0), pero **el contador
    miente**: `566 passed | 25 skipped` con **0 failed**. Cuatro archivos evaporados sin un
    solo test en rojo. Tres de los cuatro eran preexistentes (`useImpresoras`,
    `usePermisosCrud`, `middleware/permiso`).
  - **`testTimeout` (default 5s)**: `mountSuspended` de una página no alcanza a resolver.
    Medido con el compose arriba: 15 tests de 11 archivos en `Test timed out in 5000ms`,
    todos de pantallas que el diff no tocaba, y verdes al correr la suite sola.

  `hookTimeout: 60_000` + `testTimeout: 20_000`. Tres corridas seguidas 591/591 bajo la
  misma carga que antes las volteaba. **Por qué se arregló acá y no se anotó al backlog:**
  un gate que depende de cuán ocupada está la máquina no sirve para decidir si una tarea
  está terminada, que es exactamente para lo que se lo corre.

- [x] **Una línea agregada durante el cierre no se cobraba ni llegaba a cocina**
  (backend, `salones.service.ts`) — **severidad alta, y la vieron dos lentes
  independientes** (dinero/Decimal y concurrencia) por separado, con intercalados
  distintos. `agregarLinea`, `actualizarLinea` y `quitarLinea` validaban el estado de la
  cuenta con un `SELECT` plano y escribían **fuera de toda transacción**. Un `SELECT` sin
  lock no espera al `FOR UPDATE` de `cerrarCuenta`, así que veían la cuenta como abierta
  durante **todo** el cierre —que incluye armar la venta entera, la operación más lenta
  del sistema— y la línea se colaba en una cuenta que quedaba cerrada un instante después.
  Esa línea **no se cobraba** (la venta ya estaba armada sin ella) **y tampoco llegaba a
  cocina**, porque `previewComanda` y `reclamarComanda` exigen `abierta`: quedaba invisible
  para todos.
  **Cómo se cerró:** las tres leen la cuenta con `pessimistic_write` y escriben en la
  misma transacción. `getCuentaAbiertaOrThrow` (sin lock) tenía exactamente esos 3
  llamadores, así que se convirtió en `getCuentaAbiertaConLock` en vez de dejar el viejo
  como código muerto. El catálogo de unidades y la personalización se resuelven **fuera**
  del lock; lo que sí necesita leerse adentro va con el manager de la transacción.
  **Mutantes medidos:** quitar el `lock` mata 3 tests; quitar el `, manager` de
  `armarDetalle` mata 2; quitar `syncPresentacionLegado: true` mata 1; revertir el service
  a `HEAD` mata 7.
  **Cerró de paso dos huecos de test:** `actualizarLinea` y `quitarLinea` no tenían **un
  solo test** —lo encontró la lente de tests con su mutante— y son justo los dos métodos
  donde vive este bug.
  ⚠️ **La revisión independiente bloqueó dos veces, y las dos tenía razón.** Primero: el
  fix **introdujo** un double checkout de conexión —tres lecturas salían por
  `this.dataSource` desde dentro de los callbacks, o sea pidiendo una segunda conexión del
  pool con el `FOR UPDATE` tomado—. Antes no existía porque no había transacción. Se cerró
  pasando el `runner`, y de yapa le sacó el mismo problema a `cancelarCuenta`,
  `fusionarCuentas` y `cerrarCuenta`, que ya pasaban el manager a `armarDetalle`.
  Segundo: un mutante sobreviviente medido —quitar `manager` de `armarDetalle` en dos de
  las tres mutadoras dejaba **65/65 en verde**— porque los tests nuevos no afirmaban nada
  sobre el detalle devuelto y el mock decidía el resultado.
  ⚠️ **Y el propio ciclo de revisión produjo un autogol:** al pedir que el 404 afirmara el
  mensaje, cambié `toThrow(NotFoundException)` por `toThrow(/regex/)` — y `toThrow(regex)`
  **no verifica la clase**, así que dejé de comprobar que el 404 siguiera siendo 404. Lo
  detectó el mismo revisor en la segunda vuelta y lo marcó como "lo introdujo el cambio
  que yo pedí". Ahora los dos afirman clase **y** mensaje.
  Commit `f504c194`.

- [x] **Borrar un ítem del catálogo dejaba la mesa imposible de cobrar, con la línea
  invisible** (backend + frontend, `salones` + `items`) — **severidad alta.**
  `armarDetalle` filtraba `i.eliminado_el IS NULL` en su JOIN, así que la línea
  **desaparecía de la pantalla**; pero `cerrarCuenta` lee las `cuenta_lineas` crudas y se
  las mandaba a `crearEnTransaccion`, que explotaba con "Item no encontrado". El garzón no
  podía cobrar **ni corregir**, porque no tenía el `lineaId` de algo que no se renderizaba.
  Nada impedía el borrado: `obtenerUsoItem` miraba `receta_ingredientes`,
  `combo_componentes`, `grupo_modificador_opciones` y `receta_extras_permitidos` — **nunca
  `cuenta_lineas`**.
  **Las dos mitades, decididas por el owner:** (1) `obtenerUsoItem` suma una rama
  `'cuenta'` que bloquea el borrado y va **primero** en el mensaje, porque los otros cuatro
  usos son de catálogo y el admin los resuelve cuando quiera, pero una cuenta abierta tiene
  a alguien esperando en la mesa; acota por `estado = 'abierta'` —sin eso una cuenta ya
  cerrada volvería el ítem inborrable para siempre— y por el borrado de la línea, la cuenta
  y la mesa. (2) El detalle muestra la línea marcada (`itemEliminado`) y `cerrarCuenta`
  corta con un 400 que **nombra** el ítem.
  **En el frontend**, una cuenta así no se puede cotizar (el motor resuelve contra el
  catálogo vivo y devuelve 404): el total muestra `—` en vez de un `$0` falso, un aviso lo
  explica, y cobrar e imprimir precuenta quedan deshabilitados. ⚠️ Las líneas **no** se
  filtran de la entrada del cálculo a propósito: `AdvertenciasPrecio` indexa
  `resultado.lineas[i]` contra las líneas de la pantalla, así que filtrar la entrada las
  desfasa — que es justo el desfase que ya está anotado en `pendientes.md`. El primer
  intento de fix fue ese y se descartó por eso.
  **Índice `idx_cuenta_lineas_item`:** la rama nueva corre en cada `DELETE /items/:id` y en
  cada `GET /items/:id/uso` —que el frontend dispara antes de abrir el modal— sobre una
  tabla que crece con cada producto pedido en la historia del tenant. Postgres no indexa
  las FK por su cuenta.
  ⚠️ **El test unitario de la rama nueva no probaba lo que decía.** Un `toMatch` sobre un
  string de SQL mide **presencia de un literal, no semántica**, y la revisión midió dos
  mutantes que sobrevivían: sacar `cl.item_id = $1` —que vuelve inborrable **todo** el
  catálogo del tenant— y `estado = 'abierta' OR TRUE`. Se cerró con un **e2e** que monta
  sesión de garzón + cuenta + línea contra Postgres real (`recetas.e2e-spec.ts`, test 12)
  y mata los dos, medido con `reset-db.sh` antes de cada corrida. Ese e2e empieza a cerrar
  el hueco de "no existe ningún e2e de salones".
  ⚠️ **Alcance real del e2e, dicho en su propio comentario:** usa **cancelada** como proxy
  de "ya no está abierta". El caso que la doc describe es la cuenta **cerrada**, que exige
  caja abierta + pagos. Un mutante quirúrgico `OR c.estado = 'cerrada'` sobrevive.
  Commit `853c16b3`.

- [x] **La comanda seguía escondiendo el ítem borrado: el fix anterior estaba a medias**
  (backend, `salones.service.ts` → `sqlLineasComanda`) — **lo encontró la revisión
  independiente, ninguna lente lo vio**, y es el hallazgo más valioso de la pasada porque
  demuestra que el fix de arriba **movía el bug de lugar en vez de matarlo**:
  `armarDetalle` dejó de filtrar pero `sqlLineasComanda` —que alimenta `previewComanda` y
  `reclamarComanda`— seguía con su `INNER JOIN` filtrado. La línea dejaba de ser invisible
  en la pantalla y pasaba a serlo **en el ticket de cocina**: "Enviar a cocina" respondía
  OK, `cantidad_enviada` no avanzaba nunca, y el plato no se cocinaba.
  **La regla, ahora escrita en `docs/features/salones-mesas.md`: un plato ya pedido hay
  que cocinarlo**, lo haya sacado o no el admin de la carta mientras tanto.
  **Mutante medido:** volver a poner el filtro mata 1 test. Y un segundo mutante que la
  revisión midió sobreviviendo —inyectar el filtro **solo** en el string concatenado de
  `reclamarComanda`, que es el que realmente reclama y avanza `cantidad_enviada`— se cerró
  con una aserción propia en el test de ese método.
  ⚠️ **El smoke en navegador destapó algo que ningún test podía:** **ningún ítem del seed
  tiene una categoría con impresora activa**, así que `agruparEstacionesComanda` devuelve
  siempre `[]` y hubo que cablear una a mano por SQL para poder verificar. Queda anotado
  como hueco en `pendientes.md`.
  Commit `853c16b3`.

### Lección de método que dejó esta pasada

**Una medición de mutante puede dar señal falsa.** La primera vez que medí los mutantes del
e2e obtuve "1 failed" con la mutación **no aplicada**: el `perl -pe` no matcheaba a través
de saltos de línea, y lo que fallaba era un test que depende del stock acumulado del seed
en corridas locales repetidas. Estuve a un paso de contar ruido como señal. Desde entonces,
cada medición va con `reset-db.sh` antes y con `-t` acotado al test, y se verifica que la
mutación se aplicó (contando ocurrencias) antes de leer el resultado.

---

## Colisión de nombre en `create()`/`update()` — ya no es un 500 (2026-08-06)

- [x] **`create()`/`update()` de los 8 con nombre único devolvían 500 si perdían
  la carrera** (backend, transversal) — los 8 pre-consultan el nombre y después
  escriben; entre esas dos sentencias otra transacción puede tomarlo, y ahí el
  índice único rechazaba con `23505` que nadie traducía. El índice hacía su trabajo
  —**nunca quedan dos filas vivas con el mismo nombre**— pero quien perdía la
  carrera veía un 500 en vez del 409/400 amable. `restaurar()` ya lo traducía en
  los 8; esto es la misma red para las otras dos puertas.
  **Verificado antes de tocar nada:** los 14 services que mencionan `23505` lo
  traducen **solo** dentro de `restaurar()`. La entrada era exacta.
  **Cómo se cerró:** `traducirColisionDeNombre` en
  `common/utils/nombre-sugerido.util.ts` (16 sitios: la convención dice extraer a
  la tercera), aplicado a create+update de los 8. Dos decisiones que no son
  obvias:
  - **Toma la escritura ya en vuelo, no un thunk.** Con thunk había que
    re-indentar el cuerpo de cada transacción y el diff eran 16 reformateos que
    esconden el cambio real. No hay ventana de unhandled rejection porque el
    wrapper es la sentencia inmediatamente siguiente; si alguien mete un `await`
    en el medio, sí la habría.
  - **En el `catch` re-corre la validación que el módulo ya tiene**, en vez de
    inventar un mensaje. Así el error es exactamente el que el usuario habría
    visto sin la carrera —y cada módulo conserva su propio código: `turnos` tira
    409 y los demás 400—. Si al revalidar el nombre está **libre** (el competidor
    abortó, o el `23505` vino de otro índice único) se relanza el original en vez
    de mandar a renombrar algo que no es la causa.
  **Los 8 resultaron tener tres formas de escribir**, no una: transacción
  (`descuentos`, `recargos`, `grupos-modificadores`, `motivos-diferencia-inventario`
  en update), `repo.save()` (`turnos`, `cajones`) y SQL crudo con `RETURNING`
  (`causas-merma`, `motivos-diferencia`, y el create de `motivos-diferencia-inventario`).
  **Cobertura, decidida explícitamente:** la semántica del helper vive en
  `nombre-sugerido.util.spec.ts` (qué se traduce y qué no), y el **cableado** se
  fija con **una forma por test, no un test por módulo** — `descuentos`
  (transacción), `turnos` (`repo.save`), `causas-merma` (SQL crudo). Las otras 5
  puertas quedan verificadas por revisión, no por test: replicarlas sería 10 tests
  de plomería que vuelven a probar el mismo helper.
  **Mutantes medidos:** borrar el guard `code !== '23505'` mata 3; sacar la red de
  un `update` mata 1; revalidar un nombre fijo mata 1; revalidar con el
  `exceptoId` equivocado mata 1; sacar la red de un `create` de SQL crudo mata 1.
  ⚠️ **Dos aserciones tuvieron que reescribirse porque no podían fallar:** el
  pre-chequeo y la revalidación pasan por la MISMA query, así que
  `toHaveBeenCalledWith({ nombre })` lo satisfacía el pre-chequeo solo y dejaba
  pasar un mutante que revalidara otro nombre. Hay que leer los dos valores en
  orden (`['Black Friday', 'Black Friday']`). Lo mismo con `exceptoId`.
  ⚠️ **Y un test era un recibo falso:** "no toca los errores que no son 23505"
  pasaba con el guard borrado, porque con el nombre libre igual salía el error
  original. Lo delata forzar el nombre **tomado** al revalidar. Lo encontró la
  revisión independiente midiendo el mutante, no la escritura del test.

---

## Papelera — salida de la colisión al restaurar (2026-08-01)

- [x] **Los 8 recursos con unicidad de nombre proponen un nombre libre.** El 400
  decía qué pasaba pero no daba salida: para restaurar, el usuario tenía que ir a
  renombrar a mano la fila viva que le ocupaba el nombre. Decisión del owner:
  el backend sugiere y la pantalla lo ofrece **editable**, con el número al final
  empezando en 2. Cerrado en dos formas según cómo la tabla enforcea la unicidad:
  - **Los 3 sin índice** (`descuentos`, `recargos`, `turnos`) consultan los
    nombres tomados antes de intentar.
  - **Los 5 con índice único parcial** (`cajones`, `causas-merma`,
    `motivos-diferencia`, `motivos-diferencia-inventario`,
    `grupos-modificadores`) la calculan **dentro del `catch` del `23505`**. La
    entrada de backlog planteaba esto como una decisión abierta ("consultar antes
    vs calcular en el catch") y **resultó no serlo**: con un índice el `catch`
    hace falta igual —entre consultar y escribir otra transacción puede tomar el
    nombre—, así que pre-consultar agrega una query en todos los restaurar y no
    permite sacar el bloque. Queda dominada. Se verificó además que ninguno de
    los 5 envuelve el restaurar en una transacción explícita, o sea que el fallo
    no deja una transacción abortada y las queries del `catch` funcionan.
  **Lo que casi se copia mal:** 3 de las 5 tablas indexan por `lower(nombre)` y
  no por `nombre` (medido con `pg_indexes`, no asumido). Sin eso la sugerencia
  habría devuelto un nombre que la base considera tomado, y el usuario habría
  recibido **el mismo 400 después de confirmar el modal**. Lo fija un e2e contra
  Postgres real (`causas-merma: la sugerencia respeta que el índice es
  case-insensitive`), que es el único lugar donde el `ILIKE` se prueba de verdad:
  los unit tests usan mocks sin índices.
  **Y dos colisiones quedaron SIN sugerencia a propósito**, porque renombrar no
  las resuelve: `garzones` (placeholder Mostrador) y la rama
  `uq_grupo_opcion_item_vivo` de `grupos-modificadores`. Esta última tiene test
  propio con ancla positiva: el mensaje habla de la opción y el cuerpo **no**
  trae `nombreSugerido`.

- [x] **`DESCUENTO_CONFIG` no tenía entrada para `directo`** (frontend) — el tipo
  de descuento más básico no mostraba ni modo ni valor en el drawer: `config`
  quedaba `null` y los campos simplemente no se renderizaban. No lo veía nada —
  el mapa es un `Record<string, …>`, así que la clave faltante no es error de
  tipos, y el consumidor la traga con `?? null`. Se encontró **a mano**, haciendo
  el smoke de la papelera de descuentos. Cerrado con la entrada y con
  `reglas-form-config.spec.ts`, que compara las claves de los dos mapas contra la
  lista de códigos del seed; el mutante (borrar la entrada `directo`) lo pone
  rojo. ⚠️ El guard es un **espejo a mano**: caza que se borre una clave, no que
  el seeder gane un código nuevo — backend y frontend son proyectos separados y
  un test de uno no lee archivos del otro. Por eso el seeder lleva ahora un
  comentario que lo recuerda. **Medido de paso: `RECARGO_CONFIG` no tenía el
  mismo hueco** (cubre los 5 códigos de recargo), así que la sospecha que la
  entrada dejaba abierta se cierra en negativo.

---

## Descuentos y recargos — todo expresa su monto (2026-08-01)

- [x] **Decisión del owner: un descuento sin valor no sirve para nada.**
  *"O es un valor en porcentaje o monto fijo"*. Al implementarla aparecieron
  **cuatro** puertas al mismo estado, las cuatro verificadas ABIERTAS contra la
  API real (curl con token de tenant) antes de tocar código:
  1. **`create()` no exigía valor a `directo`** —el tipo de propósito general—
     porque no estaba en ninguna lista del validador. Devolvía 201 con
     `valor: null`. Era el hueco que la entrada de backlog describía.
  2. **`update()` dejaba VACIARLO por `PATCH`**, y esto NO era exclusivo de
     `directo` ni de descuentos: un `{ "valor": null }` respondía **200** y
     dejaba sin monto una promoción del 15% y sin tasa un interés del 5% —
     entrada directa del motor de precios. El validador de update solo miraba
     la forma del valor cuando venía truthy, así que el `null` pasaba de largo.
  3. **Cambiar el `tipoReglaId` por `PATCH` a un tipo que exige valor**, sobre
     una fila que no lo tiene (un `por_mayor` guarda el monto en `tramos` y su
     `valor` es nulo): 200, y quedaba un `directo` sin importe.
  4. **El mismo camino al revés**: cambiar a un tipo por tramos sin mandarlos
     dejaba un `por_mayor` con CERO tramos. También 200.

  La segunda no estaba en el backlog: apareció al preguntarse "¿por dónde más
  se llega a este estado?". La tercera la encontró la revisión independiente, y
  es la que más enseña: **el primer fix tapaba las puertas una por una, y esta
  pasaba igual** porque el guard solo miraba `dto.valor` y ese camino no lo
  manda. La cuarta salió al reproducir la tercera y probar la simétrica.
  **La lección vale más que el fix:** validar EL CAMPO QUE LLEGA es la
  abstracción equivocada. Cambiar el tipo cambia qué campos hacen falta, así que
  hay tantas puertas como pares (tipo viejo, tipo nuevo) — taparlas de a una no
  termina nunca. Lo que se valida ahora es **el estado con el que la fila
  queda** (`validarEstadoResultante`), y con eso las cuatro se cierran de una.
  **Alcance:** la regla del owner era sobre descuentos; en `recargos` se aplicó
  la que ese módulo **ya tenía en `create()`** (los 5 tipos exigen valor), no
  una nueva — era su propio `update()` el que la contradecía.
  Cerrado con las listas a nivel módulo (`TIPOS_CON_VALOR_UNICO`,
  `TIPOS_CON_TRAMOS`, `TIPOS_CON_METODOS`) compartidas por los dos validadores,
  para que no puedan volver a discrepar. Lo fijan 7 unit tests con sus mutantes
  (sacar `directo` de la lista; sacar la llamada a `validarEstadoResultante`,
  que pone rojos 3) y `test/reglas-valor.e2e-spec.ts`, el único que ejercita el
  `ValidationPipe` real — que es justo por donde entraba el `null`.
  Las cuentas de tramos/métodos solo se consultan cuando el tipo resultante las
  exige y el `PATCH` no las trae: una query puntual, nunca una por fila.
  **Lo destapó el e2e existente:** al exigir valor, 6 tests de `papelera`
  empezaron a fallar porque sus fixtures creaban `directo` sin importe. Eso es
  la prueba de que el cambio muerde.

---

## `grupos_modificadores` — el índice de dev enforzaba otra regla (2026-08-01)

- [x] **Mal diagnosticado primero, y esa es la parte que vale.** La entrada de
  backlog decía que "el índice y el código no se ponen de acuerdo": el índice
  case-sensitive, `assertNombreLibre` con `LOWER(...)`. **Falso.**
  `startup-pos.sql:629` ya declaraba el índice sobre `LOWER("nombre")`, de
  acuerdo con el código. Lo que yo había medido con `pg_indexes` era el índice
  **de dev**, que creaba `synchronize` a partir del `@Index` de la entity — y
  TypeORM no sabe expresar una función en `@Index`. La propia entity lo decía
  en un comentario anterior a esta sesión, calificándolo de "discrepancia
  dev/prod menor y aceptada".
  No era menor: **el `restaurar()` de la papelera no pasa por
  `assertNombreLibre`**, así que en dev el único guard del lado del motor era el
  equivocado. Restaurar "Extras" con un "extras" vivo pasaba — verificado con el
  mutante, que pone rojos los dos tests nuevos.
  Cerrado sacando el `@Index` de la entity y creando el índice en el seeder con
  SQL cruda, **mismo patrón que `causas_merma` y los dos `motivos_diferencia`**,
  cuyas entities tampoco lo declaran por esta misma razón. El `DROP` es
  condicional (solo si el existente no es el de `lower()`), así que en una base
  ya correcta no hay churn.
  Lo fijan dos e2e: la **forma** del índice (`pg_indexes`, patrón ya usado en
  `caja.e2e-spec.ts`) y la **conducta** que depende de él (restaurar con
  colisión que solo difiere en mayúsculas → 400 con `nombreSugerido`).
  ⚠️ Dato para el próximo que toque esto: **el seeder es auto-reparador**.
  Volver a poner el `@Index` NO reintroduce el bug, porque `synchronize` corre
  antes que el seeder y el `DROP` condicional lo corrige. La pieza que sostiene
  la regla es el bloque del seeder, no la ausencia del decorador — el primer
  mutante que probé (devolver el `@Index` solo) pasó en verde y por eso hubo que
  buscar el mutante real.
  **Y una lección de método:** la primera medición de "cuáles comparan sin
  mayúsculas" grepeaba `lower(nombre)` sobre el archivo entero y matcheó
  **comentarios** —incluido uno mío—, dando que `cajones` era case-insensitive
  cuando no lo es. Medir el mecanismo en vez de la conducta, otra vez.
  **Contrapartida asumida:** sin el `@Index`, en dev `synchronize` puede dejar
  la tabla sin índice hasta que el seeder lo recree, así que la red del
  constraint pasa a ser que el seeder corra y no falle. Mismo perfil que ya
  tienen los otros tres recursos case-insensitive; no es riesgo nuevo, pero
  ahora aplica a un caso más.

---

## Deuda de código (harness)

- [x] ~~**El bloque de pausa está triplicado verbatim en las tres pantallas de
  configuración**~~ (frontend, cerrado 2026-08-07) — extraído a
  [`usePausaRegla()`](../../frontend/app/composables/usePausaRegla.ts) y al componente
  [`CrudPausarModal.vue`](../../frontend/app/components/crud/CrudPausarModal.vue).
  `descuentos.vue` −86 líneas, `recargos.vue` −86, `impuestos.vue` −78; los dos archivos
  nuevos suman 179.
  **El bloqueo que anotaba la entrada ya no aplicaba.** Decía que no se hizo porque "hoy
  no existe un composable compartido entre esas tres pantallas: extraerlo es introducir un
  patrón nuevo". `useTransferenciaPendientes()` lo introdujo en `15bce45f` y pasó revisión,
  así que esto fue **seguir** un patrón, no inventarlo.
  **Dos cosas que la entrada decía mal**, medidas antes de tocar: son **5 refs** más el
  `Set` de `toggling`, no "4 refs"; y el bloque **no es idéntico en las tres** — `impuestos`
  tiene un guard propio (`origen === 'sistema'`) que descuentos y recargos no tienen. Ese
  guard **se quedó en su pantalla**: es regla de impuestos, no de pausar. El composable no
  lleva un hook `puedePausar` opcional justamente para que no exista la forma de olvidárselo
  en silencio.
  **La red ya existía**: 6 tests de pausa por pantalla, los mismos 18 en las tres, que
  montan la página real. Tres mutantes sobre el composable —reactivar sin atajo, cero ítems
  abriendo modal igual, pausar a ciegas cuando falla el uso— **matan en las tres a la vez**,
  y cambiar el copy del modal compartido también.
  **Un hueco que la extracción reveló y se cerró:** el revert del update optimista cuando
  el `PATCH` falla **no lo cubría ningún test**, en ninguna de las tres. Con el código en un
  solo lugar, cubrirlo costó un test en vez de tres — el cuarto mutante (borrar el revert)
  lo mata **ese test y solo ese**, que vive en `descuentos`.
  **Lo que sigue sin test, declarado:** el guard `origen === 'sistema'` de `impuestos`. El
  switch no se rinde para esas filas (`v-if` en la tabla), así que la línea es inalcanzable
  por UI — defensa en profundidad por si alguien saca ese `v-if`. Ya era así antes; sacarla
  habría sido cambiar conducta fuera del alcance de un refactor.

- [x] ~~**Los mapas de estado de venta están duplicados en 4 `.vue`**~~ (frontend) —
  cerrado 2026-07-30 con [`useEstadoVenta()`](../../frontend/app/composables/useEstadoVenta.ts),
  consumido por `pages/ventas/index.vue`, `components/ventas/VentaDetalleDrawer.vue`,
  `pages/pagos/index.vue` y `components/pagos/PagoDetalleDrawer.vue` (−84 líneas). Las
  cuatro copias de `estadoColor`/`estadoLabel` eran **byte-idénticas**: no había drift que
  reconciliar, la extracción fue mecánica.
  **Lo que arregla de verdad no es la duplicación, es que las opciones del filtro dejaron
  de escribirse a mano.** Ventas y pagos armaban su `estadoOptions` repitiendo la lista de
  estados, y esa lista viaja al backend, donde `@IsEnum(EstadoVenta)` la valida: una opción
  de más no falla al escribirla, falla con un 400 al elegirla en producción —fue lo que
  pasó con `borrador`—. Ahora `estadoOptions` se **deriva** del mapa de etiquetas, así que
  no puede ofrecer un estado que no esté mapeado; y los mapas son `Record<EstadoVenta, …>`
  completos, así que sumar un estado a la unión no compila hasta darle color y etiqueta.
  Verificado contra el backend: las 4 claves son exactamente el enum `EstadoVenta`, y
  `/pagos` filtra por `ventaEstado` validado contra **ese mismo** enum — por eso es un solo
  concepto y el composable se llama `useEstadoVenta`, no `useEstadoPago`.
  **Fuera de alcance a propósito:** órdenes, propinas y suscripciones tienen funciones con
  el mismo nombre en sus pantallas, pero son enums distintos (`creada/en_proceso/…`,
  `borrador/confirmada/anulada`, `activa/pausada/cancelada`), no copias de este.
  Lo fijan 6 tests con **tres mutantes muertos**: (a) volver `estadoOptions` a la lista
  escrita a mano con `borrador` —el bug histórico— pone en rojo el test de opciones;
  (b) rotular las opciones a mano hasta que deriven de las etiquetas (`'Pagada parcial'`
  vs `'Parcial'`) pone en rojo el de consistencia badge↔filtro; (c) colapsar el color de
  `pagada_parcial` al fallback `'neutral'` pone en rojo el de colores —chequeado a
  propósito, porque un test que afirma el valor por defecto queda verde con el bug adentro.
- [x] ~~**Código SSR inalcanzable en `auth.ts` y `tenant.ts`**~~ (frontend) — cerrado
  2026-07-30 **con confirmación explícita del owner**, que hacía falta porque `tryRefresh`
  es el flujo de refresh token y la invariante 4 dice que el sistema JWT no se modifica sin
  ella. Con `ssr: false` ([ADR-017](../adr/017-spa-sin-ssr.md)) `import.meta.server` nunca
  es verdadero, así que se fueron: el par `serverApiUrl`/`resolvedApiUrl` de las dos stores
  —que además leían una `runtimeConfig.apiUrl` privada que ya no existe— y la rama SSR de
  `tryRefresh()`, con su reenvío de cookie (`useRequestHeaders`) y su propagación de
  `Set-Cookie` (`appendResponseHeader`). `resolvedApiUrl` pasó a llamarse `apiUrl`: el
  "resolved" nombraba una resolución entre dos candidatos que ya no existe.
  **Lo único que había que conservar del borrado era `credentials: 'include'`** —sin él el
  navegador no manda la cookie httpOnly del refresh y la sesión muere con un 401 sin
  explicación—, y no lo fijaba ningún test: `$fetch` está mockeado y los options se
  ignoraban. Ahora sí, con mutante (sacarlo pone el test en rojo).
  ⚠️ **El borrado rompió dos tests que no tocaban el tema, y eso destapó algo peor.** Al
  reemplazar `const config = useRuntimeConfig()` quedaron huérfanas cuatro referencias a
  `config` en `login`, `register` y `logout`: el `ReferenceError` caía en el `catch` y
  devolvía el mensaje genérico. Los dos tests que fallaron esperaban el mensaje del
  backend; los dos que verifican "no filtrar la URL del backend" **siguieron pasando por la
  razón equivocada**, porque el genérico es justo lo que esperan. Lección: un test verde
  después de un refactor no prueba que el camino siga vivo si su aserción es "sale el
  mensaje por defecto".
  **Verificado en navegador contra el stack real**, que es lo único que prueba de verdad un
  cambio en el refresh: con la cookie `access_token` borrada a mano, navegar a `/cajas`
  restauró la sesión —token nuevo en la cookie— y la pantalla cargó sin rebotar a `/login`.


- [x] ~~**Dos de las tres carreras "leer para validar, escribir sin lock"**~~ (backend,
  `items.service.ts`) — cerradas 2026-07-30. La tercera (`remove()`) sigue abierta en
  [`pendientes.md`](pendientes.md), re-diagnosticada: la entrada original decía que
  `remove()` "no es transaccional" y **era falso** —abre `dataSource.transaction()` y el
  chequeo corre adentro—; lo real es que ese `SELECT` no toma lock, así que es un phantom
  y el arreglo no es envolver en transacción sino bloquear el ítem referenciado en
  `remove()` **y** en cada camino que crea una referencia. Es una tarea propia.
  Las dos cerradas:
  - **El guard de `modo_inventario` leía `item_producto` sin `FOR UPDATE`** mientras
    `registrarMovimiento` sí lo toma sobre la misma fila (`inventario.service.ts`). No se
    serializaban: el modo podía cambiar con un movimiento recién escrito debajo, quedando
    bajo un modo que nunca lo admitió. Ahora la lectura toma el mismo lock.
  - **`item_receta.costo_actual` tiene dos escritores** —`update()` al reemplazar
    ingredientes y `aplicarDesfases()`— y ninguno bloqueaba. Los dos parten de los mismos
    ingredientes, así que el que commiteaba segundo pisaba el costo del otro con uno
    calculado sobre una lista que ya no era la de la receta.
    El lock va **antes de leer los ingredientes**, no antes de escribir: tomarlo después
    deja la misma ventana entre la lectura y el lock.
    ⚠️ **El primer intento introdujo un deadlock, y lo cazó la revisión independiente, no el
    gate.** El lock estaba puesto junto al costeo, que en `update()` corre **después** del
    `UPDATE items`: quedaba `items → item_receta`, mientras `aplicarDesfases` toma
    `item_receta → items` (el `UPDATE` del precio). Ciclo A→B / B→A alcanzable con un PATCH
    de receta normal —nombre + ingredientes en el mismo payload— contra un "aplicar desfase
    con actualizar precio", y en `items.service.ts` nadie reintenta el `40P01`. El lock se
    movió arriba del `UPDATE items`, así que los dos caminos toman `item_receta` primero.
    **Lección:** agregar un `FOR UPDATE` no es local — hay que mirar qué otros locks toma el
    método **antes**, no solo qué protege la línea nueva.
    En `aplicarDesfases` se toma **uno solo para todo el lote y con `ORDER BY item_id`** —el
    orden lo ponía el cliente, que es exactamente el caso a neutralizar: dos lotes con
    recetas en común se tomarían las filas en órdenes distintos y se abrazarían. Es la misma
    lección del deadlock de ventas cerrado el mismo día.
  Fijan el cierre 3 tests nuevos o ampliados en `items.service.spec.ts`, incluido el
  anti-N+1 de desfases, que pasó de exigir 2 lecturas a 3 **conservando lo que protege**: el
  número sigue siendo fijo con N=3 recetas, así que un lock por receta lo pondría en 9.
  **5 mutantes revirtiendo cada decisión al código anterior** —sacar cada uno de los tres
  `FOR UPDATE`, sacarle el `ORDER BY` al del lote, y devolver el lock de la receta a la
  posición que causaba el deadlock—: los 5 en rojo.

- [x] ~~**Los middlewares de permisos rompen la hidratación del menú lateral**~~ (frontend,
  `nuxt.config.ts`) — cerrado 2026-07-30, el mismo día que se abrió. Decisión del owner:
  **`ssr: false`**, la app es una SPA. Razonamiento completo en
  [ADR-017](../adr/017-spa-sin-ssr.md).
  El mismatch era el síntoma; la causa era que **el servidor no puede renderizar nada real**:
  toda ruta está detrás de `auth` y el token vive en el cliente, así que el SSR pintaba un
  menú vacío. Eso pasaba desapercibido porque el cliente también hidrataba vacío —los dos
  lados coincidían *por casualidad*— y el barrido de permisos rompió la casualidad al hacer
  que los middlewares esperaran `ensureCargado()`.
  Se descartó `routeRules` por ruta: habría que mantener a mano la lista de rutas con
  middleware de permisos y el default seguiría siendo el equivocado, así que la próxima
  pantalla con guard nacería rota.
  Cayeron con la decisión: la `runtimeConfig.apiUrl` privada y su `API_INTERNAL_URL` en
  `docker-compose.yml` y `Dockerfile.prod` (existían para el fetching server-side; las
  leían `stores/auth.ts` y `stores/tenant.ts`, pero **solo** detrás de `import.meta.server`
  y con fallback a la pública, así que ningún camino alcanzable cambia). Se agregó
  `app/spa-loading-template.html` porque sin SSR la carga dura arranca en blanco. De yapa,
  el resumen de build de Nitro bajó de **11,5 MB a 2,1 MB**.
  **Queda abierto** lo que no se puede tocar acá: las ramas `import.meta.server` de
  `auth.ts`/`tenant.ts` son inalcanzables pero viven en el sistema de tokens JWT
  (invariante 4). Entrada propia en [`pendientes.md`](pendientes.md).
  **Verificado en navegador** sobre el stack real, no deducido: las mismas rutas que tiraban
  `Hydration node mismatch` (`/cajas/historial`, `/configuracion/impuestos`) quedaron con la
  consola limpia, y la suite de navegador completa (`npm run e2e`) pasa en verde — que era
  el riesgo real del cambio, porque altera cuándo aparece el contenido.

- [x] ~~**Cuatro pantallas más sin gatear sus controles de escritura**~~ (frontend,
  `configuracion/garzones.vue`, `impresoras.vue`, `salones.vue`, `turnos.vue`) — cerrado
  2026-07-30, resto del barrido de permisos. Cada control quedó con el permiso de **su**
  endpoint, leído del controller ruta por ruta y no de esta entrada.
  Lo que el mapeo real corrigió respecto de lo que la entrada daba por sabido: **garzones,
  salones y turnos no tienen módulo propio** —sus rutas piden `Salones:*`—, y
  **`Salones:Operar` no toca ninguna de las cuatro**: es de la operación (cuentas, comandas,
  `garzones/identificar`, sesiones-garzón), no de estas pantallas. Ningún endpoint apareció
  sin guard: no hubo hallazgo de seguridad.
  Tres controles no eran deducibles mirando la pantalla y salieron del controller:
  **Regenerar PIN** es `PATCH /garzones/:id/pin` → `Actualizar`, no un permiso aparte;
  **Agregar mesa** es `POST /salones/:id/mesas` → `Crear`, aunque viva dentro del editor del
  plano; y el **plano arrastrable es una escritura** —soltar una mesa guarda
  `PATCH :id/layout` y el doble-click abre el drawer de la mesa (`PATCH /mesas/:id`)—, las
  dos `Actualizar`, así que se gatea la prop que habilita la interacción
  (`:editable="puedeActualizar"`) y no un botón. Sin eso el usuario arrastra mesas y descubre
  el 403 recién al soltar. El switch de `activo` de impresoras se **deshabilita** en vez de
  esconderse (además muestra estado), sumando el permiso a la condición `toggling` que ya
  existía.
  Queda una asimetría que es **de la UI y es preexistente, no del gate**: borrar una mesa
  solo se ofrece dentro del drawer de edición, al que únicamente se llega por el doble-click
  que exige `Actualizar`; quien tenga `Eliminar` sin `Actualizar` no puede borrar mesas por
  pantalla. El botón igual se gatea con `Eliminar`, que es el sentido que sí ocurre.
  **Salió del alcance pedido, pero sin esto el gate no servía:** el menú de
  `configuracion.vue` publicaba esas cuatro entradas con `…:Crear` —el resto del menú pide
  `Leer`—, así que quien tenía `Actualizar` o `Eliminar` nunca llegaba a la pantalla donde
  sí podía trabajar, y el botón de editar recién gateado era código muerto para él. Es el
  mismo colapso de permisos, una capa más arriba. Corregido a `Leer` en los dos bloques.
  Fija el cierre `app/pages/configuracion/permisos-escritura.nuxt.spec.ts` (29 tests). Un
  solo archivo tabla-driven para las cuatro porque el modo de falla es uno y es el mismo:
  colapsar los tres permisos, o gatear unos controles y olvidar otros; cuatro specs casi
  idénticos lo esconderían en la duplicación. **19 mutantes, todos revirtiendo al código
  previo al gate** —quitar el `v-if`, devolver `editable` fijo, sacar `|| !puedeActualizar`
  del switch, dejar el borrar-mesa en `v-if="mesaEditingId"`, devolver el menú a `Crear`—:
  los 19 en rojo. La revisión independiente cazó que uno de los tests del menú pasaba igual
  con el gate roto (sin ningún permiso del módulo, `Leer` y `Crear` dan `false` los dos):
  se agregó el caso que sí discrimina —el rol real del bug, `Leer` + `Actualizar` sin
  `Crear`— y el que no discrimina quedó con su razón escrita al lado.

- [x] ~~**Cuatro suites e2e dejan la caja abierta al terminar**~~ (backend, `test/combos`,
  `grupos-modificadores`, `grupos-modificadores-overrides` y `recetas.e2e-spec.ts`) —
  cerrado 2026-07-29. Las cuatro tenían el **mismo** helper `cerrarCaja` de 10 líneas:
  llamaba solo a la fase 2 (`POST /:id/cerrar`) sobre una caja `abierta` —que el service
  rechaza, porque exige `en_conciliacion`— y **no miraba el status**, así que no cerraba
  nada y el cajón quedaba ocupado. La suite pasaba porque sobraban cajones; al agregar
  tests cambia el orden en que jest ordena las suites y la fuga reaparecía como un `409`
  críptico en `caja.e2e-spec.ts`, a varios archivos de la causa (ya pasó en jul-2026 con
  `liquidacion-propinas`: 11 fallos con 409, media hora de diagnóstico).
  Ahora las cuatro cierran por las dos fases reales, con el patrón de `ventas.e2e-spec.ts`
  (commit `c8e3abe`) y **aseverando** las dos: `expect` sobre el status del conteo —que el
  original de ventas no tiene, y sin el cual un 400 en fase 1 volvería a ser silencioso— y
  sobre el de la finalización. La justificación manda **siempre** un comentario, para no
  depender de que el primer motivo activo del tenant no exija `requiereComentario`.
  **Contrafactual medido, no deducido** (es una fuga de estado: que la suite pase no prueba
  nada). Sobre BD reseteada, corriendo solo `combos`: con el helper viejo restaurado quedan
  **1 caja física en `abierta`**; con el nuevo, **0**. Tras la e2e completa (**16 de 17
  suites, 170 tests verdes**; la 17ª es `pasarela-oneclick`, que se saltea sola salvo
  `RUN_TRANSBANK_E2E=1`, y son sus 2 tests los que aparecen como skipped) las únicas cajas
  abiertas son las **2 virtuales** del seed —una por tenant, abiertas por diseño— y las 28
  físicas quedaron `cerrada`.

- [x] **Burndown de typecheck del frontend — COMPLETO (0 errores)** (frontend) — jul-2026
  Los 84 errores de vue-tsc estricto se quemaron por tandas. `typecheck-baseline.json`
  quedó vacío: el `typecheck:ratchet` ahora es un gate totalmente estricto (cualquier
  error nuevo bloquea CI). Todos los patrones y sus fixes solo-de-tipo quedaron en
  `anti-patterns.md` (`@click`→arrow inline; spread/índice guardado→`!`; `string|null`→prop
  con `?? undefined`/tipar form; mismatches Nuxt UI·reka; tipado de unit tests vitest).

- [x] **El cierre de caja pisaba el comentario de la apertura** (backend, cerrado
  2026-08-12 con el plan `testigo-cierre-forzado`, Task 4). **Entrada original
  (verbatim):** *"(backend, `caja.service.ts:246` y `:737`, medido 2026-08-11 al
  planificar el testigo) — las dos operaciones escriben la **misma** columna
  `cajas.comentario`: `abrir()` guarda el de la apertura y `enviarConteo()` lo sobrescribe
  con el del cierre. Nadie lo notó porque el comentario de apertura casi no se usa. Sube de
  prioridad con el testigo del cierre forzado, que **vuelve obligatorio** el comentario en
  más cierres: más cierres con comentario = más comentarios de apertura perdidos. No se
  arregló ahí porque es preexistente y arreglarlo es decidir si el de apertura merece
  columna propia — o si directamente no debería existir."*
  **Cómo se cerró:** columna propia — decisión del owner (2026-08-12), la que la entrada
  original dejaba pendiente. `cajas.comentario_cierre` (TEXT, nullable) es del CIERRE;
  `cajas.comentario` queda exclusivamente de la APERTURA. `enviarConteo` (fase 1) dejó de
  tocar `comentario` y escribe `comentarioCierre`; `cerrar` (fase 2, Task 4 del mismo plan)
  hace lo mismo si trae un comentario nuevo, sin tocar jamás la columna de apertura. La
  regla del testigo (fase 2 exige comentario en el cierre forzado sin firma) mira solo
  `comentarioCierre` — el de esa fase o el que ya haya dejado la fase 1 — así que un
  comentario de apertura ya no puede satisfacerla, por diseño.
  **Primer intento, revisado y corregido antes de cerrar la task.** La primera versión no
  separaba columnas: dejaba `cerrar` escribir en la misma `cajas.comentario` que
  `enviarConteo`, y para no perder la explicación de fase 1 los concatenaba
  (`"Conteo: … | Cierre: …"`). La revisión lo bloqueó: concatenar era parchar la confusión
  entre apertura y cierre, no resolverla — el comentario de apertura y el de cierre no
  tienen nada que ver entre sí. Se descartó la concatenación y se separaron las columnas.
  **Lo que fija el mutante que importa:** un test verifica que abrir una caja con
  comentario y después cerrarla (forzado, sin firma, con un comentario nuevo en la fase 2)
  conserva **los dos por separado** — `caja.comentario` intacto con el texto de la
  apertura, `caja.comentarioCierre` con el del cierre. Revertir la escritura de `cerrar`
  para que vuelva a caer en `caja.comentario` (el bug original) tira ese test.

---

## Barrido de permisos en el frontend (2026-07-30)

- [x] ~~**Barrido de botones de escritura sin gatear por permiso (19 pantallas)**~~ y
  ~~**Component tests del gateo de permisos — falta decidir si se adopta**~~ (frontend +
  backend) — cerradas juntas el 2026-07-30. La entrada pedía `v-if` en 19 archivos; lo que
  se hizo es distinto, y **la mitad de lo que la entrada afirmaba no resistió medirlo**:
  - ⛔ **Apareció un hueco de autorización real, no de UX.** `POST /tenants/members` y
    `DELETE /tenants/members/:userId` no tenían `TenantAdminGuard`: colgaban solo de
    `JwtAuthGuard + TenantGuard`, siendo las **únicas** dos rutas del controller sin él (con
    `PATCH me` al lado que sí lo tenía, y el controller hermano de `roles` guardando todo).
    Cualquier miembro autenticado podía sumar cuentas al tenant y **eliminar al admin del
    suyo**. Se cerró acá, y no en una entrada aparte, por una razón concreta: **el barrido
    tal como estaba planteado lo habría tapado** — esconder botones deja la UI con aspecto
    de permiso resuelto mientras el endpoint sigue abierto a `curl`. Lo fija
    `test/tenants-members.e2e-spec.ts`; el mutante que saca los dos guards **borró un
    miembro de verdad**, que es la demostración práctica de la severidad.
  - **`items` NO es admin-only**, aunque la entrada lo listaba entre las 16: va con
    `@RequiresPermiso('Items', …)`. Gatearlo con `esAdmin` como sus vecinas le habría
    escondido los botones a quien sí puede escribir — el bug **inverso** al que el barrido
    venía a arreglar.
  - **15 de las 16 ya estaban escondidas del menú** bajo `esAdmin` (`configuracion.vue:22`),
    así que el "callejón sin salida" exigía escribir la URL a mano. Real, pero no el
    tropiezo cotidiano que la entrada describía. Y eso habilitó una salida mejor.
  - **`configuracion/recetas-desfases.vue` es un stub de redirección de 6 líneas**; la
    pantalla real vive en `/recetas-desfases`. La entrada apuntaba al archivo equivocado.
  **Lo que se hizo, decidido por el owner con los números arriba de la mesa:**
  - **Middleware `admin`** (`app/middleware/admin.ts`) + `definePageMeta` en las 15
    admin-only, en vez de ~60 `v-if`. Un mecanismo en lugar de quince, **cubre la URL
    escrita a mano** —que el `v-if` no cubre— y se testea como función pura.
    ⚠️ Lo que casi lo rompe: los permisos se cargan en `onMounted`, o sea **después** de la
    navegación. Sin esperar, un admin entrando por URL directa o F5 se lee como no-admin y
    queda expulsado de su propia pantalla. Por eso el store ganó `ensureCargado()`, que
    además dedupe el request en vuelo (middleware y layout montaban a la vez).
  - **Gate por permiso en las 4 que no son admin-only** (`items`, `terceros`, POS,
    `recetas-desfases`), cada control con el permiso de **su** endpoint y sin colapsarlos en
    un `puedeEscribir` único: hay roles con `Actualizar` y sin `Crear`.
    En el POS el permiso se sumó a `puedeCobrar`, que ya era una función pura con spec —la
    convención de "sumar a la condición existente en vez de un `v-if` paralelo"—. En el
    panel de desfases el gate vive en el componente y no en sus tres páginas, para que no se
    desincronice entre call sites.
  - Dos excepciones deliberadas al "esconder": los `USwitch` de `activo` se **deshabilitan**
    en vez de ocultarse, porque además de escribir muestran estado — esconderlos borraría
    información de la tabla.
  **Los component tests se adoptan, acotados a esto** (era la decisión abierta de la otra
  entrada). Confirmado el costo del spike: 3 archivos con `// @vitest-environment nuxt`
  llevan la suite de 3,3s a 6,3s. Y confirmada la trampa que la entrada anticipaba: Nuxt
  instala su propia Pinia, así que hay que mockear el auto-import con `mockNuxtImport`.
  Trampa nueva, no anticipada: **no consultar por la clase del icono** — `UIcon` lo renderiza
  en un hijo y en el entorno de test no siempre resuelve. Se consulta por `title`, lo que de
  paso agregó accesibilidad que faltaba en los botones de fila de `terceros`.
  ➕ **Un modo de falla que encontró la revisión independiente y se cerró en el mismo
  commit:** si `fetchPermisos` fallaba (red, hipo de token), el `catch` solo seteaba `error`
  y el `finally` marcaba `cargado = true` igual — así que `ensureCargado` resolvía con
  `esAdmin` en su default `false` y el middleware **expulsaba a un admin real**. El docblock
  que yo había escrito decía resolver el caso de timing y no cubría el de error. Ahora
  `cargado` solo se marca si de verdad se pobló (la próxima navegación reintenta) y el
  middleware **no redirige cuando no pudo determinar**: se deja pasar, porque esto es UX y el
  candado real es el guard del backend. Redirigir ante la duda se ve como "a veces me tira al
  índice" y nadie lo reporta como bug de permisos.
  **Seis mutantes verificados revirtiendo** ([[mutante-debe-revertir-no-solo-romper]]):
  gatear `items` con `esAdmin` (cae el test del no-admin con `Items:Crear` — el bug que la
  entrada me habría hecho cometer); sacar el `v-if` de "Nuevo item"; colapsar los tres
  permisos de `terceros` en uno; sacar el `v-if` del panel; sacar el `await ensureCargado`
  del middleware; y sacarle la salida temprana del caso "no se pudo determinar".

## Limpiezas menores

- [x] ~~**Falta usuario semilla "supervisor `Cajas:Leer` no-admin" para e2e del ciego**~~ —
  cerrado 2026-07-28: el seed siembra `supervisor@paris.cl` con el rol `Cajas · Supervisión`
  (no fijo, `Cajas:Leer` y **nada más**; sin `MiCaja`, así que no opera ninguna caja propia).
  Es la combinación exacta contra la que se define el ciego —ve cajas ajenas y **no** es
  admin— y no existía: `admin.paris` hacía de "supervisor" pero es admin, y `vendedor.paris`
  no llega a una caja ajena.
  El e2e nuevo assevera lo que ningún mock podía: la sesión de la caja del cajero llega
  **no nula** con `saldoEsperado: null`. Esa aserción es la que separa "no ve el número
  porque es ciego" de "no ve el número porque no llega a la caja" — sin ella un 403 o una
  grilla vacía darían el mismo `null`. En la misma corrida, el admin sobre **el mismo
  cajón** sí ve el esperado, y se verifica que sea el número de verdad (inicial + los 3000
  que acaban de entrar), no un placeholder.
  Tres mutantes verificados, cada uno mata su parte: `esAdminTenant` siempre `true` (el
  supervisor recibe `13000.0000`), el controller que no pasa `esAdmin` (el **admin** queda
  ciego), y `cajonesEstado` sin la retención.
  ⚠️ **Lo que el mutante 2 destapó, y quedó arreglado:** al fallar el test, la caja del
  cajero quedaba abierta y **contaminaba la corrida siguiente** —el mutante 3 dio un falso
  resultado por eso—. El `afterAll` del describe nuevo ahora libera la caja pase lo que
  pase, verificado empíricamente: con el mutante puesto la corrida falla, y la siguiente
  sobre **la misma base** pasa. Es el patrón que [`pendientes.md`](pendientes.md) predice
  para las tres suites que siguen sin cerrarla.

- [x] ~~**`select-tenant.vue` tiene el mismo bug de truncado que se corrigió acá**~~ —
  cerrado 2026-07-29, **reabierto y refutado el mismo día**. Se creyó que
  `pages/select-tenant.vue:84` (`flex-1 truncate` sin `min-w-0`) tenía el mismo defecto que
  `31893f7` "arregló" en `AdvertenciasPrecio.vue`, y se agregó un gate estático
  (`scripts/check-design-tokens.mjs`) que marcaba el elemento hijo flex (`flex-1`,
  `flex-auto`, `basis-*`) **y** trunca en sí mismo, sin `min-w-0`.
  Medido después en navegador real (Chromium): la
  premisa era falsa. Por la spec de Flexbox §4.5, el mínimo automático de un ítem flex es
  **cero** cuando su propio `overflow` computado no es `visible` — y `truncate` incluye
  `overflow: hidden`. Un elemento que **es** el ítem flex y **lleva** `truncate` encima ya
  encoge solo; `min-w-0` ahí es redundante. Barrido pre-fix vs. post-fix de `31893f7`,
  idéntico fila por fila en 9 anchos de contenedor (360px→50px): el commit fue un no-op.
  El defecto real que motivó `31893f7` era *wrapping* vertical a cinco renglones, ya
  resuelto por el commit anterior (`ceba35f`) al introducir `truncate`.
  La forma que **sí** rompe es la opuesta a la que el gate vigilaba: `truncate` en un
  **descendiente** de un ítem flex/grid cuyo propio `overflow` es `visible` (`truncate`
  implica `white-space: nowrap`, así que el min-content del bloque es el ancho completo del
  texto, y el ítem se niega a encoger). Medido: desborda 370px sobre un contenedor de
  300px, con o sin `flex-1` en el wrapper.
  **Qué quedó en su lugar:** el gate estático se borró de `check-design-tokens.mjs` (no
  puede ver una relación ancestro/descendiente entre líneas distintas del template, solo
  detecta la forma segura). El `min-w-0` de `select-tenant.vue:84` se dejó — es inocuo,
  sacarlo es churn sin ganancia — pero **no era necesario**. La regla real (cuándo
  `min-w-0` hace falta y cuándo es ruido, con los números de la medición) quedó
  documentada en `docs/patterns/frontend.md` §16.

- [x] ~~**Cuatro hijos directos de un `.flex` que truncan sin `min-w-0` en ningún
  ancestro — candidatos a verificar, no bugs confirmados**~~ — cerrado 2026-07-29: los
  cuatro son **falsos positivos**. Medido en navegador real pisando el `textContent` con
  texto forzado (46 a 109 caracteres, según candidato) y leyendo `scrollWidth`/`clientWidth`
  del elemento, si el padre desbordó y si la página ganó scroll horizontal:
  - `app/components/caja/CajaAperturaGrid.vue:95` y `CajaCajonesGrid.vue:56` — el span
    que trunca recortó correctamente (`elScrollW`/`elClientW` 356/265 y 356/252); el padre
    no desbordó. Misma forma que `select-tenant.vue:84`: el elemento que trunca **es** el
    ítem flex, así que su propio `overflow: hidden` (parte de `truncate`) ya fija el
    mínimo automático en cero (Flexbox §4.5) — `min-w-0` ahí no aporta nada.
  - `CajaCajonesGrid.vue:71` — reproducción sintética fiel (mismo `[data-slot="body"]`
    real de la `UCard`) con texto de 109 caracteres: recortó (817/232), misma forma segura.
  - `app/layouts/dashboard.vue:184` — con texto de 82 caracteres no truncó porque **no
    tuvo que hacerlo**: el contenedor creció de 439px a 626px en vez de recortar. Ningún
    criterio pedido (recorte, desborde del padre, scroll horizontal de página) indica
    bug; mecanismo distinto a los otros tres (crecimiento del contenedor, no
    truncado-que-falla), anotado como nota aparte, no como bug.
  Ninguno se toca: no había nada que corregir. La regla real —cuándo `min-w-0` hace
  falta— quedó en `docs/patterns/frontend.md`.

---

## Harness / tooling (CodeGraph)

- [x] **Sync de CodeGraph en un git hook + niveles de búsqueda — HECHO** (harness) — jul-2026
  `.githooks/pre-push` corre `codegraph sync --quiet` (red de seguridad no-bloqueante:
  nunca frena el push, no-op si CodeGraph ausente; nunca `index`). Validado empíricamente:
  el daemon estaba caído y el índice tenía 44 archivos viejos; el sync los reconcilió en
  <1s. Niveles de búsqueda (`--max-files`: rápido=default / normal=3-5 / profundo=10+)
  documentados en el "Orden de búsqueda" de `CLAUDE.md`.

---

## Propinas en POS (notas de la revisión final)

- [x] ~~**`propinaDirecta`/`propinaCierreMesa` no se restringen al canal `fisico`**~~
  (backend, `ventas.service.ts`) — cerrado 2026-07-30. Las dos propinas son del canal
  presencial (el POS y el cierre de mesa de salones), pero el gate miraba solo
  `habilitadoPos`/`habilitadoSalones`: una venta `online` podía enviarlas y quedaban
  persistidas como `venta_propina`.
  **Se ignora, no se rechaza** — es la semántica que la feature ya tenía documentada para un
  canal apagado (`docs/features/pagos.md#propina-en-el-pos`), y meter un 400 acá habría hecho
  convivir dos comportamientos para la misma clase de propina inválida. El gate quedó en un
  solo booleano (`traePropina`), que además evita consultar `PropinaConfiguracion` en las
  ventas online.
  **Mutante verificado revirtiendo** ([[mutante-debe-revertir-no-solo-romper]]): sacando
  `canal !== 'online'` el e2e nuevo de `liquidacion-propinas` falla (encuentra la fila de
  propina); con el gate, la venta online se crea con 0 propinas y los dos flags encendidos,
  o sea lo único que la cortó fue el canal. Es el primer e2e del repo que crea una venta
  `canal: 'online'`.

---

## Auditoría `ventas` + `pagos` (2026-07-27)

Pasada de 7 lentes según `docs/agent/auditoria-codigo.md`. 20 hallazgos crudos → 15
confirmados tras refutación (3 eran el mismo bug visto por lentes distintas, 3 pasaron a
decisión de owner, abajo). **Ninguno se corrigió en la pasada**: la auditoría produce
información, no diffs. Orden = severidad.

- [x] ~~**Otros 14 `.vue`/composables arman el mensaje de error a mano**~~ (frontend) —
  cerrado 2026-07-29. **Eran 20 archivos, no 14**: los 15 que listaba la entrada (toasts en
  `components/caja/*` ×5, `components/configuracion/*` ×2, los 3 composables, `tienda/*` ×3,
  `ventas/index.vue`, `pagos/index.vue`) **más 5 stores** que no estaban anotados
  (`auth`, `tenant`, `permissions`, `monedas`, `unidades-medida`), donde el array no iba a un
  toast sino directo a `error.value`. 24 sitios en total, todos con el mismo cast mentiroso
  (`{ message?: string }` sobre algo que el `ValidationPipe` devuelve como `string[]`).
  Cero restos: el grep del cast a mano queda vacío.
  Dos cosas que el barrido destapó:
  - `pages/tienda/medios-pago.vue` tenía su **propia copia local** de `apiErrorMsg`, con el
    bug adentro, sombreando al util compartido. Se borró; el nombre resuelve ahora al
    auto-import.
  - `stores/auth.ts` (registro) ya juntaba el array a mano con `Array.isArray(...).join`.
    Quedó reemplazado por el util: mismo resultado, una lógica menos duplicada.
  ⚠️ **Cambio de comportamiento visible, deliberado:** `apiErrorMsg` **conserva** el motivo
  de un error local detrás del fallback (`"Error al cargar tenants: Network error"`) en vez
  de tragárselo. Antes esos casos mostraban solo el genérico. Es el diseño del util
  compartido —el mismo que ya usan ventas, pagos, órdenes y suscripciones— y por eso el
  barrido lo adopta en vez de replicar el `?? fallback`. Rompió 2 tests que aseveraban el
  genérico exacto; se actualizaron con el porqué al lado, no se aflojaron.
  Lo fija un test RED verificado en `stores/tenant.spec.ts`: con `message: ['a','b']` el
  `error.value` **era el array** (`expected [ 'tenantId debe ser un UUID', …(1) ]`) y ahora es
  el string unido. La resolución del auto-import en los 20 archivos la garantiza `vue-tsc`:
  un `apiErrorMsg` no resuelto sería un error de tipos, y el ratchet quedó en 0.
  ⛔ **Segunda regresión propia del mismo barrido, encontrada por la revisión independiente y
  corregida antes de commitear:** `login` y `register` de `stores/auth.ts` son los **únicos
  dos sitios sin sesión** de los 24, y ahí ese "conservar el motivo local" filtraba
  infraestructura a un visitante anónimo — cuando el backend no responde, el `message` del
  `Error` de ofetch trae el método y la URL completa
  (`[POST] "http://host:3000/api/auth/login": <no response> fetch failed`), así que el toast
  del login pasaba a mostrarla. `apiErrorMsg` acepta ahora `{ detalleLocal: false }`, que
  descarta el mensaje del error local **sin** tocar el del backend (incluido el array de
  validación), y los dos sitios de `auth.ts` lo usan.
  Lo fijan 4 tests en `stores/auth.spec.ts` con los 2 RED verificados
  (`expected 'Error al iniciar sesión: [POST] "http…' to be 'Error al iniciar sesión'`), que
  aseveran las dos mitades: el genérico sin `http` en el fallo de red, y el mensaje del
  backend intacto en credenciales inválidas y en el array de validación del registro.

- [x] ~~**El `LEFT JOIN turnos` tampoco filtra por tenant**~~ (backend,
  `turnos/sesiones-garzon.service.ts`) — cerrado 2026-07-29, el vecino que quedó a la vista
  al cerrar los de `garzones` el mismo día. Los dos JOIN de `turnos` (`listarAbiertas` e
  `historial`) llevan `t.tenant_id = $1`; `turnos` tiene la columna (verificado contra la BD).
  ⚠️ **Hueco de cobertura que esto destapó, y que el gate no ve:** **ningún e2e** toca
  `GET /sesiones-garzon/abiertas` ni `GET /sesiones-garzon` (historial) ni
  `GET /cuentas/:id/asignaciones`, así que un SQL malformado en esas tres queries pasaría
  todo el gate en verde — el unit solo asevera el texto de la query. Se ejercitaron a mano
  contra Postgres real: las tres devuelven **200**, la del historial también con filtros
  dinámicos (`?estado=cerrada&page=1&pageSize=5`), que es donde un `$1` mal numerado
  reventaría. Y lo que importa del filtro: los nombres unidos siguen llegando
  (`garzonNombre: "Ana Torres"`, `turnoNombre: "Mañana"`), o sea el JOIN no quedó sin
  matchear. Vale como e2e futuro.

- [x] ~~**Otros tres `LEFT JOIN garzones` sin filtro de `tenant_id`**~~ (backend,
  `turnos/sesiones-garzon.service.ts`, `salones/cuenta-asignaciones.service.ts`) — cerrado
  2026-07-29. **Eran cuatro, no tres**: dos en `sesiones-garzon` (`listarAbiertas` e
  `historial`) y dos en `cuenta-asignaciones` (`g` y `go`, el garzón y el de origen del
  tramo). Los cuatro llevan ahora `tenant_id = $1`, que ya estaba en scope en las dos
  queries. Defensa en profundidad: no eran explotables por sí solos, el `garzon_id` de esas
  filas se escribe por caminos tenant-scoped.
  **La cobertura es del SQL, no del comportamiento, y es a propósito:** el escenario que
  discriminaría el filtro exige dos tenants compartiendo un `garzon_id`, que es la PK —
  imposible de montar por API o por SQL. Así que el test asevera que la query lleva el
  filtro, en el mismo estilo que las aserciones de `LEFT JOIN` que ese spec ya tenía por el
  bug de soft-delete. Ambos RED verificados antes del fix.
  ⚠️ **Queda a la vista un vecino con el mismo defecto, fuera de alcance:** el
  `LEFT JOIN turnos t` de esas dos mismas queries tampoco filtra por tenant, y `turnos` sí
  tiene la columna (verificado contra la BD). El `LEFT JOIN usuarios u` de
  `cuenta-asignaciones` **no** corresponde filtrarlo: `usuarios` no tiene `tenant_id` porque
  un usuario pertenece a varios tenants.

- [x] ~~**El vuelto se asigna íntegro a un pago sin acotarlo a su propio monto**~~ —
  cerrado 2026-07-27: el excedente se reparte entre los pagos con `permite_vuelto`,
  acotado al monto de cada uno y en orden determinista por `metodoPagoId`; si supera lo
  devolvible (es decir, si los métodos sin vuelto superan el target) se rechaza con 400.
  Se acabaron los movimientos de caja `entrada` con monto negativo. Era el hallazgo que
  detectaron 3 lentes independientes.
- [x] ~~**`registrarAbono` calcula el saldo con la suma bruta de pagos**~~ — cerrado
  2026-07-27: `registrarAbono` lee `pago_aplicaciones` con `tipo='venta'`, igual que
  `listar()`/`resumen()`. La fórmula documentada en `docs/features/ventas.md` y
  `pagos.md` también se corrigió (estaba escrita antes de las propinas). Cubierto por
  e2e, no por unit: el mock del unit devuelve la fila igual con cualquier query.
- [x] ~~**`metodoPagoId` se persiste sin validar que esté habilitado para el tenant**~~
  — cerrado 2026-07-27: `registrar()` rechaza con 400 cualquier `metodoPagoId` ausente
  del mapa tenant-scoped, antes de escribir nada.
- [x] ~~**`garzonId` de propina no se valida contra el tenant y el JOIN de lectura lo
  expone**~~ — cerrado 2026-07-27: `propinaCierreMesa` valida con
  `GarzonesService.obtenerActivoPorId(tenantId, garzonId)` antes de persistir, y el JOIN
  de `findOne` lleva `AND g.tenant_id = vp.tenant_id`. Se sembró un garzón de Falabella
  (`…440332`) **solo** para que el e2e pueda ejercer el cruce: es activo y válido, así que
  el único motivo de rechazo posible es el tenant.
  ⚠️ Ese garzón **aparece en el listado de garzones de Falabella** (es `activo: true` a
  propósito: con `activo: false` el test pasaría por "inactivo" sin tocar el chequeo de
  tenant). Hoy ningún test cuenta garzones de ese tenant. Si algún día uno lo hace y da
  uno de más, la causa está acá — no lo desactives, ajustá el conteo.
- [x] ~~**La caja se verifica sin lock y el movimiento se escribe después sin
  re-chequear**~~ — cerrado 2026-07-27: la creación de venta (canal físico) y el abono
  toman `bloquearCajaAbierta` dentro de la transacción, el mismo patrón que ya usaba la
  nota de crédito. Los tres caminos que escriben en `movimientos_caja` sostienen ahora el
  lock hasta el commit. La caja virtual queda deliberadamente fuera: nunca se cierra y
  bloquearla serializaría todas las ventas online del tenant.
- [x] ~~**N+1 al crear una venta: un `itemsService.findOne` por línea del carrito**~~ —
  cerrado 2026-07-27 con `ItemsService.cargarBasePorIds`: **una** query para todo el
  carrito. Resultó peor de lo reportado: la venta usa solo campos del row base, así que
  las 3-6 queries extra que `findOne` hacía por ítem (impuestos, recargos, descuentos,
  ingredientes, componentes, grupos) construían colecciones que se descartaban enteras.
- [x] ~~**`registrarAbono` sin `FOR UPDATE` sobre la venta**~~ — cerrado 2026-07-27: la
  carga de la venta toma `FOR UPDATE`, así que los abonos sobre la misma venta se
  serializan hasta el commit y la suma de `pago_aplicaciones` queda bajo ese lock.
- [x] ~~**Orden de locks de `item_producto` decidido por el cliente → deadlock**~~ —
  cerrado 2026-07-27: los movimientos de inventario se recorren en orden determinista por
  `itemId` (desempate por posición), no en el del carrito. Un orden global fijo hace
  imposible el bloqueo en cruz entre dos ventas con los mismos productos.
- [x] ~~**`esNotaCredito` se recalcula en el drawer con un código hardcodeado**~~ —
  cerrado 2026-07-27: `findOne()` lo emite con el mismo criterio que `listar()` (el id del
  tipo de documento) y el drawer lo consume. Hay un test con una NC de código `'9999'`:
  comparar por código daría `false` y el test falla.
- [x] ~~**`tasa_cambio` se calcula con 6 decimales y se persiste en escala 4**~~ —
  cerrado 2026-07-27: la columna pasa a `NUMERIC(18,6)`, la misma escala que
  `tenant_moneda.valor_del_dia` de donde sale la tasa. El campo vuelve a reproducir
  `precioUnitario`, que es para lo que existe.
- [x] ~~**`pos.vue` y `AbonoModal.vue` no usan `apiErrorMsg`**~~ — cerrado 2026-07-27
  (las dos ocurrencias de `pos.vue`, no solo la del hallazgo).
- [x] ~~**La rama "caja en conciliación" no la ejerce ningún test**~~ — cerrado
  2026-07-27: un test por service verifica que una caja presente-pero-no-abierta se
  rechaza, y que corta **antes** de escribir (sin lock, sin cargar ítems, sin `save`).
- [x] ~~**Nadie ejerce a cuál pago se le asigna el vuelto con métodos mixtos**~~ —
  cerrado 2026-07-27, en **dos** intentos, los dos fallidos por la misma causa. La 1ª
  versión ponía el método con vuelto primero en el array y primero por id: "elegir por
  permiso", "elegir el primero" y "elegir por id" coincidían. La 2ª agregó un método sin
  vuelto delante… pero con **solo dos pagos el ganador es a la vez el último, el de id
  mayor y el de monto mayor**, así que seguía sin descartar esas tres. Lo cazó la
  revisión independiente, no yo. La versión final usa **tres** pagos con el efectivo en
  el medio en posición, id y monto; se verificó contra cuatro implementaciones erróneas
  (primero, último, mayor monto, id mayor) y las cuatro lo hacen fallar.
- [x] ~~**La nota de crédito sobre `pagada_parcial` no se prueba nunca en éxito**~~ —
  cerrado 2026-07-27: camino feliz sobre `pagada_parcial`, no solo su ausencia de la
  lista de rechazo.

Los cuatro se validaron con mutantes sobre el código de producción: borrar cada guard o
sacar `pagada_parcial` de la whitelist hace fallar exactamente el test que lo cubre.

### Decidido por el owner tras investigación de mercado (2026-07-27)

Salieron de la auditoría como reglas de negocio no documentadas. Se corrió una pasada de
investigación y el owner las decidió. Método, cruce contra el código y fuentes:
**`docs/agent/investigaciones/2026-07-27-anulacion-y-notas-credito.md`**. La cuarta
—devolución por medio de pago y plazos— sigue abierta en
[`pendientes.md`](pendientes.md).

- [x] ~~**Acotar el dinero devuelto por una NC a lo cobrado EN EFECTIVO en esa venta**~~ —
  cerrado 2026-07-27. El tope es `Σ(efectivo aplicado a la venta) − Σ(ya devuelto en
  efectivo)`; excederlo da 422. Acota el **dinero, no el documento**: la NC sigue
  emitiéndose por el total (regla dura del SII). La pata de tarjeta ya existe en
  `pasarela` y no pasa por acá — componer ambas es el tema que sigue abierto en
  [`pendientes.md`](pendientes.md).
- [x] ~~**Implementar `cancelada` en su subconjunto seguro**~~ — cerrado 2026-07-27:
  `POST /ventas/:id/anular` con permiso propio `Ventas/Anular`, motivo obligatorio (10
  caracteres) y auditoría (`cancelada_el`, `cancelada_por_usuario_id`,
  `motivo_cancelacion`). Repone stock por default con motivo **`anulacion`** —distinto de
  `devolucion`— y admite `reponerStock: false` para mercadería no vendible. Reponer exige
  `modo_inventario='cantidad'` en todas las líneas: serie y lote se rechazan con el mismo
  mensaje que la devolución de una NC. No se modeló el plazo de 6 meses de la Ley 21.398
  (infraestructura DTE especulativa, prohibida por ADR-010).
- [x] ~~**Sacar `borrador` del enum y de la doc**~~ — cerrado 2026-07-27: fuera del enum
  de TypeScript, del tipo `estado_venta` de Postgres, de los mapas de color/etiqueta y del
  filtro del frontend, y de `ventas.md`/`PRODUCTO.md`. Si algún día hace falta parquear un
  ticket en **mostrador** (fuera de salones), se diseña ahí — nadie lo pidió.

---

## Auditoría `caja` + `propinas` (2026-07-27)

Pasada de 8 lentes según [`auditoria-codigo.md`](auditoria-codigo.md). 25 hallazgos crudos →
22 únicos (3 los vieron dos lentes por separado) → **20 sobreviven** tras refutación: 19
defectos y 1 decisión de owner (al final). **Ninguno se corrigió en la pasada**: la
auditoría produce información, no diffs. Orden = severidad.

### Alta

- [x] ~~**`POST /caja/:id/cerrar` con `lineas: []` cierra una caja descuadrada sin
  justificar**~~ — cerrado 2026-07-27: `aplicarMotivosADescuadres` ahora **recorre las filas
  descuadradas de `caja_arqueo_medio`**, no `dto.lineas`; una línea que descuadra y que el
  payload omite cae en el mismo 400 (y con el mismo mensaje) que una que llega vacía. Las
  que cuadran se siguen ignorando, así que un cierre sin descuadres sigue aceptando
  `lineas: []` — hay un test por cada lado, para que "arreglarlo" exigiendo siempre un array
  no vacío también falle. Cubierto por unit (línea omitida, y dos descuadres con una sola
  justificada) y por un e2e real contra la BD. El override admin
  (`PATCH /:id/arqueo/motivos`) comparte el helper y hereda la misma completitud, que es lo
  que ya prometía su docblock.
- [x] ~~**`GET /caja/cajones-estado` revela el esperado de una caja abierta en modo
  ciego**~~ — cerrado 2026-07-27: `cajonesEstado` recibe `esAdmin` y retiene
  `saldoEsperado: null` con la misma regla que los otros tres caminos
  (`!esAdmin && arqueoCiego && estado === 'abierta'`); en `en_conciliacion` revela, porque
  el conteo ya se congeló. `saldoInicial` sigue visible: no es secreto, lo declaró el propio
  cajero al abrir. El front muestra "—". Seis mutantes verificados (quitar cada una de las
  tres condiciones, retener siempre, revelar siempre, y que el controller no pase `esAdmin`)
  y cada uno mata exactamente el test que le toca.
  ⚠️ **Sin cobertura e2e a propósito**: el caso que importa es un supervisor con `Cajas:Leer`
  que **no** sea admin, y ese usuario no existía en el seed. Hoy lo cubren el unit del
  service y el del controller.
  ✅ **Cerrado el 2026-07-28**: el usuario existe (`supervisor@paris.cl`) y el e2e ejerce el
  caso — ver la entrada de Limpiezas menores en este mismo archivo.
- [x] ~~**Un monto manual de propina se aplica en cualquier criterio y no conserva el total
  del grupo**~~ — cerrado 2026-07-27: `validarManualMontos` pasó a ser
  `validarConservacionPorGrupo` y corre sobre **todos** los criterios, no solo
  `MANUAL`+`MONTOS`. Al confirmar, lo repartido en cada grupo tiene que dar exactamente su
  `montoGrupo`; el 400 nombra el grupo y los dos números. **No prohíbe el ajuste manual**:
  exige que la plata cuadre, así que un ajuste compensado entre dos personas del mismo grupo
  se confirma sin problema (hay un test por cada lado). El mutante que devuelve el `continue`
  para los grupos no-`MANUAL` mata el test.
- [x] ~~**Anular una venta no reconcilia `venta_propina`: la propina se paga igual**~~ —
  cerrado 2026-07-27 **en su mitad**: `buscarTipsElegibles` ahora filtra
  `v.estado <> 'cancelada'`, así que la propina de una venta anulada no entra nunca a una
  liquidación nueva. Cubierto por e2e real: se crea la venta con propina, se verifica que el
  pool sube (control, si no el test pasaría aunque nunca hubiera entrado), se anula y se
  verifica que el pool vuelve al valor previo.
  ⚠️ **La otra mitad quedó abierta y decidida** — el saldo en contra por una propina ya
  liquidada, en [`pendientes.md`](pendientes.md).

### Media

- [x] ~~**`garzonId` de participante manual no se resuelve contra el tenant**~~ — cerrado
  2026-07-27: el alta manual (`aplicarCambioParticipante`) y los pesos manuales de la config
  (`propina-distribucion.service.ts`) resuelven el garzón con
  `GarzonesService.obtenerActivoPorId(tenantId, garzonId)` antes de persistir — el mismo
  guard que ya usaba el cierre de mesa en ventas. `PropinasModule` importa ahora
  `GarzonesModule` (sin ciclo: no importa nada y ya lo usaban otros cuatro módulos).
  Detalle original: (backend,
  `propinas/liquidacion-propinas.service.ts:980`, `propinas/propina-distribucion.service.ts:193`)
  — se inserta `garzonId: cambio.garzonId` sin validar; el DTO solo pide `@IsUUID()`. Las
  entidades no tienen FK a `garzones`, así que tampoco hay backstop de integridad. El caso
  más probable no es el cross-tenant sino un **uuid inexistente**: entra como participante
  fantasma con `incluido: true` y diluye el reparto de todos. La defensa correcta ya existe:
  `GarzonesService.obtenerActivoPorId(tenantId, garzonId)`, del fix de ventas de jul-2026.
- [x] ~~**Excluir a un participante le deja el `monto` viejo persistido**~~ — cerrado
  2026-07-27: `redistribuirGrupo` devuelve los omitidos con `monto: '0.0000'` y
  `recalcularParticipantesExistentes` los persiste junto con los activos. Detalle original:
  (backend,
  `propinas/liquidacion-propinas.service.ts:996-1009` y `:1026`) — `redistribuirGrupo`
  devuelve `omitidos` sin tocar `monto` y `recalcularParticipantesExistentes` solo re-guarda
  `activos`. Hoy no paga de más (reportes e impresión filtran `incluido = true`), pero el
  dato en reposo miente; y si se excluye a **todos** los de un grupo, el `montoGrupo` no
  queda en ninguna fila con `incluido = true` y desaparece sin que nada lo señale.
- [x] ~~**Dos cajas abiertas del mismo usuario bajo concurrencia**~~ — cerrado 2026-07-27
  con el índice único parcial `ux_cajas_activa_por_usuario` sobre `(tenant_id, usuario_id)`
  con `WHERE tipo='fisica' AND estado IN ('abierta','en_conciliacion')`, declarado en la
  **entidad** (que es lo que `synchronize` crea de verdad) y replicado en `startup-pos.sql`.
  Incluye `en_conciliacion`, así que también cubre el hueco que el comentario del índice de
  cajón dejaba explícitamente a cargo del service. El `catch` del 23505 ahora distingue por
  `constraint` y devuelve el mensaje que corresponde: "ya tenés una caja" y "el cajón está
  ocupado" mandan al usuario a hacer cosas distintas.
  Tests: un e2e que assevera que el índice **existe con su forma** (leyendo `pg_indexes`;
  borrarlo del entity lo hace fallar) y un unit parametrizado del mapeo de cada constraint a
  su mensaje.
- [x] ~~**"Diferencia" significa dos números distintos según la pantalla**~~ — cerrado
  2026-07-27: el listado del historial emite `diferenciaTotal`, la suma de **todas** las
  líneas del arqueo congelado, y la columna pasa a mostrar ese campo. `cajas.diferencia` se
  queda como está —es deliberadamente el cuadre del **cajón físico**— y ahora ambos campos
  dicen en el tipo cuál es cuál. El total sale por `LEFT JOIN LATERAL` con un `SUM` en la
  **misma** query del listado: una sola consulta para todas las filas, sin N+1 y sin agrupar
  por las 13 columnas. Una caja abierta todavía no tiene arqueo congelado → `null` → "—".
  El e2e cierra una caja con el efectivo cuadrado y -500 en tarjeta y verifica los dos
  campos por separado (`diferencia` = 0, `diferenciaTotal` = -500), que es exactamente el
  caso que el historial mostraba como "+0".
- [x] ~~**`etiquetasGarzones` no filtra `eliminado_el IS NULL`**~~ — cerrado 2026-07-27
  agregando el filtro, que es lo que manda la invariante de soft delete y lo que hacían ya
  sus tres queries hermanas del mismo archivo. El fallback `'Trabajador eliminado'` deja de
  ser código muerto y el test lo ejerce. Detalle original: (backend,
  `propinas/propina-reportes.service.ts:643-651`) — contra la invariante de soft delete y
  contra sus tres queries hermanas del mismo archivo, que sí filtran. La prueba de la
  intención: deja **inalcanzable** el fallback `'Trabajador eliminado'` (`:203`). **Al
  cerrarlo hay una decisión chica:** filtrar (y el fallback revive) **o** documentar la
  excepción deliberada, como ya se hizo con `metodos_pago` en `caja/caja.service.ts:322`,
  donde el nombre histórico es intrínseco al movimiento.
- [x] ~~**Un garzón en dos grupos revienta la liquidación con un 23505 crudo**~~ — cerrado
  2026-07-27 **con la salida acotada que decidió el owner**: no se cambió el modelo, se
  cambió el crash por un 400 accionable. `assertGarzonEnUnSoloGrupo` corre en los **cuatro**
  puntos de entrada; en crear, liquidar y **el preview** corta antes de escribir nada (así
  que se ve antes de intentar liquidar), y en `actualizarConfig` corre después de rehacer el
  snapshot, dentro de la misma transacción que revierte. El mensaje nombra a la persona, sus dos grupos, y
  la fecha de corte sugerida —el primer tip del rol que arrancó después—, de modo que
  liquidar hasta ahí deja cada rol en su propia liquidación sin tocar la configuración.
  ⚠️ **Queda abierto el cambio de modelo** (que la persona cobre en los dos grupos): es
  índice `(liquidacion_id, grupo_id, garzon_id)` **más** re-keyear los ajustes, que hoy se
  identifican solo por `garzonId` —excluir la sacaría de los dos grupos y un monto manual
  escribiría el mismo número en sus dos filas, rompiendo la conservación de ambos—. Toca
  DTO, service, composable, la página y la impresión por persona: medio día a un día, con
  la decisión de cómo se imprime adentro. Se encara si el caso aparece de verdad.
  ⚠️ **Dos precisiones que dejó la revisión independiente:** la fecha de corte sale solo de
  los tips, así que si la persona tiene una sesión del primer rol que se extiende más allá
  del corte, el conflicto reaparece en el segundo intento (vuelve a cortar con el mismo 400,
  no genera datos malos, pero un solo corte no alcanza y hay que acotar turnos). Y falta un
  test dedicado del conflicto por el camino de `actualizarConfig`: hoy solo se ejerce por
  `crear`, aunque ambos comparten la misma función.
  Detalle original: (backend + BD,
  `startup-pos.sql:1606`, `propinas/liquidacion-propinas.service.ts:1216-1236`) —
  `uq_liquidacion_propinas_participante_garzon` es único por `(liquidacion_id, garzon_id)`,
  **sin `grupo_id`**, y `buildParticipantesData` itera por grupo sin deduplicar. Un garzón
  reclasificado a mitad de período (`UpdateGarzonDto.tipo` es editable) genera tips con dos
  `tipo_garzon`, la liquidación arma dos participantes con el mismo `garzonId`, el segundo
  `INSERT` viola el índice y **nadie del período puede liquidarse**. Tensión con la doc: el
  motor documenta la pertenencia por el snapshot `tipo_garzon` del tip y no por
  `garzon.tipo`, lo que hace el caso alcanzable por diseño; el esquema no lo soporta.


### Baja

- [x] ~~**`registrarMovimientoEnTransaccion` no valida signo ni estado de la caja**~~ —
  cerrado 2026-07-27 en el eje del signo, con **dos** capas: el helper rechaza negativos con
  422, y `movimientos_caja` gana un `CHECK ("monto" >= 0)` declarado en la entidad (lo que
  `synchronize` crea) y replicado en el `.sql`. Ese CHECK cubre cualquier camino, presente o
  futuro, sin depender de que alguien se acuerde del guard.
  ⚠️ **Es `>= 0`, no `> 0`, y el primer intento fue `> 0`.** La revisión independiente lo
  bloqueó reproduciendo contra el backend real una venta legítima que devolvía 422: cuando
  un pago se devuelve **íntegro** como vuelto, su `montoNeto = monto − vuelto` da 0
  (`pagos.service.ts`), y el guard tumbaba la venta entera. El movimiento en cero no altera
  el esperado del arqueo y conserva la traza del pago. Hay un e2e con dos pagos en efectivo
  —uno devuelto entero— que lo fija, y el unit acepta 0 explícitamente.
  **Lección:** endurecer un límite exige enumerar quién lo produce hoy, no suponerlo. Mi
  texto original afirmaba que ningún caller producía `<= 0`: era cierto para negativos y
  falso para el cero, justo el vecino del bug que este mismo hilo venía a cerrar.
  El eje del **estado** queda como está a propósito: el patrón del módulo es "el caller toma
  `bloquearCajaAbierta` y el helper confía", y re-chequear acá sería una query extra por
  venta duplicando el lock que el llamador ya tiene. Detalle original: (backend,
  `caja/caja.service.ts:785-809`) — recibe un objeto plano y lo inserta tal cual: sin
  `@IsDecimalPositivo` (que solo cubre el camino HTTP vía `CrearMovimientoDto`) y sin
  verificar el estado. `startup-pos.sql:886` tampoco tiene `CHECK` sobre `monto`. Hoy **no
  es explotable**: sus dos llamadores (`ventas.service.ts`, `pagos.service.ts`) toman
  `bloquearCajaAbierta` antes y ya no producen montos negativos desde el fix del vuelto. Es
  endurecimiento del chokepoint por donde entró ese bug, no un bug activo. Cierra el hilo
  que la auditoría de ventas mandó acá: defendido en el endpoint, no en el método compartido.
- [x] ~~**`asegurarDefault` de propinas devuelve 500 en el primer uso concurrente**~~ —
  cerrado 2026-07-27: el 23505 se atrapa y se relee la config que ganó la carrera; cualquier
  otro error se propaga (hay un test por cada lado). Mismo patrón que `caja.abrir()`.
  Detalle original: (backend,
  `propinas/propina-distribucion.service.ts:68`) — el `lock: pessimistic_write` sobre una
  fila que **todavía no existe** no bloquea nada; dos requests insertan y el segundo viola
  `uq_propina_config_tenant` (`startup-pos.sql:1457`) sin `catch`. No corrompe (el índice
  hace su trabajo) y se cura tras el primer insert. El patrón correcto está tres módulos más
  allá, en `caja/caja.service.ts:241`.
- [x] ~~**El monto manual de propina no valida signo en el DTO**~~ — cerrado 2026-07-27:
  los dos campos usan `@IsDecimalNoNegativo()`, así que el negativo se rechaza con 400 en
  vez de llegar al `CHECK` de BD como 500 — y el **preview**, que no persiste y por eso no
  tocaba ese CHECK, deja de devolver una propina negativa. Detalle original: (backend,
  `propinas/dto/ajustes-reparto.dto.ts:14`, `propinas/dto/update-liquidacion.dto.ts:34`) —
  `@IsNumberString()` a secas acepta `'-5000'`; son los dos campos que quedaron fuera del
  barrido de signo de `74f3f35`. **No llega a persistir**: `chk_liquidacion_participante_metricas`
  (`startup-pos.sql:1595`) exige `monto >= 0`. Queda un 500 crudo donde correspondía un 400,
  y el **preview** (que no persiste) devolviendo una propina negativa en pantalla.
- [x] ~~**`crearFuentes` inserta fila por fila sobre un conjunto sin tope**~~ — cerrado
  2026-07-27 con un solo `save` del array. **Verificado empíricamente, como pedía esta
  entrada**: con `log_statement='all'` en Postgres, la suite e2e de propinas produce **dos**
  sentencias `INSERT INTO liquidacion_propinas_fuente` —una de 12 filas y otra de 3—, o sea
  un INSERT multi-fila por liquidación y no uno por tip. El test lo fija asserteando que
  hubo un único `save` y que recibió un array. Detalle original: (backend,
  `propinas/liquidacion-propinas.service.ts:1187-1195`) — dentro de la transacción de
  `liquidar()`, y `buscarTipsElegibles` no tiene `LIMIT`, así que N = ventas con propina del
  período. Al cerrarlo, **verificar de verdad** que `save(array)` colapsa a un INSERT
  multi-fila y no a N inserts igual.

### Huecos de test (el gate verde no los ve)

- [x] ~~**Eliminar la rama muerta `MANUAL`+`MONTOS` de `repartirGrupo`**~~ (backend,
  `propinas/liquidacion-propinas.service.ts`) — cerrado 2026-07-29: se borró. Los dos
  caminos se **verificaron leyendo el código antes de tocarlo**, no se tomaron de esta
  entrada: `redistribuirGrupo:1069` chequea el par por su cuenta y se queda con `delGrupo`
  sin llamar a `repartirGrupo`; y por `buildParticipantesData:1458` los borradores entran
  con `monto: '0.0000'` (fijado en `crearParticipanteData:1611`), así que devolverlos tal
  cual daba lo mismo que el camino normal —`pesoParticipante` no puntúa ese par, `sumaPesos`
  queda en 0 y el retorno temprano produce el mismo `'0.0000'`—.
  **Sin test, a propósito y documentado en el código:** la rama era inobservable, así que
  ningún test podía discriminarla; lo que sostiene el cambio son las 76 pruebas de
  `propinas` en verde y un comentario en el lugar donde estaba, para que no la reintroduzca
  quien lea el `if` de `redistribuirGrupo` y lo crea faltante acá.

- [x] ~~**El guard de estado de la caja no lo ejercita ningún test real**~~ — cerrado
  2026-07-27 con tres e2e: una caja **cerrada** y una **en conciliación** rechazan el
  movimiento, y una nota de crédito con devolución no puede sacar plata de una caja en
  conciliación.
  ⚠️ **El detalle que importa:** `registrarMovimiento` chequea el estado **dos veces** (el
  lock y un `findOne` posterior), así que relajar solo `bloquearCajaAbierta` queda tapado
  por el otro — lo comprobé y el mutante sobrevivía. El camino de la **nota de crédito** es
  donde ese lock está solo, y ahí el mutante de una sola capa sí mata el test. Es defensa en
  profundidad real, no debilidad del test, pero conviene saber cuál es el que discrimina.
  Detalle original: (test,
  `caja/caja.service.spec.ts:209`, `:460`, `:827`) — los tres mockean
  `managerMock.query.mockResolvedValueOnce([])` sin relación con el SQL emitido: el
  resultado lo decide el mock, no el `WHERE estado='abierta'`. Y `test/caja.e2e-spec.ts`
  nunca intenta escribir contra una caja `cerrada`/`en_conciliacion`. Relajar el filtro a
  `estado IN ('abierta','en_conciliacion')` no rompe nada. Es justamente la defensa que dos
  lentes dieron por buena leyendo el código.
- [x] ~~**El criterio `MANUAL` (`PESOS` y `MONTOS`) no tiene ningún test de reparto**~~ —
  cerrado 2026-07-27: `MANUAL/PESOS` reparte 3:1 por el peso configurado, y `MANUAL/MONTOS`
  se cubre por donde de verdad importa —**recalcular** una liquidación existente no pisa los
  montos fijados a mano—, no por el preview, donde los ajustes escriben el monto **después**
  del reparto y la rama es irrelevante.
  ⚠️ **La rama `MANUAL+MONTOS` de `repartirGrupo` es código muerto CONFIRMADO, y sigue sin
  test que la discrimine** — a propósito, porque no se puede escribir uno honesto. Está
  muerta por dos caminos: `redistribuirGrupo` tiene su **propio** chequeo de
  `MANUAL+MONTOS` que la saltea antes de llegar, y el único call site que sí la alcanza
  (`buildParticipantesData`) produce el mismo `'0.0000'` que daría el retorno temprano de
  "suma de pesos cero". Borrarla no cambia ningún resultado observable.
  Escribí un test que decía cubrirla y **no la cubría**: pasaba por el mecanismo genérico de
  `ajustes.montosManuales`, que pisa el monto para cualquier criterio después del reparto.
  Lo saqué en vez de dejarlo dando una falsa sensación de cobertura. **Cierre correcto:**
  eliminar la rama, no testearla. Detalle original: (test) —
  el único `criterio` ejercido en `liquidacion-propinas.service.spec.ts` y en el e2e es
  `PARTES_IGUALES`/`VENTAS_NETAS`. `validarManualMontos` se puede borrar entera sin que
  falle nada. (`propina-distribucion.service.spec.ts` sí prueba `MANUAL`, pero solo a nivel
  **config**, no de reparto.)
- [x] ~~**El test de partes iguales no discrimina `PARTES_IGUALES` de `CANTIDAD_CUENTAS`**~~
  — cerrado 2026-07-27 con un fixture **asimétrico** (un garzón cierra dos cuentas y el otro
  una), que es lo que separa las dos fórmulas: 75/75 contra 100/50. Tres mutantes cruzados
  verificados —que partes iguales devuelva cuentas, que cuentas devuelva 1, y que el peso
  manual se ignore— y cada uno mata su propio test. Detalle original:
  (test, `propinas/liquidacion-propinas.service.spec.ts:151-186`) — el fixture da
  exactamente 1 tip a cada garzón, así que `cuentas = 1` para ambos y las dos fórmulas dan
  `75.0000`/`75.0000`. `CANTIDAD_CUENTAS` no aparece en ningún test. Es el mismo error del
  test del vuelto (ver [`anti-patterns.md`](anti-patterns.md)): el escenario tiene que
  descartar las implementaciones incorrectas, no coincidir con ellas.
- [x] ~~**`actualizarConfig` no assertea `result.participantes`**~~ — cerrado 2026-07-27
  junto con el fix de conservación: su fixture tenía pool 150 y **cero tips**, un estado
  imposible, y ahora ejerce el reparto de verdad (VENTAS_NETAS sobre bases 1000 y 500 → 100
  y 50; con el criterio viejo daría 75/75). Detalle original: (test,
  `propinas/liquidacion-propinas.service.spec.ts:348-389`) — si `crearParticipantes`
  devolviera siempre `[]` el test sigue verde, porque el fixture monta `tips = []`.
- [x] ~~**El e2e de historial por `cajonId` no discrimina**~~ — cerrado 2026-07-27: ahora
  abre la caja el **cajero** y consulta el **supervisor**, que es para lo que existe la rama
  `cajonId && tieneVerTodas`. Antes consultaba el mismo usuario que había abierto, así que
  el filtro "solo mis cajas" daba idéntico resultado y borrar la rama no rompía nada.
  Detalle original: (test,
  `test/caja.e2e-spec.ts:331-339`) — quien consulta es el mismo usuario que abrió la caja,
  así que borrar la rama `cajonId && tieneVerTodas` (`caja/caja.service.ts:949`) sigue dando
  200 con array no vacío. Solo assertea `status` y `Array.isArray`.

### Decidido por el owner (2026-07-27)

- [x] ~~**Un grupo sin peso agregado aborta la liquidación entera**~~ — cerrado 2026-07-27.
  **Decisión del owner: el pool se reparte siempre entero.** Un grupo del que nadie puede
  cobrar no reserva su porcentaje; su parte se redistribuye entre los que sí pueden. Al
  implementarlo apareció que la misma situación tenía **dos comportamientos opuestos** según
  hubiera o no una fila de sesión: con participantes en peso 0 reventaba la liquidación
  entera, y con cero participantes el `montoGrupo` **desaparecía en silencio** (la suma
  repartida daba menos que el pool). Ahora `montosPorGrupo` reparte solo entre los grupos
  elegibles y `repartirGrupo` deja en 0 a los que no pueden, sin lanzar. Si **ningún** grupo
  puede recibir y hay pool, corta con un 400 que dice qué revisar; un período sin propinas
  sigue siendo válido con todos en cero. Regla escrita en
  [`liquidacion-propinas-motor.md`](../features/liquidacion-propinas-motor.md).

### Refutados (no entran)

Hallazgos que **no** sobrevivieron a la refutación. Se conservan para que la próxima
pasada no los vuelva a reportar como nuevos.

- **Tres "N+1" de escritura** (`liquidacion-propinas.service.ts:1026`, `:365-374`, `:961`),
  uno reportado como alta — no son el N+1 que prohíbe la invariante, que habla del **dato
  derivado por fila en una lectura**. Escribir N filas con valores distintos exige N
  `UPDATE`, y `save(array)` no los colapsa. Queda el punto real (tiempo con el lock tomado),
  pero eso es contención, no N+1, y hoy no tiene escenario de daño.
- **`UPDATE` de `anular()` sin `eliminado_el IS NULL` sobre `venta_propina`** — no existe
  ningún `softDelete` sobre esa tabla, así que no hay fila borrada que tocar. Sin escenario
  reproducible no entra.
- **`porcentaje` de grupo sin validar signo** — un grupo negativo compensado por otro >100%
  pasa la config, pero falla en el reparto antes de persistir dinero. Guard tardío, no
  dinero mal calculado.

---

## Refactor Caja → "Mi caja" / "Cajas"

Sub-proyectos entregados del brainstorm del 2026-07-23. Los poderes del encargado que
siguen diferidos están en `pendientes.md`.

- [x] **Refactor de IA/permisos — HECHO** (2026-07-23) — módulo `Caja` renombrado a
  `MiCaja` (mismo id, `Leer`/`Crear`/`Actualizar`/`Eliminar`); módulo nuevo `Cajas`
  (solo `Leer`); `Ver todas` dejó de asociarse a caja; guards remapeados por endpoint en
  `caja.controller.ts` (mismo controller/service, rutas `/caja/*` sin cambio); dos
  superficies frontend `/mi-caja*` y `/cajas*` (`/caja` redirige a `/mi-caja`);
  escrituras siguen owner-only aun con `Cajas:Leer`. Detalle:
  [`docs/features/gestion-cajas.md`](../features/gestion-cajas.md#modelo-de-acceso-por-permiso).
- [x] **Sub-proyecto A — Arqueo de caja multi-medio — HECHO** (2026-07-24) — resuelve el
  §3 de la investigación (faltante fantasma / esperado mezclado): el cierre pasa de un
  número a una línea esperado-vs-contado por método (`es_efectivo` global +
  `requiere_conteo` por tenant, tabla `caja_arqueo_medio` congelada, `GET
  /caja/:id/arqueo`, `POST /caja/:id/cerrar` multi-línea). Detalle:
  [`docs/features/gestion-cajas.md`](../features/gestion-cajas.md#arqueo-de-caja-multi-medio-sub-proyecto-de-negocio-a-post-estructura).
- [x] **Sub-proyecto B — Cierre ciego — HECHO** (2026-07-24) — resuelve la mitad barata de
  §5/§6 de la investigación (blind count): config por tenant `tenants.arqueo_ciego`
  (default `false`, `GET`/`PUT /caja/arqueo-ciego` con `Cajas:Leer`/`Actualizar`); en modo
  ciego + caja abierta `GET /caja/:id/arqueo` retiene `esperado:null` y filtra a solo
  líneas obligatorias (nadie ve el esperado de una caja abierta, ni dueño ni supervisor);
  respuesta cambia de `LineaArqueo[]` a `{ ciego, lineas }`; caja cerrada siempre revela;
  `cerrar` sin cambios (su respuesta es la revelación); drawer ciego revela por
  redirección al detalle. Detalle:
  [`docs/features/gestion-cajas.md`](../features/gestion-cajas.md#cierre-ciego-modo-anti-fraude).
  "Ocultar el resultado post-cierre" **sigue** diferido incluso después del sub-proyecto C
  (ver [investigación
  §6](investigaciones/2026-07-23-gestion-caja.md#6-poderes-del-encargado-sobre-la-caja-del-cajero-investigación-2026-07-23)),
  en [`pendientes.md`](pendientes.md).
- [x] **Sub-proyecto C — Cierre en dos fases + motivos de diferencia — HECHO** (2026-07-24)
  — resuelve la conciliación operador→supervisor de §6 y los motivos categorizados de §5:
  fase 1 `POST /caja/:id/conteo` congela el arqueo server-side (inmutable desde ahí) y
  bifurca a auto-cierre (todo cuadró) o `estado='en_conciliacion'` (algún descuadre); fase
  2 `POST /caja/:id/cerrar` (owner-**o**-admin, única escritura no estrictamente
  owner-only del controller) exige un motivo categorizado — o comentario si el tenant no
  tiene motivos activos (red de seguridad) — por línea descuadrada y finaliza sin
  recalcular nada; `en_conciliacion` ocupa igual que `abierta` (bloquea abrir otra caja, el
  cajón, ventas y movimientos); catálogo `motivo_diferencia_caja` admin-only (mismo patrón
  que `causas_merma`); override admin `PATCH /caja/:id/arqueo/motivos` corrige motivos de
  una caja ya cerrada. **No** es el cierre forzado de §6 (el admin solo *finaliza* una
  conciliación que el dueño ya congeló, nunca inicia el conteo de una caja ajena) — ese
  ítem sigue diferido en [`pendientes.md`](pendientes.md). Detalle:
  [`docs/features/gestion-cajas.md` § Cierre en dos fases](../features/gestion-cajas.md#cierre-en-dos-fases--motivos-de-diferencia-sub-proyecto-c).

## Auditoría `items` + `calculo-precios` (2026-07-28)

### Alta

- [x] ~~**Los grupos de un componente-combo se descuentan aunque el componente se haya
  omitido por falta de stock**~~ — cerrado 2026-07-28 (`items.service.ts`). Si un componente
  `receta` no bloqueante no alcanzaba el stock, el pre-chequeo hacía `continue` y lograba
  "cero escrituras" por él, pero después del loop `gruposComponentes` se armaba con **todo**
  `snapshot.componentes`: el combo se vendía sin la hamburguesa y la chuleta elegida para
  esa hamburguesa se descontaba igual. Ahora los componentes omitidos se registran en un
  `Set` y se filtran antes de llamar a `venderOpcionesGrupos`. **La regla la fijó el owner**
  ("se descuenta lo que se sirvió"), y el fix no la inventa: hace consistente una decisión
  que el código ya tomaba dos líneas antes. Cubierto por
  *"componente omitido por falta de stock → tampoco descuenta sus grupos de modificadores"*;
  mutante verificado (sin el filtro, `venderOpcionesGrupos` se llama 2 veces en vez de 1).
- [x] ~~**Vender un extra cuyo catálogo cambió tras congelar el snapshot descuenta 1000× de
  más**~~ — cerrado 2026-07-28 (`items.service.ts`). El fallback
  `cat?.ingredienteUnidadMedida ?? extra.unidadCodigo` sustituía la unidad **de stock** por
  la de la **porción** cuando el extra ya no estaba en `receta_extras_permitidos`, y
  `convertirUnidad` terminaba convirtiendo una unidad a sí misma: 20 g de queso descontados
  como 20 kg. La unidad de stock ahora se resuelve por id contra `items`+`item_producto`,
  que es donde vive, en vez de contra la lista de extras de la receta — eso saca la causa,
  no el síntoma. Si el ingrediente ya no existe en el catálogo, **no se descuenta y se
  advierte** — no se mueve stock de un ítem borrado, mismo criterio que ya usaba
  `venderOpcionesGrupos` con una opción borrada, más la advertencia que aquel no emite.
  **Lo que cubre cada test, sin inflar el recibo** (corregido por la revisión independiente,
  que refutó la primera versión de este párrafo): los **dos unit** son los que discriminan
  fix de pre-fix — uno fija que la búsqueda va por id de ingrediente y tenant en vez de por
  la receta, el otro cubre la rama del ingrediente ausente; los dos con mutante verificado.
  El **e2e nuevo** (`recetas.e2e-spec.ts` §7) **no** distingue el fix del código anterior:
  su extra sigue en la carta, así que la búsqueda vieja también encontraba `kg` y el
  resultado era idéntico. Lo que aporta es real pero es otra cosa: ejecuta el SQL nuevo
  contra Postgres —ningún e2e tocaba `extras`, así que la query no se había ejecutado nunca—
  y deja fija la conversión g→kg.
  **Y el escenario del hallazgo original no es alcanzable hoy.** La auditoría supuso que el
  flujo de Salones cobraba con el snapshot congelado; no lo hace: `cerrarCuenta`
  (`salones.service.ts:653-720`) lo mapea de vuelta a **solo ids** y `ventas.service.ts`
  lo **re-resuelve** contra el catálogo vivo en la misma transacción que descuenta, así que
  un extra fuera de carta muere en el mismo `400` que por `POST /ventas`
  (`items.service.ts:1937`). O sea que este fix es **corrección y defensa en profundidad**,
  no el cierre de un agujero explotable.
  **La invariante que en realidad sostiene esto —y que no estaba escrita en ningún lado—**
  es que *todo snapshot se re-resuelve en la misma transacción que descuenta stock*. El día
  que alguien persista un snapshot y lo reutilice sin re-resolver (que es, conceptualmente,
  para lo que un snapshot existe), este bug y su hermano del combo se vuelven reales. Queda
  registrada acá porque es el supuesto del que cuelgan los dos fixes.

### Alta (continuación)

- [x] ~~**El motor de precios resuelve cada línea con el `findOne` pesado**~~ — cerrado
  2026-07-28. Era el hilo que la pasada de `ventas` dejó anotado, y sobrevivía **del lado
  del precio**: `cargarBasePorIds` había resuelto la persistencia de la venta, no el
  cálculo. Cierre: `ItemsService.cargarReglasPorIds` —una query con `UNION ALL` sobre las
  tres tablas puente— acompaña a `cargarBasePorIds`, y `calcular()` carga el carrito
  entero en **2 queries fijas** antes del loop en vez de 4+ por línea. `resolverLinea`
  dejó de ser `async`: ya no hace I/O. Beneficia **en la capa de precio** a los tres
  llamadores (`ventas`, `suscripciones`, `online`) — pero no cierra el request entero:
  el checkout online sigue con su propio `findOne` por línea antes de llamar al motor,
  anotado como entrada propia en [`pendientes.md`](pendientes.md) para no perderle el
  rastro al cerrar esta.
  **Lo que hizo falta decidir y no se decidió acá:** el orden de las reglas cambia el total
  en modo `compuesto`, y no estaba definido en ninguna query. El `ORDER BY` nuevo lo vuelve
  determinista por id; qué orden *debería* tener quedó abierto como decisión de negocio en
  [`pendientes.md`](pendientes.md), con el insumo de mercado que aportó el owner.
  ⚠️ **Corregido por la revisión independiente, que bloqueó el cierre:** la primera versión
  de este párrafo afirmaba que el `ORDER BY` *reproducía* el orden previo y que por lo tanto
  batchear no podía mover ningún total. **Es falso, y se verificó con `EXPLAIN`:** estas
  tablas resuelven con `Bitmap Heap Scan`, que reordena por página del heap, así que las
  queries por ítem devolvían orden de **inserción**, no de índice. El cambio sí puede dar un
  total distinto en un tenant `compuesto` que mezcle `monto_fijo` con porcentaje en un mismo
  ítem. Que hoy no exista ninguno (ambos tenants del seed en `base`, ningún ítem con dos
  reglas de la misma clase, sin datos productivos) es lo que lo vuelve inocuo — **no** la
  garantía que se había escrito. La lección es la misma de
  [`anti-patterns.md`](anti-patterns.md): una afirmación deducida ("la PK es compuesta,
  luego el orden es el del índice") no es una afirmación verificada.
  **Tests, con mutante verificado cada uno:** uno fija que N líneas producen un número
  **constante** de cargas (el mutante que vuelve a cargar por línea lo mata), otro cubre el
  agrupado de las tres clases en `cargarReglasPorIds`. Y se comprobó **empíricamente que el
  e2e ejecuta la query nueva**, en vez de asumirlo: con la clase de impuesto mal etiquetada,
  `ventas.e2e-spec.ts` pasa de 26 verdes a 15 fallos.
- [x] ~~**La resolución de recargos por id nunca corre con datos**~~ — cerrado 2026-07-28,
  junto con el batch de arriba. El fixture fijaba `recargosIds: []` en los 9 tests, así que
  un mutante que le pasara el mapa de descuentos sobrevivía. Al reescribir el fixture para
  los dos loaders nuevos, dejar la tercera lista sin ejercer habría repetido el mismo hueco
  sobre código recién escrito. Hay un test con un recargo real y el mutante muere. Queda
  abierta la mitad de `ventas.service.spec.ts` (otro archivo, otro alcance).
- [x] ~~**`online.service.ts` sigue con un `findOne` por línea en el checkout**~~ — cerrado
  2026-07-28, resto del N+1 del motor de precios. `prepararLineasCheckout` iteraba
  `dto.lineas` llamando al `findOne` pesado para leer **solo** `tipo` y `unidadMedida`;
  ahora una sola `cargarBasePorIds` para todo el carrito, que ya trae los dos campos y
  lanza el mismo 404. Las validaciones por línea (`assertPresentacionPareada`) se movieron
  **antes** de la carga, para no repetir el cambio de precedencia 400↔404 que la revisión
  independiente había marcado en el fix hermano.
  Lo fija un test con mutante verificado (volver a cargar por línea sube el contador de 1
  a 3). **Sin SQL nuevo**: reutiliza un método que el e2e de ventas ya ejecuta contra
  Postgres — distinto del caso de los extras, donde la query era nueva y hubo que probarla.
  ⚠️ **Hueco de cobertura preexistente, que este fix no cierra:** ningún e2e toca el
  checkout online. Lo cubierto acá es unit.

### Media / Baja — los tres N+1 restantes de la pasada

- [x] ~~**`findOne` de una receta con 5 grupos son 6 queries**~~ — cerrado 2026-07-28: los
  grupos del propio ítem salen de `cargarGruposPorItem`, la función batcheada que ya vivía
  en el mismo archivo y que `findOne` **ya usaba** para los componentes de un combo. 2
  queries fijas en vez de 1 + N, y ~60 líneas menos de duplicación. La discriminación quedó
  demostrada al revés y sirve igual: la aserción que fijaba los parámetros de la query por
  grupo (`['grupo-1', TENANT, 'item-grupo-1']`) **falló** contra la implementación nueva
  (`[['item-grupo-1'], TENANT]`). El test ahora fija esos params batcheados y el total de
  queries.
- [x] ~~**`aplicarDesfases`/`descartarDesfases` hacen 3-4 queries por receta**~~ — cerrado
  2026-07-28. Resultó **peor que lo reportado**: además de las 2 lecturas por receta, el
  costo propuesto llamaba `convertirUnidad` **una vez por ingrediente** — un N+1 anidado, y
  con `convertirUnidades` ya escrito al lado para exactamente esto. Ahora son 2 lecturas
  para todo el lote + 1 carga de unidades para todos los ingredientes de todas las recetas.
  **Beneficia también al camino de lectura**: `listarDesfases` compartía el mismo helper y
  tenía el mismo N+1 anidado. Los `UPDATE` siguen siendo N — son escrituras de N filas, no
  un N+1.
  **El loop por receta se conservó a propósito**, para que el orden en que fallan las
  validaciones no cambie: si la receta B no existe y la A no tiene ingredientes, sigue
  ganando el error de A. Es la precedencia 400↔404 que la revisión independiente ya había
  marcado dos veces ese día. ⚠️ **La primera versión no lo lograba y la revisión lo
  bloqueó:** el cálculo del costo corría *antes* del loop y **también lanza** (unidad no
  reconocida, magnitudes incompatibles), así que adelantaba ese 400 por encima del 404.
  Cerrado con `CatalogService.crearConversor()`: el catálogo se carga una vez —una lectura
  que no lanza— y la conversión vuelve a ocurrir dentro del loop, en su punto original.
  Mutante verificado: crear el conversor dentro del loop en vez de afuera sube
  `crearConversor` de 1 a N.
- [x] ~~**Las tres `validarY…` hacen un `SELECT` por fila del payload**~~ — cerrado
  2026-07-28 con `filasValidacionPorIds`: una query para todos los ids del payload,
  compartida por ingredientes, componentes y extras. Los tres loops quedan intactos, así que
  ninguna validación cambia de orden (la carga no lanza).
  ⚠️ **Lo que el fix destapó en los tests:** al pasar a un lookup por id, varios tests de
  **rechazo** empezaron a pasar por la razón equivocada — su fila mockeada no traía
  `item_id`, así que el lookup no la encontraba y el error saltaba antes de evaluar el tipo
  o el modo de inventario. Se corrigieron esos mocks además de los que fallaban.
  Dos mutantes, cada uno en el nivel que le corresponde: cargar por fila hace que el unit
  cuente 2 SELECT en vez de 1; truncar el lote al primer id no lo ve el unit (el mock ignora
  los parámetros) pero **rompe 6 tests de `recetas`/`combos` e2e** contra Postgres real.
  ⚠️ **Segundo bloqueo de la revisión, también correcto:** la primera versión dejaba el
  `convertirUnidad` por fila de `validarYCostearIngredientes` y `validarExtrasPermitidos`,
  argumentando que batchearlo cambiaría el orden en que fallan dos 400 distintos. Era una
  excusa: ese argumento solo refuta la variante de resolver todas las conversiones antes
  del loop. La tercera variante —cargar el catálogo una vez y convertir en memoria **en el
  mismo punto del loop**— no mueve ningún error, y la pieza pura para hacerlo
  (`convertirConMapa`) ya existía sin exponer. Se agregó `CatalogService.crearConversor()`
  y los dos loops quedaron sin query por iteración.
  El costo por fila **no se había eliminado, se había cambiado de tabla**: el pendiente
  hablaba de 15 `SELECT` para 15 ingredientes, y tras el primer intento eran 1 batch + 15
  lecturas de `unidades_medida`.

### Media / Baja — cerrados el 2026-07-29

- [x] ~~**`precio_base` se puede crear o editar en negativo**~~ (backend,
  `dto/create-item.dto.ts`, `dto/update-item.dto.ts`) — cerrado 2026-07-29 con
  `@IsDecimalNoNegativo()` en los dos DTOs, que es donde estaba el agujero: la columna no
  tiene `CHECK` (`startup-pos.sql`), así que el DTO era la única barrera y solo pedía
  `@IsNumberString()`. Completa el barrido de positividad de jul-2026, que se había detenido
  en el borde de los tres módulos auditados (ventas, caja, propinas) y dejó el catálogo
  afuera.
  **El criterio es `>= 0`, no `> 0`, y no es una preferencia:** el `0` lo genera el sistema
  solo —`items.service.ts` fuerza `'0'` para `tipo === 'ingrediente'` en create y en
  update—, así que exigir positivo estricto tumbaría un caso propio. Lo que no tiene lectura
  posible es el negativo: `precioUnitario: '-100'` sin reglas da `totalFinal: -100` y ninguna
  invariante del motor lo neutraliza (ver la nota de la entrada original).
  Lo fija `dto/dinero-signo.dto.spec.ts` (creado como `precio-base.dto.spec.ts`, renombrado
  al extenderse a los demás campos de dinero del módulo) con 6 casos y **los 2 RED verificados** (los de
  negativo fallaban contra el código anterior; los 4 de aceptación ya pasaban antes, que es
  lo que prueba que el payload es válido y los RED no fallaban por otra razón): 0 y decimales
  aceptados en create, ausencia y 0 aceptados en update —el `@IsOptional()` sigue
  funcionando—, y `-100` / `-0.01` rechazados en cada uno.

- [x] ~~**`remove()` chequea uso sin filtrar por tenant**~~ (backend, `items.service.ts`) —
  **la entrada estaba vieja: ya no aplicaba** (verificado 2026-07-29). Sus tres líneas
  citadas (`:1514`, `:1528`, `:1542`) no existen más; hoy `remove()` delega en
  `obtenerUsoItem`, que filtra por `tenant_id` en las **cuatro** ramas del `UNION` —vía la
  entidad padre de cada una (`items`, `grupos_modificadores`)— y sus `UPDATE` llevan
  `tenant_id = $2`. Lo cerró de paso la oleada de `GET /items/:id/uso`, sin que nadie sacara
  la entrada. Cero cambios de código en este cierre.
- [x] ~~**`precioUnitario` negativo en `/calculo-precios/calcular`**~~ (backend,
  `dto/calcular.dto.ts`) — cerrado 2026-07-29 con `@IsDecimalNoNegativo()`, el mismo
  decorador que ya exige el camino real de venta. RED verificado: antes devolvía **201** con
  `precioUnitario: '-100'` (y `totalFinal: -100`), ahora 400. El `0` sigue siendo válido a
  propósito: prohibirlo es la decisión de owner que sigue abierta para `LineaVentaDto`, y
  este cierre no la adelanta.
- [x] ~~**No se puede vaciar `descripcion` ni `categoriaId` al editar un ítem**~~ (frontend,
  `configuracion/items.vue`) — cerrado 2026-07-29. Tres cosas, no una:
  - El `|| undefined` de `descripcion`/`categoriaId` colapsaba lo falsy y el campo no
    viajaba. Ahora en **edición** se manda `''` y `null` respectivamente; en creación se
    sigue omitiendo, para no escribir `''` donde antes quedaba NULL.
  - `duracionEstimada` pasó a `typeof === 'number'`: el `|| undefined` tapaba el `0`, que el
    DTO acepta (`@IsInt() @Min(0)`).
  - **Faltaba la mitad que la entrada no mencionaba:** sin una opción explícita
    "Sin categoría", un ítem que ya tiene categoría **no se puede desasociar desde la UI** —
    `USelectMenu` no tiene `clearable` en esta versión y el placeholder solo se ve con el
    valor vacío. Sin eso, el `null` del payload era código inalcanzable.
  El contrato del backend se verificó **contra la API andando** antes de tocar el front
  (`PATCH` con `descripcion: ''` + `categoriaId: null` → 200 y los dos campos vacíos; el
  `null` pasa porque `@IsOptional()` corta los validadores antes del `@IsUUID()`), y el
  flujo completo en navegador: elegir "Sin categoría" → el `PATCH` capturado lleva
  `categoriaId: null` → la BD queda en `NULL`.
  ⛔ **Regresión propia, cazada en el navegador y corregida:** la primera versión de la
  opción usaba `value: ''`, y reka-ui descarta el ítem con valor vacío — el select de
  Categoría abría con **0 opciones** (el de Moneda, al lado en el mismo drawer, abría con 3),
  o sea el usuario quedaba sin poder elegir **ninguna** categoría. Peor que el bug original,
  invisible para `build`, `typecheck`, `design:check` y los 293 unit. El valor es ahora un
  centinela (`__sin_categoria__`) que `guardar` traduce a `null`.

- [x] ~~**Un `itemId` en mayúsculas devuelve 404 desde que se batchea**~~ (backend,
  `items.service.ts`) — cerrado 2026-07-29 en un solo lugar, como decía la entrada, pero
  **el alcance que proponía era insuficiente y habría dejado algo peor que el 404**:
  normalizar solo `cargarBasePorIds` encuentra la fila base y deja pasar la línea, pero
  `cargarReglasPorIds` sigue sin match y sus llamadores hacen `?? []` — o sea el ítem se
  cobra **sin sus impuestos ni descuentos, en silencio**. El alias se aplica a los dos mapas
  (`aliasarCasingDeIds`): se consulta y compara en minúsculas, y el mapa queda indexado
  también por la forma que mandó el cliente, así que el `get(linea.itemId)` de los tres
  llamadores (venta, `/calculo-precios/calcular`, checkout online) sigue sirviendo con
  cualquier casing sin normalizar en cada uno.
  Lo fija un e2e que **compara el cálculo en mayúsculas contra el mismo en minúsculas** en
  vez de contra números escritos a mano, con `totalImpuestos > 0` como diente: sin eso, dos
  cálculos igualmente vacíos pasarían el `toEqual`. RED verificado (404 antes del fix) y
  **mutante del segundo mapa verificado**: sin el alias en `cargarReglasPorIds` el mismo
  ítem da `5000` en vez de `5950` —el IVA perdido—, que es exactamente el modo de falla que
  el fix a medias habría introducido.
- [x] ~~**Ingrediente o extra duplicado en una receta devuelve 500, no 400**~~ (backend,
  `items.service.ts`) — cerrado 2026-07-29. El chequeo con `Set` que solo tenía
  `validarYCostearComponentes` pasó a un `assertSinIdsRepetidos` compartido por las tres
  (componentes de combo, ingredientes y extras de receta), que es el **tercer** uso y por eso
  se extrajo en vez de duplicar. Va antes de la primera query en las tres.
  ℹ️ **Cambio de precedencia, deliberado:** el chequeo es en memoria y ahora precede a las
  validaciones por fila, así que un payload con un duplicado **y** una cantidad inválida
  reporta el duplicado. Los dos son 400 accionables, y es la precedencia que el gemelo de
  combos ya tenía.
  Dos tests RED verificados: antes del fix ambos llegaban a `filasValidacionPorIds` (el
  síntoma exacto de "consultó la BD"), y el del gemelo de combos sigue verde a través del
  helper compartido.

### Media — cerrados el 2026-07-30 (tercera tanda)

- [x] ~~**Deadlock en la expansión de recetas y combos**~~ (backend) — cerrado 2026-07-30
  con **`ORDER BY` + reintento ante `40P01`**, decidido por el owner sobre la mesa después
  de medirlo. La entrada proponía "ordenar globalmente los ids a bloquear"; se descartó por
  una razón que la entrada no había considerado (ver abajo).
  **Lo que la medición cambió respecto de lo que decía la entrada:**
  - **El `ordenLocks` que ya existía protege mucho menos de lo que parecía.** Ordena las
    **líneas** por `item.id`, pero los `FOR UPDATE` los toma `registrarMovimiento`
    (`inventario.service.ts:91`) sobre los ids **expandidos** —ingredientes, componentes,
    opciones de grupo—, que `ordenLocks` nunca ve. Sirve para un carrito de puros productos;
    para recetas y combos, no.
  - **Confirmado con contraejemplo que el `ORDER BY` solo no cierra el ciclo**, que era lo
    que la entrada afirmaba sin demostrarlo: A vende `RecetaX(ing3, ing5)` → bloquea 3→5; B
    vende `[RecetaY(ing5), RecetaZ(ing3)]` con `Y.id < Z.id` → bloquea 5→3. El orden global
    es *(orden de línea) × (orden dentro de la línea)*, y eso no es ascendente global por
    más `ORDER BY` que lleve cada query.
  - **Había DOS puntos de bloqueo más que la entrada no nombraba, los dos con el orden
    puesto por el cliente:** `venderOpcionesGrupos` recorría las opciones **en el orden del
    snapshot** (ahora se aplanan los grupos y se ordenan por `itemId` — el orden tiene que ser
    global **entre** grupos, no determinista dentro de cada uno), y `venderIngredientesReceta`
    concatenaba los **extras del snapshot detrás** de la lista de ingredientes ya ordenada,
    devolviendo el orden del cliente a la mitad del bloqueo. El cuarto lo encontró la revisión
    independiente **después** de que yo diera el barrido por completo, mirando justo el patrón
    que el diff decía haber barrido. Se cerró en el mismo commit.
    En los dos casos el efecto lateral aceptado es el mismo: el orden de las advertencias de
    stock pasa a ser por id y no el del snapshot. Determinista, que es lo que se busca.
  **Por qué NO se hizo el pre-lock global**, que era lo que la entrada pedía: para ordenar
  globalmente hay que conocer el conjunto completo antes de escribir, y eso obliga a
  reconstruir el grafo de expansión (receta→ingredientes, combo→componentes→ingredientes,
  grupos→opciones→ingredientes) **en un segundo lugar**. El día que alguien agregue un camino
  de expansión y no toque el pre-lock, el deadlock vuelve en silencio. El reintento, en
  cambio, cubre también los ciclos que nadie enumeró (series, lotes, caja).
  **Reintentar es seguro porque el deadlock aborta la transacción entera**: Postgres revierte
  todo antes de devolver el error, así que no hay venta, ni movimientos, ni pagos, ni
  movimiento de caja a medio hacer. No es idempotencia —eso sigue en `pendientes.md`—: acá no
  hay nada que deduplicar porque no quedó nada. Solo `40P01`; cualquier otro error se propaga
  sin reintentar, para no convertir un fallo de negocio en tres intentos silenciosos.
  ⚠️ El `code` de TypeORM llega **de dos formas** según dónde se lance (`error.code` y
  `error.driverError.code`) y se miran las dos: mirar una sola es no reintentar nunca, con un
  bug invisible —la venta falla igual que antes del fix—. Hay un test por cada forma.
  **Seis mutantes verificados revirtiendo** ([[mutante-debe-revertir-no-solo-romper]]):
  sacar cada uno de los dos `ORDER BY` cae su test; sacar el `.sort()` de las opciones de
  grupo y el de los extras devuelve el orden del snapshot y caen; sacar el reintento cae 3 de
  los 4 tests de deadlock (el que sigue verde es, correctamente, "NO reintenta un error que
  no es deadlock"); y revertir `ordenLocks` al orden del carrito cae el test nuevo.
  El patrón quedó documentado como anti-patrón propio en
  [`anti-patterns.md`](anti-patterns.md) — es el criterio de `CLAUDE.md` para un bug que se
  repite, y este se repitió cuatro veces en el mismo camino.
  ℹ️ **Los dos tests de `ORDER BY` afirman sobre el SQL, no sobre el resultado**, y es a
  propósito: el orden lo aplica Postgres y un mock devuelve lo que se le pida. Es la frontera
  honesta de lo que un unit puede probar acá.
  ➕ **Deuda que este cierre destapó, y se cerró en el mismo commit:** el `ordenLocks` de
  `ventas.service.ts` —el fix hermano del 2026-07-23— **no tenía ningún test**. Ahora sí:
  un carrito con las líneas al revés (`zzz`, `aaa`) tiene que bloquear `aaa` primero.
  Mutante verificado revirtiendo al código anterior a aquel fix (`ordenLocks` = orden del
  carrito): el test cae. Una semana de "está arreglado" apoyada en un `.sort()` que ningún
  test vigilaba.

### Media / Baja — cerrados el 2026-07-30 (segunda tanda)

- [x] ~~**`unidadBase`/`forzarConteo` divergen entre venta y checkout online**~~ (backend) —
  cerrado 2026-07-30 con `resolverUnidadBaseDeItem()` en
  `common/utils/cantidad-presentacion.util.ts`, consumida por los **tres** carritos.
  **La entrada tenía tres cosas mal, medidas antes de tocar código:**
  1. **Eran tres call sites, no dos.** `salones.service.ts` tenía la misma derivación y la
     entrada no la nombraba — apareció al grepear `resolverCantidadDesdePresentacion` en vez
     de abrir los dos archivos que citaba. Cerrar solo venta↔online habría dejado la
     divergencia viva en el tercero.
  2. **`forzarConteo` tampoco difería en efecto.** La entrada decía que `unidadBase`
     "coincide por accidente" pero que `forzarConteo` "sí difiere". No: con la unidad base
     resuelta a `'unidad'`, el resolver ya exige que la presentación sea de la **misma
     magnitud** (`conteo`), y `'unidad'` es la única unidad `conteo` del catálogo — así que
     `validarCantidadConteo` corría igual, con la bandera o sin ella. Las dos mitades
     estaban tapadas por el mismo mecanismo, una capa más abajo.
  3. Por lo tanto **no era un bug con síntoma**: vender un combo por presentación daba
     idéntico por POS y por la tienda. Era duplicación cuya equivalencia dependía de dos
     invariantes de otro archivo (que `receta`/`combo` no tienen fila en `item_producto`, y
     el chequeo de magnitud del resolver).
  Se cierra igual, y por eso: unificarlo convierte esa equivalencia frágil en verdad por
  construcción. Lo fijan 4 casos nuevos en `cantidad-presentacion.util.spec.ts`, uno de
  ellos con `unidadMedida: 'kg'` en un combo — el caso imposible hoy, que es justo el que
  prueba la unificación sin apoyarse en el invariante que la tapaba.

- [x] ~~**Quedan CUATRO `convertirUnidad` dentro de loops, dos en el camino de una venta**~~
  (backend, `items.service.ts`) — cerrado 2026-07-30. Los cuatro (`venderIngredientesReceta`,
  `venderOpcionesGrupos`, `calcularDisponibleReceta`, `upsertOverridesDeGrupo`) pasan a
  recibir el conversor de `CatalogService.crearConversor()` por parámetro, con el tipo
  `ConvertirUnidad` exportado.
  **No alcanzaba con crear el conversor arriba de cada función**, que es como se lee la
  entrada: el clúster `vender*` es mutuamente recursivo —el combo llama a la receta, la
  receta al grupo, el grupo de vuelta a la receta—, así que un `crearConversor()` por
  función seguía dando una lectura del catálogo por componente. El conversor se crea en los
  dos puntos de entrada públicos (`venderIngredientesReceta` y `venderComponentesCombo`, con
  `?? await crearConversor()` para el llamador externo) y **baja por parámetro** por todo el
  árbol. Las dos privadas lo reciben como requerido: así no hay forma de que una rama nueva
  se olvide y vuelva a leer.
  `upsertOverridesDeGrupo` va aparte, con `convertir ??= await …` dentro del loop de grupos:
  se lee una vez para todos, y un item **sin** grupos no paga ninguna query (antes tampoco).
  ⚠️ **Lo que este cambio empeora, para no venderlo mejor de lo que es** (lo midió la
  revisión independiente): la carga pasa a ser *eager*, así que hay casos que antes hacían
  **cero** queries y ahora hacen **una**. Un item con grupos pero sin ninguna opción
  `ingrediente` con cantidad, y una receta cuyos ingredientes ya vienen en su unidad base
  (`desde === hacia`, que `convertirUnidad` cortocircuitaba sin consultar). Se acepta: es
  **una** query fija contra una tabla global chica, contra un costo que antes escalaba con
  el tamaño del loop. Vale saber que el intercambio existe.
  ℹ️ **El alcance de "una vez" era por línea, no por venta** — `ventas.service.ts` llamaba a
  estas dos funciones dentro de su loop de líneas sin pasar el conversor. **Cerrado el mismo
  día**, ver la entrada de abajo.
  **Mutante verificado revirtiendo** ([[mutante-debe-revertir-no-solo-romper]]): sacando el
  `convertir` que el combo le pasa a la receta, el test nuevo pasa de **1 a 3** cargas del
  catálogo y falla. El test vende un combo de 2 componentes-receta de 2 ingredientes cada uno
  y afirma `crearConversor` 1 vez, 4 conversiones, y `convertirUnidad` nunca.
  Efecto colateral en el spec: `crearConversor` ahora devuelve un `conversorMock` espiable
  (con la aritmética real por defecto) en vez de una función anónima, así los tests que
  pisaban `convertirUnidad` pasaron a pisar el conversor. Es lo que hace observable la
  cantidad de cargas.

- [x] ~~**El conversor de unidades no se comparte entre líneas de la misma venta**~~
  (backend, `ventas.service.ts`) — abierto y cerrado el 2026-07-30. Lo detectó la revisión
  independiente del batch de arriba, al notar que el texto de cierre afirmaba "una vez por
  operación" cuando el loop de líneas de la venta seguía creando uno por línea.
  El cierre es `let convertir` antes del loop de `ordenLocks` + `convertir ??= await
  crearConversor()` en las ramas de receta y de combo, aprovechando que el parámetro ya
  estaba puesto como opcional exactamente para esto. `salones.service.ts` entra por
  `crearEnTransaccion`, así que el cierre de cuenta queda cubierto por el mismo loop.
  **El `??=` no es cosmético: es lo que evita repetir el intercambio que el batch anterior
  sí pagó.** Con carga *eager* antes del loop, la venta más común del POS —un carrito de
  puros productos— habría empezado a pagar una query que no usa. Perezosa, la paga la
  primera línea que expande una receta o un combo, y las demás la reusan.
  **Dos mutantes verificados, uno por cada mitad de la regla:** volver a `convertir =` (sin
  `??`) lleva las cargas de 1 a 2 con dos líneas de receta y cae el primer test; cargarlo
  eager antes del loop lleva de 0 a 1 en el carrito de productos y cae el segundo. El primer
  test además afirma que las dos líneas reciben **el mismo** conversor, no solo que se cargó
  una vez: contar cargas sin eso dejaría pasar un segundo conversor creado en otro lado.
  El hueco que marcó la revisión —los dos tests usaban líneas del **mismo** tipo, así que
  compartir *entre* ramas no estaba ejercido— se cerró con un tercer test de carrito mixto
  (receta + combo) que afirma que las dos ramas reciben la misma instancia.
  ⚠️ **Al mutarlo apareció algo que conviene saber para el próximo test de este loop:**
  mutar la rama del combo **no** rompe nada, porque `ordenLocks` ordena por `item.id` y
  `combo-b` corre antes que `receta-a` — la primera rama que corre setea la variable igual
  con `=` que con `??=`. El mutante válido es sobre la rama que corre **segunda**, y ahí sí
  las cargas van de 1 a 2. Un mutante sobre este loop que "no rompe nada" puede estar
  midiendo el orden de `ordenLocks`, no la lógica.

### Media / Baja — cerrados el 2026-07-30

- [x] ~~**`AjusteStockDto.cantidad` es `number` nativo**~~ (backend,
  `dto/ajuste-stock.dto.ts`) — cerrado 2026-07-30: pasa a `string` + `@IsNumberString()` +
  `@IsDecimalPositivo()`, como los otros cinco campos de cantidad del módulo, y se va el
  `@Type(() => Number)`. El service no cambió una línea: ya hacía
  `new Decimal(dto.cantidad).toString()`, que trata igual al string.
  **Es un endurecimiento del contrato, no un cambio interno:** un `cantidad: 10` (número
  JSON) ahora devuelve 400. Se puede hacer sin plan de migración porque el único cliente
  —`configuracion/items.vue`— ya mandaba string en los tres modos (`cantidad`, `serie` con
  `String(series.length)`, `lote`), y el proyecto no tiene datos ni clientes productivos
  ([[proyecto-sin-datos-productivos]]). Quien sí mandaba números era la propia suite e2e:
  **15 llamadas** a `PATCH /items/:id/stock` repartidas en `costeo-cpp`, `inventario`,
  `mermas` y `recuentos`, más 4 en el unit de `items.service.spec.ts` (esas las cazó
  `tsc --noEmit`; las de e2e, no — `.send()` es `any`, así que hubo que contarlas a mano).
  Lo fija un e2e en `inventario.e2e-spec.ts` que manda `cantidad: 10` como número y espera
  400: sin él, volver al `@Type(() => Number)` pasa el gate entero.

- [x] ~~**`ventas.service.spec.ts` fija `recargosIds: []` en sus tres fixtures**~~ (backend) —
  cerrado 2026-07-30 con un test que hace lo que la entrada pedía y **un poco más preciso**:
  el hueco real no era el `recargosIds` del item —la venta ni lo lee, pasa
  `linea.recargoIds` del DTO al motor—, sino que `trazas.recargos` y `trazasVenta.recargos`
  llegaban **siempre vacíos** al service, así que los dos loops que persisten `VentaRecargo`
  (7c por línea y 7d a nivel venta) no los ejercía ningún unit.
  El test nuevo devuelve un resultado con un recargo de línea y uno de venta, y afirma las
  dos filas creadas con su `aplicadoEn` (`'detalle'` y `'venta'`).
  **Mutante verificado revirtiendo, no rompiendo** ([[mutante-debe-revertir-no-solo-romper]]):
  con los dos loops neutralizados el test falla con `Array []`; con el código real, pasa.

### Decidido por el owner y ya implementado

- [x] ~~**¿El descuento debe tener piso en cero?**~~ — **sí**, decidido por el owner el
  2026-07-28 ("si el piso no es 0, terminaría pagando el tenant") e implementado el mismo
  día en `calculo-precios.engine.ts`. Tres precisiones que no estaban en la pregunta y
  hacen a la regla:
  - **Se topea regla por regla, al aplicarla**, no al final sobre el total. Es lo único que
    mantiene coherente el comprobante: topear al final dejaría la traza diciendo "500" con
    un total que solo bajó 100, y `subtotal − descuentos` dejaría de dar el total. Con tres
    descuentos del 40% en modo `base` sobre 100, la traza queda 40 / 40 / 20.
  - **Aplica también a los descuentos a nivel venta.** Sin eso el agujero se mudaba: tres
    líneas con piso propio y un descuento de venta que hunde el total igual.
    ⚠️ **La primera versión lo afirmaba y no lo cumplía; la revisión independiente bloqueó
    el cierre.** El tope de venta medía contra el **neto agregado** en vez del total real
    (`Σ totalLinea`, que ya trae descuentos e impuestos de línea). Con una línea de 1000,
    90% de descuento propio e IVA, un descuento de venta de 500 dejaba `totalFinal: -381`
    **y `advertencias: []`** — el bug exacto que la tarea venía a cerrar, ahora con el
    agravante de estar documentado como resuelto. Y en el sentido inverso recortaba
    descuentos sanos: 1190 de total menos un cupón de 1100 daba 190 en vez de 90, cobrando
    100 de más con un aviso que afirmaba un motivo falso.
    **Por qué no lo vi:** mi test usaba una línea sin descuentos ni impuestos, donde
    `subtotalNeto == totalFinal` — el único escenario en que las dos magnitudes coinciden y
    el bug es invisible. Tercera vez en el día que un test pasa por la razón equivocada.
    Cerrado separando `disponible` (la plata sobre la que se topea) de `acc` (la base de
    los `%`), con dos tests que reproducen los dos sentidos y dos mutantes verificados.
  - **No frena la venta**, decisión explícita del owner entre topear en silencio, rechazar
    con 400 y topear avisando: emite advertencia, igual que un ingrediente no bloqueante sin
    stock. Viaja al POS por el canal que ya existía.
  - **Ninguna regla aporta una magnitud negativa**, invariante que hizo falta agregar tras
    el **segundo bloqueo**: al desacoplar la plata de la base de los `%`, el acumulado de
    venta quedó sin piso, y un `compuesto` sobre esa base negativa devolvía un "recargo" de
    `-19.00` que **restaba** —total negativo otra vez, y sin advertencia— o un segundo
    descuento negativo que le cobraba al cliente. Ambos se imprimían así en la traza. El
    revisor lo encontró con un fuzz de 40.000 ventas de configuración válida: 0,78%. No era
    regresión contra `HEAD`, pero la doc volvía a certificar cerrado un agujero abierto.
  Los recargos no tienen **tope superior** (subir el total no es el problema que el piso
  resuelve), pero sí el piso en cero: un recargo nunca resta.
  Nueve tests en el motor puro y tres mutantes verificados. La identidad del comprobante
  (`subtotal − descuentos + recargos + impuestos == totalFinal`) se verificó con un fuzz de
  60.000 ventas sobre las 4 órdenes de fórmula, `base`/`compuesto`, 3 escalas y los 4 modos
  de redondeo: 0 fallos.
- [x] ~~**¿`remove()` debe bloquear el borrado de un ingrediente usado solo como
  extra?**~~ — **no bloquea, advierte con confirmación informada**, decidido por el
  owner e implementado el 2026-07-28. Ser extra es opcional por definición — sin él la
  receta sigue completa — a diferencia de ser ingrediente fijo, componente de combo u
  opción de grupo, que sí bloquean porque dejan la composición incompleta.
  `GET /items/:id/uso` (guard `Items:Eliminar`) devuelve los cuatro usos ya
  clasificados en una sola query `UNION`: `{ bloqueos: [{tipo, nombre}], advertencias:
  [{tipo:'extra', nombre}] }`. `remove()` reusa esa misma query dentro de su
  transacción para decidir si bloquea, y al confirmar marca `eliminado_el` en las
  filas de `receta_extras_permitidos` del ingrediente en la misma transacción que el
  soft-delete del item. El modal de Configuración → Items la consulta antes de
  abrirse: con bloqueos muestra "No se puede eliminar" + motivos y solo "Entendido";
  con solo advertencias nombra las recetas y deja confirmar; sin usos, el texto
  genérico de siempre. Detalle y regla de negocio:
  [`recetas.md`](../features/recetas.md#delete-itemsid).
  ⚠️ **Corrige una afirmación falsa del ítem original.** Decía que este hueco era "la
  condición habilitante del bug de conversión de unidad" de la sección Alta de esta
  misma auditoría. Es falso desde `51df04c` (el cierre de los tres N+1 restantes de
  `items`): las dos lecturas de extras del catálogo —
  `obtenerExtrasPermitidos` (`items.service.ts:1875`), que corre dentro de la
  transacción de venta al resolver la personalización, y el `findOne` de receta
  (`items.service.ts:577`), que alimenta el detalle del item y el drawer de
  personalización, no la transacción de venta — hacen ambas `JOIN items i ON
  i.item_id = re.ingrediente_item_id AND i.eliminado_el IS NULL` (misma condición en
  ambas, distinto momento en que corre). Un ingrediente borrado
  desaparece del `JOIN`, así que el extra queda **ausente** del catálogo de extras de
  la receta, no con una unidad de medida equivocada: vender ese extra da
  `400 'Extra no permitido para esta receta'` (`items.service.ts:1937`), el mismo
  error que un extra sacado de la carta por cualquier otro motivo — verificado leyendo
  ambas queries antes de escribir esta entrada, no asumido del texto original. El bug
  de conversión de unidad real (fallback de unidad de porción vs. unidad de stock) ya
  está cerrado y documentado en su propia entrada, arriba en esta misma sección de
  auditoría ("Vender un extra cuyo catálogo cambió tras congelar el snapshot descuenta
  1000× de más").
- [x] ~~**`advertenciasReceta` de la venta ya no son solo de receta**~~ — cerrado
  2026-07-28, rename mecánico sin cambio de forma (sigue siendo `string[]` plano).
  `ventas.service.ts` renombra la variable local y la propiedad de la respuesta a
  `advertencias`; tocó las 21 referencias esperadas en 7 archivos (`ventas.service.ts`,
  `ventas.service.spec.ts`, las cuatro suites e2e de `combos`/`recetas`/
  `grupos-modificadores`/`grupos-modificadores-overrides`, y `pos.vue`).
  El rename destapó un shadowing que no estaba en el plan: dentro del `for` de
  movimientos de inventario, los bloques `receta` y `combo` ya declaraban su propio
  `const advertencias` local antes de acumular al array externo — con el externo
  renombrado igual, `advertencias.push(...advertencias)` habría hecho que el array se
  duplicara a sí mismo en vez de sumar los avisos de receta/combo, silencioso porque
  compila y tipa igual. Se renombraron esos dos locales a `advertenciasIngrediente` y
  `advertenciasComponente` para que el externo pueda ocupar `advertencias` sin
  colisión; misma lógica, ningún cambio de comportamiento.
  El riesgo real de un rename de campo no es el gate en rojo: es que el frontend siga
  leyendo el nombre viejo, reciba `undefined`, y el `?? []` de `pos.vue` lo convierta en
  lista vacía sin que ningún test lo note — se verificó con grep de cero resultados
  sobre todo el repo (backend, frontend, docs) después del cambio, no solo con las
  cuatro suites e2e en verde.
- [x] ~~**Las advertencias del motor de precios llegan a un solo consumidor**~~ —
  cerrado en dos mitades, 2026-07-28 y 2026-08-02: el motor gana `ResultadoVenta.advertenciasVenta`
  (solo las advertencias de descuentos a nivel venta, que no pertenecen a ninguna línea),
  sin tocar `advertencias`, que sigue siendo el aplanado de línea + venta. Los tres
  carritos (POS `CarritoPanel.vue`, Salones `salones/index.vue`, Tienda
  `CarritoOnline.vue`) dibujan ambas granularidades con el componente compartido nuevo
  `components/AdvertenciasPrecio.vue`: por línea con `resultado.lineas[index].advertencias`
  (cruce por índice, nunca por `itemId` — el mismo ítem puede repetirse en dos líneas con
  personalizaciones distintas) y junto al total con `resultado.advertenciasVenta`.
  `useCalculoPrecios.ts` incorpora los dos campos al tipo. El seed suma el tipo de regla
  `directo` ("Descuento directo") y el descuento `monto_fijo` "Promo fija $5.000" —ningún
  descuento sembrado antes ejercitaba la rama plana del motor—, más el primer e2e de
  `POST /calculo-precios/calcular`, que confirma que las dos granularidades no se
  mezclan entre sí.
  ✅ **La otra mitad cerró el 2026-08-02** — con una corrección al diagnóstico: la entrada
  decía que `online.service.ts` y `suscripciones.service.ts` "no las persisten ni las
  devuelven", y eso era medio falso. `ventas.service.ts:688` **sí devuelve** `advertencias`
  en todos los canales (por eso `pos.vue:214` las muestra como toast); lo que las pierde no
  es la creación de la venta sino **quién la llama**: en online la invoca
  `online-callback.handler.ts:87`, un callback de Transbank sin usuario adelante, y en
  suscripciones la llamada de `suscripciones.service.ts:147` se queda solo con `venta.id`
  (178 y 197).
  Medido el alcance real, quedaban dos huecos y ninguno era el reportado:
  **(1)** `pasarela.vue` no dibujaba nada antes de "Aprobar pago" pese a tener
  `resumen.resultado` completo → cerrado con `<AdvertenciasPrecio>` sobre `advertencias`
  (el aplanado línea+venta, porque esa pantalla no desglosa líneas y las dos granularidades
  por separado duplicarían las de venta). Con eso online queda a la par de POS
  (`CarritoPanel.vue:202,236`) y Salones (`salones/index.vue:1124,1144`), que ya las
  dibujaban al agregar productos igual que la Tienda (`CarritoOnline.vue:61,95`).
  **(2)** el drawer de suscripciones nunca previsualiza el precio —`suscripciones.vue`
  llama a `crear()` en 229 y en 260, y `crear()` cobra por Oneclick en el mismo request— →
  **decisión del owner (2026-08-02): no muestra nada, la suscripción se cobra
  automáticamente.** ⚠️ La razón **no** es que el caso sea imposible: el motor corre igual
  y `cargarReglasPorIds` no filtra por `tipo`, así que un ítem de suscripción sí puede
  llevar descuentos. Lo que sostiene la decisión es la configuración de hoy, no el código
  — detalle en [`motor-calculo-precios.md`](../features/motor-calculo-precios.md).
  ℹ️ Residual consciente, en dos mitades y no una: en **webpay** el toast post-venta del POS
  no existe porque la venta la crea el callback; en el flujo **simulado** —el único que llega
  a `pasarela.vue`— la venta la crea la propia página (`pasarela.vue:63`), que tipa la
  respuesta como `{ id, estado }` y descarta el `advertencias` que `POST /ventas` sí
  devuelve. Ese array trae una clase que la previsualización de precios no tiene: las de
  receta/combo (`ventas.service.ts:565,579`). Hoy es inocuo porque el catálogo de la tienda
  es `?tipo=producto` (`pages/tienda/index.vue:25`) y esas clases son inalcanzables; deja de
  serlo el día que la tienda venda recetas o combos.
  Y `advertenciasVenta` es hoy superficie sin UI: ningún
  archivo de `frontend/app` arma `descuentosVentaIds`/`recargosVentaIds`, así que el render
  junto al total está construido y correcto pero queda inerte hasta que exista esa pantalla
  — detalle en [`motor-calculo-precios.md`](../features/motor-calculo-precios.md).

## Revisión final `borrado-ingrediente-extra` (2026-07-28)

- [x] ~~**El modal de confirmación nunca nombra el item que se va a borrar**~~ (frontend,
  `configuracion/items.vue`) — cerrado 2026-07-29: los tres mensajes nombran el item
  (bloqueado, con extras y confirmación normal). El nombre se fija y se limpia **siempre
  junto con `confirmDeleteId`** en vez de buscarse en la lista por id: así no puede quedar
  mostrando otra fila si la lista se refiltra o se pagina con el modal abierto.
  `confirmarEliminar` pasó a recibir el `Item` completo en lugar del id, que es lo que
  `menuAcciones` ya tenía a mano.
  Verificado en navegador real (el proyecto no testea páginas, así que build/typecheck no
  ven esto): rama bloqueada → `El item "Papas fritas" está en uso y no se puede eliminar:`
  con su viñeta "Es componente de Combo Especial"; rama normal → `¿Estás seguro de que
  deseas eliminar "Producto demo (unidad · CLP)"?`.
- [x] ~~**`:disabled="!!verificandoEliminarId"` es global en `items.vue`**~~ (frontend) —
  cerrado 2026-07-29: el `disabled` quedó acotado a la fila en verificación
  (`verificandoEliminarId === row.original.id`), la misma condición que su `:loading`.
  Antes, verificar el uso de un item deshabilitaba el menú de **todas** las demás filas,
  incluidas acciones que no tienen nada que ver (ajustar stock, historial).
  ℹ️ **Lo que esto deja como contrapartida chica:** durante la verificación en vuelo, un
  click en "Eliminar" de otra fila es ahora un no-op silencioso (el guard de reentrancia de
  `confirmarEliminar` lo corta) en vez de un botón visiblemente deshabilitado. Se acepta: la
  ventana es la de un request y el precio anterior era bloquear toda la tabla.
  ⚠️ **Este cambio afloja una de las dos capas que cubrían la carrera de "se borra el item
  equivocado"**, así que se verificó con el escenario obligatorio de dos entidades solapadas
  (el que un smoke de un item por vez no ve): con la respuesta de `/uso` demorada 5 s a
  propósito, click en "Eliminar" de la fila A y después en la de B **con A en vuelo**. Se
  disparó **un solo** request —el de A— y el modal abrió nombrando **A**, no B. El guard de
  reentrancia es el que sostiene la invariante; el `disabled` global era redundante.
  Técnica, por si hay que repetirlo: `navigate_page` con un `initScript` que envuelve
  `window.fetch` y demora las URLs que matchean `/uso`.

- [x] ~~**`UsoItemTipo` está duplicado a mano**~~ (backend `items.service.ts` + frontend
  `configuracion/items.vue`) — cerrado 2026-07-30 con la **mitigación mínima que la propia
  entrada pedía**, no con el enlace de compilación: un docblock cruzado en las dos puntas
  (`UsoItemTipo` ↔ `UsoItemTipoBloqueante` + `ETIQUETA_USO`) que dice qué pasa si se toca una
  sola —la viñeta se renderiza con la etiqueta vacía en vez de romper el build— y que la
  partición `'extra'` → `advertencias` es parte del contrato.
  **No cierra el problema de raíz** y no pretende hacerlo: el enlace real es el workspace
  compartido del monorepo, que sigue siendo tema propio por decisión del owner
  ([[workspace-compartido-monorepo-pendiente]]). Acá el patrón acordado para ese caso es
  exactamente este: la copia vive de cada lado y ambos docblocks se referencian.

## Revisión final `advertencias-previsualizacion` (2026-07-29)

- [x] ~~**El e2e de ventas consume stock sembrado compartido**~~ (backend,
  `test/ventas.e2e-spec.ts`) — cerrado 2026-07-29: el test de la advertencia recompuesta usa
  ahora un **servicio** que crea él mismo, no "Papas fritas". Un servicio no tiene
  inventario, así que la venta no consume stock de nadie —antes le gastaba 1 unidad al ítem
  que `combos.e2e-spec.ts` usa como componente, acelerando su agotamiento en corridas
  locales repetidas y aflorando como un fallo opaco en una suite ajena
  ([[e2e-cumulative-stock-pollution]])—.
  **La economía es idéntica**, verificada contra `/calculo-precios/calcular` antes de tocar
  el test: subtotal 1500, "Promo fija $5.000" topeada a 1500, `totalFinal` 0 con los dos
  ítems (ninguno tiene IVA asociado), así que las aserciones no cambiaron.
  Medido, no supuesto: el stock de "Papas fritas" queda en **38.0000 antes y después** de
  correr la suite; antes bajaba 1 por corrida. Efecto lateral: se fue `PAPAS_FRITAS_ID`, una
  de las dos constantes con el mismo literal que confundía a los revisores (la causa sigue
  en el seeder, ver [`pendientes.md`](pendientes.md)).

- [x] ~~**El seed reusa el UUID `…440281` para dos filas sin relación**~~ (backend,
  `seeder.service.ts`) — cerrado 2026-07-30. El que se movió es el **garzón "Mostrador"**, no
  el ítem: `…440281` pertenece al bloque 281-289 que `seedPapasFritas` usa de corrido (papas,
  su movimiento, pollo, chuleta), mientras que el garzón lo tomó fuera de su propio rango
  (los garzones de Paris van en 238-240). Ahora es `…440339`, el siguiente número libre
  medido sobre el repo entero (338 era el máximo; 400/500/600/999 ya estaban tomados más
  arriba). Referencias vivas actualizadas: el seeder y las dos constantes `MOSTRADOR_ID` de
  `ventas.e2e-spec.ts` y `liquidacion-propinas.e2e-spec.ts`. Los planes y specs de
  `docs/superpowers/` **no se tocaron**: son artefactos fechados que describen lo que se hizo
  ese día, no la fuente de verdad del seed.
  El id nuevo lleva un comentario que dice de quién es `…440281`, para que la próxima persona
  no lo reasigne de vuelta. Verificado con la e2e completa sobre BD reseteada (172 verdes):
  si el garzón placeholder no existiera con ese id, la propina de POS del `liquidacion-propinas`
  no repartiría.

- [x] ~~**`resultado` y `lineas` se desfasan: el aviso puede quedar bajo la línea
  equivocada**~~ (frontend, los tres carritos) — cerrado 2026-08-07 con
  `useResultadoCalculado()` en `app/composables/useCalculoPrecios.ts`, un solo lugar
  donde vive el par carrito↔cálculo. Los tres carritos lo consumen; ninguno guarda
  `resultado` por su cuenta.
  **La entrada describía dos formas y había una tercera, más cara:** además del aviso
  mal atribuido, el **modal de cobro pide su `:total` de `resultado`** (POS
  `ventas/pos.vue`, salones `salones/index.vue`) y la precuenta/boleta de salones
  imprime `totales` e `itemsParaTicket()` desde ahí. Agregar un ítem y hacer clic en
  Cobrar dentro de la ventana del debounce abría el modal con el total del carrito
  anterior: no era solo cosmética.
  **Cómo se cerró**, dos mecanismos, uno por cada forma de desfase:
  - **`vigente` es derivado**, no un flag: compara la clave del input actual contra la
    del input que produjo el resultado guardado. Un booleano habría que bajarlo en
    cada sitio que muta el carrito —cuatro en salones más los dos watchers con
    debounce—, y el que se olvide reporta "al día" en silencio; la clave no se puede
    desincronizar del input porque se calcula de él.
  - **token de request**: dos `calcular` solapados no dejan que la vieja pise a la nueva.
  - **un cálculo que falla no toca el resultado guardado.** El primer intento lo
    borraba, y la revisión lo midió: bastaba un error de red para dejar el total en
    cero **con el modal de cobro abierto** (`totalFinal` es un computed vivo, no un
    snapshot), y de paso sin boleta. La vigencia ya dice si el guardado sirve.

  Las advertencias se dibujan solo con `vigente` (los totales conservan el último valor
  para que no parpadeen tecla a tecla); todo lo que mueve plata —abrir el cobro,
  imprimir precuenta, cerrar la cuenta— pasa por `await asegurarVigente()`. Si devuelve
  `null` no se sigue con **lo que dependía del cálculo** (no se abre el cobro, no se
  imprime) y se avisa; lo ya cobrado se registra igual, porque el backend calcula su
  propio total y el cliente ya pagó.
  **Lo fijan 20 tests** —17 en `useResultadoCalculado.nuxt.spec.ts` y 3 de render en
  `CarritoPanel.nuxt.spec.ts`, que son los únicos que ven el cruce índice↔advertencia
  en el template— y **8 mutantes medidos**, cada uno revirtiendo a la conducta anterior
  y verificado como aplicado.
  **Cinco de esos tests salieron de la revisión independiente**, que bloqueó en la
  primera ronda. Lo que encontró, y que el gate no veía:
  - El `catch` que borraba el resultado era **una regresión**: si el cálculo que falla
    es del mismo carrito, el guardado era el bueno.
  - `asegurarVigente()` no cancelaba un debounce pendiente cuando el carrito ya estaba
    vigente —agregar algo y sacarlo antes de los 300 ms— así que el timer sobrevivía y
    recalculaba con el modal de cobro ya abierto. Ahora el callback revalida al
    disparar, y el timer no sobrevive al unmount de la página (`onScopeDispose`).
  - La **tienda** había quedado sin el guard y la **boleta del POS** leía el ref crudo,
    mientras tres documentos afirmaban lo contrario.
  - Con `persistKey` el token era local por instancia, así que el `limpiar()` de una
    página no podía descartar la respuesta en vuelo de otra. Pasó a `useState`.

  Dos hallazgos de la segunda ronda cambiaron decisiones, no solo código: gatear el
  botón por `vigente` **dejaba la tienda trabada** tras un fallo de red (gris, sin
  mensaje, sin reintento) —el POS no tenía el problema justamente porque no lo
  gateaba—, y los cuatro `if (!x) return` mudos del camino del dinero ahora avisan.
  También salió un early-return del watcher que **ningún mutante mataba**: se fue, por
  la misma vara con la que se había ido el `clearTimeout` de `recalcular()`.
  **Sobre el camino que quedó bloqueado en `853c16b3`** (filtrar las líneas de ítems
  eliminados antes de calcular): esto lo acerca pero **no lo destraba solo**. Filtrar el
  input hace que `resultado.lineas` sea más corto que las líneas visibles, y eso es un
  desfase de longitud que la vigencia no resuelve —haría falta un mapeo explícito de
  índices—. Lo que sí cambió es que ahora hay **un único lugar** donde el input se
  arma (el getter que recibe el composable), que es donde ese mapeo iría.

## Revisión final `precio-base-negativo` (2026-07-29)

- [x] ~~**Tres hermanos de dinero del módulo `items` sin validación de signo**~~ (backend) —
  cerrado 2026-07-29 con `@IsDecimalNoNegativo()` en **seis** campos, no en los tres que
  nombraba la entrada ni en los cuatro que se planificaron:
  - `items/dto/create-item.dto.ts` — `costo` (carga inicial; entra a `costo_actual`, base del
    CPP y del margen), `RecetaExtraInputDto.precioExtra` y
    `ItemGrupoOpcionOverrideInputDto.precioExtra` (este último lo reusa `UpdateItemDto` vía
    `gruposModificadores`, así que el PATCH queda cubierto sin tocar el otro archivo).
  - `items/dto/aplicar-desfases.dto.ts` — `AplicarDesfaseItemDto.precioBase`.
  - **Los dos gemelos que la entrada no veía**, aparecidos al grepear el repo entero en vez
    de la carpeta del módulo —el grep acotado es exactamente el que ya falló con el enum de
    estados—: `grupos-modificadores/dto/create-grupo-modificador.dto.ts`
    (`GrupoOpcionInputDto.precioExtra`, mismo dinero y misma columna que el de `items`; lo
    reusa `UpdateGrupoModificadorDto`) y `grupos-modificadores/dto/aplicar-overrides.dto.ts`
    (`precioExtra`, gemelo exacto hasta el `@ValidateIf(!== '')`). Cerrar `precioExtra` solo
    del lado de `items` habría dejado el mismo campo validado a medias en el repo.
  **El criterio es `>= 0` en los seis, y en dos casos no por preferencia sino por contrato:**
  un extra u opción **gratis** es legítimo (el propio e2e manda `precioExtra: '0'` en
  `grupos-modificadores-overrides.e2e-spec.ts`), y en `aplicarDesfases` el `> 0` que exige el
  service **es condicional a `actualizarPrecio`** (`items.service.ts:3443-3455`), así que un
  decorador de campo —que no ve el otro campo— pedir positivo estricto habría empezado a
  rechazar `{ precioBase: '0', actualizarPrecio: false }`, hoy aceptado e ignorado. Ahí el
  decorador mata el negativo y el `> 0` sigue viviendo en el service.
  Lo fijan **16 casos nuevos** en `items/dto/dinero-signo.dto.spec.ts` (renombrado desde
  `precio-base.dto.spec.ts`, que ya no describía su contenido),
  `grupos-modificadores/dto/create-grupo-modificador.dto.spec.ts` y los 2 agregados a
  `aplicar-overrides.dto.spec.ts`, con **los 8 RED verificados**: fallaban los 8 de rechazo y
  **pasaban todos los de aceptación** contra el código anterior, que es lo que prueba que los
  payloads eran válidos por lo demás y los RED no fallaban por un fixture roto.
  Dos regresiones que los tests cubren a propósito: el `precioExtra: ''` de los overrides
  (`@ValidateIf` saltea todos los validadores; es el "no tocar este override" que manda el
  frontend) y el negativo entrando por `UpdateItemDto`/`UpdateGrupoModificadorDto`, que reusan
  los DTO anidados.
  **Lo que la entrada afirmaba de más:** decía que los tres campos de la familia `costo` de
  módulos vecinos eran candidatos del mismo molde. Medidos uno por uno, **ninguno es agujero
  funcional** — ver la entrada que quedó abierta en [`pendientes.md`](pendientes.md), que ya
  cita el `lessThanOrEqualTo(0)` de cada service.

- [x] ~~**Tres campos de la familia `costo` validan el signo en el service, no en el DTO**~~
  (backend) — cerrado 2026-07-30 con `@IsDecimalPositivo()` en los tres
  (`items/dto/ajuste-stock.dto.ts` `costoUnitario`, `inventario/dto/ajuste-costo.dto.ts`
  `costoNuevo`, `mermas/dto/create-merma.dto.ts` `costoUnitario`). Era consistencia, no un
  hueco: los tres services ya rechazaban el `<= 0`.
  **Un dato de la entrada no aguantó al medirlo.** Decía que el de mermas necesitaba
  `@ValidateIf(o => o.costoUnitario !== '')` porque el vacío significa "valorizar con el costo
  actual". Falso hoy: `@IsNumberString()` **ya rechaza la cadena vacía** —`@IsOptional()` solo
  saltea `null`/`undefined`—, así que ese camino ya devolvía 400 antes de este cambio, y
  `mermas.vue:219` nunca manda `''` (solo setea el campo si `.trim()` da algo). Agregar el
  `ValidateIf` habría **aflojado** la validación en vez de preservar un camino vivo: el `''`
  habría empezado a pasar el DTO y a llegar al service. El camino "sin costo" es omitir el
  campo, y así quedó documentado en el DTO.
  **Solo uno de los tres borró la validación del service**, y por una razón concreta:
  `registrarAjusteCosto` tiene un único llamador (su controller), así que el `> 0` vive ahora
  en el DTO y el backstop lo pone `registrarMovimiento` sobre el costo ya redondeado a 4
  decimales. Los otros dos **conservan** el chequeo: el de `registrarMovimiento` es un punto
  de entrada compartido por mermas, ventas y recuentos —no todos pasan por un DTO— y el de
  mermas está entrelazado con la conversión de unidad. Ahí el decorador es fail-fast en el
  borde y documentación en Swagger, no el único candado.
  Lo fija un e2e en `inventario.e2e-spec.ts` que manda `costoNuevo` `-4300` y `0` contra
  `POST /inventario/ajustes-costo` y espera 400 en ambos — sin esa aserción, el decorador que
  reemplazó al chequeo del service se podía borrar sin que fallara nada.

## IVA derivado de la clasificación tributaria (ADR-018)

- [x] ~~**Un ítem `afecto` debe llevar el IVA sí o sí; uno `exento`, no**~~ (backend +
  frontend) — cerrado 2026-07-31 con [ADR-018](../adr/018-iva-derivado-de-la-clasificacion.md)
  y spec propia (`docs/superpowers/specs/2026-07-30-iva-automatico-clasificacion-tributaria-design.md`).
  **Qué se hizo:** el IVA dejó de asociarse en `item_impuestos` y pasa a **derivarse** en
  `CalculoPreciosService.resolverLinea` a partir de `items.clasificacion_tributaria`: sobre
  la lista de impuestos ya resuelta de la línea —del ítem o pisada por el payload— se saca
  cualquier `tipo='iva'` (defensa contra datos viejos) y se agrega el IVA del país solo si
  `clasificacionTributaria === 'afecto'` (condición **positiva**, no la negación del filtro
  de exento, porque la columna quedó nullable). `item_impuestos` cambió de significado: ahora
  son solo los impuestos **adicionales** (`tipo='otro'`) que el usuario asoció. El IVA no se
  acepta nunca por payload —ítem ni línea de venta, en ningún endpoint— y eso es 400, no
  normalización silenciosa. `tipo='ingrediente'` quedó sin clasificación tributaria: la
  columna se hizo nullable y el ítem se guarda con `NULL` explícito.
  **Por qué derivar y no materializar:** auto-asociar el IVA al crear/editar el ítem dejaba
  dos fuentes de verdad (la clasificación y la fila puente en `item_impuestos`) que
  sincronizar en cada camino de escritura, presente y futuro. Lo que decidió no fue la
  elegancia sino el modo de fallar: materializando, el olvido queda en la **escritura** y
  produce un ítem que se vende sin IVA, en silencio — plata mal cobrada. Derivando, el olvido
  queda en la **lectura** y produce, como mucho, un formulario que muestra de menos: visible,
  y no toca la plata. Derivar además cierra sola la segunda puerta del agujero original —la
  línea de venta que pisaba los impuestos del ítem con `impuestoIds: []`—, que materializar
  no cerraba.
  **`items.clasificacion_tributaria` quedó nullable pero conservando `DEFAULT 'afecto'`.**
  Son protecciones complementarias, no alternativas: la condición positiva de lectura
  (`=== 'afecto'`) protege que un `NULL` ya existente no derive IVA por accidente; el
  `DEFAULT` protege que omitir la columna en un `INSERT` no produzca un `NULL` sin querer.
  Sacar el default habría invertido el modo de fallar de vuelta a la escritura silenciosa.
  **Corrección sobre el propósito del remapeo de duplicados.** El seeder solo necesitaba
  dejar de **remapear** la asociación del duplicado hacia el impuesto oficial —eso era
  inofensivo (esa fila es `tipo='iva'` y el motor la descarta antes de derivar) pero quedó
  sin sentido, porque el IVA ya no se asocia—, pero **sigue soft-deleteando el duplicado**,
  porque eso es lo que evita la doble tributación (el duplicado es `tipo='otro'`, el motor no
  lo filtra, y sumado al IVA derivado da 38%). El comentario de
  `seeder.service.ts:remapImpuestosOficialesDuplicados` documenta la distinción.
  **Cómo quedó cada pregunta abierta de la entrada original:**
  1. ¿Derivar o materializar? → **Derivar.** Ver arriba.
  2. ¿Qué IVA se toma si hay más de una fila `tipo='iva'` visible? → **Se resolvió sola, no
     hizo falta decidirla:** no puede haber más de una, porque `impuestos.tipo` no está
     expuesto en `CreateImpuestoDto`/`UpdateImpuestoDto` — un tenant no puede crear un
     impuesto `tipo='iva'` por API, y la única fila la siembra el seeder, una por país. Esta
     decisión se **apoya** en esa invariante: si `tipo` se expone alguna vez en la API de
     escritura, ADR-018 se revisa primero.
  3. "No se puede quitar": ¿400 o re-agrega en silencio si falta el IVA en `impuestosIds`? →
     **No aplica: el IVA nunca es parte de `impuestosIds`.** No hay nada que "quitar" porque
     nunca se asigna; omitirlo es el camino normal, y solo es 400 si el payload lo **incluye**
     explícitamente (contradicción, no omisión).
  4. ¿Queda rastro del ida y vuelta `afecto → exento → afecto`? → **No aplica por la misma
     razón:** no hay asociación que crear o destruir en cada cambio de clasificación, así que
     no hay nada que perder ni que registrar. Las ventas ya congeladas siguen sin tocarse
     (`venta_detalles.clasificacion_tributaria` es snapshot).
  5. ¿Aplica a todos los tipos de ítem, incluido `ingrediente`? → **No.** `ingrediente` quedó
     con `clasificacion_tributaria = NULL` explícito ("no aplica", no "afecto"), y la
     condición positiva `=== 'afecto'` del motor es justamente lo que evita derivarle IVA a un
     ingrediente si alguna vez llega a una línea.
  **Qué lo fija:** en `calculo-precios.service.spec.ts`, seis casos con mutante verificado
  revirtiendo al código anterior (no un `throw` agregado): afecto sin impuestos igual lleva
  IVA; afecto con adicionales lleva adicionales **más** IVA; exento con adicionales lleva
  adicionales **sin** IVA; una línea que pisa impuestos con `impuestoIds: []` sobre un ítem
  afecto igual lleva el IVA (la segunda puerta); `clasificacionTributaria: null` no deriva
  nada (fija el `===` contra el `!==`); afecto en un país sin fila `'iva'` revienta nombrando
  el país. En `items.service.spec.ts`: `tipo='iva'` en `impuestosIds` es 400,
  `clasificacionTributaria` junto a `tipo: 'ingrediente'` es 400, un ingrediente se guarda con
  `NULL`. Y un e2e de extremo a extremo: crear un ítem afecto sin tocar impuestos y venderlo
  cobra el 19% igual, con traza en `ventas_impuestos` — el bug de la entrada, por el camino
  por default.
  **Lo que quedó fuera en su momento:** el `?? 'afecto'` de `VentasService` al congelar el
  snapshot fiscal (`ventas.service.ts:396` y `:889`), diferido por el owner el 2026-07-31 por
  ser inalcanzable. Se cerró igual ese mismo día — ver la entrada de acá abajo.

- [x] ~~**`VentasService` rellena el snapshot fiscal con `'afecto'` cuando falta la
  clasificación tributaria, en vez de rechazar**~~ (backend) — cerrado 2026-07-31.
  **Lo que se midió antes de tocar nada: la entrada sobreafirmaba.** Daba `:396` y `:889`
  como el mismo problema y no lo son. En `:396` el dato viene de `items`, donde la columna
  **es** nullable (`string | null`), así que el riesgo era real aunque hoy inalcanzable. En
  `:889` —la nota de crédito— viene de `venta_detalles`, que es `NOT NULL` en el esquema y
  cuyo tipo de retorno en `validarDevolucionesReembolso` ya declara `string`: ahí el
  `?? 'afecto'` era **código muerto**, no un relleno peligroso. Poner un `throw` en `:889`
  habría sido una rama inalcanzable e intesteable.
  **Qué se hizo:** en `:396`, un guard temprano en el mismo loop que ya rechaza
  `tipo='ingrediente'` (paso 2 de `crear()`, antes de calcular precios y antes de escribir
  nada): si `clasificacionTributaria === null`, `BadRequestException`. El write site usa
  `!`, con el guard citado en el comentario. En `:889` se borró el `??` a secas.
  **Por qué rechazar y no rellenar:** el motor decide el IVA **antes**, con la condición
  positiva `=== 'afecto'`, así que un `null` ya cobró IVA cero; escribir `'afecto'` en
  `venta_detalles` deja una línea coherente consigo misma pero falsa respecto de lo que pasó
  — sin excepción ni log, indetectable por auditoría. Y el guard va arriba para que el
  rechazo no dependa del rollback de la transacción.
  **Mutante verificado:** revertido a `?? 'afecto'` (guard borrado), el test nuevo de
  `ventas.service.spec.ts` falla y la salida de Jest muestra el bug literal —
  `"clasificacionTributaria": "afecto"` en el detalle de un ítem cuya clasificación era
  `null`—. El test también asegura `calculoPreciosService.calcular` no llamado, así que
  distingue el guard temprano de un `throw` tardío en el write site.
  **Sigue inalcanzable por API** (el único tipo con clasificación nullable es `'ingrediente'`
  y `ventas.service.ts:191` lo rechaza antes): el test fija la conducta para cuando aparezca
  otro tipo no vendible o se relaje ese guard, y está anotado como tal.

- [x] ~~**Un impuesto propio llamado "IVA" se suma al IVA derivado: 38%**~~ (frontend) —
  cerrado 2026-07-31. **Decisión del owner:** no se puede impedir por código —el tenant es
  dueño de su catálogo de impuestos y una heurística de nombre en `ImpuestosService.create`
  le prohibiría nombrar como quiera, con falsos positivos garantizados—, así que la defensa
  es **explicar, no bloquear**.
  **Qué se hizo:** dos `AppInfoButton` (el patrón de "i" informativa que ya existía en
  `UserPreferencesForm` y `salones.vue`). Uno en el campo **Nombre** de
  `configuracion/impuestos.vue` — ahí es donde se comete el error, no al clasificar el ítem —
  diciendo que el IVA no se crea en esa pantalla y que uno llamado «IVA» se **suma** al
  automático. Otro en **Clasificación tributaria** de `configuracion/items.vue`, que explica
  que `Afecto` ya trae el IVA del país (con el porcentaje real, interpolado desde `ivaLabel`,
  no hardcodeado) y que congela en la venta. Junto con los placeholders que ya se habían
  cambiado (`"IVA"`/`"0.19"` → `"Impuesto verde"`/`"0.05"`), la UI dejó de guiar al error.
  **Lo que NO se tocó, a propósito:** el heurístico del seeder
  (`nombre ILIKE '%iva%'` + porcentaje idéntico). Se evaluó ampliarlo para agarrar
  `"I.V.A. 19"` o `"Impuesto al Valor Agregado"` y se descartó: más cobertura a cambio de más
  falsos positivos sobre impuestos legítimos, en un barrido que igual solo corre al arrancar
  el backend. Con la "i" en la UI, el heurístico dejó de ser la única defensa.
  **Sin test:** son textos. Verificado en navegador (drawer abierto, modal abierto, `ivaLabel`
  interpolando "IVA 19%", consola limpia) porque build y typecheck no ven nada de lo que pasa
  dentro de un drawer.

- [x] ~~**`seeder.service.ts` — el JOIN de detección de duplicados de IVA no filtra
  `eliminado_el`**~~ (backend) — cerrado 2026-07-31 agregando `AND t.eliminado_el IS NULL` y
  `AND p.eliminado_el IS NULL` a los JOIN de `remapImpuestosOficialesDuplicados`, con el
  mismo patrón que `impuestos.service.ts:41-44`.
  **La razón que daba la entrada estaba invertida y se corrigió acá.** Decía que sin los
  filtros "un tenant o provincia soft-eliminados podrían dejar pasar un duplicado sin
  desactivar". Es al revés: un `JOIN` sin filtro matchea **más** filas, así que sacar el
  filtro amplía el barrido, no lo reduce. La razón real para filtrar es la contraria — el
  barrido **soft-deletea impuestos ajenos**, y hacerlo sobre el catálogo de una empresa que
  ya no existe es destruir datos que nadie pidió tocar (invariante 3).
  **Y no pierde cobertura:** un tenant eliminado no vende, y si se restaura, el próximo
  arranque vuelve a alcanzarlo — la ventana es la misma que la ya documentada para cualquier
  duplicado nuevo ("creado a las 10:00, cobra doble hasta el próximo reinicio").
  **Sin test, y dicho de frente:** el seeder no tiene harness de tests, corre en
  `onApplicationBootstrap` y sus métodos son privados; el estado que el cambio distingue
  (tenant o provincia soft-eliminados con impuestos vivos) no se alcanza por API. Se evaluó
  un invariant spec que escanee el SQL del repo —al estilo de
  `uuid-columns.invariant.spec.ts`— y se descartó: distinguir `i.eliminado_el` de
  `t.eliminado_el` pide parsear alias, o sea maquinaria nueva y frágil para una query.

## Papelera — restaurar eliminados (2026-07-31)

- [x] ~~**El listado de `impuestos` no filtra los borrados del sistema — el `OR` sin
  parentizar**~~ (backend, `impuestos.service.ts`) — cerrado 2026-08-01. El `where` del
  listado con `incluirEliminados` ahora va parentizado
  (`'(i.tenant_id = :tenantId OR i.pais_id = :paisId)'`), así que el `andWhere` del filtro
  de borrado-del-sistema alcanza a las dos ramas. Se descartó `isolateWhereStatements`:
  es un flag global de la conexión y habría cambiado el SQL de todos los query builders
  del repo para arreglar una query.
  **Lo que realmente cerró el agujero no fue el paréntesis, fue el test.** El bloque e2e
  "solo lo que borró una persona" cubría **2 de los 16 recursos** —`categorias` e
  `items`— y esa muestra estaba elegida por **familia de borrado** (softDelete de TypeORM
  vs SQL cruda), que es cómo borran, no por la forma del `WHERE`, que es dónde puede
  fallar el filtro. `impuestos` es el **único** listado de los 16 con un `WHERE` de dos
  ramas, y era el único roto. Ahora el bloque está parametrizado sobre los **16**
  (`test/papelera.e2e-spec.ts`), con un guard de cobertura **derivado del esquema**: el
  test cruza la lista contra las tablas que tienen `eliminado_por` en
  `information_schema`, que es la columna que define la regla. Un conteo o una lista de
  nombres escrita al lado solo se compara consigo misma —agregar el recurso 17 sin tocar
  el spec pasaría en silencio—; contra la BD, agregar la columna a una tabla nueva rompe
  el test hasta que alguien decida conscientemente si va a la papelera.
  **Mutantes verificados, los dos:** (a) sacar los paréntesis con el e2e parametrizado
  puesto → rojo **solo en `impuestos`**, verde en los otros 15 (que es la prueba de que
  el diagnóstico era precedencia y no otra cosa); (b) el mismo mutante contra el unit
  spec nuevo (`impuestos.service.spec.ts` → "el filtro de borrado-del-sistema se aplica a
  las DOS ramas del OR") → rojo. Antes de ese unit test, el mutante pasaba en verde toda
  la suite unitaria.
  **Barrido para no repetir el error de medir un solo mecanismo:** los 10 fragmentos con
  ` OR ` en `where`/`andWhere` del repo quedan parentizados, `orWhere()` no se usa en
  ningún archivo, y `isolateWhereStatements` no está seteado en ninguna parte — o sea el
  15/16 que reportaba la entrada era correcto y no quedan gemelos.

- [x] ~~**`restaurar()` no limpia `eliminado_por`, y eso permite burlar la regla por
  API**~~ (backend, los 16 recursos) — cerrado 2026-08-01. Los 16 `restaurar()` ahora
  ponen las **dos** columnas en `NULL`. Dos técnicas, según la familia:
  - **7 de SQL cruda** (`items`, `causas-merma`, `motivos-diferencia`,
    `motivos-diferencia-inventario`, `grupos-modificadores`, `salones` —incluida la
    cascada a `mesas`— y `mesas` suelta): `SET eliminado_el = NULL, eliminado_por = NULL`
    en la sentencia que ya existía. `receta_extras_permitidos` y
    `grupo_modificador_opciones` **no** llevan el cambio: verificado contra
    `startup-pos.sql`, esas dos tablas no tienen columna `eliminado_por`. `mesas` sí la
    tiene, y por eso la cascada de `restaurarSalon()` también la limpia.
  - **9 de la familia `.restore()` de TypeORM** (`categorias`, `descuentos`, `recargos`,
    `impuestos`, `terceros`, `cajones`, `garzones`, `turnos`, `impresoras`): `restore()`
    **no servía** —solo nulea la `@DeleteDateColumn`—, así que pasaron a un
    `update({ id, tenantId }, { eliminadoEl: null, eliminadoPor: null })`: una sola
    sentencia con las dos columnas, no dos que puedan quedar a medias.
  **Verificado contra la fuente antes de elegir el diseño, no supuesto:** TypeORM inyecta
  el `eliminado_el IS NULL` de soft delete **solo** cuando
  `expressionMap.queryType === 'select'` (`node_modules/typeorm/query-builder/QueryBuilder.js`,
  `createWhereExpression()`), así que un `update()` sí alcanza una fila borrada. Si no
  fuera así, el `update()` habría afectado 0 filas **en silencio** — la misma clase de
  fallo mudo que costó una ronda entera en la Task 4.
  **Test y mutantes:** el bloque e2e de la regla suma un segundo `it` por recurso —los
  16— que corre la secuencia completa del backlog: crear → `DELETE` → `restaurar` →
  **asertar contra la BD** que las dos columnas quedaron en `NULL` → borrado del sistema
  sobre la misma fila → no aparece en la papelera y `restaurar` da 404. La aserción va
  contra Postgres y no contra el JSON de la respuesta a propósito: varios de los 16 no
  devuelven `eliminadoPor`, así que un test que mirara solo el cuerpo pasaría con la
  columna sucia. Mutante verificado en **las dos** familias por separado —volver
  `categorias` a `restore()` y sacarle `eliminado_por = NULL` a `causas-merma`—: rojo en
  los dos, verde en los otros 14.
  **Efecto lateral bueno:** las dos pantallas ya cableadas parchean
  `eliminadoEl`/`eliminadoPorNombre` a `null` en local tras restaurar
  (`items.vue`, `categorias.vue`); ese parche optimista pasó de divergir del backend a
  coincidir con él.

- [x] ~~**Los unit tests del listado con `incluirEliminados` no prueban nada**~~
  (backend, 14 de los 16 recursos) — cerrado 2026-08-01. **Los 16 recursos** (15 archivos
  de spec; `salones` cubre salones y mesas) ahora asertan el filtro de borrado-del-sistema
  en su listado. Era el test que faltaba: por esto el gate dio verde con los dos agujeros
  de arriba adentro, y es el octavo test de esta feature que pasaba sin probar lo que su
  nombre decía.
  ⚠️ **Los números de la entrada original estaban mal, los dos.** Decía "12 `qbMock`" y
  "11 restantes"; el conteo se había hecho **por tipo de mock y no por recurso**. Medido
  con `grep -l` sobre la cláusula: eran **14 de 16** sin aserción (`items` e `impuestos`
  ya la tenían). Es el mismo error que la entrada del `OR` — contar por el mecanismo en
  vez de por la conducta.
  **Dos técnicas, porque las dos familias no comparten forma:**
  - **8 con `qbMock` de TypeORM** (`categorias`, `descuentos`, `recargos`, `terceros`,
    `cajones`, `garzones`, `turnos`, `impresoras`): se asserta el argumento de `andWhere`
    **y el orden contra `where`** vía `mock.invocationCallOrder`. El orden no es
    ceremonia: `where()` resetea `expressionMap.wheres`, así que un `andWhere` que quede
    arriba se descarta entero, y `toHaveBeenCalledWith` —agnóstico al orden— no lo ve.
  - **6 con SQL cruda** (`causas-merma`, `motivos-diferencia`,
    `motivos-diferencia-inventario`, `grupos-modificadores`, `salones` + sus `mesas`): se
    asserta la **cláusula exacta con su alias** en el SQL que recibe el `dataSource.query`
    mockeado — no un `eliminado_por` suelto, que puede matchear el `SELECT` del mismo
    template o un comentario `--` (el modo de falla que ya costó una ronda en la Task 4).
  **`salones` no tenía NINGÚN test unitario de `listarSalones`**, así que se escribió: es
  el único de los 16 que aplica la regla en **dos** lugares de la misma query, y el filtro
  de la mesa va en el `JOIN` y no en el `WHERE` a propósito —puesto en el `WHERE` haría
  desaparecer el salón entero cuando alguna de sus mesas la borró el sistema—, así que el
  test fija también esa posición. Fijar posición pide **acotar el tramo** del SQL: un
  `toContain` sobre la query entera daba por bueno el filtro puesto en cualquier otro
  `ON` (medido: movido al JOIN de `usuarios` deja de filtrar mesas y el test seguía
  verde). Se acota al tramo `LEFT JOIN mesas` → siguiente `JOIN`/`WHERE`, y con eso
  mueren los dos desplazamientos, hacia el `WHERE` y hacia otro `ON`. De paso, la rama
  **sin** flag asserta el `m.eliminado_el IS NULL` del mismo JOIN, que tampoco tenía
  nadie: borrarlo devolvía el salón con sus mesas borradas adentro.
  **Mutantes verificados uno por uno, borrando el filtro del service.** Los **16**
  recursos mueren, y ninguno arrastra a otro —lo que importa porque tres alias colisionan
  entre recursos (`c`, `m`, `t`)—. El reparto exacto, que la primera redacción de esta
  entrada sumó mal (decía "7 + 8", que son 15): **8 `andWhere`** y **6 cláusulas de SQL
  cruda** (salón y mesa por separado) son los 14 que este cierre agregó; los otros 2 ya
  asertaban — `impuestos`, mutado en el commit anterior, e `items`, que venía de antes y
  se mutó acá para no afirmar los 16 sin haberlo comprobado.

- [x] ~~**`pendientes.md` clasifica mal a `grupos-modificadores.vue` para el fix de la
  carrera**~~ (doc) — cerrado 2026-08-01. La entrada de las 13 pantallas decía que
  `grupos-modificadores.vue` era la única que usa `usePaginatedList` y que por eso "ya
  hereda el fix, nada que hacer". **Falso, y de la peor forma para una instrucción**:
  mandaba a saltear justo la pantalla que necesita el arreglo. Solo importa el **tipo**
  `PaginatedResponse` y tiene su propio `cargar()` sin `cargaEnCurso`. Corregido a lo
  medido: **ninguna de las 13 pendientes usa el composable**, así que las 13 necesitan la
  cola serial local de `categorias.vue`, y el molde de test de `items.vue` —que ejercita
  el `watch` del composable— no les sirve.
  **La causa del error se puede nombrar, y es la misma de la semana:** el conteo se había
  hecho grepeando el **import**, no la **llamada**. Varias pantallas importan el tipo sin
  usar el composable. Por eso también el "14 consumidores" estaba mal: son **10 call
  sites** (8 páginas + 2 componentes), medidos por la llamada. Mismo número corregido en
  el comentario de `usePaginatedList.ts`.

- [x] ~~**Dos afirmaciones sueltas en `docs/features/papelera.md`**~~ (doc) — cerrado
  2026-08-01.
  - El bloque de contrato de la API decía que el 400 de colisión sale "en las 5 entidades
    con nombre único y también en `garzones`", contradiciendo la sección "Colisión al
    restaurar" 60 líneas más abajo. Medido contando los `restaurar()` que lanzan
    `BadRequestException`: son **9 de 16** — las 5 con índice único parcial, las **3 que
    enforcean por código** (`descuentos`, `recargos`, `turnos`, agregadas en la ola de
    fixes final y nunca reflejadas arriba), más `garzones`.
  - El **riesgo aceptado del PIN de `garzones`** no estaba escrito en ninguna doc. Ahora
    sí: `generarPinUnico()` compara contra los garzones **no eliminados**, así que un PIN
    queda libre mientras su dueño está en la papelera y restaurarlo puede dejar dos
    garzones vivos con el mismo PIN — justo lo que esa función existe para evitar. No se
    arregla porque `restaurar()` no puede compararlo: los PIN son bcrypt y no tiene el
    valor en claro. 1 en 10⁶ por creación, y regenerarle el PIN al restaurado sin avisar
    es peor que el problema. Queda escrito con el cierre posible (advertir y que decida un
    humano) para que la próxima persona no lo re-descubra ni lo "arregle" en silencio.

## Features diferidas

- [x] ~~**Log de cambios reversible ("deshacer") — dirección del owner, sin
  diseñar**~~ (transversal) — cerrado 2026-07-31 como **papelera + restaurar**, la
  segunda fila de la tabla de necesidades que planteaba la entrada original ("Borré
  algo la semana pasada"). Diseño completo:
  [`docs/superpowers/specs/2026-07-31-papelera-restaurar-eliminados-design.md`](../superpowers/specs/2026-07-31-papelera-restaurar-eliminados-design.md);
  doc operativa: [`docs/features/papelera.md`](../features/papelera.md).
  **Qué se construyó:** `eliminado_por` en las 16 tablas de catálogo del negocio y
  config operativa; `GET ...?incluirEliminados=true` en cada listado (mismo guard
  que ya protegía el `GET`); `POST /<recurso>/:id/restaurar` (mismo guard que el
  `DELETE`); colateral acotado por el `eliminado_el` exacto del borrado padre en 3
  recursos (`items`↔`receta_extras_permitidos`, `salones`↔`mesas`,
  `grupos-modificadores`↔`grupo_modificador_opciones`); huérfano tolerado sin
  cascada hacia arriba; 400 de colisión en las 5 entidades con nombre único por
  tenant más `garzones` (restricción propia sobre el placeholder "Mostrador", no
  nombre único). Confirma la observación que abarataba todo: para 16 de las tablas
  del alcance el dato borrado **ya estaba en la base** por la invariante 3 — faltaba
  el endpoint y la pantalla, no un modelo nuevo.
  **Qué se decidió NO construir, y por qué:**
  - **Revertir ediciones (volver un precio a su valor anterior).** La investigación
    de mercado (`docs/agent/investigacion-mercado.md`, corrida 2026-07-31) no
    encontró ni un solo POS que lo haga; el único ejemplo real de versionado con
    revert (Salesforce Field History Tracking) es view-only y de otro rubro.
  - **Bitácora de "quién cambió qué" (auditar ediciones).** `eliminado_por` cubre
    el borrado, que es lo que el caso de uso del owner pedía; auditar ediciones es
    otra feature, sin caso de uso concreto sobre la mesa.
  - **Cascada al restaurar.** El mercado es unánime en el sentido contrario:
    restaurar un ítem en Toast no lo devuelve a su menú, y en Square/Clover borrar
    una categoría deja los productos huérfanos sin bloquear nada. Se adoptó
    "huérfano tolerado + reasignación manual" en vez de intentar reconstruir el
    árbol de relaciones al momento del borrado.
  - **Ventana de retención y purga automática.** Ningún producto relevado (5,
    internacionales y chilenos) la documenta, y el soft delete del proyecto ya es
    permanente — agregar una ventana habría sido inventar una regla que nadie
    pidió.
  **Límite que se mantuvo, sin cambios:** el kardex sigue inmutable (ADR-007, se
  compensa con movimiento contrario) y el hecho fiscal de una venta emitida sigue
  congelado (ADR-010) — ninguno de los dos entra a la papelera. Un "revertir
  cualquier cosa" uniforme seguía sin ser alcanzable, y la papelera no lo intentó.
  **Consecuencia sobre otra entrada de este archivo:** desbloqueó "Un descuento,
  recargo o impuesto desactivado sigue aplicándose" (`pendientes.md`, auditoría
  `items` + `calculo-precios`), que esperaba esta decisión antes de poder
  encararse — ver esa entrada para el detalle de lo que sí quedó abierto ahí.


---

## Ronda de decisiones del owner (2026-08-07)

Las tres salieron de la misma tanda: el owner eligió **advertir** en las dos de garzones y
dio el OK para tocar `propinas`. El texto de cada entrada se muda verbatim; lo que la
entrada afirmaba **de más o de menos** se anota en su bloque de cierre.

- [x] **Los tres DTO de liquidación de propinas aceptan fechas que no existen, y el período
  se corre en silencio** (backend, `propinas/dto/{liquidar,create-liquidacion,preview-liquidacion}.dto.ts`)
  — usan `@IsISO8601()` sin `strict: true`, que valida la FORMA y no el calendario.
  Medido con `validateSync` + `new Date`:

  | valor | `@IsISO8601()` | con `strict: true` | `new Date(valor)` |
  |---|---|---|---|
  | `2026-02-31` | acepta | rechaza | **2026-03-03** |
  | `2026-04-31` | acepta | rechaza | **2026-05-01** |

  El hueco es **exactamente el día que se pasa de mes**: un mes fuera de rango
  (`2026-13-01`) el laxo ya lo rechaza, así que nunca llega a `new Date`.
  Y lo grave no es un error sino el **rollover silencioso**:
  `liquidacion-propinas.service.ts:157` hace `new Date(dto.fechaDesde)` y JS convierte el 31
  de febrero en el 3 de marzo sin avisar. La fecha corrida **llega hasta el SQL** —viaja como
  `$2`/`$3` en el `vp.creado_el >= $2 AND vp.creado_el < $3` de `buscarTipsElegibles`
  (`:1125-1155`)— y además **queda persistida** en la fila de la liquidación (`:814`). La
  guarda `fechaHasta <= fechaDesde` (`:159`) no corta: compara dos `Date` ya corridos.
  Es plata, y no falla: liquida sobre un período distinto al pedido.
  Son **dos** puntos de entrada, no uno: `crear()` (`:157`) y el camino de confirmar
  (`:578-609`), que repite el mismo `new Date` con la misma guarda.
  El arreglo es una palabra (`{ strict: true }`) en seis decoradores. Sale de la revisión
  del cierre del 2026-08-07, al endurecer el DTO gemelo de `turnos` — **queda fuera de ese
  diff porque toca otro módulo**, no porque sea menor.
  **Cómo se cerró (2026-08-07).** Los seis `@IsISO8601({ strict: true })`, más un
  normalizador `rangoLiquidacionDesde` (`propinas/utils/rango-liquidacion.ts`) en los
  **tres** puntos donde se construye el `Date`: `crear()`, `liquidar()` y el `preview` del
  controller — la entrada contaba dos y el del controller (`:45-46`) hacía el mismo
  `new Date` sin ninguna guarda.
  ⚠️ **"El arreglo es una palabra en seis decoradores" era incompleto, y se midió.** `strict`
  cierra el rollover, pero **no** cierra `2026-W32-1` ni `20260807`: son ISO 8601 legítimas,
  así que las acepta, y `new Date` devuelve `Invalid Date`. Ahí la guarda de orden tampoco
  ayuda —compara `NaN <= NaN`, que es siempre `false`—, así que el `Date` inválido llegaba a
  la query. Medido contra el Postgres del compose: `invalid input syntax for type timestamp
  with time zone: "0NaN-NaN-NaNTNaN:NaN:NaN.NaN+NaN:NaN"`, o sea un **500**. Son dos modos de
  falla distintos —el rollover corrompe en silencio, la ilegible revienta— y el decorador
  solo tapa el primero.
  **Lo que NO se copió de `turnos`:** el `@Matches(/^\d{4}-\d{2}-\d{2}$/)` que allá era
  obligatorio (el SQL hace `::date`). Acá el service hace `new Date`, así que un timestamp
  completo es un límite de período legítimo y el regex habría roto a quien mande hora. Hay un
  test que lo fija.
  **Lo que fija cada cosa:** revertir `strict` en un solo DTO mata sus 3 casos de calendario y
  deja vivos los de los otros dos; sacar el chequeo de `Invalid Date` mata **6**
  —los dos casos `2026-W32-1`/`20260807` en cada uno de los tres archivos que lo ejercen:
  el spec del util, el del controller y el del service—; y revertir `crear()` al `new Date` inline mata su test de cableado
  sin tocar el de `liquidar()`. Hay además un test que afirma el **hueco** —que el decorador
  acepta `2026-W32-1`— para que, si algún día `strict` empieza a rechazarlo, la defensa se
  mueva en vez de desaparecer.
  **Refutado de la propia entrada:** decía que el hueco era "exactamente el día que se pasa de
  mes". No: `2026-02-29` (año no bisiesto) también rueda, y `2028-02-29` —bisiesto real— tiene
  que seguir pasando. Los dos están en el spec.
  ⚠️ **`query-propina-reporte.dto.ts` NO se tocó, a propósito:** usa `@Matches` solo, la misma
  forma que causó la regresión en `turnos`, pero `normalizarRangoReporte` ya hace el
  round-trip `toISOString().slice(0,10) !== dto.desde`, que mata la fecha corrida con un 400.
  Está protegido **por conducta, no por decorador**. Grepear el mecanismo habría "arreglado"
  algo que ya funcionaba.
- [x] **`garzones.actualizar()` deja cambiar el `tipo` con una sesión abierta, sin avisar**
  (backend, `garzones.service.ts:139` — el gate que sí existe está en `:134-136`, y solo
  mira `activo`) — **la mitad `activo` de esta entrada se cerró el
  2026-08-07** (más arriba en este mismo archivo); esta es la mitad que sigue abierta
  porque **es decisión de producto, no mecánica**. `sesion_garzon.tipo_garzon` se congela al
  abrir la sesión, así que cambiar `garzones.tipo` a mitad de turno no corrompe el reparto
  —`assertGarzonEnUnSoloGrupo` corta la liquidación con un 400 accionable— pero el admin no
  se entera hasta ese momento. Lo que falta decidir es **qué hacer en el momento de editar**:
  bloquear como hace `activo`, o solo advertir. No es simétrico con `activo`: desactivar
  rompe la operación del garzón ahora mismo; cambiarle el tipo, no.
  **Decisión del owner (2026-08-07): advertir, no bloquear.** Bloquear obligaría a cerrar el
  turno para corregir un tipo mal cargado, y el cambio no rompe nada mientras el turno corre.
  **Cómo se cerró:** `actualizar()` devuelve `advertencias: string[]` —la forma que ya usan
  `ventas` e `items`, no el `{titulo, detalle}` que es exclusivo del motor de precios— con el
  aviso de que el reparto de ese turno sigue usando el tipo congelado y de que el cambio rige
  desde la próxima sesión. El mensaje nombra **los dos** tipos: sin el anterior, el admin no
  sabe qué se sigue usando. La pantalla lo emite como toast `warning` **después** del de
  éxito, porque el cambio sí se guardó.
  **El caso que no estaba en la entrada:** los formularios mandan el objeto entero, así que
  `tipo` viene aunque nadie lo haya tocado. Sin comparar contra el tipo actual, cada cambio de
  nombre con un turno abierto habría disparado una advertencia falsa —y una consulta de
  sesiones al pedo. Hay un test que lo fija, y el mutante que saca la comparación lo mata.
  **Lo que trajo la revisión independiente:** (a) el mensaje decía solo que el cambio "rige
  desde la próxima sesión", que suena inocuo — ahora nombra la consecuencia cara: si la
  persona genera propinas con los dos tipos en un mismo período, la **regla 2b** corta la
  liquidación de ese período con un 400 hasta partirlo en dos; (b) un `PATCH` que desactiva
  **y** cambia el tipo corría la misma consulta de sesiones dos veces, porque el formulario
  manda el objeto entero. Ahora el conteo se hace una sola vez y `assertSinSesionAbierta`
  lo recibe ya hecho. Test propio, con mutante que revierte a las dos consultas.
- [x] **`regenerarPin()` invalida el PIN sin avisar que hay una sesión abierta** (backend,
  `garzones.service.ts:147-153`) — misma familia que la anterior por otra puerta. El PIN
  viejo deja de funcionar de inmediato (documentado y deliberado), pero si el garzón está
  en turno no puede marcar salida ni operar hasta que alguien le pase el nuevo. Es una
  acción de seguridad rutinaria (PIN comprometido) con un efecto que nadie anticipa.
  **Decisión del owner (2026-08-07): advertir, no bloquear.** Rotar una credencial es la
  respuesta correcta a una filtración; trabarla porque hay un turno abierto sería la política
  al revés.
  **Cómo se cerró:** `regenerarPin()` devuelve `advertencias` igual que `actualizar()`, y la
  pantalla las muestra **dentro del modal que revela el PIN**, no como toast: el modal tapa la
  pantalla, el admin está mirando el PIN que tiene que entregar, y de eso habla el aviso. Un
  toast detrás del modal se pierde. Hay un test que afirma esa ubicación y que el aviso **no**
  se duplica como toast.
  **Efecto lateral atendido:** `crear()` también devuelve `GarzonConPin`, así que manda
  `advertencias: []`. Un garzón recién creado no puede tener sesión abierta, pero el array va
  igual para que el que consume no tenga que distinguir este endpoint de los otros.
  ⚠️ **Lo que costó de verdad fue el test de la pantalla, y no por el código de producción.**
  Los dos casos que pasan por el drawer dejaban `vitest run` en **exit 1** con 4
  *unhandled rejections* —2 por cada test que cierra el drawer, y los 13 igual "pasaban"— porque **cerrar** un `UDrawer` real bajo
  happy-dom hace que la transición de salida de `usePresence` (reka-ui) lea `style.display`
  de un nodo ya desprendido. Aislado con una variable: abrir el drawer y desmontar sale
  limpio; abrir, guardar —que hace `drawerOpen = false`— y desmontar da 2 rejections. La
  salida fue stubear `AppDrawer` en el `global.stubs` del propio mount, el mismo recurso que
  `components/AppDrawer.spec.ts` usa un nivel más abajo con `UDrawer`
  (`docs/patterns/frontend.md` §15).
  ⚠️ **Primero lo resolví con `mockComponent` y lo justifiqué diciendo que `global.stubs` no
  intercepta auto-imports. Es falso, y lo midió la cuarta revisión:** `global.stubs` sí los
  intercepta bajo `mountSuspended`, tanto `AppDrawer` (directo) como `UDrawer` (anidado). O
  sea que había elegido la herramienta de alcance de ARCHIVO —capaz de stubear el drawer de
  otros `describe` en silencio— por una limitación inventada. Quedó en `global.stubs`,
  acotado al mount. Lo otro que salió de ahí: el botón es
  `type="submit" form="garzon-form"`, y esa asociación por id la resuelve el **documento**,
  así que ese montaje necesita `attachTo: document.body` —con el `UDrawer` real no se notaba
  porque teletransporta al body—. Sin `attachTo` el submit no dispara y los dos tests mueren.
  ⚠️ **Acá me equivoqué y lo dejo anotado, no borrado.** Cuando los tests fallaban con la
  lista de toasts vacía cambié **dos cosas a la vez** —`trigger('click')` por `.click()`
  nativo, y después `attachTo`— y le atribuí el arreglo al click. Es falso: medido, con
  `trigger('click')` los 13 pasan igual y el mutante que saca el toast de éxito sigue
  matando los dos tests del drawer, o sea que el submit corre por los dos caminos. Lo único
  que hacía falta era `attachTo`. Lo cazó la segunda ronda de revisión independiente —el
  **mismo error, con las mismas dos variables**, que el caso 1 de
  `anti-patterns.md` → *"Rotular «medido» algo que no se midió"* (método de click + opción
  de montaje, atribuido al click). Esa entrada la agregó `f3f65c1c`, dos commits antes.
  O sea: la regla ya estaba escrita, y aun así se repitió — lo que la vuelve a cazar es la
  revisión independiente, no el recuerdo de haberla escrito. Que el stub no vuelva el test vacuo lo prueba el mutante que
  saca el toast de éxito de `guardar()`: mata los dos casos del drawer.
  ⚠️ **Y lo caro de la tanda: yo di el gate del frontend por verde grepeando la línea
  `Tests 619 passed` sin mirar el exit code.** Lo cazó la revisión independiente, no el
  gate. `npm test` puede terminar en 1 con todos los tests en verde.

---

## Selector de garzón antes del PIN (2026-08-08)

- [x] **El PIN de garzón amplifica la carga: cada intento fallido cuesta N bcrypt**
  (backend, `garzones.service.ts` → `resolverGarzonPorPin`) — itera **todos** los garzones
  activos del tenant comparando con bcrypt, porque el hash está salteado y no se puede
  buscar por índice.
  ⚠️ **La fuerza bruta que reportó la lente NO sobrevive, y se midió:** `bcryptjs` a coste
  10 tarda **62,5 ms** por comparación, así que un intento con 20 garzones activos son
  **1,3 s de CPU** y agotar el espacio de 10⁶ son **14 días de CPU saturada** por tenant.
  No es un vector práctico y sería ensordecedor.
  **Lo que sí sobrevive es otra cosa:** medido con 5 intentos concurrentes, **6,3 s** y
  hasta **309 ms de lag del event loop**. Es un solo proceso Node: ese lag lo pagan todos
  los tenants. Cualquiera con `Salones:Operar` puede provocarlo.
  El fix **no es throttling** (la entrada de rate limiting de "Endurecimiento para
  producción" está acotada a `/auth/*` y no cubre esto): es dejar de iterar, y eso exige
  decidir cómo — seleccionar el garzón antes de pedir el PIN cambia la UX; un HMAC con
  secreto de servidor en columna indexada permite buscar y conservar bcrypt para verificar.
  **Decisión de owner sobre el mecanismo de una credencial.**
  **Cómo se cerró (2026-08-08): seleccionar el garzón antes de pedir el PIN.** Decisión del
  owner. `resolverGarzonPorPin(tenantId, pin)` —que traía todos los activos y comparaba uno
  por uno— pasó a `verificarPin(tenantId, garzonId, pin)`: **una fila, un bcrypt**. Migrados
  los 7 llamadores y borrado el viejo, para que no vuelva por copiar-pegar.
  **El HMAC quedó descartado** al tomar la decisión: no hace falta criptografía nueva ni
  columna nueva si la pantalla ya sabe a quién comparar.
  **Dos listas complementarias, no una** (`GET /garzones/para-selector?enTurno=`): los que
  **no** están en turno para *entrar a turno* —quien ya tiene sesión abierta no puede abrir
  otra— y los que **sí** para los otros cinco caminos. La lista **codifica la regla**: el 400
  `El garzón ya tiene una sesión abierta` deja de **ofrecerse**. ⚠️ No de existir: la lista
  se pide al abrir el modal y el mismo garzón puede entrar a turno en **otro tótem** antes
  del submit. El guard sigue siendo el que manda.
  ⚠️ **`enTurno` es obligatorio y sin default, a propósito.** Con default, el llamador que se
  olvide recibe la lista equivocada **sin ningún error**.
  ⚠️ **`Salones:Operar`, no `Leer`.** Medido sobre el modelo, no sobre el seed: los roles son
  configurables por tenant, así que nada impide un rol que opere el salón sin poder leer el
  catálogo — y es exactamente quien necesita el selector. Por eso no se reusó `GET /garzones`.
  **Corrección sobre el plan:** decía eliminar `POST /identificar` porque "pierde su razón de
  ser". Era falso y se detectó al implementar: tenía un segundo trabajo —verificar el PIN
  **sin ejecutar la acción**, para que el modal muestre el error en línea y el usuario
  reintente sin perder lo que estaba haciendo—. Se conservó como `POST /verificar-pin` con
  `garzonId`: mismo trabajo, 1 bcrypt en vez de N.
  **Lo que fija cada cosa:** revertir a la iteración mata el test de "una sola consulta"
  —fixture con **dos** garzones, porque con uno solo iterar y no iterar dan el mismo número—;
  invertir `EXISTS`/`NOT EXISTS` mata 2 tests del e2e; y hacer que el modal ignore la
  elección y mande el primero mata el test de la pantalla, que por eso también tiene dos
  garzones en el fixture.
  ⚠️ **El e2e `garzones-selector` existe por una lección, no por completitud:** el unit
  mockea el query builder, así que puede afirmar `EXISTS`/`NOT EXISTS` pero **no que el SQL
  compile**. Es el mismo agujero por el que el 2026-08-07 se commiteó un `SELECT` con una
  columna inexistente con el gate entero en verde.
  ⚠️ **El fix cambió un número que esta misma entrada da por bueno más arriba.** El texto
  mudado dice que agotar 10⁶ son *"14 días de CPU saturada"* y que "no es un vector
  práctico" — cifra que suponía **N bcrypt por intento**. Con `verificarPin` es **1**:
  10⁶ × 62,5 ms ≈ **17 h de CPU** contra un garzón concreto, 20× más barato. Matiz honesto:
  comprometer a *alguno* cuesta casi lo mismo que antes, porque la iteración vieja probaba
  cada intento contra los N a la vez. Pero `/garzones/verificar-pin` es un oráculo de PIN
  **sin throttling** —el rate limiting sigue acotado a `/auth/*`— y la cifra vieja no debe
  quedar como última palabra. Anotado en `pendientes.md`.
  **Lo que NO se hizo, con fundamento** (detalle en el plan): el modo personal (Fase 2,
  bloqueada por el alta de usuarios), el timeout del tótem con ticket de garzón (el ticket
  cierra la falsificación pero no la presencia, y contra el atacante realista —el que está
  parado al lado— el valor útil del timeout es 0), y cualquier configuración de "modo
  estricto".

---

## El encargado que fuerza un cierre NO cuenta a ciegas (cerrado 2026-08-13)

**Cómo se cerró.**

Decisión de alcance, no bug — lo levantó la revisión independiente de la Task 6 (2026-08-13); **resuelta en su mitad
  operativa por decisión del owner el mismo día** (task 6b, plan `testigo-cierre-forzado`).
  La spec del testigo dice *"cuenta a ciegas: sin ver lo esperado"*, y hasta acá **no era
  así**: forzar el cierre exigía ser admin del tenant (`caja.service.ts` → `enviarConteo`,
  `esForzado && !esAdmin` → 403), y el modo ciego **exime al admin por diseño previo** (§3.4:
  *"el dueño no es el objetivo del anti-fraude"*). Como quien forzaba siempre era admin,
  quien forzaba SIEMPRE veía el esperado mientras contaba la plata de otro — la contradicción
  era de la spec contra una decisión anterior, no de la implementación contra la spec.

  ✅ **Lo que resolvió la task 6b:** forzar dejó de exigir ser admin del tenant y pasó a
  exigir `Cajas:Actualizar` (mismo permiso que ya exigía pedir la firma, `POST
  /caja/:id/testigos` desde la Task 6 — la incoherencia entre las dos mitades del mismo
  camino). Se sembró un usuario nuevo del rol para probarlo: `encargado@paris.cl`
  (`Cajas:Leer` + `Cajas:Actualizar`, no admin). Con eso, **por primera vez existe alguien
  que fuerza y cuenta a ciegas de verdad** — la promesa original de la spec, que hasta acá
  nadie no-admin podía ejercer porque forzar y estar exento del ciego eran la misma
  condición. Cubierto por `caja.e2e-spec.ts` → *el modo ciego SÍ aplica al encargado que
  fuerza (no admin)*.

  📌 **Lo que NO se tocó, por decisión explícita del owner (task 6b, decisión 2):** el admin
  del tenant **sigue exento del ciego incluso forzando** — la misma exención de siempre
  (§3.4), sin condicionarla a si la caja es propia o ajena. Las **cuatro** superficies que la
  aplican (`obtenerArqueo` `caja.service.ts:464-466`, `cajonesEstado` `:1204`,
  `resumenMovimientos` `:1332`, historial) no cambiaron una línea — la task 6b lo verificó
  con test, no lo implementó. De las tres opciones que este ítem dejaba abiertas ((a) corregir
  la spec, (b) eximir al admin solo en caja propia, (c) configurable por tenant), el owner
  eligió en los hechos **(a)**: el producto sigue exceptuando al admin siempre, así que la
  spec del testigo debería decir "cuenta a ciegas — salvo el admin del tenant, que nunca es
  el objetivo del anti-fraude" en vez de una promesa sin excepciones. Ese ajuste de texto de
  la spec queda afuera de esta entrada.
  🔗 Emparentado con el ítem ya conocido de que el ciego tapa el esperado en arqueo/drawer pero
  **no** en el panel de resumen del turno — ese ítem hermano sigue abierto, sin tocar acá: es
  el mismo problema de fondo —el ciego se definió vista por vista y no como una propiedad de
  "quién puede ver qué"—.

---

## Cierre forzado de caja ajena por el encargado, con firma de testigo (cerrado 2026-08-13)

**Entregado completo** por el plan `testigo-cierre-forzado` (tasks 1-8 + la 6b insertada por
decisión del owner). Ciclo de punta a punta, verificado en navegador contra el stack real:
el encargado cierra la caja de un cajero ausente desde `/cajas/:id`, le pide fe a un garzón
en turno, y el garzón firma o rechaza desde `/salones`.

Lo que quedó, además de lo que pedía la entrada original:

- **Forzar es operativo, no del admin del tenant** (`Cajas:Actualizar`) — el owner lo
  corrigió el 2026-08-13: *"el administrador no siempre estará pendiente"*. Efecto que salió
  gratis: como el modo ciego exime solo al admin, **el encargado cuenta a ciegas cuando el
  tenant tiene el modo ciego activo** (`tenants.arqueo_ciego`, opt-in, default `false`) —
  antes de esto, forzar y estar exento del ciego eran la misma condición, así que la promesa
  del diseño no la podía cumplir nadie.
- **Dos vías de firma**, congeladas en el registro (`via_firma`): por cuenta vinculada
  (prueba fuerte) o por PIN (identifica al garzón, no prueba quién lo tecleó).
- **Sin firma hay que explicar**, y el comentario de la fase 1 alcanza. `testigos_disponibles`
  hace verificable el "no había a quién pedirle".
- La solicitud solo se puede pedir con **el conteo ya congelado**, que es lo que hace que la
  firma valga; cubierto por un mutante en e2e.

Detalle funcional: [`gestion-cajas.md`](../features/gestion-cajas.md#ciclo-de-vida-de-una-solicitud-de-testigo).

**Lo que NO cerró y sigue abierto en `pendientes.md`** (no se arrastra acá): la aprobación por
umbral de diferencia, el texto de la spec que promete un ciego sin excepciones, y que
`Cajas:Actualizar` quedó siendo un permiso grueso.

### Texto original de la entrada

- [x] **Cierre forzado de caja ajena por el encargado** (backend + modelo) — ✅ **completo**
  (plan `testigo-cierre-forzado`, backend Tasks 1-5 + frontend Task 6, 2026-08-13): un admin
  del tenant (no cualquiera con permiso `Cajas`) puede cerrar la caja de un cajero que dejó
  el turno abierto. `cerrada_por` quedó registrado en `cajas` (quién contó/cerró, distinto
  de `usuario_id`), rompiendo el owner-only del cierre para el admin del tenant
  (`RbacService.userIsTenantAdmin`). Suma la firma de testigo: el encargado le pide fe a un
  garzón en turno, que firma o rechaza desde su propia sesión (cuenta vinculada o PIN); sin
  firma alguna, la fase 2 exige un comentario que explique qué pasó. Detalle completo:
  [`docs/features/gestion-cajas.md`](../features/gestion-cajas.md#modelo-de-acceso-por-permiso).
  ✅ **Decidido por el owner (2026-08-11): sí, con `cerrada_por` registrado, y la diferencia
  queda como INCIDENTE, no como faltante del cajero.**
  El criterio salió de la 4ª pasada de investigación (§10 de
  [`investigaciones/2026-07-23-gestion-caja.md`](investigaciones/2026-07-23-gestion-caja.md)):
  el estándar condiciona la responsabilidad del cajero a **dos** requisitos acumulativos
  —acceso exclusivo **y** oportunidad de estar presente en el conteo—, así que contar sin él
  **cae la imputación**. No pasa a nombre de quien contó: eso no existe como doctrina.
  🇨🇱 Y pesa un dato legal: sin **asignación de pérdida de caja** pactada, en Chile **no se
  puede descontar** un faltante del sueldo (DT, ORD. N°4229). La atribución vale como
  **prueba, no como cobro** — lo que hay que asegurar es la trazabilidad, no el culpable.
  ⚠️ **Validar con abogado antes de escribir la regla**: la fuente es doctrina de la DT
  leída por un agente, no asesoría legal.
  Pesó una consecuencia operativa que no estaba escrita acá: como solo puede haber **una
  caja física abierta por tenant+usuario**, una caja que su dueño no vuelve a cerrar deja a
  esa persona **sin poder abrir caja nunca más**. Sin cierre forzado, ese bloqueo necesita
  otra salida igual.
  Sigue sin migrar a `resueltos.md` por dos motivos: el ítem de abajo (aprobación por umbral)
  todavía referencia el cruce sin resolver contra este, y **falta la pantalla del garzón**
  (Task 7) — hasta que exista, la firma se puede pedir pero no completar desde la UI.

## El PIN del garzón no es suyo: lo emite el encargado y lo ve en claro (cerrado 2026-08-15)

**Entrada original (verbatim):** *"El PIN del garzón no es suyo: lo emite el encargado y lo ve
en claro (backend, medido 2026-08-12 al implementar el testigo del cierre) —
`garzones.service.ts` devuelve el PIN en texto plano al crear y al regenerar un garzón, y no
existe ningún flujo para que el garzón lo cambie. Consecuencia: el PIN identifica pero no
prueba que actuó esa persona — quien lo emitió puede tecleárselo, y en un local la pantalla
del garzón es un tótem compartido, así que ni siquiera hace falta usar la cuenta propia. [...]
Ojo con el orden respecto del testigo: si esto se hace antes, la doble vía de firma (cuenta vs
PIN) puede volverse innecesaria — la vía PIN dejaría de ser 'solo identifica', porque el
encargado ya no conocería el PIN por construcción."*

⚠️ **Corrección al encuadre, medida el 2026-08-14 al diseñar el arreglo** (spec
[`2026-08-14-pin-propio-garzon-design.md`](../superpowers/specs/2026-08-14-pin-propio-garzon-design.md),
sección *"Lo que esta feature gana — y lo que NO"*): la entrada original especulaba que
arreglar el PIN **convertiría la vía `'pin'` del testigo en prueba real**. Medido contra
`CajaTestigoService.resolver` (`caja-testigo.service.ts:351-378`), **no es así**: el garzón
**con cuenta** ya firmaba por la vía fuerte (`via_firma='cuenta'`, exige el JWT de esa cuenta;
el PIN ni se mira) desde que existe el testigo. La vía `'pin'` la usan **por construcción**
los garzones **sin** cuenta —`esVinculacionValida` decide cuál rama toca—, y a esos el
encargado les sigue emitiendo el PIN exactamente igual que antes. **La vía débil del testigo
queda exactamente igual de débil**, y está bien: escribir lo contrario en la documentación
habría sido peor que no escribirlo. Detalle: [`gestion-cajas.md`](../features/gestion-cajas.md#las-dos-vías-de-firma-y-por-qué-no-son-equivalentes).

**Lo que sí gana, que es otra cosa y es más ancho: el tótem compartido.** Antes de esto, una
persona con cuenta que operaba desde el tótem compartido no probaba nada —el encargado conocía
su PIN—. Con el arreglo, el garzón con cuenta fija su propio PIN y el encargado nunca lo ve, así
que operar desde el tótem con ese PIN sí prueba identidad. Eso alcanza **mesas, comandas, inicio
y cierre de turno, y la atribución de propinas** — todo lo que pasa por ese teclado, que es el
alcance que la entrada original ya señalaba correctamente.

**Qué se hizo** (plan `pin-propio-garzon`, 9 tareas, 2026-08-14/15):

- El disparador es **vincular** una cuenta, no el alta: la transición `usuarioId: null → uuid`
  pone `pin_hash` en el centinela `'!'` (medido: `bcrypt.compare` contra ese valor da `false` y
  no tira), así que el encargado nunca llega a ver un PIN de alguien con cuenta. El alta admite
  `usuarioId` directamente, con el mismo efecto.
- `PATCH /garzones/mi-pin` (JWT + tenant, sin permiso de módulo — `PermisosGuard` es
  `return true` sin el decorador) deja al garzón fijar su PIN **sin pedir el anterior**: el caso
  principal es el olvido, y exigirlo habría dejado a la persona sin salida.
- La unicidad se cae **solo para el PIN elegido** — rechazar la colisión lo habría convertido en
  oráculo de PIN ajenos, ya que siempre se elige a la persona antes de teclear — pero se conserva
  donde el sistema genera el PIN (alta sin cuenta, regeneración). Se rechazan PIN obvios
  (repetidos y escaleras de 6 dígitos).
- `PATCH /garzones/:id/pin` (la que ya existía) se parte según el garzón, no según la ruta: con
  cuenta **invalida sin revelar nada** (`pin: null`); sin cuenta **regenera y revela**, como
  siempre. Una sola ruta, porque el encargado no puede elegir mal — manda el estado del garzón.
- Historial completo (no solo el último cambio) en la tabla nueva `garzon_pin_evento`, cinco
  tipos de evento, escrito en la misma transacción que el cambio de `pin_hash`. Nunca guarda el
  PIN, solo el hecho de que cambió. Visible para el encargado (ficha) y el propio garzón (perfil,
  `GET /garzones/mi-pin`). **La ficha lo muestra para todos los garzones, con cuenta o sin ella**
  (decisión del owner, revisión final 2026-08-15): `emitido_en_alta` y
  `regenerado_por_encargado` son los únicos eventos que produce un garzón sin cuenta, y su
  perfil no existe (`miPin` resuelve por `garzonPersonalDe`, que exige `usuario_id` → 404), así
  que la ficha es la única pantalla donde se ven — y es el caso que justifica el log entero,
  porque con cuenta el encargado no regenera, invalida. Sin superficie nueva (el endpoint ya era
  `Salones:Leer`, el mismo de la ficha) y sin N+1 (una llamada por apertura de ficha, nunca una
  por fila; lo fija el test *"cero N+1: el listado no pide ningún historial…"*). El badge tiene
  **tres estados** y se muestra siempre que **no haya PIN usable**, con cuenta o sin ella; el
  único caso que lo esconde es *"sin cuenta y con PIN usable"*, donde *"PIN puesto"* significaría
  *"lo puso la persona"* y eso nunca pasó. Se descartó la regla más simple —esconderlo para todo
  garzón sin cuenta— porque se apoyaba en una premisa **falsa**: que un garzón sin cuenta siempre
  tiene un PIN emitido por el sistema. **Desvincular lo desmiente**, y se llega desde el propio
  formulario vaciando el selector: `actualizar()` pisa `pin_hash` solo en la transición
  `null → uuid` (`vinculaCuenta` exige `dto.usuarioId !== null`), así que un garzón dado de alta
  **con** cuenta y después desvinculado queda `usuario_id: null` **y** `pinFijado: false` — no
  puede operar por ningún lado (el tótem compara contra el centinela, el modo personal necesita
  el vínculo) ni arreglarlo solo (`fijarMiPin` le da 404 sin `usuario_id`). Ese estado lleva
  rótulo propio, *"Sin PIN: no puede operar"* en color `error`, separado de la espera normal
  (*"Sin PIN todavía"*, con cuenta): la salida de uno es que el encargado genere un PIN, la del
  otro es que la persona lo ponga desde su perfil.
- Aviso en `/salones`, modo personal, cuando el garzón no tiene PIN usable. Dos ramas con texto
  distinto según `tipo` (`TEXTO_INVALIDACION`, `index.vue:182-188`) — invalidado por el
  encargado: *"Bruno invalidó tu PIN (10-08-2026, 8:00 a. m.)"*; invalidado por vincular una
  cuenta: *"Tu PIN quedó sin efecto al vincular esta cuenta (Bruno, 10-08-2026, 8:00 a. m.)"* —
  y en las dos, el mismo sufijo que aclara que **no** es un bloqueo de este dispositivo: *"Desde
  este dispositivo trabajás normal; para el tótem compartido, hace falta ponerlo desde tu
  perfil."* Fijado por test (`index.nuxt.spec.ts:998-1020`) y explicado en el docblock de
  `avisoPin` (`index.vue:190-195`).

**Mutantes que fijan el comportamiento** (cada uno revierte al comportamiento anterior, no solo
rompe algo): quitar la invalidación al vincular, devolver el PIN en la rama de invalidación,
saltear la escritura del evento. Dónde cae cada uno, **medido contra los specs** en la revisión
final del 2026-08-15 (la redacción anterior citaba `garzones-selector.e2e-spec.ts`, que **no
asierta nada** sobre invalidación, vínculo ni eventos —sus únicas menciones están en un
comentario— y omitía `garzon-pin.e2e-spec.ts`, que es el spec construido para este ciclo):

| Mutante | Unit (`garzones.service.spec.ts`) | E2E |
|---|---|---|
| Quitar la invalidación al vincular | *"vincular una cuenta invalida el PIN y lo registra"* (+ *"DESVINCULAR no toca el PIN"* como contraste) | **Ninguno.** Ver la nota de abajo |
| Devolver el PIN en la rama de invalidación | *"CON cuenta: invalida, no devuelve PIN, y lo registra"* | `garzon-pin.e2e-spec.ts` → *"el encargado lo invalida sin ver ningún PIN, y el viejo deja de servir"* (`expect(res.body.pin).toBeNull()`) |
| Saltear la escritura del evento | los dos tests de arriba afirman sobre el evento guardado | `garzon-pin.e2e-spec.ts` → *"la historia quedó completa, en orden y con nombre del actor"* |

⚠️ **El primer mutante no tiene red en e2e, y conviene saberlo antes de confiarse — pero el
recorrido ya existe: lo que falta es la aserción.** `caja-testigo.e2e-spec.ts:383-387` vincula
al garzón B por `PATCH /api/garzones/:id` **después** de haberle abierto sesión con su PIN vivo
(`:376`), y `:771-775` hace lo mismo con el garzón D. O sea que la rama `vincular` de
`actualizar()` **sí se ejecuta** en e2e, con un PIN real muriendo en el proceso; simplemente
ningún test comprueba después que ese PIN dejó de servir (a ese spec le interesa otra cosa: el
testigo y `puede_operar_salon`). Cerrar el hueco es **agregar una aserción a un escenario ya
montado**, no construir uno nuevo.

Lo que sí es cierto es que ningún test **afirma** sobre esa transición. En particular
`garzon-modo-personal.e2e-spec.ts` → *"un garzón vinculado sigue en el selector del tótem, pero
su PIN viejo ya no abre la puerta"* prueba el **estado** y no la transición: el PIN de Ana ya
nace muerto en el seeder (`seeder.service.ts`, `pinHash: PIN_INUTILIZABLE`), así que con la
invalidación al vincular revertida ese test seguiría pasando. Sigue valiendo por lo que sí
prueba —que `verificarPin` corre de verdad contra el hash muerto—, pero no es la red de este
mutante; la red es el unit.

Detalle funcional completo: [`garzones.md`](../features/garzones.md). Spec de diseño con las
decisiones del owner y las alternativas descartadas:
[`2026-08-14-pin-propio-garzon-design.md`](../superpowers/specs/2026-08-14-pin-propio-garzon-design.md).

---

## Modo personal: el garzón con su propia tablet no teclea el PIN (cerrado — archivado 2026-08-15)

Entrada de la pasada `turnos` + `salones` + `garzones` (2026-08-06), **Fase 2 del plan
`2026-08-08-elegir-garzon-antes-del-pin.md`**. Se entregó y la entrada quedó viva en
`pendientes.md` por descuido: nadie la mudó al cerrarse. Se archiva al reordenar el backlog
el 2026-08-15, tras verificar que sus **dos** piezas existen:

| Lo que la entrada pedía | Dónde está hoy |
|---|---|
| Vínculo opcional `garzones.usuario_id` | `garzones/entities/garzon.entity.ts:55` |
| `usuarios_tenants.es_totem` como marcador **explícito** | `tenants/dto/marcar-totem.dto.ts`, `tenants.service.ts:612` (`marcarTotem`) |
| Resolución del garzón actuante | `garzones.service.ts` → `garzonPersonalDe`, con el override duro de `es_totem` |
| Que la pantalla no pida PIN en modo personal | `useSesionesGarzon.ts:162` manda `pin: ''`; `useSalones.ts:160,375` |

⚠️ **No se archiva por el texto de un plan sino por el código**: la verificación fue grep
sobre `backend/src` y `frontend/app`, no la lectura del plan que la diseñó. La entrega del
PIN propio del garzón (2026-08-15) se construyó **encima** de este vínculo —`garzonPersonalDe`
es lo que decide de quién es el PIN— así que la Fase 2 estaba en producción antes de que
nadie tachara la entrada.

Texto original de la entrada, verbatim:

> **Modo personal: el garzón con su propia tablet no debería teclear el PIN** (backend +
> frontend) — **Fase 2 del plan `2026-08-08-elegir-garzon-antes-del-pin.md`, diseñada y
> diferida el 2026-08-08.** El vínculo opcional `garzones.usuario_id` + `usuarios_tenants.
> es_totem` como marcador **explícito** del modo (no inferido: una cuenta marcada como tótem
> no puede volverse personal aunque alguien la vincule por error). Todo el diseño está en el
> plan, incluidas las cuatro preguntas ya resueltas.
> ⚠️ **DESBLOQUEADA el 2026-08-08.** Estaba frenada porque el alta de usuarios del tenant no
> existía —`POST /tenants/members` recibía un `usuarioId` ya existente y el único camino a
> una cuenta era el registro público—, así que habilitar un garzón personal costaba 4 pasos
> en 3 pantallas. Ahora `POST /tenants/usuarios` lo hace en uno
> (`docs/features/roles-permisos.md`). Lo que queda de esta entrada es el vínculo
> `garzones.usuario_id` + `usuarios_tenants.es_totem` y la resolución del garzón actuante,
> todo diseñado en el plan.
